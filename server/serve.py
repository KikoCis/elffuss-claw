#!/usr/bin/env python3
"""Servidor de desarrollo de Elffuss: sirve web/ y hace de proxy CORS en /proxy?url=…

Uso:  python3 server/serve.py [puerto]   (por defecto 8642)
"""
import http.server
import json
import socketserver
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
ROOT = os.environ.get('ELFFUSS_ROOT') or str(Path(__file__).resolve().parent.parent / 'web')
MAX_PROXY_BYTES = 2_000_000
# En desarrollo, /v1 (modelo) se reenvía a producción; en producción lo
# resuelve nginx directamente contra llama-server, no este forward.
LM_UPSTREAM = os.environ.get('ELFFUSS_LM') or 'https://elffuss.utopiaia.com'

# /proxy/report — buzón de errores/feedback (opt-in, ver web/js/telemetry.js).
# Nunca lleva código del proyecto del usuario, solo el mensaje técnico y
# metadatos (app, versión, user-agent) — se anexa tal cual a un .jsonl para
# revisarlo a mano, sin base de datos ni dependencias.
REPORTS_PATH = os.environ.get('ELFFUSS_REPORTS') or str(Path.home() / 'elffuss' / 'reports.jsonl')
MAX_REPORT_BYTES = 20_000
REPORT_RATE = {}  # ip -> [timestamps] — límite simple sin dependencias
RATE_WINDOW_S, RATE_MAX = 60, 20


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.path.startswith('/proxy?'):
            return self.proxy()
        if self.path.startswith('/v1/'):
            return self.forward_lm()
        super().do_GET()

    def do_POST(self):
        if self.path.startswith('/v1/'):
            return self.forward_lm()
        if self.path == '/proxy/report':
            return self.report()
        self.send_error(404)

    def forward_lm(self):
        """Reenvía /v1/* (API del modelo) al servidor de producción, con streaming."""
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(
            LM_UPSTREAM + self.path, data=body, method=self.command,
            headers={'Content-Type': self.headers.get('Content-Type', 'application/json')})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                self.send_response(r.status)
                self.send_header('Content-Type', r.headers.get('Content-Type', 'application/json'))
                self.end_headers()
                while True:
                    chunk = r.read(1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except Exception as e:  # noqa: BLE001
            self.send_error(502, f'lm: {e}')

    def proxy(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        url = (qs.get('url') or [None])[0]
        if not url or not url.startswith(('http://', 'https://')):
            return self.send_error(400, 'url invalida')
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Elffuss)'})
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read(MAX_PROXY_BYTES)
                self.send_response(200)
                self.send_header('Content-Type', r.headers.get('Content-Type', 'text/html'))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(body)
        except Exception as e:  # noqa: BLE001 — el agente recibe el motivo
            self.send_error(502, f'proxy: {e}')

    def report(self):
        """Recibe {app, kind, message, stack, url, userAgent, extra} y lo
        anexa a REPORTS_PATH. Solo texto/metadatos — nunca código ni
        contenido del proyecto del usuario (eso jamás sale de su navegador)."""
        # nginx (proxy_pass sin X-Forwarded-For) hace que client_address SIEMPRE
        # sea 127.0.0.1 — con la cabecera, el rate-limit es por IP real de verdad.
        ip = (self.headers.get('X-Forwarded-For') or '').split(',')[0].strip() or self.client_address[0]
        now = time.time()
        hits = [t for t in REPORT_RATE.get(ip, []) if now - t < RATE_WINDOW_S]
        if len(hits) >= RATE_MAX:
            return self.send_error(429, 'demasiados informes, espera un poco')
        hits.append(now)
        REPORT_RATE[ip] = hits

        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_REPORT_BYTES:
            return self.send_error(413, 'informe demasiado grande')
        body = self.rfile.read(length) if length else b''
        try:
            payload = json.loads(body or b'{}')
            if not isinstance(payload, dict):
                raise ValueError('payload no es un objeto')
        except Exception:
            return self.send_error(400, 'JSON inválido')

        record = {
            'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now)),
            'ip': ip,
            'app': str(payload.get('app', ''))[:60],
            'kind': str(payload.get('kind', ''))[:30],
            'message': str(payload.get('message', ''))[:2000],
            'stack': str(payload.get('stack', ''))[:4000],
            'url': str(payload.get('url', ''))[:300],
            'userAgent': str(payload.get('userAgent', ''))[:300],
            'extra': str(payload.get('extra', ''))[:2000],
        }
        try:
            path = Path(REPORTS_PATH)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('a', encoding='utf-8') as f:
                f.write(json.dumps(record, ensure_ascii=False) + '\n')
        except Exception as e:  # noqa: BLE001
            return self.send_error(500, f'no pude guardar: {e}')

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, fmt, *args):
        sys.stderr.write('· %s\n' % (fmt % args))


if __name__ == '__main__':
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('', PORT), Handler) as httpd:
        print(f'✳ Elffuss · http://localhost:{PORT}')
        httpd.serve_forever()

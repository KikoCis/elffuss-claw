#!/usr/bin/env python3
"""Servidor de desarrollo de Elffuss: sirve web/ y hace de proxy CORS en /proxy?url=…

Uso:  python3 server/serve.py [puerto]   (por defecto 8642)
"""
import http.server
import socketserver
import sys
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

    def log_message(self, fmt, *args):
        sys.stderr.write('· %s\n' % (fmt % args))


if __name__ == '__main__':
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('', PORT), Handler) as httpd:
        print(f'✳ Elffuss · http://localhost:{PORT}')
        httpd.serve_forever()

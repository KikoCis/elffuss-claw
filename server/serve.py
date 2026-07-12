#!/usr/bin/env python3
"""Servidor de desarrollo de Nastia: sirve web/ y hace de proxy CORS en /proxy?url=…

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
ROOT = os.environ.get('NASTIA_ROOT') or str(Path(__file__).resolve().parent.parent / 'web')
MAX_PROXY_BYTES = 2_000_000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.path.startswith('/proxy?'):
            return self.proxy()
        super().do_GET()

    def proxy(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        url = (qs.get('url') or [None])[0]
        if not url or not url.startswith(('http://', 'https://')):
            return self.send_error(400, 'url invalida')
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Nastia)'})
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
        print(f'✳ Nastia · http://localhost:{PORT}')
        httpd.serve_forever()

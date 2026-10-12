#!/usr/bin/env python3
"""Pruebas de server/install-proxy.sh y server/proxy-probe.py: el backend de
/proxy solo se queda puesto si pasa la sonda; si no, se vuelve al anterior, y
si tampoco hay uno que pase, el servicio se para.

Sin red ni systemd: el «servicio» es un proceso local en un puerto libre, y
ELFFUSS_PROXY_RESTART/STOP lo reinician y lo paran. Las peticiones de la sonda
las rechaza el proxy endurecido antes de conectar a nada.

    python3 tests/test_install_proxy.py
"""
import http.client
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVE = ROOT / 'server' / 'serve.py'
PROBE = ROOT / 'server' / 'proxy-probe.py'
INSTALL = ROOT / 'server' / 'install-proxy.sh'

# El relé abierto de antes, en pequeño: intenta traer la url y, como
# 127.0.0.1:1 no contesta, responde 502. Es lo que la sonda tiene que parar.
OPEN_RELAY = textwrap.dedent('''\
    import http.server, socketserver, sys
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_error(502, 'proxy: connection refused')
        def log_message(self, *a):
            pass
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('127.0.0.1', int(sys.argv[1])), H) as s:
        s.serve_forever()
''')

RESTART = textwrap.dedent('''\
    cd "$(dirname "$0")"
    if [ -f pid ]; then
      p=$(cat pid); kill "$p" 2>/dev/null || true
      for _ in $(seq 200); do kill -0 "$p" 2>/dev/null || break; sleep 0.05; done
      rm -f pid
    fi
    PYTHONDONTWRITEBYTECODE=1 ELFFUSS_BIND=127.0.0.1 ELFFUSS_REPORTS="$PWD/reports.jsonl" \\
      nohup python3 serve.py {port} </dev/null >>service.log 2>&1 &
    echo $! > pid
''')

STOP = textwrap.dedent('''\
    cd "$(dirname "$0")"
    if [ -f pid ]; then
      p=$(cat pid); kill "$p" 2>/dev/null || true
      for _ in $(seq 200); do kill -0 "$p" 2>/dev/null || break; sleep 0.05; done
      rm -f pid
    fi
''')


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class InstallProxy(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix='elffuss-proxy-'))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.port = free_port()
        (self.dir / 'restart.sh').write_text(RESTART.format(port=self.port), encoding='utf-8')
        (self.dir / 'stop.sh').write_text(STOP, encoding='utf-8')
        shutil.copy(PROBE, self.dir / 'proxy-probe.py')
        self.addCleanup(self.stop)   # nada de lo que arranca la prueba sigue vivo al acabar
        self.env = dict(os.environ, ELFFUSS_PROXYDIR=str(self.dir), ELFFUSS_PROXY_PORT=str(self.port),
                        ELFFUSS_PROXY_RESTART='bash %s' % (self.dir / 'restart.sh'),
                        ELFFUSS_PROXY_STOP='bash %s' % (self.dir / 'stop.sh'),
                        PYTHONDONTWRITEBYTECODE='1')

    def stop(self):
        subprocess.run(['bash', str(self.dir / 'stop.sh')], check=False)

    def put(self, name, hardened):
        if hardened:
            shutil.copy(SERVE, self.dir / name)
        else:
            (self.dir / name).write_text(OPEN_RELAY, encoding='utf-8')

    def install(self):
        return subprocess.run(['bash', str(INSTALL)], env=self.env, capture_output=True, text=True, timeout=120)

    def answer(self):
        """Lo que contesta ahora el «servicio» a la petición de la sonda, o None."""
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        try:
            conn.request('GET', '/proxy?url=http%3A%2F%2F127.0.0.1%3A1%2F')
            resp = conn.getresponse()
            resp.read()
            return resp.status, resp.getheader('X-Proxy-Error')
        except OSError:
            return None
        finally:
            conn.close()

    def test_a_backend_that_passes_the_probe_is_installed(self):
        self.put('serve.py.new', hardened=True)
        run = self.install()
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertIn('✓ sonda', run.stdout)
        self.assertEqual((self.dir / 'serve.py').read_bytes(), SERVE.read_bytes())
        self.assertFalse((self.dir / 'serve.py.new').exists())
        self.assertEqual(self.answer(), (403, 'forbidden-port'))

    def test_the_open_relay_is_rolled_back_to_the_previous_backend(self):
        self.put('serve.py', hardened=True)
        subprocess.run(['bash', str(self.dir / 'restart.sh')], check=True)   # el servicio, en marcha
        self.put('serve.py.new', hardened=False)
        run = self.install()
        self.assertEqual(run.returncode, 1, 'un backend que no pasa es un despliegue fallido')
        self.assertIn('NO pasa la sonda', run.stderr)
        self.assertIn('vuelto al backend anterior', run.stderr)
        self.assertEqual((self.dir / 'serve.py').read_bytes(), SERVE.read_bytes())
        self.assertEqual(self.answer(), (403, 'forbidden-port'), 'lo que queda escuchando es el endurecido')

    def test_with_nothing_that_passes_the_service_is_stopped_and_the_file_set_aside(self):
        self.put('serve.py.new', hardened=False)
        run = self.install()
        self.assertEqual(run.returncode, 1)
        self.assertIn('PARADO', run.stderr)
        self.assertFalse((self.dir / 'serve.py').exists(), 'un reinicio no puede levantar el relé abierto')
        self.assertTrue((self.dir / 'serve.py.rechazado').exists())
        self.assertIsNone(self.answer(), 'no queda nada escuchando')

    def test_a_previous_backend_that_also_fails_is_not_kept_running(self):
        self.put('serve.py', hardened=False)
        self.put('serve.py.new', hardened=False)
        run = self.install()
        self.assertEqual(run.returncode, 1)
        self.assertIn('PARADO', run.stderr)
        self.assertIsNone(self.answer())

    def test_nothing_is_touched_without_a_new_file_or_the_probe(self):
        self.put('serve.py', hardened=True)
        run = self.install()
        self.assertEqual(run.returncode, 1)
        self.assertIn('serve.py.new', run.stderr)
        self.put('serve.py.new', hardened=False)
        (self.dir / 'proxy-probe.py').unlink()
        run = self.install()
        self.assertEqual(run.returncode, 1)
        self.assertIn('sin sonda no se instala', run.stderr)
        self.assertEqual((self.dir / 'serve.py').read_bytes(), SERVE.read_bytes())
        self.assertTrue((self.dir / 'serve.py.new').exists())
        self.assertIsNone(self.answer(), 'no se reinició nada')


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Sonda del backend de /proxy: ¿lo que escucha en 127.0.0.1:<puerto> es el
proxy endurecido, o el relé abierto de antes?

    python3 proxy-probe.py [puerto]        (por defecto 8643)
    → sale con 0 si pasa y con 1 si no

install-proxy.sh la corre EN el servidor nada más reiniciar elffuss-proxy, y
si no pasa vuelve al backend anterior o para el servicio. Sin dependencias,
solo pide cosas que el proxy endurecido rechaza ANTES de conectar a nada, y
nunca imprime direcciones.

1. /proxy?url=http://127.0.0.1:1/ → 403 con X-Proxy-Error: forbidden-port.
   El proxy abierto de antes intenta conectar, falla y contesta 502.
2. La dirección pública con la que la máquina sale a internet → 403 con
   X-Proxy-Error: forbidden-destination. Si no, /proxy entra por el nginx de
   esta misma máquina a los demás vhosts. Sin dirección pública propia (detrás
   de NAT) no hay nada que comprobar aquí: esa dirección va a mano en
   ELFFUSS_PROXY_DENY.
"""
import http.client
import ipaddress
import socket
import sys
import time
import urllib.parse

ARRANQUE_S = 15   # lo que se espera a que el servicio recién reiniciado escuche


def pedir(port, url):
    """GET /proxy?url=… al backend → (estado, X-Proxy-Error). Mientras el
    servicio arranca la conexión se rechaza: se reintenta un rato."""
    path = '/proxy?url=' + urllib.parse.quote(url, safe='')
    hasta = time.monotonic() + ARRANQUE_S
    while True:
        conn = http.client.HTTPConnection('127.0.0.1', port, timeout=40)
        try:
            conn.request('GET', path)
            resp = conn.getresponse()
            resp.read()
            return resp.status, resp.getheader('X-Proxy-Error') or ''
        except ConnectionRefusedError:
            if time.monotonic() > hasta:
                raise
            time.sleep(0.5)
        finally:
            conn.close()


def salidas_publicas():
    """La dirección de salida a internet de cada familia, si es pública. Un
    connect() UDP elige ruta y origen sin mandar ningún paquete."""
    found = []
    for family, probe, fmt in ((socket.AF_INET, ('192.0.2.1', 9), 'http://%s/'),
                               (socket.AF_INET6, ('2001:db8::1', 9, 0, 0), 'http://[%s]/')):
        try:
            with socket.socket(family, socket.SOCK_DGRAM) as s:
                s.connect(probe)
                ip = ipaddress.ip_address(s.getsockname()[0].split('%', 1)[0])
        except (OSError, ValueError):
            continue
        if ip.is_global:
            found.append(('IPv%d' % ip.version, fmt % ip))
    return found


def main(argv):
    port = int(argv[1]) if len(argv) > 1 else 8643
    try:
        status, code = pedir(port, 'http://127.0.0.1:1/')
    except OSError as e:
        print('✗ sonda: no contesta nada en 127.0.0.1:%d (%s)' % (port, type(e).__name__))
        return 1
    if (status, code) != (403, 'forbidden-port'):
        # Lo de abajo haría que un relé abierto pidiera la IP propia: no se sigue.
        print('✗ sonda: /proxy hacia 127.0.0.1:1 da %d %s y tenía que dar 403 forbidden-port:'
              ' el backend NO es el proxy endurecido' % (status, code or '(sin X-Proxy-Error)'))
        return 1
    print('✓ sonda: puertos y loopback rechazados (403 forbidden-port)')
    ok = True
    propias = salidas_publicas()
    for familia, url in propias:
        status, code = pedir(port, url)
        if (status, code) == (403, 'forbidden-destination'):
            print('✓ sonda: la dirección pública propia (%s) se rechaza' % familia)
        else:
            print('✗ sonda: la dirección pública propia (%s) da %d %s y tenía que dar 403 forbidden-destination'
                  % (familia, status, code or '(sin X-Proxy-Error)'))
            ok = False
    if not propias:
        print('· sonda: la máquina no sale a internet con una dirección pública propia; si tiene una por NAT,'
              ' va en ELFFUSS_PROXY_DENY')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))

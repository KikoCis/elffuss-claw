#!/usr/bin/env bash
# Corre EN el servidor (deploy.sh lo llama por ssh): pone en su sitio el backend
# de /proxy que deploy.sh acaba de subir como serve.py.new, reinicia el
# servicio elffuss-proxy y lo pasa por la sonda (proxy-probe.py).
#
#  · pasa la sonda            → listo, y el anterior queda en serve.py.prev;
#  · no la pasa               → vuelve a serve.py.prev y lo comprueba igual;
#  · tampoco hay uno que pase → PARA el servicio y aparta el fichero, para que
#    ni un reinicio de la máquina lo levante. /proxy y /proxy/report quedan
#    caídos hasta arreglarlo: eso es un aviso, y un proxy abierto detrás de una
#    ruta de nginx es un SSRF.
#
# El directorio (por defecto ~/elffuss-proxy) es donde apunta el ExecStart del
# servicio, y no lo escribe ningún deploy.sh anterior a este: aquellos copian
# serve.py a ~/elffuss/ y reinician, y con el ExecStart aquí eso ya no vuelve
# a poner el proxy abierto. Las variables ELFFUSS_PROXY_RESTART/STOP existen
# para las pruebas (tests/test_install_proxy.py); en el servidor no se tocan.
set -euo pipefail

DIR=${ELFFUSS_PROXYDIR:-elffuss-proxy}
case "$DIR" in /*) ;; *) DIR="$HOME/$DIR" ;; esac
PORT=${ELFFUSS_PROXY_PORT:-8643}
RESTART=${ELFFUSS_PROXY_RESTART:-sudo systemctl restart elffuss-proxy}
STOP=${ELFFUSS_PROXY_STOP:-sudo systemctl stop elffuss-proxy}

cd "$DIR"
[ -f serve.py.new ] || { echo "✗ no hay $DIR/serve.py.new que instalar" >&2; exit 1; }
[ -f proxy-probe.py ] || { echo "✗ falta $DIR/proxy-probe.py: sin sonda no se instala" >&2; exit 1; }

reinicia() { bash -c "$RESTART" || echo "✗ el reinicio de elffuss-proxy falló" >&2; }
sonda() { python3 proxy-probe.py "$PORT"; }
# Solo una pista (la sonda es la que decide): el fallo más probable la primera
# vez es que el servicio siga arrancando el serve.py de ~/elffuss/.
pista() {
  command -v systemctl >/dev/null 2>&1 || return 0
  systemctl show -p ExecStart elffuss-proxy 2>/dev/null | grep -qF "$DIR/serve.py" && return 0
  echo "  pista: el ExecStart de elffuss-proxy no nombra $DIR/serve.py (systemctl cat elffuss-proxy):" >&2
  echo "  si sigue arrancando ~/elffuss/serve.py, eso es lo que ha contestado a la sonda." >&2
}

if [ -f serve.py ]; then cp -p serve.py serve.py.prev; fi
mv -f serve.py.new serve.py
reinicia
if sonda; then
  echo "✳ backend de /proxy instalado y comprobado"
  exit 0
fi
echo "✗ el backend nuevo NO pasa la sonda" >&2
pista
if [ -f serve.py.prev ]; then
  cp -p serve.py.prev serve.py
  reinicia
  if sonda; then
    echo "↩ vuelto al backend anterior, que sí pasa la sonda. El despliegue del backend ha fallado." >&2
    exit 1
  fi
fi
mv -f serve.py serve.py.rechazado
if bash -c "$STOP"; then
  echo "✗ elffuss-proxy PARADO y serve.py apartado (serve.py.rechazado): ningún backend disponible pasa la sonda." >&2
  echo "  /proxy y /proxy/report quedan caídos hasta instalar uno que la pase." >&2
else
  echo "✗ ningún backend disponible pasa la sonda, serve.py está apartado (serve.py.rechazado) y NO se pudo" >&2
  echo "  parar elffuss-proxy: páralo a mano (sudo systemctl stop elffuss-proxy) y mira qué sigue escuchando." >&2
fi
exit 1

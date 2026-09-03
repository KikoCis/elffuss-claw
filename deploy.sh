#!/usr/bin/env bash
# Deploy de Elffuss Claw a elffuss-claw.utopiaia.com (servidor UtopiaIA).
# El sitio (nginx + certbot + servicio elffuss-proxy) ya está configurado;
# esto solo sincroniza contenido. Los pesos de web/models/ del servidor
# están protegidos frente a --delete.
set -euo pipefail
cd "$(dirname "$0")"

# La IP y el usuario del servidor NO se publican: se leen del entorno.
# Estuvieron cinco semanas en este fichero dentro de un repo público, que es
# regalar la superficie de ataque entera a quien escanee GitHub.
#   export ELFFUSS_HOST=usuario@servidor  ELFFUSS_KEY=~/.ssh/tu_clave
HOST=${ELFFUSS_HOST:?define ELFFUSS_HOST (usuario@servidor) antes de desplegar}
KEY=${ELFFUSS_KEY:?define ELFFUSS_KEY (ruta a la clave ssh)}
DEST=/var/www/elffuss-claw.utopiaia.com

# El motor propio (js/engine/) NO viaja con un despliegue normal. Vive
# gitignorado en el árbol pero se sirve al navegador, así que el .gitignore
# protege de un «git add -A» y NO del rsync — que es justo el mecanismo elegido
# para desplegarlo. Con dos sesiones compartiendo árbol de trabajo, eso hizo que
# acabara en producción sin que nadie lo decidiera.
#   Para desplegarlo a propósito:  ./deploy.sh --con-motor
# El filtro «P» evita además que el --delete borre el que ya esté en el servidor.
MOTOR=(--filter='P models/*' --filter='P js/engine/**' --exclude='js/engine/**')
for a in "$@"; do
  if [ "$a" = "--con-motor" ]; then
    echo "▲ el motor propio (js/engine/) SE INCLUYE en este despliegue"
    MOTOR=(--filter='P models/*')
  fi
done

rsync -az --delete "${MOTOR[@]}" -e "ssh -i $KEY" web/ "$HOST:$DEST/"
rsync -az -e "ssh -i $KEY" server/serve.py "$HOST:${ELFFUSS_APPDIR:-~/elffuss}/serve.py"
ssh -i "$KEY" "$HOST" 'sudo systemctl restart elffuss-proxy'

# anti-caché: versionar assets del index con el commit y sellar el build
V=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
ssh -i "$KEY" "$HOST" "sed -i 's|href=\"css/\([^\"]*\)\.css\"|href=\"css/\1.css?v=$V\"|g; s|src=\"js/\([^\"]*\)\.js\"|src=\"js/\1.js?v=$V\"|g; s|__BUILD__|$V|g' $DEST/index.html"

echo "✳ desplegado → https://elffuss-claw.utopiaia.com (build $V)"

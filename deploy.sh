#!/usr/bin/env bash
# Deploy de Elffuss a elffuss.utopiaia.com (servidor UtopiaIA).
# El sitio (nginx + certbot + servicio elffuss-proxy) ya está configurado;
# esto solo sincroniza contenido. Los pesos de web/models/ del servidor
# están protegidos frente a --delete.
set -euo pipefail
cd "$(dirname "$0")"

HOST=ubuntu@SERVIDOR
KEY=~/.ssh/CLAVE_SSH
DEST=/var/www/elffuss.utopiaia.com

rsync -az --delete --filter='P models/*' -e "ssh -i $KEY" web/ "$HOST:$DEST/"
rsync -az -e "ssh -i $KEY" server/serve.py "$HOST:/home/ubuntu/elffuss/serve.py"
ssh -i "$KEY" "$HOST" 'sudo systemctl restart elffuss-proxy'

echo "✳ desplegado → https://elffuss.utopiaia.com"

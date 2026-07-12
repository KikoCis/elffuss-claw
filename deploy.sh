#!/usr/bin/env bash
# Deploy de Nastia a nastia.utopiaia.com (servidor UtopiaIA).
# El sitio (nginx + certbot + servicio nastia-proxy) ya está configurado;
# esto solo sincroniza contenido. Los pesos de web/models/ del servidor
# están protegidos frente a --delete.
set -euo pipefail
cd "$(dirname "$0")"

HOST=ubuntu@145.239.65.26
KEY=~/.ssh/id_rsa_2_ovh
DEST=/var/www/nastia.utopiaia.com

rsync -az --delete --filter='P models/*' -e "ssh -i $KEY" web/ "$HOST:$DEST/"
rsync -az -e "ssh -i $KEY" server/serve.py "$HOST:/home/ubuntu/nastia/serve.py"
ssh -i "$KEY" "$HOST" 'sudo systemctl restart nastia-proxy'

echo "✳ desplegado → https://nastia.utopiaia.com"

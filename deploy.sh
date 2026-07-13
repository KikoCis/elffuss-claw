#!/usr/bin/env bash
# Deploy de Elffuss a elffuss.utopiaia.com (servidor UtopiaIA).
# El sitio (nginx + certbot + servicio elffuss-proxy) ya está configurado;
# esto solo sincroniza contenido. Los pesos de web/models/ del servidor
# están protegidos frente a --delete.
set -euo pipefail
cd "$(dirname "$0")"

HOST=ubuntu@145.239.65.26
KEY=~/.ssh/id_rsa_2_ovh
DEST=/var/www/elffuss.utopiaia.com

rsync -az --delete --filter='P models/*' -e "ssh -i $KEY" web/ "$HOST:$DEST/"
rsync -az -e "ssh -i $KEY" server/serve.py "$HOST:/home/ubuntu/elffuss/serve.py"
ssh -i "$KEY" "$HOST" 'sudo systemctl restart elffuss-proxy'

# anti-caché: versionar assets del index con el commit y sellar el build
V=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
ssh -i "$KEY" "$HOST" "sed -i 's|href=\"css/\([^\"]*\)\.css\"|href=\"css/\1.css?v=$V\"|g; s|src=\"js/\([^\"]*\)\.js\"|src=\"js/\1.js?v=$V\"|g; s|__BUILD__|$V|g' $DEST/index.html"

echo "✳ desplegado → https://elffuss.utopiaia.com (build $V)"

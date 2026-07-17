#!/usr/bin/env bash
# Sincroniza el core compartido (repo elffuss) a web/js/. Ejecuta tras clonar
# el core al lado, o cuando el core cambie. Los archivos quedan vendorizados
# (este repo es autocontenido: clona y abre, sin build).
set -euo pipefail
cd "$(dirname "$0")"
CORE=${1:-../elffuss/core}
[ -d "$CORE" ] || { echo "No encuentro el core en $CORE (clona github.com/KikoCis/elffuss al lado)"; exit 1; }
for f in context.js skills.js md.js splash-gl.js ceo.js mind.js humanize.js telemetry.js; do cp "$CORE/$f" web/js/$f; done
cp "$CORE/providers/api.js" web/js/providers/api.js
echo "✳ core sincronizado desde $CORE"

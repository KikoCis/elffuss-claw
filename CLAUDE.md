# Elffuss — Guía del proyecto

SO web agéntico: el chat es la interfaz, las apps se generan como HTML al vuelo,
el modelo corre EN el navegador. Proyecto hermano de osin/Vilma. Público en
elffuss.utopiaia.com.

## Correr y probar

```bash
python3 server/serve.py            # http://localhost:8642 (estático + proxy CORS)
```

No hay build ni dependencias: ES modules vanilla (web/package.json solo declara
`"type": "module"` para poder hacer `node --check`). Verificación sintáctica rápida:

```bash
for f in web/js/**/*.js web/js/*.js; do node --check "$f" || echo "FALLO: $f"; done
```

## Decisiones que no hay que re-litigar

- **Sin framework, sin bundler.** Todo vanilla, importable, hackeable.
- **dtype `q4` en transformers.js/WebGPU** — `q4f16` genera basura (verificado en
  agentic-install, bitácora post 08). No "mejorarlo".
- El protocolo de tool-calls es un bloque ```` ```tool ````con JSON `{tool, args}` —
  funciona igual para el proveedor de reglas y para los LLMs.
- Los permisos de Elffuss son un primer filtro de UX; la seguridad dura la dan el
  sandbox del iframe (`sandbox="allow-scripts …"`, sin `allow-same-origin`), el
  permiso nativo de File System Access y el cifrado del vault.

## Dónde se enchufa el modelo propio

- ONNX: `web/js/model-config.js` (id, dtype, selfHosted, basePath).
- LiteRT-LM: `MODEL_URL` en `web/js/providers/litert.js`.
- El plan completo y los gotchas están en README § «Modelo propio». Los scripts de
  conversión/cuantización reutilizables viven en
  `~/work2026/agentic-install/lab/gemma-e2b-cli/` (quantize.sh, fuse_*.sh…).
- ⚠️ Cualquier conversión/fusión de modelos en este Mac es un JOB PESADO DE GPU:
  respeta el protocolo del lock (`~/.gpu_coordination/PROTOCOL.md`) — osin/elffuss
  tienen prioridad NORMAL y ceden ante agentic-install.

## Coordinación con agentic-install (modelo propio)

`coordinacion/NECESIDADES.md` = peticiones de Elffuss al agente de agentic-install
(que entrena los modelos); `coordinacion/ERRORES.md` = fallos encontrados
probando modelos en navegador (sirve de set de eval). Protocolo de estados en
las cabeceras. El usuario hace de correo entre los dos agentes: mantener ambos
archivos al día tras cada prueba.

## Personalidad

Elffuss es una eslava ucraniana angelical: rubia, cara redonda, cálida y
resolutiva; español conciso con algún «добре»/«готово». Vive en
`systemPrompt()` (agent.js), el avatar en `web/img/elffuss.svg`. Mantener la
persona corta: los modelos pequeños se degradan con prompts largos.

## Deploy

`./deploy.sh` — rsync de web/ al servidor de UtopiaIA + nginx/certbot
(mismo esquema que vilma.utopiaia.com). Los pesos de web/models/ NO van por git
(.gitignore) — se suben por rsync.

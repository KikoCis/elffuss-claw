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
- **LOCAL POR DEFECTO, nunca auto-externo**: la autocarga solo prueba modelos locales
  (onnx/WebGPU → básico). OpenAI/Anthropic/Ollama/servidor son **config avanzada**
  opt-in (pestaña ⚙️ → `settings.js` + `providers/api.js`, ids `ext:<nombre>`). Claves
  en localStorage del usuario; llamadas directas navegador→proveedor (no pasan por
  serve.py). El selector se construye dinámico: locales + externos activados.
- **Cola de mensajes** (`kernel.js`): se apilan y procesan en orden; persisten en
  IndexedDB (`kv/queue`). Anti-pérdida: el histórico se commitea (await) ANTES de
  sacar de la cola; `kv/lastDone` deduplica el solapamiento al restaurar. No romper
  ese orden.
- **Ornith 9B (servidor, opt-in)**: temp 1.0 / top_p 0.95 SIEMPRE (con temp baja
  entra en bucles) y `enable_thinking:false` por defecto (en CPU ~3.5 t/s; razonar =
  >5 min/turno). Servido por `elffuss-lm.service` (llama.cpp :8644) + nginx `/v1`.
- **Contexto**: `context.js` (ACE-lite: eviction BM25-lite+IDF con presupuesto,
  portado del attention_eviction de agentic-install — turboquant es de PESOS, no
  de contexto) + CONTEXTO AHORA (`snapshot()`) + idioma del navegador en la persona.
- **Persistencia navegador**: histórico en IndexedDB `kv/history` (restaurado al
  abrir; 🧹 lo borra) y memoria de hechos en el store `memory` (herramientas
  `memory.*`, entra en el CONTEXTO). Nada de esto sale del navegador del usuario.

## Dónde se enchufa el modelo propio

- ONNX: `web/js/model-config.js` (id, dtype, selfHosted, basePath).
- LiteRT-LM: `MODEL_URL` en `web/js/providers/litert.js`.
- El plan completo y los gotchas están en README § «Modelo propio». Los scripts de
  conversión/cuantización reutilizables viven en
  `~/work2026/agentic-install/lab/gemma-e2b-cli/` (quantize.sh, fuse_*.sh…).
- ⚠️ Cualquier conversión/fusión de modelos en este Mac es un JOB PESADO DE GPU:
  respeta el protocolo del lock (`~/.gpu_coordination/PROTOCOL.md`) — osin/elffuss
  tienen prioridad NORMAL y ceden ante agentic-install.

## Tests

`tests/e2e_datos.mjs` (Playwright; `cd tests && npm i && npm run e2e` con el dev
server corriendo): valida Excel→gráfico (xlsx real vía SheetJS) y la
automatización de carpetas (`fs.watch` entrada→salida + `fs.copy`). Corre en
modo básico (determinista, sin GPU) sembrando carpetas OPFS registradas en el
IndexedDB — los pickers nativos exigen gesto de usuario. Para tests con modelo
local WebGPU: flags `--enable-unsafe-webgpu --use-angle=metal` y **lock de GPU**.

## Coordinación con agentic-install (modelo propio)

`coordinacion/NECESIDADES.md` = peticiones de Elffuss al agente de agentic-install
(que entrena los modelos); `coordinacion/ERRORES.md` = fallos encontrados
probando modelos en navegador (sirve de set de eval). Protocolo de estados en
las cabeceras. El usuario hace de correo entre los dos agentes: mantener ambos
archivos al día tras cada prueba.

## Personalidad

Elffuss es una elfa eslava ucraniana: rubia, orejas élficas, corona de hojas,
cara redonda angelical; cálida y resolutiva; español conciso con algún
«добре»/«готово». Vive en `systemPrompt()` (agent.js), el avatar en
`web/img/elffuss.svg`. Mantener la persona corta: los modelos pequeños se
degradan con prompts largos.

## Deploy

`./deploy.sh` — rsync de web/ al servidor de UtopiaIA + nginx/certbot
(mismo esquema que vilma.utopiaia.com). Los pesos de web/models/ NO van por git
(.gitignore) — se suben por rsync.

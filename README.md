# ✳ Elffuss — el sistema operativo que vive en tu navegador

**Las apps no existen: se crean.** Elffuss es un SO web agéntico: el chat es la única
interfaz, y cuando necesitas una app, Elffuss la genera como HTML y aparece al instante
en el visualizador. Sin instalar nada, sin backend obligatorio, con el modelo corriendo
**dentro del navegador** (ONNX Runtime Web / LiteRT.js de Google, sobre WebGPU).

> Proyecto hermano de **osin/Vilma** (SO agéntico físico). Elffuss es la misma idea
> llevada al navegador: BOOM 💥.

## Qué hace hoy

| Pilar | Cómo |
|---|---|
| **Apps que se crean** | El agente genera HTML autocontenido → iframe sandbox en el visualizador. Se guardan en IndexedDB y se reabren desde la pestaña *Apps*. |
| **Cuatro cerebros** | **Ornith 9B · servidor** (llama.cpp en el OVH, `/v1` OpenAI-compatible, razonador con thinking desactivable), **ONNX/WebGPU** (transformers.js + Qwen2.5-0.5B `q4`, 100% local), **LiteRT-LM** (Google, Gemma-4 E2B, preview) y **Básico** (reglas, 0 descarga). Autocarga con cadena de respaldo: servidor → WebGPU → básico. |
| **Memoria + histórico** | El histórico de conversación persiste en IndexedDB (refrescar no borra nada; 🧹 = nueva conversación) y `memory.*` guarda hechos para siempre en el navegador — entran en el CONTEXTO de cada turno. |
| **Contexto ACE-lite** | Eviction de historial por relevancia (BM25-lite + IDF, portado del attention-context-eviction de agentic-install) con presupuesto de tokens + CONTEXTO AHORA (estado real del sistema) + idioma del navegador. |
| **Permisos** | Cada ámbito (archivos, apps, vault, tareas, internet) pide permiso la primera vez; revocables en la pestaña *Permisos*. |
| **Tus carpetas** | File System Access API (Chrome/Edge): autorizas una carpeta y Elffuss lista/lee/escribe dentro. Doble permiso: el de Elffuss + el nativo del navegador. |
| **Vault** | Secretos cifrados con AES-256-GCM, clave derivada por PBKDF2 (310k iter.) de tu contraseña maestra. Autobloqueo a los 5 min. Nada sale de tu máquina. |
| **Tareas programadas** | «Recuérdame dentro de 20 minutos…» → el prompt se auto-dispara en el futuro (mientras la pestaña esté abierta). |
| **Internet** | `web.fetch` con fetch directo (CORS) y fallback a proxy `/proxy?url=` del servidor. |

## Correr en local

```bash
python3 server/serve.py        # → http://localhost:8642
```

Chrome/Edge recomendado (WebGPU + File System Access). El modo **Básico** funciona
sin descargar nada; los modelos se bajan del CDN/HF la primera vez y quedan cacheados.

Pruébalo: *«hazme un reloj»*, *«autoriza una carpeta»*, *«recuérdame dentro de 1
minuto que estire»*, *«guarda el secreto gmail: hunter2»*, *«abre https://example.com»*.

## Arquitectura

```
web/
  index.html            shell del SO: chat (izq) + visualizador (der)
  js/kernel.js          arranque, conmutación de modelo, planificador
  js/agent.js           bucle agéntico: modelo → tool call JSON → resultado → modelo
  js/permissions.js     permisos por ámbito (modal + localStorage)
  js/tools/             fs, apps, vault, tasks, web  ← lo único que toca el mundo
  js/providers/         rules (sin modelo) · onnx (transformers.js) · litert (LiteRT-LM)
  js/model-config.js    QUÉ modelo carga el proveedor ONNX (aquí se enchufa el propio)
server/serve.py         estático + proxy CORS (desarrollo)
```

Sin build, sin framework: ES modules vanilla. El agente habla con las herramientas
mediante bloques ` ```tool {"tool":…,"args":…} ``` ` — el mismo protocolo para los
tres proveedores.

## Modelo propio

La infraestructura de navegador ya está verificada (viene de la demo J-space de
agentic-install, `lab/bitacora/posts/08-jspace-live.html`). Para servir un fine-tune
propio hay dos rutas:

1. **ONNX (transformers.js)** — exportar con `optimum` a ONNX + cuantizar a q4,
   copiar a `web/models/<id>/` y poner `selfHosted: true` en `js/model-config.js`.
   Requiere un modelo ≤1B para que sea usable (hoy no hay ninguno propio: el más
   pequeño entrenado es Gemma-4 E2B, ~2B activos).
2. **LiteRT-LM (Google)** — fusionar un LoRA sobre `google/gemma-4-E2B-it`
   (la base ya usada en agentic-install), convertir a `.litertlm` con
   `ai-edge-torch`, subir a `web/models/` y cambiar `MODEL_URL` en
   `js/providers/litert.js`. Es la ruta recomendada: E2B ya corre verificado
   en navegador vía `@litert-lm/core`.

Gotchas verificados (¡no re-descubrir!):
- transformers.js + WebGPU: **dtype `q4`**, nunca `q4f16` (genera basura aunque la
  GPU tenga `shader-f16`).
- LiteRT-LM es **solo WebGPU** y el `.litertlm` debe traer artefactos WebGPU.

## Deploy — elffuss.utopiaia.com

Contenido 100% estático (web/) + proxy. Mismo esquema que vilma.utopiaia.com:
rsync al servidor + nginx + certbot. Ver `deploy.sh`.

## Límites conocidos / roadmap

- Las tareas solo disparan con la pestaña abierta (futuro: Service Worker +
  Periodic Background Sync).
- El correo del usuario necesita OAuth (Gmail API) o un proxy IMAP — el navegador
  no habla IMAP. Primera iteración: `web.fetch` + proxy.
- El modo Básico es determinista (regex); el lenguaje libre de verdad llega al
  cargar un modelo.
- Modelo propio: exportar un fine-tune E2B a `.litertlm` (ver arriba).

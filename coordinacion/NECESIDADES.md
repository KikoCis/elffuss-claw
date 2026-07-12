# NECESIDADES — Elffuss → agentic-install

Canal de peticiones entre proyectos. **Elffuss** (SO web en el navegador,
`~/work2026/elffuss`, producción en elffuss.utopiaia.com) pide aquí; el agente de
**agentic-install** sirve y actualiza el estado. Hermano: [ERRORES.md](ERRORES.md)
para fallos encontrados probando.

**Protocolo**: cada entrada tiene ID `N-xxx` y estado
`PENDIENTE → EN CURSO → SERVIDO → VALIDADO` (Elffuss pone VALIDADO tras probarlo
en navegador). Al servir, añade una sección `**Entrega:**` con rutas/URLs y notas.
No borrar entradas; las cerradas quedan como historial.

Contexto técnico para servir modelos a Elffuss:
- El runtime del navegador ya está resuelto y verificado (viene de vuestra demo
  `lab/bitacora/posts/08-jspace-live.html`): transformers.js v3 (ONNX, WebGPU
  dtype `q4`) y LiteRT-LM `@litert-lm/core` (`.litertlm`, solo WebGPU).
- Los pesos autoalojados van en `/Users/kikocisneros/work2026/elffuss/web/models/`
  (NO van por git; `./deploy.sh` los sube por rsync a producción).
- El protocolo agéntico que debe hablar el modelo está en
  `web/js/agent.js` (`systemPrompt()`): responder texto normal O un bloque
  ` ```tool {"tool":"fs.list","args":{}} ``` ` (14 herramientas: fs.*, app.*,
  vault.*, tasks.*, web.fetch) O, como atajo para apps, un bloque ` ```html `
  con el documento completo.

---

## N-001 · Modelo propio E2B → `.litertlm` (ruta principal) — **PENDIENTE**
*2026-07-12 · prioridad alta*

Queremos el primer **modelo propio** de Elffuss en el navegador. Base
`google/gemma-4-E2B-it` (~2B activos), que es la única base vuestra que ya corre
verificada en navegador vía LiteRT-LM.

- **Qué**: fine-tune (LoRA fusionado) sobre gemma-4-E2B-it con el protocolo de
  tool-calls de Elffuss (ver arriba) + español conciso, exportado a **`.litertlm`
  CON artefactos WebGPU** (gotcha conocido: LiteRT-LM issue #2322 — un
  `.litertlm` sin artefactos WebGPU no compila en navegador).
- **Entrega**: `web/models/elffuss-e2b-v1.litertlm` (o URL HF tipo
  `KikoCis/elffuss-e2b-litert-lm`). Elffuss solo tiene que cambiar `MODEL_URL` en
  `web/js/providers/litert.js`.
- **Aceptación**: carga con `Engine.create({model, backend webgpu})`, responde en
  español y emite ` ```tool ` JSON válido ante «lista mis archivos» y ` ```html `
  ante «hazme una app de dados».
- **Nota GPU**: fusión/conversión = job pesado → lock de `~/.gpu_coordination`.

## N-002 · Tool-caller diminuto ≤1B → ONNX q4 (ruta ligera) — **PENDIENTE**
*2026-07-12 · prioridad media (pero es el que arregla la agéntica pequeña)*

**Actualización 12-jul (análisis en [CANDIDATOS-MODELO.md](CANDIDATOS-MODELO.md))**:
el default ya no es Qwen2.5-0.5B sino **LFM2.5-1.2B-Instruct** (850 MB q4,
agentic-first, clava el protocolo SIN fine-tune con transformers.js v4). El SFT
sigue teniendo valor para pulir persona/español/uso del CONTEXTO.

- **Qué**: SFT sobre `LiquidAI/LFM2.5-1.2B` (o 700M/350M si basta) con dataset
  sintético del protocolo Elffuss: pares user→tool-call para las 14 herramientas,
  user→```html app completa, y [resultado]→respuesta en español. Podemos generar
  el dataset juntos (pedídnoslo por aquí y os pasamos transcripciones reales).
- **Restricción dura (medida, ver ERRORES.md E-005)**: el export final debe
  pesar **≤~1 GB en disco** — onnxruntime-web tiene heap wasm de 4 GB y un
  1.5B q4 (1.8 GB) ya no carga. Con 0.5B q4 (786 MB) vamos sobrados.
- **Entrega**: export ONNX con optimum + cuantización **q4** (¡no q4f16!) en
  `web/models/elffuss-0.5b-v1/` con estructura HF completa
  (`config.json`, `tokenizer.json`, `onnx/model_q4.onnx`…). Elffuss lo activa con
  `selfHosted: true` en `web/js/model-config.js`.
- **Aceptación**: igual que N-001 pero vía transformers.js; además ≥8 de 10
  tool-calls válidos en las frases de prueba de ERRORES.md.

# ERRORES — pruebas de modelo en Nastia

Registro de fallos encontrados probando modelos en el navegador (Playwright +
Chromium WebGPU contra Nastia). Hermano: [NECESIDADES.md](NECESIDADES.md).
Estados: `ABIERTO / MITIGADO (workaround en Nastia) / CERRADO`.
El agente de agentic-install puede usar estos casos como set de evaluación de
los modelos que nos sirva.

**Dato de referencia (2026-07-12, M-series, headless Chromium + WebGPU):**
Qwen2.5-0.5B-Instruct ONNX q4 = 786 MB, descarga+carga ~30 s, respuesta ~10 s.
La infraestructura navegador funciona; los fallos son de CALIDAD del modelo
genérico.

---

## E-001 · Fence mal etiquetado pierde el tool-call — **MITIGADO** *(2026-07-12)*
- **Repro**: «créame una app con un botón que cuente cuántas veces lo pulso»
- **Visto**: el modelo emitió el JSON correcto de forma pero dentro de
  ` ```javascript ` (no ` ```tool `): `{"tool": "tasks.add", …}` → el parser no
  lo reconocía y el usuario veía JSON crudo como texto.
- **Mitigación en Nastia**: `agent.js` ahora intenta parsear CUALQUIER fence
  como tool-call JSON (salvo ```html). Para el fine-tune (N-002): entrenar con
  la etiqueta ` ```tool ` consistente.

## E-002 · Herramienta equivocada + args inventados — **ABIERTO** *(2026-07-12)*
- **Repro**: la misma frase de E-001 (pide una APP).
- **Visto**: eligió `tasks.add` (tarea) en vez de crear una app, con args
  inventados `{"name": "boton", "prompt": "Pulsa mi botón…"}` (el schema de
  tasks.add es `{inMinutes, at, prompt}`).
- **Mitigación parcial**: system prompt con few-shots + atajo ` ```html `
  (responder el HTML a pelo, sin escaparlo en JSON — mucho más fácil para un
  0.5B). **Solución real: N-002** (SFT del protocolo). Guardar este caso en el
  dataset de eval.

## E-003 · Español conversacional pobre — **ABIERTO** *(2026-07-12)*
- **Repro**: «¿qué puedes hacer por mí? responde en una frase»
- **Visto**: «Me dirijo a tu terminal y ejecuto `npm start` para iniciar la
  aplicación.» — sin sentido para Nastia.
- **Nota**: Qwen2.5-0.5B genérico no conoce su rol ni habla buen español pese
  al system prompt. Para N-001/N-002: incluir en el SFT identidad de Nastia
  (ángel eslava ucraniana, español cálido y conciso, «добре/готово»)
  y ejemplos [resultado]→respuesta.

## E-004 · LiteRT-LM (Gemma-4 E2B) sin probar E2E — **ABIERTO** *(2026-07-12)*
- El proveedor está implementado con el patrón verificado de la bitácora 08,
  pero no he corrido el E2E (descarga de varios GB). Pendiente primera prueba
  completa; recordad el gotcha de los artefactos WebGPU en el `.litertlm`.

## E-005 · Qwen2.5-1.5B q4 NO carga: OOM del wasm — **CERRADO (límite duro)** *(2026-07-12)*
- **Repro**: `onnx-community/Qwen2.5-1.5B-Instruct`, dtype q4 (1787 MB), WebGPU
  disponible (maxBufferSize 4 GiB, shader-f16 sí). Descarga al 100% y al crear
  la sesión onnxruntime-web lanza un número crudo (`3587561888` ≈ 3.3 GB):
  OOM del heap wasm de 32 bits (límite 4 GB) al mapear el modelo.
- **Conclusión**: límite práctico del cerebro en navegador ≈ **≤1 GB en disco**
  vía transformers.js. El 0.5B q4 (786 MB) sí carga. → Restricción añadida a
  N-002. Para modelos mayores la ruta es LiteRT-LM (N-001), que no pasa por el
  heap wasm.

## Benignos (no actuar)
- Warnings de onnxruntime `VerifyEachNodeIsAssignedToAnEp` (ops de shape en
  CPU): normales, sin impacto visible.

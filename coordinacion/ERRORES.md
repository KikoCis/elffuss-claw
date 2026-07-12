# ERRORES — pruebas de modelo en Elffuss

Registro de fallos encontrados probando modelos en el navegador (Playwright +
Chromium WebGPU contra Elffuss). Hermano: [NECESIDADES.md](NECESIDADES.md).
Estados: `ABIERTO / MITIGADO (workaround en Elffuss) / CERRADO`.
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
- **Mitigación en Elffuss**: `agent.js` ahora intenta parsear CUALQUIER fence
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
  aplicación.» — sin sentido para Elffuss.
- **Nota**: Qwen2.5-0.5B genérico no conoce su rol ni habla buen español pese
  al system prompt. Para N-001/N-002: incluir en el SFT identidad de Elffuss
  (elfa eslava ucraniana, español cálido y conciso, «добре/готово»)
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

## E-006 · Ornith razona en `reasoning_content` y no contesta — **CERRADO** *(2026-07-12)*
- **Visto**: Ornith-1.0-9B (Qwen3.5-9B, repack KikoCis con template arreglado)
  servido con llama.cpp `--jinja` piensa en `reasoning_content` antes del
  `content`; con `max_tokens` corto se queda pensando y el content llega vacío.
  En la CPU del servidor (E-007) un turno razonado = >5 min.
- **Solución**: `chat_template_kwargs: {enable_thinking:false}` por petición →
  respuesta en 4.7 s. El streaming enseña `reasoning_content` en la burbuja de
  «pensando» si se activa el modo profundo (`REMOTE.thinking=true`).
- Recordad SIEMPRE con Ornith: **temp 1.0 / top_p 0.95** (con temp baja entra
  en bucles de repetición — documentado en el README del repack).

## E-007 · Rendimiento CPU del servidor OVH — **dato de referencia** *(2026-07-12)*
- llama.cpp, Ornith 9B Q4_K_M (5.3 GB, requant de Q8_0), 8 cores (`-t 6`):
  **ingestión ~19 t/s, generación ~3.5 t/s**. Prompt de Elffuss ≈ 650 tokens →
  ~33 s la primera vez (`--cache-reuse 256` reutiliza prefijo después). Una app
  HTML de ~600 tokens ≈ 3 min.
- El 31B IQ2_M (10.9 GB) NO cabe: 15 GB de RAM, ~9.7 disponibles → thrash de
  disco, <1 t/s. Si algún día hay servidor con GPU o más RAM, reevaluar.

## Benignos (no actuar)
- Warnings de onnxruntime `VerifyEachNodeIsAssignedToAnEp` (ops de shape en
  CPU): normales, sin impacto visible.

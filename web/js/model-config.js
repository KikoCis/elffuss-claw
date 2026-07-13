// Qué modelo carga el proveedor ONNX (transformers.js).
//
// Hoy: LFM2.5-1.2B-Instruct de Liquid (ago 850 MB q4, agentic-first) — ganador
// del análisis empírico de coordinacion/CANDIDATOS-MODELO.md. Requiere tf.js v4.
//
// Mañana («modelo propio»): exporta tu fine-tune a ONNX con optimum,
// sube las carpetas a web/models/<id>/ y pon selfHosted: true.
// Ver README § «Modelo propio».
export const MODEL = {
  label: 'Elffuss LM (healed · LFM2.5-1.2B)',
  id: 'KikoCis/Elffuss-LM-1.2B-ONNX',   // nuestro heal agéntico de LFM2.5 (tool-calls + apps)
  dtype: 'q4',            // ¡NO q4f16! genera basura vía WebGPU (verificado en la bitácora)
  selfHosted: false,
  basePath: '/models/',   // solo se usa con selfHosted: true
};
// NO subir a Qwen2.5-1.5B: su q4 (1.8 GB) revienta onnxruntime-web al crear la
// sesión (OOM del heap wasm de 4 GB, throw numérico ~3.3e9). Límite práctico
// medido: ≤~1 GB en disco → ver coordinacion/ERRORES.md E-005 y NECESIDADES N-002.

// Los modelos EXTERNOS (OpenAI, Anthropic, Ollama local y el servidor Ornith)
// son configuración avanzada opt-in → js/settings.js + js/providers/api.js.
// Ornith DEGENERA con temperatura baja (temp 1.0 / top_p 0.95 obligatorios) y
// en la CPU del servidor razona lento → thinking desactivado por defecto.

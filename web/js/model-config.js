// Modelos que puede cargar el proveedor ONNX (transformers.js, WebGPU/wasm).
//
// Registro, no un solo modelo: el usuario elige, y por defecto se autoelige el
// mayor que entre en su máquina (ver pickLocalBrain en main.js).
//
// Límite práctico medido (ver coordinacion/ERRORES.md E-005): un ONNX de q4
// >~1 GB en disco revienta onnxruntime-web (OOM del heap wasm de 4 GB). Por eso
// los ONNX de aquí son pequeños; los grandes (Gemma) van por LiteRT-LM.
// Elffuss LM (healed · LFM2.5-1.2B) estaba aquí y se ha QUITADO. No basta con
// sacarlo del selector: este registro es lo que `onnx.js models()` devuelve, y
// de ahí salen las tarjetas de modelo del panel — seguía apareciendo como
// opción aunque el menú ya no lo ofreciera. Medido en el copiloto, no rastraba
// bien; un cerebro que no hace la tarea no es una opción avanzada, es una
// trampa para quien la elige.
//
// Quien lo tuviera guardado cae solo: `setOnnxModel` solo acepta claves que
// existan aquí, así que una preferencia vieja se ignora y queda el de por
// defecto.
export const ONNX_MODELS = {
  'qwen3.5-0.8b': {
    key: 'qwen3.5-0.8b',
    label: 'Qwen3.5-0.8B (WebGPU)',
    id: 'onnx-community/Qwen3.5-0.8B-ONNX',  // más nuevo que el 3-0.6B; verificado in-browser
    dtype: 'q4f16',        // q4 peta con bad_alloc en este modelo; q4f16 genera limpio
    approxMB: 600,
    selfHosted: false,
    basePath: '/models/',
    reasoning: true,        // Qwen3.5 híbrido con modo «thinking» (se limpia en onnx.js)
  },
};

// Modelo ONNX activo. `let` con export = binding vivo: onnx.js ve el cambio
// cuando setOnnxModel() reasigna. Por defecto, Qwen3.5-0.8B: el healed LFM2.5
// medía flojo (ver hidden arriba), así que el ligero por defecto es Qwen.
export let MODEL = ONNX_MODELS['qwen3.5-0.8b'];

export function setOnnxModel(key) {
  if (ONNX_MODELS[key]) MODEL = ONNX_MODELS[key];
  return MODEL;
}

// Los modelos EXTERNOS (OpenAI, Anthropic, Ollama local incl. Qwen3.8-27B, y el
// servidor Ornith) son configuración avanzada opt-in → js/settings.js +
// js/providers/api.js.
//
// Ojo: el Qwen3.8-27B ya NO está solo ahí fuera. En IQ1 y con el motor propio
// (`engine:qwen38-27b`, ver kernel.js) corre DENTRO del navegador; por API se
// sigue ofreciendo porque son 7,6 GB de descarga y no todo el mundo los quiere.

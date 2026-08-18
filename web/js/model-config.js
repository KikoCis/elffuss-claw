// Modelos que puede cargar el proveedor ONNX (transformers.js, WebGPU/wasm).
//
// Registro, no un solo modelo: el usuario elige, y por defecto se autoelige el
// mayor que entre en su máquina (ver pickLocalBrain en main.js).
//
// Límite práctico medido (ver coordinacion/ERRORES.md E-005): un ONNX de q4
// >~1 GB en disco revienta onnxruntime-web (OOM del heap wasm de 4 GB). Por eso
// los ONNX de aquí son pequeños; los grandes (Gemma) van por LiteRT-LM.
export const ONNX_MODELS = {
  'elffuss-lm': {
    key: 'elffuss-lm',
    label: 'Elffuss LM (healed · LFM2.5-1.2B)',
    id: 'KikoCis/Elffuss-LM-1.2B-ONNX',   // nuestro heal agéntico de LFM2.5
    dtype: 'q4',            // ¡NO q4f16! este modelo genera basura vía WebGPU con q4f16
    approxMB: 850,
    selfHosted: false,
    basePath: '/models/',
  },
  'qwen3-0.6b': {
    key: 'qwen3-0.6b',
    label: 'Qwen3-0.6B (WebGPU)',
    id: 'onnx-community/Qwen3-0.6B-ONNX',  // el ejemplo oficial de transformers.js
    dtype: 'q4f16',        // el que usa el ejemplo de HF; se valida al cargar (ver onnx.js)
    approxMB: 560,
    selfHosted: false,
    basePath: '/models/',
    reasoning: true,        // Qwen3 es híbrido con modo «thinking»
  },
};

// Modelo ONNX activo. `let` con export = binding vivo: onnx.js ve el cambio
// cuando setOnnxModel() reasigna. Por defecto, el nuestro (compatibilidad).
export let MODEL = ONNX_MODELS['elffuss-lm'];

export function setOnnxModel(key) {
  if (ONNX_MODELS[key]) MODEL = ONNX_MODELS[key];
  return MODEL;
}

// Los modelos EXTERNOS (OpenAI, Anthropic, Ollama local incl. Qwen3.8-27B, y el
// servidor Ornith) son configuración avanzada opt-in → js/settings.js +
// js/providers/api.js. Qwen3.8-27B NO cabe en el navegador; se usa por ahí.

// Modelo vía ONNX Runtime Web (transformers.js, WebGPU con fallback a wasm).
// Patrón copiado de la demo verificada en agentic-install
// (lab/bitacora/posts/08-jspace-live.html): dtype 'q4' obligatorio — q4f16
// genera basura vía WebGPU incluso con shader-f16.
import { MODEL, ONNX_MODELS, setOnnxModel } from '../model-config.js';
import { packHistoryAsync } from '../context.js';

export let name = MODEL.label;

// Elegir qué ONNX cargar. Si cambia respecto al ya cargado, se descarta la
// sesión para que load() cree la nueva (un modelo distinto = otra sesión).
let generator = null, TextStreamer = null, cargadoKey = null;
export function configure(key) {
  const antes = MODEL.key;
  setOnnxModel(key);
  name = MODEL.label;
  if (MODEL.key !== cargadoKey && generator) { try { generator?.dispose?.(); } catch {} generator = null; }
  return MODEL.key !== antes;
}
export function models() { return Object.values(ONNX_MODELS); }

export async function load(onProgress = () => {}) {
  if (generator) return; // un solo modelo: nunca recargar/duplicar la sesión
  const tf = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4');
  TextStreamer = tf.TextStreamer;
  if (MODEL.selfHosted) {
    tf.env.allowRemoteModels = false;
    tf.env.localModelPath = MODEL.basePath;
  }
  // navigator.gpu puede EXISTIR como API sin que haya un adaptador real
  // (ciertos Linux/drivers, entornos sandboxed, navegadores headless…) — usar
  // solo la presencia del objeto como señal hace que pipeline() intente
  // WebGPU, falle con "Failed to get GPU adapter" DESPUÉS de descargar el
  // modelo entero, y en preloadModel() eso encadena a probar Gemma (varios
  // GB) para nada. Comprobar el adaptador de verdad antes de elegir.
  let device = 'wasm';
  if (navigator.gpu) {
    try { device = (await navigator.gpu.requestAdapter()) ? 'webgpu' : 'wasm'; }
    catch { device = 'wasm'; }
  }
  generator = await tf.pipeline('text-generation', MODEL.id, {
    device,
    dtype: MODEL.dtype,
    progress_callback: onProgress,
  });
  cargadoKey = MODEL.key;
}

// Liberar el modelo (vigilante de RAM): suelta los buffers wasm/WebGPU.
export async function unload() {
  try { await generator?.dispose?.(); } catch { /* mejor esfuerzo */ }
  generator = null; cargadoKey = null;
}

export async function chat(history, system, onToken = () => {}) {
  if (!generator) throw new Error('Modelo no cargado');
  // ACE-lite: eviction por relevancia. Presupuesto amplio (LFM2.5 aguanta
  // contexto largo); el tope POR MENSAJE (context.js) evita que un README
  // gigante dispare «Too many tokens requested».
  const messages = [{ role: 'system', content: system }, ...(await packHistoryAsync(history, 5000))];
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: onToken,
  });
  const out = await generator(messages, {
    max_new_tokens: 1024,
    do_sample: false,          // determinista: los tool calls JSON lo agradecen
    repetition_penalty: 1.1,
    return_full_text: false,
    streamer,
  });
  const gen = out[0].generated_text;
  let txt = (typeof gen === 'string' ? gen : gen.at(-1).content);
  // Modelos de razonamiento (Qwen3): fuera el <think>. Si quedó abierto por el
  // tope de tokens, nos quedamos con lo de después de la última apertura.
  if (txt.includes('<think>')) {
    txt = txt.replace(/<think>[\s\S]*?<\/think>/g, '');
    const i = txt.lastIndexOf('<think>');
    if (i !== -1) txt = txt.slice(i + 7);
    txt = txt.replace(/<\/?think>/g, '');
  }
  return txt.trim();
}

// Modelo vía ONNX Runtime Web (transformers.js, WebGPU con fallback a wasm).
// Patrón copiado de la demo verificada en agentic-install
// (lab/bitacora/posts/08-jspace-live.html): dtype 'q4' obligatorio — q4f16
// genera basura vía WebGPU incluso con shader-f16.
import { MODEL } from '../model-config.js';
import { packHistory } from '../context.js';

export const name = MODEL.label;
let generator = null, TextStreamer = null;

export async function load(onProgress = () => {}) {
  const tf = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
  TextStreamer = tf.TextStreamer;
  if (MODEL.selfHosted) {
    tf.env.allowRemoteModels = false;
    tf.env.localModelPath = MODEL.basePath;
  }
  const device = navigator.gpu ? 'webgpu' : 'wasm';
  generator = await tf.pipeline('text-generation', MODEL.id, {
    device,
    dtype: MODEL.dtype,
    progress_callback: onProgress,
  });
}

// Liberar el modelo (vigilante de RAM): suelta los buffers wasm/WebGPU.
export async function unload() {
  try { await generator?.dispose?.(); } catch { /* mejor esfuerzo */ }
  generator = null;
}

export async function chat(history, system, onToken = () => {}) {
  if (!generator) throw new Error('Modelo no cargado');
  // ACE-lite: eviction por relevancia con presupuesto corto — los modelos
  // pequeños se pierden (y se ralentizan) con historiales largos.
  const messages = [{ role: 'system', content: system }, ...packHistory(history, 2000)];
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: onToken,
  });
  const out = await generator(messages, {
    max_new_tokens: 640,
    do_sample: false,          // determinista: los tool calls JSON lo agradecen
    repetition_penalty: 1.1,
    return_full_text: false,
    streamer,
  });
  const gen = out[0].generated_text;
  return (typeof gen === 'string' ? gen : gen.at(-1).content).trim();
}

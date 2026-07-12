// Modelo vía ONNX Runtime Web (transformers.js, WebGPU con fallback a wasm).
// Patrón copiado de la demo verificada en agentic-install
// (lab/bitacora/posts/08-jspace-live.html): dtype 'q4' obligatorio — q4f16
// genera basura vía WebGPU incluso con shader-f16.
import { MODEL } from '../model-config.js';

export const name = MODEL.label;
let generator = null;

export async function load(onProgress = () => {}) {
  const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
  if (MODEL.selfHosted) {
    env.allowRemoteModels = false;
    env.localModelPath = MODEL.basePath;
  }
  const device = navigator.gpu ? 'webgpu' : 'wasm';
  generator = await pipeline('text-generation', MODEL.id, {
    device,
    dtype: MODEL.dtype,
    progress_callback: onProgress,
  });
}

export async function chat(history, system) {
  if (!generator) throw new Error('Modelo no cargado');
  const messages = [{ role: 'system', content: system }, ...history];
  const out = await generator(messages, {
    max_new_tokens: 640,
    do_sample: false,          // determinista: los tool calls JSON lo agradecen
    repetition_penalty: 1.1,
    return_full_text: false,
  });
  const gen = out[0].generated_text;
  return (typeof gen === 'string' ? gen : gen.at(-1).content).trim();
}

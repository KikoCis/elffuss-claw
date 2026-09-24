// Modelo vía WebLLM (MLC): WebGPU con kernels compilados por MLC, sin ONNX
// Runtime en medio.
//
// Por qué existe este proveedor: el mismo MiniCPM5-2B en ONNX q4f16 ABORTA en
// onnxruntime-web —número pelado, sin mensaje— tanto en webgpu como en wasm,
// con los ficheros servidos en local y 4 GB de maxBufferSize libres. Por MLC
// carga y responde coherente. Es una puerta distinta, no una variante.
import { packHistoryAsync } from '../context.js';

export const WEBLLM_MODELS = {
  'minicpm5-2b': {
    key: 'minicpm5-2b',
    label: 'MiniCPM5-2B · WebLLM',
    tag: '~1,3 GB · texto, 2B',
    base: 'https://huggingface.co/fatih-can/MiniCPM5-2B-MLC/resolve/main/q4f16_1/',
    lib: 'libs/MiniCPM5-2B-q4f16_1-MLC-webgpu.wasm',
    ctx: 4096,            // el WASM viene compilado a 32k; se acota sin descargar nada
  },
};

let motor = null, cargadoKey = null, actual = WEBLLM_MODELS['minicpm5-2b'];
export let name = actual.label;

export function configure(key) {
  const antes = actual.key;
  if (WEBLLM_MODELS[key]) actual = WEBLLM_MODELS[key];
  name = actual.label;
  if (actual.key !== cargadoKey && motor) { try { motor.unload?.(); } catch {} motor = null; }
  return actual.key !== antes;
}
export function models() { return Object.values(WEBLLM_MODELS); }
export let ctxTokens = 4096;

export async function load(onProgress = () => {}) {
  if (motor && cargadoKey === actual.key) return;
  const webllm = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm');
  // La base puede apuntar a otro sitio para pruebas locales; por defecto, HF.
  const base = (window.__WEBLLM_BASE || actual.base);
  onProgress('Preparando el modelo…');
  motor = await webllm.CreateMLCEngine(actual.key, {
    appConfig: { model_list: [{
      model: base, model_id: actual.key, model_lib: base + actual.lib,
      overrides: { context_window_size: actual.ctx },
    }] },
    initProgressCallback: (p) => onProgress(p.text || ''),
  });
  cargadoKey = actual.key;
  ctxTokens = actual.ctx;
}

export async function unload() {
  try { await motor?.unload?.(); } catch {}
  motor = null; cargadoKey = null;
}

export async function chat(history, system, onToken = () => {}) {
  if (!motor) throw new Error('Modelo no cargado');
  const messages = [{ role: 'system', content: system }, ...(await packHistoryAsync(history, 2500))];
  // Sin el bloque de razonamiento: es un modelo híbrido y el <think> se come el
  // presupuesto de tokens sin aportar nada a lo que el usuario lee.
  const flujo = await motor.chat.completions.create({
    messages, stream: true, temperature: 0, max_tokens: 1024,
    extra_body: { enable_thinking: false },
  });
  let txt = '';
  for await (const trozo of flujo) {
    const t = trozo.choices?.[0]?.delta?.content || '';
    if (t) { txt += t; onToken(t); }
  }
  // Por si aun así abre <think> (el tope de tokens puede dejarlo sin cerrar).
  if (txt.includes('<think>')) {
    txt = txt.replace(/<think>[\s\S]*?<\/think>/g, '');
    const i = txt.lastIndexOf('<think>');
    if (i !== -1) txt = txt.slice(i + 7);
  }
  return txt.trim();
}

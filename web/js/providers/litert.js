// Gemma-4 E2B vía LiteRT-LM de Google (early preview, solo WebGPU).
// Patrón copiado de la demo verificada en agentic-install
// (lab/bitacora/posts/08-jspace-live.html). El plan «modelo propio» es
// fusionar un LoRA sobre gemma-4-E2B-it y convertirlo a .litertlm
// (ai-edge-torch); entonces MODEL_URL pasará a /models/elffuss-e2b.litertlm.
export const name = 'Elffuss · Gemma-4 E4B (healed) · LiteRT-LM';

// Our own agentic heal of Gemma-4 E4B, converted to .litertlm — the brain trained for Elffuss's job.
const MODEL_URL =
  'https://huggingface.co/KikoCis/Elffuss-Gemma4-E4B-litert/resolve/main/model.litertlm';

let engine = null, conversation = null, sentCount = 0, sys = '';

export async function load(onProgress = () => {}) {
  if (!navigator.gpu) throw new Error('LiteRT-LM necesita WebGPU (Chrome/Edge modernos)');
  const litertlm = await import('https://cdn.jsdelivr.net/npm/@litert-lm/core/+esm');
  onProgress('Descargando Gemma-4 E2B (varios GB la primera vez; luego queda cacheado)…');
  engine = await litertlm.Engine.create({
    model: MODEL_URL,
    mainExecutorSettings: { maxNumTokens: 4096 },
  });
}

// Liberar el modelo (vigilante de RAM).
export async function unload() {
  try { engine?.close?.(); } catch { /* mejor esfuerzo */ }
  engine = null; conversation = null; sentCount = 0;
}

export async function chat(history, system, onToken = () => {}) {
  if (!engine) throw new Error('Modelo no cargado');
  // Comparar solo la parte estática del prompt: el CONTEXTO AHORA va al final
  // y cambia cada turno — recrear la conversación tiraría el KV-cache.
  const sysKey = system.slice(0, 200);
  if (!conversation || sysKey !== sys) {
    sys = sysKey;
    conversation = await engine.createConversation({
      preface: { messages: [{ role: 'system', content: system }] },
    });
    sentCount = 0;
  }
  // La conversación LiteRT mantiene su propio KV-cache: enviamos solo lo nuevo.
  const fresh = history.slice(sentCount).filter(m => m.role === 'user');
  sentCount = history.length;
  const text = fresh.map(m => m.content).join('\n') || history.at(-1).content;

  let out = '';
  for await (const chunk of conversation.sendMessageStreaming(text)) {
    for (const item of (chunk.content || []))
      if (item.type === 'text') { out += item.text; onToken(item.text); }
  }
  return out.trim();
}

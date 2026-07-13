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

// Contexto: probamos de mayor a menor hasta el máximo que acepten el bundle y
// la memoria GPU — así el contexto queda al tope permitido de serie.
const CTX_LADDER = [32768, 16384, 8192, 4096];
export let ctxTokens = 4096; // efectivo tras load() (la UI puede leerlo)

export async function load(onProgress = () => {}) {
  if (!navigator.gpu) throw new Error('LiteRT-LM necesita WebGPU (Chrome/Edge modernos)');
  const litertlm = await import('https://cdn.jsdelivr.net/npm/@litert-lm/core/+esm');
  // LiteRT-LM descarga los GB sin reportar loaded/total → segundos + barra indeterminada.
  const t0 = performance.now();
  const beat = () => onProgress(`Descargando Gemma-4 E4B… ${Math.round((performance.now() - t0) / 1000)}s · varios GB la 1ª vez, luego queda cacheado`);
  beat();
  const hb = setInterval(beat, 1000);
  try {
    let lastErr = null;
    for (const n of CTX_LADDER) {
      try {
        engine = await litertlm.Engine.create({
          model: MODEL_URL,
          mainExecutorSettings: { maxNumTokens: n },
        });
        ctxTokens = n;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        // Errores de formato/carga no dependen del contexto: no insistir con la escalera.
        if (/not supported|tokenizer|format/i.test(String(e?.message))) throw e;
        onProgress(`Contexto ${n} no cabe, probando ${n / 2}…`);
      }
    }
    if (lastErr) throw lastErr;
  } finally { clearInterval(hb); }
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

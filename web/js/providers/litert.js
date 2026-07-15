// Gemma-4 vía LiteRT-LM de Google (early preview, solo WebGPU).
// Patrón copiado de la demo verificada en agentic-install
// (lab/bitacora/posts/08-jspace-live.html).
// DECISIÓN 2026-07-14: cerebro = Gemma BASE (builds oficiales litert-community,
// formato artisan). NO fine-tune propio: `@litert-lm/core` exige empaquetado
// artisan y nuestras conversiones no lo producen (E-010). La agéntica va por el
// system prompt (agent.js), no por pesos.
export let name = 'Gemma · LiteRT-LM';

// Builds .litertlm elegibles. Los «-web» OFICIALES de Google (litert-community)
// están exportados en formato artisan → SÍ cargan en el navegador (son los que
// usaba la demo original). El healed de Elffuss es prefill_decode → hoy no carga
// (E-010), por eso está gateado en el selector.
export const MODELS = {
  'gemma-e2b': { url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm', label: 'Gemma-4 E2B', tag: '~2 GB · ligero' },
  'gemma-e4b': { url: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm', label: 'Gemma-4 E4B', tag: '~4 GB · el mejor' },
  'elffuss-e4b': { url: 'https://huggingface.co/KikoCis/Elffuss-Gemma4-E4B-litert/resolve/main/model.litertlm', label: 'Elffuss E4B (healed)', tag: 'modelo propio' },
};

let MODEL_URL = MODELS['gemma-e2b'].url;
let curLabel = MODELS['gemma-e2b'].label;
export function configure(key) {
  const m = MODELS[key] || MODELS['gemma-e2b'];
  MODEL_URL = m.url; curLabel = m.label; name = 'Gemma · LiteRT-LM (' + m.label + ')';
}

let engine = null, conversation = null, sentCount = 0, sys = '';

// Contexto: probamos de mayor a menor hasta el máximo que acepten el bundle y
// la memoria GPU — así el contexto queda al tope permitido de serie.
const CTX_LADDER = [32768, 16384, 8192, 4096];
export let ctxTokens = 4096; // efectivo tras load() (la UI puede leerlo)

export async function load(onProgress = () => {}) {
  if (!navigator.gpu) throw new Error('LiteRT-LM necesita WebGPU (Chrome/Edge modernos)');
  // navigator.gpu puede existir como API sin adaptador real (algunos Linux/
  // drivers, entornos sandboxed…) — comprobarlo YA evita bajar 2-4 GB para
  // descubrir el fallo solo al crear el motor, al final de todo.
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter(); } catch { /* sin adaptador */ }
  if (!adapter) throw new Error('No hay un adaptador WebGPU real disponible (la API existe pero no hay GPU accesible) — prueba con Elffuss LM, que corre en CPU/wasm.');
  const litertlm = await import('https://cdn.jsdelivr.net/npm/@litert-lm/core/+esm');
  // El .litertlm lo descargamos NOSOTROS (cache-first en Cache Storage) y se lo
  // pasamos a Engine.create como Blob (la API acepta string|Blob|ReadableStream).
  // Motivo: el fetch interno de LiteRT baja el peso con XHR+Range desde un WORKER
  // que el service worker no intercepta → antes se re-descargaba SIEMPRE. Bajándolo
  // aquí queda cacheado de verdad y damos progreso real en MB.
  const model = await cachedModelBlob(MODEL_URL, onProgress);
  onProgress('Preparando el modelo IA en la GPU…');
  let lastErr = null;
  for (const n of CTX_LADDER) {
    try {
      engine = await litertlm.Engine.create({ model, mainExecutorSettings: { maxNumTokens: n } });
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
}

const MODEL_CACHE = 'elffuss-models-v1';
// Devuelve el .litertlm como Blob desde Cache Storage; si no está, lo descarga
// con progreso real y lo cachea (persistente). Ante cualquier fallo, devuelve la
// URL para que LiteRT lo baje por su cuenta (nunca bloquea la carga del modelo).
export async function cachedModelBlob(url, onProgress = () => {}) {
  if (!self.caches) return url;
  try {
    const cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(url);
    if (hit) { onProgress('Cargando el modelo IA desde caché (sin descargar)…'); return await hit.blob(); }
    const net = await fetch(url);
    if (!net.ok || !net.body) return url;
    const total = +net.headers.get('content-length') || 0;
    const t0 = performance.now();
    const [prog, toCache] = net.body.tee();
    (async () => {
      const r = prog.getReader(); let loaded = 0;
      for (;;) { const { done, value } = await r.read(); if (done) break; loaded += value.length; onProgress(fmtBytes(loaded, total, t0)); }
    })().catch(() => {});
    const headers = { 'Content-Type': 'application/octet-stream' };
    if (total) headers['Content-Length'] = String(total);
    await cache.put(url, new Response(toCache, { headers }));
    const cached = await cache.match(url);
    return cached ? await cached.blob() : url;
  } catch { return url; }
}
function fmtBytes(loaded, total, t0) {
  const mb = n => (n / 1048576).toFixed(0);
  const secs = (performance.now() - t0) / 1000;
  const spd = secs > 0 ? (loaded / 1048576 / secs).toFixed(1) : '0';
  return total
    ? `Descargando el modelo IA… ${mb(loaded)}/${mb(total)} MB (${spd} MB/s) · se cachea para la próxima vez`
    : `Descargando el modelo IA… ${mb(loaded)} MB (${spd} MB/s)`;
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
      // Exprimir el navegador: no persistir los tokens de canal (tool-call/thinking)
      // del modelo en el KV-cache → libera KV → más contexto útil. Y prefill del
      // system prompt al crear la conversación → primera respuesta más rápida.
      filterChannelContentFromKvCache: true,
      prefillPrefaceOnInit: true,
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

// Proveedor genérico para APIs externas (configuración avanzada):
//  - kind 'openai'    → /chat/completions (OpenAI, Ollama, llama-server…)
//  - kind 'anthropic' → /v1/messages (Claude)
// Las llamadas salen DIRECTAS del navegador del usuario al proveedor; la clave
// no pasa por ningún servidor nuestro. Streaming SSE en ambos dialectos.
import { packHistoryAsync } from '../context.js';

let cfg = null;
export let name = 'API';

export function configure(c) { cfg = c; name = c.label; }

export async function load() {
  if (!cfg) throw new Error('proveedor sin configurar');
  if (cfg.kind !== 'anthropic' && !cfg.apiKey && !cfg.baseURL.includes('localhost') && cfg.baseURL !== '/v1')
    throw new Error('falta la clave de API (config avanzada)');
}

// El 4º argumento de chat() puede ser la señal misma o un objeto que la lleva
// dentro, { signal, onPrefill }, que es lo que pasa el agente (rlm.js pasa la
// señal sola). Se aceptan las dos formas, como en el motor propio: se reconoce
// por la forma y no por la clase, igual que allí.
const senalDe = x => (x && typeof x.aborted === 'boolean') ? x
  : (x && x.signal && typeof x.signal.aborted === 'boolean') ? x.signal : null;

// `signal` corta la petición de verdad: fetch la aborta y la conexión se cierra,
// así que el proveedor deja de generar (y de cobrar) en cuanto se pulsa parar.
// Antes chat() la recibía pero no la pasaba: openaiChat usaba un `signal` que no
// existía en su ámbito y CADA llamada a un proveedor OpenAI-compatible
// reventaba con «signal is not defined».
export async function chat(history, system, onToken = () => {}, signal = null) {
  signal = senalDe(signal);   // pasarle a fetch el objeto { signal, … } lanzaba TypeError
  return cfg.kind === 'anthropic'
    ? anthropicChat(history, system, onToken, signal)
    : openaiChat(history, system, onToken, signal);
}

// Parado a media respuesta: AbortError, como el de fetch, con lo generado hasta
// ese punto en `partial` por si alguien lo quiere.
function abortado(partial) {
  const e = new DOMException('Parado', 'AbortError');
  try { e.partial = partial; } catch { /* sin expandos: da igual */ }
  return e;
}

// ---- OpenAI-compatible ----
async function openaiChat(history, system, onToken, signal) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
  // packHistoryAsync: el empaquetado puede tener que codificar embeddings, así
  // que se resuelve ANTES de armar el cuerpo. Con el lado semántico apagado
  // devuelve exactamente lo mismo que la versión síncrona de siempre.
  const packed = await packHistoryAsync(history, 3000);
  const body = {
    model: cfg.model,
    messages: [{ role: 'system', content: system }, ...packed],
    stream: true,
    max_tokens: cfg.maxTokens || 1024,
  };
  if (cfg.temperature != null) body.temperature = cfg.temperature;
  if (cfg.top_p != null) body.top_p = cfg.top_p;
  if (cfg.thinking != null) body.chat_template_kwargs = { enable_thinking: cfg.thinking };

  const res = await fetch(cfg.baseURL.replace(/\/$/, '') + '/chat/completions', {
    signal,
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 120));

  let out = '';
  try {
    await readSSE(res.body, payload => {
      if (payload === '[DONE]') return;
      const d = JSON.parse(payload).choices?.[0]?.delta || {};
      if (d.reasoning_content) onToken(d.reasoning_content);
      if (d.content) { out += d.content; onToken(d.content); }
    }, signal);
  } catch (e) {
    if (signal?.aborted) throw abortado(out.trim());
    throw e;
  }
  return out.trim();
}

// ---- Anthropic Messages ----
async function anthropicChat(history, system, onToken, signal) {
  const packed = await packHistoryAsync(history, 3000);
  const res = await fetch(cfg.baseURL.replace(/\/$/, '') + '/v1/messages', {
    signal,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens || 1024,
      system,
      stream: true,
      messages: forAnthropic(packed),
    }),
  });
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 120));

  let out = '';
  try {
    await readSSE(res.body, payload => {
      const evt = JSON.parse(payload);
      if (evt.type === 'content_block_delta' && evt.delta?.text) {
        out += evt.delta.text; onToken(evt.delta.text);
      }
    }, signal);
  } catch (e) {
    if (signal?.aborted) throw abortado(out.trim());
    throw e;
  }
  return out.trim();
}

// Anthropic exige roles alternos empezando por user; fusiona consecutivos.
function forAnthropic(msgs) {
  const merged = [];
  for (const m of msgs) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const last = merged[merged.length - 1];
    if (last && last.role === role) last.content += '\n' + m.content;
    else merged.push({ role, content: m.content });
  }
  if (merged[0]?.role === 'assistant') merged.unshift({ role: 'user', content: '(continúa)' });
  return merged;
}

// Lector SSE común: invoca fn con el texto tras cada 'data:'. Con la señal
// abortada no entrega ni un evento más, aunque ya estén en el búfer: un mismo
// trozo de red puede traer varios, y sin esto saldrían tokens después de
// pulsar parar.
async function readSSE(stream, fn, signal = null) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const corta = () => {
    if (!signal?.aborted) return;
    reader.cancel().catch(() => {});
    throw new DOMException('Parado', 'AbortError');
  };
  for (;;) {
    corta();
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      corta();
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try { fn(payload); } catch { /* chunk parcial */ }
    }
  }
}

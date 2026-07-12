// Proveedor genérico para APIs externas (configuración avanzada):
//  - kind 'openai'    → /chat/completions (OpenAI, Ollama, llama-server…)
//  - kind 'anthropic' → /v1/messages (Claude)
// Las llamadas salen DIRECTAS del navegador del usuario al proveedor; la clave
// no pasa por ningún servidor nuestro. Streaming SSE en ambos dialectos.
import { packHistory } from '../context.js';

let cfg = null;
export let name = 'API';

export function configure(c) { cfg = c; name = c.label; }

export async function load() {
  if (!cfg) throw new Error('proveedor sin configurar');
  if (cfg.kind !== 'anthropic' && !cfg.apiKey && !cfg.baseURL.includes('localhost') && cfg.baseURL !== '/v1')
    throw new Error('falta la clave de API (config avanzada)');
}

export async function chat(history, system, onToken = () => {}) {
  return cfg.kind === 'anthropic'
    ? anthropicChat(history, system, onToken)
    : openaiChat(history, system, onToken);
}

// ---- OpenAI-compatible ----
async function openaiChat(history, system, onToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
  const body = {
    model: cfg.model,
    messages: [{ role: 'system', content: system }, ...packHistory(history, 3000)],
    stream: true,
    max_tokens: cfg.maxTokens || 1024,
  };
  if (cfg.temperature != null) body.temperature = cfg.temperature;
  if (cfg.top_p != null) body.top_p = cfg.top_p;
  if (cfg.thinking != null) body.chat_template_kwargs = { enable_thinking: cfg.thinking };

  const res = await fetch(cfg.baseURL.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 120));

  let out = '';
  await readSSE(res.body, payload => {
    if (payload === '[DONE]') return;
    const d = JSON.parse(payload).choices?.[0]?.delta || {};
    if (d.reasoning_content) onToken(d.reasoning_content);
    if (d.content) { out += d.content; onToken(d.content); }
  });
  return out.trim();
}

// ---- Anthropic Messages ----
async function anthropicChat(history, system, onToken) {
  const res = await fetch(cfg.baseURL.replace(/\/$/, '') + '/v1/messages', {
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
      messages: forAnthropic(packHistory(history, 3000)),
    }),
  });
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 120));

  let out = '';
  await readSSE(res.body, payload => {
    const evt = JSON.parse(payload);
    if (evt.type === 'content_block_delta' && evt.delta?.text) {
      out += evt.delta.text; onToken(evt.delta.text);
    }
  });
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

// Lector SSE común: invoca fn con el texto tras cada 'data:'.
async function readSSE(stream, fn) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try { fn(payload); } catch { /* chunk parcial */ }
    }
  }
}

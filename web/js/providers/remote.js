// Modelo potente en el servidor: llama.cpp (llama-server) detrás de /v1
// (API OpenAI-compatible con streaming SSE). En producción lo enruta nginx;
// en desarrollo, serve.py reenvía /v1 al servidor de producción.
import { REMOTE } from '../model-config.js';
import { packHistory } from '../context.js';

export const name = REMOTE.label;

export async function load(onProgress = () => {}) {
  onProgress('Conectando con el servidor de modelos…');
  const res = await fetch('/v1/models', { signal: AbortSignal.timeout(6000) })
    .catch(e => { throw new Error('servidor de modelos inalcanzable (' + e.message + ')'); });
  if (!res.ok) throw new Error('el servidor de modelos responde HTTP ' + res.status);
}

export async function chat(history, system, onToken = () => {}) {
  const res = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: REMOTE.model,
      // ACE-lite: ctx del servidor = 4096 y generación hasta 1536 → el
      // historial entra con presupuesto de ~2200 tokens por relevancia.
      messages: [{ role: 'system', content: system }, ...packHistory(history, 2200)],
      stream: true,
      temperature: REMOTE.temperature,  // Ornith entra en bucles con temp baja
      top_p: REMOTE.top_p,
      max_tokens: REMOTE.maxTokens,
      chat_template_kwargs: { enable_thinking: REMOTE.thinking },
    }),
  });
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = '', buf = '';
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
      if (payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta || {};
        // Ornith es razonador: el pensamiento llega en reasoning_content.
        // Lo mostramos en vivo (burbuja) pero NO forma parte de la respuesta.
        if (delta.reasoning_content) onToken(delta.reasoning_content);
        if (delta.content) { out += delta.content; onToken(delta.content); }
      } catch { /* chunk parcial: se completa en la siguiente lectura */ }
    }
  }
  return out.trim();
}

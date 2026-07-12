// Navegación: fetch directo si el sitio lo permite (CORS); si no, cae al
// proxy del servidor (/proxy?url=…) que sirve server/serve.py o el nginx
// de producción.
import { require as requirePerm } from '../permissions.js';

const MAX = 8000; // caracteres devueltos al agente

function toText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,svg,iframe').forEach(n => n.remove());
  const text = (doc.body?.innerText || doc.body?.textContent || '')
    .replace(/\n{3,}/g, '\n\n').trim();
  return text || html.slice(0, MAX);
}

export async function fetchUrl({ url } = {}) {
  if (!/^https?:\/\//.test(url || '')) throw new Error('URL inválida (usa https://…)');
  await requirePerm('web', url);
  let lastErr;
  for (const target of [url, '/proxy?url=' + encodeURIComponent(url)]) {
    try {
      const res = await fetch(target);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = toText(await res.text());
      return `[${url}]\n` + (text.length > MAX ? text.slice(0, MAX) + '\n… (recortado)' : text);
    } catch (e) { lastErr = e; }
  }
  throw new Error(`No pude acceder a ${url} (${lastErr?.message}). ` +
    'Los sitios sin CORS necesitan el proxy: arranca server/serve.py o usa el deploy.');
}

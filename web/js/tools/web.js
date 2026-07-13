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

// GET a través del proxy CORS del servidor (o directo si el sitio lo permite).
async function proxyGet(url) {
  let lastErr;
  for (const target of [url, '/proxy?url=' + encodeURIComponent(url)]) {
    try {
      const res = await fetch(target);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('sin respuesta');
}

export async function fetchUrl({ url } = {}) {
  if (!/^https?:\/\//.test(url || '')) throw new Error('URL inválida (usa https://…)');
  await requirePerm('web', url);
  const text = toText(await proxyGet(url));
  return `[${url}]\n` + (text.length > MAX ? text.slice(0, MAX) + '\n… (recortado)' : text);
}

// Búsqueda web REAL. Parseo TOLERANTE (independiente de clases): DuckDuckGo
// envuelve cada resultado en un enlace con ?uddg=<url real>. Buscamos esos.
export async function search({ query } = {}) {
  if (!query) throw new Error('Falta query');
  await requirePerm('web', 'buscar: ' + query);
  let html = '';
  for (const ep of ['https://html.duckduckgo.com/html/?q=', 'https://lite.duckduckgo.com/lite/?q=']) {
    try { html = await proxyGet(ep + encodeURIComponent(query)); if (html.includes('uddg=') || html.includes('result')) break; }
    catch { /* siguiente endpoint */ }
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const seen = new Set(), out = [];
  for (const a of doc.querySelectorAll('a[href*="uddg="]')) {
    const m = a.getAttribute('href').match(/uddg=([^&]+)/);
    if (!m) continue;
    const href = decodeURIComponent(m[1]);
    const title = a.textContent.trim();
    if (!title || title.length < 3 || seen.has(href)) continue;
    seen.add(href);
    // fragmento: el texto del contenedor del resultado, sin el título
    const block = a.closest('tr, div, article') || a.parentElement;
    const snip = (block?.textContent || '').replace(title, '').replace(/\s+/g, ' ').trim().slice(0, 160);
    out.push(`• ${title}\n  ${href}${snip ? '\n  ' + snip : ''}`);
    if (out.length >= 8) break;
  }
  return out.length ? `Resultados para «${query}»:\n\n` + out.join('\n\n') : `Sin resultados para «${query}».`;
}

// Búsqueda de IMÁGENES (Openverse, CC) → URLs para montar una galería.
export async function images({ query } = {}) {
  if (!query) throw new Error('Falta query');
  await requirePerm('web', 'imágenes: ' + query);
  const raw = await proxyGet('https://api.openverse.org/v1/images/?q=' + encodeURIComponent(query) + '&page_size=12');
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('respuesta inesperada del buscador de imágenes'); }
  const imgs = (data.results || []).map(r => ({ url: r.url, thumb: r.thumbnail || r.url, title: (r.title || '').slice(0, 60), by: r.creator || '' }))
    .filter(i => i.url);
  if (!imgs.length) return `Sin imágenes para «${query}».`;
  return JSON.stringify({ query, images: imgs });
}

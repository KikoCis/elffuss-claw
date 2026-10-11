// Navegación: fetch directo si el sitio lo permite (CORS); si no, cae al
// proxy del servidor (/proxy?url=…) que sirve server/serve.py o el nginx
// de producción.
//
// Cada herramienta recibe la señal de parada del turno ({ signal }, ver
// tools/index.js): con ■, la descarga en curso se corta en vez de seguir por
// detrás hasta el final.
import { require as requirePerm } from '../permissions.js';
import { t } from '../i18n.js';

const MAX = 8000; // caracteres devueltos al agente

function toText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,svg,iframe').forEach(n => n.remove());
  const text = (doc.body?.innerText || doc.body?.textContent || '')
    .replace(/\n{3,}/g, '\n\n').trim();
  return text || html.slice(0, MAX);
}

const parado = (e, signal) => signal?.aborted || e?.name === 'AbortError';
const hostDe = url => { try { return new URL(url).host; } catch { return url; } };

// Lee una URL: directa si el sitio permite CORS y, si no, por el proxy del
// servidor. Cuando las dos fallan, el error dice POR QUÉ. En especial si el
// proxy no existe en este servidor (404): antes salía «HTTP 404» a secas, que
// se lee como «esa página no existe», y la búsqueda lo convertía en «Sin
// resultados», como si internet no tuviera nada que decir. Así estuvo
// producción semanas sin que nadie lo notara.
//
// Y sin decir más de lo que se sabe. Si el sitio contestó al fetch directo (con
// CORS el navegador deja ver su estado), lo que importa es lo que dijo: su 404
// es que la página no existe, haya proxy o no. Si el fetch directo falló sin
// respuesta, desde el navegador no se distingue un sitio sin CORS de uno que no
// existe o no resuelve: se dicen las dos cosas y no se afirma que la página
// exista. (Lo mismo que la copia de Elffuss Code.)
async function proxyGet(url, { signal } = {}) {
  let directo, estado = 0;
  try {
    const r = await fetch(url, { signal });
    if (r.ok) return await r.text();
    estado = r.status; directo = new Error('HTTP ' + r.status);
  } catch (e) {
    if (parado(e, signal)) throw e;   // ■: no se prueba el proxy
    directo = e;
  }
  if (estado === 404 || estado === 410) throw new Error(t('webGone', { url, status: estado }));
  let r;
  try { r = await fetch('/proxy?url=' + encodeURIComponent(url), { signal }); }
  catch (e) {
    if (parado(e, signal)) throw e;
    throw new Error(t('webBoth', { host: hostDe(url), direct: directo?.message || t('webNoAnswer'), proxy: e?.message || t('webNoAnswer') }));
  }
  if (r.ok) return await r.text();
  if (r.status === 404 || r.status === 405 || r.status === 501) {
    const e = new Error(estado
      ? t('webNoProxyStatus', { host: hostDe(url), status: estado, proxy: r.status })
      : t('webNoProxy', { host: hostDe(url), proxy: r.status }));
    e.sinProxy = true;
    throw e;
  }
  throw new Error(t('webBoth', { host: hostDe(url), direct: directo?.message || t('webNoAnswer'), proxy: 'HTTP ' + r.status }));
}

export async function fetchUrl({ url } = {}, { signal } = {}) {
  if (!/^https?:\/\//.test(url || '')) throw new Error(t('webBadUrl'));
  await requirePerm('web', url);
  const text = toText(await proxyGet(url, { signal }));
  return `[${url}]\n` + (text.length > MAX ? text.slice(0, MAX) + '\n' + t('cutMark') : text);
}

// Búsqueda web REAL. Parseo TOLERANTE (independiente de clases): DuckDuckGo
// envuelve cada resultado en un enlace con ?uddg=<url real>. Buscamos esos.
// Si ningún buscador contesta se dice por qué, en vez de «Sin resultados» (que
// solo vale cuando el buscador SÍ contestó y no encontró nada). Y la página de
// verificación anti-bot de DuckDuckGo no es una lista vacía: es un bloqueo.
const BLOQUEO_DDG = /anomaly|unusual traffic|are you a human|bots use duckduckgo/i;
export async function search({ query } = {}, { signal } = {}) {
  if (!query) throw new Error(t('webNoQuery'));
  await requirePerm('web', t('pdWebSearch', { q: query }));
  let html = '', ultimoError = null, bloqueado = false;
  for (const ep of ['https://html.duckduckgo.com/html/?q=', 'https://lite.duckduckgo.com/lite/?q=']) {
    try {
      const h = await proxyGet(ep + encodeURIComponent(query), { signal });
      if (!h.includes('uddg=') && BLOQUEO_DDG.test(h)) { bloqueado = true; continue; }
      html = h;
      if (html.includes('uddg=') || html.includes('result')) break;
    } catch (e) {
      if (parado(e, signal)) throw e;
      ultimoError = e;
    }
  }
  if (!html) {
    if (bloqueado) throw new Error(t('webSearchBlocked', { q: query }));
    throw ultimoError || new Error(t('webSearchFailed', { q: query }));
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
  return out.length ? t('webResults', { q: query }) + '\n\n' + out.join('\n\n') : t('webNoResults', { q: query });
}

// Búsqueda de IMÁGENES (Openverse, CC) → URLs para montar una galería.
export async function images({ query } = {}, { signal } = {}) {
  if (!query) throw new Error(t('webNoQuery'));
  await requirePerm('web', t('pdWebImages', { q: query }));
  const raw = await proxyGet('https://api.openverse.org/v1/images/?q=' + encodeURIComponent(query) + '&page_size=12', { signal });
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(t('webImagesBad')); }
  const imgs = (data.results || []).map(r => ({ url: r.url, thumb: r.thumbnail || r.url, title: (r.title || '').slice(0, 60), by: r.creator || '' }))
    .filter(i => i.url);
  if (!imgs.length) return t('webNoImages', { q: query });
  return JSON.stringify({ query, images: imgs });
}

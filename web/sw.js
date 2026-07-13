// Service worker de caché de MODELOS. El problema: los pesos (Gemma ~4 GB por
// LiteRT, o el heal ONNX ~850 MB) vienen del CDN de HuggingFace y Chrome NO los
// guarda en su caché HTTP (hay un tope por recurso) → se re-descargan cada vez.
//
// Solución agnóstica: interceptamos las peticiones de ficheros de modelo y las
// servimos «cache-first» desde Cache Storage (sin tope de tamaño, y NO evictable
// si la web pide almacenamiento persistente). Funciona sea cual sea la librería
// que descargue (transformers.js, LiteRT-LM o su WASM), porque va por red.
//
// Range requests: si la librería pide un rango de bytes, lo servimos cortando el
// blob cacheado (slice O(1), respaldado en disco) — sin cargar los GB en RAM.
const CACHE = 'elffuss-models-v1';

// ¿es un fichero de modelo que vale la pena cachear? (hosts de HuggingFace +
// extensiones de peso). Todo lo demás pasa de largo sin tocarlo.
function isModel(url) {
  return /huggingface\.co|\.hf\.co|cdn-lfs|hf\.co/i.test(url)
    || /\.(onnx|onnx_data|litertlm|task|gguf|tflite|bin|wasm|data)(\?|$)/i.test(url);
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('message', e => {
  if (e.data === 'clear-models') caches.delete(CACHE).then(() => e.source && e.source.postMessage('models-cleared'));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !isModel(req.url)) return;   // no tocar el resto
  event.respondWith(serve(req));
});

async function serve(req) {
  const cache = await caches.open(CACHE);
  const key = new Request(req.url, { method: 'GET' });      // clave por URL, sin el header Range
  const range = req.headers.get('range');
  let full = await cache.match(key);

  if (!full) {
    // Descarga el recurso COMPLETO una vez (sin Range) y lo cachea. Aunque el
    // cliente pidiera un rango, bajamos el fichero entero → 1 descarga y ya.
    try {
      const resp = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
      if (resp && resp.status === 200) { await cache.put(key, resp.clone()); full = resp; }
      else return resp || fetch(req);                       // no cacheable → tal cual
    } catch (e) {
      const hit = await cache.match(key);                   // sin red: último recurso
      if (hit) full = hit; else throw e;
    }
  }

  if (!range) return full;
  // servir el rango pedido desde el blob cacheado
  const blob = await full.blob();
  const m = /bytes=(\d+)-(\d*)/.exec(range);
  const start = m ? +m[1] : 0;
  const end = m && m[2] !== '' ? Math.min(+m[2], blob.size - 1) : blob.size - 1;
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Range': `bytes ${start}-${end}/${blob.size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      'Content-Type': full.headers.get('Content-Type') || 'application/octet-stream',
    },
  });
}

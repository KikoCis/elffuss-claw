// Elffuss Runtime · SDK de la caché compartida de modelos.
// ─────────────────────────────────────────────────────────────────────────────
// Embebe un iframe oculto al BROKER (origen compartido de Elffuss) y le pide los
// modelos por postMessage. Como el broker vive en un subdominio de utopiaia.com
// —igual que todas las webs de Elffuss (mismo «site»)—, comparte UNA sola OPFS:
// el modelo se descarga UNA vez y se reutiliza en claw/translator/copilot/code…
// Si el broker no está disponible, el llamador cae a su OPFS local (model-store).
export const BROKER_URL = 'https://models.elffuss.utopiaia.com/';

let _iframe = null, _ready = null, _seq = 0, _url = BROKER_URL;

function ensure(brokerURL) {
  if (_iframe) return _ready;
  _url = brokerURL;
  _iframe = document.createElement('iframe');
  _iframe.src = brokerURL; _iframe.setAttribute('aria-hidden', 'true');
  _iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;left:-9999px;visibility:hidden';
  _ready = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('broker timeout')), 8000);
    const h = e => { if (e.source === _iframe.contentWindow && e.data?.kind === 'elffuss-broker-ready') { clearTimeout(to); removeEventListener('message', h); resolve(); } };
    addEventListener('message', h);
    _iframe.addEventListener('error', () => { clearTimeout(to); reject(new Error('broker no cargó')); });
  });
  (document.body || document.documentElement).appendChild(_iframe);
  return _ready;
}
const origin = () => new URL(_url).origin;

// Modelo como Blob (el navegador lo respalda en disco), desde la caché compartida.
// Descarga una vez para TODO Elffuss; el resto de webs lo leen sin red.
export async function getSharedModel(url, onProgress = () => {}, brokerURL = BROKER_URL) {
  await ensure(brokerURL);
  return new Promise((resolve, reject) => {
    const id = ++_seq;
    const h = e => {
      if (e.source !== _iframe.contentWindow || e.data?.id !== id) return;
      const m = e.data;
      if (m.kind === 'progress') onProgress(m);
      // El broker devuelve un File respaldado en disco (structured-clone por
      // referencia): no copia los GB a RAM. Se lee con .stream() al subirlo a GPU.
      else if (m.kind === 'file') { removeEventListener('message', h); resolve(m.file); }
      else if (m.kind === 'error') { removeEventListener('message', h); reject(new Error(m.message)); }
    };
    addEventListener('message', h);
    _iframe.contentWindow.postMessage({ type: 'elffuss-model-get', id, url }, origin());
  });
}

// ¿ya está en la caché compartida? (para la UI: «cargando desde caché, sin bajar»)
export async function isSharedCached(url, brokerURL = BROKER_URL) {
  try { await ensure(brokerURL); } catch { return false; }
  return new Promise(resolve => {
    const id = ++_seq; const to = setTimeout(() => { removeEventListener('message', h); resolve(false); }, 4000);
    const h = e => { if (e.source !== _iframe.contentWindow || e.data?.id !== id) return; if (e.data.kind === 'has') { clearTimeout(to); removeEventListener('message', h); resolve(!!e.data.cached); } };
    addEventListener('message', h);
    _iframe.contentWindow.postMessage({ type: 'elffuss-model-has', id, url }, origin());
  });
}

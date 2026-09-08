// Elffuss Runtime · SDK de la caché compartida de modelos.
// ─────────────────────────────────────────────────────────────────────────────
// Embebe un iframe oculto al BROKER (origen compartido de Elffuss) y le pide los
// modelos por postMessage. Como el broker vive en un subdominio de utopiaia.com
// —igual que todas las webs de Elffuss (mismo «site»)—, comparte UNA sola OPFS:
// el modelo se descarga UNA vez y se reutiliza en claw/translator/copilot/code…
// Si el broker no está disponible, el llamador cae a su OPFS local (model-store).
export const BROKER_URL = 'https://models.elffuss.utopiaia.com/';

// Un iframe POR ORIGEN. La maquinaria está, pero OJO con para qué sirve, porque
// medirlo costó una tarde y el resultado no es el que parecía.
//
// MEDIDO con el registro del servidor —no con tiempos, que engañan porque la
// caché HTTP los imita—: se guarda desde un sitio y se lee desde otro, y se
// cuentan las peticiones REALES que llegan a nginx.
//
//   broker models  → 1 petición   · leer desde el otro sitio: 7 ms, CERO
//                                   peticiones nuevas. COMPARTE.
//   broker m1      → 2 peticiones · leer desde el otro sitio se lo vuelve a
//                                   bajar entero. NO comparte.
//
// Mismo sitio (utopiaia.com), mismas cabeceras, misma página de broker. La
// diferencia es real y reproducible; la CAUSA sigue sin explicar. No confundir
// «no explicado» con «no medido»: esto está medido con el testigo bueno.
//
// Consecuencia práctica, y es una disyuntiva de verdad:
//   · compartir entre sitios → un solo origen de broker (models), una sola cuota.
//   · multiplicar la cuota   → repartir entre orígenes, y cada sitio se lo baja.
// Hoy no se pueden las dos. Para modelos por debajo del techo (~7 GB) compensa
// compartir; por encima, repartir y pagar la descarga por sitio.
const _brokers = new Map();          // origen → { iframe, ready }
let _seq = 0;

function ensure(brokerURL) {
  const clave = new URL(brokerURL).origin;
  const ya = _brokers.get(clave);
  if (ya) return ya.ready;
  const entrada = {};
  _brokers.set(clave, entrada);
  return _ensureNuevo(brokerURL, entrada);
}

function _ensureNuevo(brokerURL, entrada) {
  let _iframe = null, _ready = null;
  const _url = brokerURL;
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
  entrada.iframe = _iframe;
  entrada.ready = _ready;
  return _ready;
}
const origin = url => new URL(url).origin;
const ventana = url => _brokers.get(new URL(url).origin)?.iframe?.contentWindow;

// Modelo como Blob (el navegador lo respalda en disco), desde la caché compartida.
// Descarga una vez para TODO Elffuss; el resto de webs lo leen sin red.
export async function getSharedModel(url, onProgress = () => {}, brokerURL = null) {
  // Por defecto el broker es el ORIGEN DEL PROPIO FICHERO: así cada trozo lo
  // guarda quien lo sirve, la petición es del mismo origen (sin CORS) y el
  // trozo ocupa la cuota de ESE subdominio, que es lo que multiplica el techo.
  brokerURL = brokerURL || (origin(url) + '/');
  await ensure(brokerURL);
  return new Promise((resolve, reject) => {
    const id = ++_seq;
    // Timeout por INACTIVIDAD: sin CUALQUIER mensaje del broker (progreso/file/
    // error) en IDLE ms, la carga está colgada → rechazar para caer a OPFS local.
    // No es un tope total (una descarga real tarda minutos): cada mensaje del
    // broker reinicia el reloj, así que solo salta si el broker enmudece de verdad.
    const IDLE = 30000;
    let timer;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { removeEventListener('message', h); reject(new Error('broker sin respuesta (timeout de inactividad)')); }, IDLE); };
    const done = fn => (...a) => { clearTimeout(timer); removeEventListener('message', h); fn(...a); };
    const h = e => {
      if (e.source !== ventana(brokerURL) || e.data?.id !== id) return;
      const m = e.data;
      arm();                                    // cualquier señal del broker reinicia el reloj
      if (m.kind === 'progress') onProgress(m);
      // El broker devuelve un File respaldado en disco (structured-clone por
      // referencia): no copia los GB a RAM. Se lee con .stream() al subirlo a GPU.
      else if (m.kind === 'file') done(resolve)(m.file);
      else if (m.kind === 'error') done(reject)(new Error(m.message));
    };
    addEventListener('message', h);
    arm();
    ventana(brokerURL).postMessage({ type: 'elffuss-model-get', id, url }, origin(brokerURL));
  });
}

// ¿ya está en la caché compartida? (para la UI: «cargando desde caché, sin bajar»)
export async function isSharedCached(url, brokerURL = null) {
  brokerURL = brokerURL || (origin(url) + '/');
  try { await ensure(brokerURL); } catch { return false; }
  return new Promise(resolve => {
    const id = ++_seq; const to = setTimeout(() => { removeEventListener('message', h); resolve(false); }, 4000);
    const h = e => { if (e.source !== ventana(brokerURL) || e.data?.id !== id) return; if (e.data.kind === 'has') { clearTimeout(to); removeEventListener('message', h); resolve(!!e.data.cached); } };
    addEventListener('message', h);
    ventana(brokerURL).postMessage({ type: 'elffuss-model-has', id, url }, origin(brokerURL));
  });
}

// Service worker INERTE (a propósito).
//
// Antes cacheaba ficheros de modelo interceptando las peticiones a HuggingFace,
// pero eso ROMPÍA la carga del ONNX: el fichero de pesos externos
// `model_q4.onnx_data` fallaba con ERR_FAILED al re-fetchearlo → el modelo no
// cargaba. Resultó que el SW era INNECESARIO: el cacheo ya lo hacen
//   - transformers.js con su propia Cache Storage (modelo ONNX «healed»), y
//   - litert.js con blob cache-first en Cache Storage (Gemma .litertlm),
// y `navigator.storage.persist()` evita que el navegador los desaloje.
//
// Así que este SW ya NO intercepta nada (el navegador gestiona todas las
// peticiones de forma nativa). Se mantiene registrado solo para REEMPLAZAR
// limpiamente al SW anterior que sí interceptaba y rompía la carga.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Permite vaciar la caché de modelos desde Ajustes (sin tocar el blob de Gemma
// salvo que se pida). NO hay handler de 'fetch' → cero interceptación.
self.addEventListener('message', e => {
  if (e.data === 'clear-models') {
    caches.delete('elffuss-models-v1').then(() => e.source && e.source.postMessage('models-cleared'));
  }
});

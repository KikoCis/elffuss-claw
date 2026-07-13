// Arranque de la caché de modelos: (1) pide almacenamiento PERSISTENTE para que
// el navegador no desaloje los pesos cacheados, y (2) registra el service worker
// (sw.js) y espera a que CONTROLE la página antes de descargar nada — así hasta
// la primera descarga queda cacheada. Idempotente y a prueba de fallos.
let started = null;

export function ensureModelCache() {
  if (started) return started;
  started = (async () => {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        const ok = persisted || await navigator.storage.persist();
        console.log('[elffuss] almacenamiento persistente:', ok);
      }
    } catch { /* no soportado */ }

    if (!('serviceWorker' in navigator)) return false;
    try {
      await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise(res => {
          const t = setTimeout(res, 1500);
          navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); res(); }, { once: true });
        });
      }
      console.log('[elffuss] caché de modelos activa (service worker)');
      return true;
    } catch (e) {
      console.warn('[elffuss] service worker no disponible:', e.message);
      return false;
    }
  })();
  return started;
}

// Espacio ocupado por la caché (para mostrarlo en Ajustes).
export async function cacheEstimate() {
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage || 0, quota: e.quota || 0, persisted: navigator.storage.persisted ? await navigator.storage.persisted() : false };
  } catch { return { usage: 0, quota: 0, persisted: false }; }
}

// Vaciar la caché de modelos (botón en Ajustes).
export async function clearModelCache() {
  if (navigator.serviceWorker && navigator.serviceWorker.controller)
    navigator.serviceWorker.controller.postMessage('clear-models');
  try { await caches.delete('elffuss-models-v1'); } catch { /* */ }
}

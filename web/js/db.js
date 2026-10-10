// IndexedDB mínima: stores clave→valor.
const NAME = 'elffuss', VERSION = 2;
const STORES = ['kv', 'apps', 'tasks', 'vault', 'fs', 'memory'];
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      for (const s of STORES)
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

// Leer-modificar-escribir en UNA transacción: entre la lectura y la escritura
// nadie más puede escribir esa clave (IndexedDB ejecuta las transacciones de
// escritura sobre un mismo almacén una detrás de otra, también entre pestañas).
// `fn(actual)` devuelve el valor nuevo, o undefined para no escribir nada. La
// promesa se resuelve con lo que devolvió `fn`, cuando la transacción termina.
export const update = (store, key, fn) => open().then(db => new Promise((resolve, reject) => {
  const t = db.transaction(store, 'readwrite');
  const s = t.objectStore(store);
  let nuevo;
  const req = s.get(key);
  req.onsuccess = () => {
    try { nuevo = fn(req.result); } catch (e) { t.abort(); reject(e); return; }
    if (nuevo !== undefined) s.put(nuevo, key);
  };
  t.oncomplete = () => resolve(nuevo);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error || new Error('transacción abortada'));
}));

export const get  = (store, key)      => tx(store, 'readonly',  s => s.get(key));
export const set  = (store, key, val) => tx(store, 'readwrite', s => s.put(val, key));
export const del  = (store, key)      => tx(store, 'readwrite', s => s.delete(key));
export const keys = (store)           => tx(store, 'readonly',  s => s.getAllKeys());
export const all  = (store)           => tx(store, 'readonly',  s => s.getAll());

// Elffuss Runtime · almacén de modelos en OPFS (persistente, en disco).
// ─────────────────────────────────────────────────────────────────────────────
// Sustituye a Cache Storage para los PESOS del modelo. Motivo real (bug de móvil):
// Cache Storage se desaloja en iOS/Android → el modelo se re-descargaba en CADA
// visita. OPFS (Origin Private File System) + navigator.storage.persist() aguanta
// entre sesiones y se lee como File respaldado por DISCO (no vuelca todo a RAM).
//
// Además es la capa de almacenamiento del loader por shards: el motor leerá los
// pesos por rangos desde el File sin cargar los gigabytes enteros en memoria.
//
// Licencia: código propio (Apache-2.0). Sin dependencias externas.

const DIR = 'elffuss-models';

// Nombre de fichero estable y seguro a partir de la URL (sin barras ni query).
function keyFor(url) {
  return String(url).replace(/[?#].*$/, '').replace(/[^\w.\-]+/g, '_').slice(-180);
}

async function requestPersist() {
  try {
    if (navigator.storage?.persist) {
      const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      return already || await navigator.storage.persist();
    }
  } catch { /* no bloquea */ }
  return false;
}

async function dirHandle() {
  const root = await navigator.storage.getDirectory();      // lanza si no hay OPFS
  return await root.getDirectoryHandle(DIR, { create: true });
}

// ¿Hay soporte para escribir en OPFS de forma útil en este navegador?
// Chrome/escritorio: createWritable (stream a disco). iOS Safari: solo
// createSyncAccessHandle (en worker) → en este primer incremento, si no hay
// createWritable en el hilo principal, devolvemos null y el llamador cae a Cache.
async function opfsWritableSupported(dir) {
  try {
    const test = await dir.getFileHandle('.probe', { create: true });
    if (typeof test.createWritable !== 'function') { await dir.removeEntry('.probe').catch(() => {}); return false; }
    const w = await test.createWritable();
    await w.close();
    await dir.removeEntry('.probe').catch(() => {});
    return true;
  } catch { return false; }
}

// Devuelve un File (respaldado en disco) del modelo. Descarga por chunks a OPFS
// la primera vez (con progreso real), lo sirve desde disco a partir de entonces.
// Un marcador «<key>.done» evita servir una descarga cortada a medias.
// Devuelve null si OPFS no está disponible/escribible → el llamador usa su
// respaldo (Cache Storage) sin romperse.
export async function getModelFile(url, onProgress = () => {}) {
  // 1) Caché COMPARTIDA (broker en origen Elffuss): un modelo bajado en CUALQUIER
  //    web de Elffuss se reutiliza aquí sin re-descargar. Fast-fail por sesión si
  //    el broker no está disponible → caemos a la OPFS local de este origen.
  let brokerDown = false;
  try { brokerDown = sessionStorage.getItem('elffuss.broker.down') === '1'; } catch { /* — */ }
  if (!brokerDown) {
    try {
      const { getSharedModel } = await import('./model-broker.js');
      const blob = await getSharedModel(url, onProgress);
      if (blob && blob.size) return blob;
    } catch { try { sessionStorage.setItem('elffuss.broker.down', '1'); } catch { /* — */ } }
  }

  if (!navigator.storage?.getDirectory) return null;
  let dir;
  try { dir = await dirHandle(); } catch { return null; }
  await requestPersist();

  const key = keyFor(url);
  const doneName = key + '.done';

  // ¿ya está entero en disco?
  try {
    await dir.getFileHandle(doneName);                       // lanza si no existe
    const f = await (await dir.getFileHandle(key)).getFile();
    if (f.size > 0) { onProgress('Cargando el modelo desde disco (OPFS, sin descargar)…'); return f; }
  } catch { /* no está o incompleto: se descarga */ }

  if (!(await opfsWritableSupported(dir))) return null;      // iOS main-thread: que decida el llamador

  // descargar → OPFS por chunks (no en RAM)
  const net = await fetch(url);
  if (!net.ok || !net.body) throw new Error('descarga del modelo falló: HTTP ' + net.status);
  const total = +net.headers.get('content-length') || 0;

  // limpiar restos de un intento previo cortado
  await dir.removeEntry(doneName).catch(() => {});
  const fh = await dir.getFileHandle(key, { create: true });
  const writable = await fh.createWritable();               // stream a disco
  const t0 = performance.now();
  let loaded = 0;
  try {
    const reader = net.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      loaded += value.byteLength;
      onProgress(fmt(loaded, total, t0));
    }
    await writable.close();
  } catch (e) {
    try { await writable.abort(); } catch { /* — */ }
    await dir.removeEntry(key).catch(() => {});             // no dejar basura a medias
    throw e;
  }

  // marcar completado (con el tamaño esperado, para validar en el futuro)
  const dh = await dir.getFileHandle(doneName, { create: true });
  const dw = await dh.createWritable();
  await dw.write(new TextEncoder().encode(JSON.stringify({ size: loaded, total })));
  await dw.close();

  return await (await dir.getFileHandle(key)).getFile();
}

// Abre un handle de lectura por rangos (para el loader por shards del motor):
// devuelve una función slice(offset, length) → Promise<ArrayBuffer> que lee del
// disco sin cargar el fichero entero. File.slice() es perezoso en disco.
export async function openRanged(url) {
  const file = await getModelFile(url);
  if (!file) return null;
  return {
    size: file.size,
    async slice(offset, length) { return await file.slice(offset, offset + length).arrayBuffer(); },
  };
}

// Borrar un modelo cacheado (para el «liberar espacio» de la UI).
export async function removeModel(url) {
  try {
    const dir = await dirHandle();
    const key = keyFor(url);
    await dir.removeEntry(key).catch(() => {});
    await dir.removeEntry(key + '.done').catch(() => {});
    return true;
  } catch { return false; }
}

// Borra TODOS los modelos guardados en OPFS.
// Existe porque el botón «liberar espacio» de Ajustes solo vaciaba Cache
// Storage: un modelo descargado por este almacén se quedaba ocupando disco sin
// forma de borrarlo desde la interfaz. Y como navigator.storage.estimate() SÍ
// lo cuenta, el usuario veía gigas que el botón no bajaba nunca.
export async function clearAll() {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(DIR, { recursive: true });
    return true;
  } catch { return false; }          // no existe o no hay OPFS: nada que borrar
}

// Bytes ocupados por los modelos en OPFS (aprox, para diagnóstico).
export async function usage() {
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage || 0, quota: est.quota || 0 };
  } catch { return { usage: 0, quota: 0 }; }
}

function fmt(loaded, total, t0) {
  const mb = n => (n / 1048576).toFixed(0);
  const secs = (performance.now() - t0) / 1000;
  const spd = secs > 0 ? (loaded / 1048576 / secs).toFixed(1) : '0';
  // Incluir el % cuando se conoce el total: el escaparate lo extrae para llenar
  // la barra, y el texto queda corto (no envuelve en móvil).
  return total
    ? `Descargando el cerebro · ${mb(loaded)}/${mb(total)} MB · ${Math.round(loaded / total * 100)}%`
    : `Descargando el cerebro · ${mb(loaded)} MB · ${spd} MB/s`;
}

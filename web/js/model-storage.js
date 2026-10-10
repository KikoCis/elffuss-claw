// Cuánto ocupan los MODELOS (no el origen entero) y cómo vaciarlos TODOS.
// ─────────────────────────────────────────────────────────────────────────────
// Dos cosas mentían:
//   · El chip 💾 enseñaba navigator.storage.estimate().usage —el origen ENTERO:
//     apps, conversación, IndexedDB…— rotulado «Modelos guardados». Con solo
//     datos tuyos decía «💾 0 MB … pulsa para vaciarlo», y vaciarlo no bajaba la
//     cifra porque tus datos no son modelos.
//   · «Vaciar caché del modelo» borraba la caché de ESTE origen y, como mucho, el
//     broker por defecto: el modelo grande vive troceado en los brokers de sus
//     propios hosts (m1, m2…) y ahí no se tocaba.
//
// Aquí se cuenta solo lo que son pesos —Cache Storage (aquí solo guardan
// modelos: LiteRT, transformers.js, WebLLM) y el almacén OPFS de modelos— más,
// si el SDK del broker sabe preguntarlo, el almacén compartido de CADA origen de
// broker que use algún modelo. Y se vacía todo eso, diciendo cuánto se liberó
// de verdad (medido antes y después), no cuánto se suponía.
import { clearModelCache } from './model-cache.js';
import * as broker from './runtime/model-broker.js';

const DIR_MODELOS = 'elffuss-models';   // el de runtime/model-store.js

// Orígenes de broker con pesos: los que dice el registro del motor (si está
// desplegado: llega por rsync) y el broker por defecto.
export async function origenesDeBroker() {
  const o = new Set([broker.BROKER_URL]);
  try {
    const r = await import('./engine/registro.js');
    for (const x of (r.origenesAlmacen?.() || [])) o.add(x);
  } catch { /* sin motor: solo el broker por defecto */ }
  return [...o];
}

// Bytes de modelos en ESTE origen, contados fichero a fichero: lo que hay en
// Cache Storage (cada respuesta guardada) y en el OPFS de modelos.
//
// No se usa storage.estimate() aunque Chrome lo desglose por almacén: tras
// borrar una caché, su cifra tarda en bajar (medido: varios segundos después
// seguía contando lo borrado), y el chip volvía a decir «6 MB» de algo que ya
// no estaba. Contar lo que hay es exacto en el momento, y es barato: las
// respuestas guardadas traen su tamaño sin leer los datos.
export async function bytesLocales() {
  let total = 0;
  try {
    for (const n of await caches.keys()) {
      const c = await caches.open(n);
      for (const req of await c.keys()) {
        const res = await c.match(req);
        if (!res) continue;
        const largo = +(res.headers.get('content-length') || 0);
        total += largo || (await res.blob()).size;
      }
    }
  } catch { /* sin Cache Storage */ }
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIR_MODELOS);
    for await (const f of dir.values()) if (f.kind === 'file') total += (await f.getFile()).size;
  } catch { /* sin OPFS o sin modelos en él */ }
  return total;
}

// { local, compartido, compartidoOk, total }. `compartidoOk` en false significa
// «no se pudo preguntar»: la cifra puede quedarse corta, y quien la enseñe lo dice.
export async function medir() {
  const local = await bytesLocales();
  let compartido = 0, compartidoOk = false, hayCompartido = false;
  if (typeof broker.sharedUsage === 'function') {
    hayCompartido = true;
    try {
      const r = await broker.sharedUsage(await origenesDeBroker());
      compartido = r?.usage || 0;
      compartidoOk = !!r?.ok;
    } catch { compartidoOk = false; }
  }
  return { local, compartido, compartidoOk, hayCompartido, total: local + compartido };
}

// Vacía los modelos de este origen (todas sus cachés y el OPFS de modelos) y el
// almacén compartido de cada broker. Tus datos (IndexedDB) no se tocan.
export async function vaciar() {
  const antes = await bytesLocales();
  await clearModelCache();
  try { for (const n of await caches.keys()) await caches.delete(n); } catch { /* — */ }
  const despues = await bytesLocales();
  let liberadoCompartido = 0, compartidoOk = true, hayCompartido = false;
  if (typeof broker.clearShared === 'function') {
    hayCompartido = true;
    for (const o of await origenesDeBroker()) {
      try {
        const r = await broker.clearShared(o);
        liberadoCompartido += r?.liberado || 0;
        if (!r?.ok) compartidoOk = false;
      } catch { compartidoOk = false; }
    }
  }
  return { liberado: Math.max(0, antes - despues) + liberadoCompartido, compartidoOk, hayCompartido };
}

// Automatizaciones entre carpetas: «pones un fichero en una carpeta y Elffuss
// lo coge, lo procesa y te lo deja en otra» 😉
//
// fs.watch registra una vigilancia persistente (IndexedDB). Un poller (cada
// POLL_MS, mientras la pestaña esté abierta) re-lista la carpeta de origen y
// procesa lo nuevo: .xlsx/.xls → .csv (SheetJS); el resto se copia tal cual.
// Los ya procesados se recuerdan por nombre+mtime (re-dejar un archivo
// modificado lo reprocesa).
import * as db from '../db.js';
import { require as requirePerm } from '../permissions.js';
import { t } from '../i18n.js';
import { root, xlsxToCsv, globToRegex } from './fs.js';

const KEY = 'automations';
const POLL_MS = 8000;

const getAll = async () => (await db.get('kv', KEY)) || [];
// Toda escritura de la lista es leer-modificar-escribir en UNA transacción
// (db.update): añadir, quitar y apuntar lo procesado ya no pueden pisarse.
const cambiar = fn => db.update('kv', KEY, list => fn(Array.isArray(list) ? list : []));

export async function add({ from, to, pattern = '*' } = {}) {
  if (!from || !to) throw new Error(t('fsMissingFromTo'));
  await requirePerm('fs', t('pdWatch', { from, to }));
  await root(from); await root(to); // valida que existen y hay acceso
  const id = 'w' + Math.random().toString(36).slice(2, 8);
  await cambiar(list => [...list, { id, from, to, pattern, seen: {} }]);
  return t('watchActive', { id, from, to, pattern });
}

export async function listWatches() {
  const list = await getAll();
  return list.length
    ? list.map(w => `👁 ${w.id} · ${w.from} → ${w.to} (${w.pattern}) · ` + t('watchSeen', { n: Object.keys(w.seen).length })).join('\n')
    : t('watchNone');
}

export async function removeWatch({ id } = {}) {
  await cambiar(list => list.filter(w => w.id !== id));
  return t('watchRemovedTool', { id });
}

export async function allWatches() { return getAll(); }

async function processFile(entry, dstDir) {
  const file = await entry.getFile();
  if (/\.xlsx?$/i.test(entry.name)) {
    const { csv } = await xlsxToCsv(file);
    const outName = entry.name.replace(/\.xlsx?$/i, '.csv');
    const fh = await dstDir.getFileHandle(outName, { create: true });
    const w = await fh.createWritable();
    await w.write(csv);
    await w.close();
    return outName;
  }
  const fh = await dstDir.getFileHandle(entry.name, { create: true });
  const w = await fh.createWritable();
  await w.write(await file.arrayBuffer());
  await w.close();
  return entry.name;
}

// El kernel lo arranca con un notificador (toast + mensaje en el chat). El
// segundo argumento lleva los datos (id, carpetas, fichero) para enlazarlos.
//
// Una pasada a la vez: si una tarda más que el intervalo (un Excel grande, una
// carpeta con muchos ficheros), la siguiente NO arranca encima. Antes podían
// solaparse dos: las dos procesaban el mismo fichero y las dos guardaban.
let pasando = false;
export function startWatcher(notify = () => {}) {
  setInterval(async () => {
    if (pasando) return;
    pasando = true;
    try { await pasada(notify); } finally { pasando = false; }
  }, POLL_MS);
}

async function pasada(notify) {
  let list;
  try { list = await getAll(); } catch { return; }
  if (!list.length) return;
  const procesados = new Map();   // id de la vigilancia → { fichero: mtime } de ESTA pasada
  for (const w of list) {
    try {
      const src = await root(w.from);
      const dst = await root(w.to);
      const rx = globToRegex(w.pattern);
      for await (const entry of src.values()) {
        if (entry.kind !== 'file' || !rx.test(entry.name)) continue;
        const mtime = (await entry.getFile()).lastModified;
        if (w.seen[entry.name] === mtime) continue;
        const outName = await processFile(entry, dst);
        w.seen[entry.name] = mtime;
        if (!procesados.has(w.id)) procesados.set(w.id, {});
        procesados.get(w.id)[entry.name] = mtime;
        notify(`✨ He cogido «${entry.name}» de ${w.from}, lo he procesado y te lo he dejado en ${w.to}/${outName}`,
          { id: w.id, from: w.from, to: w.to, fichero: entry.name, salida: outName });
      }
    } catch (e) {
      console.warn('[elffuss] automatización', w.id, e.message);
    }
  }
  if (!procesados.size) return;
  // Se guarda sobre la lista RELEÍDA, no sobre la del principio de la pasada.
  // Procesar puede tardar, y si mientras tanto quitabas una automatización,
  // guardar la lista vieja entera la RESUCITABA: volvía a aparecer y a vigilar.
  // Así solo se funden los ficheros vistos, y solo en las vigilancias que
  // siguen existiendo; las que se añadieron mientras tanto se quedan como están.
  // Releer y escribir van en la misma transacción: un borrado a medio camino
  // no puede colarse entre las dos.
  try {
    await cambiar(ahora => ahora.map(w => procesados.has(w.id)
      ? { ...w, seen: { ...(w.seen || {}), ...procesados.get(w.id) } } : w));
  } catch { /* sin guardar: la próxima pasada los vuelve a ver */ }
}

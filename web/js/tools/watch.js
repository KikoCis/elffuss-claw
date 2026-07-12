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
import { root, xlsxToCsv, globToRegex } from './fs.js';

const KEY = 'automations';
const POLL_MS = 8000;

const getAll = async () => (await db.get('kv', KEY)) || [];
const saveAll = list => db.set('kv', KEY, list);

export async function add({ from, to, pattern = '*' } = {}) {
  if (!from || !to) throw new Error('Faltan from y to (nombres de carpetas autorizadas)');
  await requirePerm('fs', `Vigilar «${from}» y dejar lo procesado en «${to}»`);
  await root(from); await root(to); // valida que existen y hay acceso
  const list = await getAll();
  const id = 'w' + Math.random().toString(36).slice(2, 8);
  list.push({ id, from, to, pattern, seen: {} });
  await saveAll(list);
  return `Automatización ${id} activa: lo que dejes en «${from}» (${pattern}) lo proceso y ` +
    `te lo dejo en «${to}» (Excel → CSV; el resto, copia). Funciona mientras Elffuss esté abierta.`;
}

export async function listWatches() {
  const list = await getAll();
  return list.length
    ? list.map(w => `👁 ${w.id} · ${w.from} → ${w.to} (${w.pattern}) · ${Object.keys(w.seen).length} procesados`).join('\n')
    : 'No hay automatizaciones. Prueba «vigila la carpeta entrada y deja lo procesado en salida».';
}

export async function removeWatch({ id } = {}) {
  await saveAll((await getAll()).filter(w => w.id !== id));
  return `Automatización ${id} eliminada.`;
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

// El kernel lo arranca con un notificador (toast + mensaje en el chat).
export function startWatcher(notify = () => {}) {
  setInterval(async () => {
    let list;
    try { list = await getAll(); } catch { return; }
    if (!list.length) return;
    let dirty = false;
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
          dirty = true;
          notify(`✨ He cogido «${entry.name}» de ${w.from}, lo he procesado y te lo he dejado en ${w.to}/${outName}`);
        }
      } catch (e) {
        console.warn('[elffuss] automatización', w.id, e.message);
      }
    }
    if (dirty) await saveAll(list).catch(() => {});
  }, POLL_MS);
}

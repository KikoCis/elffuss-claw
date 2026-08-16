// workspace.js — carpeta de trabajo, copia legible en disco e inventario.
//
// CORE compartido por Claw y Code. El módulo no sabe qué es una «app generada»
// ni una «conversación»: cada app le pasa un MANIFIESTO de almacenes y él sabe
// leerlos, medirlos, escribirlos a disco, reimportarlos y borrarlos.
//
// Por qué existe: todo vive en IndexedDB/localStorage, que el navegador puede
// desalojar (o el usuario borrar con «limpiar datos del sitio») sin avisar. Con
// una carpeta de trabajo, tu trabajo queda en ficheros normales que puedes ver,
// copiar y respaldar tú.
//
// Lo que NUNCA sale a disco en claro: el vault (secretos cifrados). Se marca
// `sensitive` en el manifiesto y se excluye salvo petición explícita.

const HANDLE_KEY = 'workspace-handle';
const ROOT = '.elffuss';

let cfg = null;             // { app, ns, db, stores }
let dirHandle = null;       // FileSystemDirectoryHandle de la carpeta de trabajo
let ready = false;          // permiso concedido AHORA
let dirty = new Set();
let listeners = [];
let lastSaveAt = null, lastError = null;
let autosaveCfg = { enabled: false, debounceMs: 3000 };
let autosaveTimer = null;

export function init({ app, ns, db, stores }) {
  cfg = { app, ns, db, stores: stores || [] };
}

export function supported() {
  return {
    pick: typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function',
    persist: !!(navigator.storage && navigator.storage.persist),
  };
}

const emit = () => { const s = statusSync(); listeners.forEach(f => { try { f(s); } catch { /* */ } }); };
export function onChange(fn) { listeners.push(fn); return () => { listeners = listeners.filter(f => f !== fn); }; }

function statusSync() {
  return {
    supported: supported(), folder: dirHandle ? dirHandle.name : null, ready,
    dirty: [...dirty], lastSaveAt, lastError, autosave: autosaveCfg.enabled,
  };
}
export function status() { return statusSync(); }

// ── carpeta de trabajo ───────────────────────────────────────────────────────
async function perm(handle, mode = 'readwrite') {
  if (!handle?.queryPermission) return true;              // OPFS u otros: dados
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return false;
}

// En el arranque: recupera el handle SIN pedir permiso ni abrir diálogos.
export async function restore() {
  if (!cfg) throw new Error('workspace.init() primero');
  let h = null;
  try { h = await cfg.db.get('kv', HANDLE_KEY); } catch { return null; }
  if (!h) return null;
  dirHandle = h;
  ready = await perm(h);
  emit();
  return { name: h.name, ready, reason: ready ? null : 'prompt' };
}

// Elegir carpeta (requiere gesto de usuario).
export async function pick() {
  if (!supported().pick) throw new Error('Este navegador no permite elegir una carpeta. Usa «Descargar copia» para guardar tu trabajo.');
  const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'elffuss-workspace', startIn: 'documents' });
  dirHandle = h;
  ready = true;
  await cfg.db.set('kv', HANDLE_KEY, h);
  emit();
  return { name: h.name, ready: true };
}

// Reutilizar un handle que la app ya tiene (Code: la carpeta del proyecto).
export async function adopt(handle) {
  if (!handle) throw new Error('sin handle');
  dirHandle = handle;
  ready = await perm(handle);
  await cfg.db.set('kv', HANDLE_KEY, handle);
  emit();
  return { name: handle.name, ready };
}

// Re-conceder permiso tras recargar (requiere gesto de usuario).
export async function regrant() {
  if (!dirHandle) throw new Error('no hay carpeta elegida');
  const ok = dirHandle.requestPermission
    ? (await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted'
    : true;
  ready = ok;
  emit();
  if (!ok) throw new Error('permiso denegado');
  return { name: dirHandle.name, ready: true };
}

export async function forget() {
  const name = dirHandle?.name || null;
  dirHandle = null; ready = false;
  try { await cfg.db.del('kv', HANDLE_KEY); } catch { /* */ }
  emit();
  return { forgot: name, deleted: false };   // nunca borra los ficheros del disco
}

export async function ensurePersistence() {
  if (!navigator.storage?.persist) return { persisted: false, asked: false };
  const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  if (already) return { persisted: true, asked: false };
  const got = await navigator.storage.persist().catch(() => false);
  return { persisted: got, asked: true };
}

// ── inventario: «ver qué hay» ────────────────────────────────────────────────
const sizeOf = v => { try { return new Blob([typeof v === 'string' ? v : JSON.stringify(v)]).size; } catch { return 0; } };

async function readStore(st) {
  if (st.kind === 'ls') {
    const items = [];
    for (const k of st.keys || []) {
      const v = localStorage.getItem(k);
      if (v != null) items.push({ key: k, value: v });
    }
    return items;
  }
  if (st.kind === 'idb-store') {                      // store entero (apps, tasks…)
    const [ks, vs] = await Promise.all([cfg.db.keys(st.store), cfg.db.all(st.store)]);
    return ks.map((k, i) => ({ key: String(k), value: vs[i] }));
  }
  // 'idb-key': una clave concreta dentro de kv (history, conversations, skills…)
  const v = await cfg.db.get(st.store || 'kv', st.key);
  if (v == null) return [];
  return Array.isArray(v) ? v.map((x, i) => ({ key: String(x.id ?? x.name ?? i), value: x })) : [{ key: st.key, value: v }];
}

export async function inventory() {
  const out = [];
  for (const st of cfg.stores) {
    let items = [];
    let err = null;
    try { items = await readStore(st); } catch (e) { err = e.message; }
    out.push({
      id: st.id, label: st.label, icon: st.icon || '•', sensitive: !!st.sensitive,
      count: items.length, bytes: items.reduce((a, b) => a + sizeOf(b.value), 0),
      note: st.note || '', error: err,
    });
  }
  return out;
}

export async function peek(id, { limit = 50 } = {}) {
  const st = cfg.stores.find(s => s.id === id);
  if (!st) throw new Error('almacén desconocido: ' + id);
  const items = await readStore(st);
  return {
    id, truncated: items.length > limit,
    items: items.slice(0, limit).map(it => ({
      key: it.key, bytes: sizeOf(it.value),
      preview: st.sensitive ? '(cifrado — no se muestra)'
        : (typeof it.value === 'string' ? it.value : JSON.stringify(it.value)).slice(0, 240),
    })),
  };
}

// Espacio real del origen, incluidas TODAS las caches (los modelos son GB).
export async function storageReport() {
  const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => ({})) : {};
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  const out = { usage: est.usage || 0, quota: est.quota || 0, persisted, caches: [] };
  if (typeof caches !== 'undefined') {
    for (const name of await caches.keys().catch(() => [])) {
      const c = await caches.open(name);
      const reqs = await c.keys();
      let bytes = 0;
      for (const r of reqs) {
        const res = await c.match(r);
        const len = +(res?.headers.get('content-length') || 0);
        bytes += len;
      }
      out.caches.push({ name, entries: reqs.length, bytes });
    }
  }
  return out;
}

// ── guardar en disco ─────────────────────────────────────────────────────────
export function touch(id) {
  dirty.add(id);
  emit();
  if (autosaveCfg.enabled) {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { save({ reason: 'auto' }).catch(() => {}); }, autosaveCfg.debounceMs);
  }
}

export function autosave({ enabled, debounceMs }) {
  autosaveCfg = { enabled: !!enabled, debounceMs: debounceMs || autosaveCfg.debounceMs };
  try { localStorage.setItem(cfg.ns + '.workspace.autosave', enabled ? '1' : '0'); } catch { /* */ }
  emit();
  return autosaveCfg;
}
export function autosaveEnabled() {
  try { return localStorage.getItem(cfg.ns + '.workspace.autosave') === '1'; } catch { return false; }
}

async function dirFor(path) {                 // crea .elffuss/<app>/<sub> y devuelve el handle
  let d = dirHandle;
  for (const part of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part, { create: true });
  return d;
}
async function writeFile(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}
const safeName = s => String(s).replace(/[^\w.\-]+/g, '_').slice(0, 60) || 'item';

export async function save({ only = null, reason = 'manual' } = {}) {
  if (!dirHandle) throw new Error('no-folder');
  if (!(await perm(dirHandle))) { ready = false; emit(); throw new Error('needs-regrant'); }
  const targets = cfg.stores.filter(st => !st.sensitive && (only ? only.includes(st.id) : true));
  const wrote = [], errors = [];
  for (const st of targets) {
    try {
      const items = await readStore(st);
      const base = `${ROOT}/${cfg.app}/${st.id}`;
      if (st.files) {                              // uno por fichero (apps .html, skills .md)
        const d = await dirFor(base);
        for (const it of items) {
          const body = st.files.body ? st.files.body(it.value) : JSON.stringify(it.value, null, 1);
          await writeFile(d, safeName(st.files.name ? st.files.name(it.value, it.key) : it.key) + (st.files.ext || '.json'), body);
        }
      } else {                                      // uno solo (historial, ajustes)
        const d = await dirFor(`${ROOT}/${cfg.app}`);
        await writeFile(d, st.id + '.json', JSON.stringify(items.map(i => i.value), null, 1));
      }
      wrote.push({ id: st.id, files: items.length });
      dirty.delete(st.id);
    } catch (e) { errors.push({ id: st.id, error: e.message }); }
  }
  lastSaveAt = Date.now();
  lastError = errors.length ? errors[0].error : null;
  // índice legible con lo que hay
  try {
    const d = await dirFor(`${ROOT}/${cfg.app}`);
    await writeFile(d, 'index.json', JSON.stringify({ app: cfg.app, at: lastSaveAt, reason, wrote }, null, 1));
  } catch { /* */ }
  emit();
  return { ok: !errors.length, at: lastSaveAt, wrote, errors };
}

// ── copia descargable (Safari/Firefox o backup manual) ───────────────────────
export async function bundle({ only = null, includeSensitive = false } = {}) {
  const data = { app: cfg.app, at: Date.now(), stores: {} };
  for (const st of cfg.stores) {
    if (st.sensitive && !includeSensitive) continue;
    if (only && !only.includes(st.id)) continue;
    try { data.stores[st.id] = (await readStore(st)).map(i => i.value); } catch { /* */ }
  }
  return new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
}

// ── borrar ───────────────────────────────────────────────────────────────────
export async function wipe({ only = null, confirm } = {}) {
  if (confirm !== 'BORRAR') throw new Error('confirmación requerida');
  const removed = [];
  for (const st of cfg.stores) {
    if (only && !only.includes(st.id)) continue;
    try {
      if (st.kind === 'ls') { for (const k of st.keys || []) localStorage.removeItem(k); removed.push({ id: st.id }); }
      else if (st.kind === 'idb-store') { for (const k of await cfg.db.keys(st.store)) await cfg.db.del(st.store, k); removed.push({ id: st.id }); }
      else { await cfg.db.del(st.store || 'kv', st.key); removed.push({ id: st.id }); }
    } catch (e) { removed.push({ id: st.id, error: e.message }); }
  }
  emit();
  return { removed };
}

export async function clearCaches({ names } = {}) {
  if (typeof caches === 'undefined') return { deleted: [] };
  const target = names || await caches.keys();
  const deleted = [];
  for (const n of target) if (await caches.delete(n)) deleted.push(n);
  return { deleted };
}

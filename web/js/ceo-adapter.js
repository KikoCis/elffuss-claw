// Glue específico de Elffuss Claw para el cerebro CEO genérico (ceo.js, core):
// Claw no tiene un único «proyecto» como Code — tiene varias carpetas
// autorizadas (fs.js) — así que el cerebro trabaja dentro de la PRIMERA
// carpeta autorizada (la que fs.root()/fs.write() usan por defecto si no se
// indica `folder`), tratándola como su espacio de trabajo principal.
import * as fs from './tools/fs.js';
import * as db from './db.js';
import * as perms from './permissions.js';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.next', 'venv', '.venv', '.DS_Store']);

// La carpeta donde escribe el cerebro: la primera autorizada (o null).
export async function carpetaDelAlma() {
  try { return (await fs.folders())[0] || null; } catch { return null; }
}

// Las propuestas ya guardadas en la carpeta-alma, para que la Mente las enseñe
// después de recargar (antes Claw llamaba a mind.init sin esto y, tras una
// recarga, la Mente no tenía ni una etiqueta). NUNCA pide nada: sin el permiso
// «Archivos» concedido, o si el navegador no da ya acceso a la carpeta, no
// lista — abrir la Mente no puede sacar un diálogo de permisos.
export async function propuestasGuardadas(soulDir, { max = 40 } = {}) {
  try {
    if (!perms.has('fs')) return [];
    const nombre = await carpetaDelAlma();
    if (!nombre) return [];
    const raiz = await db.get('fs', nombre);
    if (!raiz) return [];
    if (raiz.queryPermission && await raiz.queryPermission({ mode: 'read' }) !== 'granted') return [];
    let dir = raiz;
    for (const p of String(soulDir || '').split('/').filter(Boolean)) {
      try { dir = await dir.getDirectoryHandle(p); } catch { return []; }
    }
    const ficheros = [];
    for await (const e of dir.values()) {
      if (e.kind === 'file' && e.name.endsWith('.md') && e.name !== 'archivo.md') ficheros.push(e);
    }
    ficheros.sort((a, b) => a.name.localeCompare(b.name));   // empiezan por fecha
    return await Promise.all(ficheros.slice(-max).map(async e => ({
      path: `${String(soulDir).replace(/^\/+|\/+$/g, '')}/${e.name}`,
      md: await (await e.getFile()).text(),
    })));
  } catch { return []; }
}

// El cerebro trabaja mientras NO miras, así que nunca pide permisos: ni el
// «Archivos» de Claw (fs.root() lo pedía y, con el permiso revocado y carpetas
// aún guardadas, el cerebro ocioso sacaba «📁 Permiso: Archivos» antes de
// llamar al modelo, esperaba la respuesta y lo volvía a pedir al escribir) ni
// el del navegador sobre la carpeta. Sin los dos concedidos no hay espacio de
// trabajo: isReady() dice que no y el ciclo no arranca.
async function raizSinPreguntar(nombre) {
  if (!perms.has('fs')) throw new Error('sin el permiso «Archivos»');
  const nombres = await fs.folders();
  const h = await db.get('fs', nombre || nombres[0]);
  if (!h) throw new Error('sin carpeta autorizada');
  if (h.queryPermission && await h.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('el navegador no ha dado acceso a la carpeta');
  return h;
}

async function dirHandle(dirPath, { create = false } = {}) {
  let dir = await raizSinPreguntar();
  for (const p of dirPath.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(p, { create });
  return dir;
}
async function fichero(path, { create = false } = {}) {
  const partes = String(path || '').split('/').filter(Boolean);
  const nombre = partes.pop();
  if (!nombre) throw new Error('Falta path');
  return (await dirHandle(partes.join('/'), { create })).getFileHandle(nombre, { create });
}

async function walk(dir, prefix, depth, budget) {
  if (depth <= 0 || budget.n > 350) return [];
  const entries = [];
  for await (const e of dir.values()) { if (!IGNORE.has(e.name)) entries.push(e); }
  entries.sort((a, b) => (a.kind !== b.kind) ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
  const out = [];
  for (const e of entries) {
    if (++budget.n > 350) { out.push(prefix + '…'); break; }
    out.push(prefix + (e.kind === 'directory' ? '📁 ' : '') + e.name);
    if (e.kind === 'directory') out.push(...await walk(e, prefix + '  ', depth - 1, budget));
  }
  return out;
}

export const ceoWorkspace = {
  isReady: async () => { try { await raizSinPreguntar(); return true; } catch { return false; } },
  tree: async ({ depth = 2 } = {}) => {
    const names = await fs.folders();
    if (!names.length) return '(sin carpetas autorizadas)';
    const budget = { n: 0 };
    const out = [];
    for (const name of names) {
      out.push('📁 ' + name);
      try { out.push(...await walk(await raizSinPreguntar(name), '  ', depth, budget)); } catch { /* sin permiso ya */ }
    }
    return out.join('\n') || '(vacío)';
  },
  write: async ({ path, content = '' }) => {
    const w = await (await fichero(path, { create: true })).createWritable();
    await w.write(content);
    await w.close();
    return `Escrito ${path} (${content.length} caracteres)`;
  },
  read: async ({ path }) => (await (await fichero(path)).getFile()).text(),
  list: async (dirPath) => {
    const dir = await dirHandle(dirPath, { create: true });
    const names = [];
    for await (const e of dir.values()) if (e.kind === 'file') names.push(e.name);
    return names;
  },
  remove: async (dirPath, name) => (await dirHandle(dirPath)).removeEntry(name),
};

// «perfiles»: líneas de pensamiento paralelas adaptadas a lo que Claw
// realmente puede hacer (carpetas, apps, tareas, memoria) — no a código.
export const CEO_DEFAULT_PROFILES = [
  { id: 'org', name: 'Organización', focus: 'archivos y carpetas autorizadas: qué limpiar, renombrar o agrupar mejor; automatizaciones (fs.watch) que ahorrarían trabajo repetitivo', color: '#7c5cff' },
  { id: 'prod', name: 'Productividad', focus: 'apps creadas, skills instaladas y tareas programadas: qué automatizar o qué skill nueva ayudaría de verdad', color: '#49e8ff' },
  { id: 'memo', name: 'Memoria', focus: 'qué hechos útiles sobre el usuario merece la pena recordar a partir de lo visto, y qué recordado ya no aplica', color: '#3fb970' },
];

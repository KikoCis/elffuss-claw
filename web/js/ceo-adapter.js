// Glue específico de Elffuss Claw para el cerebro CEO genérico (ceo.js, core):
// Claw no tiene un único «proyecto» como Code — tiene varias carpetas
// autorizadas (fs.js) — así que el cerebro trabaja dentro de la PRIMERA
// carpeta autorizada (la que fs.root()/fs.write() usan por defecto si no se
// indica `folder`), tratándola como su espacio de trabajo principal.
import * as fs from './tools/fs.js';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.next', 'venv', '.venv', '.DS_Store']);

async function dirHandle(dirPath, { create = false } = {}) {
  let dir = await fs.root();
  for (const p of dirPath.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(p, { create });
  return dir;
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
  isReady: async () => (await fs.folders()).length > 0,
  tree: async ({ depth = 2 } = {}) => {
    const names = await fs.folders();
    if (!names.length) return '(sin carpetas autorizadas)';
    const budget = { n: 0 };
    const out = [];
    for (const name of names) {
      out.push('📁 ' + name);
      try { out.push(...await walk(await fs.root(name), '  ', depth, budget)); } catch { /* sin permiso ya */ }
    }
    return out.join('\n') || '(vacío)';
  },
  write: ({ path, content }) => fs.write({ path, content }),
  read: ({ path }) => fs.read({ path }),
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

// Las apps no se instalan: se generan como HTML y viven en el visualizador.
import * as db from '../db.js';
import { require as requirePerm } from '../permissions.js';

let renderer = () => {};
export function setRenderer(fn) { renderer = fn; }

let current = null; // app abierta en el visualizador (para el contexto del modelo)
export function currentApp() { return current; }

export async function create({ name, html } = {}) {
  if (!name || !html) throw new Error('Faltan name o html');
  await requirePerm('apps', `Crear la app «${name}» y mostrarla en el visualizador`);
  if (name === 'app' || name === 'boceto') { // nombre genérico: no machacar la anterior
    let n = name, i = 1;
    while (await db.get('apps', n)) n = `${name}-${++i}`;
    name = n;
  }
  await db.set('apps', name, { name, html, created: Date.now() });
  current = name;
  renderer(name, html);
  return `App «${name}» creada y abierta en el visualizador.`;
}

export async function open({ name } = {}) {
  const app = await db.get('apps', name);
  if (!app) throw new Error(`No existe la app «${name}»`);
  current = app.name;
  renderer(app.name, app.html);
  return `App «${name}» abierta.`;
}

export async function listApps() {
  const apps = await db.all('apps');
  return apps.length
    ? apps.map(a => `• ${a.name} (${new Date(a.created).toLocaleDateString('es-ES')})`).join('\n')
    : 'Aún no has creado ninguna app.';
}

export async function removeApp({ name } = {}) {
  await db.del('apps', name);
  return `App «${name}» eliminada.`;
}

export async function allApps() { return db.all('apps'); }

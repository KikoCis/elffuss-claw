// Las apps no se instalan: se generan como HTML y viven en el visualizador.
import * as db from '../db.js';
import { require as requirePerm } from '../permissions.js';

let renderer = () => {};
export function setRenderer(fn) { renderer = fn; }

export async function create({ name, html } = {}) {
  if (!name || !html) throw new Error('Faltan name o html');
  await requirePerm('apps', `Crear la app «${name}» y mostrarla en el visualizador`);
  await db.set('apps', name, { name, html, created: Date.now() });
  renderer(name, html);
  return `App «${name}» creada y abierta en el visualizador.`;
}

export async function open({ name } = {}) {
  const app = await db.get('apps', name);
  if (!app) throw new Error(`No existe la app «${name}»`);
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

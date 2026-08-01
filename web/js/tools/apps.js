// Las apps no se instalan: se generan como HTML y viven en el visualizador.
import * as db from '../db.js';
import { require as requirePerm } from '../permissions.js';
import { t } from '../i18n.js';

let renderer = () => {};
export function setRenderer(fn) { renderer = fn; }

let current = null; // app abierta en el visualizador (para el contexto del modelo)
export function currentApp() { return current; }

export async function create({ name, html } = {}) {
  if (!name || !html) throw new Error('Faltan name o html');
  await requirePerm('apps', t('pdApp', { name }));
  if (name === 'app' || name === 'boceto') { // nombre genérico: no machacar la anterior
    let n = name, i = 1;
    while (await db.get('apps', n)) n = `${name}-${++i}`;
    name = n;
  }
  await db.set('apps', name, { name, html, created: Date.now() });
  current = name;
  renderer(name, html);
  return t('appCreated', { name });
}

export async function open({ name } = {}) {
  const app = await db.get('apps', name);
  if (!app) throw new Error(`No existe la app «${name}»`);
  current = app.name;
  renderer(app.name, app.html);
  return t('appOpened', { name });
}

export async function listApps() {
  const apps = await db.all('apps');
  return apps.length
    ? apps.map(a => `• ${a.name} (${new Date(a.created).toLocaleDateString()})`).join('\n')
    : t('appNone');
}

export async function removeApp({ name } = {}) {
  await db.del('apps', name);
  return t('appRemoved', { name });
}

export async function allApps() { return db.all('apps'); }

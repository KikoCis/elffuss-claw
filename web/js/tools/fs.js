// Sistema de archivos real vía File System Access API (Chrome/Edge).
// Los handles de carpeta se persisten en IndexedDB; el navegador re-pide
// su propio permiso nativo al volver a usarlos en otra sesión.
import * as db from '../db.js';
import { require as requirePerm } from '../permissions.js';

const MAX_READ = 200_000; // caracteres

export async function pickFolder() {
  await requirePerm('fs', 'Elegir una carpeta de tu ordenador para trabajar en ella');
  if (!window.showDirectoryPicker)
    throw new Error('Este navegador no soporta File System Access (usa Chrome o Edge)');
  const handle = await window.showDirectoryPicker();
  await db.set('fs', handle.name, handle);
  return `Carpeta «${handle.name}» autorizada. Ya puedo listar, leer y escribir dentro.`;
}

export async function folders() { return db.keys('fs'); }

async function root(folder) {
  await requirePerm('fs');
  const names = await db.keys('fs');
  if (!names.length)
    throw new Error('No hay ninguna carpeta autorizada. Pídeme «autoriza una carpeta».');
  if (folder && !names.includes(folder))
    throw new Error(`No conozco la carpeta «${folder}». Autorizadas: ${names.join(', ')}`);
  const handle = await db.get('fs', folder || names[0]);
  if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted' &&
      await handle.requestPermission({ mode: 'readwrite' }) !== 'granted')
    throw new Error('El navegador denegó el acceso a la carpeta');
  return handle;
}

// Recorre 'a/b/c.txt' → { dir: handle de a/b, name: 'c.txt' }
async function walk(handle, path, { create = false } = {}) {
  const parts = (path || '').split('/').filter(Boolean);
  const name = parts.pop();
  for (const p of parts) handle = await handle.getDirectoryHandle(p, { create });
  return { dir: handle, name };
}

export async function list({ path = '', folder } = {}) {
  let dir = await root(folder);
  for (const p of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(p);
  const out = [];
  for await (const entry of dir.values())
    out.push(`${entry.kind === 'directory' ? '📁' : '📄'} ${entry.name}`);
  return out.length ? out.sort().join('\n') : '(carpeta vacía)';
}

export async function read({ path, folder } = {}) {
  if (!path) throw new Error('Falta path');
  const { dir, name } = await walk(await root(folder), path);
  const file = await (await dir.getFileHandle(name)).getFile();
  const text = await file.text();
  return text.length > MAX_READ
    ? text.slice(0, MAX_READ) + `\n… (recortado, ${file.size} bytes en total)`
    : text;
}

export async function write({ path, content = '', folder } = {}) {
  if (!path) throw new Error('Falta path');
  const { dir, name } = await walk(await root(folder), path, { create: true });
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
  return `Escrito ${path} (${content.length} caracteres)`;
}

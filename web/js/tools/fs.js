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

export async function root(folder) {
  await requirePerm('fs');
  const names = await db.keys('fs');
  if (!names.length)
    throw new Error('No hay ninguna carpeta autorizada. Pídeme «autoriza una carpeta».');
  if (folder && !names.includes(folder))
    throw new Error(`No conozco la carpeta «${folder}». Autorizadas: ${names.join(', ')}`);
  const handle = await db.get('fs', folder || names[0]);
  // (los handles OPFS no exponen queryPermission — se consideran concedidos)
  const perm = handle.queryPermission ? await handle.queryPermission({ mode: 'readwrite' }) : 'granted';
  if (perm !== 'granted' &&
      (!handle.requestPermission || await handle.requestPermission({ mode: 'readwrite' }) !== 'granted'))
    throw new Error('El navegador denegó el acceso a la carpeta');
  return handle;
}

// Excel → CSV (SheetJS, lazy). Devuelve el CSV de la primera hoja.
export async function xlsxToCsv(file) {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-latest/package/xlsx.mjs');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.SheetNames[0];
  return { sheet, csv: XLSX.utils.sheet_to_csv(wb.Sheets[sheet]) };
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
  if (/\.xlsx?$/i.test(name)) { // Excel: binario → CSV legible
    const { sheet, csv } = await xlsxToCsv(file);
    const body = csv.length > MAX_READ ? csv.slice(0, MAX_READ) + '\n… (recortado)' : csv;
    return `[${name} → hoja «${sheet}» como CSV]\n${body}`;
  }
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

export const globToRegex = pattern => new RegExp(
  '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');

// Copia one-shot entre dos carpetas autorizadas (pattern tipo *.txt).
export async function copy({ pattern = '*', from, to } = {}) {
  if (!from || !to) throw new Error('Faltan from y to (nombres de carpetas autorizadas)');
  const src = await root(from), dst = await root(to);
  const rx = globToRegex(pattern);
  const copied = [];
  for await (const entry of src.values()) {
    if (entry.kind !== 'file' || !rx.test(entry.name)) continue;
    const data = await (await entry.getFile()).arrayBuffer();
    const fh = await dst.getFileHandle(entry.name, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
    copied.push(entry.name);
  }
  return copied.length
    ? `Copiados ${copied.length} archivo(s) de «${from}» a «${to}»: ${copied.join(', ')}`
    : `Nada que copiar (patrón ${pattern} en «${from}»)`;
}

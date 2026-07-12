// Vault: AES-256-GCM + PBKDF2 (WebCrypto). La clave derivada vive solo en
// memoria y se autobloquea a los 5 minutos. Sin contraseña maestra no hay
// recuperación posible: los blobs cifrados no salen del IndexedDB local.
import * as db from '../db.js';
import { require as requirePerm } from '../permissions.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const AUTOLOCK_MS = 5 * 60 * 1000;
let key = null, lockTimer = null;

function armLock() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => { key = null; }, AUTOLOCK_MS);
}

async function derive(master, salt) {
  const material = await crypto.subtle.importKey('raw', enc.encode(master), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encrypt(text, k = key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(text));
  return { iv: [...iv], ct: [...new Uint8Array(ct)] };
}

async function decrypt(blob, k = key) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(blob.iv) }, k, new Uint8Array(blob.ct));
  return dec.decode(pt);
}

export async function isSetup() { return Boolean(await db.get('vault', '__salt')); }
export function isUnlocked() { return key !== null; }
export function lock() { key = null; clearTimeout(lockTimer); }

export async function unlock(master) {
  if (!master) throw new Error('Falta la contraseña maestra');
  await requirePerm('vault');
  let salt = await db.get('vault', '__salt');
  if (!salt) { // primera vez: crear el vault
    salt = crypto.getRandomValues(new Uint8Array(16));
    key = await derive(master, salt);
    await db.set('vault', '__salt', salt);
    await db.set('vault', '__check', await encrypt('elffuss-ok'));
    armLock();
    return 'Vault creado y desbloqueado. Guarda bien tu contraseña maestra: sin ella no hay recuperación.';
  }
  const candidate = await derive(master, salt);
  try { await decrypt(await db.get('vault', '__check'), candidate); }
  catch { throw new Error('Contraseña maestra incorrecta'); }
  key = candidate;
  armLock();
  return 'Vault desbloqueado (se bloquea solo en 5 min).';
}

function mustBeOpen() {
  if (!key) throw new Error('El vault está bloqueado. Desbloquéalo en el panel Vault.');
}

export async function setSecret({ name, secret } = {}) {
  if (!name || !secret) throw new Error('Faltan name o secret');
  await requirePerm('vault', `Guardar el secreto «${name}»`);
  mustBeOpen();
  await db.set('vault', 's:' + name, await encrypt(secret));
  armLock();
  return `Secreto «${name}» guardado cifrado (AES-256-GCM).`;
}

export async function getSecret({ name } = {}) {
  await requirePerm('vault', `Leer el secreto «${name}»`);
  mustBeOpen();
  const blob = await db.get('vault', 's:' + name);
  if (!blob) throw new Error(`No existe el secreto «${name}»`);
  armLock();
  return decrypt(blob);
}

export async function listSecrets() {
  const ks = await db.keys('vault');
  const names = ks.filter(k => k.startsWith('s:')).map(k => k.slice(2));
  return names.length ? 'Secretos guardados: ' + names.join(', ') : 'El vault está vacío.';
}

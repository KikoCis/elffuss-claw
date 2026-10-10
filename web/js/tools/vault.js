// Vault: AES-256-GCM + PBKDF2 (WebCrypto). La clave derivada vive solo en
// memoria y se autobloquea a los 5 minutos. Sin contraseña maestra no hay
// recuperación posible: los blobs cifrados no salen del IndexedDB local.
import * as db from '../db.js';
import { require as requirePerm } from '../permissions.js';
import { t } from '../i18n.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const AUTOLOCK_MS = 5 * 60 * 1000;
let key = null, lockTimer = null;

// Quien enseña la bóveda (el panel) se entera de que se ha cerrado. El
// autobloqueo borraba la clave sin avisar a nadie: el panel seguía ofreciendo
// «Bloquear ahora» y un secreto revelado se quedaba en claro en pantalla.
const alCerrarse = new Set();
export function alBloquear(fn) { alCerrarse.add(fn); return () => alCerrarse.delete(fn); }
function avisarBloqueo(motivo) {
  for (const fn of alCerrarse) { try { fn(motivo); } catch { /* un oyente roto no para a los demás */ } }
}

function armLock() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => { key = null; avisarBloqueo('auto'); }, AUTOLOCK_MS);
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
export function lock() {
  const estaba = key !== null;
  key = null; clearTimeout(lockTimer);
  if (estaba) avisarBloqueo('manual');
}

// `desdePanel`: lo hace el usuario con sus manos en la pestaña Bóveda. Ahí no
// se le pide el permiso «Bóveda», que es el del AGENTE: preguntarle a quien ya
// está desbloqueando su propia bóveda si se da permiso a sí mismo era ruido, y
// con Enter en la contraseña la pregunta se contestaba sola con «Denegar».
// Las herramientas del agente (vault.set/get) siguen pidiéndolo como siempre.
export async function unlock(master, { desdePanel = false } = {}) {
  if (!master) throw new Error('Falta la contraseña maestra');
  if (!desdePanel) await requirePerm('vault');
  let salt = await db.get('vault', '__salt');
  if (!salt) { // primera vez: crear la bóveda
    salt = crypto.getRandomValues(new Uint8Array(16));
    key = await derive(master, salt);
    await db.set('vault', '__salt', salt);
    await db.set('vault', '__check', await encrypt('elffuss-ok'));
    armLock();
    return 'Bóveda creada y desbloqueada. Guarda bien tu contraseña maestra: sin ella no hay recuperación.';
  }
  const candidate = await derive(master, salt);
  try { await decrypt(await db.get('vault', '__check'), candidate); }
  catch { throw new Error('Contraseña maestra incorrecta'); }
  key = candidate;
  armLock();
  return 'Bóveda desbloqueada (se bloquea sola a los 5 min sin uso).';
}

function mustBeOpen() {
  if (!key) throw new Error('La bóveda está bloqueada. Desbloquéala en la pestaña Bóveda.');
}

export async function setSecret({ name, secret } = {}, { desdePanel = false } = {}) {
  if (!name || !secret) throw new Error(t('vaultNeedNameSecret'));
  if (!desdePanel) await requirePerm('vault', t('pdVaultSet', { name }));
  mustBeOpen();
  await db.set('vault', 's:' + name, await encrypt(secret));
  armLock();
  return `Secreto «${name}» guardado cifrado (AES-256-GCM).`;
}

export async function getSecret({ name } = {}, { desdePanel = false } = {}) {
  if (!desdePanel) await requirePerm('vault', t('pdVaultGet', { name }));
  mustBeOpen();
  const blob = await db.get('vault', 's:' + name);
  if (!blob) throw new Error(t('vaultNoSecret', { name }));
  armLock();
  return decrypt(blob);
}

// Borrar un secreto pide la bóveda ABIERTA, como leerlo: con ella bloqueada el
// panel ni siquiera enseña la lista (ver alBloquear).
export async function removeSecret({ name } = {}) {
  if (!name) throw new Error(t('vaultNeedName'));
  mustBeOpen();
  await db.del('vault', 's:' + name);
  armLock();
  return `Secreto «${name}» borrado.`;
}

export async function listSecrets() {
  const ks = await db.keys('vault');
  const names = ks.filter(k => k.startsWith('s:')).map(k => k.slice(2));
  return names.length ? 'Secretos guardados: ' + names.join(', ') : 'La bóveda está vacía.';
}

export async function secretNames() {
  return (await db.keys('vault')).filter(k => k.startsWith('s:')).map(k => k.slice(2));
}

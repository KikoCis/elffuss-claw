// Permisos por ámbito: nada corre sin consentimiento explícito del usuario.
import { t } from './i18n.js';

const KEY = 'elffuss.grants';
const granted = new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
let asker = async () => false; // la UI lo sustituye por el modal real

// label/desc son getters localizados: se resuelven al leerse (idioma del
// navegador), no al importar el módulo, así el chrome sale en el idioma correcto.
export const SCOPES = {
  fs:    { icon: '📁', get label() { return t('scFsL'); },    get desc() { return t('scFsD'); } },
  apps:  { icon: '🎨', get label() { return t('scAppsL'); },  get desc() { return t('scAppsD'); } },
  vault: { icon: '🔐', get label() { return t('scVaultL'); }, get desc() { return t('scVaultD'); } },
  tasks: { icon: '⏰', get label() { return t('scTasksL'); }, get desc() { return t('scTasksD'); } },
  web:   { icon: '🌐', get label() { return t('scWebL'); },   get desc() { return t('scWebD'); } },
  memory: { icon: '🧠', get label() { return t('scMemL'); },  get desc() { return t('scMemD'); } },
};

export function setAsker(fn) { asker = fn; }
export function grants() { return [...granted]; }
export function has(scope) { return granted.has(scope); }

export async function require(scope, detail = '') {
  if (granted.has(scope)) return true;
  const ok = await asker(scope, SCOPES[scope], detail);
  if (!ok) throw new Error(t('permDenied', { label: SCOPES[scope]?.label || scope }));
  granted.add(scope);
  localStorage.setItem(KEY, JSON.stringify([...granted]));
  return true;
}

export function revoke(scope) {
  granted.delete(scope);
  localStorage.setItem(KEY, JSON.stringify([...granted]));
}

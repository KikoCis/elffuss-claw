// Permisos por ámbito: nada corre sin consentimiento explícito del usuario.
const KEY = 'elffuss.grants';
const granted = new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
let asker = async () => false; // la UI lo sustituye por el modal real

export const SCOPES = {
  fs:    { icon: '📁', label: 'Archivos', desc: 'Leer y escribir en las carpetas que autorices' },
  apps:  { icon: '🎨', label: 'Apps', desc: 'Crear y mostrar apps HTML en el visualizador' },
  vault: { icon: '🔐', label: 'Vault', desc: 'Guardar y leer secretos cifrados' },
  tasks: { icon: '⏰', label: 'Tareas', desc: 'Programar tareas que se ejecutan solas' },
  web:   { icon: '🌐', label: 'Internet', desc: 'Visitar páginas web en tu nombre' },
};

export function setAsker(fn) { asker = fn; }
export function grants() { return [...granted]; }
export function has(scope) { return granted.has(scope); }

export async function require(scope, detail = '') {
  if (granted.has(scope)) return true;
  const ok = await asker(scope, SCOPES[scope], detail);
  if (!ok) throw new Error(`Permiso «${SCOPES[scope]?.label || scope}» denegado por el usuario`);
  granted.add(scope);
  localStorage.setItem(KEY, JSON.stringify([...granted]));
  return true;
}

export function revoke(scope) {
  granted.delete(scope);
  localStorage.setItem(KEY, JSON.stringify([...granted]));
}

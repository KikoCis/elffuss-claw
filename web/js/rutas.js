// Rutas con el hash: #/<sección>[/<detalle>]. Sin dependencias.
// ─────────────────────────────────────────────────────────────────────────────
// Claw no tenía estado en la URL: ni un panel ni una app se podían enlazar,
// guardar en marcadores o recuperar con «Atrás», y los avisos del chat («Tarea
// t… programada», «Guardado en .elffuss/soul/…») no llevaban a ningún sitio.
//
//   #/vista · #/apps · #/apps/<nombre> · #/tareas · #/tareas/<id>
//   #/tareas/automatizaciones · #/vault · #/skills · #/skills/<nombre>
//   #/permisos · #/ajustes · #/ajustes/acerca · #/mente · #/mente/<ruta>
//   #/modelo  → no es un sitio, es una acción: enfoca el selector de modelo.
//
// Lo que NUNCA va en una URL: nombres de secretos ni hechos de la memoria. Un
// fragmento acaba en el historial del navegador y, si alguien activa los
// informes de errores, cerca del campo url (telemetry.js quita el hash).
//
// El detalle es relativo y corto (un nombre de app, un id de tarea, una ruta
// DENTRO de la carpeta autorizada): ninguna ruta de disco completa llega aquí,
// porque el navegador solo nos da el nombre de la carpeta, no dónde está.
export const SECCIONES = ['vista', 'apps', 'tareas', 'vault', 'skills', 'permisos', 'ajustes', 'mente', 'modelo'];

export function leer(hash = location.hash) {
  const m = /^#\/([a-z]+)(?:\/(.*))?$/.exec(hash || '');
  if (!m || !SECCIONES.includes(m[1])) return null;
  let detalle = null;
  if (m[2]) { try { detalle = decodeURIComponent(m[2]); } catch { detalle = m[2]; } }
  return { seccion: m[1], detalle };
}

export function href(seccion, detalle = null) {
  return '#/' + seccion + (detalle != null && detalle !== '' ? '/' + encodeURIComponent(detalle) : '');
}

// Refleja en la URL dónde está el usuario. `push` crea una entrada de historial
// (un clic suyo: «Atrás» lo deshace); sin `push` se reemplaza la actual (algo que
// pasa solo, como abrir la Vista al crear una app, no debe llenar el historial).
// Ni pushState ni replaceState disparan hashchange: reflejar no re-navega.
export function reflejar(seccion, detalle = null, { push = false } = {}) {
  const h = href(seccion, detalle);
  if (location.hash === h) return;
  try { history[push ? 'pushState' : 'replaceState'](history.state, '', h); } catch { /* sandbox o file: */ }
}

// Navegar: igual que pulsar un enlace. Dispara hashchange, y quien escuche
// abre lo que toque.
export function ir(seccion, detalle = null) {
  const h = href(seccion, detalle);
  if (location.hash === h) { dispatchEvent(new HashChangeEvent('hashchange')); return; }
  location.hash = h;
}

// hashchange llega con «Atrás»/«Adelante», con un enlace pulsado y con la URL
// editada a mano. Sin fragmento (volver al principio con «Atrás») es la Vista,
// que es donde arranca la app.
export function alCambiar(fn) {
  addEventListener('hashchange', () => {
    const r = leer() || (!location.hash || location.hash === '#' ? { seccion: 'vista', detalle: null } : null);
    if (r) fn(r);
  });
}

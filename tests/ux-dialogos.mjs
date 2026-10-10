// Diálogo de permisos y avisos (toasts), con el teclado y con el ratón.
//   · Escape en el diálogo de permisos DENIEGA: el turno termina y la cola sigue
//     (antes la promesa no se resolvía nunca y todo se quedaba colgado).
//   · Dos peticiones a la vez van en cola: la segunda no pisa a la primera.
//   · Un permiso pedido desde un Enter no se deniega con esa misma pulsación.
//   · Los avisos se cierran, pueden llevar acción y se anuncian (región viva).
//
//   BASE=http://localhost:8743 node tests/ux-dialogos.mjs
import { navegador, contexto, pagina, ok, hasta, espera, escribir, reposo, avisos, fin, OUT } from './ux-comun.mjs';

const b = await navegador();
const { ctx } = await contexto(b, { grants: [] });
const { p, errores } = await pagina(ctx);

// ── 1 · Escape = Denegar, y el turno no se cuelga ───────────────────────────
await escribir(p, 'hazme un reloj');
ok('el modo básico pide permiso de Apps', await hasta(() => p.evaluate(() => document.getElementById('perm-dialog').open)));
if (OUT) await p.screenshot({ path: OUT + '/ux-permiso.png' });
await p.keyboard.press('Escape');
ok('Escape cierra el diálogo', await hasta(() => p.evaluate(() => !document.getElementById('perm-dialog').open)));
ok('…y cuenta como «Denegar» (la herramienta recibe el permiso denegado)', await hasta(async () =>
  /denegado por el usuario/.test(await p.locator('#log').innerText())));
ok('el turno termina: el botón vuelve a ➤ y no queda la burbuja de «usando…»', await reposo(p));
await escribir(p, 'hola');
ok('lo siguiente que escribes se procesa (la cola no se ha quedado atascada)', await hasta(async () =>
  (await p.locator('#log .msg.assistant').allTextContents()).some(t => /modo básico/.test(t))));
ok('no queda nada esperando en la cola', await p.locator('.msg.user.queued').count() === 0);

// ── 2 · dos peticiones a la vez: en cola, una detrás de otra ────────────────
await p.evaluate(() => {
  window.__r = {};
  import('/js/permissions.js').then(pm => {
    pm.require('web', 'primera').then(() => { window.__r.web = 'ok'; }, () => { window.__r.web = 'no'; });
    pm.require('tasks', 'segunda').then(() => { window.__r.tasks = 'ok'; }, () => { window.__r.tasks = 'no'; });
  });
});
ok('se abre la primera petición', await hasta(() => p.evaluate(() =>
  document.getElementById('perm-dialog').open && /Internet/.test(document.getElementById('perm-title').textContent))));
await p.click('#perm-allow');
ok('al contestarla, se abre la segunda (no se pisaron)', await hasta(() => p.evaluate(() =>
  document.getElementById('perm-dialog').open && /Tareas/.test(document.getElementById('perm-title').textContent))));
await p.click('#perm-deny');
ok('cada una recibe SU respuesta', await hasta(() => p.evaluate(() => window.__r.web === 'ok' && window.__r.tasks === 'no')),
  JSON.stringify(await p.evaluate(() => window.__r)));

// ── 3 · un Enter que pide permiso no lo deniega con la misma pulsación ──────
await p.evaluate(() => {
  const i = document.createElement('input');
  i.id = 'campo-prueba';
  document.body.appendChild(i);
  i.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    window.__mem = 'pendiente';
    import('/js/permissions.js').then(pm => pm.require('memory', 'desde un Enter')
      .then(() => { window.__mem = 'concedido'; }, () => { window.__mem = 'denegado'; }));
  });
  i.focus();
});
await p.keyboard.press('Enter');
await espera(500);
ok('el diálogo sigue abierto tras el Enter que lo pidió', await p.evaluate(() => document.getElementById('perm-dialog').open && window.__mem === 'pendiente'),
  await p.evaluate(() => window.__mem));
ok('el foco está dentro del diálogo', await p.evaluate(() => document.getElementById('perm-dialog').contains(document.activeElement)));
await p.click('#perm-allow');
ok('y contestar con el ratón lo concede', await hasta(() => p.evaluate(() => window.__mem === 'concedido')));
ok('al cerrarse, el foco vuelve al campo de donde salió', await p.evaluate(() => document.activeElement?.id === 'campo-prueba'));

// ── 4 · avisos: región viva, se cierran, llevan acción ──────────────────────
const vivo = await p.evaluate(() => ({
  toasts: document.getElementById('toasts').getAttribute('role'),
  log: document.getElementById('log').getAttribute('role'),
  dialogo: document.getElementById('perm-dialog').getAttribute('aria-labelledby'),
}));
ok('#toasts y #log son regiones vivas; el diálogo tiene título', vivo.toasts === 'status' && vivo.log === 'log' && vivo.dialogo === 'perm-title', JSON.stringify(vivo));
await p.evaluate(async () => {
  const ui = await import('/js/ui.js');
  window.__accion = 0;
  ui.toast('aviso con acción', { accion: { label: 'Hazlo', run: () => { window.__accion++; } } });
  ui.toast('aviso para cerrar');
});
const conAccion = p.locator('#toasts .toast', { hasText: 'aviso con acción' });
await conAccion.locator('.toast-accion').click();
ok('la acción del aviso se ejecuta y el aviso se va', await p.evaluate(() => window.__accion) === 1 && await conAccion.count() === 0);
const paraCerrar = p.locator('#toasts .toast', { hasText: 'aviso para cerrar' });
ok('el ✕ tiene nombre accesible', /Cerrar/.test(await paraCerrar.locator('.toast-x').getAttribute('aria-label')));
await paraCerrar.locator('.toast-x').click();
ok('✕ cierra el aviso', await paraCerrar.count() === 0);
await p.evaluate(async () => (await import('/js/ui.js')).toast('aviso con el ratón encima', { ms: 600 }));
await p.hover('#toasts .toast:last-child');
await espera(1100);
ok('con el ratón encima, el aviso no se va', await p.locator('#toasts .toast', { hasText: 'aviso con el ratón encima' }).count() === 1);
await p.mouse.move(5, 5);
ok('y al quitarlo, sí', await hasta(async () => await p.locator('#toasts .toast', { hasText: 'aviso con el ratón encima' }).count() === 0));

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
await fin(b, 'DIÁLOGOS Y AVISOS: Escape deniega, la cola sigue, sin pisarse y sin denegar por un Enter');

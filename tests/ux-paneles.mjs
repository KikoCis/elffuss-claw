// Paneles Apps, Tareas y Permisos.
//   · 🗑 de una app: nombre propio, «Deshacer», y si era la abierta el visor se
//     vacía y el modelo deja de creerla abierta.
//   · Tareas: enseña el id, «Ejecutar ahora», y se repinta sola cuando una tarea
//     se lanza (se quedaba en ⏳); el aviso lleva a la tarea.
//   · Automatizaciones de carpetas con su lista y ✕ (no tenían interfaz).
//   · Quitar una carpeta pide confirmación, dice qué automatizaciones arrastra y
//     dónde escribe la Mente.
//   · Con el teclado, el foco no cae a <body> tras borrar, «Deshacer»,
//     «Ejecutar ahora», revocar o quitar: va al mismo botón de la fila que queda
//     en su sitio, al de lo devuelto, o al título de la sección.
//
//   BASE=http://localhost:8743 node tests/ux-paneles.mjs
import { navegador, contexto, pagina, ok, hasta, espera, escribir, reposo, avisos, fin, BASE } from './ux-comun.mjs';

const b = await navegador();
const { ctx } = await contexto(b, { grants: ['apps', 'tasks', 'fs'] });
const { p, errores } = await pagina(ctx);
const foco = () => p.evaluate(() => {
  const a = document.activeElement;
  return !a || a === document.body ? 'BODY' : (a.getAttribute('aria-label') || a.textContent || a.id || a.tagName).trim().slice(0, 80);
});
const conTeclado = async loc => { await loc.focus(); await p.keyboard.press('Enter'); };

// ── Apps ────────────────────────────────────────────────────────────────────
await escribir(p, 'hazme un reloj');
await reposo(p);
ok('la app está abierta en el visor', await p.evaluate(async () =>
  !document.getElementById('appframe').hidden && (await import('/js/tools/apps.js')).currentApp() === 'reloj'));
await p.click('#tabs button[data-tab="apps"]');
const borrar = p.locator('#panel-apps button[aria-label="Borrar la app «reloj»"]');
ok('🗑 se llama «Borrar la app «reloj»»', await borrar.count() === 1);
await conTeclado(borrar);
ok('borrarla vacía el visor y el modelo ya no la cree abierta', await hasta(() => p.evaluate(async () =>
  document.getElementById('appframe').hidden && !document.getElementById('vista-empty').hidden
  && (await import('/js/tools/apps.js')).currentApp() === null)));
ok('…el foco no cae a <body>: va al título de Apps (no queda ninguna)', await hasta(async () => (await foco()) === 'Apps creadas'), await foco());
const deshacer = p.locator('#toasts .toast', { hasText: 'eliminada' }).locator('.toast-accion');
ok('…y ofrece «Deshacer»', await deshacer.count() === 1);
await conTeclado(deshacer);
ok('«Deshacer» la devuelve a la lista', await hasta(async () => await p.locator('#panel-apps .card', { hasText: 'reloj' }).count() === 1));
ok('…y el foco va a su 🗑', await hasta(async () => (await foco()) === 'Borrar la app «reloj»'), await foco());

// ── Tareas ──────────────────────────────────────────────────────────────────
const id = await p.evaluate(async () => {
  const r = await (await import('/js/tools/tasks.js')).add({ inMinutes: 30, prompt: 'estirar la espalda' });
  return r.match(/Tarea (\S+)/)[1];
});
await p.click('#tabs button[data-tab="tareas"]');
const tarjeta = p.locator(`#panel-tareas [data-ruta="${id}"]`);
ok('la tarea enseña su id (el que nombran los avisos)', (await tarjeta.locator('code').innerText()) === id);
await conTeclado(tarjeta.locator('button', { hasText: 'Ejecutar ahora' }));
ok('«Ejecutar ahora» la manda al chat y la marca hecha', await hasta(async () =>
  /\[tarea programada\] estirar la espalda/.test(await p.locator('#log').innerText()) && /✅/.test(await tarjeta.innerText())));
ok('…y deja de ofrecer «Ejecutar ahora»', await tarjeta.locator('button', { hasText: 'Ejecutar ahora' }).count() === 0);
ok('…con el foco en el 🗑 de esa tarea (no en <body>)', await hasta(async () => (await foco()) === 'Borrar la tarea «estirar la espalda»'), await foco());
await reposo(p);
// 🗑 de una tarea: el foco va al 🗑 de la que queda en su sitio.
await p.evaluate(async () => (await import('/js/db.js')).set('tasks', 'tsigue1', { id: 'tsigue1', when: Date.now() + 3600e3, prompt: 'regar las plantas', done: false }));
await p.click('#tabs button[data-tab="apps"]');
await p.click('#tabs button[data-tab="tareas"]');
await conTeclado(tarjeta.locator('button[aria-label^="Borrar la tarea"]'));
ok('borrar una tarea con el teclado deja el foco en el 🗑 de la que queda en su sitio', await hasta(async () =>
  await tarjeta.count() === 0 && (await foco()) === 'Borrar la tarea «regar las plantas»'), await foco());

// una tarea que vence con el panel abierto
await p.evaluate(async () => (await import('/js/db.js')).set('tasks', 'tvence1', { id: 'tvence1', when: Date.now() - 1000, prompt: 'beber agua', done: false }));
await p.click('#tabs button[data-tab="apps"]');
await p.click('#tabs button[data-tab="tareas"]');
ok('antes de lanzarse está en ⏳', /⏳/.test(await p.locator('#panel-tareas [data-ruta="tvence1"]').innerText()));
ok('cuando el planificador la lanza, el panel se repinta solo (✅)', await hasta(async () =>
  /✅/.test(await p.locator('#panel-tareas [data-ruta="tvence1"]').innerText().catch(() => '')), { veces: 120, cada: 250 }));
const avisoTarea = p.locator('#toasts .toast', { hasText: 'beber agua' });
ok('el aviso nombra la tarea y lleva a ella', await avisoTarea.count() === 1 && (await avisoTarea.locator('.toast-accion').innerText()) === 'Ver');
await reposo(p);

// ── Automatizaciones y carpetas ─────────────────────────────────────────────
await p.evaluate(async () => {
  const opfs = await navigator.storage.getDirectory();
  const db = await import('/js/db.js');
  await db.set('fs', 'entrada', await opfs.getDirectoryHandle('entrada', { create: true }));
  await db.set('fs', 'salida', await opfs.getDirectoryHandle('salida', { create: true }));
  await (await import('/js/tools/watch.js')).add({ from: 'entrada', to: 'salida' });
});
await p.goto(BASE + '/#/tareas/automatizaciones', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.elffuss?.agent);
const seccion = p.locator('#panel-tareas [data-ruta="automatizaciones"]');
ok('#/tareas/automatizaciones lleva a la lista de automatizaciones', await hasta(async () =>
  await seccion.evaluate(e => e.classList.contains('resaltado')).catch(() => false)));
ok('…que enseña «entrada → salida» con su ✕', /entrada → salida/.test(await seccion.innerText())
  && await seccion.locator('button[aria-label="Quitar la automatización entrada → salida"]').count() === 1);
await p.evaluate(async () => (await import('/js/tools/watch.js')).add({ from: 'salida', to: 'entrada' }));
await p.click('#tabs button[data-tab="apps"]');
await p.click('#tabs button[data-tab="tareas"]');
await conTeclado(seccion.locator('button[aria-label="Quitar la automatización salida → entrada"]'));
ok('quitar una automatización con el teclado deja el foco en el ✕ de la que queda', await hasta(async () =>
  await seccion.locator('button[aria-label="Quitar la automatización salida → entrada"]').count() === 0
  && (await foco()) === 'Quitar la automatización entrada → salida'), await foco());

await p.click('#tabs button[data-tab="permisos"]');
ok('Permisos dice dónde escribe la Mente', await hasta(async () =>
  /La Mente guarda sus propuestas en la primera: «(entrada|salida)»/.test(await p.locator('#panel-permisos').innerText())));
p.__aceptar = false;
p.__dialogos = [];
await p.locator('#panel-permisos button[aria-label="Quitar la carpeta «entrada»"]').click();
await espera(200);
const pregunta = (p.__dialogos || []).join(' ');
ok('quitar una carpeta pregunta y nombra las automatizaciones que arrastra', /«entrada»/.test(pregunta) && /entrada → salida/.test(pregunta), pregunta);
ok('si dices que no, sigue ahí', await p.locator('#panel-permisos [data-ruta="entrada"]').count() === 1);
p.__aceptar = true;
await conTeclado(p.locator('#panel-permisos button[aria-label="Quitar la carpeta «entrada»"]'));
ok('si dices que sí, se quita con su automatización', await hasta(async () => await p.locator('#panel-permisos [data-ruta="entrada"]').count() === 0)
  && (await p.evaluate(async () => (await (await import('/js/tools/watch.js')).allWatches()).length)) === 0
  && (await avisos(p)).some(t => /automatización/.test(t)));
ok('…y el foco va al «Quitar» de la carpeta que queda (no a <body>)', await hasta(async () => (await foco()) === 'Quitar la carpeta «salida»'), await foco());

// Revocar un permiso: el foco va al «Revocar» del que queda en su sitio.
const revocables = () => p.locator('#panel-permisos .card[data-permiso]').count();
const antes = await revocables();
await conTeclado(p.locator('#panel-permisos .card[data-permiso] button').first());
ok('revocar con el teclado deja el foco en el «Revocar» del permiso que queda en su sitio', await hasta(async () =>
  await revocables() === antes - 1 && (await foco()) === 'Revocar'), await foco());

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
await fin(b, 'PANELES: apps con «Deshacer», tareas vivas, automatizaciones a la vista, carpetas que avisan');

// Borrar de verdad, y poder deshacerlo cuando toca.
//   · 🧹 (Nueva conversación): sin confirmación pero con «Deshacer» tras recargar;
//     el aviso de «restaurada» ofrece empezar de cero; la copia no sobrevive a
//     la siguiente carga. Su nombre accesible sale del idioma de la página.
//   · «Borrar todo del navegador»: tras borrar, lo de antes NO vuelve con el
//     siguiente mensaje (antes la conversación seguía en memoria y se volvía a
//     guardar entera).
//
//   BASE=http://localhost:8743 node tests/ux-borrar.mjs
import { navegador, contexto, pagina, ok, hasta, espera, escribir, reposo, avisos, fin, kv } from './ux-comun.mjs';

const b = await navegador();
const { ctx } = await contexto(b, { grants: ['apps', 'memory'] });
const { p, errores } = await pagina(ctx);
const listo = () => p.waitForFunction(() => !!window.elffuss?.agent, null, { timeout: 15000 });
const recargaTras = async accion => { await Promise.all([p.waitForNavigation({ waitUntil: 'domcontentloaded' }), accion()]); await listo(); };
const aviso = texto => p.locator('#toasts .toast', { hasText: texto });

ok('🧹 se llama «Nueva conversación» (title y aria-label)', await p.getAttribute('#btn-clear', 'aria-label') === 'Nueva conversación');
await escribir(p, 'hola, soy la conversación vieja');
await reposo(p);
ok('la conversación se guarda', (await kv(p, 'history'))?.some(m => /conversación vieja/.test(m.content)));

// ── 🧹 y «Deshacer» ─────────────────────────────────────────────────────────
await recargaTras(() => p.click('#btn-clear'));
ok('🧹 deja la conversación vacía', await hasta(async () => !(await p.locator('#log').innerText()).includes('conversación vieja')));
ok('…y ofrece «Deshacer»', await hasta(async () => await aviso('Conversación nueva').locator('.toast-accion').count() === 1));
await recargaTras(() => aviso('Conversación nueva').locator('.toast-accion').click());
ok('«Deshacer» la recupera', await hasta(async () => (await p.locator('#log').innerText()).includes('conversación vieja')));
ok('el aviso de restaurada ofrece «Nueva conversación»', await hasta(async () =>
  (await aviso('Conversación restaurada').locator('.toast-accion').innerText().catch(() => '')) === 'Nueva conversación'));
await recargaTras(() => aviso('Conversación restaurada').locator('.toast-accion').click());
ok('…y esa acción vuelve a empezar de cero', await hasta(async () => !(await p.locator('#log').innerText()).includes('conversación vieja')));
await p.reload({ waitUntil: 'domcontentloaded' });
await listo();
await espera(800);
ok('en la siguiente carga ya no hay copia que deshacer', !(await kv(p, 'historyBackup')) && await aviso('Conversación nueva').count() === 0);

// ── «Borrar todo del navegador» ─────────────────────────────────────────────
await escribir(p, 'hazme un reloj');
await reposo(p);
await escribir(p, 'recuerda que me gusta el té');
await reposo(p);
ok('antes de borrar: hay app, memoria y conversación', (await p.evaluate(async () => (await (await import('/js/db.js')).all('apps')).length)) === 1
  && (await kv(p, 'history'))?.length > 0);
await p.click('#tabs button[data-tab="ajustes"]');
const borrar = p.locator('#panel-ajustes button', { hasText: 'Borrar todo del navegador' });
await borrar.waitFor();
await recargaTras(() => borrar.click());
ok('tras borrar y recargar lo dice', await hasta(async () => (await avisos(p)).some(t => /Borrado del navegador/.test(t))));
ok('el chat solo tiene el saludo', !(await p.locator('#log').innerText()).includes('reloj') && await p.locator('#log .msg.user').count() === 0);
await escribir(p, 'hola de nuevo');
await reposo(p);
const hist = await kv(p, 'history');
ok('el siguiente mensaje NO devuelve la conversación borrada', Array.isArray(hist)
  && hist.every(m => m.content !== 'hazme un reloj' && !/me gusta el té/.test(m.content))
  && hist.some(m => /hola de nuevo/.test(m.content)), JSON.stringify(hist?.map(m => m.content.slice(0, 20))));
const resto = await p.evaluate(async () => {
  const db = await import('/js/db.js');
  return { apps: (await db.all('apps')).length, memoria: (await db.all('memory')).length, prompts: localStorage.getItem('elffuss.promptHistory') };
});
ok('apps y memoria borradas, y el historial de ↑/↓ empieza de cero', resto.apps === 0 && resto.memoria === 0 && !/reloj/.test(resto.prompts || ''), JSON.stringify(resto));

// ── en inglés, el nombre de 🧹 ──────────────────────────────────────────────
{
  const { ctx: c2 } = await contexto(b, { locale: 'en-US' });
  const { p: e } = await pagina(c2);
  ok('en-US: 🧹 se llama «New conversation»', await e.getAttribute('#btn-clear', 'aria-label') === 'New conversation');
  await c2.close();
}

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
await fin(b, 'BORRAR: 🧹 con «Deshacer» y «Borrar todo» que no se deshace solo');

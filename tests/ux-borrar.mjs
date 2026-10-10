// Borrar de verdad, y poder deshacerlo cuando toca.
//   · 🧹 (Nueva conversación): sin confirmación pero con «Deshacer» tras recargar;
//     el aviso de «restaurada» ofrece empezar de cero; la copia no sobrevive a
//     la siguiente carga. Su nombre accesible sale del idioma de la página.
//   · «Borrar todo del navegador»: tras borrar, lo de antes NO vuelve con el
//     siguiente mensaje (antes la conversación seguía en memoria y se volvía a
//     guardar entera), y es TODO: claves de API, permisos, carpetas, sus
//     automatizaciones, la bóveda (el aviso la nombra) y los ajustes.
//   · 🧹 con un mensaje en cola: «Deshacer» lo devuelve; y si ya habías empezado
//     otra conversación, no la tira: se intercambian.
//
//   BASE=http://localhost:8743 node tests/ux-borrar.mjs
import { createServer } from 'node:http';
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

// ── «Borrar todo» es TODO: claves de API, permisos, carpetas, automatizaciones… ─
// Contexto aparte que no vuelve a sembrar permisos ni modelo en cada carga (el
// de arriba los pone en cada navegación y taparía lo que se quiere comprobar).
{
  const { ctx: c3 } = await contexto(b, { model: null, grants: null });
  const { p: w, errores: errW } = await pagina(c3);
  await w.evaluate(async () => {
    const db = await import('/js/db.js');
    const opfs = await navigator.storage.getDirectory();
    await db.set('fs', 'carpeta-privada', opfs);
    await db.set('kv', 'automations', [{ id: 'wprueba', from: 'carpeta-privada', to: 'carpeta-privada' }]);
    await db.set('kv', 'workspace-handle', opfs);
    for (const k of ['__salt', '__check', 's:banco']) await db.set('vault', k, 'cifrado-de-prueba');
    const ls = {
      'elffuss.providers': JSON.stringify({ openai: { enabled: true, apiKey: 'sk-PRUEBA-NO-REAL-123' } }),
      'elffuss.grants': JSON.stringify(['apps', 'memory', 'fs', 'web']),
      'elffuss.ceoMission': 'mision secreta', 'elffuss.ceoProfiles': '[]', 'elffuss.ceoDir': '.elffuss/soul',
      'elffuss.velocimetro.v1': JSON.stringify({ hist: [{ p: 1, g: 1, t: 1 }] }),
      'elffuss.workspace.autosave': '1', 'elffuss.movil.ok': '1', 'elffuss.telemetry.elffuss-claw': '1',
    };
    for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
  });
  await w.click('#tabs button[data-tab="ajustes"]');
  const wipe = w.locator('#panel-ajustes button', { hasText: 'Borrar todo del navegador' });
  await wipe.waitFor();
  await Promise.all([w.waitForNavigation({ waitUntil: 'domcontentloaded' }), wipe.click()]);
  await w.waitForFunction(() => !!window.elffuss?.agent, null, { timeout: 15000 });
  const confirmacion = (w.__dialogos || []).join('\n');
  ok('el aviso de «Borrar todo» nombra la bóveda y lo que se queda', /BÓVEDA/.test(confirmacion) && /secretos/.test(confirmacion)
    && /Se queda: los modelos descargados/.test(confirmacion), confirmacion.slice(0, 200));
  const queda = await w.evaluate(async () => {
    const db = await import('/js/db.js');
    const r = {};
    for (const s of ['fs', 'vault']) r[s] = await db.keys(s);
    r.automations = await db.get('kv', 'automations');
    r.workspace = !!(await db.get('kv', 'workspace-handle'));
    r.ls = Object.keys(localStorage).filter(k => k.startsWith('elffuss.')).sort();
    return r;
  });
  ok('tras borrar no queda ni la carpeta autorizada, ni la bóveda, ni sus automatizaciones ni la carpeta de trabajo',
    !queda.fs.length && !queda.vault.length && !queda.automations && !queda.workspace, JSON.stringify(queda));
  const restos = queda.ls.filter(k => !['elffuss.welcomed', 'elffuss.model'].includes(k));
  ok('ni claves de API, permisos, misión de la Mente, velocímetro o ajustes en localStorage (solo la bienvenida)',
    restos.length === 0, JSON.stringify(queda.ls));
  ok('borrar todo no deja errores de página', errW.length === 0, errW.slice(0, 3).join(' | '));
  await c3.close();
}

// ── 🧹 con trabajo pendiente, y «Deshacer» con una conversación nueva ya empezada ─
// Un cerebro de verdad (servidor de mentira local) para tener un turno en marcha
// y un mensaje esperando en la cola cuando se pulsa 🧹.
{
  const peticiones = [];
  const servidor = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    let cuerpo = '';
    req.on('data', d => { cuerpo += d; });
    req.on('end', () => {
      let msgs = [];
      try { msgs = JSON.parse(cuerpo).messages || []; } catch { /* */ }
      const ultimo = msgs.filter(m => m.role === 'user').at(-1)?.content || '';
      peticiones.push(ultimo);
      const responder = () => {
        res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'respuesta a ' + ultimo.slice(0, 30) } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      };
      if (/LENTO/.test(ultimo)) setTimeout(responder, 4000); else responder();
    });
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const puerto = servidor.address().port;
  const { ctx: c4 } = await contexto(b, {
    model: 'ext:ollama',
    extraInit: { 'elffuss.providers': JSON.stringify({ ollama: { enabled: true, baseURL: `http://127.0.0.1:${puerto}/v1`, model: 'falso', apiKey: 'ollama' } }) },
  });
  const { p: q } = await pagina(c4);
  const listoQ = () => q.waitForFunction(() => !!window.elffuss?.agent, null, { timeout: 15000 });
  const trasRecargar = async accion => { await Promise.all([q.waitForNavigation({ waitUntil: 'domcontentloaded' }), accion()]); await listoQ(); };
  const avisoQ = texto => q.locator('#toasts .toast', { hasText: texto });
  await hasta(() => q.evaluate(() => document.getElementById('model-select').value === 'ext:ollama'), { veces: 200 });
  await escribir(q, 'hola VIEJO-HILO');
  await reposo(q);
  await escribir(q, 'LENTO en marcha');
  await hasta(() => peticiones.some(t => /LENTO en marcha/.test(t)));
  await escribir(q, 'PENDIENTE-EN-COLA dos');
  ok('con un turno en marcha, el segundo mensaje espera en la cola', (await kv(q, 'queue'))?.some(x => /PENDIENTE-EN-COLA/.test(x.text || x)));
  await trasRecargar(() => q.click('#btn-clear'));
  await hasta(async () => await avisoQ('Conversación nueva').count() === 1);
  await escribir(q, 'NUEVO-HILO importante');
  await reposo(q);
  const n = peticiones.length;
  await trasRecargar(() => avisoQ('Conversación nueva').locator('.toast-accion').click());
  ok('«Deshacer» recupera la conversación anterior', await hasta(async () => (await q.locator('#log').innerText()).includes('VIEJO-HILO')));
  ok('…y el mensaje que esperaba en la cola vuelve y se procesa', await hasta(() =>
    peticiones.slice(n).some(t => /PENDIENTE-EN-COLA/.test(t)), { veces: 400 }), JSON.stringify(peticiones.slice(n)));
  ok('la conversación empezada después NO se pierde: el aviso ofrece volver a ella', await hasta(async () =>
    await avisoQ('La que empezaste después').locator('.toast-accion').count() === 1));
  const copia = await kv(q, 'historyBackup');
  ok('…y está guardada como copia', JSON.stringify(copia || '').includes('NUEVO-HILO'));
  await reposo(q);
  await trasRecargar(() => avisoQ('La que empezaste después').locator('.toast-accion').click());
  ok('«Deshacer» otra vez vuelve a la conversación nueva', await hasta(async () => (await q.locator('#log').innerText()).includes('NUEVO-HILO')));
  await c4.close();
  servidor.close();
}

// ── en inglés, el nombre de 🧹 y el aviso de «Borrar todo» ──────────────────
{
  const { ctx: c2 } = await contexto(b, { locale: 'en-US' });
  const { p: e } = await pagina(c2);
  ok('en-US: 🧹 se llama «New conversation»', await e.getAttribute('#btn-clear', 'aria-label') === 'New conversation');
  const txt = await e.evaluate(async () => (await import('/js/i18n.js')).t('wsWipeConfirm'));
  ok('en-US: the wipe confirm names the vault and what is kept', /VAULT/.test(txt) && /Kept: downloaded models/.test(txt), txt.slice(0, 120));
  await c2.close();
}

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
await fin(b, 'BORRAR: 🧹 con «Deshacer» y «Borrar todo» que no se deshace solo');

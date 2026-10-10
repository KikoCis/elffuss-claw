// El botón ■ de Claw, de punta a punta (UI → kernel → agente → proveedor → red).
// ─────────────────────────────────────────────────────────────────────────────
// Sin GPU: el cerebro es un proveedor externo «local» (el de Ollama en Ajustes)
// que apunta a un servidor de mentira levantado aquí mismo, en un puerto que da
// el sistema. Ese servidor contesta en streaming SSE como uno compatible con
// OpenAI y lo hace DESPACIO, así que hay tiempo de pulsar ■; y apunta qué
// peticiones le llegan y cuáles cortó el navegador a medias. Se comprueba:
//   · mientras trabaja, #send es ■ (icono, clase, título y aria de parar);
//   · Enter con texto mientras trabaja sigue mandando A LA COLA (no para);
//   · pulsar ■ corta la descarga en curso, avisa «(Parado.)» sin error, tacha lo
//     que esperaba en la cola, guarda la cola VACÍA y el botón vuelve a ➤;
//   · lo que se envía justo después de parar no se pierde (sale de la cola por
//     identidad, no con shift);
//   · tras recargar no se reanuda nada de lo parado;
//   · Hard Work también se para (y no dice «Hard Work falló»);
//   · 🧹 con un turno en marcha lo para primero y la conversación no vuelve;
//   · un AbortError del proveedor sin pulsar ■ (el motor al descargarse) es
//     «(Parado.)» en el chat y en Hard Work, no un fallo;
//   · ■ en el instante en que la cola guarda el intento no deja procesar ese
//     mensaje;
//   · reenviar lo mismo que acabas de parar y recargar a mitad NO pierde el
//     reintento, y lo ya hecho no se repite (la cola se deduplica por id);
//   · con un cerebro que tarda en soltar, ■ dice «Parando…» (sin más clics, sin
//     perder el foco, anunciado en una región viva) y lo escrito se conserva;
//   · 🧹 se nota al momento: botón ocupado, aviso y la conversación fuera de la
//     vista, aunque el turno tarde en soltar.
//
//   python3 server/serve.py 8742 &   BASE=http://localhost:8742 node tests/stop-ui.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';

const BASE = process.env.BASE || 'http://localhost:8742';
const OUT = process.env.SCRATCH || '';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const espera = ms => new Promise(r => setTimeout(r, ms));
async function hasta(cond, { veces = 200, cada = 50 } = {}) {
  for (let i = 0; i < veces; i++) { if (await cond()) return true; await espera(cada); }
  return false;
}

// ── servidor de mentira (OpenAI-compatible, streaming lento) ─────────────────
const peticiones = [];   // { ultimo, cortada, terminada, enviados }
const servidor = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  let cuerpo = '';
  req.on('data', d => { cuerpo += d; });
  req.on('end', () => {
    let msgs = [];
    try { msgs = JSON.parse(cuerpo).messages || []; } catch { /* */ }
    const ultimo = [...msgs].reverse().find(m => m.role === 'user')?.content || '';
    const p = { ultimo, cortada: false, terminada: false, enviados: 0 };
    peticiones.push(p);
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const rapido = /rápido/.test(ultimo);
    const total = rapido ? 3 : 2000;
    const t = setInterval(() => {
      if (p.enviados >= total) {
        clearInterval(t);
        res.write('data: [DONE]\n\n'); res.end(); p.terminada = true;
        return;
      }
      p.enviados++;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: rapido ? 'vale ' : 'palabra ' } }] })}\n\n`);
    }, 40);
    res.on('close', () => { clearInterval(t); if (!p.terminada) p.cortada = true; });
  });
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const PUERTO = servidor.address().port;

// ── navegador ───────────────────────────────────────────────────────────────
const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(puerto => {
  try {
    localStorage.setItem('elffuss.welcomed', '1');
    localStorage.setItem('elffuss.grants', JSON.stringify(['fs', 'apps', 'vault', 'tasks', 'web', 'memory']));
    localStorage.setItem('elffuss.providers', JSON.stringify({
      ollama: { enabled: true, baseURL: `http://localhost:${puerto}/v1`, model: 'falso', apiKey: 'ollama' },
    }));
    localStorage.setItem('elffuss.model', 'ext:ollama');
  } catch {}
}, PUERTO);
const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
const errores = [];
p.on('pageerror', e => { if (!/allow-same-origin/.test(e.message)) errores.push(e.message); });

const kv = key => p.evaluate(async k => (await import('/js/db.js')).get('kv', k), key);
const boton = () => p.evaluate(() => {
  const s = document.getElementById('send');
  return { stop: s.classList.contains('is-stop'), type: s.type, title: s.title, aria: s.getAttribute('aria-label'), cuadrado: !!s.querySelector('rect') };
});
const escribir = async (texto) => { await p.fill('#prompt', texto); await p.press('#prompt', 'Enter'); };
const listo = async () => {
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  return hasta(() => p.evaluate(() => document.getElementById('model-select')?.value === 'ext:ollama'
    && document.getElementById('model-status')?.classList.contains('on')));
};

ok('el cerebro de prueba (Ollama local → servidor de mentira) queda cargado', await listo());
ok('en reposo, #send es ➤ (submit, «Enviar»)', await boton().then(x => !x.stop && x.type === 'submit' && x.title === 'Enviar' && x.aria === 'Enviar'));

// ── 1 · chat: ■ aparece, Enter con texto encola, ■ para ─────────────────────
await escribir('escribe un poema larguísimo sobre el mar');
ok('mientras trabaja, #send es ■ con título y aria «Parar»', await hasta(async () => {
  const x = await boton(); return x.stop && x.cuadrado && x.title === 'Parar' && x.aria === 'Parar' && x.type === 'button';
}));
await hasta(() => peticiones.length >= 1 && peticiones[0].enviados >= 5);
await escribir('y luego otro sobre la montaña');
await escribir('y uno más sobre el bosque');
const encolados = await p.locator('.msg.user.queued').count();
ok('Enter con texto mientras trabaja manda a la cola (no para)', encolados === 2 && !peticiones[0].cortada,
  `${encolados} en cola · cortada=${peticiones[0].cortada}`);
if (OUT) await p.screenshot({ path: OUT + '/stop-ui-trabajando.png' });
const colaAntes = await kv('queue');
ok('la cola persistida tiene el turno en curso y los dos que esperan', Array.isArray(colaAntes) && colaAntes.length === 3, JSON.stringify(colaAntes));

await p.click('#send');
ok('■ corta la descarga en curso (el servidor ve la conexión cerrada a medias)', await hasta(() => peticiones[0].cortada));
ok('avisa «(Parado.)» sin pintar un error', await hasta(async () =>
  (await p.locator('.msg.assistant.muted').allTextContents()).some(t => t.includes('(Parado.)'))) &&
  await p.locator('.msg.assistant.err').count() === 0);
ok('el botón vuelve a ser ➤', await hasta(async () => { const x = await boton(); return !x.stop && x.type === 'submit' && x.title === 'Enviar'; }));
ok('la burbuja de «pensando» desaparece', await p.locator('.msg.thinking').count() === 0);
ok('lo que esperaba en la cola queda tachado, no pendiente',
  await p.locator('.msg.user.cancelled').count() === 2 && await p.locator('.msg.user.queued').count() === 0);
ok('  …y lo dice con palabras para un lector de pantalla (no solo el tachado)',
  (await p.locator('.msg.user.cancelled .sr-only').allTextContents()).filter(t => t.includes('(cancelado: no se procesará)')).length === 2);
ok('  el aviso cuenta los mensajes de la cola cancelados', (await p.locator('.msg.assistant.muted').allTextContents())
  .some(t => t.includes('(Parado.) 2 mensaje(s) en cola cancelado(s).')));
ok('  lo que llegó a escribir se queda en el chat, apagado (no desaparece con la burbuja)',
  (await p.locator('.msg.assistant.muted.partial').allTextContents()).some(t => t.includes('palabra')));
ok('la cola persistida queda VACÍA', await hasta(async () => { const q = await kv('queue'); return Array.isArray(q) && q.length === 0; }));
await espera(400);
if (OUT) await p.screenshot({ path: OUT + '/stop-ui-parado.png' });
ok('no sale ni una petición más al modelo (ni el siguiente paso ni lo encolado)', peticiones.length === 1, `${peticiones.length} peticiones`);
const hist = await kv('history');
ok('el histórico guarda la petición parada (y nada a medio generar)',
  Array.isArray(hist) && hist.at(-1)?.role === 'user' && /poema larguísimo/.test(hist.at(-1)?.content || ''), JSON.stringify(hist?.map(m => m.role)));

// ── 2 · lo que se envía justo después de parar no se pierde ─────────────────
await escribir('escribe otro poema largo');
await hasta(() => peticiones.length >= 2 && peticiones[1].enviados >= 3);
// Parar y enviar en el MISMO instante: el turno parado aún no ha terminado de
// soltarse cuando el mensaje nuevo entra en la cola. Con shift() se perdía.
await p.evaluate(() => { document.getElementById('send').click(); window.elffuss.send('contesta rápido'); });
ok('el mensaje enviado justo después de parar se procesa', await hasta(() =>
  peticiones.some(x => /contesta rápido/.test(x.ultimo) && x.terminada)), peticiones.map(x => x.ultimo.slice(0, 20)).join(' | '));
ok('  y su respuesta llega al chat', await hasta(async () =>
  (await p.locator('.msg.assistant').allTextContents()).some(t => t.includes('vale vale vale'))));
ok('  el turno anterior sí quedó cortado', peticiones[1].cortada);
ok('  y al terminar la cola queda vacía y el botón en ➤', await hasta(async () => {
  const q = await kv('queue'); const x = await boton(); return Array.isArray(q) && !q.length && !x.stop;
}));

// ── 3 · tras recargar no se reanuda nada ─────────────────────────────────────
const antesDeRecargar = peticiones.length;
ok('recarga: el cerebro vuelve a quedar listo', await listo());
await espera(1500);
ok('tras recargar no se reanuda lo parado (ninguna petición nueva)', peticiones.length === antesDeRecargar, `${peticiones.length - antesDeRecargar} nuevas`);
ok('  ni aparecen mensajes pendientes en la cola', await p.locator('.msg.user.queued').count() === 0);
ok('  y la conversación restaurada conserva lo que se dijo',
  (await p.locator('#log').innerText()).includes('poema larguísimo'));

// ── 4 · Hard Work también se para ───────────────────────────────────────────
await p.click('#btn-hardwork');
const hwInicio = peticiones.length;   // ANTES de enviar: la petición puede llegar enseguida
await escribir('hazme un juego de naves');
ok('Hard Work: el botón pasa a ■', await hasta(async () => (await boton()).stop));
await hasta(() => peticiones.length > hwInicio && peticiones.at(-1).enviados >= 3);
await p.click('#send');
ok('Hard Work: ■ corta la llamada en curso', await hasta(() => peticiones.at(-1).cortada));
ok('Hard Work: avisa «(Parado.)» y no «Hard Work falló»', await hasta(async () =>
  (await p.locator('.msg.assistant.muted').allTextContents()).some(t => t.includes('(Parado.)'))) &&
  !(await p.locator('#log').innerText()).includes('Hard Work falló'));
await espera(400);
ok('Hard Work: no hace la autocrítica ni la reescritura después de parar', peticiones.length === hwInicio + 1, `${peticiones.length - hwInicio} llamadas`);
ok('Hard Work: el botón vuelve a ➤', await hasta(async () => !(await boton()).stop));
await p.click('#btn-hardwork');   // apagar Hard Work

// ── 5 · 🧹 con un turno en marcha ───────────────────────────────────────────
const limpiaInicio = peticiones.length;
await escribir('cuéntame una historia interminable');
await hasta(() => peticiones.length > limpiaInicio && peticiones.at(-1).enviados >= 3);
await Promise.all([p.waitForNavigation({ waitUntil: 'domcontentloaded' }), p.click('#btn-clear')]);
ok('🧹: el turno en marcha se corta antes de borrar', peticiones.at(-1).cortada);
await hasta(() => p.evaluate(() => document.getElementById('model-status')?.classList.contains('on')));
await espera(1200);
const histTrasLimpiar = await kv('history');
ok('🧹: tras recargar, la conversación borrada NO vuelve', !histTrasLimpiar || !histTrasLimpiar.length, JSON.stringify(histTrasLimpiar?.map(m => m.content.slice(0, 20))));
ok('🧹: el log solo tiene el saludo', !(await p.locator('#log').innerText()).includes('historia interminable'));
ok('🧹: y no se reanuda nada', peticiones.length === limpiaInicio + 1, `${peticiones.length - limpiaInicio} peticiones`);

// ── 6 · en inglés, el botón y el aviso también se traducen ──────────────────
{
  const ctxEn = await b.newContext({ locale: 'en-US' });
  await ctxEn.addInitScript(() => { try { localStorage.setItem('elffuss.model', 'rules'); localStorage.setItem('elffuss.welcomed', '1'); } catch {} });
  const pe = await ctxEn.newPage();
  await pe.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await pe.waitForFunction(() => !!window.elffuss?.agent, null, { timeout: 15000 });
  const en = await pe.evaluate(async () => {
    const { t } = await import('/js/i18n.js');
    const s = document.getElementById('send');
    return { title: s.title, aria: s.getAttribute('aria-label'), stop: t('stop'), stopped: t('stopped') };
  });
  ok('en-US: «Send» en reposo y «Stop» / «(Stopped.)» al parar', en.title === 'Send' && en.aria === 'Send' && en.stop === 'Stop' && en.stopped === '(Stopped.)',
    JSON.stringify(en));
  await ctxEn.close();
}

// ── 7 · el proveedor corta solo (el motor propio al descargarse) ────────────
// unload() del motor corta el turno en marcha y rechaza con AbortError sin que
// nadie haya pulsado ■. En el chat y en Hard Work es «(Parado.)», no un fallo.
{
  await p.evaluate(() => {
    const abortError = () => Object.assign(new Error('turno parado a petición'), { name: 'AbortError' });
    window.__provAntes = window.elffuss.agent.provider;
    window.elffuss.agent.setProvider({ chat: async (h, s, cb) => { cb('algo '); await new Promise(r => setTimeout(r, 150)); throw abortError(); } });
  });
  const avisosAntes = (await p.locator('.msg.assistant.muted').allTextContents()).filter(t => t.includes('(Parado.)')).length;
  await escribir('pregunta con el motor a punto de descargarse');
  ok('7 · AbortError del proveedor sin ■: el chat avisa «(Parado.)»', await hasta(async () =>
    (await p.locator('.msg.assistant.muted').allTextContents()).filter(t => t.includes('(Parado.)')).length === avisosAntes + 1));
  ok('7 · …y no pinta «El modelo falló»', !(await p.locator('#log').innerText()).includes('El modelo falló'));
  await hasta(async () => !(await boton()).stop);
  await p.click('#btn-hardwork');
  await escribir('hazme un juego con el motor a punto de descargarse');
  ok('7 · Hard Work: el mismo AbortError avisa «(Parado.)»', await hasta(async () =>
    (await p.locator('.msg.assistant.muted').allTextContents()).filter(t => t.includes('(Parado.)')).length === avisosAntes + 2));
  ok('7 · …y no dice «Hard Work falló»', !(await p.locator('#log').innerText()).includes('Hard Work falló'));
  await hasta(async () => !(await boton()).stop);
  await p.click('#btn-hardwork');
  await p.evaluate(() => window.elffuss.agent.setProvider(window.__provAntes));
}

// ── 8 · ■ justo mientras la cola guarda el intento, antes de empezar ─────────
// La cola cuenta y GUARDA cada intento antes de procesar (await), y un ■ puede
// caer en esa espera. Ese mensaje ya no debe procesarse: se pararía con un
// controlador nuevo que nadie aborta. Se pulsa ■ desde dentro del put() de
// IndexedDB que guarda el intento, que es exactamente ese momento.
{
  const TXT = 'mensaje parado mientras se guardaba';
  await p.evaluate(txt => {
    const put = IDBObjectStore.prototype.put;
    window.__putAntes = put;
    IDBObjectStore.prototype.put = function (val, key) {
      if (key === 'queue' && Array.isArray(val) && val[0]?.text === txt && val[0]?.intentos === 1 && !window.__paradoAlGuardar) {
        window.__paradoAlGuardar = true;
        document.getElementById('send').click();   // ■
      }
      return put.call(this, val, key);
    };
  }, TXT);
  const ini = peticiones.length;
  await p.evaluate(txt => window.elffuss.send(txt), TXT);
  await hasta(async () => !(await boton()).stop);
  await espera(600);
  const r8 = await p.evaluate(txt => {
    IDBObjectStore.prototype.put = window.__putAntes;
    return { pulsado: !!window.__paradoAlGuardar,
      tachado: [...document.querySelectorAll('.msg.user.cancelled')].some(d => d.textContent.startsWith(txt)) };
  }, TXT);
  ok('8 · ■ pulsado mientras se guardaba el intento', r8.pulsado);
  ok('8 · ese mensaje no llega a procesarse (ninguna petición)', peticiones.length === ini, `${peticiones.length - ini} peticiones`);
  ok('8 · queda tachado como lo demás que se paró, y la cola vacía', r8.tachado &&
    await hasta(async () => { const q = await kv('queue'); return Array.isArray(q) && q.length === 0; }));
}

// ── 9 · el reintento de lo que acabas de parar sobrevive a una recarga ──────
// Lo natural tras parar es mandar lo mismo otra vez. La cola deduplicaba al
// recargar comparando el TEXTO con el del último turno terminado (lastDone),
// que era justo el parado: el reintento se tiraba sin decir nada.
{
  const TXT = 'escribe un poema sobre el faro';
  const ini = peticiones.length;
  await escribir(TXT);
  await hasta(() => peticiones.length > ini && peticiones.at(-1).enviados >= 3);
  await p.click('#send');
  await hasta(async () => !(await boton()).stop);
  await escribir(TXT);                                     // el reintento
  await hasta(() => peticiones.length > ini + 1 && peticiones.at(-1).enviados >= 3);
  const antesDeRecargar = peticiones.length;
  await listo();                                           // recarga a mitad del reintento
  ok('9 · tras recargar, el reintento (mismo texto que lo parado) se reanuda', await hasta(() =>
    peticiones.slice(antesDeRecargar).some(x => x.ultimo === TXT)), `${peticiones.length - antesDeRecargar} peticiones tras recargar`);
  await hasta(() => peticiones.length > antesDeRecargar && peticiones.at(-1).enviados >= 2);
  await p.click('#send');                                  // y se para, para seguir
  await hasta(async () => !(await boton()).stop);
}

// ── 10 · lo que ya se hizo no se repite al recargar (por id, no por texto) ───
{
  await p.evaluate(async () => {
    const db = await import('/js/db.js');
    await db.set('kv', 'lastDone', { id: 'ya-hecho', text: 'ya estaba hecho, rápido' });
    await db.set('kv', 'queue', [{ id: 'ya-hecho', text: 'ya estaba hecho, rápido', intentos: 1 }]);
  });
  const ini = peticiones.length;
  await listo();
  await espera(1500);
  ok('10 · un mensaje de la cola con el id del último terminado no se repite al recargar', peticiones.length === ini &&
    await p.locator('.msg.user.queued').count() === 0, `${peticiones.length - ini} peticiones`);
}

// ── 11 · «Parando…» mientras el cerebro tarda en soltar ─────────────────────
// Con un cerebro que no suelta al momento, el ■ seguía rojo, «Parar» y pulsable
// tras el clic: parecía que no había hecho caso. Ahora dice «Parando…», no
// acepta más clics, conserva el foco del teclado y lo anuncia; al soltar vuelve
// a ➤ y anuncia «(Parado.)».
const cerebroLento = () => p.evaluate(() => {
  window.__provAntes = window.elffuss.agent.provider;
  window.__lento = { soltar: null };
  window.elffuss.agent.setProvider({ chat: async (h, s, cb, opts) => {
    for (let i = 0; i < 400 && !opts?.signal?.aborted; i++) { cb('palabra' + i + ' '); await new Promise(r => setTimeout(r, 20)); }
    // tarda en soltar después de parar: hasta que la prueba lo suelte, o un rato
    await new Promise(r => { window.__lento.soltar = r; setTimeout(r, 2000); });
    return 'esto no se usa';
  } });
});
{
  await cerebroLento();
  await escribir('escribe algo largo con un cerebro que tarda en soltar');
  await hasta(() => p.evaluate(() => (document.querySelector('.msg.thinking .gen')?.textContent || '').includes('palabra3')));
  await p.focus('#send');
  await p.keyboard.press('Enter');             // ■ con el teclado
  const st = await p.evaluate(() => {
    const s = document.getElementById('send');
    return { clase: s.className, titulo: s.title, aria: s.getAttribute('aria-label'), ocupado: s.getAttribute('aria-busy'),
      inactivo: s.getAttribute('aria-disabled'), disabled: s.disabled, foco: document.activeElement === s,
      burbuja: document.querySelector('.msg.thinking .label')?.textContent || null };
  });
  ok('11 · tras ■, el botón dice «Parando…» (clase, título, aria-busy, aria-disabled) y no pierde el foco',
    st.clase.includes('is-stopping') && st.titulo === 'Parando…' && st.aria === 'Parando…' && st.ocupado === 'true'
    && st.inactivo === 'true' && !st.disabled && st.foco, JSON.stringify(st));
  ok('11 · …y la burbuja también dice «Parando…»', st.burbuja === 'Parando…', st.burbuja);
  ok('11 · la región viva lo anuncia', await hasta(() => p.evaluate(() => document.getElementById('stop-status')?.textContent === 'Parando…')));
  // (Playwright espera a que un botón aria-disabled se habilite antes de pulsar:
  // el clic se da desde la página, que es lo que haría un usuario impaciente.)
  await p.evaluate(() => document.getElementById('send').click());
  ok('11 · otro clic mientras se para no hace nada', await p.evaluate(() => document.getElementById('send').classList.contains('is-stopping')));
  await p.evaluate(() => window.__lento.soltar?.());
  ok('11 · cuando suelta, vuelve a ➤ «Enviar»', await hasta(async () => { const x = await boton(); return !x.stop && x.title === 'Enviar' && x.aria === 'Enviar'; }));
  ok('11 · y la región viva anuncia «(Parado.)»', await hasta(() => p.evaluate(() => document.getElementById('stop-status')?.textContent === '(Parado.)')));
  ok('11 · lo que llegó a escribir se queda, apagado', (await p.locator('.msg.assistant.muted.partial').allTextContents()).some(t => t.includes('palabra3')));
  await p.evaluate(() => window.elffuss.agent.setProvider(window.__provAntes));
}

// ── 12 · 🧹 se nota al momento, aunque el turno tarde en soltar ──────────────
{
  await cerebroLento();
  await escribir('cuéntame algo larguísimo antes de borrar');
  await hasta(() => p.evaluate(() => (document.querySelector('.msg.thinking .gen')?.textContent || '').includes('palabra3')));
  const navegacion = p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await p.click('#btn-clear');
  const ya = await p.evaluate(() => ({
    ocupado: document.getElementById('btn-clear').getAttribute('aria-busy'),
    aviso: [...document.querySelectorAll('#toasts .toast')].some(t => t.textContent === 'Borrando la conversación…'),
    log: [...document.getElementById('log').children].map(e => e.className),
    enviar: document.getElementById('send').title,
  }));
  ok('12 · al pulsar 🧹: el botón queda ocupado y sale el aviso «Borrando la conversación…»', ya.ocupado === 'true' && ya.aviso, JSON.stringify(ya));
  ok('12 · la conversación sale de la vista al momento (queda el saludo)', ya.log.length === 1 && /\bsys\b/.test(ya.log[0]), JSON.stringify(ya.log));
  ok('12 · y ■ dice «Parando…» mientras el turno suelta', ya.enviar === 'Parando…', ya.enviar);
  await navegacion;
  await hasta(() => p.evaluate(() => document.getElementById('model-status')?.classList.contains('on')));
  const hist12 = await kv('history');
  ok('12 · tras recargar, la conversación borrada no vuelve', !hist12 || !hist12.length, JSON.stringify(hist12?.map(m => m.content.slice(0, 20))));
}

if (OUT) { await p.screenshot({ path: OUT + '/stop-ui.png' }); console.log('captura → stop-ui.png'); }
ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ ■ PARA DE VERDAD: la red, el agente, Hard Work, la cola y 🧹');
await b.close();
servidor.close();
process.exit(fails ? 1 : 0);

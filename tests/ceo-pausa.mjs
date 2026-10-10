// Pausar el cerebro CEO (o volver a usar la app) mientras tick() espera a
// isReady() — sin GPU, con un espacio de trabajo y un proveedor de mentira.
// ─────────────────────────────────────────────────────────────────────────────
// tick() miraba si tocaba ciclo, esperaba a ws.isReady() —en Claw es asíncrona:
// consulta IndexedDB— y después solo volvía a mirar `running`. Una pausa o
// actividad del usuario que llegara durante esa espera se perdía: aún no había
// ciclo, así que interrupt() no tenía nada que parar, y arrancaba un ciclo
// entero —tres llamadas al modelo y una propuesta escrita— con el cerebro en
// pausa. Se comprueba, con isReady() retenida hasta que la prueba la suelta:
//   1. pausar durante la espera: no arranca ningún ciclo ni se escribe nada;
//   2. actividad del usuario durante la espera: tampoco;
//   3. control: sin nada de eso, el ciclo sí arranca y escribe su propuesta.
//
//   python3 server/serve.py 8742 &   BASE=http://localhost:8742 node tests/ceo-pausa.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8742';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffuss.model', 'rules'); localStorage.setItem('elffuss.welcomed', '1'); } catch {} });
const p = await ctx.newPage();
const errores = [];
p.on('pageerror', e => { if (!/allow-same-origin/.test(e.message)) errores.push(e.message); });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.elffuss?.agent, null, { timeout: 15000 });

// Prepara el cerebro con isReady() retenida y devuelve cuándo se ha pedido.
await p.evaluate(async () => {
  const ceo = await import('/js/ceo.js');
  const st = (window.__st = { listo: null, llamadasReady: 0, llamadas: 0, escritos: 0, eventos: [] });
  ceo.init({
    workspace: {
      isReady: () => { st.llamadasReady++; return new Promise(r => { st.listo = r; }); },
      tree: async () => 'a.txt', list: async () => [], read: async () => '', remove: async () => {},
      write: async () => { st.escritos++; },
    },
    provider: () => ({ chat: async () => { st.llamadas++; return 'Una propuesta concreta y accionable para el espacio de trabajo.'; } }),
    isBusy: () => false,
    onEvent: (ch, ev) => { if (ch === 'ceo') st.eventos.push(ev.type); },
  });
  const t0 = Date.now();
  while (!ceo.isThisTabLeader() && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 50));
});

// Arranca el cerebro, espera a que tick() esté esperando isReady(), hace
// `durante` (pausar, actividad o nada), suelta isReady() y mira qué pasa.
const ronda = durante => p.evaluate(async durante => {
  const ceo = await import('/js/ceo.js');
  const st = window.__st;
  Object.assign(st, { listo: null, llamadas: 0, escritos: 0, eventos: [] });
  const antesReady = st.llamadasReady;
  ceo.enable();
  ceo.setMission('revisar el espacio');   // ocioso y sin enfriamiento: el próximo tick toca ciclo
  for (let i = 0; i < 200 && st.llamadasReady === antesReady; i++) await new Promise(r => setTimeout(r, 25));
  const esperando = st.llamadasReady > antesReady;
  if (durante === 'pausar') ceo.disable();
  if (durante === 'actividad') ceo.noteActivity();
  st.listo?.(true);
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 25));
    if (st.escritos) break;
  }
  await new Promise(r => setTimeout(r, 300));
  const res = { esperando, llamadas: st.llamadas, escritos: st.escritos, eventos: st.eventos.slice(), corriendo: ceo.isRunning() };
  ceo.disable();
  for (let i = 0; i < 80 && ceo.isRunning(); i++) await new Promise(r => setTimeout(r, 25));
  return res;
}, durante);

const pausa = await ronda('pausar');
ok('1 · tick() estaba esperando a isReady() cuando se pausó', pausa.esperando);
ok('1 · pausar durante esa espera: no arranca ningún ciclo ni llama al modelo', pausa.llamadas === 0 && !pausa.eventos.includes('cycle'), JSON.stringify(pausa));
ok('1 · …ni escribe una propuesta', pausa.escritos === 0 && !pausa.eventos.includes('built'), JSON.stringify(pausa));

const actividad = await ronda('actividad');
ok('2 · actividad del usuario durante la espera: tampoco arranca', actividad.esperando && actividad.llamadas === 0 && actividad.escritos === 0,
  JSON.stringify(actividad));

const control = await ronda('nada');
ok('3 · control: sin pausa ni actividad, el ciclo arranca y escribe su propuesta', control.esperando && control.llamadas > 0 && control.escritos === 1,
  JSON.stringify(control));

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ CEO: una pausa o actividad durante isReady() no deja arrancar un ciclo');
await b.close();
process.exit(fails ? 1 : 0);

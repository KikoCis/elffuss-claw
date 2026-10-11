// PARAR con el modelo REAL (Gemma-4 E4B por LiteRT-LM 0.15.0, WebGPU).
//
// tests/litert-stop.mjs y tests/litert-conversacion.mjs fijan la lógica con un
// motor de mentira. Lo que solo se sabe con el de verdad: que cancel() corta,
// que una conversación cancelada no se puede reutilizar (la sesión «avanzada»
// queda envenenada) y que, al tirarla, el turno siguiente contesta en una nueva
// —sin el reintento de «no cupo», que la rehacía compactada y con pérdida— y sin
// heredar la respuesta parada.
//
// Prueba de GPU: no va en la suite normal. Requisitos (los de Elffuss Code):
//   · adaptador WebGPU real y el Chrome instalado (el Chromium de Playwright
//     muere cargando E4B); el backend gráfico, si hace falta, por el entorno
//     (ELFFUSS_CHROME_ARGS, ver chrome-args.mjs)
//   · perfil PERSISTENTE (el efímero no traga gigabytes en Cache Storage)
//   · el .litertlm servido en local (E4B_URL), por ejemplo enlazado en
//     web/models/, que git ignora
//
//   E4B_URL=http://localhost:8742/models/__e4b.litertlm PROFILE=/ruta/perfil BASE=http://localhost:8742 node tests/litert-stop-real.mjs
import { chromium } from 'playwright';
import { CHROME_ARGS } from './chrome-args.mjs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8742';
const E4B_URL = process.env.E4B_URL || (BASE + '/models/__e4b.litertlm');
const PROFILE = process.env.PROFILE || join(tmpdir(), 'elffuss-claw-e4b-prof');
mkdirSync(PROFILE, { recursive: true });

let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const log = (...a) => console.log('· ' + a.join(' '));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: process.env.CHANNEL || 'chrome',
  args: ['--enable-unsafe-webgpu', ...CHROME_ARGS],
  timeout: 120000,
});
await ctx.addInitScript(() => { try { localStorage.setItem('elffuss.model', 'rules'); localStorage.setItem('elffuss.welcomed', '1'); } catch {} });
const p = await ctx.newPage();
p.on('pageerror', e => log('PAGEERROR:', e.message.slice(0, 160)));
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

log('cargando E4B en la GPU…');
const load = await p.evaluate(async (url) => {
  const m = await import('/js/providers/litert.js');
  m.MODELS['gemma-e4b'].url = url;
  m.configure('gemma-e4b');
  let err = null;
  try { await m.load(() => {}); } catch (e) { err = e.message; }
  return { err, ctx: m.ctxTokens };
}, E4B_URL);
ok('E4B carga sin error', !load.err, load.err || `contexto ${load.ctx}`);
if (load.err) { console.log('\n❌ sin modelo no se puede seguir'); await ctx.close(); process.exit(1); }

const r = await p.evaluate(async () => {
  const m = await import('/js/providers/litert.js');
  const avisos = [];
  const warn = console.warn;
  console.warn = (...a) => { avisos.push(a.map(String).join(' ')); warn.apply(console, a); };
  try {
    const SYS = 'Eres un asistente conciso. Responde en español.';
    const h = [{ role: 'user', content: 'Me llamo Ana. Responde solo: hola Ana.' }];
    let out0 = '', err0 = null;
    try { out0 = await m.chat(h, SYS, () => {}); } catch (e) { err0 = e.name + ': ' + e.message; }
    h.push({ role: 'assistant', content: out0 });
    // 1. Una respuesta larga, parada tras unos pocos trozos.
    h.push({ role: 'user', content: 'Escribe los números del 1 al 300 separados por comas, sin nada más.' });
    const ac = new AbortController();
    const trozos = []; let trasParar = 0, err1 = null, parcial = '';
    try {
      parcial = await m.chat(h, SYS, t => { if (ac.signal.aborted) trasParar++; trozos.push(t); if (trozos.length === 6) ac.abort(); }, ac.signal);
    } catch (e) { err1 = e.name + ': ' + e.message; }
    // 2. El turno siguiente (el agente no apunta la respuesta parada).
    h.push({ role: 'user', content: 'Olvida la lista. ¿Cómo me llamo? Responde solo con el nombre.' });
    let err2 = null, out2 = '';
    try { out2 = await m.chat(h, SYS, () => {}); } catch (e) { err2 = e.name + ': ' + e.message; }
    h.push({ role: 'assistant', content: out2 });
    // 3. Parar durante el prefill (antes del primer trozo) y seguir.
    h.push({ role: 'user', content: 'Escribe un poema largo sobre el mar, de al menos veinte versos.' });
    const ac3 = new AbortController();
    let trozos3 = 0, err3 = null;
    setTimeout(() => ac3.abort(), 30);
    try { await m.chat(h, SYS, () => { trozos3++; }, ac3.signal); } catch (e) { err3 = e.name + ': ' + e.message; }
    h.push({ role: 'user', content: 'Responde solo con la palabra: ADIOS' });
    let err4 = null, out4 = '';
    try { out4 = await m.chat(h, SYS, () => {}); } catch (e) { err4 = e.name + ': ' + e.message; }
    return { out0: out0.slice(0, 40), err0, trozos: trozos.length, trasParar, err1, parcial: String(parcial || '').slice(0, 80),
      err2, out2: String(out2 || '').slice(0, 200), trozos3, err3, err4, out4: String(out4 || '').slice(0, 120), avisos };
  } finally { console.warn = warn; }
});
log(JSON.stringify(r));
ok('un turno normal contesta', !r.err0 && r.out0.length > 0, r.err0 || `«${r.out0}»`);
ok('parar a mitad no lanza (devuelve lo generado)', !r.err1, r.err1 || `«${r.parcial}»`);
ok('  …y no entrega trozos tras parar', r.trasParar === 0, `${r.trozos} trozos, ${r.trasParar} tras parar`);
ok('el turno siguiente contesta (la conversación cancelada no se reutiliza)', !r.err2 && r.out2.length > 0, r.err2 || `«${r.out2}»`);
ok('  …sin seguir la lista parada', !/\d+\s*,\s*\d+\s*,\s*\d+/.test(r.out2), `«${r.out2}»`);
ok('  …sin el reintento de «no cupo» (que la rehacía compactada)', !r.avisos.some(a => /\[litert\]/.test(a)), JSON.stringify(r.avisos.map(a => a.slice(0, 100))));
ok('parar durante el prefill no lanza, y el turno siguiente contesta', !r.err3 && !r.err4 && /adi[oó]s/i.test(r.out4), r.err3 || r.err4 || `«${r.out4}» · ${r.trozos3} trozos`);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ LITERT REAL: parar a mitad (y en el prefill) y seguir funciona');
await ctx.close();
process.exit(fails ? 1 : 0);

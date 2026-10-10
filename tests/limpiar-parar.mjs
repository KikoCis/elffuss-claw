// 🧹 con un turno que tarda en soltar MÁS que la espera de 🧹 (sin GPU).
// ─────────────────────────────────────────────────────────────────────────────
// Las comprobaciones de 🧹 de stop-ui.mjs no llegan a la carrera que dicen
// cubrir: su cerebro es un fetch que la propia recarga corta, así que el turno
// viejo nunca guarda después del borrado. Pasaban igual sin la época del
// histórico y sin parar antes de borrar. Aquí:
//   · el cerebro, una vez abortado, sigue «generando» más tiempo que la espera
//     (con tope) de 🧹 antes de soltar;
//   · al recargar con ese turno vivo, el navegador pregunta antes de salir (lo
//     pide la propia app) y se le dice que NO: la página sigue, y el turno viejo
//     termina DESPUÉS del borrado, que es cuando guardaba la conversación.
// Se comprueba que 🧹 aborta el turno ANTES de borrar, que el turno viejo, al
// terminar tarde, no vuelve a guardar la conversación borrada, y que tras
// recargar de verdad no vuelve.
//
//   python3 server/serve.py 8742 &   BASE=http://localhost:8742 node tests/limpiar-parar.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8742';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const espera = ms => new Promise(r => setTimeout(r, ms));
async function hasta(cond, { veces = 100, cada = 50 } = {}) {
  for (let i = 0; i < veces; i++) { if (await cond()) return true; await espera(cada); }
  return false;
}

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('elffuss.model', 'rules');
    localStorage.setItem('elffuss.welcomed', '1');
    localStorage.setItem('elffuss.grants', JSON.stringify(['fs', 'apps', 'vault', 'tasks', 'web', 'memory']));
  } catch {}
});
const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
const errores = [];
p.on('pageerror', e => { if (!/allow-same-origin/.test(e.message)) errores.push(e.message); });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.elffuss?.agent, null, { timeout: 15000 });
const kv = key => p.evaluate(async k => (await import('/js/db.js')).get('kv', k), key);

// Una conversación que borrar: un turno terminado y guardado.
await p.evaluate(() => {
  window.elffuss.agent.setProvider({ chat: async () => 'Hola, aquí estoy.' });
  window.elffuss.send('hola, recuerda esta conversación');
});
ok('hay una conversación guardada que borrar', await hasta(async () => (await kv('history'))?.some(m => m.content === 'Hola, aquí estoy.')));

// El cerebro lento y el registro de qué pasa antes: abortar, borrar, guardar.
await p.evaluate(() => {
  const orden = (window.__orden = []);
  const del = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (key) {
    if (this.name === 'kv' && key === 'history') orden.push('borrado');
    return del.call(this, key);
  };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (val, key) {
    if (this.name === 'kv' && key === 'history' && orden.includes('borrado')) orden.push('guardado-tras-borrar');
    return put.call(this, val, key);
  };
  window.elffuss.agent.setProvider({ chat: async (h, s, cb, opts) => {
    const signal = opts && typeof opts.aborted === 'boolean' ? opts : opts?.signal;
    signal?.addEventListener('abort', () => orden.push('abortado'), { once: true });
    for (let i = 0; i < 400 && !signal?.aborted; i++) { cb('palabra '); await new Promise(r => setTimeout(r, 20)); }
    // Abortado, aún tarda en soltar: más que la espera con tope de 🧹.
    if (signal?.aborted) await new Promise(r => setTimeout(r, 4500));
    orden.push('soltado');
    return 'esto no se usa';
  } });
  window.elffuss.send('cuéntame una historia interminable');
});
await hasta(() => p.evaluate(() => (document.querySelector('.msg.thinking .gen')?.textContent || '').includes('palabra')));

// Al recargar con el turno vivo, el navegador pregunta antes de salir: «no».
let dialogos = 0, navego = false;
p.on('dialog', d => { dialogos++; d.dismiss().catch(() => {}); });
p.on('framenavigated', f => { if (f === p.mainFrame()) navego = true; });
await p.click('#btn-clear');
await hasta(async () => navego || await p.evaluate(() => !!window.__orden?.includes('soltado')).catch(() => false), { veces: 240, cada: 50 });
await espera(1000);
ok('premisa: el navegador preguntó antes de salir y la página siguió (el turno viejo termina DESPUÉS del borrado)',
  dialogos >= 1 && !navego, `${dialogos} diálogo(s) · navegó=${navego}`);
const orden = navego ? null : await p.evaluate(() => window.__orden.slice());
ok('🧹 aborta el turno ANTES de borrar la conversación', !!orden && orden.includes('abortado') && orden.includes('borrado')
  && orden.indexOf('abortado') < orden.indexOf('borrado'), JSON.stringify(orden));
ok('el turno viejo, al terminar tarde, NO vuelve a guardar la conversación borrada', !!orden && orden.includes('soltado')
  && !orden.includes('guardado-tras-borrar'), JSON.stringify(orden));
const hist = navego ? 'navegó' : await kv('history');
ok('…y lo guardado sigue vacío', !hist || (Array.isArray(hist) && !hist.length), JSON.stringify(hist));

// Recargar de verdad (ya sin turno vivo, no pregunta).
p.removeAllListeners('dialog');
p.on('dialog', d => d.accept().catch(() => {}));
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.elffuss?.agent, null, { timeout: 15000 });
await espera(1200);
const histFinal = await kv('history');
ok('tras recargar, la conversación borrada no vuelve', !histFinal || !histFinal.length, JSON.stringify(histFinal?.map(m => m.content.slice(0, 20))));
ok('…ni en pantalla', !(await p.locator('#log').innerText()).includes('recuerda esta conversación'));

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ 🧹: para antes de borrar y lo borrado no vuelve, aunque el turno suelte tarde');
await b.close();
process.exit(fails ? 1 : 0);

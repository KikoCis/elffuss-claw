// Cerebro CEO + Mente de Elffuss en Claw (core compartido con Elffuss Code):
// perfiles propios de Claw, adaptador sobre fs.js (multi-carpeta), tool-calling
// REAL (fs.read de verdad) y play/stop persistente vía el botón 🧠.
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8798';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext();
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('elffuss.model', 'rules');
    localStorage.setItem('elffuss.welcomed', '1');
    // ámbitos ya concedidos: sin esto, cualquier tool real (fs, apps, tareas…)
    // se queda colgada esperando un clic en el modal de permisos — incluida la
    // que dispara «Ejecutar esta propuesta» al mandarla al chat real.
    localStorage.setItem('elffuss.grants', JSON.stringify(['fs', 'apps', 'vault', 'tasks', 'web', 'memory']));
  } catch {}
});
const p = await ctx.newPage({ viewport: { width: 1500, height: 900 } });
p.on('console', m => { if (m.type() === 'error' && !/allow-same-origin|soundcloud|widget|encrypted-media|permissions policy/i.test(m.text())) console.log('   err:', m.text().slice(0, 160)); });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

const MARK = 'MARCA-CLAW-9f3e21';
await p.evaluate(async (mark) => {
  const opfs = await navigator.storage.getDirectory();
  const w = async (n, t) => { const f = await opfs.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  await w('README.md', '# demo\n' + mark + '\nCarpeta de prueba.');
  // registrar el handle OPFS como si fuese una carpeta autorizada de verdad
  // (mismo truco que ?test-opfs en Elffuss Code): fs.js solo pide permiso
  // nativo si el handle expone queryPermission, y OPFS no lo expone.
  const db = await import('/js/db.js');
  await db.set('fs', 'proyecto-prueba', opfs);
}, MARK);
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

await p.click('#btn-mind'); await p.waitForTimeout(1200);
ok('overlay + mundo montado', await p.locator('#mind-overlay').count() > 0);

// leyenda con los 3 perfiles de Claw + CEO
const legendItems = await p.locator('#mind-legend .ml-item').allInnerTexts();
ok('leyenda con 3 perfiles de Claw + CEO', legendItems.length === 4 && legendItems.some(t => /CEO/.test(t)) && legendItems.some(t => /Organización/.test(t)), legendItems.join(' · '));

// tool-calling REAL del CEO vía el adaptador fs.js multi-carpeta
const cycleResult = await p.evaluate(async (mark) => {
  const ceo = await import('/js/ceo.js');
  const mind = await import('/js/mind.js');
  ceo.init({
    provider: () => ({
      chat: async (history) => {
        const res = history.find(m => m.role === 'user' && m.content.startsWith('[resultado fs.read]'));
        if (!res) return '```tool\n{"tool":"fs.read","args":{"path":"README.md"}}\n```';
        const snippet = res.content.includes(mark) ? mark : 'NO-MARK';
        return 'Propuesta basada en el contenido real: ' + snippet;
      },
    }),
    isBusy: () => false,
    onEvent: (ch, ev) => mind.pushThought(ch, ev),
  });
  const t0 = Date.now();
  while (!ceo.isThisTabLeader() && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 100));
  const ran = await ceo.forceCycle();
  return { ran, leader: ceo.isThisTabLeader() };
}, MARK);
ok('forceCycle se ejecuta (semáforo líder + espacio de trabajo listo)', cycleResult.ran, JSON.stringify(cycleResult));
await p.waitForTimeout(500);
const logAfterCycle = await p.evaluate(() => document.getElementById('mind-log-body').innerText);
ok('la propuesta del CEO contiene el MARCADOR real leído vía fs.read (tool-calling REAL sobre la carpeta autorizada)', logAfterCycle.includes(MARK), logAfterCycle.slice(-400));
ok('se creó un nodo de propuesta forjada', await p.evaluate(() => document.querySelectorAll('.mind-node-label').length > 0));

// panel de propuesta → «Ejecutar» manda la propuesta al chat REAL de Claw
await p.evaluate(() => document.querySelectorAll('.mind-node-label')[0]?.click());
await p.waitForTimeout(400);
ok('botón «Ejecutar esta propuesta» presente', await p.locator('#mp-exec').count() > 0);
await p.click('#mp-exec');
await p.waitForTimeout(600);
ok('«Ejecutar» cierra la Mente', await p.evaluate(() => document.getElementById('mind-overlay').style.display === 'none'));
const chatText = await p.locator('#log').innerText();
ok('la propuesta llegó como mensaje real al chat/cola', /Implementa esta propuesta/.test(chatText));

// play/stop: pausar desde la Mente y comprobar que sobrevive a recargar
await p.click('#btn-mind'); await p.waitForTimeout(600);
const enBefore = await p.evaluate(async () => (await import('/js/ceo.js')).isEnabled());
ok('el cerebro queda activo tras el primer uso', enBefore);
await p.click('#mind-playstop'); await p.waitForTimeout(200);
ok('tras pulsar, el botón pasa a "reanudar"', /reanudar/.test(await p.locator('#mind-playstop').innerText()));
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
const enAfterReload = await p.evaluate(async () => (await import('/js/ceo.js')).isEnabled());
ok('tras recargar, sigue PAUSADO (persistido bajo el namespace de Claw)', !enAfterReload);

await p.screenshot({ path: OUT + '/mind_claw.png' });
console.log('captura → mind_claw.png');
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ CEREBRO CEO EN CLAW OK — perfiles propios + fs.js multi-carpeta + tool-calling real');
await b.close();
process.exit(fails ? 1 : 0);

// 📨 Errores y feedback: opt-in (apagado por defecto), captura de errores no
// capturados cuando está activo, y envío manual de feedback que funciona
// SIEMPRE (acción explícita) sin activar el automático de fondo.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8801';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
// En español: la prueba busca el botón «Enviar» del feedback. Sin locale el
// navegador va en inglés, la página también («Send»), y la prueba se caía ahí
// sin llegar a sus dos últimas comprobaciones. Y en Básico: no necesita modelo.
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffuss.welcomed', '1'); localStorage.setItem('elffuss.model', 'rules'); } catch {} });
const p = await ctx.newPage();

const reports = [];
await p.route('**/proxy/report', async route => {
  reports.push(JSON.parse(route.request().postData() || '{}'));
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
});

await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

ok('telemetría apagada por defecto', await p.evaluate(async () => (await import('/js/telemetry.js')).isEnabled()) === false);
await p.evaluate(async () => { const t = await import('/js/telemetry.js'); await t.reportError('no debería salir'); });
await p.waitForTimeout(200);
ok('con telemetría apagada, reportError() no manda nada', reports.length === 0);

// abre Ajustes (pestaña /modelo)
await p.evaluate(async () => (await import('/js/ui.js')).selectTab('ajustes'));
await p.waitForTimeout(300);
ok('el checkbox de errores/feedback existe y empieza desmarcado', await p.locator('#tel-enabled').isChecked() === false);
await p.locator('#tel-enabled').check();
await p.waitForTimeout(100);
ok('marcarlo activa telemetry.isEnabled()', await p.evaluate(async () => (await import('/js/telemetry.js')).isEnabled()) === true);
ok('persiste en localStorage', await p.evaluate(() => localStorage.getItem('elffuss.telemetry.elffuss-claw') === '1'));

await p.evaluate(async () => { const t = await import('/js/telemetry.js'); await t.reportError('fallo de prueba', { stack: 'en algún sitio' }); });
await p.waitForTimeout(200);
ok('con telemetría activa, reportError() manda el informe', reports.some(r => r.kind === 'error' && r.message === 'fallo de prueba'));
ok('el informe lleva app=elffuss-claw, url y user-agent', reports.some(r => r.app === 'elffuss-claw' && r.url && r.userAgent));

await p.evaluate(() => { setTimeout(() => { throw new Error('crash-no-capturado-de-prueba'); }, 0); });
await p.waitForTimeout(300);
ok('un error global no capturado también se reporta solo', reports.some(r => /crash-no-capturado-de-prueba/.test(r.message)));

await p.locator('#tel-enabled').uncheck();
await p.waitForTimeout(100);
const before = reports.length;
await p.evaluate(async () => { const t = await import('/js/telemetry.js'); await t.reportError('esto no debería salir ya'); });
await p.waitForTimeout(200);
ok('al desactivarlo, reportError() vuelve a no mandar nada', reports.length === before);

await p.fill('#tel-feedback', 'esto es un feedback manual de prueba');
await p.locator('.card', { has: p.locator('#tel-feedback') }).locator('button', { hasText: 'Enviar' }).click();
await p.waitForTimeout(300);
ok('el feedback manual SÍ se manda aunque el automático esté apagado', reports.some(r => r.kind === 'feedback' && /feedback manual de prueba/.test(r.message)));
ok('tras mandar el feedback manual, el automático sigue apagado', await p.evaluate(async () => (await import('/js/telemetry.js')).isEnabled()) === false);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ TELEMETRÍA/FEEDBACK (Claw): opt-in real, nunca automático sin permiso, manual siempre disponible');
await b.close();
process.exit(fails ? 1 : 0);

// Elffuss Claw demo video: real model (Gemma-4 E2B), builds a real app
// (app.create) that renders in the viewer, brief look at the Mind, and a
// clean outro.
// Doubles as an e2e smoke test: loads the real Gemma-4 model on WebGPU and
// exercises app.create end to end.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const REC = process.env.REC || new URL('../../elffuss-assets/_recording', import.meta.url).pathname;
const OUT = process.env.OUT || REC + '/videos';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'https://elffuss-claw.utopiaia.com';

async function waitIdle(p, maxMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const busy = await p.evaluate(() => document.querySelector('#send')?.disabled).catch(() => false);
    const thinking = await p.locator('.msg.thinking').count().catch(() => 0);
    if (!busy && !thinking) return true;
    await p.waitForTimeout(500);
  }
  return false;
}

const PROFILE = process.env.PROFILE || REC + '/profile-claw-gemma';
mkdirSync(PROFILE, { recursive: true });
const ctx = await chromium.launchPersistentContext(PROFILE, {
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-webgpu', '--use-angle=metal',
    // WebGPU LLM inference issues long GPU dispatches; Chromium's GPU watchdog
    // otherwise kills the GPU process mid-inference/-load → "Target page…closed".
    '--disable-gpu-watchdog', '--disable-gpu-process-crash-limit'],
  viewport: { width: 1440, height: 900 },
  locale: 'en-US', // fuerza navigator.language=en → chrome i18n + modelo en inglés
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('elffuss.welcomed', '1');
    localStorage.setItem('elffuss.model', 'litert:gemma-e2b');
  } catch {}
});
const p = ctx.pages()[0] || await ctx.newPage();

await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

// El historial real vive en IndexedDB (db 'elffuss', store 'kv', key
// 'history'/'queue'/'lastDone') — NO en localStorage. Un run previo que no
// terminase limpio deja esa cola pendiente y el perfil persistente la
// arrastra al siguiente run (prompt duplicado en el vídeo). Se borra la BD
// entera y se recarga para arrancar en limpio, sin tocar el caché del modelo
// (que vive aparte, en OPFS/Cache Storage).
await p.evaluate(() => new Promise((res) => {
  try {
    const req = indexedDB.deleteDatabase('elffuss');
    req.onsuccess = req.onerror = req.onblocked = () => res();
  } catch { res(); }
})).catch(() => {});
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
console.log('1) Elffuss Claw open (clean state)');

console.log('2) loading real Gemma-4 E2B (~2GB if not cached)…');
let loaded = false;
{
  const t0 = Date.now();
  let lastLog = 0;
  while (Date.now() - t0 < 480000) {
    const cls = await p.locator('#model-status').getAttribute('class').catch(() => '');
    // 'gpu' es el estado LISTO para modelos locales con WebGPU real (no uno
    // intermedio) — 'on' solo se usa para proveedores externos. Ver ui.js.
    if (cls && /\b(on|gpu)\b/.test(cls)) { loaded = true; break; }
    const secs = Math.round((Date.now() - t0) / 1000);
    if (secs - lastLog >= 20) {
      lastLog = secs;
      const statusTxt = await p.evaluate(() => document.querySelector('#model-select')?.selectedOptions?.[0]?.textContent || '').catch(() => '');
      console.log(`   … ${secs}s waiting (model-status class="${cls}", selector="${statusTxt}")`);
    }
    await p.waitForTimeout(1000);
  }
}
if (!loaded) {
  await p.screenshot({ path: OUT + '/../claw_load_fail.png' }).catch(() => {});
  throw new Error('Gemma did NOT load in time');
}
console.log('3) Gemma-4 actually loaded, running in your browser');

await p.click('#prompt');
await p.type('#prompt', 'Build me a notes app with a title and content, and save them so they survive a page reload', { delay: 20 });
await p.press('#prompt', 'Enter');
console.log('4) asking for a real app (app.create)');
await waitIdle(p, 150000);
await p.waitForTimeout(2000);
console.log('5) Gemma answered — app created and rendered in the viewer');

// puede pedir permiso (guardar la app/memoria) — a veces tarda un poco en
// aparecer TRAS la respuesta visible, así que se espera activamente en vez
// de comprobar una sola vez (si no, queda abierto y sin resolver el resto
// del vídeo).
const permDialog = p.locator('#perm-dialog[open]');
let permSeen = false;
{
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    if (await permDialog.count().catch(() => 0)) { permSeen = true; break; }
    await p.waitForTimeout(300);
  }
}
if (permSeen) {
  await p.waitForTimeout(500); // deja ver el diálogo un instante en el vídeo
  await p.click('#perm-allow').catch(() => {});
  await p.waitForTimeout(400);
  console.log('   (permission accepted)');
} else {
  console.log('   (no permission dialog this time)');
}
await p.waitForTimeout(1500);

await p.click('#btn-mind');
await p.waitForTimeout(4000);
console.log('6) brief look at the Mind (4s)');
await p.click('#mind-close').catch(() => {});
await p.waitForTimeout(500);

await p.evaluate(async () => { try { localStorage.removeItem('elffuss.history'); } catch {} });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3000);
console.log('7) clean outro');

const _vid = p.video();
await ctx.close();
// guarda el webm directamente como el keeper que consume finalize-demos.sh
if (_vid) { await _vid.saveAs(REC + '/claw-keeper.webm'); console.log('keeper →', REC + '/claw-keeper.webm'); }
console.log('OK — video saved in', OUT);

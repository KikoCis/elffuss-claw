// Suite E2E de Elffuss Claw — valida FUNCIONALIDAD REAL de punta a punta.
// Corre en modo básico (determinista, sin GPU): ejercita el bucle agéntico,
// las herramientas y la UI de verdad, no mocks.
//
//   BASE=https://elffuss-claw.utopiaia.com node e2e.mjs   (o local con serve.py)
//   npm i && npm test
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'https://elffuss-claw.utopiaia.com';
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : '')); if (!cond) fails++; };

const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });

async function fresh(locale = 'es-ES', grants = ['apps', 'tasks', 'vault', 'web', 'memory', 'fs']) {
  const ctx = await browser.newContext({ locale });
  await ctx.addInitScript(g => {
    try {
      localStorage.setItem('elffuss.model', 'rules');
      localStorage.setItem('elffuss.welcomed', '1');
      localStorage.setItem('elffuss.grants', JSON.stringify(g));
    } catch {}
  }, grants);
  const page = await ctx.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => { if (!/allow-same-origin/.test(e.message)) console.log('   pageerror:', e.message.slice(0, 100)); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  return page;
}
const say = async (page, text, wait = 1500) => {
  await page.fill('#prompt', text); await page.press('#prompt', 'Enter');
  await page.waitForTimeout(300);
  if (await page.isVisible('#perm-dialog')) { await page.click('#perm-allow'); await page.waitForTimeout(600); }
  await page.waitForTimeout(wait);
};
const lastAssistant = page => page.locator('.msg.assistant').last().textContent().catch(() => '');

// ============ 1 · apps que se crean ============
{
  const p = await fresh();
  await say(p, 'hazme un reloj', 2500);
  const shown = await p.isVisible('#appframe');
  const clock = await p.frameLocator('#appframe').locator('#t, h1').count().catch(() => 0);
  ok('1 · «hazme un reloj» → app renderizada en el visualizador', shown && clock > 0);
  await p.context().close();
}

// ============ 2 · no bucle infinito (anti-loop) ============
{
  const p = await fresh();
  await say(p, 'crea una app de notas', 2500);
  const noLoop = !(await p.locator('.msg.assistant').allTextContents()).some(t => /sin pasos/i.test(t));
  const tools = await p.locator('.msg.tool').count();
  ok('2 · no se queda en bucle tras crear la app', noLoop && tools <= 3, `tools=${tools}`);
  await p.context().close();
}

// ============ 3 · búsqueda de imágenes → galería REAL ============
{
  const p = await fresh();
  await say(p, 'busca fotos de perros', 7000);
  const imgs = await p.frameLocator('#appframe').locator('img').count().catch(() => 0);
  ok('3 · «busca fotos de perros» → galería con imágenes reales', imgs >= 4, `${imgs} imgs`);
  await p.context().close();
}

// ============ 4 · búsqueda web (texto) REAL ============
{
  const p = await fresh();
  await say(p, 'busca en internet historia del reloj', 8000);
  const res = (await p.locator('.msg.tool-result, .msg.assistant').allTextContents()).join(' ');
  ok('4 · «busca en internet …» devuelve resultados con enlaces', /https?:\/\//.test(res), res.slice(0, 60).replace(/\n/g, ' '));
  await p.context().close();
}

// ============ 5 · vault cifrado (crear, guardar, revelar) ============
{
  const p = await fresh();
  await p.click('#tabs button[data-tab="vault"]');
  await p.fill('#panel-vault input[type=password]', 'master-XYZ');
  await p.click('#panel-vault button.primary');
  if (await p.isVisible('#perm-dialog')) await p.click('#perm-allow');
  await p.waitForTimeout(700);
  const inputs = p.locator('#panel-vault .row input');
  await inputs.nth(0).fill('gmail'); await inputs.nth(1).fill('secreto123');
  await p.click('#panel-vault .row button.primary'); await p.waitForTimeout(500);
  await p.click('#panel-vault .card button.ghost >> nth=0'); await p.waitForTimeout(300);
  const revealed = await p.locator('#panel-vault .card code').first().textContent();
  ok('5 · vault: crear → guardar → revelar secreto cifrado', revealed === 'secreto123', revealed);
  await p.context().close();
}

// ============ 6 · tareas programadas ============
{
  const p = await fresh();
  await say(p, 'recuérdame dentro de 2 minutos beber agua', 1500);
  const reply = await lastAssistant(p);
  await p.click('#tabs button[data-tab="tareas"]'); await p.waitForTimeout(400);
  const inPanel = (await p.locator('#panel-tareas').textContent()).includes('beber agua');
  ok('6 · tarea programada aparece en el panel', /programada|beber agua/i.test(reply) && inPanel);
  await p.context().close();
}

// ============ 7 · memoria persistente sobrevive al refresco ============
{
  const p = await fresh();
  await say(p, 'recuerda que mi color favorito es el violeta', 1500);
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
  const snap = await p.evaluate(async () => (await import('/js/tools/index.js')).snapshot());
  ok('7 · memoria persiste tras refrescar (en el CONTEXTO)', /violeta/i.test(snap));
  await p.context().close();
}

// ============ 8 · histórico persiste tras refresco ============
{
  const p = await fresh();
  await say(p, 'hola', 1200);
  const before = await p.locator('.msg.user').count();
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1400);
  const after = await p.locator('.msg.user').count();
  ok('8 · histórico de chat sobrevive al refresco', after >= before && after > 0, `${before}→${after}`);
  await p.context().close();
}

// ============ 9 · multilenguaje por navegador ============
{
  const p = await fresh('en-US');
  const tabs = await p.locator('#tabs button').allTextContents();
  const ph = await p.getAttribute('#prompt', 'placeholder');
  ok('9 · UI en inglés con navegador en-US', tabs.includes('View') && tabs.includes('Tasks') && /Ask me/.test(ph || ''));
  await p.context().close();
}

// ============ 10 · skills instalables (catálogo real de GitHub) ============
{
  const p = await fresh();
  await p.click('#tabs button[data-tab="skills"]'); await p.waitForTimeout(400);
  const repos = await p.locator('#panel-skills .card a').allTextContents();
  await p.locator('#panel-skills .card button', { hasText: 'Explorar' }).first().click();
  await p.waitForTimeout(6000);
  const skillCards = await p.locator('#panel-skills .card').count();
  ok('10 · Skills: catálogo real de anthropics/skills carga', repos.some(r => /anthropics\/skills/.test(r)) && skillCards > 5, `${skillCards} filas`);
  await p.context().close();
}

// ============ 11 · el E4B roto NO es cargable (anti-crash) ============
{
  const p = await fresh();
  const opts = await p.$$eval('#model-select option', os => os.map(o => o.textContent));
  ok('11 · el Gemma E4B roto no se ofrece (evita el crash de WebGPU)', !opts.some(o => /E4B/.test(o)), JSON.stringify(opts));
  await p.context().close();
}

// ============ 12 · OG + meta para compartir ============
{
  const p = await fresh();
  const og = await p.getAttribute('meta[property="og:image"]', 'content');
  const r = await p.request.get(og);
  ok('12 · OG image existe y se sirve', r.ok() && (+r.headers()['content-length'] > 10000), og);
  await p.context().close();
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ TODO VERDE — funcionalidad real validada');
await browser.close();
process.exit(fails ? 1 : 0);

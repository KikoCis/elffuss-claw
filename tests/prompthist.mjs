// Historial del prompt del chat en Claw: ↑/↓ recuperan lo enviado.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8788';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffuss.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1200, height: 860 } });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1800);

const val = () => p.locator('#prompt').inputValue();
const submit = async (t) => { await p.locator('#prompt').fill(t); await p.locator('#prompt').press('Enter'); await p.waitForTimeout(250); };

await submit('hola uno');
await submit('hola dos');
await p.locator('#prompt').focus();
await p.keyboard.press('ArrowUp');
ok('↑ recupera el último', (await val()) === 'hola dos', await val());
await p.keyboard.press('ArrowUp');
ok('↑↑ recupera el anterior', (await val()) === 'hola uno', await val());
await p.keyboard.press('ArrowDown');
ok('↓ vuelve al siguiente', (await val()) === 'hola dos', await val());
await p.keyboard.press('ArrowDown');
ok('↓ al final restaura borrador', (await val()) === '', JSON.stringify(await val()));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ HISTORIAL CHAT (CLAW) OK');
await b.close();
process.exit(fails ? 1 : 0);

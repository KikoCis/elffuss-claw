import { chromium } from 'playwright';
const OUT = '/tmp/trabajo';
const BASE = 'https://elffuss-claw.utopiaia.com';
const ctx = await chromium.launch().then(b => b.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'es-ES',
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
}));
// SIN elffuss.welcomed — para que se vea el splash de bienvenida
const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4500); // deja que la animación de bienvenida se asiente
await ctx.close();
console.log('OK — splash capturado');

// ¿Dos generaciones con el MISMO prompt salen distintas? Si el decodificado es
// voraz, salen idénticas y muestrear N veces no aporta nada: best-of-N sería
// pagar N veces por el mismo resultado.
import { createRequire } from 'module';
import os from 'os';
const req = createRequire(import.meta.url);
const { chromium } = req(process.env.PW || 'playwright');
const { execSync } = req('child_process');
try { execSync('pkill -f elffuss-e4b'); } catch {}
await new Promise(r => setTimeout(r, 3000));
try { execSync('rm -f ~/.cache/elffuss-e4b/Singleton*'); } catch {}
const ctx = await chromium.launchPersistentContext(os.homedir() + '/.cache/elffuss-e4b',
  { channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const p = await ctx.newPage();
await p.goto('https://claw.elffuss.utopiaia.com/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
await p.evaluate(async () => { const m = await import('/js/providers/litert.js'); m.configure('gemma-e4b'); await m.load(() => {}); });

const r = await p.evaluate(async () => {
  const m = await import('/js/providers/litert.js'); m.configure('gemma-e4b');
  const salidas = [];
  for (let i = 0; i < 3; i++) {
    m.setSampling({ temperature: 0.8, seed: 1000 + i });
    // historial NUEVO cada vez → se recrea la conversación (rama «reiniciada»)
    salidas.push(String(await m.chat([{ role: 'user', content: 'Escribe una función JavaScript que baraje un array. Solo el código.' }],
      'Eres un programador. Responde solo con código.', () => {})));
  }
  return salidas;
});
console.log('tres generaciones con el mismo prompt, temperatura 0.8 y semillas distintas:\n');
r.forEach((s, i) => console.log(`  [${i}] ${s.length} car · hash ${[...s].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7)}`));
const iguales = r.every(x => x === r[0]);
console.log(`\n  ${iguales ? '⚠ IDÉNTICAS — decodificado voraz: muestrear N veces no aporta NADA'
                            : '✓ distintas — hay diversidad, best-of-N tiene sentido'}`);
if (!iguales) { console.log('\n  primeras líneas de cada una:'); r.forEach((s,i)=>console.log(`   [${i}] ${s.split('\n').find(l=>l.trim())||''}`.slice(0,100))); }
await ctx.close();

// Valida cachedModelBlob de litert.js: descarga 1 vez, cachea en Cache Storage
// (persistente) y en la 2ª llamada devuelve el blob SIN red (offline). Usa un
// fixture .litertlm determinista (no baja los GB reales).
import { chromium } from 'playwright';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const BASE = process.env.BASE || 'http://localhost:8788';
const SIZE = 120000;
let fails = 0; const ok = (n,c,e='')=>{console.log((c?'✅':'❌')+' '+n+(e?'  — '+e:''));if(!c)fails++};
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const FIXP = join(WEB, '__litert_fixture.litertlm');
writeFileSync(FIXP, Buffer.from(Array.from({length:SIZE},(_,i)=>i%256)));
process.on('exit', ()=>{ try{rmSync(FIXP)}catch{} });
const FIX = BASE + '/__litert_fixture.litertlm';

const b = await chromium.launch({args:['--enable-unsafe-webgpu','--use-angle=metal']});
const ctx = await b.newContext();
const p = await ctx.newPage();
await p.goto(BASE+'/', {waitUntil:'domcontentloaded'});

const call = (u) => p.evaluate(async (u) => {
  const m = await import('/js/providers/litert.js');
  const msgs = [];
  const r = await m.cachedModelBlob(u, s => msgs.push(s));
  const blob = r instanceof Blob ? r : null;
  return { isBlob: !!blob, size: blob ? blob.size : 0, firstMsg: msgs[0]||'', lastMsg: msgs.at(-1)||'', type: typeof r };
}, u);

// 1) primera vez: descarga + cachea, devuelve Blob del tamaño correcto
let r = await call(FIX);
ok('1ª vez → Blob del tamaño real (descarga + cachea)', r.isBlob && r.size === SIZE, `${r.type} size=${r.size} · ${r.lastMsg}`);

// 2) está en Cache Storage
const cached = await p.evaluate(async (u) => { const c = await caches.open('elffuss-models-v1'); return !!(await c.match(u)); }, FIX);
ok('el modelo quedó en Cache Storage', cached);

// 3) OFFLINE: 2ª llamada devuelve el blob desde caché sin red
await ctx.setOffline(true);
r = await call(FIX);
ok('2ª vez OFFLINE → Blob desde caché (no re-descarga)', r.isBlob && r.size === SIZE && /cach[eé]/i.test(r.firstMsg), `${r.size} · ${r.firstMsg}`);
await ctx.setOffline(false);

console.log(fails?`\n❌ ${fails} FALLO(S)`:'\n✅ CACHÉ LiteRT (blob) OK — descarga 1 vez, sirve offline');
await b.close(); process.exit(fails?1:0);

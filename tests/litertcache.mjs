// cachedModelBlob de litert.js: el .litertlm se baja una vez y la segunda sale
// sin red, por los dos caminos que tiene.
//
//   1. El de siempre desde 9ad584a: el almacén de modelos (runtime/model-store.js,
//      caché compartida del broker o la OPFS de este origen). Antes esta prueba
//      solo miraba Cache Storage, que ya no es por donde pasa el modelo.
//   2. El respaldo, cuando no hay OPFS: Cache Storage ('elffuss-models-v1').
//
// El fichero es de mentira (page.route) y el broker se da por caído: no sale
// nada a la red ni se baja ningún modelo de verdad.
//
//   BASE=http://localhost:8742 node tests/litertcache.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8742';
const SIZE = 120000;
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const DATOS = Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 256));

const b = await chromium.launch();
async function pagina({ sinOPFS = false } = {}) {
  const ctx = await b.newContext();
  await ctx.addInitScript(sin => {
    try { sessionStorage.setItem('elffuss.broker.down', '1'); } catch { /* */ }
    // Un navegador sin OPFS (o donde falla): el almacén devuelve null y litert.js
    // tiene que caer a Cache Storage.
    if (sin) try { Object.defineProperty(StorageManager.prototype, 'getDirectory', { value: undefined, configurable: true }); } catch { /* */ }
  }, sinOPFS);
  const p = await ctx.newPage();
  const peticiones = [];
  await p.route('**/__litert_fixture.litertlm', route => {
    const rango = route.request().headers().range || '';
    peticiones.push(rango || 'entero');
    const m = /bytes=(\d+)-(\d*)/.exec(rango);
    if (!m) return route.fulfill({ status: 200, body: DATOS, headers: { 'content-type': 'application/octet-stream', 'content-length': String(SIZE) } });
    const desde = +m[1], hasta = m[2] ? +m[2] : SIZE - 1;
    return route.fulfill({ status: 206, body: DATOS.subarray(desde, hasta + 1), headers: { 'content-range': `bytes ${desde}-${hasta}/${SIZE}`, 'accept-ranges': 'bytes' } });
  });
  await p.goto(BASE + '/robots.txt');   // una página del mismo origen, sin arrancar la app
  return { ctx, p, peticiones };
}
const llama = (p, u) => p.evaluate(async u => {
  const m = await import('/js/providers/litert.js');
  const msgs = [];
  const r = await m.cachedModelBlob(u, s => msgs.push(String(s)));
  const blob = r instanceof Blob ? r : null;
  let malos = -1;
  if (blob) { const v = new Uint8Array(await blob.arrayBuffer()); malos = 0; for (let i = 0; i < v.length; i++) if (v[i] !== i % 256) malos++; }
  return { esBlob: !!blob, size: blob ? blob.size : 0, malos, primero: msgs[0] || '', tipo: typeof r };
}, u);

// 1 · camino normal: el almacén de modelos (OPFS)
{
  const { ctx, p, peticiones } = await pagina();
  const FIX = BASE + '/__litert_fixture.litertlm';
  let r = await llama(p, FIX);
  ok('OPFS · 1ª vez → el modelo entero (lo baja y lo guarda)', r.esBlob && r.size === SIZE && r.malos === 0, JSON.stringify(r));
  const enOPFS = await p.evaluate(async () => {
    try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('elffuss-models'); for await (const [n] of d.entries()) if (n.endsWith('.done')) return true; } catch { /* */ }
    return false;
  });
  ok('OPFS · quedó guardado en el almacén de modelos (no en Cache Storage)', enOPFS && !(await p.evaluate(async () => (await caches.keys()).includes('elffuss-models-v1'))));
  peticiones.length = 0;
  await ctx.setOffline(true);
  r = await llama(p, FIX);
  await ctx.setOffline(false);
  ok('OPFS · 2ª vez SIN RED → desde disco, sin una petición', r.esBlob && r.size === SIZE && r.malos === 0 && peticiones.length === 0 && /disco/.test(r.primero), `${JSON.stringify(r)} · ${peticiones.length} peticiones`);
  await ctx.close();
}

// 2 · respaldo sin OPFS: Cache Storage
{
  const { ctx, p, peticiones } = await pagina({ sinOPFS: true });
  const FIX = BASE + '/__litert_fixture.litertlm';
  let r = await llama(p, FIX);
  ok('sin OPFS · 1ª vez → el modelo entero, por Cache Storage', r.esBlob && r.size === SIZE && r.malos === 0, JSON.stringify(r));
  ok('sin OPFS · quedó en Cache Storage', await p.evaluate(async u => !!(await (await caches.open('elffuss-models-v1')).match(u)), FIX));
  peticiones.length = 0;
  await ctx.setOffline(true);
  r = await llama(p, FIX);
  await ctx.setOffline(false);
  ok('sin OPFS · 2ª vez SIN RED → desde la caché, sin una petición', r.esBlob && r.size === SIZE && peticiones.length === 0 && /cach[eé]/i.test(r.primero), `${JSON.stringify(r)} · ${peticiones.length} peticiones`);
  await ctx.close();
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ CACHÉ LiteRT OK — se baja una vez y sirve sin red, con OPFS y sin ella');
await b.close(); process.exit(fails ? 1 : 0);

// Caché de modelos: se baja UNA vez a disco y después se sirve sin red.
//
// Era la prueba del service worker que guardaba los modelos en Cache Storage.
// Ese service worker es inerte desde 852216e (rompía la carga de ONNX) y los
// pesos se guardan ahora en el almacén de modelos (runtime/model-store.js): la
// caché compartida del broker y, si no está, la OPFS de este origen. Esto prueba
// ese camino con la OPFS: descarga una vez, sirve desde disco sin tocar la red,
// los bytes son los del original, se lee por rangos y no deja la marca de
// «completo» hasta que lo está.
//
// El fichero es de mentira (page.route, byte[i] = i % 251) y el broker se da por
// caído, así que no sale nada a la red.
//
//   BASE=http://localhost:8742 node tests/modelcache.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8742';
const FIX = BASE + '/__modelcache_fixture.litertlm';
const SIZE = 300000;
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const DATOS = Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 251));
const peticiones = [];
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => {
  try { localStorage.setItem('elffuss.model', 'rules'); sessionStorage.setItem('elffuss.broker.down', '1'); } catch { /* */ }
});
const p = await ctx.newPage({ viewport: { width: 1200, height: 800 } });
await p.route('**/__modelcache_fixture.litertlm', route => {
  const rango = route.request().headers().range || '';
  peticiones.push(rango || 'entero');
  const m = /bytes=(\d+)-(\d*)/.exec(rango);
  if (!m) return route.fulfill({ status: 200, body: DATOS, headers: { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes' } });
  const desde = +m[1], hasta = m[2] ? +m[2] : SIZE - 1;
  return route.fulfill({ status: 206, body: DATOS.subarray(desde, hasta + 1),
    headers: { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'content-range': `bytes ${desde}-${hasta}/${SIZE}` } });
});
await p.goto(BASE + '/robots.txt');   // una página del mismo origen, sin arrancar la app

const baja = () => p.evaluate(async u => {
  const m = await import('/js/runtime/model-store.js');
  const msgs = [];
  const f = await m.getModelFile(u, s => msgs.push(typeof s === 'string' ? s : JSON.stringify(s)));
  if (!f) return { nulo: true, msgs };
  const buf = new Uint8Array(await f.arrayBuffer());
  let malos = 0; for (let i = 0; i < buf.length; i++) if (buf[i] !== i % 251) malos++;
  return { size: f.size, malos, primero: msgs[0] || '', ultimo: msgs.at(-1) || '' };
}, FIX);

// 1) primera vez: se baja y queda en disco, entero y marcado como completo
const r1 = await baja();
ok('primera vez: devuelve el modelo entero', r1.size === SIZE && r1.malos === 0, JSON.stringify(r1));
const enDisco = await p.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('elffuss-models');
  const out = [];
  for await (const [n, h] of dir.entries()) out.push(n + ':' + (h.kind === 'file' ? (await h.getFile()).size : 'dir'));
  return out;
});
// (Claw guarda los modelos partidos en trozos: <clave>.p0, .p1… Este cabe en uno.)
ok('queda en la OPFS del origen, con su marca de completo', enDisco.some(x => /\.litertlm(\.p0)?:/.test(x) && x.endsWith(':' + SIZE)) && enDisco.some(x => /\.done:/.test(x)), JSON.stringify(enDisco));
ok('  …y la descarga sí pasó por la red', peticiones.length > 0, JSON.stringify(peticiones));

// 2) segunda vez SIN RED: sale del disco y no hace ninguna petición
peticiones.length = 0;
await ctx.setOffline(true);
const r2 = await baja();
await ctx.setOffline(false);
ok('segunda vez sin red: sale del disco, con los mismos bytes', r2.size === SIZE && r2.malos === 0, JSON.stringify(r2));
ok('  …sin una sola petición', peticiones.length === 0, JSON.stringify(peticiones));
ok('  …y lo dice («desde disco, sin descargar»)', /desde disco/.test(r2.primero), r2.primero);

// 3) lectura por rangos desde el disco (la usa el motor por trozos)
const trozo = await p.evaluate(async u => {
  const m = await import('/js/runtime/model-store.js');
  const r = await m.openRanged(u);
  return { size: r.size, bytes: [...new Uint8Array(await r.slice(1000, 8))] };
}, FIX);
const esperado = Array.from({ length: 8 }, (_, i) => (1000 + i) % 251);
ok('lectura por rangos desde el disco: los bytes justos', trozo.size === SIZE && JSON.stringify(trozo.bytes) === JSON.stringify(esperado), JSON.stringify(trozo));

// 4) una descarga cortada no deja la marca de completo: no se sirve a medias
await p.evaluate(async () => (await import('/js/runtime/model-store.js')).clearAll());
await p.unroute('**/__modelcache_fixture.litertlm');
await p.route('**/__modelcache_fixture.litertlm', route => {
  const rango = route.request().headers().range || '';
  if (/bytes=0-0$/.test(rango)) return route.fulfill({ status: 206, body: DATOS.subarray(0, 1), headers: { 'content-range': `bytes 0-0/${SIZE}`, 'accept-ranges': 'bytes' } });
  return route.abort('failed');
});
const r4 = await p.evaluate(async u => {
  const m = await import('/js/runtime/model-store.js');
  let err = null; try { await m.getModelFile(u); } catch (e) { err = String(e.message || e); }
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('elffuss-models');
  const nombres = []; for await (const [n] of dir.entries()) nombres.push(n);
  return { err, completo: nombres.some(n => n.endsWith('.done')) };
}, FIX);
ok('una descarga cortada falla y NO queda marcada como completa', !!r4.err && !r4.completo, JSON.stringify(r4));

// 5) el uso de almacenamiento lo refleja
const est = await p.evaluate(() => navigator.storage.estimate().then(e => e.usage || 0).catch(() => 0));
ok('storage.estimate refleja lo guardado', est > 0, est > 0 ? 'hay uso' : 'sin uso');

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ CACHÉ DE MODELOS OK — se baja una vez a disco, se sirve sin red y por rangos');
await b.close();
process.exit(fails ? 1 : 0);

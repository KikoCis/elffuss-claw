// Guardia: si NO se puede guardar el modelo, hay que DECIRLO.
// Bug real (ago-2026): cachedModelBlob prometía en el progreso «se cachea para
// la próxima vez», y si cache.put fallaba (ventana privada, disco lleno, cuota)
// se tragaba la excepción y devolvía la URL. El usuario se re-bajaba GIGABYTES
// cada sesión sin enterarse de por qué. Es la misma enfermedad que el resto de
// la ronda: fallo silencioso presentado como éxito.
//
// Desde a2d33ec el modelo se guarda primero en el almacén de modelos (OPFS) y
// Cache Storage es el respaldo: esta prueba fallaba sobre Cache Storage, que ya
// no es el camino normal. Ahora se fuerza el fallo donde se guarda de verdad:
//   1. normal: se guarda en disco y no se avisa de nada;
//   2. falla la OPFS (cuota): se dice, y el modelo sigue llegando por la caché;
//   3. fallan las dos: se dice con la causa probable, y la carga sigue (URL).
// Determinista: fichero de mentira (page.route) y broker dado por caído.
//
//   BASE=http://localhost:8742 node tests/modelcache_honest.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8742';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const SIZE = 50000;
const DATOS = Buffer.alloc(SIZE, 7);

const b = await chromium.launch();
async function pagina({ opfsLlena = false, cacheLlena = false } = {}) {
  const ctx = await b.newContext();
  await ctx.addInitScript(({ opfsLlena, cacheLlena }) => {
    try { sessionStorage.setItem('elffuss.broker.down', '1'); } catch { /* */ }
    const cuota = () => { const e = new Error('Quota exceeded'); e.name = 'QuotaExceededError'; return e; };
    // Disco lleno para la OPFS: abrir el fichero se puede, escribir bytes no.
    if (opfsLlena) FileSystemWritableFileStream.prototype.write = async function () { throw cuota(); };
    if (cacheLlena) Cache.prototype.put = async function () { throw cuota(); };
  }, { opfsLlena, cacheLlena });
  const p = await ctx.newPage();
  await p.route('**/__honest_fixture.litertlm', route => {
    const rango = route.request().headers().range || '';
    if (/bytes=0-0$/.test(rango)) return route.fulfill({ status: 206, body: DATOS.subarray(0, 1), headers: { 'content-range': `bytes 0-0/${SIZE}`, 'accept-ranges': 'bytes' } });
    return route.fulfill({ status: 200, body: DATOS, headers: { 'content-type': 'application/octet-stream', 'content-length': String(SIZE) } });
  });
  await p.goto(BASE + '/robots.txt');   // una página del mismo origen, sin arrancar la app
  return { ctx, p };
}
const carga = p => p.evaluate(async u => {
  const m = await import('/js/providers/litert.js');
  const msgs = [];
  let res, err = null;
  try { res = await m.cachedModelBlob(u, s => msgs.push(String(s))); } catch (e) { err = e.message; }
  return {
    err, esBlob: res instanceof Blob, size: res instanceof Blob ? res.size : 0, esURL: typeof res === 'string',
    aviso: msgs.find(s => /No se pudo guardar/.test(s)) || '',
    explica: msgs.some(s => /No se pudo guardar/.test(s) && /privada|espacio/i.test(s)),
  };
}, BASE + '/__honest_fixture.litertlm');

// 1) normal: se guarda en disco y no avisa de ningún fallo
{
  const { ctx, p } = await pagina();
  const r = await carga(p);
  ok('normal: devuelve el modelo guardado', r.esBlob && r.size === SIZE, JSON.stringify(r));
  ok('normal: no avisa de fallo cuando SÍ lo guarda', !r.aviso, r.aviso);
  await ctx.close();
}

// 2) la OPFS no puede guardarlo (cuota): lo dice, y sigue por Cache Storage
{
  const { ctx, p } = await pagina({ opfsLlena: true });
  const r = await carga(p);
  ok('disco lleno (OPFS): NO revienta la carga, el modelo llega por la caché', !r.err && r.esBlob && r.size === SIZE, r.err || JSON.stringify(r));
  ok('disco lleno (OPFS): lo DICE en el progreso (no silencioso)', /disco del navegador/.test(r.aviso), r.aviso.slice(0, 120));
  ok('disco lleno (OPFS): explica la causa probable', r.explica);
  await ctx.close();
}

// 3) no se puede guardar en ningún sitio: lo dice y la carga sigue con la URL
{
  const { ctx, p } = await pagina({ opfsLlena: true, cacheLlena: true });
  const r = await carga(p);
  ok('sin sitio donde guardarlo: NO revienta la carga (devuelve la URL)', !r.err && r.esURL, r.err || JSON.stringify(r));
  ok('sin sitio donde guardarlo: lo DICE, con la causa probable', !!r.aviso && r.explica, r.aviso.slice(0, 120));
  await ctx.close();
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ caché de modelo HONESTA — si no lo guarda, lo dice');
await b.close();
process.exit(fails ? 1 : 0);

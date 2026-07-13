// Verifica la caché de modelos por service worker: descarga una vez, se sirve
// desde Cache Storage (incluso OFFLINE) y soporta range requests. Usa un fixture
// .litertlm determinista (byte[i] = i%256) para no bajar los GB reales.
import { chromium } from 'playwright';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const BASE = process.env.BASE || 'http://localhost:8788';
const FIX = BASE + '/__test_fixture.litertlm';
const SIZE = 100000;
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

// fixture determinista (byte[i]=i%256) en web/, autolimpiado al terminar
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const FIXPATH = join(WEB, '__test_fixture.litertlm');
writeFileSync(FIXPATH, Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 256)));
const cleanup = () => { try { rmSync(FIXPATH); } catch {} };
process.on('exit', cleanup);

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffuss.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1200, height: 800 } });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

// esperar a que el SW controle la página
const controlled = await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller != null, null, { timeout: 10000 }).then(() => true).catch(() => false);
ok('el service worker controla la página', controlled);

const fetchInfo = (u, opts) => p.evaluate(async ({ u, opts }) => {
  const r = await fetch(u, opts);
  const buf = new Uint8Array(await r.arrayBuffer());
  return { status: r.status, len: buf.length, cr: r.headers.get('content-range'), first: [...buf.slice(0, 4)], sample: [...buf.slice(0, 12)] };
}, { u, opts });

// 1) primera descarga (el SW baja el fichero completo y lo cachea)
const r1 = await fetchInfo(FIX);
ok('primera petición devuelve el fichero completo', r1.status === 200 && r1.len === SIZE, `status ${r1.status}, ${r1.len}B`);

// 2) OFFLINE: si está cacheado, se sigue sirviendo sin red
await ctx.setOffline(true);
const r2 = await fetchInfo(FIX).catch(e => ({ status: 0, err: String(e) }));
ok('OFFLINE se sirve desde la caché (prueba de que quedó cacheado)', r2.status === 200 && r2.len === SIZE, `status ${r2.status}, ${r2.len}B`);

// 3) range request servido desde el blob cacheado (bytes 10..19)
const r3 = await fetchInfo(FIX, { headers: { Range: 'bytes=10-19' } });
const expected = Array.from({ length: 10 }, (_, i) => (10 + i) % 256);
ok('range request → 206 con los bytes correctos', r3.status === 206 && r3.len === 10 && JSON.stringify(r3.sample.slice(0, 10)) === JSON.stringify(expected), `status ${r3.status}, cr=${r3.cr}, bytes=${r3.sample}`);
await ctx.setOffline(false);

// 4) el estimate reporta uso (>0) tras cachear
const est = await p.evaluate(() => navigator.storage.estimate().then(e => ({ usage: e.usage, persisted: null })).catch(() => ({ usage: 0 })));
ok('storage.estimate refleja el uso cacheado', est.usage > 0, `${(est.usage / 1024 / 1024).toFixed(1)} MB`);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ CACHÉ DE MODELOS OK — descarga 1 vez, persiste y sirve offline + ranges');
await b.close();
process.exit(fails ? 1 : 0);

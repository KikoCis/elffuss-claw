// El broker no puede dejar trozos huérfanos: la caché se envenenaba sola.
// ─────────────────────────────────────────────────────────────────────────────
// El fallo, y por eso existe este test: la limpieza hacía `removeEntry(k)`, y
// `k` no es ningún fichero — los trozos se llaman `k.p0`, `k.p1`… Así que una
// descarga que fallara a medias dejaba en disco todo lo ya escrito, para
// siempre. Con un modelo de 3,8 GB eso son gigabytes de basura invisible: el
// intento siguiente pedía sitio para otros 3,8 GB, no cabía, y moría con
// «exceed its storage quota» — un mensaje que suena a disco lleno del usuario
// cuando en realidad la basura era nuestra. Y cada reintento lo empeoraba.
//
// Se prueba con el CAMINO REAL (postMessage al broker, como haría la app), no
// llamando a la función por dentro: lo que se quiere fijar es que después de
// una descarga no quede nada de la anterior, no que cierta función exista.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGINA = readFileSync(join(RAIZ, 'server/broker/index.html'));
const SIZE = 300000;
const DATOS = Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 251));

let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const srv = createServer((req, res) => {
  if (req.url.startsWith('/fixture.bin')) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': SIZE });
    return res.end(DATOS);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGINA);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
// `localhost` y NO `127.0.0.1`: el broker filtra por origen y solo tiene
// permitido el primero. Por IP ignora los mensajes EN SILENCIO, que desde fuera
// se ve igual que un broker colgado.
const BASE = `http://localhost:${srv.address().port}`;

const ARGS = { args: ['--enable-unsafe-webgpu'] };
const b = await chromium.launch(ARGS).catch(() => chromium.launch({ ...ARGS, channel: 'chrome' }));
const page = await (await b.newContext()).newPage();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

const URLFIX = BASE + '/fixture.bin';

// Basura de una descarga ANTERIOR que dejó más partes de las que va a haber
// ahora: es exactamente el estado que dejaba el fallo.
const sembradas = await page.evaluate(async u => {
  const keyFor = x => String(x).replace(/[?#].*$/, '').replace(/[^\w.\-]+/g, '_').slice(-180);
  const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('elffuss-models', { create: true });
  const k = keyFor(u);
  for (const n of [k + '.p0', k + '.p1', k + '.p2', k + '.p3', k + '.done']) {
    const w = await (await d.getFileHandle(n, { create: true })).createWritable();
    await w.write(new Uint8Array(1024)); await w.close();
  }
  const hay = []; for await (const n of d.keys()) hay.push(n);
  return hay.sort();
}, URLFIX);
ok('se siembra basura de una descarga anterior', sembradas.length === 5, sembradas.join(' '));

// El camino real: pedirle el fichero al broker como hace la app.
const res = await page.evaluate(u => new Promise(resolve => {
  const alMensaje = ev => {
    const m = ev.data || {};
    // `!m.kind` descarta NUESTRA propia petición: postMessage a la misma
    // ventana la entrega también a este listener, y lleva el mismo id. Sin
    // esto la prueba se daba por terminada antes de que el broker empezara.
    if (m.id !== 'prueba' || !m.kind || m.kind === 'progress') return;
    window.removeEventListener('message', alMensaje);
    // El broker devuelve el File de OPFS por referencia, no los bytes.
    if (m.kind === 'file') resolve({ ok: true, bytes: m.file?.size });
    else resolve({ ok: false, error: m.message || m.kind });
  };
  window.addEventListener('message', alMensaje);
  window.postMessage({ type: 'elffuss-model-get', id: 'prueba', url: u }, '*');
  setTimeout(() => resolve({ ok: false, error: 'sin respuesta en 30 s' }), 30000);
}), URLFIX);
ok('el broker sirve el fichero', res.ok && res.bytes === SIZE, res.error || `${res.bytes} bytes de ${SIZE}`);

const quedan = await page.evaluate(async () => {
  const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('elffuss-models', { create: true });
  const hay = []; for await (const n of d.keys()) hay.push(n);
  return hay.sort();
});
// Sobrevive lo de la descarga NUEVA (una parte y su marca). Lo que no puede
// quedar es ninguna de las partes de más.
const sobra = quedan.filter(n => /\.p[123]$/.test(n));
ok('no quedan trozos huérfanos de la descarga anterior', sobra.length === 0,
  sobra.length ? 'quedaron: ' + sobra.join(' ') : 'en disco: ' + quedan.join(' '));

await b.close();
srv.close();
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ BROKER OK — no deja basura detrás');
process.exit(fails ? 1 : 0);

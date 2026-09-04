// El 27B contra el código LOCAL: ¿carga y CONTESTA?
// ─────────────────────────────────────────────────────────────────────────────
// El humo de producción (`claw-prod27.mjs`) dice si funciona lo DESPLEGADO. Este
// dice si funciona lo que se acaba de tocar, sin desplegar nada.
//
// Sirve `web/` desde disco y hace de espejo por rangos del GGUF que está en
// producción, TODO en el mismo origen. Eso importa por dos motivos: el servidor
// del modelo no manda cabeceras CORS (leerlo desde otro puerto lo bloquea el
// navegador), y el kernel solo ofrece el 27B si un HEAD al fichero responde —
// contra un servidor que no lo tiene, la opción ni aparece en el selector.
//
//   node tests/local27.mjs            # ~7,6 GB por la red, unos minutos
//   MODELO=file:///ruta/al.gguf node tests/local27.mjs    # si lo tienes en disco
import { chromium } from 'playwright';
import { createServer } from 'http';
import { createReadStream, statSync, readFileSync } from 'fs';
import { Readable } from 'stream';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'web');
const ORIGEN = process.env.MODELO || 'https://claw.elffuss.utopiaia.com/models/qwen38-27b.gguf';
const PUERTO = +(process.env.PUERTO || 8643);
const RUTA_MODELO = '/models/qwen38-27b.gguf';

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// Espejo del modelo: reenvía el Range tal cual y devuelve el 206 con su
// Content-Range. Sin reenviar el rango, el navegador se traería los 7,6 GB de
// golpe en cada petición de 32 MB.
async function espejoModelo(req, res) {
  const local = ORIGEN.startsWith('file://');
  if (local) {
    const ruta = fileURLToPath(ORIGEN);
    const size = statSync(ruta).size;
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' }); return req.method === 'HEAD' ? res.end() : createReadStream(ruta).pipe(res); }
    const ini = +m[1], fin = Math.min(m[2] ? +m[2] : size - 1, size - 1);
    res.writeHead(206, {
      'Content-Type': 'application/octet-stream',
      'Content-Range': `bytes ${ini}-${fin}/${size}`,
      'Content-Length': fin - ini + 1,
      'Accept-Ranges': 'bytes',
    });
    return req.method === 'HEAD' ? res.end() : createReadStream(ruta, { start: ini, end: fin }).pipe(res);
  }
  const r = await fetch(ORIGEN, {
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: req.headers.range ? { Range: req.headers.range } : {},
  });
  const cab = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  for (const k of ['content-range', 'content-length']) {
    const v = r.headers.get(k);
    if (v) cab[k === 'content-range' ? 'Content-Range' : 'Content-Length'] = v;
  }
  res.writeHead(r.status, cab);
  if (req.method === 'HEAD' || !r.body) return res.end();
  Readable.fromWeb(r.body).pipe(res);
}

const server = createServer(async (req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (ruta === RUTA_MODELO) return await espejoModelo(req, res);
    const rel = normalize(ruta === '/' ? '/index.html' : ruta).replace(/^(\.\.[/\\])+/, '');
    const f = join(WEB, rel);
    const cuerpo = readFileSync(f);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(cuerpo);
  } catch {
    res.writeHead(404); res.end('no está');
  }
});
await new Promise(r => server.listen(PUERTO, r));
const BASE = `http://localhost:${PUERTO}`;
const t0 = Date.now();
const seg = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(4);
const log = s => console.log(`[${seg()}s] ${s}`);
log(`sirviendo ${WEB} y el modelo desde ${ORIGEN.startsWith('file') ? 'disco' : 'producción'}`);

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (extra ? '  — ' + extra : '')); if (!c) fallos++; };

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
  .catch(() => chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] }));
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('elffuss.welcomed', '1');
    localStorage.setItem('elffuss.grants', JSON.stringify([]));
    localStorage.setItem('elffuss.model', 'engine:qwen38-27b');
  } catch { /* — */ }
});
const p = await ctx.newPage({ viewport: { width: 1280, height: 900 } });
p.on('console', m => { const t = m.text(); if (/\[engine\]|No se pudo|no cabe|OOM|memoria|liberad/i.test(t)) log('  consola: ' + t.slice(0, 180)); });
p.on('pageerror', e => log('  pageerror: ' + String(e.message).slice(0, 160)));
let muerta = '';
p.on('crash', () => { muerta = 'la pestaña ha CRASHEADO (el renderer)'; log('  ⚠️ ' + muerta); });
// Y el navegador ENTERO también se puede ir: con 7,6 GB en la GPU no siempre se
// muere solo la pestaña, y entonces el evento de arriba no llega nunca.
b.on('disconnected', () => { muerta = muerta || 'el NAVEGADOR entero se ha ido'; log('  ⚠️ ' + muerta); });

// Testigos de fuera del navegador: si lo que se agota es la máquina, se ve aquí
// aunque el proceso que se muere no llegue a contarlo.
const sh = c => { try { return execSync(c, { encoding: 'utf8' }).trim(); } catch { return '?'; } };
const libreGB = async () => {
  const v = sh('vm_stat | head -2 | tail -1');
  const paginas = +(/(\d+)/.exec(v)?.[1] || 0);
  return (paginas * 16384 / 1073741824).toFixed(1);
};
const chromiumRSS = () => {
  const kb = sh(`ps -Ao rss,comm | grep -i chromium | awk '{s+=$1} END {print s}'`);
  return kb === '?' || !kb ? 'no está' : (kb / 1048576).toFixed(1) + ' GB';
};

await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

let estado = '', ultimo = '', cargado = false;
while (Date.now() - t0 < 40 * 60 * 1000 && !muerta) {
  let s;
  try {
    s = await p.evaluate(() => ({
      est: document.querySelector('#model-status')?.className || '',
      txt: document.querySelector('#loading-stage .ls-progtext')?.textContent
        || document.querySelector('#model-progress-text')?.textContent || '',
    }));
  } catch (e) { muerta = muerta || 'la página dejó de responder: ' + String(e.message).split('\n')[0].slice(0, 90); break; }
  estado = s.est;
  if (s.txt && s.txt !== ultimo) { ultimo = s.txt; log(ultimo.trim().slice(0, 110)); }
  if (/\b(on|gpu)\b/.test(estado)) { cargado = true; break; }
  if (/\berr(or)?\b/.test(estado)) break;
  await p.waitForTimeout(5000).catch(() => {});
}
ok('el 27B carga entero por rangos', cargado, muerta || 'indicador: ' + estado + ' · ' + ultimo);
if (cargado) log(`con el modelo ya en la GPU: ${await libreGB()} GB de RAM libres · navegador ${chromiumRSS()}`);

if (cargado) {
  // Tope corto de respuesta: con el modelo lento, ocho tokens bastan para saber
  // si contesta y separan el prefill (una pasada por todo el prompt) del decode
  // (muchas pasadas cortas). Si se cae, se cae en la primera, y eso ya es un dato.
  // El import devuelve la MISMA instancia del módulo que usa el kernel.
  await p.evaluate(async () => {
    const m = await import('./js/engine/provider.js');
    m.setSampling({ maxTokens: 8 });
  }).catch(e => log('  no se pudo acotar la respuesta: ' + String(e.message).slice(0, 80)));

  log('preguntando…');
  await p.fill('#prompt', 'Di solo: hola');
  await p.press('#prompt', 'Enter');
  let texto = '';
  const tGen = Date.now();
  while (Date.now() - tGen < 15 * 60 * 1000) {
    // Con timeout CORTO y sin tragarse el fallo: una pestaña muerta devolvía ''
    // en cada vuelta y el test la contaba como «no ha contestado» durante quince
    // minutos, cuando lo que había pasado es que el navegador ya no estaba.
    try {
      texto = (await p.locator('.msg.assistant').last().textContent({ timeout: 10000 })) || '';
    } catch (e) {
      if (muerta || !p.context().browser()?.isConnected()) {
        log('  💀 ' + (muerta || 'el navegador se ha ido') + ` a los ${((Date.now() - tGen) / 1000).toFixed(0)} s de empezar a generar`);
        break;
      }
      texto = '';                        // ocupada, no muerta: se vuelve a mirar
    }
    if (texto.trim().length > 2) break;
    // El montón de JS importa además de la RAM del sistema: la app tiene un
    // vigilante que, si pasa del 92 % del tope, SUELTA el modelo —destruye el
    // GPUDevice— sin mirar si hay un forward en marcha. Si el navegador se cae
    // justo después de que este número se dispare, ya sabemos quién ha sido.
    const heap = await p.evaluate(() => {
      const m = performance.memory;
      return m ? `${Math.round(m.usedJSHeapSize / 1048576)}/${Math.round(m.jsHeapSizeLimit / 1048576)} MB (${Math.round(m.usedJSHeapSize / m.jsHeapSizeLimit * 100)} %)` : 'sin dato';
    }).catch(() => 'no responde');
    log(`  … generando (${((Date.now() - tGen) / 1000).toFixed(0)} s) · RAM libre ${await libreGB()} GB · montón JS ${heap}`);
    await new Promise(r => setTimeout(r, 10000));
  }
  const t = texto.trim();
  ok('contesta algo', t.length > 2, JSON.stringify(t.slice(0, 120)));
  // Esta es LA guardia del arreglo: antes contestaba, sí, pero contestaba
  // «El modelo falló: la caché se llena: 1333 tokens sobre 512 de contexto».
  ok('y no es el error de contexto', !/caché se llena|El modelo falló/i.test(t), JSON.stringify(t.slice(0, 120)));
  await p.screenshot({ path: '/tmp/claw-local27.png' }).catch(() => {});
}

// b.close() se queda colgado con 7,6 GB en la GPU: se le da un margen y se sigue.
await Promise.race([b.close(), new Promise(r => setTimeout(r, 15000))]).catch(() => {});
server.close();
console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo verde');
process.exit(fallos ? 1 : 0);

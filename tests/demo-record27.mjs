// demo-record27.mjs — GRABA en vídeo al Qwen3.8-27B corriendo 100% local por
// WebGPU dentro del navegador: se presenta y resuelve algo difícil. Material para
// un post ("ya es posible, todo en local"). NO es un test; es una toma.
//
// Reutiliza el andamiaje de local27.mjs (sirve web/ + espeja el GGUF de prod en el
// mismo origen, preselecciona engine:qwen38-27b), pero con recordVideo y respuestas
// de verdad. Fichero scratch: se puede borrar al terminar.
//
//   node tests/demo-record27.mjs
import { chromium } from 'playwright';
import { createServer } from 'http';
import { createReadStream, statSync, readFileSync, mkdirSync } from 'fs';
import { Readable } from 'stream';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';

const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'web');
const ORIGEN = process.env.MODELO || 'https://claw.elffuss.utopiaia.com/models/qwen38-27b.gguf';
const PUERTO = +(process.env.PUERTO || 8644);
const RUTA_MODELO = '/models/qwen38-27b.gguf';
const VIDEODIR = process.env.VIDEODIR || '/tmp/claw-demo-video';
const MAXTOK = +(process.env.MAXTOK || 120);

// Preguntas de la demo. El modelo va SIN razonar a propósito: la plantilla de chat
// del propio GGUF abre un bloque <think> y ahora se manda cerrado, porque razonando
// escribiría cientos de tokens antes de la primera palabra útil y aquí cada token se
// paga caro. Por eso NADA de acertijos de lógica (bate y pelota, días de la semana):
// esos se aciertan razonando y fallaría. Se pregunta lo que un 27B hace bien sin
// razonar — conocimiento y matiz de idioma, que es donde un modelo pequeño se cae.
// La identidad del modelo la prueba el SELECTOR y la traza [engine], no el chat:
// el prompt de sistema le da la persona de Elffuss y pisa al modelo base.
const P1 = process.env.P1 || '¿Quién eres?';
const P2 = process.env.P2 || 'Explica en dos frases la diferencia entre «ser» y «estar» en español, con un ejemplo donde cambiar uno por otro cambie el significado.';

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

async function espejoModelo(req, res) {
  if (ORIGEN.startsWith('file://')) {
    const ruta = fileURLToPath(ORIGEN);
    const size = statSync(ruta).size;
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' }); return req.method === 'HEAD' ? res.end() : createReadStream(ruta).pipe(res); }
    const ini = +m[1], fin = Math.min(m[2] ? +m[2] : size - 1, size - 1);
    res.writeHead(206, { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${ini}-${fin}/${size}`, 'Content-Length': fin - ini + 1, 'Accept-Ranges': 'bytes' });
    return req.method === 'HEAD' ? res.end() : createReadStream(ruta, { start: ini, end: fin }).pipe(res);
  }
  const r = await fetch(ORIGEN, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers: req.headers.range ? { Range: req.headers.range } : {} });
  const cab = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  for (const k of ['content-range', 'content-length']) { const v = r.headers.get(k); if (v) cab[k === 'content-range' ? 'Content-Range' : 'Content-Length'] = v; }
  res.writeHead(r.status, cab);
  if (req.method === 'HEAD' || !r.body) return res.end();
  Readable.fromWeb(r.body).pipe(res);
}

const server = createServer(async (req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (ruta === RUTA_MODELO) return await espejoModelo(req, res);
    const rel = normalize(ruta === '/' ? '/index.html' : ruta).replace(/^(\.\.[/\\])+/, '');
    const cuerpo = readFileSync(join(WEB, rel));
    res.writeHead(200, { 'Content-Type': TIPOS[extname(join(WEB, rel))] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(cuerpo);
  } catch { res.writeHead(404); res.end('no está'); }
});
// PROD=1 graba contra el sitio PÚBLICO (lo que hace verdadero el "simplemente
// conectándote aquí"): no se sirve nada en local, el navegador se lo baja todo de
// producción, GGUF incluido. Tarda más (~430-545 s) pero es la experiencia real.
const PROD = process.env.PROD === '1';
if (!PROD) await new Promise(r => server.listen(PUERTO, r));
const BASE = PROD ? 'https://claw.elffuss.utopiaia.com' : `http://localhost:${PUERTO}`;
const t0 = Date.now();
const seg = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(4);
const log = s => console.log(`[${seg()}s] ${s}`);
mkdirSync(VIDEODIR, { recursive: true });
log(`grabando en ${VIDEODIR} · modelo desde ${ORIGEN.startsWith('file') ? 'disco' : 'producción'}`);

const ARGS = ['--enable-unsafe-webgpu', '--use-angle=metal'];
const b = await chromium.launch({ args: ARGS }).catch(() => chromium.launch({ channel: 'chrome', args: ARGS }));
const ctx = await b.newContext({
  locale: 'es-ES',
  viewport: { width: 1280, height: 900 },
  recordVideo: { dir: VIDEODIR, size: { width: 1280, height: 900 } },
});
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('elffuss.welcomed', '1');
    localStorage.setItem('elffuss.grants', JSON.stringify([]));
    localStorage.setItem('elffuss.model', 'engine:qwen38-27b');
  } catch { /* — */ }
});
const p = await ctx.newPage();
let muerta = '';
p.on('crash', () => { muerta = 'la pestaña ha crasheado'; log('  ⚠️ ' + muerta); });
b.on('disconnected', () => { muerta = muerta || 'el navegador se ha ido'; log('  ⚠️ ' + muerta); });
const engineLines = [];
p.on('console', m => { const t = m.text();
  if (/\[engine\]/i.test(t)) { engineLines.push(t.slice(0, 200)); log('  [engine] ' + t.slice(0, 150)); }
  else if (/No se pudo|no cabe|OOM|memoria|liberad|falló|caché se llena/i.test(t)) log('  consola: ' + t.slice(0, 160)); });

await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

// 1) esperar a que el 27B esté en la GPU
let estado = '', ultimo = '', cargado = false;
while (Date.now() - t0 < 40 * 60 * 1000 && !muerta) {
  let s;
  try {
    s = await p.evaluate(() => ({
      est: document.querySelector('#model-status')?.className || '',
      txt: document.querySelector('#loading-stage .ls-progtext')?.textContent || document.querySelector('#model-progress-text')?.textContent || '',
    }));
  } catch (e) { muerta = 'la página dejó de responder: ' + String(e.message).split('\n')[0].slice(0, 80); break; }
  estado = s.est;
  if (s.txt && s.txt !== ultimo) { ultimo = s.txt; log('carga: ' + ultimo.trim().slice(0, 100)); }
  if (/\b(on|gpu)\b/.test(estado)) { cargado = true; break; }
  if (/\berr(or)?\b/.test(estado)) break;
  await p.waitForTimeout(5000).catch(() => {});
}
if (!cargado) { log('❌ no cargó: ' + (muerta || estado)); await cerrar(); process.exit(1); }
log('✅ 27B en la GPU. Empieza la demo.');

// NO tocar el muestreo por defecto de la app. setSampling() REEMPLAZA la
// configuración entera en vez de fusionarla: llamarlo solo con {maxTokens} mete
// temperature: 0, o sea decodificación greedy y determinista. En greedy, si el
// token más probable resulta ser la parada, el modelo calla y no hay forma de
// que salga de ahí — respuesta vacía, sin error. Eso, y no el motor, es lo que
// dejó mudas las tomas 2 y 3. Se deja disponible pero apagado.
// Solo se acota la LONGITUD, y nada más. Ahora setSampling fusiona en vez de
// reemplazar, así que pasar únicamente maxTokens conserva el muestreo por
// defecto de la app — que es lo que queremos grabar: el producto tal cual, no
// una configuración inventada para la ocasión. El tope existe porque el modelo
// va lento: sin él, la app pide hasta 512 tokens y la respuesta no termina en
// un rato razonable de grabación.
if (MAXTOK > 0) {
  await p.evaluate(async (mt) => { const m = await import('./js/engine/provider.js'); m.setSampling({ maxTokens: mt }); }, MAXTOK)
    .catch(e => log('  no se pudo acotar la longitud: ' + String(e.message).slice(0, 80)));
  log(`longitud acotada a ${MAXTOK} tokens · muestreo: el de la app`);
} else {
  log('muestreo y longitud: por defecto de la app (sin tocar)');
}

async function preguntar(texto, etiqueta) {
  const antes = await p.locator('.msg.assistant').count().catch(() => 0);
  log(`${etiqueta} → «${texto}»`);
  await p.fill('#prompt', texto);
  await p.press('#prompt', 'Enter');
  // esperar a que aparezca una burbuja nueva del asistente. El prefill es lento
  // (~626 tokens de sistema + la pregunta), así que puede tardar minutos: 5 de tope.
  const tG = Date.now();
  let aparecio = false;
  while (Date.now() - tG < 300000) {
    if ((await p.locator('.msg.assistant').count().catch(() => 0)) > antes) { aparecio = true; break; }
    if (muerta) return '';
    if ((Date.now() - tG) % 20000 < 1100) log(`  … prefill (${((Date.now() - tG) / 1000).toFixed(0)}s)`);
    await p.waitForTimeout(1000);
  }
  if (!aparecio) { log('  ⚠️ no apareció respuesta nueva en 300 s'); return ''; }
  // esperar a que el texto se estabilice (deja de crecer)
  let prev = '', quieto = 0;
  while (Date.now() - tG < 8 * 60 * 1000 && !muerta) {
    let cur = '';
    try { cur = (await p.locator('.msg.assistant').last().textContent({ timeout: 8000 })) || ''; }
    catch { if (muerta || !b.isConnected()) break; }
    cur = cur.trim();
    if (cur && cur === prev) { if (++quieto >= 3) break; } else quieto = 0;
    prev = cur;
    log(`  … ${((Date.now() - tG) / 1000).toFixed(0)}s · ${cur.length} car`);
    await p.waitForTimeout(3000);
  }
  log(`${etiqueta} respuesta: ${JSON.stringify(prev.slice(0, 300))}`);
  await p.screenshot({ path: `/tmp/claw-demo-${etiqueta}.png` }).catch(() => {});
  return prev;
}

const r1 = await preguntar(P1, 'q1');
await p.waitForTimeout(2500);
const r2 = muerta ? '' : await preguntar(P2, 'q2');

log('── transcripción ──');
log('P1: ' + P1); log('R1: ' + r1);
log('P2: ' + P2); log('R2: ' + r2);
if (engineLines.length) { log('── traza [engine] (prueba de identidad del modelo) ──'); engineLines.forEach(l => log('  ' + l)); }

// cerrar y volcar el vídeo
let videoPath = '';
try { videoPath = await p.video().path(); } catch { /* — */ }
async function cerrar() {
  await Promise.race([ctx.close(), new Promise(r => setTimeout(r, 20000))]).catch(() => {});
  await Promise.race([b.close(), new Promise(r => setTimeout(r, 10000))]).catch(() => {});
  try { server.close(); } catch { /* en PROD nunca se puso a escuchar */ }
}
await cerrar();
log('🎬 vídeo: ' + (videoPath || '(no se pudo obtener la ruta; mira ' + VIDEODIR + ')'));
console.log(muerta ? `\n⚠️ terminó con: ${muerta}` : '\n✅ toma completa');
process.exit(0);

// demo-corto27.mjs — TOMA de vídeo del Qwen3.8-27B contestando dentro del
// navegador, y a la vez SONDA de por qué la toma anterior se quedó muda.
//
// Qué cambia respecto a demo-record27.mjs (que se quedó en silencio 300 s):
//
// 1) Mide la latencia AL PRIMER TOKEN, no al mensaje terminado. La toma anterior
//    esperaba a `.msg.assistant`, que la interfaz solo crea cuando la respuesta
//    está ENTERA; mientras el modelo prefila y escribe solo existe
//    `.msg.thinking .gen`. Un modelo escribiendo perfectamente se veía igual que
//    uno colgado. Aquí se vigilan las dos cosas por separado.
//
// 2) Puede forzar el prompt CORTO. `agent.js` elige el prompt compacto (111
//    tokens) solo si el contexto del modelo es < CTX_MINIMO_COMPLETO (1.600); al
//    subir el `ctx` del 27B de 512 a 2.048 para que la caché KV no reventara, esa
//    condición dejó de cumplirse y el 27B volvió a recibir el prompt ENTERO. Con
//    PROMPT=corto se parchea la constante AL SERVIR (no se toca el árbol) para
//    que vuelva a coger el compacto. PROMPT=largo deja la app tal cual está.
//
// 3) MODELO puede ser un file:// local: el mismo GGUF que sirve producción, ya
//    descargado, para no pagar 7,6 GB por intento.
//
//   PROMPT=corto MODELO=file:///tmp/qwen38-27b.gguf node tests/demo-corto27.mjs
import { chromium } from 'playwright';
import { createServer } from 'http';
import { createReadStream, statSync, readFileSync, mkdirSync } from 'fs';
import { Readable } from 'stream';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';

const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'web');
const ORIGEN = process.env.MODELO || 'https://claw.elffuss.utopiaia.com/models/qwen38-27b.gguf';
const PUERTO = +(process.env.PUERTO || 8646);
const RUTA_MODELO = '/models/qwen38-27b.gguf';
const VIDEODIR = process.env.VIDEODIR || '/tmp/claw-demo-corto';
const MAXTOK = +(process.env.MAXTOK || 120);
const CORTO = (process.env.PROMPT || 'corto') === 'corto';
const ESPERA = +(process.env.ESPERA || 900);   // s de margen por pregunta

const P1 = process.env.P1 || 'Preséntate en una frase.';
const P2 = process.env.P2 || 'Un bate y una pelota cuestan 1,10 € en total. El bate cuesta 1 € más que la pelota. ¿Cuánto cuesta la pelota? Contesta en una frase.';

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// El parche del prompt se hace al servir, no en disco: hay otra sesión editando
// este repo. Y si el texto esperado no aparece, se ABORTA: un parche que no
// aplica en silencio convierte la toma en una medida falsa.
const MARCA = 'export const CTX_MINIMO_COMPLETO = 1600;';
function parchear(rel, cuerpo) {
  if (!CORTO || rel !== 'js/agent.js') return cuerpo;
  const txt = cuerpo.toString('utf8');
  if (!txt.includes(MARCA)) throw new Error(`agent.js ya no contiene «${MARCA}»: el parche del prompt corto no aplica`);
  return Buffer.from(txt.replace(MARCA, 'export const CTX_MINIMO_COMPLETO = 1e9;'), 'utf8');
}

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
    const rel = normalize(ruta === '/' ? '/index.html' : ruta).replace(/^\/+/, '').replace(/^(\.\.[/\\])+/, '');
    const cuerpo = parchear(rel, readFileSync(join(WEB, rel)));
    res.writeHead(200, { 'Content-Type': TIPOS[extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(cuerpo);
  } catch (e) {
    if (/no aplica/.test(e.message)) { console.error('❌ ' + e.message); process.exit(2); }
    res.writeHead(404); res.end('no está');
  }
});
await new Promise(r => server.listen(PUERTO, r));
const BASE = `http://localhost:${PUERTO}`;
const t0 = Date.now();
const seg = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(4);
const log = s => console.log(`[${seg()}s] ${s}`);
mkdirSync(VIDEODIR, { recursive: true });
log(`prompt ${CORTO ? 'CORTO (compacto forzado)' : 'LARGO (app tal cual)'} · modelo desde ${ORIGEN.startsWith('file') ? 'disco local' : 'producción'} · ${MAXTOK} tokens de tope`);

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
// Ensayo en seco: comprueba que el parche del prompt hace lo que dice ANTES de
// gastar 7,6 GB y una GPU en descubrir que no. Abre la misma app servida por el
// mismo servidor, pero con el modelo `rules` (no descarga nada).
if (process.env.SOLO_PROMPT) {
  const q = await b.newContext({ locale: 'es-ES' });
  await q.addInitScript(() => { try { localStorage.setItem('elffuss.model', 'rules'); localStorage.setItem('elffuss.welcomed', '1'); } catch { /* — */ } });
  const pg = await q.newPage();
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(800);
  const r = await pg.evaluate(async () => {
    const [a, pr] = await Promise.all([import('./js/agent.js'), import('./js/engine/provider.js')]);
    pr.configure('qwen38-27b');
    const ctxTok = pr.contextTokens();
    const compacto = ctxTok > 0 && ctxTok < a.CTX_MINIMO_COMPLETO;
    return { ctxTok, umbral: a.CTX_MINIMO_COMPLETO, compacto, chars: a.systemPrompt('', { compacto }).length };
  });
  console.log('ensayo en seco:', JSON.stringify(r));
  console.log(r.compacto ? '✅ el agente elegiría el prompt COMPACTO' : '❌ el agente elegiría el prompt COMPLETO');
  await b.close(); server.close();
  process.exit(r.compacto === CORTO ? 0 : 1);
}

const p = await ctx.newPage();
let muerta = '';
p.on('crash', () => { muerta = 'la pestaña ha crasheado'; log('  ⚠️ ' + muerta); });
b.on('disconnected', () => { muerta = muerta || 'el navegador se ha ido'; log('  ⚠️ ' + muerta); });
const engineLines = [];
p.on('console', m => {
  const t = m.text();
  if (/\[engine\]/i.test(t)) { engineLines.push(t.slice(0, 200)); log('  [engine] ' + t.slice(0, 150)); }
  else if (/No se pudo|no cabe|OOM|memoria|liberad|falló|caché se llena|instrucciones ocupan/i.test(t)) log('  consola: ' + t.slice(0, 160));
});

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
const tCarga = (Date.now() - t0) / 1000;
log(`✅ 27B en la GPU (${tCarga.toFixed(0)}s). Empieza la demo.`);

await p.evaluate(async (mt) => { const m = await import('./js/engine/provider.js'); m.setSampling({ maxTokens: mt }); }, MAXTOK)
  .catch(e => log('  no se pudo fijar maxTokens: ' + String(e.message).slice(0, 80)));

// Cuántos tokens le entran de verdad: el mismo tokenizador del GGUF que usa el
// motor, sobre el mismo prompt de sistema que va a montar el agente. Es LA cifra
// que explica la espera, así que se mide, no se supone.
const medida = await p.evaluate(async () => {
  const [a, pr] = await Promise.all([import('./js/agent.js'), import('./js/engine/provider.js')]);
  const ctxTok = pr.contextTokens();
  const compacto = ctxTok > 0 && ctxTok < a.CTX_MINIMO_COMPLETO;
  const texto = a.systemPrompt('', { compacto });
  return { ctxTok, umbral: a.CTX_MINIMO_COMPLETO, compacto, chars: texto.length };
}).catch(e => ({ error: String(e.message).slice(0, 120) }));
log(`prompt de sistema: ${JSON.stringify(medida)}`);

async function preguntar(texto, etiqueta) {
  const antes = await p.locator('.msg.assistant').count().catch(() => 0);
  log(`${etiqueta} → «${texto}»`);
  await p.fill('#prompt', texto);
  await p.press('#prompt', 'Enter');

  const tG = Date.now();
  let primer = 0, ultimoN = -1, final = '';
  while (Date.now() - tG < ESPERA * 1000 && !muerta) {
    let s;
    try {
      s = await p.evaluate((n) => ({
        gen: document.querySelector('.msg.thinking .gen')?.textContent || '',
        etiq: document.querySelector('.msg.thinking .label')?.textContent || '',
        listo: document.querySelectorAll('.msg.assistant').length > n
          ? document.querySelectorAll('.msg.assistant')[document.querySelectorAll('.msg.assistant').length - 1].textContent : '',
      }), antes);
    } catch { if (muerta || !b.isConnected()) break; await p.waitForTimeout(1000); continue; }

    if (s.listo) { final = s.listo.trim(); break; }
    if (!primer && s.gen.length > 0) { primer = (Date.now() - tG) / 1000; log(`  ⚡ PRIMER TOKEN a los ${primer.toFixed(0)}s — «${s.gen.slice(0, 60)}»`); }
    if (s.gen.length !== ultimoN) { ultimoN = s.gen.length; if (primer) log(`  … ${((Date.now() - tG) / 1000).toFixed(0)}s · ${s.gen.length} car`); }
    else if ((Date.now() - tG) % 30000 < 1600 && !primer) log(`  … prefill (${((Date.now() - tG) / 1000).toFixed(0)}s, aún sin primer token)`);
    await p.waitForTimeout(1500);
  }
  const total = (Date.now() - tG) / 1000;
  if (!final && !primer) log(`  ❌ ni un token en ${total.toFixed(0)}s`);
  else if (!final) log(`  ⚠️ empezó a los ${primer.toFixed(0)}s pero no terminó en ${total.toFixed(0)}s`);
  else log(`  ✅ ${etiqueta}: primer token ${primer ? primer.toFixed(0) + 's' : '—'} · completa ${total.toFixed(0)}s`);
  log(`${etiqueta} respuesta: ${JSON.stringify(final.slice(0, 300))}`);
  await p.screenshot({ path: `/tmp/claw-corto-${etiqueta}.png` }).catch(() => {});
  return { final, primer, total };
}

const r1 = await preguntar(P1, 'q1');
await p.waitForTimeout(2500);
const r2 = muerta ? { final: '' } : await preguntar(P2, 'q2');

log('── transcripción ──');
log('P1: ' + P1); log('R1: ' + r1.final);
log('P2: ' + P2); log('R2: ' + r2.final);
if (engineLines.length) { log('── traza [engine] ──'); engineLines.forEach(l => log('  ' + l)); }

let videoPath = '';
try { videoPath = await p.video().path(); } catch { /* — */ }
async function cerrar() {
  await Promise.race([ctx.close(), new Promise(r => setTimeout(r, 20000))]).catch(() => {});
  await Promise.race([b.close(), new Promise(r => setTimeout(r, 10000))]).catch(() => {});
  server.close();
}
await cerrar();
log('🎬 vídeo: ' + (videoPath || '(mira ' + VIDEODIR + ')'));
console.log(muerta ? `\n⚠️ terminó con: ${muerta}` : `\n✅ toma completa · carga ${tCarga.toFixed(0)}s · q1 ${r1.primer ? r1.primer.toFixed(0) + 's al primer token' : 'muda'}`);
process.exit(0);

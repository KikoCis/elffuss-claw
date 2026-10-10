// E2E contra PRODUCCIÓN: Claw con el Bonsai 27B del motor propio, elegido en el
// selector como lo haría un usuario, grabado en vídeo.
//
//   node tests/e2e-bonsai-prod.mjs
//
// Qué comprueba (sale con 1 si falla cualquiera):
//   · el registro de producción tiene un modelo cuyos fragmentos son los de Bonsai
//   · la opción aparece en el selector y se puede elegir
//   · el modelo carga sin error (indicador en GPU, selector y localStorage en él,
//     traza «[engine] … listo desde …», ningún «fallo cargando modelo»)
//   · cada respuesta la produce el motor local (una traza «[engine] turno: salieron
//     N tokens» con N > 0 dentro de la ventana de esa pregunta)
//   · cada respuesta no está vacía y no es un mensaje de error
//   · ninguna petición sale a un host que no sea el propio sitio, los hosts del
//     modelo (m1/m2/models) o las CDN de jsdelivr / Hugging Face — en particular,
//     ninguna a una API de LLM
//   · la página no lanza errores no capturados ni se cae
//
// Antes de tocar la GPU mira si hay otros inquilinos TRABAJANDO (llama.cpp,
// ollama con modelo cargado, servidores MLX, otro navegador con WebGPU, o la GPU
// ocupada): si los hay, espera hasta 10 min mirando cada minuto y, si siguen,
// aborta con código 2. Un servidor residente pero parado se anota y no bloquea.
//
// Perfil DEDICADO y persistente (no el de otras pruebas): la primera vez baja el
// modelo entero; las siguientes lo leen del almacén. FRESCO=1 lo borra antes.
//
// Variables: SITIO, OUTDIR, PERFIL, FRESCO, MAXTOK, P1, P2, CARGA_MAX_MIN,
// RESP_MAX_MIN, ESPERA_INQUILINOS_MIN, IGNORA_INQUILINOS.
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, renameSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const SITIO = (process.env.SITIO || 'https://claw.elffuss.utopiaia.com').replace(/\/$/, '');
const ORIGEN = new URL(SITIO).origin;
const OUTDIR = process.env.OUTDIR || join(homedir(), 'work2026', 'elffuss-assets', '_recording', 'bonsai-claw');
const PERFIL = process.env.PERFIL || join(tmpdir(), 'elffuss-e2e-bonsai-perfil');
const MAXTOK = +(process.env.MAXTOK || 200);
const P1 = process.env.P1 || '¿Quién eres?';
const P2 = process.env.P2 || 'Explica en dos frases la diferencia entre «ser» y «estar» en español, con un ejemplo donde cambiar uno por otro cambie el significado.';
const CARGA_MAX = +(process.env.CARGA_MAX_MIN || 60) * 60000;
const RESP_MAX = +(process.env.RESP_MAX_MIN || 20) * 60000;
const ESPERA_INQ = +(process.env.ESPERA_INQUILINOS_MIN || 10);
const W = 1280, H = 800;

const t0 = Date.now();
const ms = () => Date.now() - t0;
const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const log = s => console.log(`[${String(Math.round(ms() / 1000)).padStart(5)}s] ${s}`);
mkdirSync(OUTDIR, { recursive: true });

const resultado = {
  prueba: 'e2e-bonsai-prod', fecha: new Date().toISOString(), sitio: SITIO,
  modelo: null, preguntas: [P1, P2], maxTokens: MAXTOK,
  perfil: basename(PERFIL), perfilFresco: false,
  asserts: [], fases: {}, respuestas: [], red: {}, erroresPagina: [], erroresConsola: [],
  trazaEngine: [], inquilinos: {}, video: null, veredicto: null,
};
const asserts = resultado.asserts;
function aserta(nombre, ok, detalle = '') {
  asserts.push({ nombre, ok: !!ok, detalle });
  log(`${ok ? 'PASA' : 'FALLA'} · ${nombre}${detalle ? ' — ' + detalle : ''}`);
  return !!ok;
}
function guardar() {
  const fallos = asserts.filter(a => !a.ok).length;
  resultado.veredicto = resultado.veredicto || (fallos ? `FALLA (${fallos} de ${asserts.length})` : `PASA (${asserts.length} de ${asserts.length})`);
  resultado.fases.total_ms = ms();
  writeFileSync(join(OUTDIR, `bonsai-claw-${sello}.json`), JSON.stringify(resultado, null, 2));
}

// ── Otros inquilinos de la GPU ──────────────────────────────────────────────
function inquilinos() {
  let ps = '';
  try { ps = execFileSync('ps', ['-Ao', 'pid=,pcpu=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 }); } catch { return []; }
  const out = [];
  for (const l of ps.split('\n')) {
    const m = /^\s*(\d+)\s+([\d.]+)\s+(.*)$/.exec(l);
    if (!m) continue;
    const [, pid, cpu, cmd] = m;
    if (+pid === process.pid || cmd.includes(basename(PERFIL))) continue;   // nuestro navegador no cuenta
    let tipo = null;
    if (/llama-server|llama-cli|llama-bench|llama-imatrix/.test(cmd)) tipo = 'llama.cpp';
    else if (/ollama runner|ollama_llama_server/.test(cmd)) tipo = 'ollama con modelo cargado';
    else if (/omlx-server|mlx_lm|mlx-lm|mlx_vlm/.test(cmd)) tipo = 'servidor MLX';
    else if (/--enable-unsafe-webgpu/.test(cmd) && !/--type=/.test(cmd)) tipo = 'navegador con WebGPU';
    if (tipo) out.push({ pid: +pid, cpu: +cpu, tipo, cmd: cmd.split(' ')[0].split('/').pop().slice(0, 60) });
  }
  return out;
}
function usoGPU() {
  try {
    const s = execFileSync('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], { encoding: 'utf8' });
    const m = /"Device Utilization %"=(\d+)/.exec(s);
    return m ? +m[1] : null;
  } catch { return null; }
}
async function sondeoInquilinos() {
  const muestras = [];
  for (let i = 0; i < 5; i++) { muestras.push(usoGPU()); await new Promise(r => setTimeout(r, 1000)); }
  const validas = muestras.filter(v => v != null).sort((a, b) => a - b);
  const gpuMediana = validas.length ? validas[Math.floor(validas.length / 2)] : null;
  const lista = inquilinos();
  const activos = lista.filter(x => x.cpu > 5);
  const ocupado = activos.length > 0 || (gpuMediana != null && gpuMediana > 15);
  return { ocupado, gpuMediana, activos, residentes: lista.filter(x => x.cpu <= 5) };
}

let sondeo = await sondeoInquilinos();
resultado.inquilinos.inicio = sondeo;
if (sondeo.residentes.length) log('residentes parados (no bloquean): ' + sondeo.residentes.map(x => `${x.tipo} pid ${x.pid}`).join(', '));
if (sondeo.ocupado && process.env.IGNORA_INQUILINOS !== '1') {
  for (let min = 1; min <= ESPERA_INQ && sondeo.ocupado; min++) {
    log(`GPU ocupada (uso ${sondeo.gpuMediana} %, activos: ${sondeo.activos.map(x => x.tipo + ' ' + x.pid).join(', ') || 'ninguno'}) · espera ${min}/${ESPERA_INQ} min`);
    await new Promise(r => setTimeout(r, 60000));
    sondeo = await sondeoInquilinos();
  }
  resultado.inquilinos.trasEspera = sondeo;
  if (sondeo.ocupado) {
    resultado.veredicto = 'ABORTADO: otros inquilinos siguen usando la GPU';
    guardar();
    log(resultado.veredicto);
    process.exit(2);
  }
}

// Que el equipo no se duerma a media descarga (ERR_NETWORK_IO_SUSPENDED).
try { spawn('caffeinate', ['-dims', '-w', String(process.pid)], { stdio: 'ignore' }).on('error', () => {}); } catch { /* si el sistema no lo trae, da igual */ }

if (process.env.FRESCO === '1') { rmSync(PERFIL, { recursive: true, force: true }); }
resultado.perfilFresco = !existsSync(PERFIL);
log(`perfil ${resultado.perfilFresco ? 'NUEVO (bajará el modelo entero)' : 'reutilizado (puede tenerlo guardado)'}`);

// ── Navegador ────────────────────────────────────────────────────────────────
const ARGS = ['--enable-unsafe-webgpu', '--use-angle=metal'];
const DIR_VIDEO = join(OUTDIR, `.video-${sello}`);
const opciones = {
  headless: false, args: ARGS, locale: 'es-ES',
  viewport: { width: W, height: H },
  recordVideo: { dir: DIR_VIDEO, size: { width: W, height: H } },
};
let ctx;
try { ctx = await chromium.launchPersistentContext(PERFIL, opciones); }
catch (e) {
  log('Chromium de Playwright no arrancó (' + String(e.message).split('\n')[0].slice(0, 80) + '), pruebo Chrome');
  ctx = await chromium.launchPersistentContext(PERFIL, { ...opciones, channel: 'chrome' });
}

// Sin autocarga: el modelo se elige en el selector, como un usuario. Solo en el
// origen de la app — los iframes del broker (m1/m2) tienen su propio almacén.
await ctx.addInitScript(({ origen }) => {
  if (location.origin !== origen) return;
  try {
    localStorage.setItem('elffuss.welcomed', '1');
    localStorage.setItem('elffuss.grants', '[]');
    localStorage.setItem('elffuss.model', 'rules');
  } catch { /* sin localStorage */ }
}, { origen: ORIGEN });

const peticiones = [];
ctx.on('request', r => {
  const u = r.url();
  if (!/^https?:/i.test(u)) return;
  peticiones.push({ t: ms(), url: u, metodo: r.method(), tipo: r.resourceType() });
});

const p = ctx.pages()[0] || await ctx.newPage();
const consola = [];
let muerta = '';
p.on('console', m => {
  const texto = m.text();
  consola.push({ t: ms(), tipo: m.type(), texto: texto.slice(0, 600) });
  if (/\[engine\]/.test(texto)) log('  [engine] ' + texto.slice(0, 170));
  else if (m.type() === 'error') { resultado.erroresConsola.push({ t: ms(), texto: texto.slice(0, 300) }); log('  consola error: ' + texto.slice(0, 170)); }
});
p.on('pageerror', e => { resultado.erroresPagina.push({ t: ms(), mensaje: String(e.message).slice(0, 400) }); log('  pageerror: ' + String(e.message).slice(0, 170)); });
p.on('crash', () => { muerta = 'la pestaña ha crasheado'; log('  ' + muerta); });
ctx.on('close', () => { muerta = muerta || 'el navegador se ha cerrado'; });

const _video = p.video();
const rutaVideo = _video ? await _video.path().catch(() => null) : null;
const trazas = re => consola.filter(c => re.test(c.texto));

// Red y errores: se evalúan en TODAS las salidas, también cuando la carga falla
// (que no llegue a hablar no quita que no deba haber llamado a ninguna API).
let redEvaluada = false;
function evaluarRedYErrores() {
  if (redEvaluada) return;
  redEvaluada = true;
  const hostsModelo = new Set((resultado.modelo?.hosts) || []);
  const permitido = h => h === new URL(SITIO).host || hostsModelo.has(h) || /^m\d+\.elffuss\.utopiaia\.com$/.test(h)
    || h === 'models.elffuss.utopiaia.com' || h === 'cdn.jsdelivr.net'
    || /(^|\.)huggingface\.co$/.test(h) || /(^|\.)hf\.co$/.test(h);
  const LLM_HOST = /(^|\.)(openai\.com|anthropic\.com|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|mistral\.ai|groq\.com|openrouter\.ai|together\.xyz|deepseek\.com|cohere\.(ai|com)|x\.ai|perplexity\.ai|fireworks\.ai)$/i;
  const LLM_RUTA = /\/v1\/(chat\/)?completions|\/v1\/messages|\/v1\/responses|\/api\/(chat|generate)\b/i;
  const porHost = {};
  const prohibidas = [];
  for (const r of peticiones) {
    let u; try { u = new URL(r.url); } catch { continue; }
    porHost[u.host] = (porHost[u.host] || 0) + 1;
    const llm = LLM_HOST.test(u.hostname) || LLM_RUTA.test(u.pathname) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
    if (!permitido(u.host) || llm) prohibidas.push({ t: r.t, metodo: r.metodo, url: (u.origin + u.pathname).slice(0, 160), motivo: llm ? 'API de LLM' : 'host no permitido' });
  }
  resultado.red = { peticiones: peticiones.length, porHost, prohibidas: prohibidas.slice(0, 50) };
  aserta('ninguna petición a APIs de LLM ni a hosts fuera de la lista', prohibidas.length === 0,
    prohibidas.length ? prohibidas.slice(0, 5).map(x => `${x.motivo}: ${x.metodo} ${x.url}`).join(' | ')
      : Object.entries(porHost).map(([h, n]) => `${h}×${n}`).join(', '));
  aserta('la página no tiene errores no capturados ni se cae', resultado.erroresPagina.length === 0 && !muerta,
    muerta || resultado.erroresPagina.slice(0, 3).map(e => e.mensaje.slice(0, 120)).join(' | '));
}

async function cerrarYSalir(codigo) {
  evaluarRedYErrores();
  if (asserts.some(a => !a.ok) && codigo === 0) codigo = 1;
  resultado.inquilinos.fin = { lista: inquilinos(), gpu: usoGPU() };
  await Promise.race([ctx.close(), new Promise(r => setTimeout(r, 30000))]).catch(() => {});
  // El vídeo de la pestaña va con el nombre de la toma; cualquier otro que haya
  // grabado Playwright (una página en blanco inicial, un popup) se conserva
  // aparte con sufijo, sin mezclarlo.
  const finalV = join(OUTDIR, `bonsai-claw-${sello}.webm`);
  if (rutaVideo && existsSync(rutaVideo)) {
    try { renameSync(rutaVideo, finalV); resultado.video = basename(finalV); log('vídeo: ' + finalV); }
    catch { resultado.video = basename(rutaVideo); log('vídeo: ' + rutaVideo); }
  }
  try {
    let n = 0;
    for (const f of readdirSync(DIR_VIDEO)) {
      const extra = join(OUTDIR, `bonsai-claw-${sello}-extra-${++n}.webm`);
      renameSync(join(DIR_VIDEO, f), extra);
      (resultado.videosExtra ||= []).push(basename(extra));
    }
    rmSync(DIR_VIDEO, { recursive: true, force: true });
  } catch { /* sin extras */ }
  resultado.trazaEngine = trazas(/\[engine\]/).map(c => ({ t: c.t, texto: c.texto }));
  guardar();
  log('resultado: ' + join(OUTDIR, `bonsai-claw-${sello}.json`));
  console.log('\n' + asserts.map(a => `${a.ok ? 'PASA ' : 'FALLA'}  ${a.nombre}${a.detalle ? '  — ' + a.detalle : ''}`).join('\n'));
  console.log('\n' + resultado.veredicto);
  process.exit(codigo);
}
const fallidos = () => asserts.some(a => !a.ok);

// ── 1. Abrir ─────────────────────────────────────────────────────────────────
log('abriendo ' + SITIO);
await p.goto(SITIO + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForSelector('#model-select', { timeout: 60000 });
resultado.fases.abrir_ms = ms();
// Perfil reutilizado: la conversación de la vuelta anterior se restauraría y
// entraría en el prompt. Se vacía con el propio botón de la app (recarga).
await p.waitForTimeout(3000);
// (el saludo fijo `.msg.sys` no cuenta como conversación)
if (await p.locator('#log .msg.user, #log .msg.assistant, #log .msg.tool').count().catch(() => 0)) {
  log('había conversación restaurada: se vacía con el botón de la app');
  await Promise.all([p.waitForEvent('domcontentloaded', { timeout: 60000 }).catch(() => {}), p.click('#btn-clear')]);
  await p.waitForSelector('#model-select', { timeout: 60000 });
  await p.waitForTimeout(2000);
}

// ── 2. El registro de producción dice qué id lleva a los fragmentos de Bonsai ─
const reg = await p.evaluate(async () => {
  const r = await import('/js/engine/registro.js');
  for (const [id, m] of Object.entries(r.MODELS || {})) {
    const urls = Array.isArray(m.url) ? m.url.map(f => f.url) : [m.url];
    if (urls.some(u => /bonsai-27b\.p0$/.test(u)) && urls.some(u => /bonsai-27b\.p1$/.test(u)))
      return { id, label: m.label, urls, bytes: m.bytes };
  }
  return null;
}).catch(e => ({ error: String(e.message).slice(0, 200) }));
if (!aserta('registro de producción con los fragmentos de Bonsai (p0/p1)', reg && reg.id,
  reg?.id ? `${reg.id} · ${reg.label} · ${reg.urls.map(u => new URL(u).host).join(' + ')}` : JSON.stringify(reg))) {
  await cerrarYSalir(1);
}
const MODELO = 'engine:' + reg.id;
resultado.modelo = { selector: MODELO, label: reg.label, hosts: reg.urls.map(u => new URL(u).host), bytes: reg.bytes };

// ── 3. Elegirlo en el selector ───────────────────────────────────────────────
const tOpcion0 = ms();
const hayOpcion = await p.waitForSelector(`#model-select option[value="${MODELO}"]`, { state: 'attached', timeout: 120000 })
  .then(() => true).catch(() => false);
resultado.fases.opcionEnSelector_ms = ms() - tOpcion0;
if (!aserta('Bonsai ofrecido en el selector', hayOpcion, hayOpcion ? '' : 'la opción no apareció en 120 s (¿sin WebGPU, o el sondeo de m1/m2 falló?)')) {
  await cerrarYSalir(1);
}
await p.waitForTimeout(1500);
await p.evaluate(() => { const l = document.querySelector('.model-pick') || document.getElementById('model-select'); if (l) { l.style.outline = '3px solid #f5b400'; l.style.outlineOffset = '3px'; } });
await p.selectOption('#model-select', MODELO);
const tCarga0 = ms();
log(`elegido en el selector: ${MODELO} (${reg.label})`);
await p.waitForTimeout(3000);
await p.evaluate(() => { const l = document.querySelector('.model-pick') || document.getElementById('model-select'); if (l) { l.style.outline = ''; l.style.outlineOffset = ''; } });

// ── 4. Carga, con el progreso a la vista ─────────────────────────────────────
const hitos = {};
const marca = (k) => { if (hitos[k] == null) { hitos[k] = ms() - tCarga0; log(`  hito ${k} @ ${(hitos[k] / 1000).toFixed(0)} s`); } };
let visto = '', ultimoPct = -10, estado = '', cargado = false, vioCargando = false;
while (ms() - tCarga0 < CARGA_MAX && !muerta) {
  let s;
  try {
    s = await p.evaluate(() => ({
      est: document.querySelector('#model-status')?.className || '',
      txt: (document.querySelector('#loading-stage .ls-progtext')?.textContent
        || document.querySelector('#model-progress-text')?.textContent || '').trim(),
    }));
  } catch (e) { muerta = 'la página dejó de responder: ' + String(e.message).split('\n')[0].slice(0, 100); break; }
  estado = s.est;
  if (/\bloading\b/.test(estado)) vioCargando = true;
  const t = s.txt;
  if (/Encendiendo la GPU/.test(t)) marca('gpu_encendida');
  if (/parte 1/.test(t)) marca('parte1');
  if (/parte 2/.test(t)) marca('parte2');
  if (/Leyendo el modelo por partes|Leyendo el modelo repartido/.test(t)) marca('lectura_repartida');
  if (/Leyendo el índice/.test(t)) marca('indice');
  if (/subiéndolo a la GPU|Subiendo el modelo a la GPU/.test(t)) marca('subida_gpu');
  if (t && t !== visto) {
    const pct = +((/(\d+)\s*%/.exec(t) || [])[1] ?? -1);
    const base = t.replace(/\d+\s*%.*$/, '');
    if (base !== visto.replace(/\d+\s*%.*$/, '') || pct < 0 || pct - ultimoPct >= 10 || pct === 100) {
      log('carga: ' + t.slice(0, 110)); ultimoPct = pct;
    }
    visto = t;
  }
  if (/\b(on|gpu)\b/.test(estado)) { cargado = true; break; }
  if (vioCargando && /\boff\b/.test(estado)) break;              // changeModel volvió a básico: falló
  if (trazas(/fallo cargando modelo/).length) break;
  await p.waitForTimeout(2000).catch(() => {});
}
resultado.fases.carga_ms = ms() - tCarga0;
resultado.fases.cargaHitos_ms = hitos;
const listo = trazas(/\[engine\].*listo desde/).pop();
resultado.fases.cargaDesde = listo ? (/listo desde (.*?) ·/.exec(listo.texto) || [])[1] || '' : '';
const enPagina = muerta ? {} : await p.evaluate(async () => {
  let nombre = null;
  try { nombre = (await import('/js/engine/provider.js')).name; } catch { /* */ }
  let guardado = null;
  try { guardado = localStorage.getItem('elffuss.model'); } catch { /* */ }
  return { select: document.getElementById('model-select')?.value, guardado, nombre,
    etiqueta: document.getElementById('model-select')?.selectedOptions?.[0]?.textContent || '' };
}).catch(() => ({}));
const falloCarga = trazas(/fallo cargando modelo/).map(c => c.texto).join(' | ');
aserta('modelo cargado sin error', cargado && enPagina.select === MODELO && enPagina.guardado === MODELO && !!listo && !falloCarga,
  cargado ? `indicador ${estado} · selector «${(enPagina.etiqueta || '').slice(0, 60)}» · desde ${resultado.fases.cargaDesde}`
    : `${muerta || 'indicador ' + estado} · último progreso «${visto.slice(0, 80)}»${falloCarga ? ' · ' + falloCarga.slice(0, 200) : ''}`);
aserta('el proveedor activo es el motor local con Bonsai', !!enPagina.nombre && enPagina.nombre.includes(reg.label), String(enPagina.nombre));
if (!cargado) await cerrarYSalir(1);
log(`${reg.label} en la GPU · ${(resultado.fases.carga_ms / 1000).toFixed(0)} s`);

if (MAXTOK > 0) {
  await p.evaluate(async mt => { (await import('/js/engine/provider.js')).setSampling({ maxTokens: mt }); }, MAXTOK)
    .catch(e => log('  no se pudo acotar la longitud: ' + String(e.message).slice(0, 80)));
}

// ── 5. Preguntas ─────────────────────────────────────────────────────────────
const ERROR_TEXTO = /^(⚠️|El modelo falló|No se pudo|El modelo todavía no está cargado|las instrucciones ocupan|tu mensaje ocupa|Se ha perdido la GPU)/i;
const soloLetras = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9ñ]/g, '');

async function preguntar(texto, n) {
  const antesMsgs = await p.locator('.msg.assistant').count().catch(() => 0);
  const desdeConsola = consola.length;
  const fase = { pregunta: texto };
  log(`P${n} → «${texto}»`);
  await p.fill('#prompt', texto);
  await p.waitForTimeout(600);
  await p.press('#prompt', 'Enter');
  const tE = ms();
  let hecho = false;
  while (ms() - tE < RESP_MAX && !muerta) {
    const nuevas = consola.slice(desdeConsola);
    if (fase.prefijo_ms == null && nuevas.some(c => /\[engine\] prefijo/.test(c.texto))) fase.prefijo_ms = ms() - tE;
    const pr = nuevas.find(c => /\[engine\] turno: prompt/.test(c.texto));
    if (pr && fase.prefill_ms == null) { fase.prefill_ms = pr.t - tE; fase.tokensPrompt = +((/prompt (\d+) tokens/.exec(pr.texto) || [])[1] || 0); }
    let st;
    try {
      st = await p.evaluate(() => {
        const th = document.querySelector('.msg.thinking');
        return { pensando: !!th, escribe: !!th && /\d/.test(th.querySelector('.label')?.textContent || ''),
          n: document.querySelectorAll('.msg.assistant').length };
      });
    } catch (e) { muerta = muerta || 'la página dejó de responder: ' + String(e.message).split('\n')[0].slice(0, 100); break; }
    if (st.escribe && fase.primerToken_ms == null) fase.primerToken_ms = ms() - tE;
    if (st.n > antesMsgs && !st.pensando) { hecho = true; break; }
    if ((ms() - tE) % 30000 < 1000) log(`  … ${((ms() - tE) / 1000).toFixed(0)} s${st.escribe ? ' · escribiendo' : ' · leyendo el prompt'}`);
    await p.waitForTimeout(1000).catch(() => {});
  }
  fase.total_ms = ms() - tE;
  const msgs = await p.evaluate(a => [...document.querySelectorAll('.msg.assistant')].slice(a)
    .map(d => ({ texto: (d.innerText || d.textContent || '').trim(), err: d.classList.contains('err') })), antesMsgs).catch(() => []);
  const respuesta = msgs.map(m => m.texto).join('\n').trim();
  const turnos = consola.slice(desdeConsola).filter(c => /\[engine\] turno: salieron/.test(c.texto));
  const tokens = turnos.map(c => +((/salieron (\d+) tokens/.exec(c.texto) || [])[1] || 0));
  const ultimo = turnos[turnos.length - 1];
  let crudo = '';
  if (ultimo) { const m = /empieza por (".*")$/.exec(ultimo.texto); if (m) { try { crudo = JSON.parse(m[1]); } catch { /* */ } } }
  const a = soloLetras(respuesta).slice(0, 12), b = soloLetras(crudo).slice(0, 12);
  const coincide = !!a && !!b && (a.startsWith(b) || b.startsWith(a));
  fase.tokensSalida = tokens;
  resultado.fases[`p${n}`] = fase;
  resultado.respuestas.push({ pregunta: texto, respuesta, esError: msgs.some(m => m.err), turnosMotor: tokens.length, coincideConMotor: coincide });
  log(`R${n} (${(fase.total_ms / 1000).toFixed(0)} s): ${JSON.stringify(respuesta.slice(0, 300))}`);
  await p.screenshot({ path: join(OUTDIR, `bonsai-claw-${sello}-p${n}.png`) }).catch(() => {});

  aserta(`P${n}: respuesta producida por el motor local`, hecho && tokens.length > 0 && tokens.some(k => k > 0),
    tokens.length ? `${tokens.length} turno(s) del motor · ${tokens.join('+')} tokens · texto ${coincide ? 'coincide' : 'NO coincide'} con la salida del motor` : (hecho ? 'sin traza [engine] turno' : (muerta || 'sin respuesta en plazo')));
  aserta(`P${n}: respuesta no vacía y sin error`, hecho && respuesta.length >= 2 && !msgs.some(m => m.err) && !ERROR_TEXTO.test(respuesta),
    hecho ? `${respuesta.length} car.` : (muerta || `no terminó en ${RESP_MAX / 60000} min`));
  return hecho;
}

if (await preguntar(P1, 1) && !muerta) {
  await p.waitForTimeout(2500);
  await preguntar(P2, 2);
}
await p.waitForTimeout(3000).catch(() => {});

// ── 6. Red y errores (dentro de cerrarYSalir) ────────────────────────────────
await cerrarYSalir(fallidos() ? 1 : 0);

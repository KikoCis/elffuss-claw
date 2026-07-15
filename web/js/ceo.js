// Cerebro CEO autónomo (compartido por Elffuss Code y Elffuss Claw): cuando el
// usuario NO está pidiendo nada (ocioso) y hay un modelo local cargado, la elfa
// «trabaja por su cuenta» — revisa el espacio de trabajo, reparte el trabajo en
// varios perfiles que piensan EN PARALELO (cada uno una línea de pensamiento en
// la vista Mente) y sintetiza propuestas de mejora.
//
// Agnóstico de herramientas a propósito: cada app inyecta su propio adaptador
// de workspace (`init({ workspace, ... })`) — Code usa code.js (proyecto de
// código), Claw usa fs.js (carpetas con permiso). El core no sabe ni le importa
// cuál es.
//
// Seguridad: NO modifica tus ficheros. Deja las propuestas en una carpeta
// aditiva (nunca toca lo existente) y las hace «flotar» en la Mente. Se PARA en
// cuanto detecta actividad del usuario y reanuda al volver a estar ocioso.
import { Agent } from './agent.js';
import { humanizeTool } from './humanize.js';

const IDLE_MS = 18000;       // 18 s sin actividad → el CEO se pone a trabajar
const TICK_MS = 3000;        // frecuencia de comprobación
// 5 min entre ciclos automáticos: con 45s, una tarde ociosa generaba MILES de
// ficheros. «Pensar ahora» (forceCycle) sigue disponible sin esperar esto.
const COOLDOWN_MS = 300000;
const SOUL_CAP = 25;          // ficheros sueltos antes de consolidar en archivo.md

// perfil por defecto si la app anfitriona no da los suyos
const GENERIC_PROFILES = [
  { id: 'p1', name: 'Revisión', focus: 'qué mejorar de forma concreta y accionable', color: '#7c5cff' },
  { id: 'p2', name: 'Calidad', focus: 'errores, casos borde, cosas que podrían fallar', color: '#49e8ff' },
];

const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 24) || 'perfil';

// ── namespace (localStorage) y adaptador de workspace: los da la app anfitriona ──
let NS = 'elffuss';           // prefijo de las claves de localStorage
let ws = null;                // { isReady, tree, write, read, list, remove }
let getProvider = () => null;
let isBusy = () => false;     // ¿el usuario tiene trabajo en cola/procesándose? → prioridad
let defaultProfiles = GENERIC_PROFILES;
const K = suffix => NS + '.' + suffix;

function loadProfiles() {
  try { const s = JSON.parse(localStorage.getItem(K('ceoProfiles'))); if (Array.isArray(s) && s.length) return s; } catch { /* */ }
  return defaultProfiles.map(p => ({ ...p }));
}
let profiles = null;
export function getProfiles() { if (!profiles) profiles = loadProfiles(); return profiles; }
export function setProfiles(list) {
  const used = new Set();
  profiles = (list || []).filter(p => p && p.name).map(p => {
    let id = p.id || slug(p.name); let n = id, i = 2;
    while (used.has(n)) n = id + '-' + i++;
    used.add(n);
    return { id: n, name: String(p.name).slice(0, 40), focus: String(p.focus || '').slice(0, 200), color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#7c5cff' };
  });
  if (!profiles.length) profiles = defaultProfiles.map(p => ({ ...p }));
  try { localStorage.setItem(K('ceoProfiles'), JSON.stringify(profiles)); } catch { /* */ }
  emit('ceo', { type: 'reprogram', text: 'Perfiles actualizados: ' + profiles.map(p => p.name).join(', '), profiles });
  return profiles;
}

let enabled = false, running = false, lastActivity = Date.now(), timer = null, lastCycleEnd = 0, cycleN = 0;

// MISIÓN reprogramable: el usuario puede reorientar el cerebro desde la Mente
// («céntrate en seguridad», «optimiza mis Excel», «documenta todo»…).
let DEFAULT_MISSION = 'Revisar el espacio de trabajo y proponer mejoras concretas y accionables.';
let mission = null;
function ensureMission() { if (mission == null) { try { mission = localStorage.getItem(K('ceoMission')) || DEFAULT_MISSION; } catch { mission = DEFAULT_MISSION; } } }
export function getMission() { ensureMission(); return mission; }
export function setMission(text) {
  mission = (text || '').trim() || DEFAULT_MISSION;
  try { localStorage.setItem(K('ceoMission'), mission); } catch { /* */ }
  emit('ceo', { type: 'reprogram', text: 'Nueva misión recibida: ' + mission });
  lastCycleEnd = 0; lastActivity = Date.now() - IDLE_MS; // que arranque un ciclo pronto con la nueva misión
  return mission;
}

// Carpeta-«alma» donde el cerebro crea y guarda TODO (configurable).
let DEFAULT_SOUL = '.elffuss/soul';
let soulDir = null;
function ensureSoulDir() { if (soulDir == null) { try { soulDir = localStorage.getItem(K('ceoDir')) || DEFAULT_SOUL; } catch { soulDir = DEFAULT_SOUL; } } }
export function getSoulDir() { ensureSoulDir(); return soulDir; }
export function setSoulDir(dir) {
  soulDir = (dir || '').trim().replace(/^\/+|\/+$/g, '') || DEFAULT_SOUL;
  try { localStorage.setItem(K('ceoDir'), soulDir); } catch { /* */ }
  emit('ceo', { type: 'reprogram', text: 'Nueva carpeta-alma: ' + soulDir + '/' });
  return soulDir;
}

// ── semáforo cross-pestaña: UN SOLO cerebro ejecuta, TODAS visualizan ───────
// El líder tiene un Web Lock exclusivo (se libera solo al cerrar la pestaña);
// difunde sus pensamientos por BroadcastChannel para que el resto los vea.
// (Aislado por origen por el propio navegador: Code y Claw nunca se cruzan.)
let isLeader = false, bc = null, realEmit = () => {}, crossTabWired = false;
function initCrossTab() {
  if (crossTabWired) return;
  crossTabWired = true;
  try {
    bc = new BroadcastChannel(NS + '-ceo');
    bc.onmessage = e => { if (e.data && e.data.kind === 'thought') realEmit(e.data.channel, e.data.ev); };
  } catch { /* sin BroadcastChannel */ }
  if (navigator.locks && navigator.locks.request) {
    navigator.locks.request(NS + '-ceo-leader', { mode: 'exclusive' }, () => new Promise(() => { isLeader = true; }))
      .catch(() => { isLeader = true; });
  } else { isLeader = true; }
}
function emit(channel, ev) {
  realEmit(channel, ev);
  try { bc && bc.postMessage({ kind: 'thought', channel, ev }); } catch { /* ev no serializable */ }
}

// init({ workspace, provider, onEvent, isBusy, namespace, defaultProfiles, defaultMission, defaultSoulDir })
export function init(opts = {}) {
  if (opts.workspace) ws = opts.workspace;
  if (opts.provider) getProvider = opts.provider;
  if (opts.onEvent) realEmit = opts.onEvent;
  if (opts.isBusy) isBusy = opts.isBusy;
  if (opts.namespace) NS = opts.namespace;
  if (opts.defaultProfiles) defaultProfiles = opts.defaultProfiles;
  if (opts.defaultMission) DEFAULT_MISSION = opts.defaultMission;
  if (opts.defaultSoulDir) DEFAULT_SOUL = opts.defaultSoulDir;
  initCrossTab();
}
export function isThisTabLeader() { return isLeader; }
export function noteActivity() { lastActivity = Date.now(); if (running) running = 'interrupt'; }
export function isEnabled() { return enabled; }
export function isRunning() { return !!running; }
// Play/stop: persistido AQUÍ (fuente única) — cualquier botón que lo toque
// queda sincronizado, y la elección sobrevive a recargar la página.
export function wasEnabledLastSession() { try { return localStorage.getItem(K('ceoEnabled')) === '1'; } catch { return false; } }
// ¿el usuario llegó a decidir alguna vez (play o stop)? Distingue «nunca lo
// tocó» de «lo pausó a propósito» — solo lo primero debe auto-activarse al
// abrir la Mente; lo segundo hay que RESPETARLO, no pisarlo.
export function hasDecided() { try { return localStorage.getItem(K('ceoEnabled')) != null; } catch { return false; } }
export function enable() {
  if (enabled) return;
  enabled = true; lastActivity = Date.now(); schedule();
  try { localStorage.setItem(K('ceoEnabled'), '1'); } catch { /* */ }
  emit('sys', { type: 'status', text: 'CEO en guardia — trabajaré cuando estés ocioso' });
}
export function disable() {
  enabled = false; running = false; if (timer) clearTimeout(timer);
  try { localStorage.setItem(K('ceoEnabled'), '0'); } catch { /* */ }
  emit('sys', { type: 'status', text: 'CEO en pausa' });
}

function schedule() { if (timer) clearTimeout(timer); timer = setTimeout(tick, TICK_MS); }

// «Pensar ahora» — salta la espera de ociosidad. Sigue respetando el
// semáforo: si otra pestaña es la líder, no compite por la GPU.
export async function forceCycle() {
  if (!isLeader) { emit('ceo', { type: 'paused', text: 'Otra pestaña lleva el cerebro — ábrela ahí para forzar un ciclo.' }); return false; }
  if (running) return false;
  // isReady() puede ser síncrona (Code: handle en memoria) o async (Claw: consulta IndexedDB) — se espera siempre.
  if (!(await ws?.isReady()) || !getProvider()) { emit('ceo', { type: 'paused', text: 'Necesito un espacio de trabajo abierto y un modelo cargado.' }); return false; }
  try { await runCycle(); } finally { lastCycleEnd = Date.now(); }
  return true;
}

async function tick() {
  if (!enabled) return;
  const idle = Date.now() - lastActivity;
  const rested = Date.now() - lastCycleEnd > COOLDOWN_MS;
  const mightRun = isLeader && !running && !isBusy() && idle >= IDLE_MS && rested && getProvider();
  if (mightRun && await ws?.isReady()) {
    try { await runCycle(); } catch { /* siguiente ciclo */ }
    lastCycleEnd = Date.now();
  }
  schedule();
}

// helper: corre el agente con el proveedor actual sobre un prompt, emitiendo
// tokens/herramientas a un canal. Devuelve el texto final. Las tool-calls pasan
// SIEMPRE por el mismo runTool que usa el chat normal (Agent.handle real).
async function think(channel, task) {
  const prov = getProvider();
  if (!prov) return '';
  const a = new Agent({ chat: (h, s, cb) => prov.chat(h, s, cb) });
  let out = '';
  await a.handle(task, ev => {
    if (running === 'interrupt') throw new Error('interrumpido');
    if (ev.type === 'token') { out += ev.text; emit(channel, { type: 'token', text: ev.text }); }
    else if (ev.type === 'tool') emit(channel, { type: 'tool', text: humanizeTool(ev.call.tool, ev.call.args), tool: ev.call.tool, path: ev.call.args?.path || null });
    else if (ev.type === 'tool_result') emit(channel, { type: 'tool_result', tool: ev.tool, text: String(ev.result || '').replace(/\s+/g, ' ').trim().slice(0, 100) });
    else if (ev.type === 'text') { out = ev.text; }
  });
  return out;
}

async function runCycle() {
  running = true;
  cycleN++;
  emit('ceo', { type: 'cycle', n: cycleN, text: 'Nuevo ciclo: reviso el espacio de trabajo y reparto el trabajo…' });

  let tree = '';
  try { tree = await ws.tree({ depth: 2 }); } catch { /* sin workspace */ }
  emit('ceo', { type: 'survey', text: 'Panorama captado (' + tree.split('\n').length + ' entradas). Delegando…' });

  const brief = (d) => `MISIÓN del equipo (fijada por el usuario): ${getMission()}\n` +
    `Eres el jefe de ${d.name}. Dentro de esa misión, céntrate en: ${d.focus}. ` +
    `Explora lo mínimo con tus herramientas y propón UNA mejora CONCRETA y accionable, ` +
    `entendible por un humano. Sé breve. No modifiques nada existente: solo la propuesta.`;
  const proposals = await Promise.all(getProfiles().map(async d => {
    emit(d.id, { type: 'open', name: d.name, focus: d.focus });
    try { const p = await think(d.id, brief(d)); emit(d.id, { type: 'done', text: p }); return { dept: d.name, text: p }; }
    catch { emit(d.id, { type: 'done', text: '(interrumpido)' }); return null; }
  }));
  if (running === 'interrupt') { running = false; emit('ceo', { type: 'paused', text: 'Vuelves tú — dejo lo mío y te cedo el mando.' }); return; }

  const valid = proposals.filter(Boolean).filter(p => p.text && p.text.length > 8);
  const md = `# Propuestas de mejora — ciclo ${cycleN}\n\n**Misión:** ${getMission()}\n\n` +
    valid.map(p => `## ${p.dept}\n${p.text}\n`).join('\n') +
    `\n_— generado por el cerebro CEO de Elffuss mientras estabas ocioso._\n`;
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const topic = slug((valid[0]?.text || 'ciclo').split(/[.,;\n]/)[0]) || 'ciclo';
  const path = `${getSoulDir()}/${stamp}-${topic}.md`;
  try {
    await rotateSoul();
    await ws.write({ path, content: md });
    emit('ceo', { type: 'built', text: `Propuesta guardada en ${path}`, path, md, proposals: valid });
  } catch (e) {
    emit('ceo', { type: 'built', text: 'Propuesta lista (no pude escribir el fichero)', md, proposals: valid });
  }
  running = false;
}

// Rotación: si hay demasiados ficheros sueltos, los MÁS ANTIGUOS se consolidan
// (recopilan) en un único archivo.md y se borran — para no acabar con miles.
async function rotateSoul() {
  try {
    const soul = getSoulDir();
    const names = (await ws.list(soul)).filter(n => n.endsWith('.md') && n !== 'archivo.md');
    if (names.length < SOUL_CAP) return;
    names.sort(); // el nombre empieza por fecha → orden cronológico
    const excess = names.slice(0, names.length - SOUL_CAP + 1);
    let archive = ''; try { archive = await ws.read({ path: `${soul}/archivo.md` }); } catch { archive = '# Archivo histórico del cerebro\n'; }
    for (const name of excess) {
      try { archive += `\n---\n## ${name}\n${await ws.read({ path: `${soul}/${name}` })}\n`; } catch { /* */ }
    }
    await ws.write({ path: `${soul}/archivo.md`, content: archive.slice(-80000) });
    for (const name of excess) { try { await ws.remove(soul, name); } catch { /* */ } }
    emit('ceo', { type: 'reprogram', text: `Consolidé ${excess.length} propuestas antiguas en archivo.md` });
  } catch { /* soulDir aún sin crear o sin permiso: nada que rotar */ }
}

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
// Lo que el cerebro le cuenta al usuario (la Mente, su historial). ceo.js lo
// comparten Claw y Code, cada una con su i18n: la app pasa su traductor con
// usarTraductor(t) (t(clave, vars) → texto, o la propia clave si no la tiene).
// Sin traductor, o sin la clave, va en español, como hasta ahora. (Lo que se le
// pide al MODELO —el encargo de cada perfil, la propuesta— no pasa por aquí.)
const ES = {
  ceoProfilesUpdated: 'Perfiles actualizados: {names}', ceoNewMission: 'Nueva misión recibida: {mission}',
  ceoNewSoulDir: 'Nueva carpeta-alma: {dir}/', ceoOn: 'CEO en guardia — trabajaré cuando estés ocioso', ceoOff: 'CEO en pausa',
  ceoOtherTab: 'Otra pestaña lleva el cerebro — ábrela ahí para forzar un ciclo.',
  ceoNeedsWs: 'Necesito un espacio de trabajo abierto y un modelo cargado.',
  ceoCutPause: 'En pausa: corto el ciclo y no guardo nada.', ceoCutBack: 'Vuelves tú — dejo lo mío y te cedo el mando.',
  ceoNewCycle: 'Nuevo ciclo: reviso el espacio de trabajo y reparto el trabajo…',
  ceoSurvey: 'Panorama captado ({n} entradas). Delegando…', ceoInterrupted: '(interrumpido)',
  ceoSaved: 'Propuesta guardada en {path}', ceoReadyNoFile: 'Propuesta lista (no pude escribir el fichero)',
  ceoArchived: 'Consolidé {n} propuestas antiguas en archivo.md',
};
let traductor = null;
export function usarTraductor(fn) { traductor = typeof fn === 'function' ? fn : null; }
function tx(clave, vars) {
  let s = null;
  try { s = traductor?.(clave, vars); } catch { /* traductor roto: español */ }
  if (typeof s === 'string' && s && s !== clave) return s;
  const base = ES[clave] ?? clave;
  return vars ? base.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : base;
}
let isBusy = () => false;     // ¿el usuario tiene trabajo en cola/procesándose? → prioridad
let defaultProfiles = GENERIC_PROFILES;
// Qué herramientas puede usar el cerebro: (nombre) => bool, o null = todas. El
// cerebro trabaja SOLO mientras no miras y promete no cambiar nada; la app
// anfitriona le pasa una lista de solo lectura para que esa promesa no dependa
// de que el modelo obedezca (Claw: ver kernel.js). Sin la opción, todo como antes.
let allowTool = null;
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
  emit('ceo', { type: 'reprogram', text: tx('ceoProfilesUpdated', { names: profiles.map(p => p.name).join(', ') }), profiles });
  return profiles;
}

let enabled = false, running = false, lastActivity = Date.now(), timer = null, lastCycleEnd = 0, cycleN = 0;
// Una parada por ciclo: pausar o volver a usar la app la aborta, y la señal
// llega hasta el proveedor (corta la generación) y hasta las herramientas.
let cycleAborter = null;
// Cada pausa o actividad del usuario cambia la «época». tick() y forceCycle()
// esperan a isReady() antes de arrancar, y en Claw esa espera es asíncrona
// (consulta IndexedDB): si la época cambió mientras esperaban, el usuario pausó
// o volvió y el ciclo NO arranca. Antes solo se miraba `running`, que en ese
// hueco aún es false, así que interrupt() no hacía nada y el ciclo arrancaba
// igual y escribía su propuesta justo después de pausar.
let epoca = 0;
// Quién cortó: 'actividad' (el usuario volvió) o 'pausa' (lo pausó a propósito
// desde la Mente). Cuenta el primero que corta el ciclo; con eso se elige qué
// se le dice (antes las dos decían «Vuelves tú…»).
let motivoCorte = 'actividad';
// Interrumpir el ciclo en curso. `running` NO se pone a false aquí: lo hace el
// propio ciclo al terminar de verdad. Mientras tanto vale 'interrupt' y
// forceCycle()/tick() no arrancan un segundo ciclo encima del que aún se está
// desmontando — dos ciclos a la vez son dos generate() contra el mismo modelo.
function interrupt(motivo = 'actividad') {
  epoca++;
  if (running !== 'interrupt') motivoCorte = motivo;
  if (!running) return;
  running = 'interrupt';
  try { cycleAborter?.abort(); } catch { /* */ }
}

// MISIÓN reprogramable: el usuario puede reorientar el cerebro desde la Mente
// («céntrate en seguridad», «optimiza mis Excel», «documenta todo»…).
let DEFAULT_MISSION = 'Revisar el espacio de trabajo y proponer mejoras concretas y accionables.';
let mission = null;
function ensureMission() { if (mission == null) { try { mission = localStorage.getItem(K('ceoMission')) || DEFAULT_MISSION; } catch { mission = DEFAULT_MISSION; } } }
export function getMission() { ensureMission(); return mission; }
export function setMission(text) {
  mission = (text || '').trim() || DEFAULT_MISSION;
  try { localStorage.setItem(K('ceoMission'), mission); } catch { /* */ }
  emit('ceo', { type: 'reprogram', text: tx('ceoNewMission', { mission }) });
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
  emit('ceo', { type: 'reprogram', text: tx('ceoNewSoulDir', { dir: soulDir }) });
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

// init({ workspace, provider, onEvent, isBusy, namespace, defaultProfiles, defaultMission, defaultSoulDir, allowTool })
export function init(opts = {}) {
  if (opts.workspace) ws = opts.workspace;
  if (opts.provider) getProvider = opts.provider;
  if (opts.onEvent) realEmit = opts.onEvent;
  if (opts.isBusy) isBusy = opts.isBusy;
  if (opts.namespace) NS = opts.namespace;
  if (opts.defaultProfiles) defaultProfiles = opts.defaultProfiles;
  if (opts.defaultMission) DEFAULT_MISSION = opts.defaultMission;
  if (opts.defaultSoulDir) DEFAULT_SOUL = opts.defaultSoulDir;
  if (opts.allowTool) allowTool = opts.allowTool;
  initCrossTab();
}
export function isThisTabLeader() { return isLeader; }
export function noteActivity() { lastActivity = Date.now(); interrupt('actividad'); }
export function isEnabled() { return enabled; }
export function isRunning() { return !!running; }
// Play/stop: persistido AQUÍ (fuente única) — cualquier botón que lo toque
// queda sincronizado, y la elección sobrevive a recargar la página.
//
// En una clave NUEVA, «ceoDecision» ('on' | 'off'). La anterior, «ceoEnabled»,
// la escribía también el primer clic en 🧠, que encendía el cerebro sin pedirlo,
// y no distingue un ▶ de verdad de aquel encendido implícito: con ella, quien
// pasó una vez por la Mente tenía el cerebro autónomo encendido en cada visita.
// Ya no se lee —cuenta como «sin decidir»: apagado, y el botón dice «activar»—
// y se borra la primera vez que se mira.
const CLAVE_DECISION = () => K('ceoDecision');
function decision() {
  try {
    if (localStorage.getItem(K('ceoEnabled')) != null) localStorage.removeItem(K('ceoEnabled'));
    return localStorage.getItem(CLAVE_DECISION());
  } catch { return null; }
}
export function wasEnabledLastSession() { return decision() === 'on'; }
// ¿el usuario llegó a decidir alguna vez (play o stop)? Distingue «nunca lo
// tocó» de «lo pausó a propósito» — solo lo primero debe auto-activarse al
// abrir la Mente; lo segundo hay que RESPETARLO, no pisarlo.
export function hasDecided() { return decision() != null; }
export function enable() {
  if (enabled) return;
  enabled = true; lastActivity = Date.now(); schedule();
  try { localStorage.setItem(CLAVE_DECISION(), 'on'); } catch { /* */ }
  emit('sys', { type: 'status', text: tx('ceoOn') });
}
export function disable() {
  // Antes ponía running = false sin más: el ciclo seguía generando por detrás,
  // escribía su propuesta igual, y «Pensar ahora» podía lanzar otro a la vez.
  enabled = false; interrupt('pausa'); if (timer) clearTimeout(timer);
  try { localStorage.setItem(CLAVE_DECISION(), 'off'); } catch { /* */ }
  emit('sys', { type: 'status', text: tx('ceoOff') });
}

function schedule() { if (timer) clearTimeout(timer); timer = setTimeout(tick, TICK_MS); }

// ¿Puede pensar AHORA? Para que la UI lo diga antes de prometer un ciclo:
// devuelve '' si sí, o el motivo ('leader' | 'running' | 'workspace' |
// 'provider'). Sin modelo de verdad (el anfitrión devuelve null en modo
// básico) no hay ciclo: con el motor de reglas solo salían propuestas basura
// escritas dentro del proyecto.
export async function whyNotThink() {
  if (!isLeader) return 'leader';
  if (running) return 'running';
  if (!(await ws?.isReady())) return 'workspace';
  if (!getProvider()) return 'provider';
  return '';
}

// «Pensar ahora» — salta la espera de ociosidad. Sigue respetando el
// semáforo: si otra pestaña es la líder, no compite por la GPU.
export async function forceCycle() {
  if (!isLeader) { emit('ceo', { type: 'paused', text: tx('ceoOtherTab') }); return false; }
  if (running) return false;
  const e = epoca;
  // isReady() puede ser síncrona (Code: handle en memoria) o async (Claw: consulta IndexedDB) — se espera siempre.
  if (!(await ws?.isReady()) || !getProvider()) { emit('ceo', { type: 'paused', text: tx('ceoNeedsWs') }); return false; }
  if (running) return false;   // otro ciclo arrancó mientras se esperaba a isReady()
  if (e !== epoca) { emit('ceo', { type: 'paused', text: textoCorte() }); return false; }
  try { await runCycle(); } finally { lastCycleEnd = Date.now(); }
  return true;
}

async function tick() {
  if (!enabled) return;
  const idle = Date.now() - lastActivity;
  const rested = Date.now() - lastCycleEnd > COOLDOWN_MS;
  const mightRun = isLeader && !running && !isBusy() && idle >= IDLE_MS && rested && getProvider();
  if (mightRun) {
    const e = epoca;
    // Tras la espera se vuelve a mirar todo lo que pudo cambiar en ella.
    if (await ws?.isReady() && e === epoca && enabled && !running && !isBusy()) {
      try { await runCycle(); } catch { /* siguiente ciclo */ }
      lastCycleEnd = Date.now();
    }
  }
  schedule();
}

// helper: corre el agente con el proveedor actual sobre un prompt, emitiendo
// tokens/herramientas a un canal. Devuelve el texto final. Las tool-calls pasan
// SIEMPRE por el mismo runTool que usa el chat normal (Agent.handle real).
// `signal` es la parada del ciclo: llega al proveedor como 4º argumento de
// chat() (antes este envoltorio lo tiraba, y el proveedor nunca se enteraba de
// que había que parar) y además para el agente.
async function think(channel, task, signal = null) {
  const prov = getProvider();
  if (!prov) return '';
  if (signal?.aborted) throw new Error('interrumpido');
  const a = new Agent({ chat: (h, s, cb, sig) => prov.chat(h, s, cb, sig) });
  // Un agente sin stop() no se entera de la señal (el de Claw antes de su
  // stop-fix: handle(texto, onEvent)). Con él la única forma de cortarlo es
  // lanzar desde su callback, como hacía antes el core; si no, cada perfil
  // seguía llamando al modelo y ejecutando herramientas hasta el final aunque
  // el usuario hubiera vuelto. Con stop() se ignora sin lanzar (ver abajo).
  const sinParada = typeof a.stop !== 'function';
  const stop = () => { try { a.stop?.(); } catch { /* */ } };
  signal?.addEventListener('abort', stop, { once: true });
  let out = '';
  try {
    await a.handle(task, ev => {
      // Parado: se ignora lo que llegue, sin lanzar. Lanzar desde aquí metía una
      // excepción en mitad del agente (y de su proveedor), y un agente que no
      // distingue la parada la reportaba a telemetría como fallo del modelo.
      if (running === 'interrupt' || signal?.aborted) {
        if (sinParada) throw new Error('interrumpido');
        return;
      }
      if (ev.type === 'token') { out += ev.text; emit(channel, { type: 'token', text: ev.text }); }
      else if (ev.type === 'tool') emit(channel, { type: 'tool', text: humanizeTool(ev.call.tool, ev.call.args), tool: ev.call.tool, path: ev.call.args?.path || null });
      else if (ev.type === 'tool_result') emit(channel, { type: 'tool_result', tool: ev.tool, text: String(ev.result || '').replace(/\s+/g, ' ').trim().slice(0, 100) });
      else if (ev.type === 'text') { out = ev.text; }
    }, { signal, permitir: allowTool });
  } finally { signal?.removeEventListener('abort', stop); }
  if (signal?.aborted) throw new Error('interrumpido');
  return out;
}

// Lo que se dice al cortar un ciclo, según quién lo cortó (ver motivoCorte).
const textoCorte = () => tx(motivoCorte === 'pausa' ? 'ceoCutPause' : 'ceoCutBack');

async function runCycle() {
  running = true;
  const aborter = (cycleAborter = new AbortController());
  try { await cycle(aborter.signal); }
  finally {
    // Solo aquí: hasta que el ciclo ha terminado de verdad, sigue «en marcha».
    running = false;
    if (cycleAborter === aborter) cycleAborter = null;
  }
}

async function cycle(signal) {
  cycleN++;
  emit('ceo', { type: 'cycle', n: cycleN, text: tx('ceoNewCycle') });

  let tree = '';
  try { tree = await ws.tree({ depth: 2 }); } catch { /* sin workspace */ }
  emit('ceo', { type: 'survey', text: tx('ceoSurvey', { n: tree.split('\n').length }) });

  const brief = (d) => `MISIÓN del equipo (fijada por el usuario): ${getMission()}\n` +
    `Eres el jefe de ${d.name}. Dentro de esa misión, céntrate en: ${d.focus}. ` +
    `Explora lo mínimo con tus herramientas y propón UNA mejora CONCRETA y accionable, ` +
    `entendible por un humano. Sé breve. No modifiques nada existente: solo la propuesta.`;
  const proposals = await Promise.all(getProfiles().map(async d => {
    emit(d.id, { type: 'open', name: d.name, focus: d.focus });
    try { const p = await think(d.id, brief(d), signal); emit(d.id, { type: 'done', text: p }); return { dept: d.name, text: p }; }
    catch { emit(d.id, { type: 'done', text: tx('ceoInterrupted') }); return null; }
  }));
  // Interrumpido: NO se escribe nada. Ni propuesta a medias ni fichero vacío.
  if (running === 'interrupt' || signal.aborted) { emit('ceo', { type: 'paused', text: textoCorte() }); return; }

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
    if (signal.aborted) { emit('ceo', { type: 'paused', text: textoCorte() }); return; }
    await ws.write({ path, content: md });
    emit('ceo', { type: 'built', text: tx('ceoSaved', { path }), path, md, proposals: valid });
  } catch (e) {
    emit('ceo', { type: 'built', text: tx('ceoReadyNoFile'), md, proposals: valid });
  }
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
    emit('ceo', { type: 'reprogram', text: tx('ceoArchived', { n: excess.length }) });
  } catch { /* soulDir aún sin crear o sin permiso: nada que rotar */ }
}

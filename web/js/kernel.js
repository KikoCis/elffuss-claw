// Núcleo: arranca UI, agente, planificador y el proveedor de modelo activo.
import { Agent, parseToolCall } from './agent.js';
import * as ui from './ui.js';
import * as rules from './providers/rules.js';
import * as db from './db.js';
import * as settings from './settings.js';
import * as skills from './skills.js';
import { applyI18n, t } from './i18n.js';
import { ensureModelCache } from './model-cache.js';
import { tasks, watch, fs, apps } from './tools/index.js';
import { hardWork, gatherFolder, deepCreate } from './rlm.js';
import * as workspace from './workspace.js';
import * as ceo from './ceo.js';
import * as mind from './mind.js';
import { ceoWorkspace, CEO_DEFAULT_PROFILES } from './ceo-adapter.js';
import * as telemetry from './telemetry.js';

applyI18n(); // traduce el chrome al idioma del navegador antes de nada
telemetry.init('elffuss-claw'); // opt-in, apagado por defecto — ver Ajustes

// Proveedores LOCALES (corren en TU navegador). Los externos (OpenAI,
// Anthropic, Ollama, servidor) son configuración avanzada y se resuelven
// aparte, bajo el id `ext:<nombre>`.
const localProviders = {
  onnx: () => import('./providers/onnx.js'),
  litert: () => import('./providers/litert.js'),
};

// Devuelve el módulo del proveedor ya configurado, o null si es 'rules'.
async function resolveProvider(id) {
  if (id === 'rules') return null;
  if (localProviders[id]) return localProviders[id]();
  if (id.startsWith('litert:')) {           // Gemma vía LiteRT-LM (build elegido)
    const mod = await import('./providers/litert.js');
    mod.configure(id.slice(7));
    return mod;
  }
  if (id.startsWith('onnx:')) {             // ONNX concreto (Elffuss LM, Qwen3…)
    const mod = await import('./providers/onnx.js');
    mod.configure(id.slice(5));
    return mod;
  }
  if (id.startsWith('ext:')) {
    const cfg = settings.get(id.slice(4));
    if (!cfg) throw new Error('proveedor externo desconocido');
    const mod = await import('./providers/api.js');
    mod.configure(cfg);
    return mod;
  }
  throw new Error('proveedor desconocido: ' + id);
}

// El Elffuss E4B HEALED no carga aún en navegador (export prefill_decode, E-010):
// se oculta hasta el reexport artisan. Los Gemma E2B/E4B OFICIALES (build -web
// de Google) SÍ cargan y se ofrecen como elegibles (no default: se bajan GB solo
// si el usuario los elige). Poner true cuando el healed sea artisan.
const ELFFUSS_LITERT_READY = false;

// navigator.gpu puede EXISTIR como API sin que haya un adaptador real (ciertos
// Linux/drivers, entornos sandboxed/headless…) — comprobarlo UNA vez al
// arrancar evita ofrecer/elegir Gemma (2-4 GB) cuando de todos modos va a
// fallar al crear el motor (onnx.js y litert.js ya comprueban el adaptador
// por su cuenta como defensa adicional, pero esto evita hasta OFRECERLO).
let realGPU = !!navigator.gpu;
const realGPUCheck = (async () => {
  if (!navigator.gpu) return (realGPU = false);
  try { return (realGPU = !!(await navigator.gpu.requestAdapter())); }
  catch { return (realGPU = false); }
})();

// Opciones del selector: locales siempre; externos solo si están activados.
function modelOptions() {
  const local = [];
  if (realGPU) local.push({ id: 'litert:gemma-e4b', label: 'Gemma-4 E4B · LiteRT-LM (~2.8 GB) ★ — por defecto' });
  if (realGPU) local.push({ id: 'litert:gemma-e2b', label: 'Gemma-4 E2B · LiteRT-LM (~2 GB)' });
  local.push({ id: 'onnx', label: 'Elffuss LM (healed · 850 MB) — ligero' });
  local.push({ id: 'onnx:qwen3-0.6b', label: 'Qwen3-0.6B · WebGPU (~560 MB)' });
  if (realGPU && ELFFUSS_LITERT_READY) local.push({ id: 'litert:elffuss-e4b', label: 'Local · Elffuss E4B (healed) ★' });
  local.push({ id: 'rules', label: 'Básico (sin modelo)' });
  return [...local, ...settings.enabledExternals()];
}

const isLocal = id => id === 'onnx' || id === 'litert' || id.startsWith('litert:') || id.startsWith('onnx:');
// Por defecto: Gemma-4 grande vía LiteRT-LM (build oficial -web, VERIFICADO que
// carga y hace tool-calls). E4B en escritorio, E2B en móvil/GPU débil. Si no
// cabe, cae al Elffuss LM healed (onnx, 850 MB) — cerebro seguro siempre.
const isMobile = () => matchMedia('(max-width: 820px)').matches || matchMedia('(pointer: coarse)').matches;
async function gpuCapacity() {
  const mem = navigator.deviceMemory || 8;
  if (!navigator.gpu) return { gpu: false, maxBuf: 0, mem };
  try { const a = await navigator.gpu.requestAdapter();
    return a ? { gpu: true, maxBuf: a.limits?.maxBufferSize || 0, mem } : { gpu: false, maxBuf: 0, mem };
  } catch { return { gpu: false, maxBuf: 0, mem }; }
}
async function pickLocalBrain() {
  const c = await gpuCapacity();
  if (c.gpu && !isMobile()) {
    if (c.maxBuf >= 2 ** 31 && c.mem >= 8) return 'litert:gemma-e4b';
    if (c.maxBuf >= 2 ** 30 && c.mem >= 6) return 'litert:gemma-e2b';
  }
  if (c.gpu && isMobile()) return 'litert:gemma-e2b';
  return 'onnx';
}
const defaultBrain = () => !realGPU ? 'onnx' : (isMobile() ? 'litert:gemma-e2b' : 'litert:gemma-e4b');

const agent = new Agent(rules);
let busy = false;
let hardMode = false;   // Hard Work (RLM): la próxima petición se procesa por partes
let activeModel = 'rules';   // qué proveedor está cargado (para el vigilante de RAM)
let activeMod = null;

// ---- cola de mensajes ----
// Los mensajes se apilan y se procesan en orden. La cola persiste en
// IndexedDB: un refresco a media respuesta NO pierde lo pendiente (el mensaje
// en vuelo solo sale de la cola cuando su turno TERMINA; el histórico también
// se guarda al terminar, así que reprocesarlo tras un refresco no duplica).
const queue = [];
let pumping = false;
let bootReady;
const bootPromise = new Promise(r => { bootReady = r; });

const persistQueue = () =>
  db.set('kv', 'queue', queue.map(q => q.text)).catch(() => {});

function send(text) {
  const el = ui.addMsg('user queued', text);
  queue.push({ text, el });
  persistQueue();
  if (queue.length > 1) ui.toast(`En cola (${queue.length - 1} por delante) — no se pierde ni refrescando.`);
  pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  await bootPromise; // no procesar hasta que el cerebro inicial esté resuelto
  while (queue.length) {
    const item = queue[0];
    item.el?.classList.remove('queued');
    await process(item.text);
    // Orden anti-pérdida: el histórico ya está COMMITEADO dentro de process()
    // (incluye este turno como lastDone). Solo entonces sacamos de la cola.
    // Si el refresco cae entre ambos commits, el mensaje aparece en histórico
    // Y en cola → restoreQueue lo deduplica; nunca se pierde.
    queue.shift();
    await persistQueue();
  }
  pumping = false;
}

async function process(text) {
  if (hardMode) return processHardWork(text);
  busy = true;
  const thinking = ui.thinkingBubble();
  try {
    await agent.handle(text, ev => {
      if (ev.type === 'token') thinking.tick(ev.text);
      if (ev.type === 'text') { ui.addMsg('assistant', ev.text); if (window.__copilotOpener) { try { window.__copilotEmit(ev.text); } catch { /* */ } } }
      if (ev.type === 'tool') { thinking.tool(ev.call.tool); ui.addTool(ev.call); }
      if (ev.type === 'tool_result') ui.addToolResult(ev.tool, ev.result);
      if (ev.type === 'error') ui.addMsg('assistant err', ev.text);
    });
  } finally {
    thinking.remove();
    busy = false;
    // Histórico persistente COMMITEADO (await) antes de vaciar la cola: al
    // refrescar, la conversación sigue ahí y ningún mensaje se pierde.
    await db.set('kv', 'history', agent.history.slice(-80)).catch(() => {});
    await db.set('kv', 'lastDone', text).catch(() => {});
    workspace.touch('history');
  }
}

// Hard Work (RLM): trabaja la carpeta autorizada ENTERA por partes. El modelo
// no ve todo de golpe — se trocea, se pregunta a cada parte y se funde. Tarda,
// pero abarca material que no cabe en la ventana del modelo.
async function processHardWork(question) {
  busy = true;
  const thinking = ui.thinkingBubble();
  const fail = msg => { thinking.remove(); ui.addMsg('assistant', msg); busy = false; };
  try {
    if (activeModel === 'rules') return fail('Hard Work necesita un cerebro cargado: elige un modelo local o remoto en el selector de arriba y vuelve a intentarlo.');
    const names = await fs.folders().catch(() => []);
    if (!names.length) {
      // Sin carpeta que leer → modo CREACIÓN: el modelo hace un borrador, se
      // autocritica y se reescribe. Misma petición, dos pasadas → mejor app.
      const res = await deepCreate({
        brief: question, provider: agent.provider, rounds: 1,
        onProgress: p => thinking.tool(
          p.phase === 'draft' ? 'Hard Work · borrador…'
            : p.phase === 'critique' ? `Hard Work · autocrítica ${p.round}`
            : p.phase === 'rewrite' ? `Hard Work · reescribiendo ${p.round}`
            : 'Hard Work · listo'),
      });
      thinking.remove();
      const name = (question.trim().slice(0, 24) || 'app');
      try { await apps.create({ name, html: res.html }); } catch { /* si falla, al menos responde */ }
      ui.addMsg('assistant', `Listo. Lo trabajé en dos pasadas — borrador → autocrítica → reescritura — y lo dejé en el visualizador.\n\n_⛏ Hard Work (creación): ${res.trace.length - 1} ronda de mejora._`);
      agent.history.push({ role: 'user', content: question, ts: Date.now() });
      agent.history.push({ role: 'assistant', content: '(app creada con Hard Work)', ts: Date.now() });
      return; // el finally resetea busy y guarda el histórico
    }
    thinking.tool('Hard Work · abriendo carpeta…');
    const root = await fs.root();
    const context = await gatherFolder(root, { maxBytes: 1.5e6 });
    if (!context.trim()) return fail('Esa carpeta no tiene archivos de texto que pueda leer. Autoriza otra con documentos/código y reintenta.');
    const res = await hardWork({
      question, context, provider: agent.provider,
      onProgress: p => {
        if (p.phase === 'plan') thinking.tool(`Hard Work · ${p.chunks} partes (${Math.round(p.chars / 1000)}k)${p.truncated ? ' — recorté al máximo' : ''}`);
        else if (p.phase === 'map') thinking.tool(`Hard Work · leyendo ${p.i}/${p.n}`);
        else if (p.phase === 'reduce-group') thinking.tool(`Hard Work · fundiendo grupo ${p.g}/${p.n}`);
        else if (p.phase === 'reduce') thinking.tool('Hard Work · sintetizando…');
      },
    });
    thinking.remove();
    ui.addMsg('assistant', res.answer + `\n\n_⛏ Hard Work (RLM): leí ${names[0]} en ${res.chunks} partes, ${res.kept} con señal.${res.truncated ? ' Material recortado al máximo — acota la carpeta para abarcarlo entero.' : ''}_`);
    agent.history.push({ role: 'user', content: question, ts: Date.now() });
    agent.history.push({ role: 'assistant', content: res.answer, ts: Date.now() });
  } catch (e) {
    thinking.remove();
    ui.addMsg('assistant err', 'Hard Work falló: ' + (e?.message || String(e)));
  } finally {
    busy = false;
    await db.set('kv', 'history', agent.history.slice(-80)).catch(() => {});
    await db.set('kv', 'lastDone', question).catch(() => {});
  }
}

// Recuperar mensajes que quedaron en cola antes de un refresco. Deduplica el
// posible solapamiento con el último turno ya completado (ver pump()).
async function restoreQueue() {
  let pending = await db.get('kv', 'queue').catch(() => null);
  if (!pending?.length) return;
  const lastDone = await db.get('kv', 'lastDone').catch(() => null);
  if (lastDone && pending[0] === lastDone) pending = pending.slice(1); // ya se procesó
  if (!pending.length) { db.set('kv', 'queue', []).catch(() => {}); return; }
  for (const text of pending) {
    const el = ui.addMsg('user queued', text);
    queue.push({ text, el });
  }
  ui.toast(`${pending.length} mensaje(s) pendientes recuperados — los proceso en cuanto cargue el cerebro.`);
  pump();
}

// Reconstruir la conversación guardada (burbujas + memoria del agente).
async function restoreHistory() {
  const saved = await db.get('kv', 'history').catch(() => null);
  if (!saved?.length) return;
  agent.history = saved;
  for (const m of saved) {
    if (m.role === 'user') {
      if (m.content.startsWith('[resultado ')) {
        const nl = m.content.indexOf('\n');
        ui.addToolResult(m.content.slice(11, nl > 0 ? nl - 1 : undefined), nl > 0 ? m.content.slice(nl + 1) : '');
      } else if (!m.content.startsWith('[…')) {
        ui.addMsg('user', m.content);
      }
    } else {
      const call = parseToolCall(m.content);
      if (call) ui.addTool(call);
      else ui.addMsg('assistant', m.content);
    }
  }
  ui.toast('Conversación restaurada (para empezar de cero)');
}

document.getElementById('btn-clear').addEventListener('click', async () => {
  await db.del('kv', 'history').catch(() => {});
  await db.del('kv', 'queue').catch(() => {});
  agent.history = [];
  location.reload();
});

async function changeModel(id) {
  if (id === 'rules') { // modo básico
    agent.setProvider(rules);
    activeModel = 'rules';
    activeMod = null;
    ui.modelStatus('off');
    localStorage.setItem('elffuss.model', 'rules');
    ui.setModel('rules');
    ui.toast('Modo básico: sin modelo, órdenes directas.');
    return true;
  }
  ui.modelStatus('loading');
  try {
    const mod = await resolveProvider(id);
    ui.modelProgress('Preparando modelo…');
    await mod.load(p => ui.modelProgress(p));
    ui.modelProgress(null);
    agent.setProvider(mod);
    activeModel = id;
    activeMod = mod;
    localStorage.setItem('elffuss.model', id);
    ui.setModel(id);
    const where = isLocal(id) ? (realGPU ? t('whereGpu') : t('whereCpu')) : t('whereExt');
    ui.modelStatus(isLocal(id) && realGPU ? 'gpu' : 'on');
    ui.toast(t('modelReady', { where }));
    if (window.__copilotOpener) copilotPostState('Listo. Habla con el cliente y te voy soplando.');
    return true;
  } catch (e) {
    ui.modelProgress(null);
    console.error('[elffuss] fallo cargando modelo', e);
    // Si un Gemma (LiteRT) no cabe/ falla, cae a LFM2.5 en vez de dejar sin cerebro.
    if (id.startsWith('litert') && !_fellBack) {
      _fellBack = true;
      sessionStorage.setItem('elffuss.skipGemma', '1'); // no reintentar el pesado esta sesión
      ui.toast('Ese Gemma no cargó aquí (memoria/GPU) — uso LFM2.5 (ligero).');
      const ok = await changeModel('onnx');
      _fellBack = false;
      if (ok) return true;
    }
    ui.modelStatus('off');
    agent.setProvider(rules);
    activeModel = 'rules';
    ui.setModel('rules');
    ui.toast('⚠️ No se pudo cargar ' + id + ': ' + (e?.message || String(e)));
    return false;
  }
}
let _fellBack = false;

// Rehacer el selector (locales + externos activados) tras tocar la config.
function refreshModelOptions() {
  ui.rebuildModelSelect(modelOptions(), activeModel);
}

// Splash de primera visita: galaxia WebGL + promesa de privacidad + guiño.
const splash = document.getElementById('splash');
if (!localStorage.getItem('elffuss.welcomed')) {
  splash.hidden = false;
  let galaxy = null;
  import('./splash-gl.js')
    .then(m => { galaxy = m.startGalaxy(splash); })
    .catch(() => {}); // sin WebGL queda el gradiente CSS
  document.getElementById('splash-enter').addEventListener('click', () => {
    localStorage.setItem('elffuss.welcomed', '1');
    galaxy?.burst(); // las estrellas salen despedidas al entrar
    splash.style.opacity = '0';
    setTimeout(() => { splash.hidden = true; galaxy?.stop(); }, 800);
  });
}

skills.initSkills();
ui.init({ onSend: send, onModelChange: changeModel, onSettingsChanged: refreshModelOptions });
// Botón «liberar el modelo» del panel de consumo: suelta la RAM sin recargar.
ui.setOnFreeModel(async () => {
  const mod = activeMod;
  agent.setProvider(rules); activeModel = 'rules'; activeMod = null;
  ui.setModel('rules'); ui.modelStatus('off');
  try { await mod?.unload?.(); } catch { /* mejor esfuerzo */ }
});
refreshModelOptions();
restoreHistory().then(restoreQueue);

// ── Cerebro CEO autónomo + Mente de Elffuss ───────────────────────────────
// Cuando NO le pides nada, Elffuss trabaja por su cuenta: revisa tus carpetas
// autorizadas, tareas, apps y memoria, y propone mejoras (sin tocar nada por
// su cuenta — la propuesta se ejecuta con el mismo camino real que el chat).
// «Abrir en el editor» de un pensamiento no aplica aquí (no hay editor de
// código) — en su lugar, pide en el chat el contenido de ese fichero.
mind.setOpenFile(path => send('Muéstrame el contenido de ' + path));
mind.setExecuteProposal(md => { mind.closeMind(); send('Implementa esta propuesta de mejora usando las herramientas disponibles:\n\n' + md); });
mind.init({}); // sin ciudad de fondo (Claw v1): la Mente funciona igual sin ella
const WEAK_RE = /^(no (encontr|hay|se me ocurre)|nada que|sin cambios|todo (está|esta) bien|no aplica)/i;
function isNoteworthy(ev) {
  const solid = (ev.proposals || []).filter(p => p.text && p.text.trim().length >= 60 && !WEAK_RE.test(p.text.trim()));
  return solid.length >= 2; // al menos 2 líneas de pensamiento con algo sustancioso
}
function executeProposal(md) { send('Implementa esta propuesta de mejora usando las herramientas disponibles:\n\n' + md); }
// SOLO notifica si el permiso YA está concedido — nunca lo pide aquí (fuera
// de un gesto de usuario los navegadores lo bloquean en silencio de todos
// modos); pedirlo vive únicamente en el clic del botón 🧠.
function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, icon: 'img/elffuss.svg' }); } catch { /* */ }
}
function reportImprovements(ev) {
  const props = ev.proposals || [];
  if (!props.length) return;
  const firstLine = t => (t || '').split('\n').find(l => l.trim())?.trim().slice(0, 160) || '';
  const body = `💡 **Mientras estabas fuera revisé tu espacio y encontré ${props.length} mejora${props.length === 1 ? '' : 's'}:**\n\n` +
    props.map(p => `**${p.dept}** — ${firstLine(p.text)}`).join('\n\n') +
    (ev.path ? `\n\n_Guardado en \`${ev.path}\`. Pulsa 🧠 para verlo en la Mente._` : '');
  const div = ui.addMsg('assistant', body);
  const md = ev.md || body;
  if (div) {
    const btn = document.createElement('button');
    btn.className = 'proposal-exec-btn';
    btn.textContent = '▶ Ejecutar esta propuesta';
    btn.onclick = () => { btn.disabled = true; btn.textContent = '▶ enviado a la cola…'; executeProposal(md); };
    div.appendChild(btn);
  }
  if (isNoteworthy(ev)) notify(`Elffuss encontró ${props.length} mejora${props.length === 1 ? '' : 's'}`, props.map(p => p.dept).join(' · '));
}
ceo.init({
  namespace: 'elffuss',
  workspace: ceoWorkspace,
  defaultProfiles: CEO_DEFAULT_PROFILES,
  defaultMission: 'Revisar tu espacio (carpetas, apps, tareas, memoria) y proponer mejoras concretas y accionables.',
  provider: () => agent.provider,
  // el usuario tiene PRIORIDAD: si hay algo en cola o procesándose, el cerebro espera
  isBusy: () => pumping || queue.length > 0,
  onEvent: (ch, ev) => {
    mind.pushThought(ch, ev);
    if (ch === 'ceo' && ev.type === 'built') reportImprovements(ev);
  },
});
// cualquier interacción FUERA de la Mente cuenta como actividad → pausa el CEO
const noteAct = e => { if (!e.target.closest?.('#mind-overlay')) ceo.noteActivity(); };
document.addEventListener('pointerdown', noteAct, true);
document.addEventListener('keydown', noteAct, true);
document.getElementById('btn-mind').addEventListener('click', () => {
  // auto-activa SOLO la primera vez (nunca decidiste play/stop); si lo
  // pausaste a propósito, abrir la Mente NO debe reactivarlo por sorpresa.
  if (!ceo.isEnabled() && !ceo.hasDecided()) ceo.enable();
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* */ }
  mind.openMind();
});
// restaura tu última elección (play o stop) tal cual la dejaste. EXCEPTO en
// modo copiloto: ahí el modelo es para soplarte argumentos en vivo, no para
// ponerse a inventar mejoras (y de paso robarle el visor al tablero).
const IS_COPILOT = /[?&]copilot=1/.test(location.search);
if (!IS_COPILOT && ceo.wasEnabledLastSession()) ceo.enable();

// Autocarga SOLO LOCAL. Por defecto Gemma-4 E4B (escritorio) o E2B (móvil/GPU
// débil), vía LiteRT-LM; si no cabe, cae a LFM2.5. Respeta lo último elegido.
(async () => {
  try {
    // Caché de modelos (persistente + service worker) ANTES de descargar nada,
    // para que hasta la primera descarga de pesos quede cacheada y no se repita.
    await ensureModelCache();
    await realGPUCheck; // que defaultBrain()/modelOptions() vean el adaptador real, no solo la API
    const saved = localStorage.getItem('elffuss.model');
    if (saved === 'rules') return; // elección explícita
    // En modo copiloto el translator YA está usando la máquina (Whisper +
    // diarización), así que si NUNCA has elegido cerebro se arranca con el
    // ligero para no competir. Pero tu elección manda: si escogiste Gemma,
    // se respeta — pisarla era un error.
    if (/[?&]copilot=1/.test(location.search) && !saved) {
      ui.toast('Copiloto: arranco con el cerebro ligero para no competir con el traductor. Elige Gemma arriba si prefieres precisión.');
      if (await changeModel('onnx')) return;
    }
    const available = new Set(modelOptions().map(o => o.id));
    // si un Gemma pesado ya falló esta sesión, no reintentar (evita re-crash)
    const skipGemma = sessionStorage.getItem('elffuss.skipGemma') === '1';
    const def = skipGemma ? 'onnx' : await pickLocalBrain();
    const chain = [...new Set([saved, def, realGPU ? 'onnx' : null]
      .filter(id => id && available.has(id)))];
    if (!chain.length) return;
    const first = chain[0];
    ui.toast(first.startsWith('litert')
      ? 'Cargando Gemma (varios GB la 1ª vez)… mientras, el modo básico te atiende.'
      : 'Cargando el cerebro local… mientras, el modo básico te atiende.');
    for (const id of chain)
      if (await changeModel(id)) return;
  } finally {
    bootReady(); // la cola puede empezar a procesar (con el cerebro que haya)
  }
})();

// Vigilante de RAM: si el heap del navegador va muy lleno (los modelos
// locales viven ahí), primero avisa y, si sigue subiendo, para y LIBERA el
// modelo automáticamente antes de que la pestaña se caiga. El modelo remoto
// no gasta RAM local, así que no se toca.
let ramWarned = false;
setInterval(async () => {
  const m = performance.memory;
  if (!m?.jsHeapSizeLimit) return; // solo Chrome
  const ratio = m.usedJSHeapSize / m.jsHeapSizeLimit;
  if (ratio < 0.7) { ramWarned = false; return; }
  if (ratio > 0.92 && isLocal(activeModel)) {
    const mod = activeMod;
    agent.setProvider(rules);
    activeModel = 'rules';
    activeMod = null;
    ui.setModel('rules');
    ui.modelStatus('off');
    try { await mod?.unload?.(); } catch { /* mejor esfuerzo */ }
    ui.addMsg('assistant',
      '⚠️ Ojo: tu ordenador está muy a full de memoria — puedes experimentar caídas ' +
      'o rendimiento lento si sigues usándolo. Por el momento me he parado y he ' +
      'liberado el modelo. Si quieres, me arrancas de nuevo desde el selector ' +
      'de arriba. ');
    ui.toast('⚠️ RAM muy llena: modelo local liberado automáticamente');
  } else if (ratio > 0.82 && !ramWarned) {
    ramWarned = true;
    ui.toast(`⚠️ La memoria del navegador va al ${Math.round(ratio * 100)}% — si sigue subiendo, liberaré el modelo yo sola.`);
  }
}, 15000);

// Las tareas vencidas se auto-envían como prompts al agente.
tasks.startScheduler(t => {
  ui.toast('Tarea programada: ' + t.prompt);
  send('[tarea programada] ' + t.prompt);
});

// Automatizaciones de carpetas: dejar un archivo en la de origen → Elffuss lo
// procesa y lo deja en la de destino, avisando por chat.
watch.startWatcher(msg => {
  ui.toast(msg);
  ui.addMsg('assistant', msg);
});

// ── Espacio de trabajo: qué se puede guardar en tu disco / ver / borrar ──
// El manifiesto es lo ÚNICO que Claw le cuenta al core sobre sus almacenes.
workspace.init({
  app: 'claw', ns: 'elffuss', db,
  stores: [
    { id: 'apps', label: 'Apps generadas', icon: '🎨', kind: 'idb-store', store: 'apps',
      files: { ext: '.html', name: a => a.name, body: a => a.html } },
    { id: 'skills', label: 'Skills', icon: '🧩', kind: 'idb-key', store: 'kv', key: 'skills',
      files: { ext: '.md', name: s => s.name, body: s => `---\nname: ${s.name}\ndescription: ${s.description || ''}\n---\n\n${s.content || ''}` } },
    { id: 'history', label: 'Conversación', icon: '💬', kind: 'idb-key', store: 'kv', key: 'history' },
    { id: 'memory', label: 'Memoria', icon: '🧠', kind: 'idb-store', store: 'memory' },
    { id: 'tasks', label: 'Tareas programadas', icon: '⏰', kind: 'idb-store', store: 'tasks' },
    { id: 'vault', label: 'Bóveda (cifrada)', icon: '🔐', kind: 'idb-store', store: 'vault', sensitive: true },
    { id: 'prefs', label: 'Preferencias', icon: '⚙️', kind: 'ls',
      keys: ['elffuss.model', 'elffuss.acer', 'elffuss.resumen', 'elffuss.semantic'] },
  ],
});
workspace.restore().catch(() => {});
if (workspace.autosaveEnabled()) workspace.autosave({ enabled: true });

window.elffuss = { agent, send, workspace }; // consola de depuración

// ── Hard Work (RLM): trabaja la carpeta autorizada entera por partes ──
const hwBtn = document.getElementById('btn-hardwork');
hwBtn?.addEventListener('click', () => {
  hardMode = !hardMode;
  hwBtn.classList.toggle('on', hardMode);
  const prompt = document.getElementById('prompt');
  if (hardMode) {
    prompt.placeholder = '⛏ Hard Work: crea algo, o pregunta sobre TODA tu carpeta…';
    ui.toast('Hard Work activado. Con carpeta autorizada: la leo entera por partes y respondo. Sin carpeta: creo lo que pidas en dos pasadas (borrador → autocrítica → mejora). Tarda más, sale mejor.');
  } else {
    prompt.placeholder = 'Pídeme lo que necesites…  (/ para comandos)';
    ui.toast('Hard Work desactivado: vuelvo al modo normal.');
  }
});

// ── Skills de audio en vivo + superficies (SSP v0.1) ────────────────────────
// Una skill de audio escucha la conversación que llega del Translator y pinta
// su propia SUPERFICIE: una vista viva, aparte de las notificaciones, que el
// host monta, actualiza y gestiona. La superficie se proyecta también a la app
// que la abrió (pantalla partida real).
//
// Cada skill declara: qué ranuras rellena (objetivos o campos), qué instruye al
// modelo y cómo se parsea su respuesta.
const AUDIO_SKILLS = {
  ventas: {
    id: 'ventas', icon: '🎯', name: 'Copiloto de ventas',
    desc: 'Te sopla el argumento exacto y marca los objetivos de la llamada.',
    kind: 'goals', tag: 'OBJETIVOS',
    slots: [
      { key: 'nombre', label: 'El cliente da su nombre' },
      { key: 'interes', label: 'El cliente muestra interés' },
      { key: 'telefono', label: 'El cliente da su teléfono' },
      { key: 'compra', label: 'El cliente quiere comprar' },
    ],
    rule: 'OBJETIVOS: nombre=si|no; interes=si|no; telefono=si|no; compra=si|no',
    role: 'Eres mi copiloto de ventas EN VIVO. Persigue los objetivos en orden y dime el argumento exacto, la objeción a rebatir o el siguiente paso.',
  },
  ficha: {
    id: 'ficha', icon: '📇', name: 'Ficha de cliente',
    desc: 'Rellena sola la ficha con lo que el cliente va diciendo. Se exporta a Excel.',
    kind: 'fields', tag: 'DATOS', exportable: true,
    slots: [
      { key: 'nombre', label: 'Nombre' }, { key: 'empresa', label: 'Empresa' },
      { key: 'cargo', label: 'Cargo' }, { key: 'telefono', label: 'Teléfono' },
      { key: 'email', label: 'Email' }, { key: 'necesidad', label: 'Necesidad' },
      { key: 'presupuesto', label: 'Presupuesto' }, { key: 'plazo', label: 'Plazo' },
      { key: 'siguiente', label: 'Siguiente paso' },
    ],
    rule: 'DATOS: solo los campos que se hayan dicho, separados por punto y coma. Ejemplo: DATOS: nombre=Ana Ruiz; empresa=Acme; telefono=600123456. Omite los que no se hayan dicho; no escribas puntos suspensivos.',
    role: 'Eres mi asistente de ficha de cliente. Extraes los datos que el cliente dice y me avisas de qué falta por preguntar.',
  },
  facilitador: {
    id: 'facilitador', icon: '🧑‍🏫', name: 'Facilitador de reunión',
    desc: 'Temas, decisiones y tareas de la reunión, en vivo. Se exporta.',
    kind: 'fields', tag: 'DATOS', exportable: true,
    slots: [
      { key: 'tema', label: 'Tema actual' }, { key: 'decisiones', label: 'Decisiones' },
      { key: 'tareas', label: 'Tareas (quién/qué)' }, { key: 'riesgos', label: 'Riesgos' },
      { key: 'siguiente', label: 'Siguientes pasos' },
    ],
    rule: 'DATOS: solo lo que se haya dicho. Ejemplo: DATOS: tema=presupuesto 2027; decisiones=aprobado el piloto; tareas=Ana envía la propuesta. Acumula, no borres lo anterior; no escribas puntos suspensivos.',
    role: 'Eres el facilitador de la reunión. Sigues el hilo, anotas decisiones y tareas, y avisas si se desvía o si algo queda sin dueño.',
  },
  resumen: {
    id: 'resumen', icon: '📝', name: 'Resumen e ideas',
    desc: 'Resumen progresivo y las ideas que van saliendo.',
    kind: 'fields', tag: 'DATOS', exportable: true,
    slots: [
      { key: 'resumen', label: 'Resumen hasta ahora' }, { key: 'ideas', label: 'Ideas' },
      { key: 'dudas', label: 'Dudas abiertas' },
    ],
    rule: 'DATOS: resumen=<reescríbelo entero y breve cada vez>; ideas=<las que hayan salido>; dudas=<las abiertas>. No escribas puntos suspensivos.',
    role: 'Resumes la conversación según avanza y capturas las ideas y dudas que surgen.',
  },
};

function audioSkillMd(sk) {
  return `Esta skill SOLO actúa cuando llegan intervenciones marcadas con "[Hablante N]" (Hablante 1 = el usuario; Hablante 2 = el interlocutor). En una conversación normal de Claw, ignórala salvo que el usuario te pida editarla.

${sk.role}

POR CADA intervención responde EXACTAMENTE en dos líneas, nada más:
CONSEJO: <una línea accionable para el usuario, en su idioma>
${sk.rule}
Si no hay nada útil que aportar ahora, usa "CONSEJO: —". Nunca borres un dato ya capturado.

AUTO-EDICIÓN: puedes cambiarte a ti misma. Si el usuario te pide por el chat de Claw algo como "añade un campo email", "quita el presupuesto" o "sé más breve", edita ESTA misma skill con skill.edit y sigue la nueva versión desde ya.`;
}

// Superficie genérica: pinta las ranuras de la skill (objetivos o campos),
// el consejo en vivo y, si procede, el botón de exportar a Excel.
function surfaceHtml(sk) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<style>
:root{--bg:#0b0c14;--card:#12141f;--line:#232838;--brass:#c8a06a;--brass2:#e6c294;--indigo:#8272ff;--fg:#eae8f2;--dim:#8b91a3;--ok:#54dcc6}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:radial-gradient(130% 90% at 50% -10%,#181630,#0b0c14);color:var(--fg);padding:20px;min-height:100vh;display:flex;flex-direction:column}
h1{font-family:"Iowan Old Style",Georgia,serif;font-size:1.12rem;margin:0 0 3px;background:linear-gradient(96deg,var(--brass2),var(--indigo));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.sub{color:var(--dim);font-size:.6rem;letter-spacing:.15em;text-transform:uppercase;margin-bottom:14px;font-family:ui-monospace,monospace}
.sub b{color:var(--brass2);float:right;font-weight:500}
.bar{height:7px;border-radius:99px;background:var(--line);overflow:hidden;margin-bottom:16px}
.bar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--brass),var(--indigo));transition:width .7s cubic-bezier(.2,.7,.2,1)}
.slot{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:11px;background:var(--card);margin-bottom:8px;transition:border-color .4s,background .4s,transform .3s}
.slot .dot{width:20px;height:20px;border-radius:50%;border:2px solid var(--line);flex:none;display:grid;place-items:center;font-size:.65rem;color:transparent;transition:all .4s;margin-top:1px}
.slot .k{font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);font-family:ui-monospace,monospace}
.slot .v{font-size:.9rem;color:var(--fg);line-height:1.35;word-break:break-word}
.slot .lbl{font-size:.88rem;color:var(--dim);transition:color .4s}
.slot.done{border-color:var(--brass);background:linear-gradient(120deg,rgba(200,160,106,.10),rgba(130,114,255,.05))}
.slot.done .dot{background:var(--ok);border-color:var(--ok);color:#06210b}
.slot.done .lbl{color:var(--fg)}
.slot.just{animation:pop .6s cubic-bezier(.2,.8,.2,1)}
@keyframes pop{0%{transform:scale(1)}40%{transform:scale(1.03)}100%{transform:scale(1)}}
.advice{margin-top:auto;padding:13px 15px;border:1px solid var(--line);border-left:3px solid var(--brass);border-radius:10px;background:rgba(200,160,106,.05);font-size:.9rem;line-height:1.4;color:var(--brass2)}
.advice .k{display:block;font-family:ui-monospace,monospace;font-size:.56rem;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin-bottom:5px}
.advice.flash{animation:advin .4s ease}
@keyframes advin{0%{opacity:.4;transform:translateY(-3px)}100%{opacity:1;transform:none}}
button{margin-top:10px;width:100%;background:transparent;color:var(--brass);border:1px solid var(--line);border-radius:8px;padding:9px;font:inherit;font-size:.78rem;cursor:pointer}
button:hover{border-color:var(--brass)}
</style></head><body>
<h1>${sk.icon} ${sk.name}</h1>
<div class="sub">${sk.kind === 'goals' ? 'Objetivos' : 'Datos capturados'} <b id="count"></b></div>
<div class="bar"><i id="fill"></i></div>
<div id="slots"></div>
<div class="advice" id="advice"><span class="k">En vivo</span><span id="atext">Esperando a que empiece la conversación…</span></div>
${sk.exportable ? '<button id="exp">⬇ Exportar a Excel (CSV)</button>' : ''}
<script>
const KIND=${JSON.stringify(sk.kind)}, SLOTS=${JSON.stringify(sk.slots)}, NAME=${JSON.stringify(sk.name)};
let data={};
function render(justKey){
  const box=document.getElementById('slots'); box.innerHTML=''; let filled=0;
  for(const s of SLOTS){
    const v=data[s.key]; const has=KIND==='goals' ? v===true : !!(v&&String(v).trim());
    if(has) filled++;
    const el=document.createElement('div');
    el.className='slot'+(has?' done':'')+(s.key===justKey?' just':'');
    if(KIND==='goals'){ el.innerHTML='<div class="dot">✓</div><div class="lbl"></div>'; el.querySelector('.lbl').textContent=s.label; }
    else { el.innerHTML='<div class="dot">✓</div><div><div class="k"></div><div class="v"></div></div>';
      el.querySelector('.k').textContent=s.label; el.querySelector('.v').textContent=has?v:'—'; }
    box.appendChild(el);
  }
  document.getElementById('count').textContent=filled+' / '+SLOTS.length;
  document.getElementById('fill').style.width=(SLOTS.length?filled/SLOTS.length*100:0)+'%';
}
render(null);
addEventListener('message',e=>{
  const d=e.data||{}; if(d.type!=='surface-state') return;
  let just=null;
  if(d.data) for(const [k,v] of Object.entries(d.data)){ if(data[k]!==v&&v) just=k; data[k]=v; }
  render(just);
  if(typeof d.advice==='string'&&d.advice){ const a=document.getElementById('advice');
    document.getElementById('atext').textContent=d.advice;
    a.classList.remove('flash'); void a.offsetWidth; a.classList.add('flash'); }
});
const exp=document.getElementById('exp');
if(exp) exp.onclick=()=>{
  const rows=[['Campo','Valor']].concat(SLOTS.map(s=>[s.label,(data[s.key]==null?'':String(data[s.key]))]));
  const csv='\\ufeff'+rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(';')).join('\\r\\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download=NAME.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.csv'; a.click();
};
try{parent.postMessage({type:'surface-ready'},'*');}catch(e){}
<\/script></body></html>`;
}

let copilotSkill = AUDIO_SKILLS.ventas;
let copilotData = {};

function copilotInitState() { copilotData = {}; }
function renderCopilotBoard() {
  try { ui.renderApp(copilotSkill.icon + ' ' + copilotSkill.name, surfaceHtml(copilotSkill)); } catch { /* */ }
}
function copilotPostState(advice) {
  // El visor de Claw es uno solo: si otra cosa (una app del agente, el cerebro
  // autónomo…) lo ocupa, la superficie desaparecía. Se re-monta sola.
  const f0 = document.getElementById('appframe');
  if (!f0 || f0.hidden || !(f0.srcdoc || '').includes(copilotSkill.name)) renderCopilotBoard();
  const frame = document.getElementById('appframe');
  const msg = { type: 'surface-state', id: copilotSkill.id, data: copilotData, advice: advice || '' };
  try { frame?.contentWindow?.postMessage(msg, '*'); } catch { /* */ }
  // Proyección a la app que abrió el copiloto: pantalla partida de verdad.
  if (window.__copilotOpener && window.opener) {
    try { window.opener.postMessage({ kind: 'surface-state', ...msg }, window.__copilotOpener); } catch { /* */ }
  }
}

// Parsea la respuesta del modelo: CONSEJO + la línea de datos de la skill.
function copilotParse(text) {
  const s = String(text || '');
  const cm = s.match(/CONSEJO:\s*(.+)/i);
  const tagRe = new RegExp(copilotSkill.tag + ':\\s*(.+)', 'i');
  // Exigir la marca CONSEJO:. Sin ella, la respuesta es el modelo poniéndose a
  // conversar (o haciendo de interlocutor) — y eso NO es un consejo: se tira.
  const advice = cm ? cm[1].trim() : '';
  const updates = {};
  const om = s.match(tagRe);
  // El modelo escribe «teléfono» con tilde y mis claves van sin ella: sin
  // normalizar, el dato se perdía. También rechaza los valores-plantilla
  // («…», «-») que a veces copia del propio ejemplo.
  const norm = k => k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const VACIO = /^(…|\.\.\.|—|–|-|_+|n\/a|null|none|desconocido|sin datos)$/i;
  if (om) for (const pair of om[1].split(';')) {
    const m = pair.match(/\s*([\wáéíóúñÁÉÍÓÚÑ]+)\s*=\s*(.+)/);
    if (!m) continue;
    const key = norm(m[1]), raw = m[2].trim().replace(/^["'\u201c]|["'\u201d]$/g, '').trim();
    if (copilotSkill.kind === 'goals') { if (/^(si|sí|s|yes|y|true|1)$/i.test(raw)) updates[key] = true; }
    else if (raw && !VACIO.test(raw)) updates[key] = raw;
  }
  return { advice, updates };
}
function copilotEmit(text) {
  const { advice, updates } = copilotParse(text);
  for (const [k, v] of Object.entries(updates)) copilotData[k] = v;
  const clean = (advice || '').trim().replace(/^["'\u201c\u201d\s]+|["'\u201c\u201d\s]+$/g, '').trim();
  const show = (clean && !/^[—\-–_]+$/.test(clean)) ? clean : '';
  copilotPostState(show);
  if (show && window.__copilotOpener && window.opener) {
    try { window.opener.postMessage({ kind: 'copilot-advice', text: show }, window.__copilotOpener); } catch { /* */ }
  }
}
window.__copilotEmit = copilotEmit;

// Turno de copiloto por la VÍA RÁPIDA: no pasa por el bucle agéntico (que
// mete todas las herramientas, las skills y el estado del sistema en el
// prompt). Un modelo pequeño se pierde en ese muro y se pone a conversar en
// vez de aconsejar — además de tardar mucho más. Aquí: prompt mínimo,
// historial corto y el formato recordado en cada turno.
let copilotHist = [];
let copilotBusy = false;
async function copilotTurn(line) {
  if (copilotBusy) return;                 // un turno a la vez: el modelo es uno
  copilotBusy = true;
  const sk = copilotSkill;
  const sys = `Eres el copiloto de ${sk.name}. Escuchas una conversación ajena y AYUDAS a quien la mantiene. NUNCA respondas como si fueras un interlocutor ni continúes el diálogo.
Responde SIEMPRE exactamente en dos líneas, sin comillas y sin nada más:
CONSEJO: <una línea accionable para el usuario>
${sk.rule}
Si no hay nada útil que decir: CONSEJO: —`;
  copilotHist.push({ role: 'user', content: line });
  if (copilotHist.length > 8) copilotHist = copilotHist.slice(-8);
  const recordatorio = `\n\n(Responde SOLO con las dos líneas: CONSEJO: … y ${sk.tag}: …)`;
  const msgs = copilotHist.slice(0, -1).concat([{ role: 'user', content: line + recordatorio }]);
  try {
    const out = await agent.provider.chat(msgs, sys, () => {});
    copilotHist.push({ role: 'assistant', content: String(out).slice(0, 400) });
    ui.addMsg('assistant', String(out).slice(0, 300));
    copilotEmit(out);
  } catch (e) {
    ui.addMsg('assistant err', 'copiloto: ' + (e?.message || e));
  } finally { copilotBusy = false; }
}


// ── Pipe cross-origin: skills de audio en vivo desde el Translator ──
(function copilotPipe() {
  try { if (!/[?&]copilot=1/.test(location.search)) return; } catch { return; }
  const ALLOWED = 'https://translator.elffuss.utopiaia.com';
  // qué skill de audio se ha pedido (?skill=ficha, etc.)
  const want = (location.search.match(/[?&]skill=([\w-]+)/) || [])[1];
  if (want && AUDIO_SKILLS[want]) copilotSkill = AUDIO_SKILLS[want];
  let started = false;
  window.addEventListener('message', e => { if (e.data && e.data.type === 'surface-ready') copilotPostState(''); });
  window.addEventListener('message', async e => {
    if (e.origin !== ALLOWED) return;
    window.__copilotOpener = ALLOWED;
    const m = e.data || {};
    if (m.kind === 'copilot-init' && !started) {
      started = true;
      if (m.skill && AUDIO_SKILLS[m.skill]) copilotSkill = AUDIO_SKILLS[m.skill];
      const sk = copilotSkill;
      const sellerLang = m.sellerLangName || 'el idioma del usuario';
      try {
        if (!skills.installed().some(s => s.name === sk.name)) {
          await skills.createSkill({ name: sk.name, description: sk.desc, instructions: audioSkillMd(sk) });
        }
      } catch { /* */ }
      copilotInitState();
      renderCopilotBoard();
      // Proyectar la superficie a la app que nos abrió → pantalla partida real.
      try { window.opener?.postMessage({ kind: 'surface', v: 1, id: sk.id, title: sk.icon + ' ' + sk.name, html: surfaceHtml(sk) }, ALLOWED); } catch { /* */ }
      clearInterval(window.__copilotBoardWatch);
      window.__copilotBoardWatch = setInterval(() => {
        const f = document.getElementById('appframe');
        if (document.hidden) return;
        if (!f || f.hidden || !(f.srcdoc || '').includes(sk.name)) { renderCopilotBoard(); copilotPostState(''); }
      }, 5000);
      setTimeout(() => { if (activeModel === 'rules') copilotPostState('Cargando el cerebro… empiezo en cuanto esté listo.'); }, 800);
      copilotHist = [];
    } else if (m.kind === 'transcript' && m.text) {
      const line = '[' + (m.speaker || 'interlocutor') + '] ' + String(m.text).slice(0, 400);
      ui.addMsg('user', line);
      copilotTurn(line);
    }
  });
  try { if (window.opener) window.opener.postMessage({ kind: 'copilot-ready' }, ALLOWED); } catch { /* */ }
})();

// Núcleo: arranca UI, agente, planificador y el proveedor de modelo activo.
import { Agent, parseToolCall } from './agent.js';
import * as ui from './ui.js';
import * as rules from './providers/rules.js';
import * as db from './db.js';
import * as settings from './settings.js';
import { tasks, watch } from './tools/index.js';

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
  if (id.startsWith('ext:')) {
    const cfg = settings.get(id.slice(4));
    if (!cfg) throw new Error('proveedor externo desconocido');
    const mod = await import('./providers/api.js');
    mod.configure(cfg);
    return mod;
  }
  throw new Error('proveedor desconocido: ' + id);
}

// Opciones del selector: locales siempre; externos solo si están activados.
function modelOptions() {
  const local = [];
  if (navigator.gpu) local.push({ id: 'onnx', label: 'Local · ONNX/WebGPU (Qwen 0.5B)' });
  if (navigator.gpu) local.push({ id: 'litert', label: 'Local · LiteRT-LM (Gemma E2B)' });
  local.push({ id: 'rules', label: 'Básico (sin modelo)' });
  return [...local, ...settings.enabledExternals()];
}

const isLocal = id => id === 'onnx' || id === 'litert';

const agent = new Agent(rules);
let busy = false;
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
  busy = true;
  const thinking = ui.thinkingBubble();
  try {
    await agent.handle(text, ev => {
      if (ev.type === 'token') thinking.tick(ev.text);
      if (ev.type === 'text') ui.addMsg('assistant', ev.text);
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
  ui.toast('Conversación restaurada 🌿 (🧹 para empezar de cero)');
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
    const where = isLocal(id) ? (navigator.gpu ? 'WebGPU local' : 'CPU/wasm local') : 'externo';
    ui.modelStatus(isLocal(id) && navigator.gpu ? 'gpu' : 'on');
    ui.toast(`${mod.name} listo · ${where} · готово ✳`);
    return true;
  } catch (e) {
    ui.modelProgress(null);
    ui.modelStatus('off');
    agent.setProvider(rules);
    activeModel = 'rules';
    ui.setModel('rules');
    console.error('[elffuss] fallo cargando modelo', e);
    ui.toast('⚠️ No se pudo cargar ' + id + ': ' + (e?.message || String(e)));
    return false;
  }
}

// Rehacer el selector (locales + externos activados) tras tocar la config.
function refreshModelOptions() {
  ui.rebuildModelSelect(modelOptions(), activeModel);
}

// Splash de primera visita: la promesa de privacidad, con guiño incluido.
const splash = document.getElementById('splash');
if (!localStorage.getItem('elffuss.welcomed')) {
  splash.hidden = false;
  document.getElementById('splash-enter').addEventListener('click', () => {
    localStorage.setItem('elffuss.welcomed', '1');
    splash.style.opacity = '0';
    setTimeout(() => { splash.hidden = true; }, 600);
  });
}

ui.init({ onSend: send, onModelChange: changeModel, onSettingsChanged: refreshModelOptions });
refreshModelOptions();
restoreHistory().then(restoreQueue);

// Autocarga SOLO LOCAL: lo último elegido (si sigue disponible) → ONNX local
// si hay WebGPU → modo básico. Nunca tira de un modelo externo/servidor por su
// cuenta: eso es siempre elección explícita del usuario (config avanzada).
(async () => {
  try {
    const saved = localStorage.getItem('elffuss.model');
    if (saved === 'rules') return; // elección explícita
    const available = new Set(modelOptions().map(o => o.id));
    // el guardado se respeta aunque sea externo (el usuario ya lo activó);
    // el ÚNICO respaldo automático es local (onnx) — jamás un externo.
    const chain = [...new Set([saved, navigator.gpu ? 'onnx' : null]
      .filter(id => id && available.has(id)))];
    if (!chain.length) return;
    ui.toast('Cargando el cerebro de Elffuss… mientras, el modo básico te atiende.');
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
      'liberado el modelo. Si quieres, me arrancas de nuevo desde el selector 🧠 ' +
      'de arriba. добре 💛');
    ui.toast('⚠️ RAM muy llena: modelo local liberado automáticamente');
  } else if (ratio > 0.82 && !ramWarned) {
    ramWarned = true;
    ui.toast(`⚠️ La memoria del navegador va al ${Math.round(ratio * 100)}% — si sigue subiendo, liberaré el modelo yo sola.`);
  }
}, 15000);

// Las tareas vencidas se auto-envían como prompts al agente.
tasks.startScheduler(t => {
  ui.toast('⏰ Tarea programada: ' + t.prompt);
  send('⏰ [tarea programada] ' + t.prompt);
});

// Automatizaciones de carpetas: dejar un archivo en la de origen → Elffuss lo
// procesa y lo deja en la de destino, avisando por chat.
watch.startWatcher(msg => {
  ui.toast(msg);
  ui.addMsg('assistant', msg);
});

window.elffuss = { agent, send }; // consola de depuración

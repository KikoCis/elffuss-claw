// Núcleo: arranca UI, agente, planificador y el proveedor de modelo activo.
import { Agent, parseToolCall } from './agent.js';
import * as ui from './ui.js';
import * as rules from './providers/rules.js';
import * as db from './db.js';
import { tasks } from './tools/index.js';

const providers = {
  remote: () => import('./providers/remote.js'),
  onnx: () => import('./providers/onnx.js'),
  litert: () => import('./providers/litert.js'),
};

const agent = new Agent(rules);
let busy = false;
let activeModel = 'rules';   // qué proveedor está cargado (para el vigilante de RAM)
let activeMod = null;

async function send(text) {
  if (busy) { ui.toast('Un momento, sigo con lo anterior…'); return; }
  busy = true;
  ui.addMsg('user', text);
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
    // histórico persistente: al refrescar, la conversación sigue ahí
    db.set('kv', 'history', agent.history.slice(-80)).catch(() => {});
  }
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
  agent.history = [];
  location.reload();
});

async function changeModel(id) {
  if (!providers[id]) { // modo básico
    agent.setProvider(rules);
    activeModel = 'rules';
    activeMod = null;
    ui.modelStatus('off');
    localStorage.setItem('elffuss.model', 'rules');
    ui.toast('Modo básico: sin modelo, órdenes directas.');
    return;
  }
  ui.modelStatus('loading');
  try {
    const mod = await providers[id]();
    ui.modelProgress('Preparando modelo…');
    await mod.load(p => ui.modelProgress(p));
    ui.modelProgress(null);
    agent.setProvider(mod);
    activeModel = id;
    activeMod = mod;
    localStorage.setItem('elffuss.model', id);
    document.getElementById('model-select').value = id;
    const where = id === 'remote' ? 'servidor' : (navigator.gpu ? 'WebGPU' : 'CPU/wasm');
    ui.modelStatus(id === 'remote' || navigator.gpu ? 'gpu' : 'on');
    ui.toast(`${mod.name} listo · ${where} · готово ✳`);
    return true;
  } catch (e) {
    ui.modelProgress(null);
    ui.modelStatus('off');
    agent.setProvider(rules);
    document.getElementById('model-select').value = 'rules';
    console.error('[elffuss] fallo cargando modelo', e);
    ui.toast('⚠️ No se pudo cargar ' + id + ': ' + (e?.message || String(e)));
    return false;
  }
}

ui.init({ onSend: send, onModelChange: changeModel });
restoreHistory();

// Autocarga del cerebro con cadena de respaldo: lo último elegido → Ornith en
// el servidor → ONNX local (si hay WebGPU) → modo básico. Elffuss no arranca
// «sin modelo»; mientras carga, el modo básico atiende.
(async () => {
  const saved = localStorage.getItem('elffuss.model');
  if (saved === 'rules') return; // elección explícita del usuario
  const chain = [...new Set([saved, 'remote', navigator.gpu ? 'onnx' : null]
    .filter(id => id && providers[id]))];
  if (!chain.length) return;
  ui.toast('Cargando el cerebro de Elffuss… mientras, el modo básico te atiende.');
  for (const id of chain)
    if (await changeModel(id)) return;
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
  const localModel = activeModel === 'onnx' || activeModel === 'litert';
  if (ratio > 0.92 && localModel) {
    const mod = activeMod;
    agent.setProvider(rules);
    activeModel = 'rules';
    activeMod = null;
    document.getElementById('model-select').value = 'rules';
    ui.modelStatus('off');
    try { await mod?.unload?.(); } catch { /* mejor esfuerzo */ }
    ui.addMsg('assistant',
      '⚠️ Ojo: tu ordenador está muy a full de memoria — puedes experimentar caídas ' +
      'o rendimiento lento si sigues usándolo. Por el momento me he parado y he ' +
      'liberado el modelo. Si quieres, me arrancas de nuevo desde el selector 🧠 ' +
      'de arriba (o usa «Ornith 9B · servidor», que no gasta tu RAM). добре 💛');
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

window.elffuss = { agent, send }; // consola de depuración

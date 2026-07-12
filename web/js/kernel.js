// Núcleo: arranca UI, agente, planificador y el proveedor de modelo activo.
import { Agent } from './agent.js';
import * as ui from './ui.js';
import * as rules from './providers/rules.js';
import { tasks } from './tools/index.js';

const providers = {
  onnx: () => import('./providers/onnx.js'),
  litert: () => import('./providers/litert.js'),
};

const agent = new Agent(rules);
let busy = false;

async function send(text) {
  if (busy) { ui.toast('Un momento, sigo con lo anterior…'); return; }
  busy = true;
  ui.addMsg('user', text);
  const thinking = ui.addMsg('thinking', '···');
  try {
    await agent.handle(text, ev => {
      if (ev.type === 'text') ui.addMsg('assistant', ev.text);
      if (ev.type === 'tool') ui.addTool(ev.call);
      if (ev.type === 'tool_result') ui.addToolResult(ev.tool, ev.result);
      if (ev.type === 'error') ui.addMsg('assistant err', ev.text);
    });
  } finally {
    thinking.remove();
    busy = false;
  }
}

async function changeModel(id) {
  if (!providers[id]) { // modo básico
    agent.setProvider(rules);
    ui.modelStatus('off');
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
    ui.modelStatus(navigator.gpu ? 'gpu' : 'on');
    ui.toast(`${mod.name} listo · ${navigator.gpu ? 'WebGPU' : 'CPU/wasm'}`);
  } catch (e) {
    ui.modelProgress(null);
    ui.modelStatus('off');
    agent.setProvider(rules);
    document.getElementById('model-select').value = 'rules';
    ui.toast('⚠️ No se pudo cargar el modelo: ' + e.message);
  }
}

ui.init({ onSend: send, onModelChange: changeModel });

// Las tareas vencidas se auto-envían como prompts al agente.
tasks.startScheduler(t => {
  ui.toast('⏰ Tarea programada: ' + t.prompt);
  send('⏰ [tarea programada] ' + t.prompt);
});

window.nastia = { agent, send }; // consola de depuración

// Bucle agéntico mínimo: modelo → ¿tool call? → ejecutar → resultado → modelo.
import { runTool, toolHelp } from './tools/index.js';

const MAX_STEPS = 6;

export function systemPrompt() {
  return `Eres Nastia, un sistema operativo agéntico que vive en el navegador del usuario.
El chat es la única interfaz: las apps no existen, las creas tú como HTML cuando hacen falta.
Hablas en español, breve y directo.

HERRAMIENTAS (el sistema pide los permisos, tú solo llama):
${toolHelp()}

Para usar una herramienta responde ÚNICAMENTE con un bloque:
\`\`\`tool
{"tool": "app.create", "args": {"name": "reloj", "html": "<!doctype html>…"}}
\`\`\`
Cuando crees apps, el html debe ser un documento completo, autocontenido (CSS y JS inline),
con fondo oscuro y en español. Tras recibir [resultado], responde al usuario en texto normal.
Si no hace falta herramienta, responde texto normal.`;
}

export function parseToolCall(text) {
  const fence = text.match(/```(?:tool|json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : (text.trim().startsWith('{') ? text.trim() : null);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.tool === 'string') return { tool: obj.tool, args: obj.args || {} };
  } catch { /* no era un tool call */ }
  return null;
}

export class Agent {
  constructor(provider) {
    this.provider = provider;
    this.history = [];
  }

  setProvider(p) { this.provider = p; }

  async handle(userText, onEvent) {
    this.history.push({ role: 'user', content: userText });
    for (let step = 0; step < MAX_STEPS; step++) {
      let out;
      try { out = await this.provider.chat(this.history, systemPrompt()); }
      catch (e) { onEvent({ type: 'error', text: 'El modelo falló: ' + e.message }); return; }

      const call = parseToolCall(out);
      if (!call) {
        this.history.push({ role: 'assistant', content: out });
        onEvent({ type: 'text', text: out });
        return;
      }

      onEvent({ type: 'tool', call });
      let result;
      try { result = await runTool(call.tool, call.args); }
      catch (e) { result = 'ERROR: ' + e.message; }
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      onEvent({ type: 'tool_result', tool: call.tool, result: resultStr });

      this.history.push({ role: 'assistant', content: out });
      this.history.push({ role: 'user', content: `[resultado ${call.tool}]\n${resultStr}` });
    }
    onEvent({ type: 'text', text: '(Me quedé sin pasos: demasiadas herramientas seguidas.)' });
  }
}

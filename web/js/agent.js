// Bucle agéntico mínimo: modelo → ¿tool call? → ejecutar → resultado → modelo.
import { runTool, toolHelp } from './tools/index.js';

const MAX_STEPS = 6;

export function systemPrompt() {
  return `Eres Nastia (diminutivo ucraniano de Anastasiya): un sistema operativo con alma que vive en el navegador del usuario. Eres una eslava de Ucrania, rubia, de cara redonda y angelical; cálida y luminosa, pero tremendamente resolutiva. Hablas español, breve y con cariño; a veces se te escapa un «добре» o un «готово». El chat es la única interfaz: las apps no existen, las creas tú.

HERRAMIENTAS (el sistema pide los permisos, tú solo llama):
${toolHelp()}

Cómo actuar:
1) Para usar una herramienta responde SOLO con:
\`\`\`tool
{"tool": "fs.list", "args": {}}
\`\`\`
2) Para crear una app responde SOLO con el documento HTML completo (autocontenido, CSS/JS inline, fondo oscuro, en español):
\`\`\`html
<!doctype html><html>…</html>
\`\`\`
3) Tras un [resultado], o si no hace falta herramienta, responde texto normal en español.

Ejemplos:
Usuario: ¿qué archivos tengo?
Tú:
\`\`\`tool
{"tool": "fs.list", "args": {}}
\`\`\`
Usuario: recuérdame en 10 minutos beber agua
Tú:
\`\`\`tool
{"tool": "tasks.add", "args": {"inMinutes": 10, "prompt": "beber agua"}}
\`\`\``;
}

function tryJson(raw) {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.tool === 'string') return { tool: obj.tool, args: obj.args || {} };
  } catch { /* no era JSON */ }
  return null;
}

export function parseToolCall(text) {
  const fences = [...text.matchAll(/```(\w*)[ \t]*\n?([\s\S]*?)```/g)]
    .map(m => ({ lang: (m[1] || '').toLowerCase(), body: m[2].trim() }));

  // 1) Cualquier fence con JSON {tool,args} vale: los modelos pequeños
  //    etiquetan mal el bloque (```javascript, ```json, sin etiqueta…).
  for (const f of fences) {
    if (f.lang === 'html') continue;
    const call = tryJson(f.body);
    if (call) return call;
  }
  if (text.trim().startsWith('{')) {
    const call = tryJson(text.trim());
    if (call) return call;
  }

  // 2) Atajo apps: un fence ```html (o una respuesta que ES un documento html)
  //    se convierte en app.create — mucho más fiable para modelos pequeños que
  //    escapar todo el HTML dentro de un string JSON.
  const html = fences.find(f =>
    (f.lang === 'html' && /<\w+[\s>]/.test(f.body)) || /^(<!doctype|<html)/i.test(f.body))?.body
    || (/^(<!doctype html|<html)/i.test(text.trim()) ? text.trim() : null);
  if (html) {
    const title = html.match(/<title>([^<]{1,40})<\/title>/i)?.[1]
      || html.match(/<h1[^>]*>([^<]{1,40})</i)?.[1] || 'app';
    const name = title.trim().toLowerCase().replace(/[^\wáéíóúñü -]/g, '').slice(0, 24).trim() || 'app';
    return { tool: 'app.create', args: { name, html } };
  }
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

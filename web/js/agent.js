// Bucle agéntico mínimo: modelo → ¿tool call? → ejecutar → resultado → modelo.
import { runTool, toolHelp, snapshot } from './tools/index.js';
import { skillsPromptBlock, installed } from './skills.js';
import { crearRouter, bloqueEjemplos } from './tool-router.js';
import { t } from './i18n.js';
import * as telemetry from './telemetry.js';

const MAX_STEPS = 6;

const LANGS = {
  es: 'español', en: 'English', uk: 'українська', ru: 'русский', fr: 'français',
  de: 'Deutsch', it: 'italiano', pt: 'português', pl: 'polski', ca: 'català',
  gl: 'galego', eu: 'euskera', nl: 'Nederlands', ro: 'română', tr: 'Türkçe',
};

export function userLang() {
  const code = (navigator.language || 'es').toLowerCase();
  return { code, name: LANGS[code.split('-')[0]] || code };
}

// Un modelo con MENOS de esto no puede oír las instrucciones completas: medidas
// con el tokenizador de verdad son 1.315 tokens (525 solo el catálogo de
// herramientas), y encima hay que dejar sitio para lo que escribe el usuario y
// para la respuesta. Lo mide `tests/prompt-vs-contexto.mjs`; si el prompt
// engorda, ese test lo dice antes de que lo diga un usuario.
export const CTX_MINIMO_COMPLETO = 1600;

// Los ejemplos del prompt pueden viajar con su familia de herramientas
// (bloqueEjemplos, en tool-router.js), pero va APAGADO porque medido no gana.
// Gemma 4 E4B, banco ciego, 52 peticiones con herramienta:
//   · prompt entero                          42/52   1.283 tokens
//   · recortando solo el catálogo            44/52   1.033
//   · recortando catálogo y ejemplos         42/52     934
// Empata con el entero, pero acierta dos menos que recortar solo el catálogo, y
// en los casos que cambian entre esas dos, tres empeoran y uno mejora. Con 52
// casos es ruido en las dos direcciones, y ruido no basta para encender algo
// que toca lo que el modelo imita. Con false van los cinco siempre, como antes.
const RECORTAR_EJEMPLOS = false;

export function systemPrompt(context = '', { compacto = false, herramientas = null } = {}) {
  const lang = userLang();
  // Versión corta para modelos de contexto pequeño. No es el prompt de siempre
  // recortado: es OTRO trato. Sin catálogo de herramientas (525 tokens) no puede
  // llamarlas, así que se le dice, y así no promete lo que no puede hacer. Y
  // tampoco lleva el contexto vivo: en un modelo lento cada token del prompt se
  // paga en segundos de espera antes de la primera letra.
  if (compacto) {
    return `Eres Elffuss: un sistema operativo con alma que vive en el navegador del usuario. Cálida y luminosa, pero directa. Hablas SIEMPRE en el idioma del navegador del usuario: ${lang.name} (${lang.code}).
Aquí tienes muy poco contexto disponible, así que SOLO conversas: no tienes herramientas, no puedes crear apps ni leer archivos. Si te piden algo de eso, dilo con naturalidad y sugiere elegir otro modelo arriba.
Responde en una o dos frases, sin listas y sin código.`;
  }
  return `Eres Elffuss: un sistema operativo con alma que vive en el navegador del usuario. Cálida y luminosa, pero tremendamente resolutiva. Hablas SIEMPRE en el idioma del navegador del usuario: ${lang.name} (${lang.code}) — breve y con cariño. Si el usuario cambia de idioma, síguele. El chat es la única interfaz: las apps no existen, las creas tú.

HERRAMIENTAS (el sistema pide los permisos, tú solo llama):
${herramientas ? herramientas.join('\n') : toolHelp()}

Cómo actuar:
1) Para usar una herramienta responde SOLO con:
\`\`\`tool
{"tool": "fs.list", "args": {}}
\`\`\`
2) Para crear una app responde SOLO con el documento HTML completo (autocontenido, CSS/JS inline, fondo oscuro, en el idioma del usuario). Si la app es visual o creativa (juegos, arte, música, datos, ambientes), usa <canvas> con WebGL o efectos de partículas/glow — que luzca espectacular, no un formulario gris:
\`\`\`html
<!doctype html><html>…</html>
\`\`\`
3) Tras un [resultado] que EMPIEZA por ERROR: no te rindas ni digas que no se puede. REANALIZA el mensaje de error (suele decir qué hay o qué falta) y REINTENTA con la corrección (otra ruta, otros argumentos). Solo si vuelve a fallar de otra forma, explica al usuario qué pasó.
4) Tras un [resultado] correcto, o si no hace falta herramienta, responde texto normal en el idioma del usuario. No repitas una herramienta que YA salió bien (una app creada ya está hecha): responde y para.
5) SÍ PUEDES buscar y navegar por internet: usa web.search (texto) o web.images (fotos). NUNCA digas que no tienes acceso a internet — para eso están las herramientas.${bloqueEjemplos(RECORTAR_EJEMPLOS ? herramientas : null)}${skillsPromptBlock()}${context ? `

CONTEXTO AHORA (estado real del sistema, úsalo al responder):
${context}` : ''}`;
}

// ── qué herramientas se le enseñan al modelo en cada turno ──────────────────
// Ver tool-router.js: se recuperan por familias según la petición y, si el
// recuperador duda, se manda el catálogo entero. Medido en un banco a ciegas de
// 60 peticiones (tests/enrutado-herramientas.mjs): la familia buena queda a la
// vista en 57, y el catálogo baja de 536 a 304 tokens de media.
//
// Las skills instaladas pueden llamar a herramientas de cualquier familia: las
// que nombra una skill se enseñan siempre, o la skill se quedaría a medias sin
// que el modelo supiera por qué.
//
// SOLO PARA LOS MODELOS QUE LO PIDEN. Enseñar menos herramientas no le sienta
// igual a todos los modelos, y la literatura que dice que ayuda no midió los
// nuestros. Medido con modelo de verdad (tests/enrutado-modelo.mjs, banco ciego,
// 52 peticiones que necesitan herramienta, temperatura 0):
//   · Gemma 4 E4B: 42 → 44 aciertos. Empate —gana 4, pierde 2— con unos 250
//     tokens menos de prompt, que en local es prefill que no se paga.
//   · Qwen3.5-0.8B: 29 → 23. Con menos herramientas a la vista contesta con una
//     app HTML o no llama a nada, aunque la herramienta buena esté delante.
// Por eso es opt-in: se enciende si el proveedor declara enrutaHerramientas()
// —como prefiereCompacto()—, y el que no dice nada recibe el catálogo entero,
// como antes de que esto existiera. Un modelo no entra sin medirlo.
//
// Y el banco mide peticiones SUELTAS, así que solo vale para proveedores que
// reconstruyen el prompt en cada llamada (motor propio, ONNX, API). Uno que
// guarda la conversación con su prompt de sistema dentro —LiteRT— congela el
// catálogo del primer mensaje: ese declara false, que significa «imposible».
// Hoy ningún proveedor lo declara true: E4B, el único que lo aguanta, va por
// LiteRT.
//
// Interruptor, como el del gestor de contexto:
//   localStorage.setItem('elffuss.router', 'off')   → catálogo entero siempre
//   localStorage.setItem('elffuss.router', 'on')    → recuperación con un modelo sin medir (para medirlo)
//   localStorage.removeItem('elffuss.router')        → lo que declare el proveedor (por defecto)
// Un proveedor que declara false no se fuerza ni con 'on'.
let router = null;
export function herramientasPara(consulta, provider = null) {
  try {
    const interruptor = typeof localStorage !== 'undefined' ? localStorage.getItem('elffuss.router') : null;
    const declara = provider?.enrutaHerramientas?.();
    if (interruptor === 'off' || declara === false) return null;
    if (interruptor !== 'on' && !declara) return null;
    router ||= crearRouter(toolHelp().split('\n'));
    const deSkills = new Set();
    for (const s of installed() || [])
      for (const m of String(s.content || '').matchAll(/\b(fs|app|vault|tasks|web|skill|memory)\.[a-z_]+/g)) deSkills.add(m[1]);
    const r = router.rutear(consulta, { ademas: [...deSkills] });
    console.debug('[herramientas]', r ? r.familias.join(', ') : 'todas (sin señal clara)');
    return r;
  } catch (e) {
    console.warn('[herramientas] el recuperador falló, va el catálogo entero:', e.message);
    return null;
  }
}

// Repara el JSON de modelos pequeños: coma final + saltos de línea/tab/CR
// LITERALES dentro de cadenas (rompen JSON.parse). Las comillas internas sin
// escapar las resuelve looseToolCall.
function repairJson(raw) {
  const s = raw.replace(/,(\s*[}\]])/g, '$1');
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && ch === '\n') { out += '\\n'; continue; }
    if (inStr && ch === '\r') { out += '\\r'; continue; }
    if (inStr && ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  return out;
}

// Extractor tolerante dirigido por claves: localiza cada clave conocida y lee su
// valor hasta la comilla de cierre REAL (« seguida de , " o }} »), tolerando
// comillas y saltos sin escapar. Si una cadena NO cierra, es un truncado a media
// escritura → no recuperar (no inventar datos).
function looseToolCall(raw) {
  const tm = raw.match(/"tool"\s*:\s*"([\w.]+)"/);
  if (!tm) return null;
  const am = raw.match(/"args"\s*:\s*\{/);
  const body = am ? raw.slice(am.index + am[0].length) : raw;
  const args = {};
  for (const key of ['path', 'content', 'name', 'html', 'prompt', 'text', 'search', 'replace', 'query', 'key', 'value']) {
    const km = body.match(new RegExp('"' + key + '"\\s*:\\s*"'));
    if (!km) continue;
    let val = '', closed = false;
    for (let i = km.index + km[0].length; i < body.length; i++) {
      const ch = body[i];
      if (ch === '\\') { val += ch + (body[i + 1] || ''); i++; continue; }
      if (ch === '"' && /^\s*(,\s*"|\}\s*[}\]]|\}\s*$|$)/.test(body.slice(i + 1))) { closed = true; break; }
      val += ch;
    }
    if (!closed) return null;
    try { val = JSON.parse('"' + val.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"'); } catch { /* crudo */ }
    args[key] = val;
  }
  for (const key of ['inMinutes', 'offset', 'limit', 'depth']) {
    const nm = body.match(new RegExp('"' + key + '"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)'));
    if (nm) args[key] = Number(nm[1]);
  }
  return { tool: tm[1], args };
}

function tryJson(raw) {
  for (const cand of [raw, repairJson(raw)]) {
    try {
      const obj = JSON.parse(cand);
      if (obj && typeof obj.tool === 'string') return { tool: obj.tool, args: obj.args || {} };
    } catch { /* siguiente capa */ }
  }
  return looseToolCall(raw);
}

// Formato NATIVO de LFM2.5 (y afines): <|tool_call_start|>[ name(k="v", n=3) ]<|tool_call_end|>
// o simplemente name(k="v") en su línea. Se parsea a {tool, args}.
export function parseNativeCall(text) {
  const m = text.match(/<\|tool_call_start\|>\s*\[?\s*([\w.]+)\s*\(([\s\S]*?)\)\s*\]?\s*<\|tool_call_end\|>/)
    || text.match(/^\s*\[\s*([\w.]+)\s*\(([\s\S]*?)\)\s*\]\s*$/m);
  if (!m) return null;
  const args = {};
  const re = /([\w]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,)]+)/g;
  let a;
  while ((a = re.exec(m[2]))) {
    let v = a[2].trim();
    if (/^["']/.test(v)) v = v.slice(1, -1).replace(/\\(.)/g, '$1');
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    else if (v === 'true' || v === 'false') v = v === 'true';
    args[a[1]] = v;
  }
  return { tool: m[1], args };
}

export function parseToolCall(text) {
  const native = parseNativeCall(text);
  if (native) return native;

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
  //    Un fence SIN CERRAR (el modelo agotó max_tokens a media app) también
  //    vale: los navegadores toleran HTML truncado.
  const openFence = text.match(/```html[ \t]*\n?([\s\S]*)$/i);
  const html = fences.find(f =>
    (f.lang === 'html' && /<\w+[\s>]/.test(f.body)) || /^(<!doctype|<html)/i.test(f.body))?.body
    || (/^(<!doctype html|<html)/i.test(text.trim()) ? text.trim() : null)
    || (!fences.length && openFence && /^(<!doctype|<html)/i.test(openFence[1].trim()) ? openFence[1].trim() : null);
  if (html) {
    const title = html.match(/<title>([^<]{1,40})<\/title>/i)?.[1]
      || html.match(/<h1[^>]*>([^<]{1,40})</i)?.[1] || 'app';
    const name = title.trim().toLowerCase().replace(/[^\wáéíóúñü -]/g, '').slice(0, 24).trim() || 'app';
    return { tool: 'app.create', args: { name, html } };
  }
  return null;
}

// Cierre amable cuando el bucle se corta: usa el último resultado útil.
function closingLine(done, lastResult) {
  if (lastResult && !lastResult.startsWith('ERROR')) return lastResult;
  return t('anythingElse');
}

export class Agent {
  constructor(provider) {
    this.provider = provider;
    this.history = [];
  }

  setProvider(p) { this.provider = p; }

  async handle(userText, onEvent) {
    // La marca temporal se pone AL AÑADIR, que es el único momento en que se
    // sabe: el gestor de contexto resuelve «ayer» con la fecha del turno en que
    // se dijo, no con la de ahora (ver annotateDates en acer-core.js). Sin esto
    // la anotación se calla, que es lo correcto, pero no sirve para nada.
    this.history.push({ role: 'user', content: userText, ts: Date.now() });
    const done = [];            // firmas de tool calls ya ejecutadas este turno
    let lastResult = '';
    // Una sola decisión por turno, sobre lo que pidió el usuario. El prompt no
    // debe cambiar entre los pasos de un mismo turno: un resultado de herramienta
    // podría esconderle al modelo la herramienta que necesita en el paso siguiente.
    const ruta = herramientasPara(userText, this.provider);
    const herramientas = ruta?.lineas?.length ? ruta.lineas : null;
    for (let step = 0; step < MAX_STEPS; step++) {
      let out;
      try {
        const context = await snapshot().catch(() => '');
        // Los proveedores que saben cuánto contexto tienen lo dicen; los que no,
        // devuelven 0 y todo sigue igual que siempre. Sin esto, Elffuss le
        // mandaba sus 1.315 tokens de instrucciones al 27B —que tiene 512— y el
        // primer mensaje moría con la caché llena DESPUÉS de 7,6 GB de descarga.
        const contexto = this.provider.contextTokens?.() || 0;
        // Se habla en corto por DOS razones distintas, y conviene no confundirlas:
        //
        //   · porque no CABE  → contexto < CTX_MINIMO_COMPLETO (lo de arriba).
        //   · porque no da TIEMPO → el proveedor lo pide con prefiereCompacto().
        //
        // La segunda no se deduce de la primera. Al 27B le cabe el prompt entero
        // (1.340 tokens sobre 2.048) y aun así no debe recibirlo: medido en la
        // misma carga, el primer token tarda unas catorce veces más con el prompt
        // completo que con el compacto. Minutos mirando una caja quieta es un usuario que
        // se va convencido de que está roto —nos pasó a nosotros teniendo los
        // logs delante—. Por eso se fusionan las dos con un OR en vez de decidirlo
        // todo por tamaño: quien mande la señal de velocidad gana, quepa o no.
        const compacto = this.provider.prefiereCompacto?.()
          || (contexto > 0 && contexto < CTX_MINIMO_COMPLETO);
        out = await this.provider.chat(this.history, systemPrompt(context, { compacto, herramientas }),
          t => onEvent({ type: 'token', text: t }));
      } catch (e) {
        telemetry.reportError('agent.handle: ' + e.message, { stack: e.stack || '' });
        onEvent({ type: 'error', text: 'El modelo falló: ' + e.message });
        return;
      }

      const call = parseToolCall(out);
      if (!call) {
        this.history.push({ role: 'assistant', content: out, ts: Date.now() });
        onEvent({ type: 'text', text: out });
        return;
      }

      // Anti-bucle: los modelos pequeños repiten la misma herramienta. Si ya se
      // ejecutó esta llamada (misma firma) o ya se creó una app, se corta y se
      // cierra con una respuesta en vez de girar hasta agotar los pasos.
      const sig = call.tool + ':' + JSON.stringify(call.args || {});
      if (done.includes(sig)) {
        onEvent({ type: 'text', text: closingLine(done, lastResult) });
        return;
      }
      done.push(sig);

      onEvent({ type: 'tool', call });
      let result;
      try { result = await runTool(call.tool, call.args); }
      catch (e) { result = 'ERROR: ' + e.message; }
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      lastResult = resultStr;
      onEvent({ type: 'tool_result', tool: call.tool, result: resultStr });

      this.history.push({ role: 'assistant', content: out, ts: Date.now() });
      const pista = resultStr.startsWith('ERROR')
        ? '\n(Reanaliza este error y reintenta con la corrección; no te rindas.)' : '';
      this.history.push({ role: 'user', content: `[resultado ${call.tool}]\n${resultStr}${pista}`, ts: Date.now() });

      // Tras crear/abrir una app, la tarea suele estar hecha: cierra ya.
      if ((call.tool === 'app.create' || call.tool === 'app.open') && !resultStr.startsWith('ERROR')) {
        onEvent({ type: 'text', text: t('done', { result: resultStr }) });
        return;
      }
    }
    onEvent({ type: 'text', text: closingLine(done, lastResult) });
  }
}

// RLM — Recursive Language Models (el modo «Hard Work» de Elffuss).
//
// Idea (Zhang et al., MIT, 2025): un modelo PEQUEÑO y local puede manejar
// entradas ENORMES si no las mete todas de golpe en su ventana, sino que
// TROCEA el material, pregunta a cada trozo (map = una sub-llamada al mismo
// modelo) y FUNDE las respuestas (reduce). Si lo fundido aún no cabe, se
// recurre. El modelo raíz nunca ve todo el contexto a la vez: trabaja por
// partes, como un humano leyendo un tocho capítulo a capítulo.
//
// Trade-off honesto: cambia LATENCIA por CAPACIDAD. Son muchas inferencias del
// modelo local (que es lento), así que es para tareas que PUEDEN esperar —
// auditar, resumir o revisar una carpeta/repo entero— no para tiempo real.
//
// El motor es agnóstico del proveedor: solo necesita algo con
// `chat(history, system, onToken)` (lo cumplen rules/onnx/litert/api).

const CHARS_PER_TOK = 4; // misma estimación que context.js
const DEFAULTS = {
  chunkTokens: 1800,     // tamaño de cada trozo (deja hueco al prompt del modelo)
  overlapTokens: 120,    // solape para no cortar una idea a la mitad entre trozos
  maxDepth: 3,           // recursión máxima del reduce jerárquico
  maxChunks: 80,         // techo DURO de sub-llamadas del map (coste/tiempo)
  callTimeoutMs: 120000, // guarda por sub-llamada (un motor colgado no bloquea todo)
};

const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

// Trocea respetando límites de línea cuando es posible (no parte a mitad de
// palabra si hay un salto cerca del corte).
function chunk(text, chunkChars, overlapChars) {
  const step = Math.max(1, chunkChars - overlapChars);
  const out = [];
  for (let i = 0; i < text.length; i += step) {
    let end = Math.min(i + chunkChars, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > i + chunkChars * 0.6) end = nl; // corta en salto si cae en el último 40%
    }
    out.push(text.slice(i, end));
    if (end >= text.length) break;
  }
  return out;
}

// sub(): UNA inferencia del modelo local sobre un fragmento. Es la recursión.
async function sub(provider, system, prompt, timeoutMs) {
  const run = provider.chat([{ role: 'user', content: prompt }], system, () => {});
  if (!timeoutMs) return run;
  let to;
  const guard = new Promise((_, rej) => { to = setTimeout(() => rej(new Error('sub-llamada agotó el tiempo')), timeoutMs); });
  try { return await Promise.race([run, guard]); }
  finally { clearTimeout(to); }
}

const MAP_SYS = 'Eres un analista minucioso. Te doy UN fragmento de un material más grande y una pregunta. Responde SOLO con lo que ESTE fragmento aporte a la pregunta: datos concretos, en pocas frases, con cita textual breve si procede. No inventes lo que no esté en el fragmento. Si el fragmento no aporta nada a la pregunta, responde exactamente: NADA';
const REDUCE_SYS = 'Eres un sintetizador. Te doy una pregunta y varios hallazgos extraídos de fragmentos distintos del MISMO material. Fúndelos en una única respuesta, coherente y completa, a la pregunta. Resuelve solapes, no repitas, no inventes lo que no esté en los hallazgos. Responde en el idioma de la pregunta.';

// Motor RLM. Devuelve { answer, chunks, kept }.
export async function hardWork({ question, context, provider, onProgress = () => {}, opts = {} }) {
  const o = { ...DEFAULTS, ...opts };
  if (!provider || typeof provider.chat !== 'function') throw new Error('Hard Work necesita un cerebro cargado (elige un modelo local o remoto arriba).');
  const q = String(question || '').trim();
  const ctx = String(context || '').trim();
  if (!q) throw new Error('Hard Work: dime qué quieres saber del material.');
  if (!ctx) throw new Error('Hard Work: no encontré material que procesar.');

  const chunkChars = o.chunkTokens * CHARS_PER_TOK;
  let parts = chunk(ctx, chunkChars, o.overlapTokens * CHARS_PER_TOK);
  const truncated = parts.length > o.maxChunks;
  if (truncated) parts = parts.slice(0, o.maxChunks);
  onProgress({ phase: 'plan', chunks: parts.length, chars: ctx.length, truncated });

  // MAP — un modelo local es UN motor, así que las sub-llamadas van en serie.
  const findings = [];
  for (let i = 0; i < parts.length; i++) {
    onProgress({ phase: 'map', i: i + 1, n: parts.length });
    let ans;
    try { ans = await sub(provider, MAP_SYS, `PREGUNTA:\n${q}\n\nFRAGMENTO ${i + 1}/${parts.length}:\n${parts[i]}`, o.callTimeoutMs); }
    catch { ans = 'NADA'; }
    ans = String(ans || '').trim();
    if (ans && !/^NADA\b/i.test(ans)) findings.push(`[${i + 1}] ${ans}`);
  }
  onProgress({ phase: 'mapped', kept: findings.length, of: parts.length });
  if (!findings.length) return { answer: 'Revisé el material por partes y no encontré nada relevante para eso.', chunks: parts.length, kept: 0, truncated };

  const answer = await reduce(provider, q, findings, o, onProgress, 0);
  return { answer: String(answer || '').trim(), chunks: parts.length, kept: findings.length, truncated };
}

// REDUCE jerárquico: si los hallazgos caben, funde en uno; si no, agrupa,
// funde cada grupo y recurre con las respuestas parciales.
async function reduce(provider, q, findings, o, onProgress, depth) {
  const budget = o.chunkTokens * CHARS_PER_TOK * 2; // el reduce puede ver algo más que un trozo
  const joined = findings.join('\n');
  if (joined.length <= budget || depth >= o.maxDepth) {
    onProgress({ phase: 'reduce', depth, final: true });
    return sub(provider, REDUCE_SYS, `PREGUNTA:\n${q}\n\nHALLAZGOS:\n${clip(joined, budget)}`, o.callTimeoutMs);
  }
  const groups = [];
  let cur = [];
  let len = 0;
  for (const f of findings) {
    if (len + f.length + 1 > budget && cur.length) { groups.push(cur); cur = []; len = 0; }
    cur.push(f); len += f.length + 1;
  }
  if (cur.length) groups.push(cur);
  onProgress({ phase: 'reduce', depth, groups: groups.length, final: false });
  const partials = [];
  for (let g = 0; g < groups.length; g++) {
    onProgress({ phase: 'reduce-group', depth, g: g + 1, n: groups.length });
    const p = await sub(provider, REDUCE_SYS, `PREGUNTA:\n${q}\n\nHALLAZGOS (grupo ${g + 1}/${groups.length}):\n${groups[g].join('\n')}`, o.callTimeoutMs);
    partials.push(`[g${g + 1}] ${String(p || '').trim()}`);
  }
  return reduce(provider, q, partials, o, onProgress, depth + 1);
}

// ── Hard Work · CREACIÓN: borrador → autocrítica → reescritura ──────────────
// El hermano creativo de RLM. RLM gasta cómputo LEYENDO material enorme; esto
// lo gasta MEJORANDO lo que el modelo crea: en vez de una sola pasada, el
// modelo pequeño hace un borrador, se autocritica sin piedad y se reescribe
// corrigiendo sus propios fallos. Sube la calidad de un modelo modesto sin
// cambiar de modelo — solo pensando más veces.
const CREATE_SYS = 'Eres Elffuss creando una app web. Respondes SOLO con un documento HTML completo y autocontenido (CSS y JS inline, fondo oscuro). Si es un juego o algo visual, usa <canvas> y que se vea vivo (color, movimiento, efectos). Nada de texto fuera del HTML.';
const CRITIQUE_SYS = 'Eres un crítico de videojuegos y front-end, implacable pero útil. Te doy el código de una app/juego web. Enumera 3 a 6 defectos CONCRETOS y accionables: bugs de lógica, controles que faltan, colisiones mal hechas, falta de condición de fin o de puntuación, jugabilidad sosa y pobreza visual (sin color, sin efectos, estático). Sé específico y breve. NO reescribas el código: solo la lista de defectos.';
const REWRITE_SYS = 'Eres Elffuss mejorando tu propia app. Te doy el HTML actual y una crítica. Devuelve SOLO el HTML completo y autocontenido MEJORADO que corrige TODOS los puntos de la crítica, conservando lo que ya funcionaba y subiendo el nivel visual (color, brillo, partículas si encaja). Sin explicaciones fuera del HTML.';

// Saca el documento HTML de la respuesta del modelo (fence ```html o directo).
export function extractHtml(text) {
  const s = String(text || '');
  const fence = s.match(/```html\s*([\s\S]*?)```/i) || s.match(/```\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : s;
  const m = body.match(/<!doctype[\s\S]*<\/html>/i) || body.match(/<html[\s\S]*<\/html>/i);
  return (m ? m[0] : body).trim();
}

const CONT_SYS = 'Continúas un documento HTML/JS que se cortó a media escritura. Devuelve SOLO la continuación EXACTA desde donde termina —sin repetir nada de lo ya escrito, sin reabrir <html> ni <script>, sin explicaciones— hasta cerrar todas las etiquetas y </html>.';

// Genera y, si el modelo se quedó sin tokens a media escritura (el HTML no
// cierra </html>), pide la continuación desde la cola y la cose. Así el techo
// de 1024 tokens deja de truncar apps grandes: se completan por tramos.
async function genComplete(provider, system, prompt, { maxCont = 4 } = {}) {
  let full = String(await provider.chat([{ role: 'user', content: prompt }], system, () => {}) || '');
  for (let i = 0; i < maxCont && !/<\/html>/i.test(full); i++) {
    const tail = full.slice(-1400);
    let cont = String(await provider.chat(
      [{ role: 'user', content: `FINAL de lo escrito hasta ahora (continúa desde aquí, sin repetirlo):\n${tail}` }],
      CONT_SYS, () => {}) || '');
    // Defensa: si el modelo reabre el documento en vez de continuar, recórtalo.
    cont = cont.replace(/^[\s\S]*?<!doctype html>/i, '').replace(/^[\s\S]*?<html[^>]*>/i, '');
    if (!cont.trim()) break;
    full += cont;
  }
  return full;
}


// ── Jurado deliberante (Reasoning Jury, arXiv 2608.12585) ───────────────────
// Un juez único detecta mal los defectos: se inventa unos y se le escapan
// otros (lo vimos con el crítico único de Hard Work). El paper sustituye al
// juez por un JURADO que delibera: cada jurado propone defectos, luego ve los
// de los demás y VOTA cuáles son reales, y un moderador se queda con los que
// tienen apoyo. Aquí el jurado es un mismo modelo con lentes distintas —no
// modelos distintos, que no caben en el navegador—, así que el efecto es
// menor que en el paper; por eso se mide, no se asume.
const JURY_LENSES = [
  { key: 'logica', name: 'lógica', ask: 'errores de lógica y de estado: variables sin definir, condiciones al revés, bucles que no avanzan, una condición de fin que nunca se cumple, cuentas mal hechas' },
  { key: 'interaccion', name: 'interacción', ask: 'controles y respuesta: entradas que no hacen nada, colisiones que no detectan, falta de arranque o de reinicio, nada que indique al usuario qué pasa' },
  { key: 'visual', name: 'presentación', ask: 'lo que se ve: elementos con tamaño cero o fuera de pantalla, todo del mismo color, nada dibujado, texto ilegible' },
];

const asLines = t => String(t || '').split('\n')
  .map(l => l.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
  .filter(l => l.length > 12 && l.length < 220);

const normDefect = d => d.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3).slice(0, 6).join(' ');

// Devuelve { defects:[{text,votes,jurors}], rounds } sobre un artefacto.
// Normaliza espacios para comparar una cita con el código real.
const flat = t => String(t).replace(/\s+/g, ' ').trim();

// Elige las lentes que TIENEN algo que mirar en este artefacto. Pasarle
// «presentación» a una función pura de cálculo no aporta nada: ese jurado o
// calla o repite lo que dijo el de lógica, y los repetidos se comían las
// plazas de candidatos.
function lensesFor(material) {
  const tieneUI = /<canvas|<button|<input|<form|document\.|addEventListener|innerHTML|querySelector/i.test(material);
  const tienePintado = /<canvas|getContext|fillRect|drawImage|style\.|css/i.test(material);
  const out = [JURY_LENSES[0]];                                  // lógica: siempre
  if (tieneUI) out.push(JURY_LENSES[1]);                         // interacción
  if (tienePintado) out.push(JURY_LENSES[2]);                    // presentación
  if (out.length === 1) out.push(JURY_LENSES_EXTRA[0], JURY_LENSES_EXTRA[1]);  // código puro
  else if (out.length === 2) out.push(JURY_LENSES_EXTRA[0]);
  return out;
}

// Lentes para código sin interfaz, donde «interacción» y «presentación» no pintan nada.
const JURY_LENSES_EXTRA = [
  { key: 'datos', name: 'datos y tipos', ask: 'tipos y datos: conversiones implícitas, valores que llegan como texto cuando se esperan números, undefined/NaN, claves que cambian de tipo' },
  { key: 'bordes', name: 'casos límite', ask: 'casos límite y validación: entradas vacías, negativas o fuera de rango, ausencia de comprobaciones, resultados absurdos que nadie detiene' },
];

export async function juryReview({ artifact, provider, onProgress = () => {}, lenses = null, requireEvidence = true }) {
  const dropped = [];
  if (!provider?.chat) throw new Error('el jurado necesita un cerebro cargado');
  const material = String(artifact || '').slice(0, 6000);
  lenses = lenses || lensesFor(material);
  onProgress({ phase: 'jury-lenses', lenses: lenses.map(l => l.name) });

  // Ronda 1 — cada jurado propone defectos desde SU lente, sin ver a los demás.
  const proposals = [];
  for (const L of lenses) {
    onProgress({ phase: 'jury-propose', lens: L.name });
    const sys = `Eres un revisor especializado en ${L.ask}. Te doy el código de una app web. Enumera SOLO los defectos REALES que veas desde tu especialidad. Por cada uno escribe DOS líneas seguidas:
DEFECTO: <qué está mal, en una línea>
PRUEBA: <copia LITERAL del fragmento de código que lo demuestra, tal cual aparece>
Máximo 4 defectos. Si no ves ninguno, escribe NINGUNO. La PRUEBA debe estar copiada del código palabra por palabra; si no puedes copiarla, no incluyas ese defecto.`;
    const out = await provider.chat([{ role: 'user', content: 'CÓDIGO:\n' + material }], sys, () => {});
    // Emparejar DEFECTO con su PRUEBA y COMPROBAR que la cita existe de verdad
    // en el código. Es un filtro determinista: si el modelo no sabe citar, se
    // lo ha inventado. (El modelo verifica mucho mejor de lo que propone, pero
    // esto ni siquiera necesita al modelo.)
    const raw = String(out).split('\n').map(x => x.trim());
    const found = [];
    for (let i = 0; i < raw.length; i++) {
      const dm = raw[i].match(/^DEFECTO:\s*(.+)/i);
      if (!dm) continue;
      const pm = (raw[i + 1] || '').match(/^PRUEBA:\s*(.+)/i);
      const texto = dm[1].trim();
      if (texto.length < 12) continue;
      if (!requireEvidence) { found.push({ texto, cita: pm ? pm[1].trim() : '' }); continue; }
      const cita = pm ? pm[1].trim().replace(/^[`'"]|[`'"]$/g, '') : '';
      if (cita.length >= 8 && flat(material).includes(flat(cita))) found.push({ texto, cita });
      else dropped.push({ lens: L.name, texto, cita: cita.slice(0, 60) });
    }
    proposals.push({ lens: L, found });
  }

  // Candidatos únicos (los jurados repiten el mismo defecto con otras palabras).
  // Deduplicar por la CITA de código, no por las palabras: dos jurados describen
  // el mismo fallo con frases distintas («el bucle empieza en 1» y «ignora el
  // primer elemento») y el deduplicador léxico los dejaba pasar como dos, con lo
  // que la lista de candidatos se llenaba de repetidos. Si señalan el mismo
  // fragmento de código, es el mismo defecto.
  const seen = new Map();
  for (const p of proposals) for (const d of p.found) {
    const k = d.cita && d.cita.length >= 8 ? 'c:' + flat(d.cita).slice(0, 80) : 't:' + normDefect(d.texto);
    if (k && !seen.has(k)) seen.set(k, d.texto);
  }
  const candidates = [...seen.values()].slice(0, 12);
  onProgress({ phase: 'jury-candidates', n: candidates.length });
  if (!candidates.length) return { defects: [], candidates: 0, dropped };

  // Ronda 2 — DELIBERACIÓN: cada jurado ve TODOS los candidatos (incluidos los
  // ajenos) y vota cuáles son de verdad. Aquí es donde puede retirar el suyo.
  const votes = candidates.map(() => 0);
  for (const L of lenses) {
    onProgress({ phase: 'jury-vote', lens: L.name });
    const list = candidates.map((c, i) => `${i + 1}. ${c}`).join('\n');
    // OJO con el formato: poner "N: SI" como plantilla hacía que el modelo
    // escribiera literalmente la letra N y no se parseara NINGÚN voto (el
    // jurado parecía rechazarlo todo). Los modelos pequeños copian el ejemplo
    // tal cual: hay que darles números de verdad.
    const sys = `Eres un revisor riguroso (especialidad: ${L.name}). Te doy el código y una lista numerada de defectos propuestos por otros revisores. Para CADA número, mira el código y di si el defecto es REAL. Responde SOLO con una línea por defecto, con su número y SI o NO. Así:
1: SI
2: NO
3: SI
Nada más: ni explicaciones ni texto extra. Ante la duda, NO.`;
    const out = await provider.chat(
      [{ role: 'user', content: 'CÓDIGO:\n' + material + '\n\nDEFECTOS PROPUESTOS:\n' + list }], sys, () => {});
    const txt = String(out);
    let parsed = 0;
    for (const m of txt.matchAll(/(\d+)\s*[:.)\-]\s*(S[IÍ]|YES|NO)\b/gi)) {
      const i = +m[1] - 1;
      parsed++;
      if (i >= 0 && i < votes.length && /^(s[ií]|yes)$/i.test(m[2])) votes[i]++;
    }
    // Respaldo: si el modelo ignoró el formato numerado, leer los SI/NO en orden.
    if (!parsed) {
      const seq = [...txt.matchAll(/\b(S[IÍ]|YES|NO)\b/gi)].map(m => m[1]);
      seq.slice(0, votes.length).forEach((v, i) => { if (/^(s[ií]|yes)$/i.test(v)) votes[i]++; });
    }
    onProgress({ phase: 'jury-parsed', lens: L.name, parsed });
  }

  // Moderador — se queda con los que tienen apoyo de la mayoría del jurado.
  const need = Math.ceil(lenses.length / 2);
  const defects = candidates.map((text, i) => ({ text, votes: votes[i] }))
    .filter(d => d.votes >= need)
    .sort((a, b) => b.votes - a.votes);
  onProgress({ phase: 'jury-verdict', kept: defects.length, of: candidates.length });
  onProgress({ phase: 'jury-evidence', dropped: dropped.length });
  return { defects, candidates: candidates.length, jurors: lenses.length, dropped };
}


// ── Edición QUIRÚRGICA en vez de reescritura completa ───────────────────────
// Reescribir el documento entero para corregir tres cosas hace que el modelo
// regenere de cero lo que ya funcionaba, y por el camino rompe la mecánica.
// Aquí solo se le piden los CAMBIOS, y los aplica este código: si el fragmento
// a buscar no está tal cual en el documento, ese cambio se descarta. El modelo
// propone, el código decide — igual que con las citas del jurado.
const PATCH_SYS = `Eres Elffuss arreglando tu propia app. Te doy el HTML actual y una lista de defectos. NO reescribas el documento. Devuelve SOLO los cambios mínimos, en bloques de exactamente tres líneas:
BUSCAR: <fragmento LITERAL del código actual, copiado tal cual, en una línea>
CAMBIAR: <con qué se sustituye, en una línea>
MOTIVO: <qué defecto arregla>
Repite el bloque por cada cambio. Máximo 6. El texto de BUSCAR debe existir palabra por palabra en el HTML y ser único; si no puedes copiarlo exacto, omite ese cambio. No toques nada que ya funcione.`;

export function applyPatches(html, respuesta) {
  const lineas = String(respuesta || '').split('\n').map(x => x.trim());
  let out = html;
  const aplicados = [], fallidos = [];
  for (let i = 0; i < lineas.length; i++) {
    const b = lineas[i].match(/^BUSCAR:\s*(.+)/i);
    if (!b) continue;
    const c = (lineas[i + 1] || '').match(/^CAMBIAR:\s*(.+)/i);
    if (!c) continue;
    const buscar = b[1].trim(), cambiar = c[1].trim();
    if (buscar.length < 6) continue;
    const veces = out.split(buscar).length - 1;
    if (veces === 1) { out = out.replace(buscar, cambiar); aplicados.push(buscar.slice(0, 60)); }
    else fallidos.push({ buscar: buscar.slice(0, 60), veces });   // 0 = inventado, >1 = ambiguo
  }
  return { html: out, aplicados, fallidos };
}

export async function deepCreate({ brief, provider, rounds = 1, onProgress = () => {}, useJury = false, editMode = 'rewrite' }) {
  if (!provider || typeof provider.chat !== 'function') throw new Error('Hard Work necesita un cerebro cargado (elige un modelo arriba).');
  if (!String(brief || '').trim()) throw new Error('Hard Work: dime qué quieres que cree.');
  onProgress({ phase: 'draft' });
  let html = extractHtml(await genComplete(provider, CREATE_SYS, String(brief)));
  const trace = [{ round: 0, html }];
  for (let r = 1; r <= rounds; r++) {
    onProgress({ phase: 'critique', round: r });
    let critique;
    if (useJury) {
      const v = await juryReview({ artifact: html, provider, onProgress });
      critique = v.defects.length
        ? v.defects.map(d => `- ${d.text} (${d.votes} de ${v.jurors} revisores)`).join('\n')
        : 'Sin defectos con apoyo suficiente del jurado.';
    } else {
      critique = String(await provider.chat([{ role: 'user', content: `APP/JUEGO:\n${html}` }], CRITIQUE_SYS, () => {})).trim();
    }
    onProgress({ phase: 'rewrite', round: r, modo: editMode });
    if (editMode === 'patch') {
      const resp = await provider.chat(
        [{ role: 'user', content: `HTML ACTUAL:\n${html}\n\nDEFECTOS A CORREGIR:\n${critique}` }], PATCH_SYS, () => {});
      const { html: nuevo, aplicados, fallidos } = applyPatches(html, resp);
      onProgress({ phase: 'patched', round: r, aplicados: aplicados.length, fallidos: fallidos.length });
      if (aplicados.length) { html = nuevo; trace.push({ round: r, critique, html, aplicados, fallidos }); }
      else trace.push({ round: r, critique, html, aplicados: [], fallidos });
    } else {
      const improved = extractHtml(await genComplete(provider, REWRITE_SYS, `HTML ACTUAL:\n${html}\n\nCRÍTICA A CORREGIR:\n${critique}`));
      if (improved && /<\w+[\s>]/.test(improved)) { html = improved; trace.push({ round: r, critique, html }); }
    }
  }
  onProgress({ phase: 'done', rounds: trace.length - 1 });
  return { html, trace };
}

// ── Recolección de material desde una carpeta autorizada (File System Access) ──
// Camina el árbol, concatena ficheros de texto con cabecera de ruta, y corta a
// maxBytes para no reventar la memoria. Mismo código sirve a Claw (carpeta
// autorizada) y a Code (proyecto abierto): ambos entregan un directory handle.
const TEXT_EXT = new Set(('txt md markdown js mjs cjs ts tsx jsx json html htm css scss sass ' +
  'py rb php go rs java kt swift c h cpp hpp cc cs sh bash zsh yml yaml toml ini cfg conf ' +
  'xml csv tsv sql vue svelte astro lua r pl pm ex exs erl clj tex org rst gradle properties env').split(' '));
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'target', 'vendor', '.cache', 'coverage', '__pycache__', '.venv', 'venv']);

export async function gatherFolder(rootHandle, { maxBytes = 1.5e6, maxFiles = 400 } = {}) {
  if (!rootHandle || typeof rootHandle.entries !== 'function') throw new Error('no hay carpeta que leer');
  const out = [];
  let bytes = 0;
  let files = 0;
  async function walk(dir, prefix) {
    if (bytes >= maxBytes || files >= maxFiles) return;
    const entries = [];
    for await (const e of dir.entries()) entries.push(e);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, handle] of entries) {
      if (bytes >= maxBytes || files >= maxFiles) return;
      if (name.startsWith('.') && name !== '.env') { if (handle.kind === 'directory') continue; }
      const path = prefix ? prefix + '/' + name : name;
      if (handle.kind === 'directory') {
        if (SKIP_DIR.has(name)) continue;
        await walk(handle, path);
      } else {
        const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
        if (!TEXT_EXT.has(ext)) continue;
        try {
          const file = await handle.getFile();
          if (file.size > 400000) continue; // un fichero enorme suelto no monopoliza
          const text = await file.text();
          const block = `\n\n===== ${path} =====\n${text}`;
          out.push(block);
          bytes += block.length;
          files++;
        } catch { /* ilegible: se salta */ }
      }
    }
  }
  await walk(rootHandle, '');
  return out.join('').slice(0, maxBytes);
}

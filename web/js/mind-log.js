// Historial de la Mente: TODO lo que hace el cerebro, con la Mente abierta o no.
// ─────────────────────────────────────────────────────────────────────────────
// Antes el historial vivía dentro de mind.js y pushThought() tiraba cada evento
// que llegaba con la Mente cerrada: el «Historial completo» se saltaba justo lo
// que pasó mientras no mirabas, que es casi todo. Ahora se apunta siempre, aquí,
// en un módulo que no carga el mundo 3D (mind.js arrastra three.js desde la
// red, y ya no se carga hasta que abres la Mente).
//
// Persistente en IndexedDB (kv/mindLog). Lo guardado se carga ANTES de escribir:
// guardar sin haber cargado pisaría el historial anterior con solo lo nuevo.
import * as db from './db.js';

const CAP = 500;
let lineas = [];                 // [{ channel, text, path? }] — lo que se guarda
let cargado = null;
let guardarT = null;
const oyentes = new Set();
const lineBuf = new Map();       // canal → texto acumulado hasta la línea completa
const streamed = new Map();      // canal → ¿llegaron tokens? (evita duplicar el texto final)

export function cargar() {
  return (cargado ||= db.get('kv', 'mindLog').then(saved => {
    if (Array.isArray(saved) && saved.length) lineas = [...saved, ...lineas].slice(-CAP);
  }).catch(() => { /* aún no hay historial guardado */ }));
}

export function todas() { return lineas; }

// fn({ channel, text, path, estrella: [tipo, texto] | null }) por cada línea nueva.
export function suscribir(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }

function guardarPronto() {
  clearTimeout(guardarT);
  guardarT = setTimeout(() => { cargar().then(() => db.set('kv', 'mindLog', lineas)).catch(() => {}); }, 400);
}

function linea(channel, text, { estrella = null, path = null } = {}) {
  const l = path ? { channel, text, path } : { channel, text };
  lineas.push(l);
  if (lineas.length > CAP) lineas = lineas.slice(-CAP);
  guardarPronto();
  for (const fn of oyentes) { try { fn({ ...l, estrella }); } catch { /* un oyente roto no para el resto */ } }
}

function vaciar(channel) {
  const buf = (lineBuf.get(channel) || '').trim();
  if (buf) linea(channel, buf, { estrella: ['line', buf] });
  lineBuf.set(channel, '');
}

// Un evento del cerebro (ceo.js) → líneas del historial. Las estrellas de la
// Mente salen de aquí también (`estrella`: tipo y texto), para que lo que se ve
// y lo que queda apuntado sean lo mismo.
export function registrar(channel, ev) {
  if (!ev) return;
  if (channel === 'sys') { linea('ceo', ev.text || ''); return; }
  if (channel === 'ceo') {
    if (ev.type === 'cycle') linea('ceo', '● ' + ev.text, { estrella: ['event', ev.text] });
    else if (ev.type === 'survey') linea('ceo', ev.text);
    else if (ev.type === 'reprogram') linea('ceo', '⚙ ' + ev.text, { estrella: ['event', ev.text] });
    else if (ev.type === 'paused') linea('ceo', ev.text, { estrella: ['event', ev.text] });
    else if (ev.type === 'built') linea('ceo', '✦ ' + ev.text, { estrella: ['built', ev.text], path: ev.path || null });
    else linea('ceo', ev.text || '');
    return;
  }
  if (ev.type === 'open') { lineBuf.set(channel, ''); streamed.set(channel, false); }
  else if (ev.type === 'token') {
    streamed.set(channel, true);
    const buf = (lineBuf.get(channel) || '') + ev.text;
    lineBuf.set(channel, buf);
    if (/\n/.test(ev.text) || buf.length > 90) vaciar(channel);
  } else if (ev.type === 'tool') {
    vaciar(channel);
    linea(channel, '⟐ ' + ev.text, { estrella: ['tool', ev.text] });
  } else if (ev.type === 'tool_result') {
    // el RESULTADO real de la tool, enlazado justo debajo de su tool-call
    const t = '→ ' + (ev.text || '(sin salida)');
    linea(channel, t, { estrella: ['line', t] });
  } else if (ev.type === 'done') {
    vaciar(channel);
    // el proveedor puede devolver el texto final SIN pasar por tokens
    if (ev.text && !streamed.get(channel)) linea(channel, ev.text, { estrella: ['line', ev.text] });
  }
}

// Para «Borrar todo del navegador».
export function olvidar() { lineas = []; lineBuf.clear(); streamed.clear(); clearTimeout(guardarT); }

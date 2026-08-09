// Gestor de contexto ACE-lite: eviction de historial por relevancia, portado
// del attention-context-eviction (ACE_R) de agentic-install a nivel de
// mensaje (IDF + BM25-lite; en navegador no hay acceso a las atenciones).
// turboquant es cuantización de PESOS — para contexto, esto es lo que aplica.
//
// Reglas: el presupuesto es en tokens (~4 chars/token). Se conservan SIEMPRE
// los últimos RECENT mensajes; los antiguos compiten por el hueco restante
// puntuados por BM25-lite contra la consulta actual. Los evictados se
// sustituyen por una marca de omisión para que el modelo sepa que falta algo.

import { packHistoryACER, packHistoryACERHybrid } from './acer-core.js';

// ── ACE_R unificado ─────────────────────────────────────────────────────────
// El empaquetado por MENSAJES de aquí abajo se medió contra sesiones reales de
// Elffuss Code (leer/buscar/editar un proyecto durante ~50 turnos) y falla por
// dos motivos: (1) los últimos RECENT mensajes por sí solos ya se salen del
// presupuesto en el 55% de los turnos (un [resultado code.read] son ~1.5k tokens,
// no 68 como en el test sintético), así que NINGÚN mensaje antiguo sobrevive y
// se devuelven ~5.1k tokens cuando se piden 3k; (2) al conservar/tirar mensajes
// ENTEROS, el dato concreto que el agente vuelve a pedir se pierde aunque BM25
// puntúe bien ese mensaje. Medido sobre 32 sesiones reales (4 proyectos × 8
// semillas, 53 turnos): recuerdo de un dato antiguo que el agente vuelve a pedir
// 9.2% ± 11.3 (esto) vs 67.7% ± 7.9 (acer-core) con el MISMO gasto de tokens;
// truncar por la cola da 7.9% ± 11.9. acer-core.js selecciona por LÍNEAS con un
// presupuesto global. Banco: agentic-install/lab/gemma-e2b-cli/agent_test/acer_real.
// AVISO honesto: la ventaja viene del solape léxico con la PREGUNTA; si la
// pregunta no nombra lo que busca (solo el fichero), baja a 12.7% vs 6.8%.
//
// Para volver al comportamiento anterior (o comparar), en la consola:
//   localStorage.setItem('elffuss.acer', 'v1')   → empaquetado por mensajes
//   localStorage.removeItem('elffuss.acer')      → ACE_R unificado (por defecto)
function acerUnificado() {
  try { return localStorage.getItem('elffuss.acer') !== 'v1'; } catch { return true; }
}

// ── lado SEMÁNTICO (embeddings) ─────────────────────────────────────────────
// acer-core.js trae las dos vías: la léxica (BM25, síncrona) y la híbrida (BM25
// + embeddings fusionados por rangos, asíncrona). Medido en LoCoMo con el mismo
// presupuesto: BM25 23,59 · embeddings 23,95 · fusión de rangos 28,09 · contexto
// completo sin comprimir 22,56. La fusión vale +4,50 F1 sobre lo que corría.
//
// No es que lo semántico sea mejor —empatan en global— sino que cubre el punto
// ciego del léxico: cuando la pregunta NO comparte vocabulario con la respuesta,
// BM25 cae a 18,60 y los embeddings aguantan 24,28; cuando sí lo comparte manda
// BM25 (29,33 vs 23,58). La fusión se queda con los dos (24,05 / 32,73).
//
// POR DEFECTO APAGADO, y no por prudencia: por lo que salió al MEDIRLO.
//
//   · La primera carga cuesta una descarga de 235 MB (fp16, el camino rápido) o
//     118 MB (q8, el de respaldo). Para quien usa un proveedor externo
//     (providers/api.js) eso es una descarga que hoy NO EXISTE: pasa de 0 a
//     235 MB sólo por empaquetar mejor el contexto. Y para quien usa el modelo
//     local son ~+28 % sobre lo que ya descarga.
//   · Sólo compensa con adaptador WebGPU. Sin él se cae a wasm, que mide ~9×
//     más lento y se nota en CADA turno, no sólo en el primero.
//   · A cambio, con WebGPU el turno en régimen es una fracción de segundo y la
//     segunda sesión no descarga nada (transformers.js cachea el modelo).
//
// O sea: la ganancia de recuperación es real y grande (+4,50 F1), pero el precio
// no es despreciable y depende del equipo de quien lo usa. Así que se cablea
// entero, se deja probado, y se enciende a petición. Con la bandera apagada NI
// SIQUIERA se importa embed.js: el coste de tenerlo cableado es exactamente cero.
//
//   localStorage.setItem('elffuss.semantic', 'on')     → BM25 + embeddings
//   localStorage.setItem('elffuss.semantic', 'off')    → sólo BM25
//   localStorage.removeItem('elffuss.semantic')        → sólo BM25 (por defecto)
function semanticoOn() {
  try { return localStorage.getItem('elffuss.semantic') === 'on'; } catch { return false; }
}

// ── TARJETA DE RECUENTO (agregación) ────────────────────────────────────────
// «¿cuántos ficheros has tocado?» no está en ninguna línea del historial: está
// repartida en cuarenta. Ningún top-k la encuentra POR CONSTRUCCIÓN — no es que
// puntúe mal, es que no existe la línea que buscar. acer-core lo cuenta al
// indexar y lo emite como un bloque protegido (ver buildLedger / renderCard).
//
// APAGADO por defecto, y por lo que salió al MEDIRLO: la tarjeta ocupa ~150
// tokens del presupuesto y en el banco de hechos cuesta −1,1 puntos a
// presupuesto 3.000 (el de esta app) y ±0,0 a 16.000. A cambio, con ella el
// recuento pasa de estar el 0 % de las veces a estar el 100 %, y la enumeración
// de lo editado del 58,9 % al 90,6 %. O sea: si la sesión es de las que acaban
// con «hazme la lista de lo que tocaste», compensa; si no, se paga por nada.
//
//   localStorage.setItem('elffuss.resumen', 'on')    → con tarjeta
//   localStorage.removeItem('elffuss.resumen')       → sin tarjeta (por defecto)
function resumenOn() {
  try { return localStorage.getItem('elffuss.resumen') === 'on'; } catch { return false; }
}

// SEM_BUDGET alto A PROPÓSITO, y esto es lo contrario de lo que parece.
//
// acer-core deriva el tamaño de bloque como SB = ceil(nLíneas / SEM_BUDGET) y
// rearma los bloques desde el principio del historial EN CADA TURNO. Así que
// SEM_BUDGET no acota el coste: acota la RESOLUCIÓN, y de paso decide si la
// caché por contenido sirve para algo. Con un SEM_BUDGET bajo, cada vez que el
// historial crece lo justo para que SB suba de entero, TODOS los bloques cambian
// de texto y la caché falla entera; y como el bloque además engorda con la
// sesión, el turno se encarece con el tiempo. Con SEM_BUDGET por encima del
// número de líneas, SB vale 1: un bloque = una línea, el texto de una línea ya
// codificada NO cambia nunca, y un turno sólo paga las líneas NUEVAS.
//
// Medido en el navegador sobre una sesión de agente de 8 turnos (cada turno =
// una tool-call + 90 líneas de resultado, 752 líneas al final), con la caché
// viva entre turnos y el mismo modelo (coste relativo por turno, 1,0 = el mejor
// turno observado del barrido):
//
//     SEM_BUDGET    codificaciones por turno       coste por turno
//        64         ~64, casi todo recodificado    5,2× → 12,2×  ← y SUBIENDO
//       400         49–236, a saltos               0,4× –  8,0×  ← picos
//      4000         92, sólo lo nuevo              2,9× →   0,8×  ← plano
//
// Con 4000 cada línea se codifica UNA vez en toda la sesión (740 codificaciones
// para 752 líneas: las repetidas salen gratis por la caché) y el turno se ABARATA
// según avanza la sesión en vez de encarecerse. Es exactamente el «indexar al
// escribir» que describe la cabecera de acer-core. El valor está alineado con el
// tope de la caché de embed.js para que no se desaloje justo lo que el turno
// siguiente va a volver a pedir.
const SEM_BUDGET = 4000;

const RECENT = 6;
const MAX_MSG_CHARS = 12000; // ningún mensaje (p.ej. un README enorme) revienta el contexto

// Trunca por el MEDIO conservando cabeza y cola (útil para código/documentos).
function clampMsg(m) {
  const c = m.content || '';
  if (c.length <= MAX_MSG_CHARS) return m;
  const head = Math.floor(MAX_MSG_CHARS * 0.7);
  const tail = MAX_MSG_CHARS - head - 40;
  return { ...m, content: c.slice(0, head) + `\n… [recortado ${c.length - MAX_MSG_CHARS} caracteres] …\n` + c.slice(-tail) };
}
const STOP = new Set(('de la que el en y a los del se las por un para con no una su al lo como más pero sus le ' +
  'ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante ' +
  'todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto ' +
  'esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros tu te ti mi es son era eres').split(' '));

const tokens = s => (s.toLowerCase().match(/[a-záéíóúñü0-9_.]{2,}/g) || []).filter(w => !STOP.has(w));
const tokEstimate = m => Math.ceil((m.content || '').length / 4) + 4;

function bm25Scores(messages, query) {
  const q = [...new Set(tokens(query))];
  const docs = messages.map(m => tokens(m.content));
  const N = docs.length || 1;
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / N || 1;
  const df = new Map();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) || 0) + 1);
  const k = 1.2, b = 0.75;
  return docs.map(d => {
    if (!d.length) return 0;
    const tf = new Map();
    for (const w of d) tf.set(w, (tf.get(w) || 0) + 1);
    let score = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(w) || 0) + 0.5) / ((df.get(w) || 0) + 0.5));
      score += idf * (f * (k + 1)) / (f + k * (1 - b + b * (d.length / avgLen)));
    }
    return score;
  });
}

// Recorta resultados de herramientas antiguos: la cola larga rara vez importa.
const shrink = m => m.content.startsWith('[resultado') && m.content.length > 600
  ? { ...m, content: m.content.slice(0, 600) + '\n… (recortado por antigüedad)' }
  : m;

export function packHistory(history, budgetTokens = 2200) {
  if (!history.length) return history;
  if (acerUnificado()) return packHistoryACER(history, budgetTokens, { SUMMARY: resumenOn() }).messages;
  // los recientes también se recortan por mensaje: un solo tool-result gigante
  // (README de un repo grande) reventaba el contexto → «Too many tokens».
  const recent = history.slice(-RECENT).map(clampMsg);
  let used = recent.reduce((s, m) => s + tokEstimate(m), 0);
  const old = history.slice(0, -RECENT).map(shrink);
  if (!old.length || used >= budgetTokens) return recent;

  const query = [...history].reverse().find(m =>
    m.role === 'user' && !m.content.startsWith('[resultado'))?.content || '';
  const scores = bm25Scores(old, query);
  // orden por relevancia; a igualdad gana lo más nuevo
  const ranked = old.map((m, i) => ({ m, i, s: scores[i] }))
    .sort((a, b) => (b.s - a.s) || (b.i - a.i));

  const keep = new Set();
  for (const { m, i } of ranked) {
    const cost = tokEstimate(m);
    if (used + cost > budgetTokens) continue;
    used += cost;
    keep.add(i);
  }
  const packed = [];
  let dropped = 0;
  old.forEach((m, i) => {
    if (keep.has(i)) {
      if (dropped) { packed.push({ role: 'user', content: `[…${dropped} mensajes antiguos omitidos…]` }); dropped = 0; }
      packed.push(m);
    } else dropped++;
  });
  if (dropped) packed.push({ role: 'user', content: `[…${dropped} mensajes antiguos omitidos…]` });
  return [...packed, ...recent];
}

/**
 * Igual que packHistory pero por la vía HÍBRIDA (léxica + semántica) cuando la
 * bandera está encendida. Es la que deben usar los proveedores.
 *
 * Degrada al empaquetado de siempre —el mismo, byte a byte— si la bandera está
 * apagada, si el modelo de embeddings no está o no carga, o si codificar falla.
 * Ese camino de vuelta es deliberado: que no haya modelo no puede significar que
 * la app deje de funcionar, sólo que empaqueta como hoy.
 *
 * `packHistory` sigue exportada y síncrona por compatibilidad.
 */
export async function packHistoryAsync(history, budgetTokens = 2200) {
  if (!history.length) return history;
  if (!acerUnificado() || !semanticoOn()) return packHistory(history, budgetTokens);
  try {
    // Import DINÁMICO: con la bandera apagada, embed.js —y con él
    // transformers.js y el modelo— no se piden nunca.
    const { embed, embedCache } = await import('./embed.js');
    const r = await packHistoryACERHybrid(history, budgetTokens, {
      embed, cache: embedCache(), SEM_BUDGET, SUMMARY: resumenOn(),
    });
    return r.messages;
  } catch {
    return packHistory(history, budgetTokens);
  }
}

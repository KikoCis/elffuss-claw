// Gestor de contexto ACE-lite: eviction de historial por relevancia, portado
// del attention-context-eviction (ACE_R) de agentic-install a nivel de
// mensaje (IDF + BM25-lite; en navegador no hay acceso a las atenciones).
// turboquant es cuantización de PESOS — para contexto, esto es lo que aplica.
//
// Reglas: el presupuesto es en tokens (~4 chars/token). Se conservan SIEMPRE
// los últimos RECENT mensajes; los antiguos compiten por el hueco restante
// puntuados por BM25-lite contra la consulta actual. Los evictados se
// sustituyen por una marca de omisión para que el modelo sepa que falta algo.

const RECENT = 6;
const MAX_MSG_CHARS = 32000; // ningún mensaje (p.ej. un README enorme) revienta el contexto

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

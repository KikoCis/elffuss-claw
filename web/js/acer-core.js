/**
 * ACE CORE v2 — recuperación, no heurísticas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE REESCRIBIÓ ESTO
 *
 * La v1 puntuaba cada línea con `classifyLine()`, un conjunto de reglas escritas
 * a mano ("si contiene 'error' → 0.95", "si empieza por $ → 0.6"). Medido en un
 * banco de memoria a largo plazo, ese motor recuperaba el 2,0 % de la evidencia
 * necesaria — POR DEBAJO de quedarse los últimos N mensajes sin pensar (5,8 %).
 * No era mediocre: hacía daño.
 *
 * La causa es visible en la propia aritmética de la v1: classifyLine devolvía
 * entre 0.1 y 1.0, mientras el solapamiento con la pregunta entraba multiplicado
 * por 0.4. Las reglas pesaban más que aquello que el usuario está preguntando.
 *
 * Medición del sustituto, mismo banco y mismo presupuesto (recall de evidencia):
 *
 * Y en el banco de SESIONES REALES de agente (25 sesiones, 174 sondas, mismo
 * presupuesto — recall de hechos, sin juez LLM):
 *
 *     truncar por la cola .......... 7,0 %
 *     el empaquetador desplegado ... 15,1 %   ← y PLANO: con 10× de presupuesto
 *                                              recupera exactamente lo mismo,
 *                                              porque tira material ANTES de
 *                                              puntuar. No usa lo que le das.
 *     este ......................... 65,3 % ± 8,5
 *
 *     (LoCoMo, 200 preguntas, F1 del propio repo · recall de evidencia)
 *
 *                                        F1      evidencia
 *     contexto COMPLETO (techo) ....  22,56       100 %
 *     últimos N mensajes ...........   6,62       5,8 %
 *     acer v1 (heurísticas) ........   6,07       2,0 %   ← por debajo del suelo
 *     BM25 sin IDF .................  20,34      47,8 %
 *     BM25 .........................  23,59      60,3 %
 *     embeddings ...................  23,95      60,0 %
 *     híbrido (suma ponderada) .....  26,36      69,1 %
 *     fusión de RANGOS .............  28,09      71,1 %   ← este fichero
 *
 * ★ RECUPERAR BIEN BATE A TENERLO TODO: 28,09 contra 22,56 del contexto
 *   completo, usando el 8 % de los tokens — el 135 % del techo. Lo irrelevante
 *   no es neutro: distrae. Comprimir bien no es un mal menor, es una MEJORA.
 *
 * ★ Y encender la heurística cuesta −3,02 F1 (26,36 con peso 0 → 23,34 con el
 *   peso que llevaba). No es que no aportara: restaba.
 *
 * Dos lecturas importantes de esa tabla:
 *
 *   1. BM25 y los embeddings EMPATAN en global, pero NO hacen el mismo trabajo.
 *      Partiendo las preguntas por solape de vocabulario con la respuesta:
 *
 *        sin solape léxico (n=107):  embeddings 24,28  >  BM25 18,60
 *        con solape       (n=93):    BM25       29,33  >  embeddings 23,58
 *        fusión de rangos:                      24,05  /            32,73
 *
 *      La fusión se queda con LOS DOS. Lo semántico no sustituye al léxico:
 *      le cubre el punto ciego. Ese es el motivo de que el híbrido exista.
 *
 *   2. La fusión por RANGOS gana a la suma ponderada, y además evita tener que
 *      calibrar escalas entre una puntuación BM25 (no acotada) y un coseno
 *      (en [-1,1]), que es una fuente clásica de fragilidad.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DECISIONES DE DISEÑO
 *
 *   · Sin heurísticas. Ni una regla sobre el contenido. Si una línea importa, lo
 *     dirá su relevancia frente a la pregunta viva, no una lista de palabras.
 *
 *   · Sin lista de parada escrita a mano. La v1 llevaba REF_STOP con palabras
 *     inglesas y castellanas a mano. La IDF calculada sobre el PROPIO historial
 *     hace ese trabajo sola y mejor: lo que aparece en todas partes recibe peso
 *     casi nulo por construcción, sin diccionario y sin saber en qué idioma
 *     estamos. Un stoplist a mano es una lista de parada que envejece; la IDF
 *     endógena se adapta a cada conversación.
 *
 *   · BM25 de verdad: saturación de frecuencia (k1) y normalización por longitud
 *     (b). La v1 sumaba IDF y dividía por 3 — eso premia las líneas largas y no
 *     satura, que son justo los dos defectos que BM25 existe para corregir.
 *
 *   · Contra la PREGUNTA VIVA, no contra la tarea inicial. La v1 puntuaba sobre
 *     todo contra el primer mensaje. Lo relevante cambia en cada turno.
 *
 *   · Indexar al ESCRIBIR, no al leer. Los embeddings se cachean por contenido,
 *     así que una línea se codifica una vez en toda la sesión. Sin eso el coste
 *     crece con el cuadrado de los turnos.
 *
 *   · Degradación limpia: sin función de embeddings, esto es BM25 solo — que ya
 *     es F1 23,59 frente al 6,07 de la v1. Lo semántico suma, no es requisito.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REFERENCIAS
 *
 *   BM25 (Okapi BM25) — Robertson, Walker, Jones, Hancock-Beaulieu & Gatford,
 *     «Okapi at TREC-3», TREC-3, 1994. Formulacion moderna y justificacion de
 *     k1 / b: Robertson & Zaragoza, «The Probabilistic Relevance Framework:
 *     BM25 and Beyond», Foundations and Trends in IR 3(4), 2009.
 *     https://doi.org/10.1561/1500000019
 *
 *   IDF — Sparck Jones, «A statistical interpretation of term specificity and
 *     its application in retrieval», Journal of Documentation 28(1), 1972.
 *     El origen de la idea que sostiene todo esto: lo raro informa.
 *
 *   RRF (fusion por rangos reciprocos) — Cormack, Clarke & Buettcher,
 *     «Reciprocal Rank Fusion outperforms Condorcet and individual Rank
 *     Learning Methods», SIGIR 2009. https://doi.org/10.1145/1571941.1572114
 *
 *   MMR (relevancia marginal maxima) — Carbonell & Goldstein, «The use of MMR,
 *     diversity-based reranking for reordering documents and producing
 *     summaries», SIGIR 1998. https://doi.org/10.1145/290941.291025
 *
 *   Sumideros de atencion (por que la CABECERA se protege sin puntuar) —
 *     Xiao, Tian, Chen, Han & Lewis, «Efficient Streaming Language Models with
 *     Attention Sinks», ICLR 2024. https://arxiv.org/abs/2309.17453
 *
 *   Contraste con lo que se publica hoy en compresion de KV, donde el
 *   solapamiento lexico aparece solo como bandera BINARIA sobre un ranking que
 *   sigue siendo de atencion: CodeComp, «Structural KV Cache Compression for
 *   Agentic Coding», 2026, §4.4. https://arxiv.org/abs/2604.10235
 *     -> nuestro margen medido frente a esa regla binaria: F1 23,59 vs 8,03;
 *        y quitar la IDF cuesta -3,25 F1, o sea que la gradacion hace trabajo.
 *
 * No usa APIs de Node → cargable en el navegador como módulo ES.
 */

// ── tokens ──────────────────────────────────────────────────────────────────
function estimateTokens(s) {
  if (!s) return 0;
  const pieces = (s.match(/\w+|[^\w\s]/g) || []).length;
  return Math.max(Math.ceil(pieces * 1.25), Math.ceil(s.length / 4));
}
function truncateToTokens(s, maxTok) {
  if (estimateTokens(s) <= maxTok) return s;
  const keepChars = Math.max(20, Math.floor(maxTok * 4 * 0.5));
  const head = s.slice(0, keepChars), tail = s.slice(-keepChars);
  const cutTok = estimateTokens(s) - estimateTokens(head) - estimateTokens(tail);
  return `${head} [...${cutTok}t cut...] ${tail}`;
}

// ── términos ────────────────────────────────────────────────────────────────
// Sin lista de parada: la IDF endógena (más abajo) se encarga. Se admiten tokens
// de 2 caracteres porque en código los identificadores cortos existen y a veces
// son exactamente lo que se busca (`fs`, `db`, `id`).
function terms(s) {
  return (s.toLowerCase().match(/[a-z_][\w./-]{1,}|\d{2,}/g) || []);
}

/**
 * Índice BM25 (Okapi BM25 — Robertson et al., TREC-3 1994; formulación moderna
 * en Robertson & Zaragoza 2009) sobre un conjunto de documentos: aquí, las
 * líneas del historial.
 * La IDF sale del PROPIO corpus → los tokens ubicuos (`the`, `para`, `const`,
 * la puntuación de formato) caen a peso ~0 sin que nadie los liste.
 */
function buildBM25(docs, opts) {
  const K1 = (opts && opts.k1) != null ? opts.k1 : 1.2;
  const B = (opts && opts.b) != null ? opts.b : 0.75;
  const N = docs.length || 1;
  const df = new Map();
  const tfs = new Array(docs.length);
  let totalLen = 0;
  for (let i = 0; i < docs.length; i++) {
    const t = terms(docs[i]);
    const tf = new Map();
    for (const x of t) tf.set(x, (tf.get(x) || 0) + 1);
    tfs[i] = tf;
    totalLen += t.length;
    for (const x of tf.keys()) df.set(x, (df.get(x) || 0) + 1);
  }
  const avgdl = totalLen / N || 1;
  // IDF de Robertson, con el suelo habitual para que un término presente en
  // más de la mitad del corpus no reste.
  const idf = (t) => {
    const n = df.get(t) || 0;
    return Math.max(Math.log(1 + (N - n + 0.5) / (n + 0.5)), 1e-6);
  };
  const scoreDoc = (i, queryTerms) => {
    const tf = tfs[i]; if (!tf || !tf.size) return 0;
    let dl = 0; for (const c of tf.values()) dl += c;
    let s = 0;
    for (const q of queryTerms) {
      const f = tf.get(q); if (!f) continue;
      s += idf(q) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * dl / avgdl));
    }
    return s;
  };
  return { idf, scoreDoc, df, N, avgdl };
}

// ── similitud (dedup + MMR + coseno semántico) ──────────────────────────────
function simTokens(s) { return new Set((s.toLowerCase().match(/[a-z0-9_./-]{2,}/g) || [])); }
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (big.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? d / Math.sqrt(na * nb) : 0;
}
function dedupKey(s) {
  return s.replace(/^\s*\d+→/, '').replace(/^\s*\d+:\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Fusión por rangos recíprocos (RRF).
 * Entrada: varias listas de ids ORDENADAS de más a menos relevante.
 * Salida: Map id → puntuación fusionada.
 *
 * Se fusionan POSICIONES, no puntuaciones, así que no hay que normalizar entre
 * una escala BM25 y un coseno. Es lo que midió mejor (0,706 vs 0,685).
 */
function rrfFuse(rankings, k = 60) {
  const out = new Map();
  for (const list of rankings) {
    for (let r = 0; r < list.length; r++) {
      const id = list[r];
      out.set(id, (out.get(id) || 0) + 1 / (k + r + 1));
    }
  }
  return out;
}

const DEFAULTS = {
  // — recuperación —
  BM25_K1: 1.2,
  BM25_B: 0.75,
  RRF_K: 60,
  SEMANTIC: true,         // usar embeddings si se proporciona `embed`
  SEM_BUDGET: 400,        // nº máximo de bloques a codificar (acota el coste;
                          // el TAMAÑO de bloque sale de aquí, no al revés)
  RECENCY_WEIGHT: 0.15,   // prior suave, NO una dimensión de contenido
  // — redundancia —
  MMR: true,
  MMR_LAMBDA: null,       // null = medido del historial (ver autotune)
  MMR_CAND: null,         // null = derivado del presupuesto
  DEDUP: true,
  PIN_QUERY_TERMS: true,  // lo que la pregunta nombra no se desaloja jamás
  PIN_MAX: 40,
  // — presupuesto —
  ELASTIC: true,          // no rellenar con lo irrelevante (ver selectAndEmit)
  TAIL_MIN_FRAC: 0.10,    // SUELO garantizado para los ultimos turnos
  HEAD_FRAC: 0.05,        // reserva para los PRIMEROS mensajes, sin puntuar
                          // (solo bajo presión — ver autotune)
  RECENT: 6,
  RECENT_FRAC: null,      // null = derivado de la presión de compresión
  MAX_MSG_CHARS: 12000,
  PER_LINE_CAP_FRAC: 0.5,
  TOOL_PREFIXES: ['[resultado', '[Tool result]:'],
  // — adaptación —
  AUTO: true,             // derivar las perillas de lo medido en ESTE historial
  AUTO_MIN_PRESSURE: 0.35,
  AUTO_MAX_PRESSURE: 0.80,
  AUTO_RECENCY_PRESSURE: 0.25,   // por debajo de esto, la recencia desempata
};

/**
 * AUTOAJUSTE — las perillas salen de lo que se mide, no de constantes.
 *
 * Un λ=0.5 fijo o un RECENT_FRAC=0.55 fijo son magia escrita a mano: la misma
 * enfermedad que las heurísticas, un piso más arriba. Aquí cada perilla se
 * deriva de una propiedad observable del historial concreto que toca empaquetar.
 *
 * Importa sobre todo en CONTEXTO LARGO, que es el caso real: la presión de
 * compresión de una sesión de 200k tokens contra un presupuesto de 32k no se
 * parece en nada a la de una de 5k contra 3k, y la misma constante no puede
 * servir para las dos.
 */
function autotune(historyTok, budgetTok, O) {
  // Presión: qué fracción del historial cabe. 1 = cabe entero, →0 = agobio.
  const pressure = Math.max(0, Math.min(1, budgetTok / (historyTok || 1)));

  // Reserva de recientes. Con el presupuesto holgado, conservar los últimos
  // turnos literales sale barato. Con agobio hay que dejarle sitio a la
  // BÚSQUEDA: si los recientes se comen el presupuesto, no queda hueco para
  // traer la línea de hace treinta turnos que es justo la que se pregunta.
  const recentFrac = O.RECENT_FRAC != null ? O.RECENT_FRAC
    : O.AUTO_MIN_PRESSURE + (O.AUTO_MAX_PRESSURE - O.AUTO_MIN_PRESSURE) * pressure;

  // RECENCIA — medida en un barrido de presupuestos:
  //
  //     contexto/presupuesto   con recencia   sin recencia
  //            15,8×              67,9 %         59,3 %     ← ayuda +8,6
  //             3,0×              75,7 %         83,6 %     ← ESTORBA −7,9
  //             1,5×              91,8 %         94,6 %     ← ESTORBA −2,8
  //
  // Escalar el peso con la presión NO sirve: medido, con 0.048 o con 0.15 se
  // decide exactamente lo mismo, y solo cambia algo al ponerlo a cero. Como
  // sumando, la recencia es binaria — cualquier valor > 0 basta para que una
  // línea nueva e irrelevante desplace a una relevante y antigua.
  //
  // La regla correcta no es un peso: es un DESEMPATE. Una línea con relevancia
  // gana SIEMPRE a una sin ella; entre las relevantes manda BM25; entre las que
  // no lo son —que con agobio son casi todas, y por eso ahí ayudaba— manda la
  // recencia. Una sola regla, sin perilla que calibrar, y sirve en los dos
  // extremos del barrido.
  // Y el barrido dice algo más fino todavía: como DESEMPATE la recencia suma
  // +2,9 con agobio (15,8×) pero RESTA −7,9 con holgura (3,0×). Con sitio de
  // sobra, el orden del documento gana — mantiene juntos los tramos, y un
  // fragmento contiguo vale más que líneas nuevas sueltas. Con agobio no hay
  // tramos que mantener y lo nuevo es la única apuesta que queda.
  //
  // Así que no es un peso ni un desempate universal: es un INTERRUPTOR, y el
  // barrido dice dónde va. Umbral medido entre 0,17 (neutral) y 0,34 (dañino).
  const recencyTiebreak = pressure < O.AUTO_RECENCY_PRESSURE;
  // La cabecera va SIEMPRE, sin puerta. Antes se apagaba con holgura porque
  // "ahí el encargo sobrevive solo" — y era cierto, pero solo porque
  // rellenábamos el presupuesto hasta el borde con todo lo que cupiera. Al
  // añadir la ventana elástica y dejar de rellenar, el encargo se cayó del
  // 100 % al 0 % a presupuesto 16.000. Su supervivencia era un accidente del
  // relleno, no una propiedad de tener sitio. Cuesta un 5 % y ya está medido
  // que no resta: incondicional.
  const headOn = true;
  const recencyWeight = O.RECENCY_WEIGHT * (1 - pressure);   // solo informativo

  return { pressure, recentFrac, recencyWeight, recencyTiebreak, headOn };
}

/**
 * λ de MMR medido, no supuesto: se estima la redundancia REAL del material.
 * Un historial de resultados de herramienta casi idénticos necesita penalizar
 * fuerte; una conversación donde cada línea es distinta, casi nada — y ahí un
 * λ alto solo destruye información buena.
 */
function measureRedundancy(items, sample = 240) {
  const n = items.length;
  if (n < 4) return 0;
  const step = Math.max(1, Math.floor(n / sample));
  const picked = [];
  for (let i = 0; i < n; i += step) picked.push(simTokens(items[i].line));
  let sum = 0, pairs = 0;
  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < Math.min(i + 8, picked.length); j++) { sum += jaccard(picked[i], picked[j]); pairs++; }
  }
  return pairs ? sum / pairs : 0;
}

function clampMsg(m, maxChars) {
  const c = m.content || '';
  if (c.length <= maxChars) return m;
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head - 40;
  return { ...m, content: c.slice(0, head) + `\n… [recortado ${c.length - maxChars} caracteres] …\n` + c.slice(-tail) };
}

/**
 * Caché de embeddings por contenido — "pensar al escribir".
 * Una línea vista una vez no se vuelve a codificar en toda la sesión, ni aunque
 * reaparezca veinte turnos después. Sin esto el coste crece con el cuadrado de
 * los turnos, que es exactamente el problema que tenía la v1 al recalcular la
 * IDF sobre todo el historial en cada mensaje.
 */
function createEmbedCache(embed, opts) {
  const max = (opts && opts.max) || 4000;
  const store = new Map();
  return {
    size: () => store.size,
    async encode(texts) {
      const miss = [];
      for (const t of texts) if (!store.has(t)) miss.push(t);
      if (miss.length) {
        const vecs = await embed(miss);
        for (let i = 0; i < miss.length; i++) store.set(miss[i], vecs[i]);
        while (store.size > max) store.delete(store.keys().next().value);
      }
      return texts.map(t => store.get(t));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Núcleo compartido: prepara el estado común a la vía léxica y a la híbrida.
// ─────────────────────────────────────────────────────────────────────────────
function prepare(history, budgetTok, O) {
  const msgTok = (m) => estimateTokens(m.content) + 4;

  // La reserva de recientes sale de la PRESIÓN de compresión medida en este
  // historial, no de una constante. En contexto largo esto es lo que decide:
  // con 200k de historial y 32k de presupuesto, gastar el 55 % en los últimos
  // seis turnos deja sin sitio a la búsqueda, que es justo lo que hace falta
  // cuando la respuesta está a treinta turnos de distancia.
  const historyTok = history.reduce((s, m) => s + msgTok(m), 0);
  const tuned = O.AUTO ? autotune(historyTok, budgetTok, O)
                       : { pressure: null,
                           recentFrac: O.RECENT_FRAC != null ? O.RECENT_FRAC : 0.55,
                           recencyWeight: O.RECENCY_WEIGHT,
                           recencyTiebreak: O.RECENCY_WEIGHT > 0,
                           headOn: O.HEAD_FRAC > 0 };
  O = { ...O, _pressure: tuned.pressure, _historyTok: historyTok,
        RECENCY_WEIGHT: tuned.recencyWeight, _recTie: tuned.recencyTiebreak };

  // Los turnos recientes se conservan literales, pero SOLO mientras quepan en su
  // reserva. Un RECENT fijo puede comerse el presupuesto entero él solo (una
  // página de 100 líneas son ~1,5k tokens) y devolver varias veces lo pedido.
  // ── RESERVA DE COLA — es un SUELO, no solo un techo ────────────────────────
  // La version anterior paraba en el primer mensaje que no cabia. Eso convierte
  // la reserva en un tope y no en una garantia: medido, con presupuesto 3.000 la
  // cola se quedaba con el 3-5 % en vez del ~38 % reservado, porque UN resultado
  // de herramienta grande en la penultima posicion bloqueaba todo lo anterior.
  // Los ultimos turnos son lo que el modelo necesita si o si para saber donde
  // esta, y eso no puede depender de que el turno de antes fuera voluminoso.
  //
  // Ahora, mientras no se alcance el suelo, el mensaje que no cabe se TRUNCA por
  // el medio (cabeza y cola, que es lo que importa de un resultado) en vez de
  // descartarse entero. Por encima del suelo se vuelve al comportamiento de
  // siempre: se para y el resto compite por relevancia.
  const reserve = Math.floor(budgetTok * tuned.recentFrac);
  const floorTok = Math.floor(budgetTok * O.TAIL_MIN_FRAC);
  const recent = []; let used = 0;
  for (let i = history.length - 1, k = 0; i >= 0 && k < O.RECENT; i--, k++) {
    const m = clampMsg(history[i], O.MAX_MSG_CHARS);
    const t = msgTok(m);
    if (used + t <= reserve) { recent.unshift(m); used += t; continue; }
    if (used >= floorTok || recent.length >= 1 && used + t > reserve && used >= floorTok) break;
    // aun por debajo del suelo: cabe recortado, no se tira
    const room = Math.max(40, Math.min(reserve, floorTok) - used - 4);
    if (room < 40) break;
    recent.unshift({ ...m, content: truncateToTokens(m.content, room) });
    used += room + 4;
    if (used >= floorTok) break;
  }
  let old = history.slice(0, history.length - recent.length);
  if (!old.length || used >= budgetTok) return { done: true, recent, old, used, head: [] };

  // ── RESERVA DE CABECERA ────────────────────────────────────────────────────
  // Los PRIMEROS mensajes se conservan literales y SIN puntuar, igual que los
  // últimos. No es simetría estética: el arranque lleva la tarea, el encargo,
  // las rutas y las restricciones — cosas que el resto de la sesión da por
  // sabidas y que por eso mismo BM25 no tiene por qué puntuar alto (si nadie
  // las repite, no hay solape con la pregunta de ahora).
  //
  // Y hay respaldo externo: es el resultado central de StreamingLLM — los
  // primeros tokens actúan de SUMIDERO de atención y absorben el 45-55 % de la
  // masa; tirarlos degrada al modelo mucho más de lo que su "relevancia"
  // sugiere. Un recuperador puro no puede ver eso, porque no es una propiedad
  // del texto sino de cómo el modelo lo usa.
  //
  // Por eso va sin condición y acotado: ~10 % del presupuesto. Barato de sobra
  // si sirve, y con un techo duro para que no compita con la búsqueda.
  // Y va con la MISMA puerta que la recencia, porque mide lo mismo. Sonda que
  // pregunta por el encargo original a mitad de sesión, 5 semillas:
  //
  //     presupuesto 3.000 (el que usa la app):  sin reserva 0/5  ·  con 5 % 5/5
  //     presupuesto 16.000 (holgura):           sin reserva 5/5  ·  con 5 % 5/5
  //
  // Con agobio el encargo se pierde SIEMPRE, y es lo único que el agente no
  // puede reconstruir mirando el código. Con holgura sobrevive solo, así que
  // ahí la reserva es coste puro: medida en el banco de hechos de media sesión
  // costaba −15,1 puntos a 16.000 sin ganar nada. Por eso se apaga.
  const headReserve = tuned.headOn ? Math.floor(budgetTok * O.HEAD_FRAC) : 0;
  const head = []; let headUsed = 0;
  for (let i = 0; i < old.length; i++) {
    const m = clampMsg(old[i], O.MAX_MSG_CHARS);
    const t = msgTok(m);
    if (headUsed + t > headReserve) break;
    head.push(m); headUsed += t;
  }
  old = old.slice(head.length);
  used += headUsed;
  if (!old.length || used >= budgetTok) return { done: true, recent, old, used, head };

  // La PREGUNTA VIVA: el último turno de usuario que no sea un resultado de
  // herramienta. Esto es lo que se puntúa. No la tarea inicial.
  let query = '';
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'user' && !O.TOOL_PREFIXES.some(p => m.content.startsWith(p))) { query = m.content; break; }
  }

  const items = [];
  old.forEach((m, mi) => {
    const lines = m.content.split('\n');
    lines.forEach((line, li) => {
      items.push({ mi, li, line, first: li === 0 });
    });
  });

  // Corpus del índice = las propias líneas. La IDF sale de aquí: endógena.
  const bm25 = buildBM25(items.map(it => it.line), { k1: O.BM25_K1, b: O.BM25_B });
  const qTerms = [...new Set(terms(query))];

  const nMsg = Math.max(old.length - 1, 1);
  for (let i = 0; i < items.length; i++) {
    items[i].bm = bm25.scoreDoc(i, qTerms);
    items[i].rec = items[i].mi / nMsg;
    items[i].qHit = items[i].bm > 0;
  }
  return { done: false, recent, old, used, items, query, qTerms, bm25, nMsg, O, head };
}

/** Aplica dedup, selección con presupuesto global, MMR y emisión. */
function selectAndEmit(ctx, budgetTok, O) {
  const { recent, old, items } = ctx;
  const head = ctx.head || [];
  let used = ctx.used;

  // dedup exacto / casi exacto en TODO el historial
  // El dedup ve TAMBIÉN la cabecera: lo que ya viaja literal ahí no se vuelve a
  // pagar más abajo. Reservar sitio y luego repetir el mismo contenido sería
  // gastar dos veces el mismo presupuesto.
  let deduped = 0;
  if (O.DEDUP) {
    const bestByKey = new Map();
    for (const m of head) for (const line of (m.content || '').split('\n')) {
      const k = dedupKey(line);
      if (k) bestByKey.set(k, { score: Infinity, dup: false });
    }
    for (const it of items) {
      if (it.first) continue;
      const k = dedupKey(it.line);
      if (!k) continue;
      const prev = bestByKey.get(k);
      if (prev === undefined) { bestByKey.set(k, it); continue; }
      const loser = it.score > prev.score ? prev : it;
      const winner = it.score > prev.score ? it : prev;
      loser.dup = true; deduped++;
      bestByKey.set(k, winner);
    }
  }

  const perLineCap = Math.max(40, Math.floor((budgetTok - used) * O.PER_LINE_CAP_FRAC));
  const keep = new Set();
  const cost = (it) => Math.min(estimateTokens(it.line), perLineCap) + 1;
  const idOf = (it) => it.mi * 100000 + it.li;

  // Lo que la pregunta nombra explícitamente nunca se desaloja. Acotado por
  // PIN_MAX para que no se coma el presupuesto.
  let pinned = 0;
  if (O.PIN_QUERY_TERMS) {
    const cands = items.filter(it => it.qHit && !it.dup).sort((a, b) => b.score - a.score).slice(0, O.PIN_MAX);
    for (const it of cands) {
      const c = cost(it);
      if (used + c > budgetTok) break;
      keep.add(idOf(it)); used += c; pinned++; it.pin = true;
    }
  }

  const pool = items.filter(it => !it.dup && !keep.has(idOf(it)));
  pool.sort((a, b) => b.score - a.score);

  // λ MEDIDO, no supuesto: si el material es muy redundante (páginas de
  // resultados casi idénticas) hay que penalizar fuerte; si cada línea es
  // distinta, penalizar apenas — ahí un λ alto solo tira información buena.
  // MMR_CAND se escala con lo que cabe: en contexto largo, 600 candidatos
  // fijos dejaban fuera la mayor parte del material antes de mirarlo.
  const lambda = O.MMR_LAMBDA != null ? O.MMR_LAMBDA
    : Math.max(0.15, Math.min(0.8, 2 * measureRedundancy(pool)));
  const cands = O.MMR_CAND != null ? O.MMR_CAND
    : Math.max(400, Math.min(8000, Math.round(budgetTok / 6)));
  if (O.MMR && lambda > 0) {
    const cand = pool.slice(0, cands);
    const tok = new Map(); for (const it of cand) tok.set(idOf(it), simTokens(it.line));
    const maxSim = new Map(cand.map(it => [idOf(it), 0]));
    for (const it of items) if (keep.has(idOf(it))) {
      const ks = simTokens(it.line);
      for (const c of cand) maxSim.set(idOf(c), Math.max(maxSim.get(idOf(c)), jaccard(tok.get(idOf(c)), ks)));
    }
    const remaining = new Set(cand.map(idOf));
    const byId = new Map(cand.map(it => [idOf(it), it]));
    while (remaining.size) {
      let best = null, bestVal = -Infinity;
      for (const id of remaining) {
        const v = byId.get(id).score - lambda * maxSim.get(id);
        if (v > bestVal) { bestVal = v; best = id; }
      }
      remaining.delete(best);
      const it = byId.get(best), c = cost(it);
      // La ventana elástica manda TAMBIÉN aquí. El MMR ordena por diversidad
      // DENTRO de lo relevante; no es una excusa para colar relleno. Sin esta
      // línea la puerta no servía de nada: el material sin relevancia entraba
      // por este bucle antes de llegar al relleno final, y la medida salía
      // idéntica con y sin ella.
      if (O.ELASTIC && it.score < 10) continue;
      if (used + c > budgetTok) continue;
      keep.add(best); used += c;
      const bs = tok.get(best);
      for (const id of remaining) maxSim.set(id, Math.max(maxSim.get(id), jaccard(tok.get(id), bs)));
      if (used >= budgetTok) break;
    }
  }
  // ── VENTANA ELÁSTICA ───────────────────────────────────────────────────────
  // El presupuesto es un TECHO, no una cuota que haya que agotar. Medido, sin
  // esto se iba en líneas sin una sola palabra en común con la pregunta el
  // 38 % del presupuesto a 3.000 y el 56 % a 16.000 — más de la mitad, relleno.
  //
  // Y eso no es inofensivo: nuestro propio resultado dice que recuperar bien
  // BATE al contexto completo (F1 28,09 contra 22,56 del historial entero), o
  // sea que lo irrelevante no es lastre neutro, DISTRAE. Rellenar hasta el
  // borde con material de relevancia cero es reintroducir a mano justo aquello
  // que la compresión venía a quitar.
  //
  // Así que la ventana se dimensiona con la EVIDENCIA: se para cuando se acaba
  // lo relevante (estrato ≥ 10) en vez de cuando se acaban los tokens. Es el
  // umbral de corte por puntuación de toda la vida en recuperación; la cabecera
  // y la cola siguen siendo incondicionales, que para eso son reservas.
  //
  // ⚠️ NO es un regalo, es un INTERCAMBIO, y el banco solo ve un lado. Medido
  // (8 semillas, presencia del dato — NO calidad de la respuesta):
  //
  //     presupuesto   ahorro de tokens   coste en hechos
  //        3.000           −1 %              ±0,0     ← régimen de la app
  //        8.000            2 %              ±0,0
  //       16.000           26 %              −1,8
  //       32.000           60 %              −8,9
  //
  // Con el presupuesto que usan los productos (3.000 y 5.000) sale GRATIS: ahí
  // hay más material relevante que sitio, y la puerta no llega a dispararse.
  // Con holgura canja recall por tokens, y si eso compensa depende de algo que
  // ESTE banco no puede ver: mide si el dato está presente, no si la respuesta
  // sale mejor. La hipótesis a favor es nuestro propio titular —recuperar bien
  // BATE al contexto completo, luego lo irrelevante resta— pero mientras no se
  // corra el banco de F1 con un modelo respondiendo, el −8,9 a 32.000 es un
  // número real y la ganancia es una conjetura. Queda dicho, no disimulado.
  const RELEVANT = 10;
  for (const it of pool) {
    const id = idOf(it);
    if (keep.has(id)) continue;
    if (O.ELASTIC && it.score < RELEVANT) break;   // se acabó la evidencia
    const c = cost(it);
    if (used + c > budgetTok) continue;
    keep.add(id); used += c;
    if (used >= budgetTok) break;
  }

  // Contrato de presupuesto: el coste por línea ignora la sobrecarga por mensaje
  // y los marcadores de omisión, así que se mide el tamaño realmente emitido y se
  // devuelven las líneas peor puntuadas hasta que la salida cabe de verdad.
  const msgTok = (m) => estimateTokens(m.content) + 4;
  const emit = () => {
    let t = recent.reduce((s, m) => s + msgTok(m), 0) + head.reduce((s, m) => s + msgTok(m), 0);
    let open = 0;
    old.forEach((m, mi) => {
      const lines = m.content.split('\n');
      let any = false, run = 0, sub = 0;
      lines.forEach((line, li) => {
        if (keep.has(mi * 100000 + li)) {
          if (run) { sub += 8; run = 0; }
          sub += Math.min(estimateTokens(line), perLineCap); any = true;
        } else run++;
      });
      if (any) { if (run) sub += 8; t += sub + 4; open++; }
    });
    if (open < old.length) t += 12;
    return t;
  };
  let realized = emit();
  if (realized > budgetTok) {
    const kept = items.filter(it => keep.has(idOf(it)) && !it.pin).sort((a, b) => a.score - b.score);
    let p = 0;
    while (realized > budgetTok && p < kept.length) {
      const over = realized - budgetTok; let freed = 0;
      while (p < kept.length && freed < over) {
        const it = kept[p++];
        keep.delete(idOf(it));
        freed += Math.min(estimateTokens(it.line), perLineCap);
      }
      realized = emit();
    }
  }

  const packed = [];
  let droppedMsgs = 0;
  old.forEach((m, mi) => {
    const lines = m.content.split('\n');
    const out = []; let skipped = 0;
    lines.forEach((line, li) => {
      if (keep.has(mi * 100000 + li)) {
        if (skipped) { out.push(`  […${skipped} líneas omitidas…]`); skipped = 0; }
        out.push(truncateToTokens(line, perLineCap));
      } else skipped++;
    });
    if (skipped && out.length) out.push(`  […${skipped} líneas omitidas…]`);
    if (!out.length) { droppedMsgs++; return; }
    packed.push({ role: m.role, content: out.join('\n') });
  });
  if (droppedMsgs) packed.push({ role: 'user', content: `[…${droppedMsgs} mensajes antiguos omitidos…]` });

  return { messages: [...head, ...packed, ...recent], stats: { used, deduped, pinned, droppedMsgs, realized, head: head.length } };
}

/**
 * Empaqueta el historial en `budgetTok` tokens — vía LÉXICA (síncrona).
 * BM25 contra la pregunta viva, IDF endógena, sin heurísticas.
 * Medido: 0,598 de recall de evidencia (v1 con heurísticas: 0,020).
 */
function packHistoryACER(history, budgetTok, options) {
  const O = { ...DEFAULTS, ...(options || {}) };
  if (!history.length) return { messages: history, stats: {} };
  const ctx = prepare(history, budgetTok, O);
  if (ctx.done) return { messages: [...(ctx.head || []), ...ctx.recent], stats: { used: ctx.used, dropped: ctx.old.length, head: (ctx.head || []).length } };

  // Normalización a rango para poder mezclar con la recencia sin que BM25,
  // que no está acotado, se lleve todo por delante.
  const Oa = ctx.O || O;                       // perillas ya autoajustadas
  const maxBm = ctx.items.reduce((m, it) => Math.max(m, it.bm), 0) || 1;
  for (const it of ctx.items) {
    // Dos estratos separados por 10 — más de lo que la penalización MMR (≤0.8)
    // puede recorrer, así que la diversidad reordena DENTRO de un estrato pero
    // nunca cuela una línea irrelevante por delante de una relevante.
    it.score = it.bm > 0 ? 10 + it.bm / maxBm : (Oa._recTie ? it.rec : 0);
    if (it.first) it.score = Math.max(it.score, 0.5);  // cabecera de procedencia
  }
  const r = selectAndEmit(ctx, budgetTok, Oa);
  r.stats.mode = 'lexical';
  return r;
}

/**
 * Empaqueta el historial — vía HÍBRIDA (asíncrona).
 * BM25 + embeddings fusionados por RANGOS. Medido: 0,706.
 *
 * `embed` recibe un array de textos y devuelve un array de vectores. Si no se
 * pasa, esto degrada a `packHistoryACER` sin avisar y sin romper nada.
 * `cache` (opcional, de createEmbedCache) hace que cada texto se codifique una
 * sola vez en toda la sesión.
 */
async function packHistoryACERHybrid(history, budgetTok, options) {
  const O = { ...DEFAULTS, ...(options || {}) };
  const embed = O.embed;
  if (!history.length) return { messages: history, stats: {} };
  if (!embed || !O.SEMANTIC) return packHistoryACER(history, budgetTok, options);

  const ctx = prepare(history, budgetTok, O);
  if (ctx.done) return { messages: [...(ctx.head || []), ...ctx.recent], stats: { used: ctx.used, dropped: ctx.old.length, head: (ctx.head || []).length } };

  // Lado semántico por BLOQUES: codificar línea a línea es prohibitivo y la
  // señal sobrevive al troceado (medido ~73 % al pasar a frontera arbitraria).
  // El TAMAÑO de bloque sale del presupuesto de codificación, no al revés: se
  // acota el número de llamadas al modelo de embeddings y el bloque crece con
  // el historial. Con contexto largo, un bloque fijo de 5 líneas dispararía
  // miles de codificaciones por turno.
  const SB = Math.max(1, Math.ceil(ctx.items.length / Math.max(1, O.SEM_BUDGET)));
  const blocks = [];
  for (let i = 0; i < ctx.items.length; i += SB) {
    blocks.push({ from: i, text: ctx.items.slice(i, i + SB).map(x => x.line).join('\n').slice(0, 4000) });
  }

  let semOk = false;
  try {
    const cache = O.cache || createEmbedCache(embed);
    const [qv] = await cache.encode([ctx.query.slice(0, 2000)]);
    const bv = await cache.encode(blocks.map(b => b.text));
    for (let b = 0; b < blocks.length; b++) {
      const s = cosine(qv, bv[b]);
      for (let i = blocks[b].from; i < Math.min(blocks[b].from + SB, ctx.items.length); i++) {
        ctx.items[i].sem = s;
      }
    }
    semOk = true;
  } catch (e) {
    // Si los embeddings fallan (modelo no cargado, sin red, cuota), NO se cae:
    // se sigue por la vía léxica, que ya es 30× mejor que la v1.
    semOk = false;
  }

  if (!semOk) return packHistoryACER(history, budgetTok, options);

  // Fusión por rangos: dos listas ordenadas, se fusionan POSICIONES.
  const idOf = (it) => it.mi * 100000 + it.li;
  const byLex = [...ctx.items].sort((a, b) => b.bm - a.bm).map(idOf);
  const bySem = [...ctx.items].sort((a, b) => (b.sem || 0) - (a.sem || 0)).map(idOf);
  const fused = rrfFuse([byLex, bySem], O.RRF_K);
  const maxF = Math.max(...fused.values()) || 1;

  const Oa = ctx.O || O;                       // perillas ya autoajustadas
  for (const it of ctx.items) {
    const rel = (it.bm > 0) || ((it.sem || 0) > 0);
    it.score = rel ? 10 + (fused.get(idOf(it)) || 0) / maxF : (Oa._recTie ? it.rec : 0);
    if (it.first) it.score = Math.max(it.score, 0.5);
  }
  const r = selectAndEmit(ctx, budgetTok, Oa);
  r.stats.mode = 'hybrid';
  r.stats.blocks = blocks.length;
  return r;
}

/**
 * @deprecated Reglas escritas a mano de la v1. Ya NO participan en la puntuación:
 * medido, hacían que el motor rindiera por debajo de no comprimir nada. Se
 * mantiene exportada solo para no romper importaciones antiguas.
 */
function classifyLine(s) {
  const sl = (s || '').toLowerCase();
  if (!s || !s.trim()) return 0.0;
  if (['error', 'failed', 'traceback', 'exception'].some(p => sl.includes(p))) return 0.95;
  return 0.5;
}

/** @deprecated Sustituida por buildBM25 (IDF endógena, saturación y normalización). */
function makeIdf(docs) {
  const b = buildBM25(docs);
  return b.idf;
}

export {
  packHistoryACER, packHistoryACERHybrid, DEFAULTS,
  estimateTokens, truncateToTokens,
  terms, buildBM25, rrfFuse, cosine, createEmbedCache,
  simTokens, jaccard, dedupKey, clampMsg,
  classifyLine, makeIdf,
};

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
 * LO QUE NO ES UN PROBLEMA DE RECUPERACIÓN
 *
 * Dos fallos no los arregla ninguna perilla de BM25, porque no son de recuperar:
 *
 *   · «ayer» escrito en el turno 3 es MENTIRA en el turno 40. La línea se
 *     recupera perfectamente; lo que lleva dentro es falso. Se resuelve al
 *     ESCRIBIR, anotando la fecha absoluta del turno junto al original (ver
 *     annotateDates). Sonda propia —el banco de siempre no puede verlo, sus
 *     preguntas son por identificadores— 32 sesiones reales, la frase colocada
 *     en cuatro posiciones distintas de la sesión:
 *
 *         la línea se recupera ........................ 100 %
 *         la FECHA está en el contexto, sin anotar ....   0 %
 *         la FECHA está en el contexto, anotada ....... 100 %
 *         fecha FALSA (si se usara «ahora») ...........   0 %
 *
 *     Coste: +7 tokens sobre 2.223 (0,3 %). Recuperación perfecta y respuesta
 *     imposible es exactamente el caso de markSuperseded, un piso más abajo.
 *
 *   · «¿cuántos ficheros has tocado?» no está en ninguna línea: está repartida
 *     en cuarenta. Ningún top-k la encuentra POR CONSTRUCCIÓN — no es que
 *     puntúe mal, es que no existe la línea que buscar. Se resuelve contando al
 *     escribir (ver buildLedger / renderCard). Misma sonda propia, 32 sesiones
 *     con 6 ficheros editados de verdad, presupuesto 3.000:
 *
 *                                        sin tarjeta   con tarjeta
 *         el RECUENTO está en el contexto      0 %        100 %
 *         cobertura de los ficheros editados  58,9 %       90,6 %
 *
 *     ⚠️ Y NO es gratis: en el banco de hechos de siempre (32 sesiones reales,
 *     8 semillas × 4 proyectos) cuesta −1,1 puntos a presupuesto 3.000 (65,7 %
 *     → 64,6 %) y ±0,0 a 16.000. Con el presupuesto que usan los productos, el
 *     recuento se paga con recall. Por eso va TRAS BANDERA y apagada: quien
 *     pregunte «cuántos ficheros» la quiere; quien no, está pagando por nada.
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
  // Emite el token COMPUESTO y además sus PARTES.
  //
  // El tokenizador anterior estaba afinado para código y en diálogo perdía:
  //   · exigía empezar por letra → «3pm», «2nd», «5» desaparecían enteros, y en
  //     conversación eso son horas, ordinales y fechas;
  //   · mantenía `process.env.HOME` y `src/utils.js` como UN token, así que una
  //     pregunta por «env» no casaba con la línea que lo contiene.
  //
  // Medido en un banco de diálogo (LoCoMo, 200 preguntas, n=200): cambiar SOLO
  // el tokenizador y dejar todo lo demás igual explicaba 3,5 de los 4,8 puntos
  // que nos separaban de un BM25 con el partidor del banco. No era la política
  // de empaquetado: era el partidor de palabras.
  //
  // La forma compuesta se conserva porque para código ES el identificador —
  // `src/utils.js` casa exacto y puntúa alto — y las partes se añaden para que
  // el emparejamiento parcial también funcione. Se pagan más términos por línea,
  // pero BM25 normaliza por longitud, que para eso está la `b`.
  const out = [];
  const seen = new Set();
  const push = (t) => { if (t.length >= 2 && !seen.has(t)) { seen.add(t); out.push(t); } };
  for (const m of s.toLowerCase().match(/[a-z0-9_][\w./-]*/g) || []) {
    push(m);
    if (/[./-]/.test(m)) for (const part of m.split(/[./-]+/)) push(part);
  }
  return out;
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

/**
 * CADUCIDAD — el mismo problema que ya resolvimos en el vigilante de carpetas,
 * un piso más arriba.
 *
 * Un agente lee `shell.js` en el turno 3 y lo EDITA en el 20. BM25 recupera las
 * dos versiones y la vieja puntúa igual de alto, porque comparte todo el
 * vocabulario con la nueva — de hecho puede ganarle. El modelo ve contenido
 * obsoleto sin ninguna señal de que lo es, y eso no es ineficiencia: es
 * INCORRECCIÓN. Ninguna cantidad de relevancia arregla que el dato sea falso.
 *
 * En el observador de carpetas ya identificábamos el contenido por «nombre +
 * mtime», de modo que volver a guardar invalida lo anterior. Aquí la marca
 * temporal es el turno, y el nombre es el objetivo de la llamada.
 *
 * Se DEGRADA, no se borra — pero con una salvedad medida que conviene no
 * maquillar: preguntando EXPRESAMENTE por el valor anterior, la versión vieja
 * vuelve 0 de 8 veces. Está en el conjunto y no se recupera nunca, porque una
 * vez degradada compite entre cientos de líneas de puntuación cero y quién
 * vuelve de ahí lo decide el pase de diversidad, no la pregunta. ALCANZABLE NO
 * ES RECUPERABLE. La diferencia entre «esto ya no es cierto» y «esto no existió
 * nunca» es real en la estructura de datos y todavía NO lo es en el
 * comportamiento. Recuperar el historial a petición pide otra vía: que la
 * pregunta señale temporalidad y se busque explícitamente en lo caducado.
 *
 * Devuelve un Set con los índices de mensaje cuyo resultado quedó superado.
 */
function markSuperseded(msgs, toolPrefixes) {
  const lastFor = new Map();      // objetivo -> índice del resultado más nuevo
  const targetOf = new Map();     // índice del resultado -> objetivo
  for (let i = 0; i < msgs.length; i++) {
    const c = msgs[i].content || '';
    if (!toolPrefixes.some(p => c.startsWith(p))) continue;
    // el objetivo viene en la llamada del asistente inmediatamente anterior:
    // el resultado no lo lleva, solo dice qué herramienta fue.
    const call = i > 0 ? (msgs[i - 1].content || '') : '';
    const m = call.match(/"tool"\s*:\s*"([^"]+)"[\s\S]{0,200}?"(?:path|file|command)"\s*:\s*"([^"]+)"/);
    if (!m) continue;
    const key = m[1].split('.')[0] + ':' + m[2];   // p.ej. code:vcc/builder.js
    targetOf.set(i, key);
    lastFor.set(key, i);
  }
  const stale = new Set();
  for (const [i, key] of targetOf) if (lastFor.get(key) !== i) stale.add(i);
  return stale;
}

/**
 * FECHAS ABSOLUTAS AL ESCRIBIR — la otra cara de la caducidad.
 *
 * «lo desplegamos ayer», escrito en el turno 3, es una MENTIRA en el turno 40.
 * Y esto BM25 no puede arreglarlo jamás, porque no es un fallo de recuperación:
 * la línea se recupera perfectamente y el dato que lleva es falso. Es el mismo
 * fallo que markSuperseded — relevancia perfecta, contenido incorrecto — solo
 * que aquí lo que caduca no es el fichero, es la palabra.
 *
 * Por eso se resuelve al ESCRIBIR (al indexar), no al leer: en el momento de
 * indexar todavía se sabe cuándo se dijo. Un turno después ya no.
 *
 *   · Se ANOTA junto al original, no se sustituye: «ayer (2026-08-07)».
 *     Reescribir lo que dijo el usuario es peor que anotarlo — si la resolución
 *     se equivoca, con la anotación el modelo todavía ve la frase original y
 *     puede desconfiar; con la sustitución, no.
 *
 *   · La fecha de referencia es la DEL TURNO, no la de ahora: `m.ts` (o time /
 *     timestamp / date / createdAt). Si el mensaje no la lleva se usa `NOW`, y
 *     si tampoco hay `NOW` NO SE ANOTA. Inventar una fecha es exactamente el
 *     fallo que esto viene a quitar, así que el camino por defecto es callarse.
 *
 *   · Precisión honesta: lo que el idioma dice con precisión de DÍA se anota con
 *     un día; lo que dice con precisión de semana o de mes se anota con el rango
 *     de la semana o con el mes. «hace tres semanas (2026-07-13…2026-07-19)» es
 *     verdad; «hace tres semanas (2026-07-16)» sería una precisión inventada.
 *
 *   · ⚠️ NO se tocan bloques de código ni resultados de herramienta. Un
 *     `2026-08-07` dentro de un diff o de un log NO es una referencia temporal,
 *     y anotarlo sería corromper datos. Los `[resultado …]` se saltan enteros y
 *     dentro del texto se saltan las vallas ``` y los tramos entre acentos
 *     graves.
 *
 * Coste: un solo barrido de la expresión combinada por mensaje; si no hay
 * ninguna referencia temporal —el caso normal, y siempre el de una página de
 * código— se sale por ahí sin partir nada.
 */
const ISO_DAY = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ISO_MONTH = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shiftDays = (ref, n) => { const d = new Date(ref.getTime()); d.setDate(d.getDate() + n); return d; };
const shiftMonths = (ref, n) => { const d = new Date(ref.getTime()); d.setDate(1); d.setMonth(d.getMonth() + n); return d; };
// Semana de lunes a domingo (ISO-8601) que contiene `d`.
function weekRange(d) {
  const start = shiftDays(d, -((d.getDay() + 6) % 7));
  return `${ISO_DAY(start)}…${ISO_DAY(shiftDays(start, 6))}`;
}
const WEEKDAY = { domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3, jueves: 4, viernes: 5, sábado: 6, sabado: 6,
                  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
// dir < 0 = la anterior estricta · dir > 0 = la siguiente estricta · dir = 0 =
// la más reciente contando hoy. El bare («el lunes», sin «pasado» ni «que
// viene») usa dir = 0: es AMBIGUO en los dos idiomas, y en una bitácora de
// trabajo la enorme mayoría de las menciones son retrospectivas. Es la única
// regla de aquí que puede equivocarse, y por eso la frase original se conserva.
function weekdayNear(ref, target, dir) {
  const cur = ref.getDay();
  if (dir > 0) { const f = (target - cur + 7) % 7; return shiftDays(ref, f || 7); }
  const b = (cur - target + 7) % 7;
  return shiftDays(ref, -(dir < 0 ? (b || 7) : b));
}
const NUMWORD = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
                  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const numOf = (s) => (/^\d+$/.test(s) ? parseInt(s, 10) : (NUMWORD[s.toLowerCase()] || null));
function shiftUnit(ref, n, unit, sign) {
  if (n == null || n > 500) return null;
  const u = unit.toLowerCase();
  if (u[0] === 'd') return ISO_DAY(shiftDays(ref, sign * n));                       // día(s) / day(s)
  if (u[0] === 's' || u[0] === 'w') return weekRange(shiftDays(ref, sign * 7 * n)); // semana(s) / week(s)
  if (u[0] === 'm') return ISO_MONTH(shiftMonths(ref, sign * n));                   // mes(es) / month(s)
  if (u[0] === 'a' || u[0] === 'y') return String(shiftMonths(ref, sign * 12 * n).getFullYear());
  return null;
}
const N_ = '\\d{1,3}|un[ao]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|an?|one|two|three|four|five|six|seven|eight|nine|ten';
const U_ = 'd[ií]as?|semanas?|mes(?:es)?|años?|anos?|days?|weeks?|months?|years?';
const WD_ = 'lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo';
const WD_EN = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';

// Orden = precedencia: la alternancia de JS se queda con la PRIMERA que encaja
// en cada posición, así que lo específico va antes que lo corto.
const TIME_RULES = [
  // «por la mañana» no es «mañana». Se reconoce a propósito para NO anotarla y,
  // de paso, para que la regla de «mañana» no llegue a verla.
  { p: '\\b(?:por|de|a|en|desde|hasta)\\s+la\\s+mañana\\b|\\b(?:esta|una|cada|toda\\s+la|la)\\s+mañana\\b', f: () => null },
  { p: '\\bantes\\s+de\\s+ayer\\b|\\banteayer\\b|\\bthe\\s+day\\s+before\\s+yesterday\\b', f: (m, r) => ISO_DAY(shiftDays(r, -2)) },
  { p: '\\bpasado\\s+mañana\\b|\\bthe\\s+day\\s+after\\s+tomorrow\\b', f: (m, r) => ISO_DAY(shiftDays(r, 2)) },
  { p: `\\bhace\\s+(${N_})\\s+(${U_})\\b`, f: (m, r) => shiftUnit(r, numOf(m[1]), m[2], -1) },
  { p: `\\b(${N_})\\s+(${U_})\\s+ago\\b`, f: (m, r) => shiftUnit(r, numOf(m[1]), m[2], -1) },
  { p: `\\bdentro\\s+de\\s+(${N_})\\s+(${U_})\\b`, f: (m, r) => shiftUnit(r, numOf(m[1]), m[2], 1) },
  { p: `\\bin\\s+(${N_})\\s+(${U_})\\b`, f: (m, r) => shiftUnit(r, numOf(m[1]), m[2], 1) },
  { p: '\\b(?:la\\s+)?semana\\s+(pasada|anterior|que\\s+viene|pr[óo]xima)\\b',
    f: (m, r) => weekRange(shiftDays(r, /pasada|anterior/i.test(m[1]) ? -7 : 7)) },
  { p: '\\b(last|next)\\s+week\\b', f: (m, r) => weekRange(shiftDays(r, /last/i.test(m[1]) ? -7 : 7)) },
  { p: '\\b(?:el\\s+)?mes\\s+(pasado|anterior|que\\s+viene|pr[óo]ximo)\\b',
    f: (m, r) => ISO_MONTH(shiftMonths(r, /pasado|anterior/i.test(m[1]) ? -1 : 1)) },
  { p: '\\b(last|next)\\s+month\\b', f: (m, r) => ISO_MONTH(shiftMonths(r, /last/i.test(m[1]) ? -1 : 1)) },
  { p: `\\bel\\s+(${WD_})\\s+(pasado|que\\s+viene|pr[óo]ximo)\\b`,
    f: (m, r) => ISO_DAY(weekdayNear(r, WEEKDAY[m[1].toLowerCase()], /pasado/i.test(m[2]) ? -1 : 1)) },
  { p: `\\b(last|next|this)\\s+(${WD_EN})\\b`,
    f: (m, r) => ISO_DAY(weekdayNear(r, WEEKDAY[m[2].toLowerCase()], /last/i.test(m[1]) ? -1 : (/next/i.test(m[1]) ? 1 : 0))) },
  // Sin modificador hace falta el artículo («el lunes») o la preposición inglesa
  // («on Monday»): un «Monday» suelto puede ser un nombre propio o un fichero.
  { p: `\\bel\\s+(${WD_})\\b`, f: (m, r) => ISO_DAY(weekdayNear(r, WEEKDAY[m[1].toLowerCase()], 0)) },
  { p: `\\bon\\s+(${WD_EN})\\b`, f: (m, r) => ISO_DAY(weekdayNear(r, WEEKDAY[m[1].toLowerCase()], 0)) },
  { p: '\\banoche\\b|\\blast\\s+night\\b', f: (m, r) => ISO_DAY(shiftDays(r, -1)) },
  { p: '\\bayer\\b|\\byesterday\\b', f: (m, r) => ISO_DAY(shiftDays(r, -1)) },
  { p: '\\bhoy\\b|\\btoday\\b', f: (m, r) => ISO_DAY(r) },
  { p: '\\bmañana\\b|\\btomorrow\\b', f: (m, r) => ISO_DAY(shiftDays(r, 1)) },
];
const TIME_RE = new RegExp(TIME_RULES.map(r => `(?:${r.p})`).join('|'), 'gi');
const TIME_ONE = TIME_RULES.map(r => new RegExp(`^(?:${r.p})$`, 'i'));
// Vallas de código, tramos entre acentos graves y valla sin cerrar (un mensaje
// a medio llegar): todo eso es contenido literal y no se anota.
const CODE_SPAN = /```[\s\S]*?```|```[\s\S]*$|~~~[\s\S]*?~~~|`[^`\n]+`/g;

function annotateDates(text, refMs) {
  if (!text) return text;
  TIME_RE.lastIndex = 0;
  if (!TIME_RE.test(text)) return text;      // barrido único: el caso normal sale por aquí
  const ref = new Date(refMs);
  if (isNaN(ref.getTime())) return text;
  const out = [];
  let last = 0, m;
  CODE_SPAN.lastIndex = 0;
  while ((m = CODE_SPAN.exec(text))) {
    out.push({ s: text.slice(last, m.index), code: false });
    out.push({ s: m[0], code: true });
    last = m.index + m[0].length;
  }
  out.push({ s: text.slice(last), code: false });
  return out.map(seg => seg.code ? seg.s : seg.s.replace(TIME_RE, (hit, ...rest) => {
    const whole = rest[rest.length - 1], at = rest[rest.length - 2];
    // idempotente: si ya lleva la anotación detrás, no se anota otra vez
    if (/^\s*\(\d{4}-\d{2}/.test(whole.slice(at + hit.length))) return hit;
    // Segunda red bajo la de las vallas, por si el código llega sin valla:
    // `today()`, `memory::today`, `hoy_str` o `a.ayer` son CÓDIGO. Barriendo a
    // pelo las 25.724 líneas de código real de los cuatro proyectos (peor caso
    // absoluto: sin valla y sin la guarda de resultados) disparaba 30 veces; con
    // esta puerta, 25 — y las cinco que desaparecen son justo las llamadas y las
    // rutas. Las 25 que quedan son prosa dentro de comentarios («run today»),
    // que es lo que el anotador debe hacer. La segunda mitad de la puerta cubre
    // `ayer.js` / `today.py`: una llamada a herramienta que llegue SIN valla
    // lleva rutas, y anotar dentro de una ruta la rompe. Un punto seguido de
    // espacio o de final de frase («lo hicimos ayer.») sí se anota.
    if (/[.:_/\\]$/.test(whole.slice(0, at)) || /^[(_]|^\.\w/.test(whole.slice(at + hit.length))) return hit;
    for (let i = 0; i < TIME_RULES.length; i++) {
      const g = TIME_ONE[i].exec(hit);
      if (!g) continue;
      const v = TIME_RULES[i].f(g, ref);
      return v ? `${hit} (${v})` : hit;
    }
    return hit;
  })).join('');
}

function timeValue(v) {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    return v < 1e11 ? v * 1000 : v;          // epoch en segundos o en milisegundos
  }
  if (typeof v.getTime === 'function') { const t = v.getTime(); return Number.isFinite(t) ? t : null; }
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
const msgTime = (m, O) => {
  const own = timeValue(m.ts != null ? m.ts : m.time != null ? m.time : m.timestamp != null ? m.timestamp
    : m.date != null ? m.date : m.createdAt);
  return own != null ? own : timeValue(O.NOW);
};

/** Historial con las referencias temporales resueltas. Devuelve el MISMO array
 *  si no hubo nada que anotar, para no pagar copias en el caso normal. */
function datedHistory(history, O) {
  if (!O.DATES) return history;
  let touched = false;
  const out = history.map(m => {
    const c = m.content || '';
    if (!c || O.TOOL_PREFIXES.some(p => c.startsWith(p))) return m;   // salida de herramienta: intocable
    const ref = msgTime(m, O);
    if (ref == null) return m;                                        // sin fecha conocida NO se inventa
    const a = annotateDates(c, ref);
    if (a === c) return m;
    touched = true;
    return { ...m, content: a };
  });
  return touched ? out : history;
}

/**
 * AGREGACIÓN — lo que no está en ninguna línea.
 *
 * «¿Cuántos ficheros has tocado?», «lístame todo lo que cambiaste»: la respuesta
 * no está repartida entre cuarenta líneas, es que NO EXISTE la línea que buscar.
 * Ningún top-k la encuentra, y no por puntuar mal: por construcción. Es el
 * segundo fallo que ninguna perilla de BM25 arregla, y como el de las fechas se
 * resuelve al ESCRIBIR: contando según pasan los resultados.
 *
 * Contador y nada más — sin modelo, sin resumen generado, sin juicio sobre el
 * contenido. Es un recuento, no una respuesta: por eso puede ir en el contexto
 * sin que nadie tenga que fiarse de él más de lo que se fía de `wc -l`.
 *
 * El objetivo de cada llamada sale de la llamada del ASISTENTE (el resultado no
 * lo lleva), igual que en markSuperseded. La familia se decide por el verbo del
 * nombre de la herramienta, no por una lista de nombres: los dos productos que
 * comparten este fichero tienen herramientas distintas (`code.read` / `fs.read`)
 * y una lista cerrada envejecería con el primer producto nuevo.
 */
const LEDGER_EDIT = /^(?:write|edit|create|save|patch|append|delete|remove|rm|move|rename|copy)$/;
const LEDGER_READ = /^(?:read|view|open|cat|show)$/;
const LEDGER_RUN = /^(?:run|exec|shell|bash|cmd)$/;
const CALL_TARGET = /"tool"\s*:\s*"([^"]+)"[\s\S]{0,300}?"(?:path|file|filename|command|cmd)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
const ERR_LINE = /^\s*(?:ERROR\b|Error:|error:|Traceback \(most recent call last\))/;

function buildLedger(msgs, O) {
  const read = new Map(), edited = new Map(), ran = new Map(), errs = new Map();
  let errN = 0;
  for (let i = 0; i < msgs.length; i++) {
    const c = msgs[i].content || '';
    if (O.TOOL_PREFIXES.some(p => c.startsWith(p))) {
      for (const line of c.split('\n')) {
        if (!ERR_LINE.test(line)) continue;
        errN++; errs.set(line.trim().slice(0, 90), i);
        break;               // se cuentan RESULTADOS que fallaron, no líneas de traza
      }
      continue;
    }
    if (msgs[i].role !== 'assistant') continue;
    CALL_TARGET.lastIndex = 0;
    let m;
    while ((m = CALL_TARGET.exec(c))) {
      const verb = m[1].split('.').pop().toLowerCase(), arg = m[2];
      if (!arg) continue;
      if (LEDGER_EDIT.test(verb)) edited.set(arg, i);
      else if (LEDGER_READ.test(verb)) read.set(arg, i);
      else if (LEDGER_RUN.test(verb)) ran.set(arg, i);
    }
  }
  // Un fichero editado no vuelve a contarse como leído: «cuántos has tocado» no
  // puede contar dos veces el mismo fichero.
  for (const k of edited.keys()) read.delete(k);
  return { read, edited, ran, errs, errN };
}

/**
 * La tarjeta, acotada. Tres reglas, y las tres salen de medir:
 *
 *   1. El RECUENTO va siempre y es el total de verdad; la enumeración es una
 *      ayuda y se recorta. Un recuento truncado que parece completo («has
 *      tocado 8 ficheros» cuando fueron 200) es peor que no dar ninguno, así
 *      que el número y la lista van por separado y la lista dice «+N más».
 *      Cuando no cabe ni una entrada, la fila se queda en el número pelado: eso
 *      sigue siendo información, y barata.
 *
 *   2. El techo sale del PRESUPUESTO, no de una constante (SUMMARY_FRAC).
 *
 *   3. El recorte NO es un tope igual para todas las filas: se le quita sitio a
 *      la que más TOKENS gasta. Así se enumeran ENTERAS las categorías que caben
 *      —típicamente los ficheros editados, que son pocos y son justo lo que se
 *      pregunta— en vez de dejar todas a medias. Medido en la sonda de
 *      agregación (presupuesto 3.000, 32 sesiones, cobertura de los ficheros
 *      realmente editados), a IGUAL coste de tarjeta (~148 tokens):
 *          tope igual para todas ..... 67,7 %
 *          recorte por coste ......... 90,6 %     ← esto
 *      Y el techo manda de verdad: con SUMMARY_FRAC 0,03 la cobertura baja a
 *      57,3 %, por debajo del 58,9 % que ya había SIN tarjeta. Con una tarjeta
 *      demasiado apretada el recuento sale gratis pero la enumeración estorba.
 *
 * Dentro de cada fila se enumeran las entradas MÁS RECIENTES primero: si hay que
 * recortar, lo que el agente acaba de tocar es lo que más probablemente le van a
 * preguntar.
 */
function renderCard(L, maxTok) {
  const rows = [['ficheros leídos', L.read], ['ficheros editados', L.edited],
                ['comandos', L.ran], ['errores', L.errs]];
  const totals = [L.read.size, L.edited.size, L.ran.size, L.errN];
  if (!totals.some(Boolean)) return null;
  const byRecency = rows.map(([, map]) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]));
  const caps = rows.map(() => 8);
  const line = (i) => {
    const items = byRecency[i].slice(0, caps[i]).map(s => s.length > 60 ? s.slice(0, 57) + '…' : s);
    const rest = totals[i] - items.length;
    return `${rows[i][0]} (${totals[i]})${items.length ? ': ' + items.join(' · ') : ''}` +
           `${rest > 0 && items.length ? ` · +${rest} más` : ''}`;
  };
  const compose = () => ['[recuento de la sesión · automático]']
    .concat(rows.map((r, i) => totals[i] ? line(i) : null).filter(Boolean)).join('\n');
  let text = compose();
  while (estimateTokens(text) > maxTok) {
    // Se le quita a la fila que más TOKENS está gastando, no a la que más
    // entradas tiene: dos rutas de error largas cuestan más que ocho nombres de
    // fichero cortos, y recortar por número de entradas no lo ve.
    let worst = -1, cost = 0;
    rows.forEach((r, i) => {
      if (!totals[i] || !caps[i]) return;
      const c = estimateTokens(line(i));
      if (c > cost) { cost = c; worst = i; }
    });
    if (worst < 0) break;                      // ya no queda enumeración que quitar
    caps[worst] = Math.min(caps[worst], totals[worst]) - 1;
    text = compose();
  }
  return { role: 'user', content: text };
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
  // ⚠️ El número de línea NO se borra cuando es lo único que distingue dos
  // líneas idénticas. Antes se quitaba siempre, y eso colapsaba la salida de
  // `grep -n`: "10:  return 42;" y "87:  return 42;" caían en la misma clave y
  // se quedaba UNA. Pero «¿dónde está definido X?» es la pregunta más común de
  // un agente de código, y la respuesta ES el número: darle un sitio de tres es
  // darle una respuesta incompleta que parece completa.
  //
  // Regla: se normaliza el espaciado (eso sí es ruido) pero la posición se
  // conserva como parte de la identidad de la línea. Solo colapsan las líneas
  // que son iguales TAMBIÉN en dónde estaban — repeticiones de verdad, como
  // "}" o el encabezado "[resultado …]" saliendo veinte veces.
  //
  // Y el ESTILO del canalón sí es ruido: la misma línea del mismo fichero vista
  // una vez por la herramienta de lectura (`42→foo`) y otra por una búsqueda
  // (`42: foo`) es la MISMA línea, y debe colapsar. Por eso el número se extrae
  // aparte y el cuerpo se compara ya sin canalón: se conserva DÓNDE estaba y se
  // descarta CÓMO se imprimió.
  const at = s.match(/^\s*(\d+)\s*[:→]/);
  const body = (at ? s.slice(at[0].length) : s).replace(/\s+/g, ' ').trim().toLowerCase();
  return at ? at[1] + '|' + body : body;
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
  // MMR OFF by default — measured dead, twice over.
  //
  // It earned its place with +2.4 points. That was before the elastic window
  // and before the word splitter was fixed. Re-measured on 2026-08-09 across
  // 3 projects and 8 seeds: 94.9% with it and 94.9% without at a 3,000 budget,
  // 100.0% and 100.0% at 16,000. It still changes the output in a third of
  // requests and never once changes the outcome. On the dialogue benchmark it
  // fires and decides nothing either.
  //
  // The reason is upstream: the elastic window only admits relevant material
  // now, and the fixed splitter finds more of it, so a diversity penalty has
  // nothing left to arbitrate. A mechanism that justified itself with a number,
  // stopped justifying itself when something above it changed, and nobody
  // re-checked. Kept behind the flag rather than deleted, because the day it
  // earns its keep again the evidence should be a measurement, not a memory.
  MMR: false,
  MMR_LAMBDA: null,       // null = medido del historial (ver autotune)
  MMR_CAND: null,         // null = derivado del presupuesto
  DEDUP: true,
  PIN_QUERY_TERMS: true,  // lo que la pregunta nombra no se desaloja jamás
  PIN_MAX: 40,
  // — presupuesto —
  SUPERSEDE: true,       // degradar resultados caducados (ver markSuperseded)
  ELASTIC: true,          // no rellenar con lo irrelevante (ver selectAndEmit)
  TAIL_MIN_FRAC: 0.05,    // SUELO garantizado para los ultimos turnos
  HEAD_FRAC: 0,             // desactivada: ver nota en autotune
  RECENT: 6,
  RECENT_FRAC: null,      // null = derivado de la presión de compresión
  MAX_MSG_CHARS: 12000,
  PER_LINE_CAP_FRAC: 0.5,
  TOOL_PREFIXES: ['[resultado', '[Tool result]:'],
  // — lo que no es recuperación —
  DATES: true,            // anotar «ayer» con la fecha del turno (ver annotateDates)
  NOW: null,              // fecha de respaldo para los mensajes SIN marca propia;
                          // sin ella no se anota nada — no se inventa una fecha
  SUMMARY: false,         // tarjeta de recuento (ver renderCard). TRAS BANDERA y
                          // apagada: medida, cuesta presupuesto de verdad
  SUMMARY_FRAC: 0.05,     // techo de la tarjeta como fracción del presupuesto:
                          // por debajo de 0,05 el recuento sigue saliendo pero
                          // la enumeración deja de compensar (ver renderCard)
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
  // CABECERA DESACTIVADA (decisión del usuario, 2026-08-09).
  // Medida, ayudaba en sesiones de agente: el encargo original pasaba de 0/5 a
  // 5/5 con presupuesto apretado, porque el arranque lleva la tarea y nadie la
  // repite, así que BM25 no puede rescatarla. Pero en DIÁLOGO no hay encargo
  // que proteger y la reserva cobra sin dar nada: en LoCoMo el motor con ella
  // recupera 56,2 % de la evidencia donde BM25 pelado recupera 62,5 %, con los
  // mismos tokens. Una reserva incondicional para algo que puede no existir es
  // la misma enfermedad que las constantes: presupone en vez de medir.
  // Se deja el mecanismo, con HEAD_FRAC a 0. Ponerlo a 0.05 lo reactiva.
  const headOn = O.HEAD_FRAC > 0;
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

  // Las dos cosas que se resuelven al ESCRIBIR van antes que nada, porque
  // cambian el material que se va a puntuar y lo que va a caber:
  //   · las fechas relativas se anotan sobre el historial (y pesan un poco más);
  //   · la tarjeta de recuento se cobra del presupuesto ANTES de repartirlo, que
  //     es lo que la hace incondicional sin romper el contrato de tokens.
  history = datedHistory(history, O);
  const card = O.SUMMARY
    ? renderCard(buildLedger(history, O), Math.max(24, Math.floor(budgetTok * O.SUMMARY_FRAC)))
    : null;
  const cardTok = card ? estimateTokens(card.content) + 4 : 0;
  budgetTok = Math.max(1, budgetTok - cardTok);

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
  if (!old.length || used >= budgetTok) return { done: true, recent, old, used, head: [], card, cardTok, budget: budgetTok };

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
  if (!old.length || used >= budgetTok) return { done: true, recent, old, used, head, card, cardTok, budget: budgetTok };

  // La PREGUNTA VIVA: el último turno de usuario que no sea un resultado de
  // herramienta. Esto es lo que se puntúa. No la tarea inicial.
  let query = '';
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'user' && !O.TOOL_PREFIXES.some(p => m.content.startsWith(p))) { query = m.content; break; }
  }

  const stale = O.SUPERSEDE ? markSuperseded(old, O.TOOL_PREFIXES) : new Set();
  const items = [];
  old.forEach((m, mi) => {
    const lines = m.content.split('\n');
    lines.forEach((line, li) => {
      items.push({ mi, li, line, first: li === 0, stale: stale.has(mi) });
    });
  });

  // Corpus del índice = las propias líneas. La IDF sale de aquí: endógena.
  const bm25 = buildBM25(items.map(it => it.line), { k1: O.BM25_K1, b: O.BM25_B });
  const qTerms = [...new Set(terms(query))];

  const nMsg = Math.max(old.length - 1, 1);
  for (let i = 0; i < items.length; i++) {
    items[i].bm = bm25.scoreDoc(i, qTerms);
    items[i].rec = items[i].mi / nMsg;
    // El pin NO puede ignorar la caducidad: la versión vieja lleva el mismo
    // identificador que la nueva, así que se fijaba sola y el degradado no
    // servía de nada. Que la pregunta nombre algo no lo vuelve cierto.
    items[i].qHit = items[i].bm > 0 && !items[i].stale;
  }
  return { done: false, recent, old, used, items, query, qTerms, bm25, nMsg, O, head, card, cardTok, budget: budgetTok };
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

  // La tarjeta va PROTEGIDA, como la cabecera y la cola, y por el mismo motivo
  // que ellas: no compite por relevancia porque no puede ganar. Es un recuento,
  // no comparte vocabulario con casi nada, y BM25 la tiraría siempre — que es
  // exactamente el fallo que viene a tapar. Va pegada a los últimos turnos,
  // junto a la pregunta viva, no al principio.
  const card = ctx.card ? [ctx.card] : [];
  return { messages: [...head, ...packed, ...card, ...recent],
           stats: { used, deduped, pinned, droppedMsgs, realized, head: head.length, card: ctx.cardTok || 0 } };
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
  if (ctx.done) return { messages: [...(ctx.head || []), ...(ctx.card ? [ctx.card] : []), ...ctx.recent],
                         stats: { used: ctx.used, dropped: ctx.old.length, head: (ctx.head || []).length, card: ctx.cardTok || 0 } };

  // Normalización a rango para poder mezclar con la recencia sin que BM25,
  // que no está acotado, se lleve todo por delante.
  const Oa = ctx.O || O;                       // perillas ya autoajustadas
  const maxBm = ctx.items.reduce((m, it) => Math.max(m, it.bm), 0) || 1;
  for (const it of ctx.items) {
    // Dos estratos separados por 10 — más de lo que la penalización MMR (≤0.8)
    // puede recorrer, así que la diversidad reordena DENTRO de un estrato pero
    // nunca cuela una línea irrelevante por delante de una relevante.
    // Degradado, no borrado: baja del estrato relevante al de relleno, así que
    // solo entra si no hay nada mejor — y con la ventana elástica, casi nunca.
    it.score = (it.bm > 0 && !it.stale) ? 10 + it.bm / maxBm : (Oa._recTie ? it.rec : 0);
    if (it.first) it.score = Math.max(it.score, 0.5);  // cabecera de procedencia
  }
  const r = selectAndEmit(ctx, ctx.budget, Oa);
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
  if (ctx.done) return { messages: [...(ctx.head || []), ...(ctx.card ? [ctx.card] : []), ...ctx.recent],
                         stats: { used: ctx.used, dropped: ctx.old.length, head: (ctx.head || []).length, card: ctx.cardTok || 0 } };

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
    const rel = !it.stale && ((it.bm > 0) || ((it.sem || 0) > 0));
    it.score = rel ? 10 + (fused.get(idOf(it)) || 0) / maxF : (Oa._recTie ? it.rec : 0);
    if (it.first) it.score = Math.max(it.score, 0.5);
  }
  const r = selectAndEmit(ctx, ctx.budget, Oa);
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
  annotateDates, buildLedger, renderCard,
  classifyLine, makeIdf,
};

// Gemma-4 vía LiteRT-LM de Google (early preview, solo WebGPU).
// Patrón copiado de la demo verificada en agentic-install
// (lab/bitacora/posts/08-jspace-live.html).
// DECISIÓN 2026-07-14: cerebro = Gemma BASE (builds oficiales litert-community,
// formato artisan). NO fine-tune propio: `@litert-lm/core` exige empaquetado
// artisan y nuestras conversiones no lo producen (E-010). La agéntica va por el
// system prompt (agent.js), no por pesos.
export let name = 'Gemma · LiteRT-LM';

// Builds .litertlm elegibles. Los «-web» OFICIALES de Google (litert-community)
// están exportados en formato artisan → SÍ cargan en el navegador (son los que
// usaba la demo original). El healed de Elffuss es prefill_decode → hoy no carga
// (E-010), por eso está gateado en el selector.
export const MODELS = {
  'gemma-e2b': { url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm', label: 'Gemma-4 E2B', tag: '~2 GB · ligero' },
  'gemma-e4b': { url: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm', label: 'Gemma-4 E4B', tag: '~4 GB · el mejor' },
  'elffuss-e4b': { url: 'https://huggingface.co/KikoCis/Elffuss-Gemma4-E4B-litert/resolve/main/model.litertlm', label: 'Elffuss E4B (healed)', tag: 'modelo propio' },
};

let MODEL_URL = MODELS['gemma-e2b'].url;
let curLabel = MODELS['gemma-e2b'].label;
let curKey = 'gemma-e2b';
export function configure(key) {
  const m = MODELS[key] || MODELS['gemma-e2b'];
  curKey = MODELS[key] ? key : 'gemma-e2b';
  MODEL_URL = m.url; curLabel = m.label; name = 'Gemma · LiteRT-LM (' + m.label + ')';
}

// Enseñarle solo las herramientas que vienen a cuento (herramientasPara, en
// agent.js) NO SE PUEDE aquí, aunque E4B lo aguante en el banco: la conversación
// de LiteRT fija el prompt de sistema al crearse y chat() solo la recrea si
// cambian sus primeros 200 caracteres, que son la persona. El catálogo del PRIMER
// mensaje se quedaría para toda la conversación: «busca fotos» dejaría solo web
// a la vista, y el «recuérdame…» de después no encontraría tasks. Estuvo así
// unas horas el 2026-09-13; el banco no lo vio porque mide peticiones sueltas.
// Recrear la conversación en cada cambio tiraría la caché KV y el historial.
// false explícito = imposible (ni el interruptor 'on' lo fuerza).
export function enrutaHerramientas() { return false; }

let engine = null, conversation = null, sentCount = 0, sys = '';

// Muestreo. Por defecto VORAZ, que es como venía: mismo prompt, misma salida.
// Eso hace que generar N veces cueste N y devuelva una sola respuesta distinta,
// así que cualquier técnica de «genera varias y quédate con la mejor» era gasto
// puro. Con temperatura y semilla se puede pedir variedad de verdad.
const TOP_P = 2;
let muestreo = null;                       // null = voraz
export function setSampling(opts) {        // {temperature, seed, p} o null
  const antes = JSON.stringify(muestreo);
  // «k» es OBLIGATORIO aunque el tipo sea TOP_P: sin él el wasm aborta en seco
  // con «Aborted()» y se lleva por delante el motor. Comprobado probando formas.
  muestreo = opts && opts.temperature > 0
    ? { type: TOP_P, k: opts.k ?? 40, p: opts.p ?? 0.95, temperature: opts.temperature, seed: opts.seed ?? 0 }
    : null;
  // cambiar el muestreo exige rehacer la conversación: la sesión ya está creada
  // con los parámetros de antes y no los relee.
  if (JSON.stringify(muestreo) !== antes) { conversation = null; sentCount = 0; }
  return muestreo;
}
export function getSampling() { return muestreo; }
export function __engine() { return engine; }   // solo para el banco de pruebas

// Contexto: probamos de mayor a menor hasta el máximo que acepten el bundle y
// la memoria GPU — así el contexto queda al tope permitido de serie.
const CTX_LADDER = [32768, 16384, 8192, 4096];
export let ctxTokens = 4096; // efectivo tras load() (la UI puede leerlo)

export async function load(onProgress = () => {}) {
  if (!navigator.gpu) throw new Error('LiteRT-LM necesita WebGPU (Chrome/Edge modernos)');
  // navigator.gpu puede existir como API sin adaptador real (algunos Linux/
  // drivers, entornos sandboxed…) — comprobarlo YA evita bajar 2-4 GB para
  // descubrir el fallo solo al crear el motor, al final de todo.
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter(); } catch { /* sin adaptador */ }
  if (!adapter) throw new Error('No hay un adaptador WebGPU real disponible (la API existe pero no hay GPU accesible) — prueba con Elffuss LM, que corre en CPU/wasm.');
  // VERSIÓN FIJADA a propósito. Sin fijarla, la URL apunta siempre a la última
  // publicada: el 2026-08-11 salió 0.16.0, jsdelivr NO consigue construirle el
  // bundle `+esm` (404) y el cerebro Gemma dejó de cargar en producción sin que
  // nosotros tocáramos una línea. Al subir de versión hay que COMPROBAR que
  // `https://cdn.jsdelivr.net/npm/@litert-lm/core@<v>/+esm` responde 200.
  const litertlm = await import('https://cdn.jsdelivr.net/npm/@litert-lm/core@0.15.0/+esm');
  // El .litertlm lo descargamos NOSOTROS (cache-first en Cache Storage) y se lo
  // pasamos a Engine.create como Blob (la API acepta string|Blob|ReadableStream).
  // Motivo: el fetch interno de LiteRT baja el peso con XHR+Range desde un WORKER
  // que el service worker no intercepta → antes se re-descargaba SIEMPRE. Bajándolo
  // aquí queda cacheado de verdad y damos progreso real en MB.
  const model = await cachedModelBlob(MODEL_URL, onProgress);
  onProgress('Preparando el modelo IA en la GPU…');
  let lastErr = null;
  for (const n of CTX_LADDER) {
    try {
      engine = await litertlm.Engine.create({ model, mainExecutorSettings: { maxNumTokens: n } });
      ctxTokens = n;
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      // Errores de formato/carga no dependen del contexto: no insistir con la escalera.
      if (/not supported|tokenizer|format/i.test(String(e?.message))) throw e;
      onProgress(`Contexto ${n} no cabe, probando ${n / 2}…`);
    }
  }
  if (lastErr) throw lastErr;
}

const MODEL_CACHE = 'elffuss-models-v1';
// Devuelve el .litertlm como Blob desde Cache Storage; si no está, lo descarga
// con progreso real y lo cachea (persistente). Ante cualquier fallo, devuelve la
// URL para que LiteRT lo baje por su cuenta (nunca bloquea la carga del modelo).
export async function cachedModelBlob(url, onProgress = () => {}) {
  // Runtime propio: primero OPFS persistente. Cache Storage se desalojaba en
  // móvil → re-descarga en cada visita; OPFS aguanta en disco entre sesiones.
  // Si OPFS no es escribible aquí (iOS hilo principal), getModelFile devuelve
  // null y caemos al respaldo de Cache Storage de siempre.
  try {
    const { getModelFile } = await import('../runtime/model-store.js');
    const f = await getModelFile(url, onProgress);
    if (f) return f;
  } catch (e) { console.warn('[elffuss] OPFS no disponible, uso Cache Storage:', e); }

  if (!self.caches) return url;
  try {
    const cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(url);
    if (hit) { onProgress('Cargando el modelo IA desde caché (sin descargar)…'); return await hit.blob(); }
    const net = await fetch(url);
    if (!net.ok || !net.body) return url;
    const total = +net.headers.get('content-length') || 0;
    const t0 = performance.now();
    // Progreso SIN tee(): con un modelo de gigabytes, tee() crea dos ramas que
    // se consumen a ritmos distintos y el navegador tiene que bufferizar la
    // diferencia en memoria → el cache.put acababa reventando y el modelo NO se
    // cacheaba NUNCA (medido con E4B: 2832 MB bajados y cero guardados). Peor
    // aún: al fallar se devolvía la URL suelta y `Engine.create({model: <URL>})`
    // monta un motor que CARGA pero no genera («Aborted()»). Con un
    // TransformStream hay un solo consumidor: contamos al vuelo y el mismo flujo
    // va a la caché.
    let loaded = 0;
    const counted = net.body.pipeThrough(new TransformStream({
      transform(chunk, ctrl) {
        loaded += chunk.byteLength ?? chunk.length;
        onProgress(fmtBytes(loaded, total, t0));
        ctrl.enqueue(chunk);
      },
    }));
    const headers = { 'Content-Type': 'application/octet-stream' };
    if (total) headers['Content-Length'] = String(total);
    // Cachear GIGABYTES puede fallar de verdad: ventana privada (Cache Storage
    // en memoria), disco lleno, cuota del origen. Si falla hay que DECIRLO: el
    // progreso ya ha prometido «se cachea para la próxima vez» y, callándolo,
    // el usuario se re-baja el modelo entero cada sesión sin saber por qué.
    try {
      await cache.put(url, new Response(counted, { headers }));
    } catch (e) {
      onProgress(`No se pudo guardar el modelo en caché (${e.name || 'error'}): habrá que descargarlo otra vez la próxima. ` +
        `Suele ser ventana privada o falta de espacio.`);
      console.warn('[elffuss] modelo NO cacheado:', e);
      return url;
    }
    const cached = await cache.match(url);
    if (!cached) { onProgress('No se pudo guardar el modelo en caché: habrá que descargarlo otra vez la próxima.'); return url; }
    return await cached.blob();
  } catch (e) {
    console.warn('[elffuss] caché de modelo no disponible:', e);
    return url;
  }
}
function fmtBytes(loaded, total, t0) {
  const mb = n => (n / 1048576).toFixed(0);
  const secs = (performance.now() - t0) / 1000;
  const spd = secs > 0 ? (loaded / 1048576 / secs).toFixed(1) : '0';
  return total
    ? `Descargando el modelo IA… ${mb(loaded)}/${mb(total)} MB (${spd} MB/s) · se cachea para la próxima vez`
    : `Descargando el modelo IA… ${mb(loaded)} MB (${spd} MB/s)`;
}

// Liberar el modelo (vigilante de RAM).
export async function unload() {
  try { engine?.close?.(); } catch { /* mejor esfuerzo */ }
  engine = null; conversation = null; sentCount = 0;
}

export async function chat(history, system, onToken = () => {}) {
  if (!engine) throw new Error('Modelo no cargado');
  // Comparar solo la parte estática del prompt: el CONTEXTO AHORA va al final
  // y cambia cada turno — recrear la conversación tiraría el KV-cache.
  const sysKey = system.slice(0, 200);
  // Una conversación NUEVA llega con el historial reiniciado (más corto que lo
  // ya enviado). Sin esta comprobación, el KV-cache conservaba el chat anterior
  // entero: el modelo seguía «viendo» los ficheros y respuestas del chat de
  // antes y contestaba sobre ellos. Se notaba como alucinación («ese fichero no
  // existe») cuando en realidad era memoria de la conversación previa — y es
  // además una fuga: un chat nuevo no debe ver el contenido del anterior.
  const reiniciada = history.length <= sentCount;
  if (!conversation || sysKey !== sys || reiniciada) {
    sys = sysKey;
    conversation = await crearConversacion(system);
    sentCount = 0;
  }
  // La conversación LiteRT mantiene su propio KV-cache: enviamos solo lo nuevo.
  const fresh = history.slice(sentCount).filter(m => m.role === 'user');
  const nuevos = fresh.length ? fresh : [history.at(-1)];
  let text = nuevos.map(m => m.content).join('\n');

  // ¿Cabe? Si no: compactar lo anterior y, si ni así, recortar (ver CONTEXTO).
  let antes = await tokensUsados();
  if (antes != null && estimaTokens(text) > ctxTokens - antes - RESERVA_SALIDA) {
    const ocupaba = estimaTokens(text);
    if (sentCount > 0) { await rehacerCompactada(history, sentCount, system, nuevos); antes = await tokensUsados(); }
    const largo = text.length;
    text = ajustarAlContexto(nuevos, libreEnCaracteres(antes, 0.9));
    console.warn(`[litert] el mensaje nuevo (~${ocupaba} tokens) no cabía en un contexto de ${ctxTokens}: ` +
      `${sentCount > 0 ? 'conversación compactada' : 'conversación vacía'}, mensaje ${text.length < largo ? 'recortado' : 'entero'} ` +
      `· usados ${antes} · se mandan ${text.length} caracteres (${largo} tenía) · ${charsPorToken} caracteres/token`);
  }

  let out = '';
  const enviar = async t => {
    for await (const chunk of conversation.sendMessageStreaming(t)) {
      for (const item of (chunk.content || []))
        if (item.type === 'text') { out += item.text; onToken(item.text); }
    }
  };
  try {
    await enviar(text);
  } catch (e) {
    // Si falla ANTES de escribir nada, lo normal es que no cupiera (la cuenta de
    // caracteres por token se quedó corta): se rehace compactada, se recorta a la
    // mitad de lo libre y se intenta UNA vez más. Si ya había escrito algo,
    // reintentar lo duplicaría: se deja subir el error.
    if (out) throw e;
    console.warn(`[litert] el envío falló sin respuesta (usados ${antes} · ${text.length} caracteres); ` +
      `rehago la conversación compactada y reintento una vez: ${e?.message || e}`);
    await rehacerCompactada(history, sentCount, system, nuevos);
    antes = await tokensUsados();
    text = ajustarAlContexto(nuevos, libreEnCaracteres(antes, 0.5));
    console.warn(`[litert] reintento: usados ${antes} · se mandan ${text.length} caracteres`);
    await enviar(text);
  }
  // Se marca como enviado DESPUÉS de enviarlo. Antes se marcaba al principio, y
  // un envío fallido dejaba el mensaje por enviado sin haber llegado nunca.
  sentCount = history.length;
  const despues = await tokensUsados();
  if (antes != null && despues != null && despues - antes > 64)
    charsPorToken = Math.min(2, Math.max(1.2, (text.length + out.length) / (despues - antes)));
  return out.trim();
}

function crearConversacion(system) {
  return engine.createConversation({
    preface: { messages: [{ role: 'system', content: system }] },
    // Exprimir el navegador: no persistir los tokens de canal (tool-call/thinking)
    // del modelo en el KV-cache → libera KV → más contexto útil. Y prefill del
    // system prompt al crear la conversación → primera respuesta más rápida.
    filterChannelContentFromKvCache: true,
    prefillPrefaceOnInit: true,
    ...(muestreo ? { sessionConfig: { samplerParams: muestreo } } : {}),
  });
}

// ── CONTEXTO: que un resultado grande no tumbe la conversación ───────────────
// Los proveedores sin estado pasan el historial por acer-core en cada llamada.
// Este no: LiteRT guarda la conversación en su caché KV y aquí solo se le manda
// lo nuevo, así que NADA la empaquetaba. Y lo nuevo puede ser enorme: fs.read
// devuelve hasta 200.000 caracteres, decenas de miles de tokens, con un
// contexto de 4.096 a 32.768. Antes de mandar se mira lo que queda
// (getTokenCount) y, si no cabe:
//   1. se rehace la conversación con lo anterior EMPAQUETADO por acer-core
//      —puntuado con la pregunta de ahora— dentro del prompt de sistema. Va como
//      texto y no como mensajes con rol a propósito: qué roles acepta el
//      preámbulo de Gemma no está documentado, y el texto no depende de eso;
//   2. si ni así cabe, se recortan por el medio los resultados de herramienta
//      del mensaje nuevo (cabeza y cola, que es donde suele estar lo que
//      importa), avisando al modelo de que puede pedir un trozo concreto.
// Si cabe, el mensaje sale exactamente igual que antes.
//
// Los caracteres por token no se saben de antemano (el tokenizador vive dentro
// del wasm): se empieza en 2 y lo medido con getTokenCount solo puede BAJARLO.
// Medido con Gemma E4B: la prosa sale a ~2,8 y un informe cargado de cifras a
// 2,35. Dejando que subiera, el saludo calibraba a 2,81 y el informe de después
// se mandaba contado con esa cifra: 77.112 caracteres que eran ~32.800 tokens, y
// el envío fallaba («Too many tokens requested») hasta el reintento, pagando dos
// veces la espera. Una proporción medida con un contenido no vale para otro, y
// equivocarse por arriba cuesta un fallo; por abajo, solo recortar algo de más.
const RESERVA_SALIDA = 1024;       // tokens que se dejan para que conteste
const FRAC_HISTORIAL = 0.35;       // techo del historial empaquetado al rehacer
let charsPorToken = 2;
const estimaTokens = s => Math.ceil(s.length / charsPorToken);

async function tokensUsados() {
  try { const n = await conversation.getTokenCount(); return Number.isFinite(n) ? n : null; }
  catch { return null; }
}
const libreEnCaracteres = (usados, fraccion) =>
  Math.floor(Math.max(256, ctxTokens - (usados ?? 0) - RESERVA_SALIDA) * charsPorToken * fraccion);

async function rehacerCompactada(history, hasta, system, nuevos) {
  let bloque = '';
  const previos = history.slice(0, hasta);
  if (previos.length) {
    const { packHistoryAsync } = await import('../context.js');
    const { estimateTokens } = await import('../acer-core.js');
    // El presupuesto de acer-core va en SUS tokens estimados, no en los del modelo.
    const caracteres = previos.reduce((a, m) => a + m.content.length, 0) || 1;
    const suyos = previos.reduce((a, m) => a + estimateTokens(m.content), 0);
    const presupuesto = Math.max(100, Math.round(ctxTokens * FRAC_HISTORIAL * charsPorToken * suyos / caracteres));
    // La pregunta de AHORA va al final para que acer-core puntúe con ella; luego se quita.
    const noEsResultado = m => m.role === 'user' && !m.content.startsWith('[resultado');
    const pregunta = ([...nuevos].reverse().find(noEsResultado) || [...history].reverse().find(noEsResultado))?.content || '';
    const empaquetado = (await packHistoryAsync([...previos, { role: 'user', content: pregunta }], presupuesto)).slice(0, -1);
    bloque = '\n\nCONVERSACIÓN HASTA AHORA (no cabía entera: va lo más relevante para lo que se pide ahora):\n' +
      empaquetado.map(m => `${m.role === 'assistant' ? 'Elffuss' : 'Usuario'}: ${m.content}`).join('\n');
  }
  try { await conversation?.delete?.(); } catch { /* ya no estaba */ }
  conversation = await crearConversacion(system + bloque);
}

function ajustarAlContexto(nuevos, maxCaracteres) {
  const entero = nuevos.map(m => m.content).join('\n');
  if (entero.length <= maxCaracteres) return entero;
  // Un mensaje puede traer VARIOS resultados seguidos (Elffuss Code junta los de
  // un mismo paso): se recorta cada uno por su lado, o el primero se comería el
  // sitio de los demás.
  const mensajes = nuevos.map(m => m.content.split(/\n\n(?=\[resultado )/));
  const esResultado = b => b.startsWith('[resultado');
  const deResultados = mensajes.flat().reduce((a, b) => a + (esResultado(b) ? b.length : 0), 0);
  const hueco = Math.max(0, maxCaracteres - (entero.length - deResultados));
  const t = deResultados
    ? mensajes.map(bs => bs.map(b => (esResultado(b) ? recortarPorElMedio(b, Math.floor(b.length * hueco / deResultados)) : b)).join('\n\n')).join('\n')
    : entero;
  return t.length <= maxCaracteres ? t : recortarPorElMedio(t, maxCaracteres);
}

function recortarPorElMedio(s, max) {
  if (s.length <= max) return s;
  const aviso = `\n… [recortado: ${s.length - max} caracteres no caben en el contexto; si hace falta, pide un fragmento concreto] …\n`;
  const util = Math.max(0, max - aviso.length);
  const cabeza = Math.ceil(util * 0.7);
  return s.slice(0, cabeza) + aviso + s.slice(s.length - (util - cabeza));
}

// Solo para tests/litert-contexto.mjs: probar chat() en node con un motor de mentira.
export function __usarMotor(motor, contexto) {
  engine = motor; ctxTokens = contexto; conversation = null; sentCount = 0; sys = ''; charsPorToken = 2;
}

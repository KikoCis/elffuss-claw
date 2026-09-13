// tool-router.js — enseñarle al modelo solo las herramientas que vienen a cuento
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ. El catálogo son 27 herramientas y se mandaba ENTERO en cada turno,
// junto con cinco ejemplos fijos: 847 de los 1.261 tokens del prompt fijo, el
// 67 %, medido con el tokenizador real. En un modelo local el prompt no sale
// gratis: el prefill es el cuello de botella (en el 27B, el prompt completo tarda
// unas catorce veces más en dar el primer token que el compacto), y un modelo
// pequeño se confunde más cuantas más herramientas tiene delante. En los harnesses de 2026 esto se llama «tool
// search» o «progressive disclosure»: recuperar por petición solo lo necesario.
//
// POR QUÉ POR FAMILIAS Y NO POR HERRAMIENTA. Las de una familia se usan juntas:
// fs.read sin fs.list deja al modelo leyendo a ciegas. Son 7 familias.
//
// LA REGLA QUE NO SE NEGOCIA: si no hay señal clara, se manda el catálogo entero.
// Un recuperador que se equivoca en silencio es peor que no tener recuperador,
// porque el modelo no puede llamar a lo que no ve y tampoco avisa de que le
// falta: inventa. Por eso rutear() devuelve null cuando duda, y null significa
// «todo, como siempre». Nunca peor que antes de existir esto.
//
// POR QUÉ SE PLIEGAN LAS TILDES ANTES DEL BM25. terms() de acer-core parte por
// \w, que en JavaScript es ASCII: «recuérdame» sale como [recu, rdame], «mañana»
// como [ma, ana] y el cirílico, vacío. Plegando a ASCII antes, las lenguas de
// alfabeto latino casan. El cirílico no tiene equivalente ASCII y sale sin
// términos → catálogo entero.
//
// POR QUÉ HAY PALABRAS VACÍAS AQUÍ Y NO EN ACER-CORE. acer-core no usa lista de
// parada a propósito: sobre cientos de líneas de historial la IDF endógena hunde
// solas las palabras ubicuas. Aquí el corpus son SIETE documentos, y con siete
// la IDF no llega a hundirlas: «una», «que», «con», «las» aportan ~0,4 cada una y
// se suman. En el banco, «hazme una app con las fotos de gatos que encuentres»
// daba skill 4,13 por delante de web, solo porque las descripciones de skill son
// las más largas y están llenas de esas palabras. Se filtran de la CONSULTA —el
// BM25 solo suma términos de la consulta—, sin tocar acer-core.
import { buildBM25, terms } from './acer-core.js';

// Cómo lo PIDE la gente, no cómo se llama la herramienta. El catálogo dice
// «Programar una tarea futura»; nadie escribe eso, escribe «recuérdame» o
// «avísame dentro de media hora». Sin estas palabras el BM25 solo acierta cuando
// el usuario habla igual que el catálogo. Español e inglés, que son las dos más
// usadas; el resto de lenguas latinas casan en parte por las descripciones, y lo
// que no casa cae al catálogo entero. Se escriben con tildes o sin ellas: se
// pliegan igual que la consulta.
export const PISTAS = {
  fs: 'archivo archivos fichero ficheros carpeta carpetas documento documentos disco directorio ruta leer lee léeme abrir guardar guarda escribir escribe copiar copia mover pdf txt csv excel xlsx descargas automatización vigilar file files folder folders directory read open save write copy',
  app: 'app apps aplicación aplicaciones hazme haz crea créame crear construye juego juegos reloj calculadora temporizador pomodoro contador tablero panel dibuja dibujo animación animado visualiza gráfico interfaz make build game timer clock calculator tracker dashboard draw',
  vault: 'secreto secretos contraseña contraseñas clave claves password passwords token tokens api key cifrado cifrada seguro segura vault secret credentials',
  tasks: 'recuérdame recordatorio recordatorios avísame avisa aviso avisos alarma programa programar programado tarea tareas minutos minuto hora horas mañana luego después dentro cancela cancelar remind reminder reminders alarm schedule scheduled later tomorrow minutes hour',
  web: 'busca buscar búsqueda internet web google navega noticias noticia fotos foto imágenes imagen clima precio cuesta vale página url enlace última últimas actualidad ganador search find images photos pictures news weather price page link online',
  skill: 'skill skills habilidad habilidades instrucciones enséñate aprende especialízate guion copiloto automatiza rol personalidad comportamiento teach learn behave',
  memory: 'recuerda recordar acuérdate olvida olvidar olvides memoria sabes soy llamo gustos prefiero odio alérgico remember forget memory prefer allergic',
};

// Solo palabras funcionales (artículos, preposiciones, pronombres, auxiliares),
// ya plegadas. Ninguna palabra de contenido: «todo» se queda fuera a propósito,
// porque en inglés es «todo list».
export const VACIAS = new Set((
  'de la el en los las un una unos unas que se del al por con para lo le les me te nos os mi tu su sus ' +
  'es son era eran esta estan este esto ese esa eso esos esas como mas pero ni si no ya muy tambien ' +
  'donde cuando quien cual cuales hay ha he han has sin sobre entre hasta desde ' +
  'the an and or of to in on at for with by from is are was were be been it its this that these those ' +
  'my your you we they he she his her as but not do does did can will would should could have had ' +
  'just about into over up out so than then there their what which who whom when where how ' +
  'le les des du une et dans pour sur avec est il elle je nous vous qui ' +
  'os as do da dos das um uma em no na nas com ' +
  'lo gli di della che els amb ' +
  'der die das und ein eine von zu mit ist den dem des fur auf mir mich'
).split(/\s+/).filter(Boolean));

export const DEFAULTS = {
  // Puntuación mínima de la mejor familia para fiarse. Con 7 documentos, un
  // término que solo aparece en una familia aporta ~1,6 y uno que aparece en
  // dos, ~1,1; uno repartido en tres ya no llega. O sea: hace falta al menos
  // una palabra que distinga de verdad.
  umbral: 1.0,
  // Se suman las familias que puntúan al menos la mitad que la mejor: cubre las
  // peticiones compuestas («busca recetas y guárdalas») y las ambiguas
  // («recuerda» es memoria; «recuérdame en diez minutos», tareas).
  ratio: 0.5,
  maxFamilias: 3,
  // Normalización por longitud floja: los documentos no son texto natural sino
  // descriptores escritos a mano, y castigar a fs por tener 8 herramientas no
  // tiene sentido.
  b: 0.3,
  // Filtrar palabras vacías de la consulta (ver arriba). Medido en el banco
  // CIEGO —60 casos que escribió un modelo sin ver las pistas—: 46/60 → 56/60.
  // Ojo a POR QUÉ mejora: sin el filtro, las palabras vacías empujaban por encima
  // del umbral peticiones sin señal real, y el recuperador elegía seguro y MAL.
  // Con el filtro esas peticiones caen al catálogo entero (del 13 % al 38 % de las
  // veces). Cambia errores silenciosos por respaldos honestos y lo paga en ahorro
  // (del 55 % al 49 %). Es el cambio correcto aunque ahorre menos.
  vacias: true,
  // Familias que se enseñan SIEMPRE, además de las recuperadas. Web, porque las
  // preguntas sobre el mundo son las más comunes y las que menos se marcan: nadie
  // escribe «busca en internet el tiempo», escribe «¿qué tiempo hará?». Cuesta
  // 58 tokens y en el banco ciego suma: 56/60 → 57/60. Y la regla 5 del prompt ya
  // le promete al modelo que SIEMPRE puede buscar en internet: enseñarle web es
  // coherente con lo que se le dice.
  siempre: ['web'],
  // Qué hacer cuando hay términos pero ninguna familia pasa el umbral:
  //   'todo' → catálogo entero (por defecto: nunca peor que hoy)
  //   'nada' → solo las familias de `siempre`. Existe para MEDIR su coste, y el
  //            coste es alto: en el banco propio parecía casi gratis (59/61) y
  //            en el ciego se hunde a 44/60, PEOR que no filtrar nada. Falla
  //            peticiones corrientes sin vocabulario de herramienta, como «el
  //            viernes a las nueve pregúntame si mandé el informe».
  sinSenal: 'todo',
};

export const fold = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const familiaDe = linea => (String(linea).match(/^-\s*([a-z]+)\./) || [])[1] || null;

// lineasCatalogo: las líneas de toolHelp(), «- fs.list(path): Listar archivos…».
// Se reciben de fuera en vez de importar tools/index.js para que esto se pueda
// probar en node: tools/index.js toca localStorage al cargarse.
export function crearRouter(lineasCatalogo, opciones = {}) {
  const o = { ...DEFAULTS, ...opciones };
  const porFamilia = new Map();
  for (const l of lineasCatalogo) {
    const f = familiaDe(l);
    if (!f) continue;
    if (!porFamilia.has(f)) porFamilia.set(f, []);
    porFamilia.get(f).push(l);
  }
  const familias = [...porFamilia.keys()];
  const docs = familias.map(f => fold(`${f} ${porFamilia.get(f).join(' ')} ${PISTAS[f] || ''}`));
  const bm = buildBM25(docs, { b: o.b });

  // ademas: familias extra que hay que enseñar en ESTA consulta (p. ej. las que
  // nombran las skills instaladas). Solo se añaden cuando hay recuperación: con
  // null ya va el catálogo entero.
  function rutear(consulta, { ademas = [] } = {}) {
    const brutos = terms(fold(consulta));
    if (!brutos.length) return null;                   // alfabeto que el BM25 no ve
    const qt = o.vacias ? brutos.filter(t => !VACIAS.has(t)) : brutos;
    const puntuaciones = familias
      .map((familia, i) => ({ familia, s: qt.length ? bm.scoreDoc(i, qt) : 0 }))
      .sort((a, b) => b.s - a.s);
    const mejor = puntuaciones[0]?.s || 0;
    let elegidas;
    if (mejor < o.umbral) {
      if (o.sinSenal !== 'nada') return null;
      elegidas = [];
    } else {
      elegidas = puntuaciones.filter(p => p.s >= mejor * o.ratio).slice(0, o.maxFamilias).map(p => p.familia);
    }
    for (const f of [...o.siempre, ...ademas]) if (porFamilia.has(f) && !elegidas.includes(f)) elegidas.push(f);
    return { familias: elegidas, lineas: elegidas.flatMap(f => porFamilia.get(f)), puntuaciones };
  }

  return { rutear, familias, porFamilia };
}

// Gramática de salida del copiloto: lo que el modelo dice solo entra si encaja.
//
// POR QUÉ. El copiloto es de facto una feature de Gemma: los cerebros pequeños
// (Qwen3.5-0.8B, LFM2.5) o marcan todo «sí» desde el turno 1, o se ponen a
// conversar como si fueran el cliente, o se inventan un teléfono que nadie dijo.
// Con decodificación libre no hay forma de distinguir eso de una respuesta buena.
//
// LA FORMA (patrón CRANE — «razona libre, restringe al final»): al modelo se le
// deja escribir el CONSEJO en prosa (ahí la libertad ayuda; restringir el
// razonamiento empeora a los modelos pequeños), pero todo lo que ALIMENTA EL
// ESTADO pasa por un espacio cerrado y verificable:
//   · ACCION  → vocabulario cerrado de 5 opciones.
//   · DATOS   → cada valor tiene que pasar el validador de SU ranura y, además,
//               estar ANCLADO en lo que se ha dicho (si nadie lo dijo, no entra).
//   · CONSEJO → se tira si es eco del interlocutor, plantilla o diálogo.
// Cuando el consejo se cae, la ACCION (que sí es fiable, por cerrada) más el
// estado del tablero generan uno determinista: el copiloto nunca se queda mudo
// ni suelta una alucinación.
//
// Sin dependencias ni DOM: se prueba en node (tests/copilot-grammar.test.mjs).

export const ACCIONES = ['preguntar', 'rebatir', 'cerrar', 'profundizar', 'esperar'];

// Valores-plantilla que el modelo copia del propio ejemplo del contrato.
const VACIO = /^(…|\.\.\.|—|–|-|_+|n\/a|na|null|none|nada|desconocido|sin datos|pendiente|\?+)$/i;
const PLANTILLA = /(<[^>]*>|una l[ií]nea accionable|reesc[rí]ibelo|los que hayan salido|las abiertas|nombre del campo|ejemplo:)/i;

export const norm = s => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');
const palabras = s => norm(s).split(/[^a-z0-9@.+]+/).filter(w => w.length > 2);

// ── validadores por ranura ───────────────────────────────────────────────────
// El modelo pequeño alucina teléfonos y emails con una facilidad pasmosa; estos
// campos tienen forma comprobable, así que se comprueba.
const RE_TEL = /^\+?[\d\s.\-()]{7,20}$/;
const RE_MAIL = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i;
const RE_NOMBRE = /^[^\d@]{2,40}$/;
const VALIDADOR = {
  telefono: v => RE_TEL.test(v) && (v.match(/\d/g) || []).length >= 7,
  email: v => RE_MAIL.test(v),
  nombre: v => RE_NOMBRE.test(v) && v.trim().split(/\s+/).length <= 4,
};

// Dígitos de un texto contando los HABLADOS: por teléfono la gente dicta
// «seis uno uno dos…», y sin esto el teléfono bien extraído parecería inventado.
const NUM_ES = { cero: '0', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9' };
const digitosDe = t => norm(t).replace(/[a-z]+/g, w => (w in NUM_ES ? NUM_ES[w] : ' ')).replace(/\D/g, '');

// ¿Está el valor ANCLADO en lo que se ha dicho? Un dato que no aparece en la
// transcripción es, por definición, invención del modelo.
function anclado(valor, transcript) {
  if (!transcript) return true;                 // sin transcripción no se juzga
  const t = norm(transcript), digitosT = digitosDe(transcript);
  const digitos = String(valor).replace(/\D/g, '');
  if (digitos.length >= 6) return digitosT.includes(digitos);
  const ws = palabras(valor);
  if (!ws.length) return t.includes(norm(valor));
  return ws.some(w => t.includes(w));
}

// ── consejo ─────────────────────────────────────────────────────────────────
// Eco: el modelo repitiendo al cliente en vez de aconsejar al usuario.
function esEco(advice, transcript) {
  if (!transcript) return false;
  const a = palabras(advice);
  if (a.length < 3) return false;
  for (const linea of String(transcript).split('\n')) {
    const l = palabras(linea);
    if (l.length < 3) continue;
    const comunes = a.filter(w => l.includes(w)).length;
    if (comunes / a.length > 0.75 && Math.abs(a.length - l.length) <= 4) return true;
  }
  return false;
}
// Diálogo: el modelo haciendo de interlocutor («Hola, ¿en qué puedo ayudarle?»)
// en vez de soplarle al usuario qué decir.
const DIALOGO = /^(hola|buenos d[ií]as|buenas tardes|s[ií],? claro|por supuesto|encantad|gracias por|perfecto,? le)\b|¿en qu[eé] puedo ayudar/i;

/**
 * Parsea la respuesta del modelo contra la gramática de la skill.
 * @param {string} text  salida cruda del modelo
 * @param {object} sk    skill activa ({tag, kind, slots})
 * @param {object} ctx   {transcript} para anclar datos y detectar ecos
 * @returns {{advice:string, action:string, updates:object, rejected:string[]}}
 */
export function parse(text, sk, ctx = {}) {
  const s = String(text || '');
  const transcript = ctx.transcript || '';
  const rejected = [];

  // ── CONSEJO (libre, pero se tira si no es un consejo) ──
  // Exigir la marca: sin ella la respuesta es el modelo conversando, y eso NO es
  // un consejo. Se corta en el salto de línea (el modelo tiende a seguir).
  let advice = (s.match(/CONSEJO:\s*(.+)/i) || [])[1] || '';
  advice = advice.trim().replace(/^["'\u201c\u201d\s]+|["'\u201c\u201d\s]+$/g, '').trim();
  if (advice && (VACIO.test(advice) || advice.length < 4)) { rejected.push('consejo-vacio'); advice = ''; }
  if (advice && PLANTILLA.test(advice)) { rejected.push('consejo-plantilla'); advice = ''; }
  if (advice && DIALOGO.test(advice)) { rejected.push('consejo-dialogo'); advice = ''; }
  if (advice && esEco(advice, transcript)) { rejected.push('consejo-eco'); advice = ''; }
  if (advice.length > 220) advice = advice.slice(0, 217).replace(/\s+\S*$/, '') + '…';

  // ── ACCION (vocabulario CERRADO: aquí no se negocia) ──
  let action = '';
  const am = s.match(/ACCI[OÓ]N:\s*([a-záéíóúñ]+)/i);
  if (am) {
    const cand = norm(am[1]);
    if (ACCIONES.includes(cand)) action = cand;
    else rejected.push('accion-fuera-de-vocabulario');
  }

  // ── DATOS / OBJETIVOS (cada valor contra su ranura y contra lo dicho) ──
  const updates = {};
  const claves = new Set((sk.slots || []).map(x => x.key));
  const om = s.match(new RegExp(sk.tag + ':\\s*(.+)', 'i'));
  if (om) for (const par of om[1].split(';')) {
    const m = par.match(/\s*([\wáéíóúñÁÉÍÓÚÑ]+)\s*=\s*(.+)/);
    if (!m) continue;
    const key = norm(m[1]);
    const raw = m[2].trim().replace(/^["'\u201c]|["'\u201d]$/g, '').trim();
    if (!claves.has(key)) { rejected.push('ranura-inventada:' + key); continue; }
    if (sk.kind === 'goals') {
      if (/^(si|s|yes|y|true|1)$/i.test(norm(raw))) updates[key] = true;
      continue;
    }
    if (!raw || VACIO.test(raw) || PLANTILLA.test(raw)) { rejected.push('valor-plantilla:' + key); continue; }
    const val = VALIDADOR[key];
    if (val && !val(raw)) { rejected.push('valor-mal-formado:' + key); continue; }
    if (!anclado(raw, transcript)) { rejected.push('valor-inventado:' + key); continue; }
    updates[key] = raw;
  }
  return { advice, action, updates, rejected };
}

// Qué ranuras faltan (misma noción de «lleno» que el tablero).
export function faltan(sk, data = {}) {
  return (sk.slots || [])
    .filter(s => (sk.kind === 'goals' ? data[s.key] !== true : !(data[s.key] && String(data[s.key]).trim())))
    .map(s => s.label);
}

// Consejo determinista desde la ACCION (cerrada, fiable) + el tablero. Es lo que
// se dice cuando el modelo no ha producido un consejo utilizable: en cerebro
// ligero esto pasa a menudo y antes el copiloto se quedaba mudo.
export function fallbackAdvice(sk, data = {}, action = '') {
  const pend = faltan(sk, data);
  const dos = pend.slice(0, 2).join(' y ');
  switch (action) {
    case 'rebatir': return 'Hay una objeción: recógela, contesta corto y vuelve al hilo' + (pend.length ? ' — falta ' + dos + '.' : '.');
    case 'cerrar': return pend.length
      ? 'Antes de cerrar te falta ' + dos + '. Pídelo y propón el siguiente paso.'
      : 'Está todo: cierra proponiendo el siguiente paso concreto (día y hora).';
    case 'profundizar': return 'Tira de lo último que ha dicho antes de avanzar: pregúntale por qué.';
    case 'esperar': return 'Deja que termine. Escucha y no interrumpas.';
    case 'preguntar':
    default:
      return pend.length
        ? 'Pregunta ahora por ' + dos + '.'
        : 'Ya tienes todo lo que necesitas: cierra el siguiente paso.';
  }
}

// El contrato que se le pone al modelo. Vive aquí para que el prompt y el
// validador no puedan separarse: si cambia el formato, cambia en un sitio.
export function contrato(sk) {
  return `CONSEJO: <una línea accionable para el usuario, en su idioma>
ACCION: ${ACCIONES.join('|')}
${sk.rule}`;
}

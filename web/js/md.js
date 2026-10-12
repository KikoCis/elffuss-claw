// Markdown mínimo y SEGURO para el chat (estilo plugin de agente):
// escapa TODO el HTML primero y luego aplica transformaciones acotadas.
// Soporta: bloques de código con ```, `inline`, **negrita**, *cursiva* y _cursiva_,
// #### títulos, listas con - o numeradas, saltos de línea y ENLACES.
//
// Enlaces: [texto](destino) y URLs sueltas. Solo dos clases de destino:
//   · http:// y https:// → pestaña nueva, rel="noopener noreferrer" (la página
//     de fuera no puede tocar esta ni sabe de dónde vienes);
//   · rutas internas de Claw, «#/…» (ver rutas.js) → misma pestaña.
// Cualquier otro esquema (javascript:, data:, file:…) se queda como texto.
// Antes no había ninguna regla de enlace: ni una URL de web.fetch o web.search,
// ni las de las respuestas, se podían abrir desde el chat.
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SENT = '\u0000'; // centinela imposible en texto normal (el carácter NUL)
const attr = s => s.replace(/"/g, '&quot;');

// Sobre texto YA escapado (un & es &amp;, que es justo como debe ir dentro de
// href). Una URL acaba antes de espacio, comillas, < > o un signo de
// puntuación final (el punto de la frase no es parte de la URL).
const URL_SUELTA = /(^|[\s([«“])(https?:\/\/[^\s<>"'«»“”]+[^\s<>"'«»“”.,;:!?)\]])/g;

function enlace(href, texto) {
  if (/^https?:\/\//i.test(href)) return `<a href="${attr(href)}" target="_blank" rel="noopener noreferrer">${texto}</a>`;
  if (/^#\/[\w/%.\-]*$/.test(href)) return `<a href="${attr(href)}">${texto}</a>`;
  return null;
}

// Solo las URL sueltas, para texto plano (resultados de herramientas): escapa y
// enlaza, nada más.
export function linkify(text) {
  return esc(String(text)).replace(URL_SUELTA, (m, pre, url) => pre + enlace(url, url));
}

export function renderMarkdown(text) {
  // 1) apartar los bloques de código (no se tocan por dentro)
  const blocks = [];
  let t = String(text).replace(/```(\w*)[ \t]*\n?([\s\S]*?)(?:```|$)/g, (_, lang, body) => {
    blocks.push({ lang, body });
    return SENT + (blocks.length - 1) + SENT;
  });

  t = esc(t);
  // el código en línea también se aparta: dentro de `…` una URL es código, no enlace
  const inline = [];
  t = t.replace(/`([^`\n]+)`/g, (_, c) => { inline.push(c); return SENT + 'c' + (inline.length - 1) + SENT; });
  // [texto](destino): destino http(s) o #/ruta; si no, se deja tal cual
  const links = [];
  t = t.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,600})\)/g, (m, texto, href) => {
    const a = enlace(href, texto);
    if (!a) return m;
    links.push(a);
    return SENT + 'l' + (links.length - 1) + SENT;
  });
  t = t.replace(URL_SUELTA, (m, pre, url) => { links.push(enlace(url, url)); return pre + SENT + 'l' + (links.length - 1) + SENT; });
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  // _cursiva_ también (el informe del cerebro la usa y salían los guiones bajos
  // tal cual). Solo con espacio o paréntesis delante: un nombre_con_guiones de
  // código no se toca. El código en línea y los enlaces ya están apartados, así
  // que ni `f(_x_)` ni una URL con guiones bajos se tocan por dentro.
  t = t.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/gm, '$1<i>$2</i>');
  t = t.replace(/^#{1,6}\s*(.+)$/gm, '<h4>$1</h4>');
  t = t.replace(/^\s*[-•]\s+(.+)$/gm, '<li>$1</li>');
  t = t.replace(/^\s*\d+\.\s+(.+)$/gm, '<li class="num">$1</li>');
  t = t.replace(/(?:<li[^>]*>.*<\/li>\n?)+/g, m => '<ul>' + m.replace(/\n/g, '') + '</ul>');

  // saltos de línea: sin <br> pegado a etiquetas de bloque
  t = t.replace(/\n(?=<(?:ul|h4))/g, '').replace(/(<\/(?:ul|h4)>)\n/g, '$1');
  t = t.replace(/\n/g, '<br>');

  // 2) restaurar enlaces, código en línea y bloques de código
  t = t.replace(new RegExp(SENT + 'l(\\d+)' + SENT, 'g'), (_, i) => links[+i]);
  t = t.replace(new RegExp(SENT + 'c(\\d+)' + SENT, 'g'), (_, i) => `<code>${inline[+i]}</code>`);
  t = t.replace(new RegExp(SENT + '(\\d+)' + SENT, 'g'), (_, i) => {
    const { lang, body } = blocks[+i];
    return `<pre class="codeblock">${lang ? `<span class="lang">${esc(lang)}</span>` : ''}<code>${esc(body.replace(/\n$/, ''))}</code></pre>`;
  });
  return t;
}

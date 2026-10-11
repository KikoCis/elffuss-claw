// El markdown del chat (web/js/md.js), en Node: lo que se formatea y lo que no.
// Mismos casos que el md.mjs de Elffuss Code (md.js es compartido) más los
// enlaces, que solo tiene la copia de Claw.
//
// Lo que fallaba en las dos apps: el énfasis se aplicaba DENTRO del código
// `inline` (`def f(_x_)` salía como def f(<i>x</i>)) y _cursiva_ no se
// entendía. Aquí, además: una URL con guiones bajos no se convierte en cursiva,
// ni dentro de un enlace ni suelta.
//
//   node tests/md.mjs
//   MD_JS=<ruta a otra copia de md.js> node tests/md.mjs
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const AQUI = dirname(fileURLToPath(import.meta.url));
const { renderMarkdown: md, linkify } = await import(pathToFileURL(resolve(process.env.MD_JS || join(AQUI, '..', 'web', 'js', 'md.js'))).href);
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const es = (n, entrada, salida) => { const r = md(entrada); ok(n, r === salida, JSON.stringify(r)); };

es('el código inline no se toca por dentro: _x_ sigue siendo _x_', 'usa `def f(_x_): pass` aquí', 'usa <code>def f(_x_): pass</code> aquí');
es('…ni *asteriscos* dentro del código', '`a *b* c` y *fuera*', '<code>a *b* c</code> y <i>fuera</i>');
es('_cursiva_ y *cursiva* fuera del código sí', '_cursiva_ y *otra*', '<i>cursiva</i> y <i>otra</i>');
es('un nombre_con_guiones no se toca', 'usa nombre_con_guiones ya', 'usa nombre_con_guiones ya');
es('**negrita**, `código` y _cursiva_ juntas', '**negrita** `code` _i_', '<b>negrita</b> <code>code</code> <i>i</i>');
es('los bloques ``` siguen intactos', '```js\n_x_ *y*\n```', '<pre class="codeblock"><span class="lang">js</span><code>_x_ *y*</code></pre>');
es('el HTML se escapa, también dentro del código', '<b>`<i>`</b>', '&lt;b&gt;<code>&lt;i&gt;</code>&lt;/b&gt;');
es('títulos y listas', '#### Título\n- uno\n- dos', '<h4>Título</h4><ul><li>uno</li><li>dos</li></ul>');
es('dos códigos inline en la misma línea', '`a_b_` y `*c*`', '<code>a_b_</code> y <code>*c*</code>');
es('_cursiva_ al principio de otra línea', 'uno\n_dos_', 'uno<br><i>dos</i>');

// Enlaces (solo Claw): http(s) en pestaña nueva, rutas #/ en la misma, y nada más.
es('una URL suelta con guiones bajos es un enlace, sin cursiva', 'mira https://ejemplo.com/a_b_c ya',
  'mira <a href="https://ejemplo.com/a_b_c" target="_blank" rel="noopener noreferrer">https://ejemplo.com/a_b_c</a> ya');
es('[texto](url) con guiones bajos en la URL', '[la guía](https://ejemplo.com/_x_)',
  '<a href="https://ejemplo.com/_x_" target="_blank" rel="noopener noreferrer">la guía</a>');
es('una ruta interna #/… abre en la misma pestaña', '[tus apps](#/apps)', '<a href="#/apps">tus apps</a>');
es('javascript: no es un enlace', '[x](javascript:alert(1))', '[x](javascript:alert(1))');
es('una URL dentro de código no es un enlace', '`https://ejemplo.com/a_b`', '<code>https://ejemplo.com/a_b</code>');
ok('linkify (resultados de herramientas) escapa y enlaza, sin cursiva',
  linkify('<b> https://ejemplo.com/_a_ </b>') === '&lt;b&gt; <a href="https://ejemplo.com/_a_" target="_blank" rel="noopener noreferrer">https://ejemplo.com/_a_</a> &lt;/b&gt;',
  linkify('<b> https://ejemplo.com/_a_ </b>'));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ MARKDOWN OK — el código y los enlaces no se formatean por dentro');
process.exit(fails ? 1 : 0);

// Guardia: las etiquetas <function> no pueden estropear lo que escribe el modelo.
// ─────────────────────────────────────────────────────────────────────────────
// El parser recortaba cada <param> y, si el valor parecía JSON, lo parseaba. En
// producción desde b7d7db0, con MiniCPM5 ofrecido en la app. Tres daños:
//
//   · un fichero de `fs.write` o un HTML de `app.create` pierden la sangría de
//     la primera línea y el salto final;
//   · un valor entrecomillado pierde las comillas, y un contenido que parece
//     JSON llega como OBJETO —y quien lo escribe espera texto—;
//   · `vault.set.secret`: un secreto recortado o parseado se corrompe de una
//     forma que el usuario no puede depurar.
//
// Y un cuarto que aparece al ARREGLAR los otros tres: `skill.edit.append` es un
// booleano que funcionaba por accidente, porque `JSON.parse` convertía
// "true"/"false". Sin ese parseo, la cadena "false" sería verdadera y la skill
// se añadiría en vez de reemplazarse. Por eso el contrato tiene tres clases y no
// dos: quitar el parseo a ciegas rompía esto.
//
// `localStorage` se simula porque el árbol de módulos de Claw lo toca al
// importar; así esta guardia corre en Node y no pelea por la GPU con nadie.
const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k),
  clear: () => almacen.clear(),
  key: (i) => [...almacen.keys()][i] ?? null,
  get length() { return almacen.size; },
};

const { parseFunctionTags } = await import('../web/js/agent.js');
const { TOOLS, PARAM_EXACTO, PARAM_NUMERO, PARAM_BOOLEANO } = await import('../web/js/tools/index.js');

let fallos = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fallos++; };
const uno = (t) => parseFunctionTags(t)[0] || { tool: null, args: {} };
const ver = (s) => JSON.stringify(s);

// ── 1. El contenido de un fichero, tal cual.
const CUERPO = '  const a = 1\nexport { a }\n';
let c = uno(`<function name="fs.write"><param name="path">a.js</param><param name="content">${CUERPO}</param></function>`);
ok('1 · content conserva la sangría de la 1ª línea y el \\n final', c.args.content === CUERPO, ver(c.args.content));

// ── 2. Un HTML de app.create, igual: la primera línea importa.
const HTML = '  <!doctype html>\n  <h1>Hola</h1>\n';
c = uno(`<function name="app.create"><param name="name">demo</param><param name="html">${HTML}</param></function>`);
ok('2 · el html de app.create llega íntegro', c.args.html === HTML, ver(c.args.html));

// ── 3. Un contenido que PARECE JSON sigue siendo texto.
const JSONF = '{\n  "a": 1\n}\n';
c = uno(`<function name="fs.write"><param name="path">p.json</param><param name="content">${JSONF}</param></function>`);
ok('3 · un contenido con forma de JSON llega como TEXTO',
   typeof c.args.content === 'string' && c.args.content === JSONF, `${typeof c.args.content} ${ver(c.args.content)}`);

// ── 4. Un secreto, byte a byte: es lo que peor falla si se toca.
const SECRETO = '  sk-ABC "con comillas" y espacio final  ';
c = uno(`<function name="vault.set"><param name="name">api</param><param name="secret">${SECRETO}</param></function>`);
ok('4 · un secreto del vault llega EXACTO', c.args.secret === SECRETO, ver(c.args.secret));

// ── 5. El booleano se convierte de verdad, y "false" es falso.
c = uno('<function name="skill.edit"><param name="name">x</param><param name="instructions">y</param><param name="append">false</param></function>');
ok('5 · append="false" es FALSO (sin esto, la skill se añade en vez de reemplazarse)',
   c.args.append === false, ver(c.args.append));
c = uno('<function name="skill.edit"><param name="name">x</param><param name="instructions">y</param><param name="append">true</param></function>');
ok('5b · append="true" es verdadero', c.args.append === true, ver(c.args.append));

// ── 6. El numérico, número.
c = uno('<function name="tasks.add"><param name="inMinutes">30</param><param name="prompt">riega</param></function>');
ok('6 · inMinutes es un número', c.args.inMinutes === 30, ver(c.args.inMinutes));
c = uno('<function name="tasks.add"><param name="inMinutes">pronto</param><param name="prompt">x</param></function>');
ok('6b · un numérico no numérico NO se vuelve NaN en silencio', !Number.isNaN(c.args.inMinutes), ver(c.args.inMinutes));

// ── 7. Un escalar sí se recorta.
c = uno('<function name="fs.read"><param name="path">\n  notas.txt\n</param></function>');
ok('7 · path se recorta', c.args.path === 'notas.txt', ver(c.args.path));

// ── 8. CDATA.
c = uno('<function name="fs.write"><param name="path">a.md</param><param name="content"><![CDATA[usa </param> aquí]]></param></function>');
ok('8 · con CDATA el contenido puede llevar </param>', c.args.content === 'usa </param> aquí', ver(c.args.content));

// ── 9. El contrato no puede derivar.
const huerfanos = [];
for (const [mapa, nombre] of [[PARAM_EXACTO, 'PARAM_EXACTO'], [PARAM_NUMERO, 'PARAM_NUMERO'], [PARAM_BOOLEANO, 'PARAM_BOOLEANO']]) {
  for (const [herr, params] of Object.entries(mapa)) {
    if (!TOOLS[herr]) { huerfanos.push(`${nombre}: la herramienta ${herr} no existe`); continue; }
    for (const p of params) if (!(p in TOOLS[herr].params)) huerfanos.push(`${nombre}: ${herr}.${p} no es un parámetro`);
  }
}
ok('9 · cada excepción del contrato apunta a un parámetro real', huerfanos.length === 0, huerfanos.join(' · '));

console.log(fallos ? `\n❌ ${fallos} FALLO(S)` : '\n✅ las etiquetas <function> no estropean lo que escribe el modelo');
process.exit(fallos ? 1 : 0);

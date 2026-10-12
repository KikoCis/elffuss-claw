// Guardia: el prompt de Claw tiene que transformar el fichero aquí, no proponer
// Python — que además NO existe en Claw.
// ─────────────────────────────────────────────────────────────────────────────
// Bug real reportado con la transcripción delante (ocurrió en Code, con la misma
// causa): le pidieron escalar un STL al doble y el modelo contestó que sus
// herramientas «son solo código, texto y comandos de shell», que haría falta
// Blender o numpy-stl, y acabó preguntando si estaba instalado en vez de hacerlo.
//
// En Claw es peor que en Code, porque Claw NO TIENE shell: no hay terminal.run ni
// nada que instale un paquete. Proponer Python aquí es ofrecer algo que no puede
// existir. Su «consola» es app.create: HTML, CSS y JavaScript en el navegador.
//
// Determinista, sin modelo: se lee el prompt y se comprueba qué dice.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8798';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const b = await chromium.launch(); const ctx = await b.newContext();
const p = await ctx.newPage();
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
const sp = await p.evaluate(async () => {
  const a = await import('/js/agent.js');
  return a.systemPrompt ? a.systemPrompt('') : (a.promptSistema ? a.promptSistema('') : '');
});

ok('⊕ control positivo: el prompt está cargado', sp.length > 1500, `${sp.length} caracteres`);
ok('hay una regla sobre TRANSFORMAR o CALCULAR sobre un fichero', /TRANSFORMAR o CALCULAR sobre un fichero/.test(sp));
ok('dice que un fichero son BYTES que fs.read/fs.write leen y escriben', /un fichero son BYTES/i.test(sp));
ok('prohíbe contestar «no sirven para esto» y parar', /no sirven para esto/.test(sp));
ok('camino de texto: fs.read → transformar → fs.write', /fs\.read, lo transformas t[úu] y fs\.write/.test(sp));
ok('camino de cálculo: app.create como consola', /app\.create con una p[áa]gina que lo haga en el navegador/.test(sp));
ok('dice cuál ES su consola: HTML, CSS y JavaScript', /Esa ES tu consola: HTML, CSS y JavaScript/.test(sp));

// Lo específico de Claw: no hay shell, así que proponer Python es imposible.
ok('avisa de que aquí NO hay shell ni Python', /NO hay shell ni Python/.test(sp));
ok('dice que no existe terminal.run', /no existe terminal\.run/.test(sp));
ok('prohíbe proponer una librería de terceros', /NUNCA propongas una librer[íi]a de terceros/.test(sp));
ok('nombra el caso exacto que falló (numpy-stl)', /numpy-stl/.test(sp));
ok('prohíbe ofrecerse y esperar', /ni te ofrezcas y esperes/.test(sp));
ok('da la salida concreta: escalar un STL es multiplicar números', /escalar un STL es multiplicar n[úu]meros/.test(sp));

// Y que no se haya colado una herramienta que Claw no tiene.
ok('NO promete terminal.run como algo usable', !/usa terminal\.run|con terminal\.run «/.test(sp));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ el prompt de Claw transforma con lo que tiene');
await b.close(); process.exit(fails ? 1 : 0);

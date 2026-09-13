// ¿Deja el recuperador la herramienta buena a la vista del modelo?
// ─────────────────────────────────────────────────────────────────────────────
// Banco SIN modelo: mide solo la recuperación. Si el recuperador duda y manda el
// catálogo entero, acierta por definición — por eso se informa aparte de cuántas
// veces pasa: un recuperador que siempre manda todo acierta el 100 % y no ahorra
// nada.
//
// QUÉ ES ACERTAR. En `esperado` van las familias que sirven para resolver la
// petición, y eso significa dos cosas distintas según el caso:
//   · compuesta («busca recetas y guárdalas») → hacen falta TODAS;
//   · el resto → son ALTERNATIVAS: «¿cuál era mi token?» se resuelve con vault
//     o con memory, y basta con que esté una.
// La primera versión exigía todas siempre, y contaba como fallo del recuperador
// lo que era un error de la definición.
//
// Cada cambio del recuperador se mide POR SEPARADO (tabla de configuraciones),
// para saber qué aporta cada uno en vez de quedarse con el total.
//
//   node tests/enrutado-herramientas.mjs
//   node tests/enrutado-herramientas.mjs --vocab ~/llama.cpp/models/ggml-vocab-qwen35.gguf   # tokens reales
//   node tests/enrutado-herramientas.mjs --casos tests/enrutado-herramientas.ciego.cases.json
//
// El catálogo se lee del FUENTE de tools/index.js, no importándolo: ese módulo
// toca localStorage al cargarse y en node no existe.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(AQUI, '..', 'web', 'js');
const { crearRouter, familiaDe } = await import(path.join(WEB, 'tool-router.js'));
const { estimateTokens } = await import(path.join(WEB, 'acer-core.js'));

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const CASOS = path.resolve(arg('--casos', path.join(AQUI, 'enrutado-herramientas.cases.json')));
const VOCAB = arg('--vocab', null)?.replace(/^~/, process.env.HOME);

function catalogo() {
  const src = fs.readFileSync(path.join(WEB, 'tools', 'index.js'), 'utf8');
  const re = /'([a-z]+\.[a-zA-Z_]+)'\s*:\s*\{\s*desc:\s*'((?:[^'\\]|\\.)*)',\s*params:\s*\{([^}]*)\}/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    const claves = [...m[3].matchAll(/(\w+)\s*:/g)].map(x => x[1]);
    out.push(`- ${m[1]}(${claves.join(', ')}): ${m[2]}`);
  }
  return out;
}

// Tokens reales con llama-tokenize si se da --vocab; si no, estimación. Un cero
// NO se acepta como dato: en esta misma investigación un symlink roto devolvió
// «0 tokens» para todo el prompt y casi se lee como una medida.
const cacheTok = new Map();
let sinBos = true;
function tokens(s) {
  if (!VOCAB) return estimateTokens(s);
  if (cacheTok.has(s)) return cacheTok.get(s);
  const run = extra => execFileSync('llama-tokenize',
    ['-m', VOCAB, '-p', s, '--ids', '--log-disable', ...extra],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let out;
  try { out = run(sinBos ? ['--no-bos'] : []); }
  catch (e) { if (!sinBos) throw e; sinBos = false; out = run([]); }
  const m = out.match(/\[([\d,\s]*)\]/);
  const n = m ? (m[1].match(/\d+/g) || []).length : 0;
  if (!n) throw new Error('llama-tokenize no devolvió ids (¿modelo accesible?) para: ' + s.slice(0, 50));
  cacheTok.set(s, n);
  return n;
}

const casos = JSON.parse(fs.readFileSync(CASOS, 'utf8')).casos;
const lineas = catalogo();
if (lineas.length < 20) throw new Error(`solo se han leído ${lineas.length} herramientas del fuente: el patrón ya no casa`);
const todas = [...new Set(lineas.map(familiaDe))];
const tokLinea = new Map(lineas.map(l => [l, tokens(l)]));
const tokTodo = lineas.reduce((a, l) => a + tokLinea.get(l), 0);
const tipos = [...new Set(casos.map(c => c.tipo))];

const acierta = (c, vistas) => c.tipo === 'compuesto'
  ? c.esperado.every(f => vistas.includes(f))
  : c.esperado.length === 0 || c.esperado.some(f => vistas.includes(f));

const CONFIGS = [
  { nombre: 'base', o: { vacias: false, siempre: [], sinSenal: 'todo' } },
  { nombre: '+vacías', o: { vacias: true, siempre: [], sinSenal: 'todo' } },
  { nombre: '+web siempre', o: { vacias: false, siempre: ['web'], sinSenal: 'todo' } },
  { nombre: '+vacías +web', o: { vacias: true, siempre: ['web'], sinSenal: 'todo' }, detalle: true },
  { nombre: '+vacías +web · sin señal→solo web', o: { vacias: true, siempre: ['web'], sinSenal: 'nada' }, detalle: true },
];

console.log(`catálogo: ${lineas.length} herramientas, ${todas.length} familias, ${tokTodo} tokens ${VOCAB ? '(tokenizador real)' : '(estimados)'}`);
console.log(`casos: ${casos.length} (${path.basename(CASOS)}) · tipos: ${tipos.join(', ')}\n`);

const cab = ['configuración'.padEnd(36), 'aciertos', ' entero', 'tok', 'ahorro', ...tipos.map(t => t.slice(0, 8).padStart(8))];
console.log('  ' + cab.join('  '));
const detalles = [];
for (const cfg of CONFIGS) {
  const router = crearRouter(lineas, cfg.o);
  let ok = 0, respaldo = 0, tok = 0;
  const porTipo = Object.fromEntries(tipos.map(t => [t, { n: 0, ok: 0 }]));
  const fallos = [];
  for (const c of casos) {
    const r = router.rutear(c.q);
    const vistas = r ? r.familias : todas;
    const t = r ? r.lineas.reduce((a, l) => a + tokLinea.get(l), 0) : tokTodo;
    const bien = acierta(c, vistas);
    porTipo[c.tipo].n++;
    if (bien) { ok++; porTipo[c.tipo].ok++; } else fallos.push({ c, vistas, top: r?.puntuaciones.slice(0, 3) || [] });
    if (!r) respaldo++;
    tok += t;
  }
  const media = Math.round(tok / casos.length);
  const fila = [
    cfg.nombre.padEnd(36),
    `${ok}/${casos.length}`.padStart(8),
    `${Math.round(100 * respaldo / casos.length)}%`.padStart(7),
    String(media).padStart(3),
    `${Math.round(100 * (tokTodo - media) / tokTodo)}%`.padStart(6),
    ...tipos.map(t => `${porTipo[t].ok}/${porTipo[t].n}`.padStart(8)),
  ];
  console.log('  ' + fila.join('  '));
  if (cfg.detalle) detalles.push({ nombre: cfg.nombre, fallos });
}
console.log(`\n  entero = % de peticiones en las que el recuperador duda y manda el catálogo completo (${tokTodo} tokens)`);

for (const d of detalles) {
  console.log(`\n── fallos de «${d.nombre}» (${d.fallos.length}): la familia buena NO se le enseña al modelo`);
  for (const f of d.fallos) {
    const top = f.top.map(p => `${p.familia} ${p.s.toFixed(2)}`).join(', ');
    console.log(`   ✗ [${f.c.tipo}/${f.c.idioma}] «${f.c.q}» esperaba ${JSON.stringify(f.c.esperado)} · vio ${JSON.stringify(f.vistas)}${top ? ' · ' + top : ''}`);
  }
}

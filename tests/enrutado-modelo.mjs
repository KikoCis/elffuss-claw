// ¿Llama un modelo REAL a la herramienta buena cuando ve menos herramientas?
// ─────────────────────────────────────────────────────────────────────────────
// tests/enrutado-herramientas.mjs mide si la familia buena QUEDA A LA VISTA.
// Esto mide lo que de verdad importa: si el MODELO llama a la herramienta
// correcta con el catálogo entero o con el recortado. La literatura de
// harnesses de 2026 dice que con menos herramientas un modelo pequeño elige
// mejor; aquí se comprueba con los dos cerebros de Elffuss en vez de creérselo.
//
//   node tests/enrutado-modelo.mjs                      # e4b-swe y Qwen3.5-0.8B por ollama
//   MODELOS=e4b-swe:latest node tests/enrutado-modelo.mjs
//   node tests/enrutado-modelo.mjs --casos tests/enrutado-herramientas.cases.json
//
// Mismo prompt de sistema que la app —persona, reglas y ejemplos leídos de
// agent.js—, temperatura 0 y semilla fija. Lo ÚNICO que cambia entre las dos
// condiciones es el bloque de HERRAMIENTAS. Cuando el recuperador duda y manda
// el catálogo entero, las dos condiciones son idénticas y se genera una sola vez.
//
// El orden de las dos condiciones se ALTERNA por caso: ollama reutiliza el
// prefijo del prompt anterior, y siempre la misma primero regalaría caché a la
// segunda.
//
// De la respuesta solo se saca la FAMILIA de la primera llamada, con los mismos
// tres formatos que acepta parseToolCall (bloque ```tool con JSON, llamada nativa
// de LFM y documento HTML → app). No se importa agent.js porque arrastra módulos
// que tocan localStorage al cargarse.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(AQUI, '..', 'web', 'js');
const { crearRouter } = await import(path.join(WEB, 'tool-router.js'));

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const MODELOS = (process.env.MODELOS || 'e4b-swe:latest,hf.co/ggml-org/Qwen3.5-0.8B-GGUF:Q8_0').split(',');
const OLLAMA = process.env.OLLAMA || 'http://127.0.0.1:11434';
const CASOS = path.resolve(arg('--casos', path.join(AQUI, 'enrutado-herramientas.ciego.cases.json')));
const SALIDA = arg('--salida', null);

function catalogo() {
  const src = fs.readFileSync(path.join(WEB, 'tools', 'index.js'), 'utf8');
  const re = /'([a-z]+\.[a-zA-Z_]+)'\s*:\s*\{\s*desc:\s*'((?:[^'\\]|\\.)*)',\s*params:\s*\{([^}]*)\}/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    const claves = [...m[3].matchAll(/(\w+)\s*:/g)].map(x => x[1]);
    out.push(`- ${m[1]}(${claves.join(', ')}): ${m[2]}`);
  }
  if (out.length < 20) throw new Error(`solo ${out.length} herramientas leídas: el patrón ya no casa`);
  return out;
}

// El prompt de la app, con el bloque de herramientas como hueco.
function plantilla() {
  const a = fs.readFileSync(path.join(WEB, 'agent.js'), 'utf8');
  const ini = a.indexOf('Eres Elffuss: un sistema operativo con alma que vive en el navegador del usuario. Cálida y luminosa, pero tremendamente');
  const fin = a.indexOf('${skillsPromptBlock()}', ini);
  if (ini < 0 || fin < 0) throw new Error('no encuentro el prompt completo en agent.js');
  const t = a.slice(ini, fin).replace(/\\`/g, '`');
  const h = t.indexOf('HERRAMIENTAS');
  const tras = t.indexOf('\n', h) + 1;
  const reglas = t.indexOf('\n\nCómo actuar:');
  if (h < 0 || reglas < 0) throw new Error('no encuentro el bloque de herramientas en el prompt');
  // Los casos son mayoritariamente en español: se fija el idioma de la persona.
  const antes = t.slice(0, tras).replace('${lang.name}', 'español').replace('${lang.code}', 'es');
  const despues = t.slice(reglas);
  return lineas => antes + lineas.join('\n') + despues;
}

function familiaLlamada(texto) {
  const t = String(texto || '');
  const nativa = t.match(/<\|tool_call_start\|>\s*\[?\s*([a-z]+)\.[a-z_]+/i);
  if (nativa) return nativa[1].toLowerCase();
  const json = t.match(/"tool"\s*:\s*"([a-z]+)\.[a-z_]+"/i);
  if (json) return json[1].toLowerCase();
  if (/```html/i.test(t) || /^\s*(<!doctype html|<html)/i.test(t)) return 'app';
  return null;
}

const sinThink = new Map();   // modelo → true si acepta think:false
async function chat(modelo, sistema, usuario) {
  const cuerpo = think => JSON.stringify({
    model: modelo, stream: false, keep_alive: '30m',
    ...(think ? { think: false } : {}),
    options: { temperature: 0, seed: 1, num_predict: 200 },
    messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
  });
  const pedir = async think => fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: cuerpo(think) });
  let usarThink = sinThink.has(modelo) ? sinThink.get(modelo) : true;
  let r = await pedir(usarThink);
  if (!r.ok && usarThink) {
    const err = await r.text();
    if (/think/i.test(err)) { usarThink = false; r = await pedir(false); }
    else throw new Error(`ollama ${r.status}: ${err.slice(0, 200)}`);
  }
  sinThink.set(modelo, usarThink);
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return { texto: d.message?.content || '', pe: d.prompt_eval_count || 0, ped: (d.prompt_eval_duration || 0) / 1e6 };
}

const acierta = (c, fam) => c.esperado.length === 0 ? fam === null : (fam !== null && c.esperado.includes(fam));

const casos = JSON.parse(fs.readFileSync(CASOS, 'utf8')).casos;
const lineas = catalogo();
const prompt = plantilla();
const router = crearRouter(lineas);           // los valores por defecto: los de la app
const promptEntero = prompt(lineas);

console.log(`casos: ${casos.length} (${path.basename(CASOS)}) · modelos: ${MODELOS.join(', ')}\n`);
const resultados = {};

for (const modelo of MODELOS) {
  const filas = [];
  let i = 0;
  for (const c of casos) {
    const r = router.rutear(c.q);
    const recortado = r ? prompt(r.lineas) : null;
    const orden = (i++ % 2 === 0) ? ['entero', 'recortado'] : ['recortado', 'entero'];
    const res = {};
    for (const cond of orden) {
      if (cond === 'recortado' && !recortado) continue;
      res[cond] = await chat(modelo, cond === 'entero' ? promptEntero : recortado, c.q);
    }
    if (!recortado) res.recortado = res.entero;        // el recuperador dudó: son el mismo prompt
    const fe = familiaLlamada(res.entero.texto), fr = familiaLlamada(res.recortado.texto);
    filas.push({ c, ruta: r ? r.familias : null, fe, fr, oke: acierta(c, fe), okr: acierta(c, fr), pe: [res.entero.pe, res.recortado.pe], ped: [res.entero.ped, res.recortado.ped] });
    process.stdout.write(`\r  ${modelo.slice(0, 28).padEnd(28)} ${i}/${casos.length}`);
  }
  process.stdout.write('\n');
  resultados[modelo] = filas;

  const herr = filas.filter(f => f.c.esperado.length), charla = filas.filter(f => !f.c.esperado.length);
  const cuenta = (xs, k) => xs.filter(f => f[k]).length;
  const media = (xs, j, k) => Math.round(xs.reduce((a, f) => a + f[k][j], 0) / (xs.length || 1));
  const difieren = filas.filter(f => f.ruta);
  console.log(`  condición   acierta herramienta   charla sin llamar   prompt evaluado (tok)   prefill (ms)`);
  for (const [j, cond, k] of [[0, 'entero', 'oke'], [1, 'recortado', 'okr']]) {
    console.log(`  ${cond.padEnd(10)}  ${`${cuenta(herr, k)}/${herr.length}`.padStart(19)}   ${`${cuenta(charla, k)}/${charla.length}`.padStart(17)}   ${String(media(filas, j, 'pe')).padStart(21)}   ${String(media(filas, j, 'ped')).padStart(12)}`);
  }
  const gana = difieren.filter(f => f.okr && !f.oke), pierde = difieren.filter(f => f.oke && !f.okr);
  console.log(`  casos con catálogo recortado: ${difieren.length} · recortado acierta y entero no: ${gana.length} · entero acierta y recortado no: ${pierde.length}`);
  for (const [nombre, xs] of [['+ recortado', gana], ['- recortado', pierde]])
    for (const f of xs) console.log(`    ${nombre}  «${f.c.q.slice(0, 70)}» esperaba ${JSON.stringify(f.c.esperado)} · entero→${f.fe} · recortado→${f.fr} (vio ${JSON.stringify(f.ruta)})`);
  console.log();
}

if (SALIDA) fs.writeFileSync(SALIDA, JSON.stringify(resultados, null, 1));

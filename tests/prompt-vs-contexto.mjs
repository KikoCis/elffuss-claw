// ¿Cabe lo que Elffuss le dice al modelo en el contexto que el modelo tiene?
// ─────────────────────────────────────────────────────────────────────────────
// El humo de producción del 27B destapó que no: carga entero —lo que tarda en
// bajar y subir a la GPU 7,6 GB— y luego el primer mensaje muere con «la caché
// se llena: 1333 tokens sobre 512». Este test lo caza sin esa espera y sin
// bajarse los 7,6 GB:
//
//   · el prompt se ARMA en la app (local, con el código que se está tocando),
//   · y se MIDE con el tokenizador de verdad del 27B, que sale de la cabecera
//     del GGUF servido en producción — `parseGGUF` lee por rangos y el
//     vocabulario vive en los metadatos, no en los pesos: ~16 MB, no 7,6 GB.
//
//   python3 server/serve.py &   # sirve web/ (LOCAL=http://localhost:8642)
//   node tests/prompt-vs-contexto.mjs
import { chromium } from 'playwright';

const LOCAL = process.env.LOCAL || 'http://localhost:8642';
const PROD = process.env.PROD || 'https://claw.elffuss.utopiaia.com';
const CTX = +(process.env.CTX || 512);            // el registrado para el 27B
// Margen para lo que escribe el usuario y para la respuesta. Sin él «cabe» un
// prompt que no deja sitio para contestar, y entonces el fallo aparece a mitad
// de la generación —con la respuesta ya perdida— en vez de al empezar.
const MARGEN = 160;

let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  console.log((cond ? '✅' : '❌') + ' ' + nombre + (extra ? '  — ' + extra : ''));
  if (!cond) fallos++;
};

const b = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const semilla = () => {
  try {
    localStorage.setItem('elffuss.model', 'rules');   // sin descargar ningún modelo
    localStorage.setItem('elffuss.welcomed', '1');
    localStorage.setItem('elffuss.grants', JSON.stringify(['apps', 'tasks', 'vault', 'web', 'memory', 'fs']));
  } catch { /* — */ }
};

async function abrir(base) {
  const ctx = await b.newContext({ locale: 'es-ES' });
  await ctx.addInitScript(semilla);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('   pageerror(' + base + '): ' + String(e.message).slice(0, 110)));
  await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  return p;
}

// ---- 1 · armar los prompts con el código LOCAL -----------------------------
const local = await abrir(LOCAL);
const textos = await local.evaluate(async () => {
  const { systemPrompt } = await import('./js/agent.js');
  const { toolHelp, snapshot } = await import('./js/tools/index.js');
  const { skillsPromptBlock } = await import('./js/skills.js');
  const contexto = await snapshot().catch(() => '');
  return {
    completo: systemPrompt(contexto),
    compacto: systemPrompt(contexto, { compacto: true }),
    herramientas: toolHelp(),
    skills: skillsPromptBlock(),
    contexto,
  };
});

// ---- 2 · medirlos con el tokenizador del 27B de producción -----------------
const prod = await abrir(PROD);
const tokens = await prod.evaluate(async textos => {
  const { parseGGUF } = await import('./js/engine/gguf.js');
  const { createTokenizer } = await import('./js/engine/tokenizer.js');
  const url = new URL('/models/qwen38-27b.gguf', location.href).href;
  const cabeza = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  if (cabeza.status !== 206) return { error: 'el servidor del modelo no da 206: ' + cabeza.status };
  const size = +cabeza.headers.get('content-range').split('/')[1];
  const ranged = {
    size,
    async slice(off, len) {
      if (len <= 0) return new ArrayBuffer(0);
      const r = await fetch(url, { headers: { Range: `bytes=${off}-${Math.min(off + len, size) - 1}` } });
      return await r.arrayBuffer();
    },
  };
  const tk = createTokenizer((await parseGGUF(ranged)).meta);
  const out = {};
  for (const [k, v] of Object.entries(textos)) out[k] = v ? tk.encode(v).length : 0;
  return out;
}, textos);

if (tokens.error) { console.log('❌ ' + tokens.error); await b.close(); process.exit(1); }

console.log(`Tokens del prompt de sistema (tokenizador real del 27B) · contexto del modelo: ${CTX}`);
for (const [k, v] of Object.entries(tokens)) console.log(`  ${k.padEnd(13)} ${String(v).padStart(5)}`);

ok('el prompt COMPLETO no cabe en un modelo de contexto corto',
  tokens.completo > CTX, `${tokens.completo} tokens sobre ${CTX} — por esto fallaba el 27B en producción`);
ok('el prompt COMPACTO cabe dejando sitio para preguntar y responder',
  tokens.compacto + MARGEN <= CTX, `${tokens.compacto} + ${MARGEN} de margen sobre ${CTX}`);
ok('el compacto no es una cáscara vacía',
  tokens.compacto > 40, `${tokens.compacto} tokens`);

// ---- 3 · la CADENA: ¿el agente elige el corto con el 27B delante? ----------
// Que el prompt corto quepa no sirve de nada si nadie lo elige. Este trozo
// recorre el mismo camino que la app —configurar el proveedor, preguntarle su
// contexto, aplicar el umbral— y NO carga los 7,6 GB: `configure` solo apunta a
// una entrada del registro, y el contexto es un dato de esa entrada.
const cadena = await local.evaluate(async () => {
  const prov = await import('./js/engine/provider.js');
  const { CTX_MINIMO_COMPLETO } = await import('./js/agent.js');
  prov.configure('qwen38-27b');
  const ctx27 = prov.contextTokens();
  prov.configure('qwen35-0.8b');
  const ctx08 = prov.contextTokens();
  return { ctx27, ctx08, umbral: CTX_MINIMO_COMPLETO };
}).catch(e => ({ error: String(e.message).slice(0, 140) }));

if (cadena.error) ok('el proveedor sabe decir su contexto', false, cadena.error);
else {
  ok('el proveedor dice el contexto del 27B sin cargar el modelo',
    cadena.ctx27 === CTX, `${cadena.ctx27} tokens`);
  ok('con ese contexto el agente elige el prompt COMPACTO',
    cadena.ctx27 > 0 && cadena.ctx27 < cadena.umbral, `${cadena.ctx27} < ${cadena.umbral}`);
  // La otra mitad del umbral: al 0.8B no se le recorta nada. Sin esto, un umbral
  // demasiado alto dejaría a Elffuss sin herramientas en modelos que sí las
  // aguantan, y el test seguiría en verde.
  ok('al 0.8B NO se le recorta: mantiene herramientas',
    cadena.ctx08 >= cadena.umbral, `${cadena.ctx08} ≥ ${cadena.umbral}`);
}

await b.close();
console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo verde');
process.exit(fallos ? 1 : 0);

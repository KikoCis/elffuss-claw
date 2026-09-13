// LiteRT (Gemma E4B) de verdad en el navegador: ¿qué pasa cuando un resultado no cabe?
// ─────────────────────────────────────────────────────────────────────────────
// tests/litert-contexto.mjs prueba el guardia con un motor de mentira. Esto lo
// prueba con el de verdad, que es el que decide si al desbordarse falla, trunca
// o se cuelga. Llama al proveedor directamente con un historial preparado —sin
// la UI ni el permiso de carpetas— sobre una página vacía del mismo origen, y
// sirve web/ desde disco. Con REV=<commit> sirve litert.js de ese commit: el
// mismo guion mide el comportamiento de antes.
//
//   node tests/litert-desborde.mjs                 # el código de ahora
//   REV=3b3fd3d node tests/litert-desborde.mjs     # litert.js de antes del guardia
//   PERFIL=/ruta node tests/litert-desborde.mjs    # el modelo (~3 GB) se baja una vez por perfil
//   SOLO_DESCARGA=1 PERFIL=/ruta node tests/litert-desborde.mjs   # solo lo baja al perfil, sin GPU
//
// Pesado de GPU: coger antes el cerrojo de ~/.gpu_coordination/gpu-lock.sh.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'web');
const REV = process.env.REV || '';
const PERFIL = process.env.PERFIL || join(tmpdir(), 'elffuss-litert-perfil');
const PUERTO = +(process.env.PUERTO || 8644);
const MODELO = process.env.MODELO || 'gemma-e4b';
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
};

const server = createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    let cuerpo;
    if (ruta === '/__prueba.html') cuerpo = '<!doctype html><meta charset="utf-8"><title>prueba litert</title>';
    else if (REV && ruta === '/js/providers/litert.js')
      cuerpo = execFileSync('git', ['show', `${REV}:web/js/providers/litert.js`], { cwd: join(WEB, '..') });
    else cuerpo = readFileSync(join(WEB, normalize(ruta).replace(/^(\.\.[/\\])+/, '')));
    res.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(cuerpo);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise(r => server.listen(PUERTO, r));
console.log(`litert.js: ${REV ? 'commit ' + REV : 'el de ahora'} · modelo ${MODELO}`);

const ctx = await chromium.launchPersistentContext(PERFIL, { channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const p = ctx.pages()[0] || await ctx.newPage();
p.on('console', m => { if (/\[litert\]|\[elffuss\]/.test(m.text())) console.log('   consola:', m.text().slice(0, 220)); });
await p.goto(`http://localhost:${PUERTO}/__prueba.html`);

// Bajar el modelo no usa la GPU: se hace aparte para no gastar en la descarga el
// turno del cerrojo. Mismo origen y mismo perfil que la medición, que es lo que
// hace que luego lo encuentre guardado.
if (process.env.SOLO_DESCARGA) {
  const bytes = await p.evaluate(async (modelo) => {
    const L = await import('/js/providers/litert.js');
    L.configure(modelo);
    let visto = 0;
    const b = await L.cachedModelBlob(L.MODELS[modelo].url, s => {
      const n = +((/(\d+)\s*%/.exec(String(s)) || [])[1] || 0);
      if (n >= visto + 10) { visto = n; console.log('[elffuss] descarga ' + String(s).slice(0, 80)); }
    });
    return typeof b === 'string' ? -1 : b.size;
  }, MODELO);
  console.log(bytes > 0 ? `modelo guardado en el perfil (${Math.round(bytes / 1048576)} MB)` : 'el modelo NO quedó guardado en el perfil');
  await ctx.close(); server.close();
  process.exit(bytes > 0 ? 0 : 1);
}

const r = await p.evaluate(async (modelo) => {
  const L = await import('/js/providers/litert.js');
  const { systemPrompt } = await import('/js/agent.js');
  L.configure(modelo);
  let carga = '';
  await L.load(s => { carga = String(s); });
  const sistema = systemPrompt('', {});
  const h = [], pasos = [];
  const turno = async (nombre, mensajes) => {
    h.push(...mensajes);
    try {
      const out = await L.chat(h, sistema);
      h.push({ role: 'assistant', content: out });
      pasos.push({ nombre, ok: true, out });
    } catch (e) {
      pasos.push({ nombre, ok: false, error: String(e?.message || e) });
    }
  };
  // Un informe de ~240.000 caracteres —más que cualquier contexto de la escalera—
  // con un dato marcado al principio y otro al final.
  const filas = Array.from({ length: 3000 }, (_, i) =>
    `Línea ${i}: gasto de la partida ${i % 37} en el departamento ${i % 11}, importe ${(i * 7.31).toFixed(2)} euros.`).join('\n');
  const informe = 'INFORME ANUAL. Dato del principio: la clave de la caja fuerte es PELICANO-42.\n' + filas +
    '\nDato del final: la reunión de cierre es el jueves 17 en la sala Orión.';
  await turno('1 · saludo con un dato', [{ role: 'user', content: 'Hola, me llamo Marta y soy alérgica al kiwi.' }]);
  await turno('2 · resultado enorme', [
    { role: 'user', content: 'Léeme el informe anual y dime en qué sala es la reunión de cierre.' },
    { role: 'assistant', content: '```tool\n{"tool": "fs.read", "args": {"path": "informe.txt"}}\n```' },
    { role: 'user', content: '[resultado fs.read]\n' + informe },
  ]);
  await turno('3 · seguimiento', [{ role: 'user', content: '¿Y cuál era la clave de la caja fuerte que salía al principio del informe?' }]);
  await turno('4 · dato del turno 1', [{ role: 'user', content: '¿A qué fruta te dije que soy alérgica?' }]);
  return { contexto: L.ctxTokens, carga, pasos };
}, MODELO);

console.log(`contexto del motor: ${r.contexto} tokens\n`);
const espera = { '2 · resultado enorme': /ori[oó]n/i, '3 · seguimiento': /pelicano/i, '4 · dato del turno 1': /kiwi/i };
for (const s of r.pasos) {
  const acierta = s.ok && (!espera[s.nombre] || espera[s.nombre].test(s.out));
  console.log(`${s.ok ? (acierta ? '✅' : '🟡') : '❌'} ${s.nombre}: ${s.ok ? '«' + s.out.replace(/\s+/g, ' ').slice(0, 160) + '»' : 'ERROR ' + s.error.slice(0, 200)}`);
}
console.log('\n✅ contesta y acierta · 🟡 contesta pero no acierta · ❌ falla');
await ctx.close();
server.close();

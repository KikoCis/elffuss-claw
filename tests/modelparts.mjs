// Almacén de modelos PARTIDO en OPFS: un modelo de varios GB no cabe en un solo
// fichero — el navegador corta muy por debajo de la cuota que anuncia—, así que
// se guarda en trozos. Lo que se prueba aquí es la aritmética de fronteras, que
// es donde están los fallos posibles:
//   · un chunk de red que cae a caballo de dos partes debe repartirse
//   · un rango leído a caballo de dos (o tres) partes debe salir byte a byte
//     idéntico al fichero original
// Con un fixture determinista (byte[i] = i%251) y el tamaño de parte bajado por
// el hook de test: con 1 GiB de verdad habría que bajar gigabytes para tocar
// una sola frontera.
import { chromium } from 'playwright';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8788';
const SIZE = 655321;          // 6 partes llenas + una a medias, a propósito:
                              // con un múltiplo exacto el caso de la última parte
                              // corta ni se ejercita.
const PARTE = 100000;
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

// 251 y no 256: con i%256 el byte coincide con el offset módulo potencia de dos,
// y un fallo que confundiera partes de 100000 podría pasar desapercibido.
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const FIXPATH = join(WEB, '__test_parts.gguf');
const datos = Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 251));
writeFileSync(FIXPATH, datos);
const cleanup = () => { try { rmSync(FIXPATH); } catch { /* — */ } };
process.on('exit', cleanup);

// El Chromium que descarga playwright y el que pide la versión instalada no
// siempre coinciden (y una limpieza de disco se lleva la caché por delante).
// El Chrome del sistema sirve igual para esto.
const ARGS = { args: ['--enable-unsafe-webgpu', '--use-angle=metal'] };
const b = await chromium.launch(ARGS).catch(() => chromium.launch({ ...ARGS, channel: 'chrome' }));
const ctx = await b.newContext();
await ctx.addInitScript(() => {
  try { localStorage.setItem('elffuss.model', 'rules'); } catch { /* — */ }
  // El broker de caché compartida se salta si no está marcado como caído, y en
  // un test aislado no lo está: sin esto el almacén local ni se ejercita.
  try { sessionStorage.setItem('elffuss.broker.down', '1'); } catch { /* — */ }
});
const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

const res = await p.evaluate(async ({ url, PARTE, SIZE }) => {
  const st = await import('/js/runtime/model-store.js');
  st._setPartSize(PARTE);
  await st.removeModel(url);                      // partir de cero

  // Contar descargas de verdad: la segunda carga NO debe tocar la red.
  let peticiones = 0;
  const origFetch = window.fetch;
  window.fetch = (...a) => { if (String(a[0]).includes('__test_parts')) peticiones++; return origFetch(...a); };

  const partes = await st.getModelParts(url);
  const tras1 = peticiones;
  const r = await st.openRanged(url);
  const tras2 = peticiones;

  // Rangos elegidos a mano alrededor de las fronteras (100000, 200000, …).
  const casos = [
    [0, 10], [0, PARTE], [PARTE - 5, 10], [PARTE, 10],
    [PARTE - 1, 2], [2 * PARTE - 3, 6],
    [PARTE - 7, 2 * PARTE + 14],                  // cruza TRES partes
    [SIZE - 10, 10], [SIZE - 10, 999],            // recorte al final
    [0, SIZE], [12345, 0], [SIZE, 5], [SIZE + 100, 5],
  ];
  const leidos = [];
  for (const [off, len] of casos) {
    const buf = new Uint8Array(await r.slice(off, len));
    leidos.push({ off, len, bytes: [...buf] });
  }
  const nombres = [];
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('elffuss-models');
  for await (const n of dir.keys()) nombres.push(n);

  await st.removeModel(url);
  const trasBorrar = [];
  try {
    const d2 = await (await navigator.storage.getDirectory()).getDirectoryHandle('elffuss-models');
    for await (const n of d2.keys()) trasBorrar.push(n);
  } catch { /* — */ }
  window.fetch = origFetch;

  return {
    nPartes: partes.length, tamanos: partes.map(f => f.size), size: r.size,
    tras1, tras2, leidos, nombres, trasBorrar,
  };
}, { url: BASE + '/__test_parts.gguf', PARTE, SIZE });

const esperadas = Math.ceil(SIZE / PARTE);
ok(`el modelo se guarda en ${esperadas} partes, no en una`, res.nPartes === esperadas,
  `${res.nPartes} partes de tamaños ${res.tamanos.join(', ')}`);
ok('las partes van llenas y la última lleva el resto',
  res.tamanos.slice(0, -1).every(t => t === PARTE) && res.tamanos.at(-1) === SIZE - (esperadas - 1) * PARTE,
  `última de ${res.tamanos.at(-1)}B, esperada ${SIZE - (esperadas - 1) * PARTE}B`);
ok('el tamaño total que ve el motor es el del fichero entero', res.size === SIZE, String(res.size));
ok('en disco quedan las partes + el marcador, sin restos',
  res.nombres.length === esperadas + 1, res.nombres.sort().join(' '));
ok('la segunda apertura no vuelve a descargar', res.tras2 === res.tras1 && res.tras1 > 0,
  `${res.tras1} petición(es) al descargar, ${res.tras2 - res.tras1} al reabrir`);

// La comprobación que importa: byte a byte contra el fichero original.
let malos = 0, detalle = '';
for (const c of res.leidos) {
  const desde = Math.max(0, Math.min(SIZE, c.off));
  const cuanto = Math.max(0, Math.min(SIZE - desde, c.len));
  const esperado = [...datos.subarray(desde, desde + cuanto)];
  if (c.bytes.length !== esperado.length || c.bytes.some((v, i) => v !== esperado[i])) {
    malos++;
    if (!detalle) detalle = `off ${c.off} len ${c.len}: ${c.bytes.length}B en vez de ${esperado.length}B`;
  }
}
ok(`${res.leidos.length} rangos (incluidos los que cruzan 2 y 3 partes) idénticos al original`,
  malos === 0, malos ? `${malos} mal · ${detalle}` : `${res.leidos.reduce((n, c) => n + c.bytes.length, 0)} bytes verificados`);
ok('removeModel borra todas las partes y el marcador', res.trasBorrar.length === 0,
  res.trasBorrar.join(' ') || 'directorio vacío');

await b.close();
console.log(fails ? `\n❌ ${fails} FALLO(S)` : `\n✅ ALMACÉN PARTIDO OK`);
process.exit(fails ? 1 : 0);

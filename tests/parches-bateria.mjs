// applyPatches — el aplicador de parches sobre el HTML que genera el modelo.
// Cada caso viene de lo que Gemma E4B emitió DE VERDAD al pedirle que arreglara
// un juego suyo.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');

const HTML = [
  '<!doctype html><html><body>',
  '<canvas id="c" width="400" height="300"></canvas>',
  '<script>',
  '  const ctx = document.getElementById("c").getContext("2d");',
  '  const gameSpeed = 150;',
  '  function bucle() {',
  '    ctx.fillStyle = "#4CAF50";',
  '    requestAnimationFrame(bucle);',
  '  }',
  '  bucle();',
  '<\/script></body></html>',
].join('\n');

const CASOS = [
  { id: 'una-linea', desc: 'formato de una línea, el de siempre',
    resp: 'BUSCAR: const gameSpeed = 150;\nCAMBIAR: const gameSpeed = 90;\nMOTIVO: más rápido',
    aplica: 1, trae: 'const gameSpeed = 90;' },

  { id: 'no-op', desc: 'BUSCAR igual a CAMBIAR → se descarta (el modelo los emite)',
    resp: 'BUSCAR: ctx.fillStyle = "#4CAF50";\nCAMBIAR: ctx.fillStyle = "#4CAF50";\nMOTIVO: unificar color',
    aplica: 0, sinCambio: true },

  { id: 'multilinea', desc: 'bloque de varias líneas: lo que hace falta para AÑADIR código',
    resp: 'BUSCAR\n  bucle();\nCAMBIAR\n  bucle();\n  document.addEventListener("keydown", e => { dir = e.key; });\nFIN',
    aplica: 1, trae: 'addEventListener("keydown"' },

  { id: 'sangria-mal', desc: 'el modelo cita con otra sangría',
    resp: 'BUSCAR\nconst gameSpeed = 150;\nCAMBIAR\nconst gameSpeed = 60;\nFIN',
    aplica: 1, trae: 'const gameSpeed = 60;' },

  { id: 'inventado', desc: 'cita algo que no existe → se descarta, no se inventa',
    resp: 'BUSCAR\nconst noExiste = 1;\nCAMBIAR\nconst noExiste = 2;\nFIN',
    aplica: 0, sinCambio: true },

  { id: 'ambiguo', desc: 'cita algo que aparece dos veces → se descarta',
    resp: 'BUSCAR: }\nCAMBIAR: } // fin',
    aplica: 0, sinCambio: true },

  { id: 'varios', desc: 'varios parches en la misma respuesta',
    resp: 'BUSCAR\n  const gameSpeed = 150;\nCAMBIAR\n  const gameSpeed = 80;\nFIN\n\nBUSCAR\n  bucle();\nCAMBIAR\n  bucle();\n  window.addEventListener("keyup", () => {});\nFIN',
    aplica: 2, trae: 'keyup' },
];

const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await b.newContext()).newPage();
await p.goto('https://claw.elffuss.utopiaia.com/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);

const res = await p.evaluate(async ({ CASOS, HTML }) => {
  const rlm = await import('/js/rlm.js?v=' + Date.now());
  return CASOS.map(c => {
    const r = rlm.applyPatches(HTML, c.resp);
    return { id: c.id, aplicados: r.aplicados.length, fallidos: r.fallidos, cambio: r.html !== HTML, html: r.html };
  });
}, { CASOS, HTML });

console.log('applyPatches — parches sobre el HTML generado\n');
let ok = 0;
for (const c of CASOS) {
  const r = res.find(x => x.id === c.id);
  let bien = r.aplicados === c.aplica, nota = '';
  if (bien && c.trae && !r.html.includes(c.trae)) { bien = false; nota = `no metió «${c.trae}»`; }
  if (bien && c.sinCambio && r.cambio) { bien = false; nota = 'cambió el HTML y no debía'; }
  if (!bien && !nota) nota = `aplicó ${r.aplicados}, esperaba ${c.aplica}` +
    (r.fallidos.length ? ` · descartes: ${r.fallidos.map(f => f.motivo).join(', ')}` : '');
  if (bien) ok++;
  console.log(` ${bien ? '✓' : '✗'} ${c.id.padEnd(13)} ${c.desc}`);
  if (!bien) console.log(`     └─ ${nota}`);
}
console.log(`\n  ${ok}/${CASOS.length} correctos`);
await b.close();
process.exit(ok === CASOS.length ? 0 : 1);

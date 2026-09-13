// ¿Recupera el gestor de contexto el dato que hace falta si la conversación NO es en inglés?
// ─────────────────────────────────────────────────────────────────────────────
// Los bancos de acer-core (acer_real y LoCoMo) son sesiones de código y diálogo
// en inglés: texto ASCII, donde un tokenizador que no ve tildes ni cirílico no
// puede fallar. Y no falló nunca, mientras en producción Elffuss habla sobre todo
// español. Este banco son conversaciones cotidianas en siete idiomas que escribió
// un modelo SIN ver acer-core: en la primera mitad se siembran datos, y al final
// se pregunta por ellos parafraseando y, a veces, sin tildes, como quien escribe
// con prisa en el móvil. Se acierta si el fragmento literal del dato («oro») sale
// en lo que se le manda al modelo.
//
// El presupuesto es una FRACCIÓN de lo que ocupa cada conversación y no un número
// fijo: las conversaciones generadas miden distinto, y lo que se quiere medir es
// qué pasa cuando no cabe todo. Con holgura acierta cualquiera.
//
// Varios núcleos a la vez para compararlos caso a caso (el primero es la
// referencia de «gana / pierde»):
//   node tests/contexto-multilingue.mjs
//   node tests/contexto-multilingue.mjs --nucleos viejo=/tmp/acer-core-viejo.mjs,nuevo=web/js/acer-core.js
//   node tests/contexto-multilingue.mjs --fracciones 0.2,0.35,0.5
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const CASOS = path.resolve(arg('--casos', path.join(AQUI, 'contexto-multilingue.cases.json')));
const NUCLEOS = arg('--nucleos', `actual=${path.join(AQUI, '..', 'web', 'js', 'acer-core.js')}`)
  .split(',').map(x => { const [nombre, ruta] = x.split('='); return { nombre, ruta: path.resolve(ruta) }; });
const FRACCIONES = arg('--fracciones', '0.25,0.5').split(',').map(Number);
const RECIENTES = 6;   // los últimos mensajes van literales: un dato ahí no mide nada

for (const n of NUCLEOS) n.core = await import('file://' + n.ruta);
const estimar = NUCLEOS[0].core.estimateTokens;

// Un caso solo vale si mide recuperación: el oro está literal UNA vez, fuera de
// los recientes, y la pregunta no lo copia. Lo que no cumple se descarta y se
// cuenta, no se arregla a mano (arreglarlo mirando el resultado lo dejaría de
// ser a ciegas).
const datos = JSON.parse(fs.readFileSync(CASOS, 'utf8'));
const casos = [];
const descartes = {};
for (const { idioma, sesiones } of datos.idiomas) {
  sesiones.forEach((s, si) => {
    for (const p of s.preguntas) {
      const donde = s.mensajes.map((m, i) => (m.content.includes(p.oro) ? i : -1)).filter(i => i >= 0);
      const motivo = !donde.length ? 'el oro no está literal'
        : donde.length > 1 ? 'el oro se repite'
        : donde[0] >= s.mensajes.length - RECIENTES ? 'el oro está en los recientes'
        : p.q.includes(p.oro) ? 'la pregunta copia el oro' : null;
      if (motivo) { descartes[motivo] = (descartes[motivo] || 0) + 1; continue; }
      // «con prisa»: sin un solo carácter no ASCII, en un idioma que los usa.
      const prisa = ['es', 'pt', 'fr', 'de'].includes(idioma) && !/[^\x00-\x7f]/.test(p.q);
      casos.push({ idioma, sesion: `${idioma}${si}`, mensajes: s.mensajes, q: p.q, oro: p.oro, prisa });
    }
  });
}
console.log(`casos válidos: ${casos.length} · descartados: ${JSON.stringify(descartes)}`);
console.log(`núcleos: ${NUCLEOS.map(n => n.nombre).join(', ')} · presupuesto: ${FRACCIONES.map(f => `${f * 100}%`).join(', ')} de cada conversación\n`);

const idiomas = [...new Set(casos.map(c => c.idioma))];
for (const frac of FRACCIONES) {
  const aciertos = NUCLEOS.map(() => []);
  for (const c of casos) {
    const total = c.mensajes.reduce((a, m) => a + estimar(m.content) + 4, 0);
    const presupuesto = Math.max(200, Math.round(total * frac));
    const historial = [...c.mensajes, { role: 'user', content: c.q }];
    NUCLEOS.forEach((n, i) => {
      const salida = n.core.packHistoryACER(historial, presupuesto, {}).messages.slice(0, -1);
      aciertos[i].push(salida.some(m => m.content.includes(c.oro)) ? 1 : 0);
    });
  }
  const celda = (i, filtro) => {
    const idx = casos.map((c, k) => (filtro(c) ? k : -1)).filter(k => k >= 0);
    return `${idx.reduce((a, k) => a + aciertos[i][k], 0)}/${idx.length}`.padStart(7);
  };
  console.log(`── presupuesto ${frac * 100}%`);
  console.log('  ' + 'idioma'.padEnd(8) + NUCLEOS.map(n => n.nombre.slice(0, 7).padStart(7)).join(' '));
  for (const l of idiomas) console.log('  ' + l.padEnd(8) + NUCLEOS.map((_, i) => celda(i, c => c.idioma === l)).join(' '));
  console.log('  ' + 'prisa'.padEnd(8) + NUCLEOS.map((_, i) => celda(i, c => c.prisa)).join(' '));
  console.log('  ' + 'total'.padEnd(8) + NUCLEOS.map((_, i) => celda(i, () => true)).join(' '));
  for (let i = 1; i < NUCLEOS.length; i++) {
    const gana = casos.filter((_, k) => aciertos[i][k] > aciertos[0][k]).length;
    const pierde = casos.filter((_, k) => aciertos[i][k] < aciertos[0][k]).length;
    console.log(`  ${NUCLEOS[i].nombre} frente a ${NUCLEOS[0].nombre}: gana ${gana}, pierde ${pierde}`);
  }
  console.log();
}

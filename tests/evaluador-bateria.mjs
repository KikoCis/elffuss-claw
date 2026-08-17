// rateArtifact — el evaluador que decide si un juego generado funciona.
// Dos fallos que costaron una conclusión equivocada:
//  · al expirar el plazo devolvía la lectura ANTERIOR, así que bajo carga un
//    juego vivo se medía como muerto (y el evaluador se usa MIENTRAS el modelo
//    genera, o sea justo cuando la máquina va cargada);
//  · la sonda se inyectaba tras los scripts del artefacto, así que era ciega a
//    los errores de arranque, que son los más frecuentes.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');

const pagina = (cuerpo, cabeza = '') => `<!doctype html><html><head>${cabeza}</head><body>
<canvas id="c" width="300" height="200"></canvas><script>${cuerpo}<\/script></body></html>`;

const vivo = `const x=document.getElementById('c').getContext('2d'); let t=0;
  let dx=0; document.addEventListener('keydown',()=>{dx+=37});
  (function b(){ t++; x.fillStyle='#000'; x.fillRect(0,0,300,200);
    x.fillStyle='#0f0'; x.fillRect((t*3+dx)%280,50,20,20); requestAnimationFrame(b); })();`;

const CASOS = [
  { id: 'juego-vivo', desc: 'un juego que va: pinta, anima y responde', html: pagina(vivo), nota: 5 },

  { id: 'error-arranque', desc: 'error en el PRIMER script → la sonda tiene que verlo',
    html: pagina('noExisteEstaFuncion(); ' + vivo), sinErrores: false },

  { id: 'error-al-pulsar', desc: 'revienta al recibir una tecla',
    html: pagina(vivo + `document.addEventListener('keydown',()=>{ null.x; });`), sinErrores: false },

  { id: 'quieto', desc: 'pinta pero no anima', html: pagina(`const x=document.getElementById('c').getContext('2d'); x.fillRect(0,0,300,200);`), falla: 'vivo' },

  { id: 'sordo', desc: 'anima pero no escucha la entrada',
    html: pagina(`const x=document.getElementById('c').getContext('2d'); let t=0;
      (function b(){ t++; x.fillStyle='#000'; x.fillRect(0,0,300,200); x.fillStyle='#f00'; x.fillRect(t%280,50,20,20); requestAnimationFrame(b); })();`),
    falla: 'responde' },

  { id: 'sin-canvas', desc: 'sin canvas no se puede medir: «no medible», NO cero',
    html: '<!doctype html><html><head></head><body><h1>hola</h1></body></html>', noMedible: true },

  { id: 'ya-terminado', desc: 'arranca en pantalla de fin de partida',
    html: `<!doctype html><html><head></head><body><canvas id="c" width="300" height="200"></canvas><p>GAME OVER</p><script>${vivo}<\/script></body></html>`,
    falla: 'arranca' },
];

const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await b.newContext()).newPage();
await p.goto('https://claw.elffuss.utopiaia.com/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);

const evaluar = (casos, carga) => p.evaluate(async ({ casos, carga }) => {
  const rlm = await import('/js/rlm.js?v=' + Date.now());
  const out = [];
  for (const c of casos) {
    let matar = null;
    if (carga) {
      // ocupar el hilo principal a ratos, como cuando el modelo está generando
      const id = setInterval(() => { const t = performance.now(); while (performance.now() - t < 120); }, 160);
      matar = () => clearInterval(id);
    }
    const r = await rlm.rateArtifact(c.html);
    if (matar) matar();
    out.push({ id: c.id, nota: r.nota, detalle: r.detalle, medible: r.medible, error: r.error });
  }
  return out;
}, { casos, carga });

let fallos = 0;
for (const carga of [false, true]) {
  const res = await evaluar(CASOS, carga);
  console.log(`\n${carga ? '── CON EL HILO PRINCIPAL CARGADO (como al generar) ──' : '── en reposo ──'}`);
  for (const c of CASOS) {
    const r = res.find(x => x.id === c.id);
    let bien = true, nota = '';
    if (c.noMedible) { bien = r.medible === false && r.nota < 0; nota = bien ? '' : `medible=${r.medible} nota=${r.nota}`; }
    else if (c.nota != null) { bien = r.nota === c.nota; nota = bien ? '' : `nota ${r.nota}, esperaba ${c.nota} · falla ${Object.entries(r.detalle||{}).filter(([,v])=>!v).map(([k])=>k).join(',')}`; }
    else if (c.sinErrores === false) { bien = r.detalle?.sinErrores === false; nota = bien ? '' : 'no vio el error'; }
    else if (c.falla) { bien = r.detalle?.[c.falla] === false; nota = bien ? '' : `no detectó que falla «${c.falla}»`; }
    if (!bien) fallos++;
    console.log(` ${bien ? '✓' : '✗'} ${c.id.padEnd(15)} ${c.desc}${nota ? '\n     └─ ' + nota : ''}`);
  }
}
console.log(fallos ? `\n  ❌ ${fallos} fallos` : '\n  ✅ todo correcto, en reposo y bajo carga');
await b.close();
process.exit(fallos ? 1 : 0);

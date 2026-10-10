// Velocímetro (⚡ tok/s) con un motor de prueba (sin GPU): el que mide es el
// motor propio (alMedir/ultimaMedida), y aquí se le da uno de mentira.
//   · Elegir el motor dos veces (montar dos veces) y el chip sigue abriendo el
//     panel (antes cada montaje añadía otro clic y se cerraba al abrirse).
//   · aria-expanded / aria-controls; Escape cierra y devuelve el foco; un clic
//     fuera cierra.
//   · Al pasar a otro cerebro el chip se esconde y deja de escuchar al motor
//     (antes se quedaba con la última cifra).
//
//   BASE=http://localhost:8743 node tests/ux-velocimetro.mjs
import { navegador, contexto, pagina, ok, hasta, fin } from './ux-comun.mjs';

const b = await navegador();
const { ctx } = await contexto(b);
const { p, errores } = await pagina(ctx);

ok('en Básico no hay velocímetro', await p.evaluate(() => document.getElementById('speed-chip').hidden));
await p.evaluate(async () => {
  const vm = await import('/js/velocimetro.js');
  const subs = new Set();
  window.__subs = subs;
  window.__motor = {
    alMedir: fn => { subs.add(fn); return () => subs.delete(fn); },
    ultimaMedida: () => ({ prefillTokS: 300, genTokS: 20, ttftMs: 900, genTokens: 50, procesados: 400, reusados: 0, enCurso: false }),
  };
  vm.montar(window.__motor);
  vm.montar(window.__motor);      // elegir el motor otra vez
});
const chip = p.locator('#speed-chip');
ok('con el motor, el chip enseña la velocidad', !(await chip.isHidden()) && /20\.0 tok\/s/.test(await chip.innerText()));
ok('un solo oyente aunque se monte dos veces', await p.evaluate(() => window.__subs.size) === 1);
ok('aria-controls y aria-expanded', await chip.getAttribute('aria-controls') === 'speed-panel' && await chip.getAttribute('aria-expanded') === 'false');
await chip.click();
ok('tras montar dos veces, el clic ABRE el panel', await p.evaluate(() => !document.getElementById('speed-panel').hidden)
  && await chip.getAttribute('aria-expanded') === 'true');
await chip.click();
ok('y otro clic lo cierra', await p.evaluate(() => document.getElementById('speed-panel').hidden));
await chip.click();
await p.keyboard.press('Escape');
ok('Escape lo cierra y el foco vuelve al chip', await p.evaluate(() =>
  document.getElementById('speed-panel').hidden && document.activeElement?.id === 'speed-chip'));
await chip.click();
await p.click('#log');
ok('un clic fuera lo cierra', await p.evaluate(() => document.getElementById('speed-panel').hidden));
await chip.click();

// pasar a otro cerebro (Básico) por el selector, como el usuario
await p.evaluate(() => {
  const s = document.getElementById('model-select');
  s.value = 'rules';
  s.dispatchEvent(new Event('change'));
});
ok('al pasar a otro cerebro el chip y el panel se esconden', await hasta(() => p.evaluate(() =>
  document.getElementById('speed-chip').hidden && document.getElementById('speed-panel').hidden)));
ok('…y deja de escuchar al motor', await p.evaluate(() => window.__subs.size) === 0);

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
await fin(b, 'VELOCÍMETRO: abre aunque se monte dos veces, Escape, y se esconde con otro cerebro');

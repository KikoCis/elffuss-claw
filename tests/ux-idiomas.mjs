// Claw en ucraniano, francés, alemán y portugués: la página carga sin errores y
// lo que se ve sale en ese idioma, también lo que se añadió tras la auditoría
// (antes caía al inglés): la caja de texto, el botón de enviar, el estado del
// cerebro junto a su punto, la pestaña Ajustes, lo que devuelve una herramienta
// y lo que cuenta el cerebro autónomo. Los textos esperados salen del propio
// i18n.js (la prueba no repite traducciones); tests/i18n-claves.mjs comprueba
// que no falte ninguna clave.
//
//   BASE=http://localhost:8743 node tests/ux-idiomas.mjs
import { navegador, contexto, pagina, ok, hasta, fin } from './ux-comun.mjs';

const b = await navegador();
for (const locale of ['uk-UA', 'fr-FR', 'de-DE', 'pt-PT']) {
  const lang = locale.slice(0, 2);
  const { ctx } = await contexto(b, { locale });
  const { p, errores } = await pagina(ctx);
  const esperado = await p.evaluate(async lang => {
    const i = await import('/js/i18n.js');
    const tx = (k, v) => i.t(k, v);
    return {
      uiLang: i.uiLang(), ph: tx('ph'), send: tx('send'), basico: tx('modelStOffShort'),
      memNone: tx('memNone'), ceoOff: tx('ceoOff'), useTitle: tx('useTitle'),
    };
  }, lang);
  const visto = await p.evaluate(async () => {
    const { runTool } = await import('/js/tools/index.js');
    const ceo = await import('/js/ceo.js');
    const dichos = [];
    ceo.init({ onEvent: (ch, ev) => dichos.push(ev.text) });
    ceo.disable();
    return {
      ph: document.getElementById('prompt').placeholder, send: document.getElementById('send').title,
      estado: document.getElementById('model-status-txt')?.textContent, memoria: await runTool('memory.list', {}), cerebro: dichos,
    };
  });
  ok(`${lang}: la página está en ${lang}`, esperado.uiLang === lang, esperado.uiLang);
  ok(`${lang}: la caja de texto y el botón de enviar`, visto.ph === esperado.ph && visto.send === esperado.send, JSON.stringify([visto.ph, visto.send]));
  ok(`${lang}: el estado del cerebro junto a su punto`, visto.estado === esperado.basico && esperado.basico !== 'Basic', visto.estado);
  ok(`${lang}: lo que devuelve una herramienta (y se ve en el chat)`, visto.memoria === esperado.memNone && !/remember|recuerdo/i.test(visto.memoria), visto.memoria);
  ok(`${lang}: lo que cuenta el cerebro`, visto.cerebro.includes(esperado.ceoOff) && esperado.ceoOff !== 'CEO paused', JSON.stringify(visto.cerebro));
  await p.click('#tabs button[data-tab="ajustes"]');
  ok(`${lang}: la tarjeta de consumo de Ajustes`, await hasta(async () =>
    (await p.locator('#panel-ajustes .card b').first().textContent().catch(() => '')).includes(esperado.useTitle)), esperado.useTitle);
  ok(`${lang}: sin errores de página`, errores.length === 0, errores.slice(0, 3).join(' | '));
  await ctx.close();
}
await fin(b, 'IDIOMAS: Claw en ucraniano, francés, alemán y portugués, también lo nuevo');

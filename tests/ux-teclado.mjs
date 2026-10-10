// Teclado, menú de comandos y chips.
//   · «/» (botón): menú de verdad (aria-haspopup/expanded, role=menu), el foco
//     entra, ↑/↓ se mueven, Escape cierra y devuelve el foco.
//   · Escribiendo «/sk» filtra, Enter ejecuta el marcado y la caja queda limpia y
//     con el foco; un «/» suelto no se manda nunca; /modelo lleva al selector.
//   · «?» fuera de la caja enseña los atajos; «/» fuera de la caja abre el menú.
//   · Chips: botones, seis, sin repetidos, en el idioma de la página; «Autoriza
//     una carpeta» abre el selector en el propio clic.
//
//   BASE=http://localhost:8743 node tests/ux-teclado.mjs
import { navegador, contexto, pagina, ok, hasta, espera, fin } from './ux-comun.mjs';

const b = await navegador();
const { ctx } = await contexto(b, { grants: ['fs', 'apps'] });
await ctx.addInitScript(() => {
  window.__picker = 0;
  window.showDirectoryPicker = async () => {
    window.__picker++;
    const r = await navigator.storage.getDirectory();
    return r.getDirectoryHandle('mi-carpeta', { create: true });
  };
});
const { p, errores } = await pagina(ctx);
const menuAbierto = () => p.evaluate(() => !document.getElementById('cmd-menu').hidden);
const foco = () => p.evaluate(() => document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName);

// ── el botón «/» ────────────────────────────────────────────────────────────
const slash = p.locator('#btn-slash');
ok('el botón «/» anuncia un menú y tiene nombre', await slash.getAttribute('aria-haspopup') === 'menu'
  && await slash.getAttribute('aria-expanded') === 'false' && await slash.getAttribute('aria-label') === 'Comandos y skills');
await slash.click();
ok('al abrirlo: aria-expanded, role=menu y el foco en la primera opción', await menuAbierto() && await slash.getAttribute('aria-expanded') === 'true'
  && await p.evaluate(() => document.getElementById('cmd-menu').getAttribute('role') === 'menu' && document.activeElement?.getAttribute('role') === 'menuitem'
  && document.activeElement.textContent.startsWith('/reloj')));
await p.keyboard.press('ArrowDown');
ok('↓ pasa a la siguiente opción', await p.evaluate(() => document.activeElement?.textContent.startsWith('/carpeta')));
await p.keyboard.press('Escape');
ok('Escape cierra el menú y devuelve el foco al botón', !(await menuAbierto()) && await foco() === 'btn-slash');

// ── escribiendo «/» ─────────────────────────────────────────────────────────
await p.focus('#prompt');
await p.keyboard.type('/sk');
ok('«/sk» filtra: solo /skills', await hasta(async () => (await p.locator('#cmd-menu .cmd-item b').allTextContents()).join(',') === '/skills'));
await p.keyboard.press('Enter');
ok('Enter ejecuta el comando marcado (abre Skills)', await hasta(() => p.evaluate(() => document.getElementById('panel-skills').classList.contains('active'))));
ok('…la caja queda vacía y con el foco, y no se mandó «/sk» al modelo', await p.inputValue('#prompt') === '' && await foco() === 'prompt'
  && await p.locator('#log .msg.user').count() === 0);
await p.keyboard.type('/');
await p.keyboard.press('Escape');
ok('Escape con «/» escrito cierra el menú', !(await menuAbierto()));
await p.keyboard.press('Enter');
await espera(300);
ok('un «/» suelto con Enter no se manda nunca', await p.locator('#log .msg.user').count() === 0);
await p.fill('#prompt', '');
await p.keyboard.type('/mod');
await p.keyboard.press('Enter');
ok('/modelo lleva al selector de modelo', await hasta(async () => await foco() === 'model-select'));

// ── atajos fuera de la caja ─────────────────────────────────────────────────
await p.click('#tabs button[data-tab="vista"]');
await p.keyboard.press('?');
ok('«?» fuera de la caja enseña los atajos', await hasta(() => p.evaluate(() => document.getElementById('atajos')?.open)));
await p.keyboard.press('Escape');
ok('…y Escape los cierra', await hasta(() => p.evaluate(() => !document.getElementById('atajos').open)));
await p.click('#tabs button[data-tab="vista"]');
await p.keyboard.press('/');
ok('«/» fuera de la caja va a la caja con el menú abierto', await hasta(async () => await foco() === 'prompt' && await menuAbierto()));
await p.keyboard.press('Escape');
await p.fill('#prompt', '');

// ── chips ───────────────────────────────────────────────────────────────────
const chips = await p.$$eval('#chips .chip', cs => cs.map(c => ({ tag: c.tagName, t: c.textContent, a: c.dataset.accion || '' })));
ok('seis chips, botones, sin repetidos', chips.length === 6 && chips.every(c => c.tag === 'BUTTON') && new Set(chips.map(c => c.t)).size === 6, JSON.stringify(chips));
ok('…incluidas las de skill e imágenes', chips.some(c => /skill/.test(c.t)) && chips.some(c => /auroras/.test(c.t)));
await p.locator('#chips .chip[data-accion="carpeta"]').click();
ok('«Autoriza una carpeta» abre el selector en el propio clic (sin esperar al modelo)', await hasta(() => p.evaluate(() => window.__picker === 1)));
ok('…y la carpeta queda autorizada y dicha en el chat', await hasta(async () => /Carpeta «mi-carpeta» autorizada/.test(await p.locator('#log').innerText())));
await p.locator('#chips .chip', { hasText: 'Hazme un reloj' }).click();
ok('un chip normal se manda como mensaje', await hasta(async () => /Hazme un reloj/.test(await p.locator('#log .msg.user').allInnerTexts().then(a => a.join(' ')))));
{
  const { ctx: c2 } = await contexto(b, { locale: 'en-US' });
  const { p: e } = await pagina(c2);
  const en = await e.$$eval('#chips .chip', cs => cs.map(c => c.textContent));
  const es = ['Hazme un reloj', 'Crea una app de notas', 'Autoriza una carpeta', 'Créame una skill para organizar mis descargas', 'Busca fotos de auroras boreales', 'Abre https://example.com'];
  ok('en inglés: seis chips en inglés', en.length === 6 && !en.some(t => es.includes(t)) && en[0] === 'Make me a clock', JSON.stringify(en));
  ok('en inglés el botón «/» se llama «Commands and skills»', await e.getAttribute('#btn-slash', 'aria-label') === 'Commands and skills');
  await c2.close();
}

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
await fin(b, 'TECLADO: menú «/» navegable y filtrable, atajos, chips que son botones');

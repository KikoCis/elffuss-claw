// Pestaña Skills: ordenada y clara, también en el teléfono. GitHub se stubea.
//
//   1. Dos partes con su encabezado: «Instaladas: n» y «Explorar catálogos»
//      (antes lo instalado era una línea gris y los catálogos no tenían título).
//   2. Todas las tarjetas de catálogo igual: nombre y repo uno debajo del otro
//      y el botón a la derecha (antes el botón bajaba de línea solo en las de
//      nombre largo).
//   3. Una acción por fila en la lista de un catálogo: tras instalar, «Ver cómo
//      usarla en el chat» va en el aviso, no como segundo botón.
//   4. En el teléfono, instalar NO te saca de Skills al chat, y el botón
//      flotante «Chat» no tapa lo último del panel.
//   5. En inglés, los encabezados también.
//
//   BASE=http://localhost:8743 node tests/ux-skills-orden.mjs
import { navegador, contexto, pagina, ok, hasta, fin } from './ux-comun.mjs';

const REPO = 'anthropics/skills';
const ARBOL = { tree: [{ path: 'skills/pdf/SKILL.md' }, { path: 'skills/docx/SKILL.md' }, { path: 'skills/xlsx/SKILL.md' }] };
const rutas = async (url, route) => {
  if (url.startsWith('https://api.github.com/repos/')) { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ARBOL) }); return true; }
  if (url.startsWith('https://raw.githubusercontent.com/')) {
    const n = url.match(/skills\/([^/]+)\/SKILL/)?.[1] || 'x';
    await route.fulfill({ status: 200, contentType: 'text/plain', body: `---\nname: ${n}\ndescription: ${n}.\n---\nHaz ${n}.` }); return true;
  }
  return false;
};
const b = await navegador();

// ── escritorio ──
{
  const { ctx } = await contexto(b, { viewport: { width: 1280, height: 800 }, rutas });
  const { p, errores } = await pagina(ctx);
  await p.click('#tabs button[data-tab="skills"]');
  await p.waitForSelector('#panel-skills .skills-fuentes .card');
  const heads = await p.$$eval('#panel-skills h4', hs => hs.map(h => h.textContent));
  ok('1 · dos partes con encabezado: «Instaladas: 0» y «Explorar catálogos»', JSON.stringify(heads) === '["Instaladas: 0","Explorar catálogos"]', JSON.stringify(heads));
  const forma = await p.$$eval('#panel-skills .skills-fuentes .card > .row', rs => rs.map(r => {
    const b = r.querySelector(':scope > b').getBoundingClientRect(), a = r.querySelector(':scope > a').getBoundingClientRect(), x = r.querySelector(':scope > button').getBoundingClientRect();
    return { linkDebajo: a.top >= b.bottom - 1, botonALaDerecha: x.left >= Math.max(b.right, a.right) - 1 };
  }));
  ok('2 · todas las tarjetas de catálogo igual: repo debajo del nombre y botón a la derecha', forma.length >= 3 && forma.every(f => f.linkDebajo && f.botonALaDerecha), JSON.stringify(forma));
  const tarjeta = p.locator(`#panel-skills [data-ruta="repo:${REPO}"]`);
  await tarjeta.locator('button', { hasText: 'Explorar' }).click();
  await hasta(async () => await tarjeta.locator('.repo-skills .instalar-skill').count() === 3);
  const fila = tarjeta.locator('.repo-skills .card', { hasText: 'docx' });
  await fila.locator('.instalar-skill').click();
  ok('3 · tras instalar, la fila sigue con UNA acción', await hasta(async () => (await fila.locator('.instalar-skill').innerText()) === 'Instalada ✓')
    && await fila.locator('button').count() === 1);
  const aviso = p.locator('#toasts .toast', { hasText: 'docx' });
  ok('3 · …y el aviso trae «Ver cómo usarla en el chat»', await aviso.locator('.toast-accion').innerText() === 'Ver cómo usarla en el chat');
  ok('sin errores de página', !errores.length, errores.join(' | '));
  await ctx.close();
}

// ── teléfono ──
{
  const { ctx } = await contexto(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, rutas });
  const { p, errores } = await pagina(ctx);
  await p.tap('#btn-flip');
  await p.click('#tabs button[data-tab="skills"]');
  const tarjeta = p.locator(`#panel-skills [data-ruta="repo:${REPO}"]`);
  await tarjeta.locator('button', { hasText: 'Explorar' }).tap();
  await hasta(async () => await tarjeta.locator('.repo-skills .instalar-skill').count() === 3);
  const fila = tarjeta.locator('.repo-skills .card', { hasText: 'pdf' });
  await fila.locator('.instalar-skill').tap();
  await hasta(async () => (await fila.locator('.instalar-skill').innerText()) === 'Instalada ✓');
  await p.waitForTimeout(200);
  ok('4 · en el teléfono, instalar te deja en Skills (no salta al chat)', await p.evaluate(() => document.body.classList.contains('show-viz'))
    && await p.isVisible('#panel-skills'));
  const tapa = await p.evaluate(() => {
    const panel = document.getElementById('panel-skills');
    panel.scrollTop = panel.scrollHeight;
    const flip = document.getElementById('btn-flip').getBoundingClientRect();
    return [...panel.querySelectorAll('button')].filter(x => { const r = x.getBoundingClientRect(); return r.width && r.bottom > flip.top && r.top < flip.bottom && r.right > flip.left && r.left < flip.right; }).map(x => x.textContent);
  });
  ok('4 · al final del panel, el botón flotante «Chat» no tapa ningún botón', !tapa.length, JSON.stringify(tapa));
  await p.locator('#toasts .toast', { hasText: 'pdf' }).locator('.toast-accion').tap();
  ok('4 · …y el aviso lleva al chat si lo pides', await hasta(() => p.evaluate(() => !document.body.classList.contains('show-viz'))));
  ok('sin errores de página (teléfono)', !errores.length, errores.join(' | '));
  await ctx.close();
}

// ── inglés ──
{
  const { ctx } = await contexto(b, { locale: 'en-US', rutas });
  const { p } = await pagina(ctx);
  await p.click('#tabs button[data-tab="skills"]');
  await p.waitForSelector('#panel-skills .skills-fuentes .card');
  const heads = await p.$$eval('#panel-skills h4', hs => hs.map(h => h.textContent));
  ok('5 · en inglés, los encabezados también', JSON.stringify(heads) === '["Installed: 0","Browse catalogs"]', JSON.stringify(heads));
  await ctx.close();
}
await fin(b, 'SKILLS ordenadas: dos partes, una acción por fila y el teléfono sin saltos');

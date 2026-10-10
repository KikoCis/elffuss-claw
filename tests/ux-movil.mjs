// Teléfono y ventanas estrechas.
//   · A 390 px, en la vista: la página no se desplaza de lado (las pestañas se
//     desplazan dentro) y «💬 Chat» se ve entero para volver.
//   · En el chat, el botón de vista no tapa la fila de chips; su texto y su
//     nombre van en el idioma de la página.
//   · La puerta de móvil sale en un teléfono, no en una ventana estrecha con
//     ratón; si la descarga falla, la tarjeta se queda con el error y
//     «Reintentar».
//
//   BASE=http://localhost:8743 node tests/ux-movil.mjs
import { navegador, contexto, pagina, ok, hasta, espera, fin, OUT } from './ux-comun.mjs';

const b = await navegador();
const telefono = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const solapan = (a, c) => !(a.x + a.width <= c.x || c.x + c.width <= a.x || a.y + a.height <= c.y || c.y + c.height <= a.y);

// ── 390 px: chat y vista ────────────────────────────────────────────────────
{
  const { ctx } = await contexto(b, telefono);
  const { p, errores } = await pagina(ctx);
  const flip = p.locator('#btn-flip');
  ok('en el chat, el botón dice «✳ Vista» y su nombre explica adónde lleva', (await flip.innerText()).trim() === '✳ Vista'
    && /Ver lo que crea Elffuss/.test(await flip.getAttribute('aria-label')));
  const [bf, bc] = [await flip.boundingBox(), await p.locator('#chips').boundingBox()];
  ok('…y no tapa la fila de chips', !solapan(bf, bc), JSON.stringify({ bf, bc }));
  await flip.click();
  await espera(200);
  const vista = await p.evaluate(() => {
    const f = document.getElementById('btn-flip').getBoundingClientRect();
    return {
      ancho: document.documentElement.scrollWidth, ventana: innerWidth,
      viz: document.getElementById('viz').getBoundingClientRect().width,
      tabsDesplazan: document.getElementById('tabs').scrollWidth > document.getElementById('tabs').clientWidth,
      flip: { izq: f.left, der: f.right, texto: document.getElementById('btn-flip').textContent },
    };
  });
  ok('en la vista la página no se desplaza de lado', vista.ancho <= vista.ventana && vista.viz <= vista.ventana, JSON.stringify(vista));
  ok('…las pestañas se desplazan dentro de su fila', vista.tabsDesplazan);
  ok('…y «💬 Chat» se ve entero para volver', vista.flip.izq >= 0 && vista.flip.der <= vista.ventana && /Chat/.test(vista.flip.texto), JSON.stringify(vista.flip));
  if (OUT) await p.screenshot({ path: OUT + '/ux-movil-vista.png' });
  await p.click('#tabs button[data-tab="ajustes"]');
  ok('la última pestaña (Ajustes) se puede alcanzar y abrir', await p.evaluate(() => document.getElementById('panel-ajustes').classList.contains('active')));
  ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  const { ctx } = await contexto(b, { ...telefono, locale: 'en-US' });
  const { p } = await pagina(ctx);
  ok('en inglés el botón dice «✳ View»', (await p.locator('#btn-flip').innerText()).trim() === '✳ View');
  await ctx.close();
}

// ── la puerta de móvil: teléfono sí, ventana estrecha con ratón no ──────────
const sinCerebroGuardado = { model: null };
{
  const { ctx } = await contexto(b, { ...sinCerebroGuardado, viewport: { width: 760, height: 900 } });
  const { p } = await pagina(ctx);
  await espera(2500);
  ok('ventana de 760 px con ratón: NO sale «En el móvil todavía no funciona»', await p.locator('.mobile-gate').count() === 0);
  await ctx.close();
}
{
  const { ctx } = await contexto(b, { ...sinCerebroGuardado, ...telefono });
  const { p } = await pagina(ctx);
  ok('en un teléfono sí sale la tarjeta', await hasta(async () => await p.locator('.mobile-gate').count() === 1));
  await p.locator('.mobile-gate button').click();
  // la descarga de verdad está cortada en las pruebas (Hugging Face bloqueado): falla
  ok('si falla, la tarjeta se queda con el error y «Reintentar»', await hasta(async () =>
    /No ha cargado/.test(await p.locator('.mobile-gate').innerText().catch(() => '')) &&
    (await p.locator('.mobile-gate button').innerText()) === 'Reintentar', { veces: 400 }));
  await ctx.close();
}

await fin(b, 'MÓVIL: sin desbordes, «💬 Chat» a la vista y la puerta solo en teléfonos');

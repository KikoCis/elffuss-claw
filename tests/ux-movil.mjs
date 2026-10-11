// Teléfono y ventanas estrechas.
//   · A 390 px, en la vista: la página no se desplaza de lado (las pestañas se
//     desplazan dentro) y «💬 Chat» se ve entero para volver.
//   · En el chat, el botón de vista no tapa la fila de chips; su texto y su
//     nombre van en el idioma de la página. La caja de progreso de una descarga
//     no tapa la caja de texto.
//   · La puerta de móvil sale en un teléfono, no en una ventana estrecha con
//     ratón; si la descarga falla, la tarjeta se queda con el error y
//     «Reintentar».
//   · Los avisos no tapan ■, ⛏, / ni ⇄ (van encima, también de la caja de
//     progreso): tocar ■ con un aviso a la vista para el turno. Un aviso tocado
//     con el dedo se va solo igualmente (el toque no lo para para siempre).
//   · ⛏ se llama «Hard Work» también a 390 px, donde solo se ve el pico.
//   · Con un cerebro EXTERNO guardado no sale la puerta (no descarga nada) y el
//     cerebro carga; si no carga, la puerta sale para el local, con su tamaño.
//
//   BASE=http://localhost:8743 node tests/ux-movil.mjs
import { createServer } from 'node:http';
import { navegador, contexto, pagina, ok, hasta, espera, fin, OUT } from './ux-comun.mjs';

const b = await navegador();
const telefono = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const solapan = (a, c) => !(a.x + a.width <= c.x || c.x + c.width <= a.x || a.y + a.height <= c.y || c.y + c.height <= a.y);

// Un cerebro de prueba (compatible con OpenAI) que escribe DESPACIO y apunta si
// el navegador le cortó la respuesta.
const peticiones = [];
const servidor = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  req.resume();
  req.on('end', () => {
    const r = { cortada: false, terminada: false, enviados: 0 };
    peticiones.push(r);
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const t = setInterval(() => {
      if (r.enviados >= 2000) { clearInterval(t); res.write('data: [DONE]\n\n'); res.end(); r.terminada = true; return; }
      r.enviados++;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'palabra ' } }] })}\n\n`);
    }, 40);
    res.on('close', () => { clearInterval(t); if (!r.terminada) r.cortada = true; });
  });
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const OLLAMA = JSON.stringify({ ollama: { enabled: true, baseURL: `http://localhost:${servidor.address().port}/v1`, model: 'falso', apiKey: 'ollama' } });

// ── avisos y botones del compositor en un teléfono ──────────────────────────
{
  const { ctx } = await contexto(b, { ...telefono, model: 'ext:ollama', extraInit: { 'elffuss.providers': OLLAMA, 'elffuss.movil.ok': '1' } });
  const { p, errores } = await pagina(ctx);
  ok('teléfono: el cerebro de prueba carga', await hasta(() => p.evaluate(() => document.getElementById('model-status').classList.contains('on'))));
  await p.evaluate(async () => (await import('/js/ui.js')).toast('Modelo IA listo · externo', 60000));
  const tapados = () => p.evaluate(() => Object.fromEntries(['send', 'btn-hardwork', 'btn-slash', 'btn-flip', 'prompt'].map(id => {
    const e = document.getElementById(id).getBoundingClientRect();
    const h = document.elementFromPoint(e.left + e.width / 2, e.top + e.height / 2);
    return [id, !!h?.closest('#toasts')];
  })));
  const t1 = await tapados();
  ok('con un aviso a la vista, ni ■/➤, ni ⛏, ni /, ni ⇄, ni la caja de texto quedan debajo', !Object.values(t1).some(Boolean), JSON.stringify(t1));
  await p.evaluate(async () => (await import('/js/ui.js')).modelProgress('Descargando el cerebro · 42 %'));
  await espera(100);
  const cajas = await p.evaluate(() => {
    const r = s => { const e = document.querySelector(s).getBoundingClientRect(); return { x: e.x, y: e.y, width: e.width, height: e.height }; };
    return { aviso: r('#toasts .toast'), progreso: r('#model-progress') };
  });
  ok('…y con la caja de progreso a la vista, el aviso va encima de ella, sin taparla', !solapan(cajas.aviso, cajas.progreso), JSON.stringify(cajas));
  await p.evaluate(async () => (await import('/js/ui.js')).modelProgress(null));
  // ■ con el aviso a la vista: el toque llega a ■ y el turno se para.
  await p.fill('#prompt', 'escribe un poema muy largo');
  await p.press('#prompt', 'Enter');
  await hasta(() => peticiones.length > 0 && peticiones.at(-1).enviados > 3);
  const caja = await p.locator('#send').boundingBox();
  await p.touchscreen.tap(caja.x + caja.width / 2, caja.y + caja.height / 2);
  ok('tocar ■ con un aviso a la vista para el turno (el servidor ve la respuesta cortada)', await hasta(() => peticiones.at(-1).cortada), JSON.stringify(peticiones.at(-1)));
  // Un aviso tocado con el dedo no se queda para siempre.
  await p.evaluate(async () => { document.querySelectorAll('#toasts .toast').forEach(t => t.remove()); (await import('/js/ui.js')).toast('aviso corto', 1500); });
  const aviso = p.locator('#toasts .toast', { hasText: 'aviso corto' });
  const ct = await aviso.locator('.toast-txt').boundingBox();
  await p.touchscreen.tap(ct.x + 10, ct.y + ct.height / 2);
  ok('un aviso tocado con el dedo se va solo igualmente', await hasta(async () => await aviso.count() === 0, { veces: 80, cada: 50 }));
  // ⛏ a 390 px: solo se ve el pico, pero se llama «Hard Work».
  const cdp = await ctx.newCDPSession(p);
  const doc = await cdp.send('DOM.getDocument', {});
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#btn-hardwork' });
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  const nombre = nodes[0]?.name?.value || '';
  ok('a 390 px el botón ⛏ se llama «Hard Work» (no solo el pico)', /Hard Work/.test(nombre)
    && await p.evaluate(() => document.querySelector('#btn-hardwork .hw-txt').getBoundingClientRect().width <= 1), nombre);
  await cdp.detach();
  ok('sin errores de página (avisos en el teléfono)', errores.length === 0, errores.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── 390 px: chat y vista ────────────────────────────────────────────────────
{
  const { ctx } = await contexto(b, telefono);
  const { p, errores } = await pagina(ctx);
  const flip = p.locator('#btn-flip');
  ok('en el chat, el botón dice «✳ Vista» y su nombre explica adónde lleva', (await flip.innerText()).trim() === '✳ Vista'
    && /Ver lo que crea Elffuss/.test(await flip.getAttribute('aria-label')));
  const [bf, bc] = [await flip.boundingBox(), await p.locator('#chips').boundingBox()];
  ok('…y no tapa la fila de chips', !solapan(bf, bc), JSON.stringify({ bf, bc }));
  // Durante una descarga, la caja de progreso no tapa la caja de texto ni el botón
  // (antes, a 390 px, se montaba encima del compositor durante toda la descarga).
  await p.evaluate(async () => (await import('/js/ui.js')).modelProgress('Descargando el cerebro · 42 %'));
  const cajas = await p.evaluate(() => {
    const r = id => { const e = document.getElementById(id).getBoundingClientRect(); return { x: e.x, y: e.y, width: e.width, height: e.height }; };
    const pr = document.getElementById('prompt').getBoundingClientRect();
    const arriba = document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2);
    return { progreso: r('model-progress'), prompt: r('prompt'), composer: r('composer'), flip: r('btn-flip'),
      visible: !document.getElementById('model-progress').hidden, enElPrompt: arriba?.id || arriba?.tagName };
  });
  ok('con una descarga en marcha, la caja de progreso se ve y no tapa el compositor ni el botón ⇄', cajas.visible
    && !solapan(cajas.progreso, cajas.composer) && !solapan(cajas.progreso, cajas.flip) && cajas.enElPrompt === 'prompt', JSON.stringify(cajas));
  await p.evaluate(async () => (await import('/js/ui.js')).modelProgress(null));
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

// ── con un cerebro externo guardado: sin puerta ─────────────────────────────
{
  const { ctx } = await contexto(b, { ...telefono, model: 'ext:ollama', extraInit: { 'elffuss.providers': OLLAMA } });
  const { p, errores } = await pagina(ctx);
  ok('teléfono con un cerebro externo guardado: carga sin la puerta de «descargar ~600 MB»', await hasta(() => p.evaluate(() =>
    document.getElementById('model-select').value === 'ext:ollama' && document.getElementById('model-status').classList.contains('on')))
    && await p.locator('.mobile-gate').count() === 0, await p.locator('.mobile-gate').innerText().catch(() => 'sin puerta'));
  ok('…sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  // Un externo que no carga (OpenAI sin clave): la puerta sale para el local que
  // viene detrás, con SU tamaño.
  const { ctx } = await contexto(b, { ...telefono, model: 'ext:openai',
    extraInit: { 'elffuss.providers': JSON.stringify({ openai: { enabled: true, baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' } }) } });
  const { p } = await pagina(ctx);
  const puerta = p.locator('.mobile-gate');
  ok('si el externo guardado no carga, la puerta sale para el local, con el tamaño de ese (~600 MB)', await hasta(async () => await puerta.count() === 1)
    && /~600 MB/.test(await puerta.innerText()) && await p.evaluate(() => document.getElementById('model-select').value === 'rules'),
    await puerta.innerText().catch(() => 'sin puerta'));
  await ctx.close();
}

{
  // Un Gemma guardado en un teléfono con WebGPU: la puerta dice SU tamaño
  // (~2.8 GB), no el del ligero.
  const { ctx } = await contexto(b, { ...telefono, model: 'litert:gemma-e4b' });
  await ctx.addInitScript(() => {
    const adaptador = { limits: { maxBufferSize: 2 ** 32 }, features: new Set(), info: {}, async requestDevice() { throw new Error('sin GPU en la prueba'); } };
    if (navigator.gpu) { try { navigator.gpu.requestAdapter = async () => adaptador; } catch { /* — */ } }
    else Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => adaptador }, configurable: true });
  });
  const { p } = await pagina(ctx);
  const puerta = p.locator('.mobile-gate');
  ok('con un Gemma guardado, la puerta dice lo que de verdad se bajaría (~2.8 GB)', await hasta(async () => await puerta.count() === 1)
    && /~2\.8 GB/.test(await puerta.innerText()) && !/600 MB/.test(await puerta.innerText()), await puerta.innerText().catch(() => 'sin puerta'));
  await ctx.close();
}

servidor.close();
await fin(b, 'MÓVIL: sin desbordes, «💬 Chat» a la vista, avisos que no tapan ■ y la puerta solo en teléfonos');

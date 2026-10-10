// Selector de modelo.
//   · Nombre accesible propio y estado del punto con palabras.
//   · Si el cerebro elegido no carga, se vuelve al que FUNCIONABA (no a Básico).
//   · Mientras carga, el selector está desactivado (sin cargas en paralelo).
//   · Cambiar de cerebro no te saca de la pestaña en la que estás.
//   · Barra de progreso accesible; ⓘ a la ficha del modelo; etiquetas en inglés.
//
//   BASE=http://localhost:8743 node tests/ux-modelo.mjs
import { createServer } from 'node:http';
import { navegador, contexto, ok, hasta, espera, escribir, reposo, avisos, fin, BASE } from './ux-comun.mjs';

const servidor = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'respuesta de ollama' } }] })}\n\n`);
    res.write('data: [DONE]\n\n'); res.end();
  });
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const PROV = JSON.stringify({
  ollama: { enabled: true, baseURL: `http://localhost:${servidor.address().port}/v1`, model: 'falso', apiKey: 'ollama' },
  openai: { enabled: true, baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' },   // sin clave: no carga
});
const b = await navegador();
const { ctx } = await contexto(b, { model: 'ext:ollama', extraInit: { 'elffuss.providers': PROV } });
const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
const errores = [];
p.on('pageerror', e => { if (!/allow-same-origin/.test(e.message)) errores.push(e.message); });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
const listo = () => p.evaluate(() => document.getElementById('model-select').value === 'ext:ollama' && document.getElementById('model-status').classList.contains('on'));
ok('Ollama (de prueba) cargado', await hasta(listo));
ok('el selector se llama «Cerebro (modelo de IA)» y el punto dice su estado', await p.getAttribute('#model-select', 'aria-label') === 'Cerebro (modelo de IA)'
  && await p.getAttribute('#model-status', 'aria-label') === 'Modelo listo');

await p.click('#tabs button[data-tab="ajustes"]');
await p.evaluate(() => {
  window.__desactivado = [];
  const s = document.getElementById('model-select');
  new MutationObserver(() => window.__desactivado.push(s.disabled)).observe(s, { attributes: true, attributeFilter: ['disabled'] });
  s.value = 'ext:openai';
  s.dispatchEvent(new Event('change'));
});
ok('si el elegido no carga, lo dice y sigue con el que funcionaba', await hasta(async () =>
  (await avisos(p)).some(t => /Sigo con Ollama/.test(t)) && await listo()), (await avisos(p)).join(' | '));
ok('…mientras cargaba el selector estuvo desactivado y luego se reactivó', await p.evaluate(() =>
  window.__desactivado.includes(true) && !document.getElementById('model-select').disabled));
ok('…y no te sacó de Ajustes para enseñar la descarga', await p.evaluate(() => document.querySelector('#tabs [aria-selected="true"]').dataset.tab === 'ajustes'));
await escribir(p, 'hola');
ok('el cerebro que funcionaba sigue contestando', await hasta(async () => /respuesta de ollama/.test(await p.locator('#log').innerText())));
await reposo(p);

// ── barra de progreso y ficha del modelo ────────────────────────────────────
const prog = await p.evaluate(async () => {
  const ui = await import('/js/ui.js');
  ui.modelProgress('Descargando el cerebro · 42 %');
  const t = document.querySelector('#model-progress .track');
  const r = { visible: !document.getElementById('model-progress').hidden, role: t.getAttribute('role'), now: t.getAttribute('aria-valuenow') };
  ui.modelProgress(null);
  ui.setFichaModelo('https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX', 'Qwen3.5-0.8B');
  const a = document.getElementById('model-card');
  r.ficha = { hidden: a.hidden, href: a.href, rel: a.rel, label: a.getAttribute('aria-label') };
  return r;
});
ok('fuera de la Vista, el progreso va en la caja flotante con role=progressbar y aria-valuenow', prog.visible && prog.role === 'progressbar' && prog.now === '42', JSON.stringify(prog));
ok('ⓘ enlaza la ficha del modelo (pestaña nueva, sin referrer) con nombre', !prog.ficha.hidden && /huggingface\.co\/onnx-community/.test(prog.ficha.href)
  && prog.ficha.rel === 'noopener noreferrer' && /Qwen3\.5-0\.8B/.test(prog.ficha.label), JSON.stringify(prog.ficha));

// ── en inglés, las coletillas del selector ──────────────────────────────────
{
  const { ctx: c2 } = await contexto(b, { locale: 'en-US' });
  const e = await c2.newPage();
  await e.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await e.waitForFunction(() => !!window.elffuss?.agent);
  const ops = await e.$$eval('#model-select option', os => os.map(o => o.textContent));
  ok('en inglés: «Basic (no model)» y sin coletillas en español', ops.includes('Basic (no model)') && !ops.some(o => /sin modelo|ligero|por defecto/.test(o)), JSON.stringify(ops));
  ok('en inglés: el selector se llama «Brain (AI model)»', await e.getAttribute('#model-select', 'aria-label') === 'Brain (AI model)');
  await c2.close();
}

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
servidor.close();
await fin(b, 'SELECTOR DE MODELO: vuelve al que funcionaba, se bloquea al cargar y no te mueve de pestaña');

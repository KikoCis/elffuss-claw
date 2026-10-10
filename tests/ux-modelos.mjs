// Espacio de los modelos: el chip 💾 y «Vaciar caché del modelo» cuentan y
// vacían PESOS, no el origen entero.
//   · Con solo datos tuyos (apps, conversación) no hay chip: antes decía
//     «💾 0 MB … pulsa para vaciarlo».
//   · Con pesos guardados (Cache Storage de cualquier proveedor y el OPFS de
//     modelos) el chip los cuenta y vaciarlo libera eso, dice cuánto, y tus apps
//     siguen ahí.
//   · «Vaciar caché del modelo» se desactiva mientras trabaja y dice cuánto liberó.
//
//   BASE=http://localhost:8743 node tests/ux-modelos.mjs
import { navegador, contexto, pagina, ok, hasta, escribir, reposo, avisos, fin, BASE } from './ux-comun.mjs';

const b = await navegador();
const { ctx } = await contexto(b, { grants: ['apps'] });
const { p, errores } = await pagina(ctx);
const listo = () => p.waitForFunction(() => !!window.elffuss?.agent, null, { timeout: 15000 });

await escribir(p, 'hazme un reloj');
await reposo(p);
await p.reload({ waitUntil: 'domcontentloaded' });
await listo();
await p.waitForTimeout(800);
ok('con solo tus datos (una app, la conversación) no hay chip de modelos', await p.evaluate(() => document.getElementById('disk-chip').hidden));

// pesos falsos donde los guardan los proveedores: Cache Storage y OPFS
const sembrar = () => p.evaluate(async () => {
  const c = await caches.open('transformers-cache');
  await c.put('/modelo-falso.bin', new Response(new Uint8Array(3 * 1024 * 1024)));
  const c2 = await caches.open('elffuss-models-v1');
  await c2.put('/gemma-falso.litertlm', new Response(new Uint8Array(1024 * 1024)));
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('elffuss-models', { create: true });
  const f = await dir.getFileHandle('qwen-falso.bin', { create: true });
  const w = await f.createWritable(); await w.write(new Uint8Array(2 * 1024 * 1024)); await w.close();
});
await sembrar();
await p.reload({ waitUntil: 'domcontentloaded' });
await listo();
ok('con pesos guardados aparece el chip y los cuenta (~6 MB)', await hasta(() => p.evaluate(() => {
  const c = document.getElementById('disk-chip');
  return !c.hidden && /💾 6 MB/.test(c.textContent);
})), await p.evaluate(() => document.getElementById('disk-chip').textContent));
ok('su nombre accesible dice qué es y qué hace', /Modelos descargados en este navegador: 6 MB/.test(await p.getAttribute('#disk-chip', 'aria-label') || ''));
p.__aceptar = true;
await p.click('#disk-chip');
ok('la confirmación dice cuánto y que tus datos no se tocan', await hasta(() => (p.__dialogos || []).some(m => /6 MB/.test(m) && /ni apps/.test(m))));
ok('vaciar dice cuánto se liberó', await hasta(async () => (await avisos(p)).some(t => /Liberados 6 MB/.test(t))), (await avisos(p)).join(' | '));
const tras = await p.evaluate(async () => ({
  chip: document.getElementById('disk-chip').hidden,
  caches: await caches.keys(),
  apps: (await (await import('/js/db.js')).all('apps')).length,
}));
ok('…el chip se va, no queda ninguna caché de modelos y tu app sigue ahí', tras.chip && tras.caches.length === 0 && tras.apps === 1, JSON.stringify(tras));

// ── Ajustes · «Vaciar caché del modelo» ─────────────────────────────────────
await sembrar();
await p.click('#tabs button[data-tab="ajustes"]');
const card = p.locator('#panel-ajustes .card', { hasText: 'Modelo descargado' });
ok('Ajustes cuenta los pesos (no el origen entero)', await hasta(async () => /0\.01 GB en caché/.test(await card.innerText())), await card.innerText());
const boton = card.locator('button', { hasText: 'Vaciar caché del modelo' });
await p.evaluate(() => {
  // ver el botón desactivado mientras trabaja
  const b = [...document.querySelectorAll('#panel-ajustes button')].find(x => /Vaciar caché del modelo/.test(x.textContent));
  window.__visto = [];
  new MutationObserver(() => window.__visto.push(b.disabled)).observe(b, { attributes: true, attributeFilter: ['disabled'] });
});
await boton.click();
ok('el botón se desactiva mientras vacía y dice cuánto liberó', await hasta(async () => (await avisos(p)).filter(t => /Liberados 6 MB/.test(t)).length >= 1)
  && (await p.evaluate(() => window.__visto)).includes(true));
ok('y después cuenta cero', await hasta(async () => /Nada cacheado todavía/.test(await card.innerText())));

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
await fin(b, 'MODELOS: el chip 💾 y «Vaciar caché» cuentan y vacían pesos, no tus datos');

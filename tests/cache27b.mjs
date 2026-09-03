// ¿Cabe DE VERDAD el modelo grande en el almacén del navegador?
// ─────────────────────────────────────────────────────────────────────────────
// El test de fronteras (modelparts.mjs) demuestra que la aritmética es correcta;
// este demuestra otra cosa distinta y no deducible: que el modelo grande entero
// entra en la cuota. Se hace con el fichero de verdad porque el límite depende
// del disco de cada máquina y de si el origen es persistente, no de nuestro
// código: el resultado de este test NO se puede dar por válido en otro equipo.
//
// Ejecutar:  BASE=http://localhost:8642 node tests/cache27b.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8642';
const URL_MODELO = BASE + (process.env.MODELO || '/models/qwen38-27b.gguf');
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const GB = n => (n / 2 ** 30).toFixed(2) + ' GB';

const ARGS = { args: ['--enable-unsafe-webgpu', '--use-angle=metal'] };
const b = await chromium.launch(ARGS).catch(() => chromium.launch({ ...ARGS, channel: 'chrome' }));
const ctx = await b.newContext();
await ctx.addInitScript(() => {
  try { localStorage.setItem('elffuss.model', 'rules'); } catch { /* — */ }
  try { sessionStorage.setItem('elffuss.broker.down', '1'); } catch { /* — */ }
});
const p = await ctx.newPage();
p.on('console', m => { if (m.text().startsWith('[cache27b]')) console.log('   ' + m.text()); });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

const res = await p.evaluate(async url => {
  const st = await import('/js/runtime/model-store.js');
  await st.removeModel(url);
  const antes = await navigator.storage.estimate();
  const persistido = await navigator.storage.persisted().catch(() => false);
  let ultimo = '', t0 = performance.now(), error = null, partes = null;
  try {
    partes = await st.getModelParts(url, m => {
      ultimo = m;
      if (performance.now() - t0 > 15000) { t0 = performance.now(); console.log('[cache27b] ' + m); }
    });
  } catch (e) { error = String(e.message || e); }
  const despues = await navigator.storage.estimate();
  const out = {
    persistido, quota: antes.quota, usadoAntes: antes.usage, usadoDespues: despues.usage,
    ultimo, error,
    nPartes: partes ? partes.length : 0,
    total: partes ? partes.reduce((s, f) => s + f.size, 0) : 0,
  };
  // Comprobar que se relee entero antes de liberar el espacio.
  if (partes) {
    const r = await st.openRanged(url);
    out.sizeRanged = r.size;
    const cab = new Uint8Array(await r.slice(0, 4));
    out.magic = String.fromCharCode(...cab);
    const fin = new Uint8Array(await r.slice(r.size - 16, 16));
    out.finBytes = fin.length;
  }
  await st.removeModel(url);
  return out;
}, URL_MODELO);

console.log(`cuota anunciada ${GB(res.quota)} · persistente: ${res.persistido}`);
ok('el modelo grande se guarda entero en el almacén', !res.error && res.total > 0,
  res.error ? `${GB(res.total)} en ${res.nPartes} partes — ${res.error}`
    : `${GB(res.total)} en ${res.nPartes} partes`);
if (!res.error) {
  ok('se relee entero por rangos', res.sizeRanged === res.total, GB(res.sizeRanged || 0));
  ok('empieza por la firma GGUF (no es basura ni un HTML de error)', res.magic === 'GGUF', res.magic);
  ok('el último bloque de bytes se lee', res.finBytes === 16, res.finBytes + ' bytes');
}
await b.close();
console.log(fails ? `\n❌ ${fails} FALLO(S)` : `\n✅ EL MODELO GRANDE CABE Y SE RELEE`);
process.exit(fails ? 1 : 0);

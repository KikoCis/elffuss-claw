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
// Conceder almacenamiento DURABLE. No es maquillaje del test: a un origen no
// persistente Chrome le da bastante menos cuota, y sin esto el modelo grande
// entra unas veces y se corta al 96% otras. Un usuario real que use la web con
// cierta asiduidad SÍ obtiene la persistencia; lo que no la tiene es un perfil
// temporal recién creado como el de este test. Se concede por CDP porque la
// lista de permisos de Playwright no incluye este.
try {
  const cdp = await b.newBrowserCDPSession();
  await cdp.send('Browser.grantPermissions', { origin: BASE, permissions: ['durableStorage'] });
} catch (e) { console.log('   (no se pudo conceder persistencia: ' + e.message + ')'); }
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
  // Cuánto llegó a escribirse de verdad. Sin esto un fallo de cuota a mitad de
  // una descarga de gigabytes se reporta igual que un fallo instantáneo, y no
  // son el mismo problema ni de lejos: uno es «no cabe», el otro «no arranca».
  let escrito = 0, ficheros = 0;
  try {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('elffuss-models');
    for await (const [nombre, h] of d.entries()) {
      if (h.kind !== 'file') continue;
      ficheros++;
      escrito += (await h.getFile()).size;
      void nombre;
    }
  } catch { /* — */ }
  const out = {
    persistido, quota: antes.quota, usadoAntes: antes.usage, usadoDespues: despues.usage,
    ultimo, error, escrito, ficheros,
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

    // LO QUE NO SE DEDUCE DEL TEST DE FRONTERAS: leer a caballo de dos partes
    // sobre el fichero REAL, contrastado contra el mismo fichero servido por
    // HTTP. El fixture sintético prueba la aritmética; esto prueba que las
    // partes guardadas contienen de verdad los bytes que tocan, en orden.
    let cortes = 0, malos = 0;
    let acc = 0;
    for (const f of partes.slice(0, -1)) {
      acc += f.size;
      const desde = acc - 24;
      const mio = new Uint8Array(await r.slice(desde, 48));
      const resp = await fetch(url, { headers: { Range: `bytes=${desde}-${desde + 47}` } });
      const suyo = new Uint8Array(await resp.arrayBuffer());
      cortes++;
      if (mio.length !== suyo.length || mio.some((v, i) => v !== suyo[i])) malos++;
    }
    out.cortes = cortes; out.cortesMalos = malos;

    // Y que el parser del motor lo lea entero por este camino.
    try {
      const { openGGUF } = await import('/js/engine/gguf.js');
      const g = await openGGUF(url, st);   // (url, almacén), en ese orden
      out.tensores = g.tensors.length;
      out.arq = g.meta['general.architecture'];
    } catch (e) { out.parseError = String(e.message || e); }
  }
  await st.removeModel(url);
  return out;
}, URL_MODELO);

console.log(`cuota anunciada ${GB(res.quota)} · persistente: ${res.persistido}`);
// Que quepa o no NO depende de este código: depende de la cuota que el
// navegador conceda en esta máquina, que es una fracción del disco y varía
// entre ejecuciones. Así que se separan las dos preguntas — si no cabe, lo que
// se exige es que falle LIMPIO, que es lo único nuestro.
const noCabe = res.error && /No cabe|quota/i.test(res.error);
if (noCabe) {
  console.log('\n⚠️  EL MODELO NO CABE EN ESTE NAVEGADOR — la parte de releerlo queda SIN COMPROBAR.');
  console.log('   ' + res.error.split('\n')[0]);
  console.log('   último progreso: ' + res.ultimo);
  ok('al no caber, falla con un mensaje que dice cuánto entró y qué hacer',
    /\d/.test(res.error) && /espacio|modelo más pequeño/i.test(res.error));
  ok('y no deja gigabytes huérfanos ocupando disco', res.escrito === 0 && res.ficheros === 0,
    `${GB(res.escrito)} en ${res.ficheros} fichero(s)`);
} else {
  ok('el modelo grande se guarda entero en el almacén', !res.error && res.total > 0,
    res.error || `${GB(res.total)} en ${res.nPartes} partes`);
}
if (!res.error) {
  ok('se relee entero por rangos', res.sizeRanged === res.total, GB(res.sizeRanged || 0));
  ok('empieza por la firma GGUF (no es basura ni un HTML de error)', res.magic === 'GGUF', res.magic);
  ok('el último bloque de bytes se lee', res.finBytes === 16, res.finBytes + ' bytes');
  ok(`los ${res.cortes} puntos de corte entre partes coinciden con el fichero por HTTP`,
    res.cortes > 0 && res.cortesMalos === 0,
    res.cortesMalos ? `${res.cortesMalos} de ${res.cortes} mal` : `${res.cortes} fronteras byte a byte`);
  ok('el parser del motor lee el modelo entero desde las partes',
    !res.parseError && res.tensores > 0,
    res.parseError || `${res.tensores} tensores · arquitectura ${res.arq}`);
}
await b.close();
// Un «OK» a secas cuando el modelo ni llegó a guardarse haría creer que se ha
// comprobado lo que no se ha comprobado.
console.log(fails ? `\n❌ ${fails} FALLO(S)`
  : noCabe ? `\n⚠️  FALLA LIMPIO, pero AQUÍ NO CABE — sin comprobar la relectura`
  : `\n✅ EL MODELO GRANDE CABE Y SE RELEE`);
process.exit(fails ? 1 : 0);

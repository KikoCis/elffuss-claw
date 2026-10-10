// Quitar una automatización de carpetas mientras el vigilante está trabajando.
// ─────────────────────────────────────────────────────────────────────────────
// El vigilante (tools/watch.js) leía la lista al empezar la pasada, procesaba
// los ficheros y al final GUARDABA esa lista entera. Si mientras procesaba
// quitabas una automatización, la guardaba de nuevo: la automatización
// RESUCITABA y seguía cogiendo ficheros de una carpeta que ya no querías vigilar.
// Igual con las tareas programadas: el planificador escribía su copia vieja de
// la tarea y resucitaba una recién borrada.
//
// La prueba quita la automatización JUSTO cuando el vigilante avisa de que ha
// cogido el primer fichero (o sea, a mitad de la pasada, antes de que guarde),
// y comprueba que no vuelve, que deja de procesar esa carpeta y que la otra
// automatización sigue funcionando con lo que ya llevaba visto. Y borra una
// tarea vencida justo entre la lectura del planificador y su escritura: no
// resucita ni se lanza.
//
//   python3 server/serve.py 8742 &   BASE=http://localhost:8742 node tests/watch-remove.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8742';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('elffuss.model', 'rules');
    localStorage.setItem('elffuss.welcomed', '1');
    localStorage.setItem('elffuss.grants', JSON.stringify(['fs', 'apps', 'vault', 'tasks', 'web', 'memory']));
  } catch {}
});
const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
const errores = [];
p.on('pageerror', e => { if (!/allow-same-origin/.test(e.message)) errores.push(e.message); });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.elffuss?.agent, null, { timeout: 15000 });

// Carpetas OPFS registradas como autorizadas (los selectores nativos piden gesto).
const ids = await p.evaluate(async () => {
  const db = await import('/js/db.js');
  const { watch } = await import('/js/tools/index.js');
  const opfs = await navigator.storage.getDirectory();
  for (const n of ['entrada', 'salida', 'entrada2', 'salida2']) await db.set('fs', n, await opfs.getDirectoryHandle(n, { create: true }));
  const a = await watch.add({ from: 'entrada', to: 'salida' });
  const b2 = await watch.add({ from: 'entrada2', to: 'salida2' });
  return { a: a.match(/Automatización (w[a-z0-9]+)/)[1], b: b2.match(/Automatización (w[a-z0-9]+)/)[1] };
});
ok('dos automatizaciones creadas', !!ids.a && !!ids.b && ids.a !== ids.b, JSON.stringify(ids));

// Quitar A en cuanto el vigilante avise de que ha cogido su PRIMER fichero:
// en ese momento la pasada sigue en marcha y aún no ha guardado nada.
await p.evaluate(async idA => {
  const { watch } = await import('/js/tools/index.js');
  window.__quitada = null;
  const obs = new MutationObserver(() => {
    if (window.__quitada) return;
    const aviso = [...document.querySelectorAll('#log .msg.assistant')].find(d => /He cogido «.+» de entrada,/.test(d.textContent));
    if (!aviso) return;
    window.__quitada = watch.removeWatch({ id: idA }).then(() => 'hecho');
    obs.disconnect();
  });
  obs.observe(document.getElementById('log'), { childList: true });
  const opfs = await navigator.storage.getDirectory();
  const escribe = async (dir, nombre, texto) => {
    const fh = await (await opfs.getDirectoryHandle(dir)).getFileHandle(nombre, { create: true });
    const w = await fh.createWritable(); await w.write(texto); await w.close();
  };
  await escribe('entrada', 'uno.txt', 'uno');
  await escribe('entrada', 'dos.txt', 'dos');
  await escribe('entrada2', 'tres.txt', 'tres');
}, ids.a);

const lista = () => p.evaluate(async () => (await (await import('/js/db.js')).get('kv', 'automations')) || []);
const salida = dir => p.evaluate(async d => {
  const out = [];
  for await (const e of (await (await navigator.storage.getDirectory()).getDirectoryHandle(d)).values()) out.push(e.name);
  return out.sort();
}, dir);

// Esperar a que la pasada termine de verdad: tres.txt (de B) apuntado como visto.
let tras = [];
for (let i = 0; i < 60; i++) {
  tras = await lista();
  const bw = tras.find(w => w.id === ids.b);
  if (bw?.seen?.['tres.txt'] && await p.evaluate(() => !!window.__quitada)) break;
  await p.waitForTimeout(500);
}
ok('se quitó A a mitad de la pasada (al avisar del primer fichero)', await p.evaluate(async () => (await window.__quitada) === 'hecho'));
ok('A NO resucita al guardar la pasada', !tras.some(w => w.id === ids.a), JSON.stringify(tras.map(w => w.id)));
const bw = tras.find(w => w.id === ids.b);
ok('B sigue y conserva lo procesado en esa misma pasada', !!bw && !!bw.seen?.['tres.txt'], JSON.stringify(bw?.seen || null));

// Un fichero nuevo en la carpeta de A ya no se procesa; en la de B, sí.
await p.evaluate(async () => {
  const opfs = await navigator.storage.getDirectory();
  const escribe = async (dir, nombre, texto) => {
    const fh = await (await opfs.getDirectoryHandle(dir)).getFileHandle(nombre, { create: true });
    const w = await fh.createWritable(); await w.write(texto); await w.close();
  };
  await escribe('entrada', 'cuatro.txt', 'cuatro');
  await escribe('entrada2', 'cinco.txt', 'cinco');
});
let s2 = [];
for (let i = 0; i < 50 && !s2.includes('cinco.txt'); i++) { await p.waitForTimeout(500); s2 = await salida('salida2'); }
await p.waitForTimeout(1000);
const s1 = await salida('salida');
ok('B sigue vigilando: cinco.txt llega a salida2', s2.includes('cinco.txt'), s2.join(', '));
ok('A ya no vigila: cuatro.txt NO llega a salida', !s1.includes('cuatro.txt'), s1.join(', '));
const avisosCuatro = (await p.locator('#log .msg.assistant').allTextContents()).filter(t => t.includes('«cuatro.txt»')).length;
ok('  ni se avisa de él en el chat', avisosCuatro === 0);
const avisosTres = (await p.locator('#log .msg.assistant').allTextContents()).filter(t => t.includes('«tres.txt»')).length;
ok('cada fichero se procesa una sola vez (sin pasadas solapadas)', avisosTres === 1, `${avisosTres} avisos de tres.txt`);

// ── db.update: leer-modificar-escribir en una sola transacción ───────────────
const upd = await p.evaluate(async () => {
  const db = await import('/js/db.js');
  await db.del('kv', 'prueba-contador');
  await Promise.all(Array.from({ length: 25 }, () => db.update('kv', 'prueba-contador', n => (n || 0) + 1)));
  const contador = await db.get('kv', 'prueba-contador');
  const nada = await db.update('kv', 'prueba-inexistente', () => undefined);
  const existe = (await db.keys('kv')).includes('prueba-inexistente');
  await db.del('kv', 'prueba-contador');
  return { contador, nada, existe };
});
ok('db.update: 25 incrementos concurrentes no se pisan', upd.contador === 25, `contador=${upd.contador}`);
ok('db.update: devolver undefined no escribe (no resucita claves)', upd.nada === undefined && !upd.existe);

// ── tareas: una tarea vencida se lanza una vez; una borrada no vuelve ────────
// La tarea se borra JUSTO entre la lectura del planificador (pending(), un
// getAll) y su escritura, que es donde está la carrera. Borrarla antes de que
// el planificador llegue a leerla no probaba nada: pasaba igual con el
// planificador viejo, que escribía la copia leída y resucitaba la tarea.
await p.evaluate(async () => {
  const db = await import('/js/db.js');
  const ahora = Date.now();
  window.__borradaEntre = false;
  const getAll = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll = function (...a) {
    const req = getAll.apply(this, a);
    if (this.name === 'tasks' && !window.__borradaEntre) {
      const idb = this.transaction.db;
      // Este oyente va antes que el onsuccess del lector: la transacción de
      // borrado se crea antes que cualquier escritura del planificador, y
      // IndexedDB ejecuta las de escritura en el orden en que se crean.
      req.addEventListener('success', () => {
        if (window.__borradaEntre || !req.result?.some(t => t.id === 'tborra')) return;
        window.__borradaEntre = true;
        idb.transaction('tasks', 'readwrite').objectStore('tasks').delete('tborra');
      });
    }
    return req;
  };
  await db.set('tasks', 'tvence', { id: 'tvence', when: ahora - 1000, prompt: 'aviso de prueba vencido', done: false });
  await db.set('tasks', 'tborra', { id: 'tborra', when: ahora - 1000, prompt: 'esta no debe salir', done: false });
});
// Las lecturas de la prueba van por getAllKeys/get y no por getAll, para que el
// gancho solo vea la lectura del planificador.
const leerTareas = () => p.evaluate(async () => {
  const db = await import('/js/db.js');
  return Promise.all((await db.keys('tasks')).map(id => db.get('tasks', id)));
});
let tareas = [];
for (let i = 0; i < 40; i++) {
  tareas = await leerTareas();
  if (tareas.find(t => t.id === 'tvence')?.done) break;
  await p.waitForTimeout(500);
}
await p.waitForTimeout(800);
tareas = await leerTareas();
const textoLog = await p.locator('#log').innerText();
ok('premisa: la tarea se borró entre la lectura del planificador y su escritura', await p.evaluate(() => window.__borradaEntre));
ok('la tarea vencida se marca hecha y se lanza una vez', tareas.find(t => t.id === 'tvence')?.done === true
  && textoLog.split('[tarea programada] aviso de prueba vencido').length - 1 === 1);
ok('la tarea borrada no resucita ni se lanza', !tareas.some(t => t.id === 'tborra') && !textoLog.includes('esta no debe salir'),
  JSON.stringify(tareas.map(t => t.id)));

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ AUTOMATIZACIONES Y TAREAS: lo quitado no vuelve');
await b.close();
process.exit(fails ? 1 : 0);

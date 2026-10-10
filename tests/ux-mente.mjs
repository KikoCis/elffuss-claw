// La Mente y el cerebro autónomo, sin modelo (proveedor de prueba cuando hace
// falta que piense):
//   · cargar la página no trae three.js; abrir la Mente NO enciende el cerebro,
//     no pide notificaciones ni carga SoundCloud; es modal (foco dentro, lo de
//     detrás inerte, Escape cierra y el foco vuelve a 🧠);
//   · el historial incluye lo que pasó con la Mente cerrada;
//   · en Básico «Pensar ahora» explica por qué no piensa y no saca permisos;
//   · ▶/⏸ dice siempre la verdad, y «Reprogramar» no enciende nada;
//   · el cerebro solo puede LEER: un app.create suyo no crea nada;
//   · la propuesta llega al chat, se guarda con su botón, sobrevive a recargar,
//     su enlace abre la Mente en ella; en Básico «Ejecutar» no ejecuta;
//   · las etiquetas son botones clicables enteros y vuelven tras recargar;
//   · «Ver el fichero» lo lee en el chat; la notificación lleva a la propuesta;
//   · «▶ Ejecutar» de la Mente tampoco ejecuta en Básico, y su aviso se ve y se
//     pulsa con la Mente abierta (los avisos van encima y no quedan inertes);
//   · cerrar la Mente limpia #/mente/… de la URL (el mismo enlace vuelve a abrir)
//     y «Atrás» la cierra; cargar la página en #/mente o #/mente/<ruta> la abre.
//
//   BASE=http://localhost:8743 node tests/ux-mente.mjs
import { navegador, contexto, pagina, ok, hasta, espera, avisos, fin, kv, BASE, OUT } from './ux-comun.mjs';

const b = await navegador();
const notifStub = () => {
  window.__notifs = []; window.__pidioNotif = 0;
  class N {
    constructor(title, opts) { this.title = title; this.opts = opts; this.closed = false; window.__notifs.push(this); }
    close() { this.closed = true; }
    static get permission() { return window.__permNotif || 'default'; }
    static requestPermission() { window.__pidioNotif++; return Promise.resolve(N.permission); }
  }
  window.Notification = N;
};
const { ctx, fuera } = await contexto(b, { grants: ['fs'] });
await ctx.addInitScript(notifStub);
// Todos los avisos que salen, aunque se vayan solos antes de mirarlos.
// (se observa desde antes de que corra la app: un aviso del arranque llega antes de DOMContentLoaded)
await ctx.addInitScript(() => {
  window.__avisos = [];
  new MutationObserver(ms => {
    for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('toast')) window.__avisos.push(n.textContent);
  }).observe(document, { childList: true, subtree: true });
});
const { p, errores } = await pagina(ctx);

// carpeta autorizada de prueba (OPFS registrada como carpeta, sin picker)
await p.evaluate(async () => {
  const opfs = await navigator.storage.getDirectory();
  const f = await opfs.getFileHandle('README.md', { create: true });
  const w = await f.createWritable(); await w.write('# demo\nNOTA-LEIDA-7731\n'); await w.close();
  await (await import('/js/db.js')).set('fs', 'proyecto', opfs);
});

const three = () => fuera.filter(u => /cdn\.jsdelivr\.net\/npm\/three/.test(u)).length;
ok('cargar la página no pide three.js (la Mente se carga al abrirla)', three() === 0, fuera.filter(u => /jsdelivr/.test(u)).join(' | '));

// ── lo que pasa con la Mente cerrada queda en el historial ──────────────────
await p.evaluate(async () => { const ceo = await import('/js/ceo.js'); ceo.enable(); ceo.disable(); });
ok('el botón 🧠 tiene nombre accesible', /Mente de Elffuss/.test(await p.getAttribute('#btn-mind', 'aria-label') || ''));

// ── abrir: solo abrir ───────────────────────────────────────────────────────
await p.evaluate(() => { localStorage.removeItem('elffuss.ceoEnabled'); });
await p.click('#btn-mind');
ok('la Mente se abre (modal: role=dialog, aria-modal)', await hasta(() => p.evaluate(() => {
  const o = document.getElementById('mind-overlay');
  return o && o.getAttribute('role') === 'dialog' && o.getAttribute('aria-modal') === 'true' && o.style.display !== 'none';
}), { veces: 400 }));
await espera(300);
const abierta = await p.evaluate(async () => ({
  ceo: (await import('/js/ceo.js')).isEnabled(),
  guardado: localStorage.getItem('elffuss.ceoEnabled'),
  pidio: window.__pidioNotif,
  foco: document.activeElement?.id,
  inerte: document.querySelector('header').inert && document.querySelector('main').inert,
  musica: !!document.querySelector('#mind-sc'),
  boton: document.getElementById('mind-playstop').textContent,
}));
ok('abrir la Mente NO enciende el cerebro (ni lo guarda)', !abierta.ceo && abierta.guardado == null, JSON.stringify(abierta));
ok('ni pide permiso de notificaciones', abierta.pidio === 0);
ok('ni carga SoundCloud: la música es un botón', !abierta.musica && !fuera.some(u => /soundcloud/.test(u)));
ok('el foco entra en la Mente y lo de detrás queda inerte', abierta.foco === 'mind-close' && abierta.inerte, JSON.stringify(abierta));
ok('el interruptor dice lo que hará («activar cerebro»)', /activar cerebro/.test(abierta.boton), abierta.boton);
await p.click('#mind-history');
const hist = await p.locator('#mind-log-body').innerText();
ok('el historial incluye lo que pasó con la Mente cerrada', /CEO en guardia/.test(hist) && /CEO en pausa/.test(hist), hist.slice(-200));
await p.keyboard.press('Escape');
ok('Escape cierra primero el panel de historial', await p.evaluate(() => !document.getElementById('mind-log').classList.contains('show')
  && document.getElementById('mind-overlay').style.display !== 'none'));
await p.keyboard.press('Escape');
ok('y luego la Mente, devolviendo el foco a 🧠 y la página', await hasta(() => p.evaluate(() =>
  document.getElementById('mind-overlay').style.display === 'none' && document.activeElement?.id === 'btn-mind' && !document.querySelector('header').inert)));

// ── música solo si la pides ─────────────────────────────────────────────────
await p.click('#btn-mind');
await hasta(() => p.evaluate(() => document.getElementById('mind-overlay').style.display !== 'none'));
await p.click('#mind-music-btn');
ok('♪ monta el reproductor solo al pedirlo', await hasta(() => p.evaluate(() => !!document.querySelector('#mind-sc')))
  && await p.getAttribute('#mind-music-btn', 'aria-pressed') === 'true');
await p.click('#mind-music-btn');
ok('y ♪ otra vez lo quita', await p.evaluate(() => !document.querySelector('#mind-sc')));

// ── Básico: «Pensar ahora» explica y no hace nada más ───────────────────────
await p.click('#mind-config');
await p.click('#cfg-think-now');
ok('en Básico, «Pensar ahora» dice que hace falta un modelo y el panel sigue abierto', await hasta(async () =>
  /modelo cargado/.test(await p.locator('#cfg-status').innerText()) && await p.evaluate(() => document.getElementById('mind-cfg').classList.contains('show'))));
await espera(400);
ok('…sin diálogos de permiso ni apps creadas', !(await p.evaluate(() => document.getElementById('perm-dialog').open))
  && (await p.evaluate(async () => (await (await import('/js/db.js')).all('apps')).length)) === 0);
ok('la carpeta-alma dice dónde está («dentro de «proyecto»»)', /dentro de «proyecto»/.test(await p.locator('#cfg-dir-label').innerText()));
ok('los colores de perfil tienen nombre', await p.evaluate(() => [...document.querySelectorAll('.cp-color')].every(i => /^Color de /.test(i.getAttribute('aria-label') || ''))));

// ── ▶/⏸: siempre la verdad; Reprogramar no enciende ─────────────────────────
await p.click('#cfg-x');
await p.click('#mind-playstop');
ok('▶ enciende: el botón pasa a «pausar»', /pausar/.test(await p.locator('#mind-playstop').innerText()));
await p.click('#mind-playstop');
ok('⏸ pausa: «reanudar»', await hasta(async () => /reanudar/.test(await p.locator('#mind-playstop').innerText())));
await p.click('#mind-config');
await p.click('#cfg-save');
const trasGuardar = await p.evaluate(async () => ({ on: (await import('/js/ceo.js')).isEnabled(), txt: document.getElementById('mind-playstop').textContent }));
ok('«Reprogramar» no enciende un cerebro pausado (y el botón sigue diciendo «reanudar»)', !trasGuardar.on && /reanudar/.test(trasGuardar.txt), JSON.stringify(trasGuardar));
await p.evaluate(async () => (await import('/js/ceo.js')).enable());
ok('si se enciende por otro lado, el botón se repinta solo', await hasta(async () => /pausar/.test(await p.locator('#mind-playstop').innerText())));
await p.evaluate(async () => (await import('/js/ceo.js')).disable());
const leyenda = await p.evaluate(() => [...document.querySelectorAll('#mind-legend .ml-item')].every(e => e.tagName === 'BUTTON'));
ok('la leyenda de perfiles son botones', leyenda);
await p.click('#mind-close');

// ── un ciclo de verdad (proveedor de prueba): solo lectura + propuesta ──────
await p.evaluate(async () => {
  const ceo = await import('/js/ceo.js');
  window.__llamadas = [];
  // solo el proveedor: el onEvent sigue siendo el del kernel (chat, historial…)
  ceo.init({
    provider: () => ({
      chat: async (history) => {
        const last = history[history.length - 1].content;
        window.__llamadas.push(last.slice(0, 40));
        if (last.startsWith('[resultado app.create]')) { window.__bloqueado = last; return 'Propuesta de productividad: agrupar las apps de reloj y notas en un panel único que se abra al entrar, con atajos.'; }
        if (last.startsWith('[resultado fs.read]')) return 'Propuesta basada en lo leído (' + (/NOTA-LEIDA-7731/.test(last) ? 'NOTA-LEIDA-7731' : 'nada') + '): ordenar el README por secciones y añadir un índice al principio.';
        if (/jefe de Productividad/.test(last)) return '```tool\n{"tool":"app.create","args":{"name":"boceto","html":"<h1>x</h1>"}}\n```';
        if (/jefe de Organización/.test(last)) return '```tool\n{"tool":"fs.read","args":{"path":"README.md"}}\n```';
        return 'Propuesta de memoria: recordar que el usuario trabaja con documentos en Markdown y prefiere índices claros.';
      },
    }),
  });
  window.__permNotif = 'granted';
  const t0 = Date.now();
  while (!ceo.isThisTabLeader() && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 100));
  window.__ciclo = await ceo.forceCycle();
});
ok('el ciclo corre', await p.evaluate(() => window.__ciclo === true));
ok('el cerebro NO puede crear apps: su app.create recibe un error y no se crea nada',
  /solo puedes leer/.test(await p.evaluate(() => window.__bloqueado || '')) && (await p.evaluate(async () => (await (await import('/js/db.js')).all('apps')).length)) === 0);
ok('…pero sí leer la carpeta (fs.read)', /NOTA-LEIDA-7731/.test(await p.locator('#log').innerText()));
const msg = p.locator('#log .msg.assistant', { hasText: 'Revisé tu espacio' }).last();
ok('la propuesta llega al chat sin decir «mientras estabas fuera»', await msg.count() === 1 && !/Mientras estabas fuera/.test(await msg.innerText()));
const hist2 = await kv(p, 'history');
ok('y se guarda en el historial con su propuesta', Array.isArray(hist2) && hist2.some(m => m.propuesta?.path?.includes('.elffuss/soul/')));
const n = await p.evaluate(() => window.__notifs.map(x => x.title));
ok('se notifica (permiso ya concedido)', n.length === 1, JSON.stringify(n));
await p.evaluate(() => window.__notifs[0].onclick());
ok('pulsar la notificación abre la Mente en la propuesta', await hasta(() => p.evaluate(() =>
  document.getElementById('mind-overlay').style.display !== 'none' && document.getElementById('mind-panel').classList.contains('show'))));
const etiqueta = p.locator('.mind-node-label').first();
ok('las etiquetas de propuesta son botones con clic propio', await etiqueta.evaluate(e => e.tagName === 'BUTTON' && getComputedStyle(e).pointerEvents === 'auto'));
await p.evaluate(() => document.getElementById('mind-panel').classList.remove('show'));
const caja = await etiqueta.boundingBox();
await p.mouse.click(caja.x + 3, caja.y + caja.height / 2);   // el borde, no el centro
ok('…y un clic en el BORDE de la etiqueta abre la propuesta', await hasta(() => p.evaluate(() => document.getElementById('mind-panel').classList.contains('show'))));
ok('el botón del fichero se llama «Ver el fichero»', (await p.locator('#mp-open').innerText()) === 'Ver el fichero');
await p.click('#mp-open');
ok('«Ver el fichero» cierra la Mente y lo lee en el chat', await hasta(async () =>
  await p.evaluate(() => document.getElementById('mind-overlay').style.display === 'none')
  && /Propuestas de mejora/.test(await p.locator('#log').innerText())));

// ── en Básico, «Ejecutar» no ejecuta ────────────────────────────────────────
const antes = await p.locator('#log .msg.user').count();
await msg.locator('.proposal-exec-btn').click();
ok('en Básico «Ejecutar» explica que hace falta un modelo y no manda nada', await hasta(async () =>
  (await avisos(p)).some(t => /modelo cargado/.test(t))) && await p.locator('#log .msg.user').count() === antes);

// ── tras recargar: el aviso vuelve con su botón, y la Mente con su etiqueta ─
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.elffuss?.agent);
ok('tras recargar, el aviso del cerebro sigue en el chat con su botón', await hasta(async () =>
  await p.locator('#log .msg.assistant', { hasText: 'Revisé tu espacio' }).locator('.proposal-exec-btn').count() === 1));
const enlace = p.locator('#log .msg.assistant', { hasText: 'Revisé tu espacio' }).locator('a[href^="#/mente/"]');
ok('el aviso enlaza a la propuesta en la Mente', await enlace.count() === 1);
await enlace.click();
ok('el enlace abre la Mente en esa propuesta (la etiqueta volvió de la carpeta)', await hasta(() => p.evaluate(() =>
  document.getElementById('mind-panel')?.classList.contains('show') && document.querySelectorAll('.mind-node-label').length > 0), { veces: 300 }));
if (OUT) await p.screenshot({ path: OUT + '/ux-mente.png' });

// ── «▶ Ejecutar» DENTRO de la Mente, en Básico: tampoco ejecuta ─────────────
// (antes solo el botón del chat lo comprobaba; el de la Mente mandaba la
// propuesta al motor de reglas, que creaba apps con lo que encontrara)
const usuariosAntes = await p.locator('#log .msg.user').count();
const appsAntes = await p.evaluate(async () => (await (await import('/js/db.js')).all('apps')).length);
await p.click('#mp-exec');
const aviso = p.locator('#toasts .toast', { hasText: 'modelo cargado' }).last();
ok('en Básico «▶ Ejecutar» de la Mente explica que hace falta un modelo y no manda nada', await hasta(async () => await aviso.count() > 0)
  && await p.locator('#log .msg.user').count() === usuariosAntes
  && await p.evaluate(async () => (await (await import('/js/db.js')).all('apps')).length) === appsAntes);
ok('…y la Mente y la propuesta siguen abiertas', await p.evaluate(() =>
  document.getElementById('mind-overlay').style.display !== 'none' && document.getElementById('mind-panel').classList.contains('show')));
// Los avisos se ven y se pulsan con la Mente abierta (antes quedaban detrás e inertes).
const visible = !(await aviso.count()) ? { encima: false, falta: true } : await aviso.evaluate(el => {
  const r = el.getBoundingClientRect();
  const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { encima: el.contains(arriba), inerte: document.getElementById('toasts').inert };
});
ok('el aviso se ve ENCIMA de la Mente y no está inerte', visible.encima && !visible.inerte, JSON.stringify(visible));
await aviso.locator('.toast-accion').click({ timeout: 5000 }).catch(() => {});
ok('su acción «Elegir modelo» se puede pulsar: cierra la Mente y enfoca el selector', await hasta(() => p.evaluate(() =>
  document.getElementById('mind-overlay').style.display === 'none' && document.activeElement?.id === 'model-select')));

// ── cerrar la Mente devuelve la URL a la pestaña; el mismo enlace vuelve a abrir ─
ok('cerrar la Mente quita #/mente/… de la URL', await hasta(() => p.evaluate(() => !location.hash.startsWith('#/mente'))),
  await p.evaluate(() => location.hash));
await p.keyboard.press('Escape');   // por si la Mente siguiera abierta
await enlace.click({ timeout: 5000 }).catch(() => {});
ok('pulsar OTRA VEZ el mismo enlace vuelve a abrir la Mente', await hasta(() => p.evaluate(() =>
  document.getElementById('mind-overlay').style.display !== 'none' && document.getElementById('mind-panel').classList.contains('show')), { veces: 300 }));
await p.keyboard.press('Escape');   // primero el panel de la propuesta
await p.keyboard.press('Escape');   // luego la Mente
ok('…y Escape la cierra con la URL limpia', await hasta(() => p.evaluate(() =>
  document.getElementById('mind-overlay').style.display === 'none' && !location.hash.startsWith('#/mente'))));
await p.click('#tabs button[data-tab="apps"]', { timeout: 5000 }).catch(() => {});
await enlace.click({ timeout: 5000 }).catch(() => {});
await hasta(() => p.evaluate(() => document.getElementById('mind-overlay').style.display !== 'none'));
await p.goBack();
ok('«Atrás» con la Mente abierta la cierra y vuelve a Apps', await hasta(() => p.evaluate(() =>
  document.getElementById('mind-overlay').style.display === 'none' && location.hash === '#/apps')));

// ── abrir la PÁGINA en #/mente/<ruta> abre la Mente (antes: error de TDZ) ───
const ruta = await enlace.getAttribute('href');
const erroresAntes = errores.length;
// Carga de verdad (desde otra página): un goto que solo cambia el fragmento no recarga.
const cargarEn = async h => {
  await p.goto('about:blank');
  await p.goto(BASE + '/' + h, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !!window.elffuss?.agent);
};
await cargarEn(ruta);
ok('cargar la página en #/mente/<ruta> abre la Mente en esa propuesta', await hasta(() => p.evaluate(() =>
  !!document.getElementById('mind-overlay') && document.getElementById('mind-overlay').style.display !== 'none'
  && document.getElementById('mind-panel').classList.contains('show')), { veces: 300 }));
const avisosCarga = await p.evaluate(() => window.__avisos);
ok('…sin el aviso «No he podido abrir la Mente»', !avisosCarga.some(t => /No he podido abrir la Mente|before initialization/.test(t)),
  JSON.stringify(avisosCarga));
await cargarEn('#/mente/' + encodeURIComponent('.elffuss/soul/no-existe.md'));
ok('una propuesta que no existe abre la Mente y lo dice en un aviso visible', await hasta(async () =>
  await p.evaluate(() => !!document.getElementById('mind-overlay') && document.getElementById('mind-overlay').style.display !== 'none')
  && (await avisos(p)).some(t => /No encuentro esa propuesta/.test(t)), { veces: 300 }));
const x = p.locator('#toasts .toast', { hasText: 'No encuentro esa propuesta' }).locator('.toast-x');
await x.click({ timeout: 5000 }).catch(() => {});
ok('…y su ✕ se puede pulsar con la Mente abierta', await hasta(async () =>
  !(await avisos(p)).some(t => /No encuentro esa propuesta/.test(t))));
await cargarEn('#/mente');
ok('cargar la página en #/mente abre la Mente', await hasta(() => p.evaluate(() =>
  !!document.getElementById('mind-overlay') && document.getElementById('mind-overlay').style.display !== 'none'), { veces: 300 }));
ok('ninguna carga en #/mente dejó errores de página', errores.length === erroresAntes, errores.slice(erroresAntes).join(' | '));

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
await fin(b, 'MENTE: abrir no enciende, modal, historial completo, solo lectura, propuestas que se guardan y se enlazan');

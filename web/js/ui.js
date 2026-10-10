// UI: chat + visualizador + paneles. Todo el DOM vive aquí.
import * as db from './db.js';
import * as perms from './permissions.js';
import * as settings from './settings.js';
import * as skills from './skills.js';
import { fs, apps, vault, tasks } from './tools/index.js';
import { renderMarkdown, linkify } from './md.js';
import * as rutas from './rutas.js';
import { t as tr, uiLang } from './i18n.js';
import { humanizeStreamPreview } from './humanize.js'; // alias: dentro de tick(t) el token ya se llama t
import { UI } from './icons.js';
import { cacheEstimate } from './model-cache.js';
import * as modelos from './model-storage.js';
import * as workspace from './workspace.js';
import * as telemetry from './telemetry.js';

let onSettingsChangedCb = () => {};
let onSkillInstalledCb = () => {};

const $ = id => document.getElementById(id);

// ---------- chat ----------
export function addMsg(cls, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  // las respuestas de Elffuss se renderizan como markdown; lo del usuario, plano
  if (cls === 'assistant') {
    div.classList.add('md');
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }
  $('log').appendChild(div);
  $('log').scrollTop = $('log').scrollHeight;
  return div;
}

// Una línea de la conversación que escucha el copiloto (viene del Translator):
// quién habla y qué dice, con su estilo, no como un mensaje del usuario.
export function addTranscripcion(quien, texto) {
  const div = document.createElement('div');
  div.className = 'msg transcript';
  const q = document.createElement('b');
  q.textContent = quien + ': ';
  div.append(q, document.createTextNode(texto));
  $('log').appendChild(div);
  $('log').scrollTop = $('log').scrollHeight;
  return div;
}

function shortArgs(args = {}) {
  const s = Object.entries(args)
    .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(' · ');
  return s ? ` (${s.slice(0, 120)})` : '';
}

// Adónde lleva cada herramienta: el «🔧 app.create …» del chat enlaza a lo que
// ha tocado (la app, las tareas, las skills, las carpetas).
function rutaDeHerramienta(call) {
  const t = call.tool || '', a = call.args || {};
  if ((t === 'app.create' || t === 'app.open') && a.name) return rutas.href('apps', a.name);
  if (t.startsWith('app.')) return rutas.href('apps');
  if (t === 'tasks.add' || t === 'tasks.list' || t === 'tasks.remove') return rutas.href('tareas');
  if (t.startsWith('fs.watch')) return rutas.href('tareas', 'automatizaciones');
  if ((t === 'skill.create' || t === 'skill.edit' || t === 'skill.get') && a.name) return rutas.href('skills', a.name);
  if (t.startsWith('skill.')) return rutas.href('skills');
  if (t.startsWith('fs.')) return rutas.href('permisos');
  if (t.startsWith('vault.')) return rutas.href('vault');
  return null;
}

export function addTool(call) {
  const div = addMsg('tool', `🔧 ${call.tool}${shortArgs(call.args)}`);
  const destino = rutaDeHerramienta(call);
  if (destino) {
    const a = document.createElement('a');
    a.href = destino;
    a.className = 'tool-link';
    a.textContent = '↗';
    a.title = tr('toolGoTo');
    a.setAttribute('aria-label', tr('toolGoTo'));
    div.append(' ', a);
  }
  return div;
}

export function addToolResult(tool, result) {
  const err = result.startsWith('ERROR');
  const det = document.createElement('details');
  det.className = 'msg tool-result' + (err ? ' err' : '');
  const sum = document.createElement('summary');
  sum.textContent = (err ? '⚠️ ' : '✓ ') + result.split('\n')[0].slice(0, 110);
  const pre = document.createElement('pre');
  // Las URL de web.fetch / web.search se pueden abrir (http y https, pestaña
  // nueva, sin referrer); el resto sigue siendo texto plano.
  pre.innerHTML = linkify(result.slice(0, 2000));
  det.append(sum, pre);
  $('log').appendChild(det);
  $('log').scrollTop = $('log').scrollHeight;
}

// Burbuja de «pensando»: visible, con avatar, puntos animados y el texto
// del modelo en streaming (cola de 240 caracteres).
export function thinkingBubble() {
  const div = document.createElement('div');
  div.className = 'msg thinking';
  const img = document.createElement('img');
  img.src = 'img/elffuss.svg';
  img.className = 'mini';
  img.alt = '';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = tr('thinking');
  const dots = document.createElement('span');
  dots.className = 'dots';
  dots.append(...[0, 1, 2].map(() => document.createElement('i')));
  const gen = document.createElement('div');
  gen.className = 'gen';
  div.append(img, label, dots, gen);
  // #log es una región viva (role=log en index.html). La burbuja se oculta a los
  // lectores de pantalla: cambia de texto con cada token y se leería sin parar.
  // Mientras trabaja, el log queda «ocupado» y lo que llegue se anuncia al final.
  div.setAttribute('aria-hidden', 'true');
  $('log').setAttribute('aria-busy', 'true');
  $('log').appendChild(div);
  $('log').scrollTop = $('log').scrollHeight;
  // Barra del PREFILL. El prefill es la espera larga —leer el prompt antes de
  // escribir la primera letra— y hasta ahora no se veía: con un prompt de arnés
  // en el modelo grande son decenas de segundos de burbuja quieta, y una espera
  // sin señal se lee como «se ha colgado». De hecho se reportó así.
  //
  // Va DENTRO de la burbuja que ya existe en vez de un elemento nuevo: la
  // burbuja aparece justo cuando empieza el turno, que es exactamente cuando
  // empieza el prefill.
  const barra = document.createElement('div');
  barra.className = 'prefill';
  const relleno = document.createElement('i');
  barra.appendChild(relleno);
  barra.hidden = true;
  div.insertBefore(barra, gen);

  let buf = '';
  return {
    // `hechos` y `total` vienen del motor por lote TERMINADO en la GPU, no
    // encolado: la barra no llega al 100 % antes de tiempo.
    prefill(hechos, total) {
      if (!total) return;
      const pct = Math.max(0, Math.min(100, Math.round((hechos / total) * 100)));
      label.textContent = tr('reading', { p: pct });
      barra.hidden = false;
      relleno.style.width = pct + '%';
    },
    tick(t) {
      // Al escribir la primera letra el prefill ha terminado: fuera la barra, o
      // se quedaría puesta al 100 % durante toda la respuesta.
      if (!barra.hidden) barra.hidden = true;
      buf += t;
      label.textContent = tr('writing', { n: buf.length });
      // Si está emitiendo un tool-call (p.ej. app.create con un HTML enorme), NO
      // volcamos el JSON/HTML crudo que parpadea: una frase humana («creando
      // app…»). Para el texto normal, caja que CRECE y se puede leer/scrollear
      // entera (antes se mostraban solo los últimos 240 y desaparecía lo de
      // arriba). Se respeta tu scroll si subes a leer.
      const preview = humanizeStreamPreview(buf);
      if (preview) {
        gen.classList.add('tool-preview');
        gen.textContent = '⟐ ' + preview;
      } else {
        gen.classList.remove('tool-preview');
        const pegado = gen.scrollHeight - gen.scrollTop - gen.clientHeight < 28;
        gen.textContent = buf;
        if (pegado) gen.scrollTop = gen.scrollHeight;
      }
    },
    tool(name) {
      buf = '';
      gen.textContent = '';
      label.textContent = tr('using', { name });
    },
    // ■ pulsado y el turno aún soltando el modelo: la burbuja lo dice en vez
    // de seguir animando como si nada.
    stopping() {
      label.textContent = tr('stopping');
      div.classList.add('stopping');
    },
    // Lo que llegó a escribir, si era texto para el usuario (no una herramienta
    // a medias, que se enseña como «creando app…»): lo que se conserva al parar.
    partial() { return humanizeStreamPreview(buf) ? '' : buf.trim(); },
    remove() { div.remove(); if (!document.querySelector('#log .msg.thinking')) $('log').removeAttribute('aria-busy'); },
  };
}

// Un mensaje de la cola que ■ dejó sin procesar: tachado y, para quien no lo
// ve, dicho con palabras (el tachado solo no llega a un lector de pantalla).
export function markCancelled(el) {
  if (!el) return;
  el.classList.remove('queued');
  el.classList.add('cancelled');
  if (el.querySelector('.sr-only')) return;
  const s = document.createElement('span');
  s.className = 'sr-only';
  s.textContent = ' ' + tr('cancelled');
  el.append(s);
}

// Región viva (#stop-status) para lo que no se oye de otro modo: parar con el
// ratón o con Enter deja el foco en otro sitio, el botón solo lo dice en su
// etiqueta y el chat no es una región viva. Se vacía y se escribe en otra
// tarea para que el mismo texto dos veces seguidas se vuelva a leer.
let anuncio = null;
export function announce(texto) {
  const r = $('stop-status');
  if (!r) return;
  clearTimeout(anuncio);
  r.textContent = '';
  anuncio = setTimeout(() => { r.textContent = texto; }, 50);
}

// Vaciar el chat a la vista, dejando el saludo (🧹).
export function clearLog() {
  for (const el of [...$('log').children]) if (!el.classList.contains('sys')) el.remove();
}

// Avisos. Antes se iban a los 4,5 s pasara lo que pasara: uno de 184 caracteres
// (el de Hard Work) no daba tiempo a leerlo, no había forma de quitarlos ni de
// pararlos, y ninguno llevaba a ningún sitio. Ahora:
//   · duran según lo que hay que leer, y se paran con el ratón o el foco encima;
//   · se cierran con ✕;
//   · pueden llevar UNA acción («Deshacer», «Ver tarea», «Elegir ahora»…);
//   · #toasts es una región viva (index.html): un lector de pantalla los anuncia.
// `opts` admite un número (ms), como antes, o { ms, accion: { label, run } }.
export function toast(text, opts = {}) {
  if (typeof opts === 'number') opts = { ms: opts };
  const { accion = null, ms = null } = opts || {};
  const t = document.createElement('div');
  t.className = 'toast';
  const txt = document.createElement('span');
  txt.className = 'toast-txt';
  txt.textContent = text;
  t.appendChild(txt);
  let timer = null, restante = 0, desde = 0, parado = false;
  const quitar = () => { clearTimeout(timer); t.remove(); };
  if (accion?.label && typeof accion.run === 'function') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-accion';
    b.textContent = accion.label;
    b.onclick = () => { quitar(); try { accion.run(); } catch (e) { console.warn('[elffuss] acción del aviso:', e); } };
    t.appendChild(b);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'toast-x';
  x.textContent = '✕';
  x.title = tr('close');
  x.setAttribute('aria-label', tr('close'));
  x.onclick = quitar;
  t.appendChild(x);
  $('toasts').appendChild(t);
  // ~50 ms por carácter, entre 4 y 12 s; con acción, unos segundos más para
  // que dé tiempo a decidir.
  restante = ms ?? (Math.min(12000, Math.max(4000, 1500 + String(text).length * 50)) + (accion ? 4000 : 0));
  const arrancar = () => { desde = Date.now(); clearTimeout(timer); timer = setTimeout(quitar, restante); };
  const pausar = () => { if (parado) return; parado = true; clearTimeout(timer); restante = Math.max(1500, restante - (Date.now() - desde)); };
  const seguir = () => { if (!parado || t.matches(':hover') || t.contains(document.activeElement)) return; parado = false; arrancar(); };
  t.addEventListener('mouseenter', pausar);
  t.addEventListener('mouseleave', seguir);
  t.addEventListener('focusin', pausar);
  t.addEventListener('focusout', () => setTimeout(seguir, 0));
  arrancar();
  return t;
}

// ---------- modal de permisos ----------
// Tres cosas que fallaban, las tres con el teclado:
//   · Escape cerraba el diálogo SIN contestar: la promesa no se resolvía nunca,
//     el turno se quedaba colgado en «Elffuss está usando…» y todo lo que
//     escribieras después esperaba en la cola hasta recargar —y con ella el
//     cerebro CEO, que no arrancaba otro ciclo—. Ahora Escape (y cualquier otro
//     cierre) es «Denegar».
//   · Dos peticiones a la vez se pisaban los botones: la segunda reasignaba los
//     onclick de la primera, que ya no se podía contestar. Ahora van en cola,
//     una detrás de otra (permissions.js ya las pone en fila por ámbito; esta
//     cola cubre además a quien llame aquí directamente).
//   · Si la petición nacía de un Enter (p. ej. en la contraseña de la Bóveda),
//     el diálogo se abría DENTRO de ese mismo evento, el foco caía en «Denegar»
//     y la misma pulsación lo activaba: denegado sin haberlo visto. Ahora se
//     abre en la tarea siguiente, cuando esa tecla ya ha terminado.
let colaPermisos = Promise.resolve();
export function askPermission(scope, meta, detail) {
  const turno = colaPermisos.then(() => mostrarPermiso(scope, meta, detail));
  colaPermisos = turno.catch(() => {});
  return turno;
}

function mostrarPermiso(scope, meta, detail) {
  return new Promise(resolve => {
    const dlg = $('perm-dialog');
    $('perm-title').textContent = `${meta?.icon || '❓'} ${tr('permWord')}: ${meta?.label || scope}`;
    $('perm-desc').textContent = meta?.desc || '';
    $('perm-detail').textContent = detail || '';
    const previo = document.activeElement;
    let hecho = false, mostrado = false;
    const done = ok => {
      if (hecho) return;
      hecho = true;
      $('perm-allow').onclick = null;
      $('perm-deny').onclick = null;
      dlg.removeEventListener('cancel', alCancelar);
      dlg.removeEventListener('close', alCerrar);
      if (dlg.open) dlg.close();
      refreshPerms();
      if (previo && previo !== document.body && document.contains(previo)) {
        try { previo.focus({ preventScroll: true }); } catch { /* — */ }
      }
      resolve(ok);
    };
    const alCancelar = e => { e.preventDefault(); done(false); };   // Escape = Denegar
    // Cualquier otro cierre, también. Pero solo el de ESTE diálogo: el evento
    // «close» de la petición anterior llega en una tarea aparte, cuando esta ya
    // ha empezado a escuchar, y sin la guarda la denegaba antes de enseñarla.
    const alCerrar = () => { if (mostrado && !dlg.open) done(false); };
    $('perm-allow').onclick = () => done(true);
    $('perm-deny').onclick = () => done(false);
    dlg.addEventListener('cancel', alCancelar);
    dlg.addEventListener('close', alCerrar);
    setTimeout(() => {
      if (hecho) return;
      try { dlg.showModal(); mostrado = true; } catch { done(false); }
    }, 0);
  });
}

// ---------- visualizador ----------
const isMobile = () => matchMedia('(max-width: 700px)').matches;

// Cuándo abrió el USUARIO una app a mano (panel Apps o su dirección): el
// tablero del copiloto no la tapa durante un rato (ver kernel.js).
let aperturaManualT = 0;
export const aperturaManual = () => aperturaManualT;

// `ruta`: es una app guardada (apps.create/open) y su dirección es #/apps/<nombre>.
// El tablero del copiloto también se pinta aquí, pero no es una app guardada.
export function renderApp(name, html, { ruta = false } = {}) {
  _stage?.hide?.($('vista-empty'), false);   // si estaba el escaparate de descarga, quitarlo
  $('vista-empty').hidden = true;
  const frame = $('appframe');
  frame.hidden = false;
  frame.srcdoc = html;
  frame.title = tr('appFrameT', { name });
  selectTab('vista', { reflejar: !ruta });
  if (ruta) rutas.reflejar('apps', name);
  refreshApps();
  if (isMobile()) flipTo('viz'); // en móvil, saltar a ver la app recién creada
}

// móvil: una sola columna, chat ↔ visualizador conmutables
export function mostrarChat() { if (isMobile()) flipTo('chat'); }
function flipTo(side) {
  document.body.classList.toggle('show-viz', side === 'viz');
  pintarFlip();
}
// El botón dice adónde lleva, en el idioma de la página (empezaba con «Vista»
// escrito en el HTML para todos los idiomas).
function pintarFlip() {
  const enViz = document.body.classList.contains('show-viz');
  const b = $('btn-flip');
  b.textContent = enViz ? tr('flipChat') : tr('flipView');
  b.setAttribute('aria-label', enViz ? tr('flipToChat') : tr('flipToView'));
}

// ---------- pestañas ----------
// Pestañas de verdad (tablist/tab/tabpanel, aria-selected, tabindex itinerante y
// flechas) y con dirección: cada una se refleja en la URL (#/apps, #/tareas…;
// ver rutas.js), así que se pueden enlazar, guardar y recorrer con «Atrás».
// `push`: un clic del usuario crea entrada de historial; lo que se abre solo
// (la Vista al crear una app) reemplaza la actual y no ensucia el historial.
export function selectTab(name, { push = false, reflejar = true } = {}) {
  document.querySelectorAll('#tabs button').forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.panel').forEach(p =>
    p.classList.toggle('active', p.id === 'panel-' + name));
  if (reflejar) rutas.reflejar(name, null, { push });
  if (name === 'apps') return refreshApps();
  if (name === 'tareas') return refreshTasks();
  if (name === 'vault') return refreshVault();
  if (name === 'permisos') return refreshPerms();
  if (name === 'ajustes') return refreshSettings();
  if (name === 'skills') return refreshSkillsPanel();
}

// Ir a donde dice una ruta (#/…). Lo usan el arranque, «Atrás»/«Adelante» y
// los enlaces del chat. La Mente no vive en ui.js: la abre quien la registre.
let onMenteCb = () => {};
export function setOnMente(fn) { onMenteCb = fn; }
export async function navegar(ruta) {
  if (!ruta) return;
  const { seccion, detalle } = ruta;
  const verPanel = async (tab) => { await selectTab(tab, { reflejar: false }); if (isMobile()) flipTo('viz'); };
  if (seccion === 'mente') return onMenteCb(detalle);
  if (seccion === 'modelo') {
    // No es un sitio sino una acción: se hace y la URL vuelve a decir dónde estás.
    rutas.reflejar(tabActiva() || 'vista');
    enfocarSelectorModelo();
    return;
  }
  if (seccion === 'apps' && detalle) {
    const app = (await apps.allApps()).find(a => a.name === detalle);
    if (app) { aperturaManualT = Date.now(); await apps.open({ name: app.name }); rutas.reflejar('apps', app.name); return; }
    toast(tr('appMissing', { name: detalle }));
    return verPanel('apps');
  }
  if (!['vista', 'apps', 'tareas', 'vault', 'skills', 'permisos', 'ajustes'].includes(seccion)) return;
  await verPanel(seccion);
  if (detalle) resaltar(seccion, detalle);
}

// Señala un elemento dentro del panel (una tarea, una skill, la sección
// «Acerca de»…): lo trae a la vista, lo marca y le da el foco.
function resaltar(seccion, detalle) {
  const panel = $('panel-' + seccion);
  const sel = `[data-ruta="${CSS.escape(detalle)}"]`;
  const tryIt = (n = 0) => {
    const el = panel?.querySelector(sel);
    if (!el) { if (n < 20) setTimeout(() => tryIt(n + 1), 50); return; }
    panel.querySelectorAll('.resaltado').forEach(e => e.classList.remove('resaltado'));
    el.classList.add('resaltado');
    if (!el.hasAttribute('tabindex') && !/^(BUTTON|A|INPUT|DETAILS|SUMMARY)$/.test(el.tagName)) el.tabIndex = -1;
    el.scrollIntoView({ block: 'nearest' });
    try { el.focus({ preventScroll: true }); } catch { /* — */ }
  };
  tryIt();
}

// El selector de modelo es un <select>: se enfoca y, donde se puede, se
// despliega. Es a donde llevan los «elige un modelo arriba» del chat.
export function enfocarSelectorModelo() {
  const sel = $('model-select');
  if (!sel) return;
  if (isMobile()) flipTo('chat');
  sel.focus();
  try { sel.showPicker?.(); } catch { /* sin gesto de usuario no se despliega: queda enfocado */ }
}

// Skills en su propia pestaña (visible y descubrible)
export function refreshSkillsPanel() {
  const panel = $('panel-skills');
  panel.replaceChildren(el('h3', null, tr('skillsTitle')));
  panel.appendChild(el('p', 'muted', tr('skillsDesc')));
  renderSkills(panel);
}

function card(...children) {
  const c = document.createElement('div');
  c.className = 'card';
  c.append(...children);
  return c;
}
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (label, cls, onClick) => {
  const b = el('button', cls, label);
  b.onclick = onClick;
  return b;
};

// ---------- panel apps ----------
export async function refreshApps() {
  const list = await apps.allApps();
  const panel = $('panel-apps');
  panel.replaceChildren(el('h3', null, tr('appsTitle')));
  if (!list.length) {
    panel.appendChild(el('p', 'muted', tr('appsEmpty')));
    return;
  }
  for (const app of list) {
    panel.appendChild(card(
      el('b', null, app.name),
      el('span', 'muted', new Date(app.created).toLocaleString(uiLang())),
      // Por apps.open(): así la app abierta es ESTA también para el modelo
      // (CONTEXTO AHORA), no solo en pantalla.
      btn(tr('open'), 'primary', () => { aperturaManualT = Date.now(); apps.open({ name: app.name }).catch(e => toast('⚠️ ' + e.message)); }),
      btn('🗑', 'ghost', async () => { await apps.removeApp({ name: app.name }); refreshApps(); }),
    ));
  }
}

// ---------- panel tareas ----------
export async function refreshTasks() {
  const list = (await db.all('tasks')).sort((a, b) => a.when - b.when);
  const panel = $('panel-tareas');
  panel.replaceChildren(el('h3', null, tr('tasksTitle')));
  if (!list.length) {
    panel.appendChild(el('p', 'muted', tr('tasksEmpty')));
    return;
  }
  for (const t of list) {
    const c = card(
      el('span', null, t.done ? '✅' : '⏳'),
      el('b', null, t.prompt),
      el('span', 'muted', new Date(t.when).toLocaleString(uiLang())),
      btn('🗑', 'ghost', async () => { await tasks.removeTask({ id: t.id }); refreshTasks(); }),
    );
    c.dataset.ruta = t.id;          // #/tareas/<id>
    panel.appendChild(c);
  }
}

// ---------- panel vault ----------
// Lo que haces aquí lo haces tú: no pasa por el permiso «Bóveda», que es el del
// agente (ver tools/vault.js, `desdePanel`). Y el panel se repinta cuando la
// bóveda se cierra sola: antes seguía ofreciendo «Bloquear ahora» y un secreto
// revelado se quedaba en claro.
const VAULT_REVELADO_MS = 30000;   // un secreto a la vista se vuelve a tapar solo
let vaultOyente = null;
const tabActiva = () => document.querySelector('#tabs button.active')?.dataset.tab;
export async function refreshVault() {
  vaultOyente ||= vault.alBloquear(motivo => {
    if (tabActiva() === 'vault') refreshVault();
    if (motivo === 'auto') toast(tr('vaultAutoLocked'));
  });
  const panel = $('panel-vault');
  panel.replaceChildren(el('h3', null, tr('vaultTitle')));
  const setup = await vault.isSetup();

  if (!vault.isUnlocked()) {
    panel.appendChild(el('p', 'muted', setup ? tr('vaultLocked') : tr('vaultUnset')));
    // Un <form>: Enter envía como el botón, sin un keydown a mano.
    const form = el('form', 'row');
    const input = el('input');
    input.type = 'password';
    input.id = 'vault-master';
    input.autocomplete = setup ? 'current-password' : 'new-password';
    input.placeholder = tr('vaultMasterPh');
    input.setAttribute('aria-label', tr('vaultMasterPh'));
    const go = el('button', 'primary', setup ? tr('vaultUnlock') : tr('vaultCreate'));
    go.type = 'submit';
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!input.value) { input.focus(); return; }
      go.disabled = true;
      try {
        await vault.unlock(input.value, { desdePanel: true });
        toast(setup ? tr('vaultUnlockedT') : tr('vaultCreatedT'));
        await refreshVault();
        panel.querySelector('#vault-name')?.focus();
      } catch (err) {
        go.disabled = false;
        toast('⚠️ ' + (/incorrecta/.test(err.message) ? tr('vaultWrongPw') : err.message));
        input.select();
      }
    });
    form.append(input, go);
    panel.appendChild(form);
    return;
  }

  const estado = el('div', 'row between');
  estado.append(el('span', 'muted', tr('vaultOpenState')),
    btn(tr('vaultLockNow'), 'ghost', () => { vault.lock(); toast(tr('vaultLockedNow')); }));
  panel.appendChild(estado);

  const form = el('form', 'row');
  const name = el('input');
  name.id = 'vault-name';
  name.placeholder = tr('vaultNamePh');
  name.setAttribute('aria-label', tr('vaultNameL'));
  const secret = el('input');
  secret.type = 'password';
  secret.autocomplete = 'off';
  secret.placeholder = tr('vaultSecretPh');
  secret.setAttribute('aria-label', tr('vaultSecretL'));
  const add = el('button', 'primary', tr('save'));
  add.type = 'submit';
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await vault.setSecret({ name: name.value.trim(), secret: secret.value }, { desdePanel: true });
      toast(tr('vaultSavedT', { name: name.value.trim() }));
      name.value = secret.value = '';
      await refreshVault();
      panel.querySelector('#vault-name')?.focus();
    } catch (err) { toast('⚠️ ' + err.message); }
  });
  form.append(name, secret, add);
  panel.appendChild(form);

  for (const n of await vault.secretNames()) {
    const val = el('code', null, '••••••');
    let tapar = null;
    const ver = btn('👁', 'ghost', async () => {
      if (ver.getAttribute('aria-pressed') === 'true') { ocultar(); return; }
      try {
        val.textContent = await vault.getSecret({ name: n }, { desdePanel: true });
        ver.setAttribute('aria-pressed', 'true');
        ver.title = tr('vaultHide', { name: n });
        clearTimeout(tapar);
        tapar = setTimeout(ocultar, VAULT_REVELADO_MS);
      } catch (err) { toast('⚠️ ' + err.message); refreshVault(); }
    });
    const ocultar = () => {
      clearTimeout(tapar);
      val.textContent = '••••••';
      ver.setAttribute('aria-pressed', 'false');
      ver.title = tr('vaultShow', { name: n });
    };
    ver.setAttribute('aria-pressed', 'false');
    ver.title = tr('vaultShow', { name: n });
    ver.setAttribute('aria-label', tr('vaultShowL', { name: n }));
    const borrar = btn('🗑', 'ghost', async () => {
      if (!window.confirm(tr('vaultDelConfirm', { name: n }))) return;
      try { await vault.removeSecret({ name: n }); toast(tr('vaultDeleted', { name: n })); }
      catch (err) { toast('⚠️ ' + err.message); }
      refreshVault();
    });
    borrar.title = tr('vaultDel', { name: n });
    borrar.setAttribute('aria-label', tr('vaultDel', { name: n }));
    panel.appendChild(card(el('b', null, n), val, ver, borrar));
  }
}

// ---------- panel permisos ----------
export async function refreshPerms() {
  const panel = $('panel-permisos');
  panel.replaceChildren(el('h3', null, tr('permsTitle')));
  const g = perms.grants();
  if (!g.length)
    panel.appendChild(el('p', 'muted', tr('permsEmpty')));
  for (const scope of g) {
    const meta = perms.SCOPES[scope] || {};
    panel.appendChild(card(
      el('b', null, `${meta.icon || ''} ${meta.label || scope}`),
      el('span', 'muted', meta.desc || ''),
      btn(tr('revoke'), 'ghost', () => { perms.revoke(scope); refreshPerms(); }),
    ));
  }
  const folders = await fs.folders();
  if (folders.length) {
    panel.appendChild(el('h3', null, tr('foldersTitle')));
    for (const f of folders) {
      const c = card(
        el('b', null, '📁 ' + f),
        btn(tr('remove'), 'ghost', async () => { await db.del('fs', f); refreshPerms(); }),
      );
      c.dataset.ruta = f;           // #/permisos/<carpeta>
      panel.appendChild(c);
    }
  }
}

// ---------- progreso y estado del modelo ----------
// Escaparate de descarga: mientras baja el modelo y NO hay app abierta, mostramos
// la galaxia + carrusel de mini-UIs en el panel Vista (en móvil evita la caja
// flotante que se solapaba con el compositor). Con app abierta → caja flotante.
let _stage = null;
async function _loadStage() { if (!_stage) _stage = await import('./loading-stage.js'); return _stage; }
function _pct(p) {
  if (typeof p === 'string') return p;
  if (p && p.status === 'progress' && p.total) return Math.round(p.loaded / p.total * 100);
  return p;
}
async function _showStage(p) {
  const st = await _loadStage();
  if (!st.isMounted()) {
    await st.show($('panel-vista'), $('vista-empty'));
    selectTab('vista');
    if (isMobile()) flipTo('viz');   // en móvil, enseñar el escaparate
  }
  st.setProgress(_pct(p));
}

export function modelProgress(p) {
  const box = $('model-progress');
  const appHidden = $('appframe').hidden !== false;   // ¿aún no hay app abierta?
  if (p == null) {                                     // carga terminada
    box.hidden = true;
    _stage?.hide?.($('vista-empty'), appHidden);
    return;
  }
  if (appHidden) { box.hidden = true; _showStage(p); return; }

  box.hidden = false;
  if (typeof p === 'string') {
    $('model-progress-text').textContent = p;
    // Sacar el % del texto, igual que hace el escaparate (loading-stage.js).
    // Los proveedores informan con cadenas del tipo «… · 42 %», y este camino
    // —la caja flotante, o sea con la app abierta— las daba TODAS por
    // desconocidas: la barra se quedaba animada de principio a fin aunque el
    // porcentaje viniera dentro. Con un modelo de gigabytes eso es la
    // diferencia entre ver que avanza y creer que se ha colgado.
    const m = p.match(/(\d+)\s*%/);
    if (m) {
      $('model-bar').classList.remove('indet');
      $('model-bar').style.width = Math.min(100, +m[1]) + '%';
    } else {
      $('model-bar').classList.add('indet');  // sin % conocido → barra animada
      $('model-bar').style.width = '';
    }
    return;
  }
  if (p.status === 'progress' && p.total) {
    const pct = Math.round(p.loaded / p.total * 100);
    $('model-bar').classList.remove('indet');
    $('model-bar').style.width = pct + '%';
    $('model-progress-text').textContent =
      `Descargando modelo · ${pct}% · ${(p.loaded / 1e6 | 0)}/${(p.total / 1e6 | 0)} MB`;
  }
}

export function modelStatus(state) { // 'off' | 'loading' | 'on' | 'gpu'
  $('model-status').className = 'dot ' + state;
}

// ---------- selector de modelo (dinámico) ----------
export function rebuildModelSelect(options, current) {
  const sel = $('model-select');
  sel.replaceChildren();
  // Los grupos van SIEMPRE al final, pase lo que pase con el orden de la lista.
  // Se creaban según aparecían, y bastó meter un cerebro agrupado en mitad de la
  // lista para que «Básico (sin modelo)» —la opción más segura que hay— quedara
  // colgando por debajo del encabezado «⚠ Avanzado», como si fuera uno de ellos.
  const groups = new Map();   // label de optgroup → <optgroup>
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.label;
    if (o.group) {            // cerebros «Avanzado · poco rendimiento» agrupados y avisados
      let g = groups.get(o.group);
      if (!g) { g = document.createElement('optgroup'); g.label = o.group; groups.set(o.group, g); }
      g.appendChild(opt);
    } else {
      sel.appendChild(opt);
    }
  }
  for (const g of groups.values()) sel.appendChild(g);
  if (current && options.some(o => o.id === current)) sel.value = current;
}

export function setModel(id) { $('model-select').value = id; }


// Consumo en vivo: qué está gastando Elffuss ahora mismo y cómo soltarlo.
// Se refresca solo mientras el panel está abierto.
function usageCard() {
  const card = el('div', 'card col');
  card.appendChild(el('b', null, '📊 ' + tr('useTitle')));
  const ram = el('div', 'row between'), disk = el('div', 'row between'), brain = el('div', 'row between');
  const mk = (row, label) => { row.appendChild(el('span', 'muted', label)); const v = el('span', null, '…'); row.appendChild(v); card.appendChild(row); return v; };
  const vRam = mk(ram, tr('useRam')), vDisk = mk(disk, tr('useDisk')), vBrain = mk(brain, tr('useBrain'));
  const gb = n => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : Math.round(n / 1048576) + ' MB';
  const freeBtn = btn(tr('useFree'), 'ghost', () => { onFreeModelCb(); toast(tr('useFreed')); setTimeout(paint, 400); });
  card.appendChild(freeBtn);
  let timer = null;
  async function paint() {
    const m = performance.memory;
    vRam.textContent = m?.jsHeapSizeLimit
      ? `${gb(m.usedJSHeapSize)} / ${gb(m.jsHeapSizeLimit)} (${Math.round(m.usedJSHeapSize / m.jsHeapSizeLimit * 100)}%)`
      : tr('useNoRam');
    // Este origen (estimate) más el almacén compartido, medido por model-storage.js
    // como el chip y «Vaciar caché»: el modelo grande vive en los brokers de sus
    // hosts y estimate() no lo ve. Sin camino al compartido no hay «?».
    const [{ usage, quota, persisted }, m2] = await Promise.all([cacheEstimate(), modelos.medir()]);
    const comp = { usage: m2.compartido, ok: m2.compartidoOk || !m2.hayCompartido };
    vDisk.textContent = `${gb(usage + comp.usage)}${quota ? ' / ' + gb(quota) : ''} ${persisted ? '· ✓' : '· ⚠'}` + (comp.ok ? '' : ' · ?');
    const sel = $('model-select');
    vBrain.textContent = sel ? (sel.options[sel.selectedIndex]?.textContent || '—').slice(0, 34) : '—';
    freeBtn.style.display = (sel && sel.value !== 'rules') ? '' : 'none';
    // refrescar solo mientras se está viendo
    clearTimeout(timer);
    if (document.querySelector('#tabs button.active')?.dataset.tab === 'ajustes') timer = setTimeout(paint, 4000);
  }
  paint();
  return card;
}
let onFreeModelCb = () => {};
export function setOnFreeModel(fn) { onFreeModelCb = fn; }
let onWipeCb = async () => { await workspace.wipe({ confirm: 'BORRAR' }); location.reload(); };
export function setOnWipe(fn) { onWipeCb = fn; }

// ---------- espacio de trabajo (carpeta en disco, inventario, limpieza) ----------
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';

function workspaceCard() {
  const card = el('div', 'card col');
  card.appendChild(el('b', null, '💾 ' + tr('wsTitle')));
  card.appendChild(el('span', 'muted', tr('wsDesc')));

  const state = el('div', 'muted');
  const row = el('div', 'row');
  const inv = el('div', 'col');
  card.append(state, row, inv);

  const paint = async () => {
    const st = workspace.status();
    row.replaceChildren();
    state.textContent = !st.supported.pick ? tr('wsNoSupport')
      : !st.folder ? tr('wsNoFolder')
      : st.ready ? tr('wsFolder', { name: st.folder }) + (st.lastSaveAt ? ' · ' + tr('wsSavedAt', { time: new Date(st.lastSaveAt).toLocaleTimeString() }) : '')
      : tr('wsNeedsPerm', { name: st.folder });

    if (st.supported.pick) {
      if (!st.folder) row.appendChild(btn(tr('wsPick'), 'primary', async () => {
        try { await workspace.pick(); toast(tr('wsPicked')); await paint(); } catch (e) { toast('⚠️ ' + e.message); }
      }));
      else if (!st.ready) row.appendChild(btn(tr('wsRegrant'), 'primary', async () => {
        try { await workspace.regrant(); toast(tr('wsPicked')); await paint(); } catch (e) { toast('⚠️ ' + e.message); }
      }));
      else {
        row.appendChild(btn(tr('wsSaveNow'), 'primary', async () => {
          try { const r = await workspace.save({ reason: 'manual' }); toast(r.ok ? tr('wsSaved', { n: r.wrote.length }) : '⚠️ ' + (r.errors[0]?.error || '')); await paint(); }
          catch (e) { toast('⚠️ ' + (e.message === 'needs-regrant' ? tr('wsNeedsPerm', { name: st.folder }) : e.message)); await paint(); }
        }));
        const auto = el('label', 'row');
        const chk = el('input'); chk.type = 'checkbox'; chk.checked = workspace.autosaveEnabled();
        chk.onchange = () => { workspace.autosave({ enabled: chk.checked }); toast(chk.checked ? tr('wsAutoOn') : tr('wsAutoOff')); };
        auto.append(chk, el('span', 'muted', tr('wsAuto')));
        row.appendChild(auto);
        row.appendChild(btn(tr('wsForget'), 'ghost', async () => { await workspace.forget(); await paint(); }));
      }
    }
    // copia descargable: funciona en TODOS los navegadores (Safari/Firefox incluidos)
    row.appendChild(btn(tr('wsDownload'), 'ghost', async () => {
      const blob = await workspace.bundle();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `elffuss-claw-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }));

    // inventario: «ver qué hay» en cada almacén
    inv.replaceChildren(el('b', null, tr('wsWhat')));
    for (const it of await workspace.inventory()) {
      const line = el('div', 'row between');
      line.appendChild(el('span', null, `${it.icon} ${it.label}`));
      line.appendChild(el('span', 'muted', it.error ? '⚠️' : `${it.count} · ${kb(it.bytes)}${it.sensitive ? ' 🔒' : ''}`));
      inv.appendChild(line);
    }
    const danger = el('div', 'row');
    const wipe = btn(tr('wsWipe'), 'ghost', async () => {
      if (!window.confirm(tr('wsWipeConfirm'))) return;
      wipe.disabled = true;
      // Lo hace el kernel: para el turno en marcha, borra y RECARGA. Borrar solo
      // el IndexedDB dejaba la conversación en pantalla y en memoria, y el
      // siguiente mensaje la volvía a guardar entera; skills, bóveda abierta y
      // app actual también seguían vivas hasta recargar.
      try { await onWipeCb(); }
      catch (e) { wipe.disabled = false; toast('⚠️ ' + (e?.message || e)); }
    });
    danger.appendChild(wipe);
    inv.appendChild(danger);
  };
  paint().catch(() => { state.textContent = '—'; });
  return card;
}

// ---------- panel ajustes (config avanzada de proveedores) ----------
export function refreshSettings() {
  const panel = $('panel-ajustes');
  panel.replaceChildren();
  // Lo que se consulta a menudo va PRIMERO: qué está gastando y cómo limpiarlo.
  // Los proveedores externos son configuración avanzada y bajan al final.
  panel.appendChild(usageCard());
  panel.appendChild(workspaceCard());
  // Los modelos EXTERNOS (no locales) van al final, en su propia sección
  // plegada: son la excepción, no la norma — Elffuss corre en tu máquina.
  const ext = document.createElement('details');
  ext.className = 'card col ext-block';
  const extSum = document.createElement('summary');
  extSum.textContent = tr('extTitle');
  ext.appendChild(extSum);
  ext.appendChild(el('p', 'muted', tr('extDesc')));

  const cfgs = settings.configs();
  for (const [id, c] of Object.entries(cfgs)) {
    const wrap = el('div', 'card col');
    const head = el('div', 'row between');
    const title = el('b', null, c.label);
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = c.enabled;
    head.append(title, toggle);
    wrap.appendChild(head);
    wrap.appendChild(el('span', 'muted', c.help || ''));

    const model = el('input');
    model.placeholder = tr('modelPh');
    model.value = c.model || '';
    const base = el('input');
    base.placeholder = tr('endpointPh');
    base.value = c.baseURL || '';
    const key = el('input');
    key.type = 'password';
    key.placeholder = c.kind === 'anthropic' ? 'sk-ant-…' : (id === 'ollama' || id === 'server' ? tr('keyNeeded') : 'sk-…');
    key.value = c.apiKey || '';

    wrap.append(labeled(tr('lblModel'), model), labeled(tr('lblEndpoint'), base));
    if (id !== 'ollama' && id !== 'server') wrap.append(labeled(tr('lblApiKey'), key));

    const save = () => {
      settings.update(id, {
        enabled: toggle.checked,
        model: model.value.trim(),
        baseURL: base.value.trim(),
        apiKey: key.value,
      });
      onSettingsChangedCb();
    };
    toggle.onchange = () => { save(); toast(toggle.checked ? tr('provOn', { label: c.label }) : tr('provOff', { label: c.label })); };
    wrap.appendChild(btn(tr('save'), 'primary', () => { save(); toast(tr('saved')); }));
    ext.appendChild(wrap);
  }

  // --- Almacenamiento del modelo (caché persistente) ---
  const store = el('div', 'card col');
  store.appendChild(el('b', null, tr('storeTitle')));
  const info = el('span', 'muted', tr('storeCalc'));
  store.appendChild(info);
  // Lo mismo que el chip 💾 (model-storage.js): cuenta solo pesos, y vacía los de
  // este origen y los del almacén compartido de CADA broker con modelos (antes
  // el modelo grande, guardado en los brokers de sus hosts, no se tocaba).
  const clearBtn = btn(tr('storeClear'), 'ghost', async () => {
    clearBtn.disabled = true;
    clearBtn.setAttribute('aria-busy', 'true');
    info.textContent = tr('storeClearing');
    try { avisarLiberado(await modelos.vaciar()); }
    catch (e) { toast(tr('diskFail', { err: e?.message || e })); }
    clearBtn.disabled = false;
    clearBtn.removeAttribute('aria-busy');
    await paintStore();
  });
  store.appendChild(clearBtn);
  panel.appendChild(store);
  async function paintStore() {
    const [{ total, compartido, compartidoOk, hayCompartido }, { quota, persisted }] = await Promise.all([modelos.medir(), cacheEstimate()]);
    const gb = n => (n / 1073741824).toFixed(2) + ' GB';
    info.textContent = (total >= UMBRAL_CHIP ? tr('storeCached', { gb: gb(total) }) : tr('storeNone'))
      + (persisted ? tr('storePersist') : tr('storeNoPersist'))
      + (quota ? tr('storeLimit', { gb: gb(quota) }) : '')
      + (!hayCompartido ? '' : !compartidoOk ? tr('storeSharedUnknown') : compartido ? tr('storeShared', { gb: gb(compartido) }) : '');
  }
  paintStore();

  // --- 📨 Errores y feedback (opt-in — apagado no sale NADA de tu máquina) ---
  const telCard = el('div', 'card col');
  telCard.innerHTML =
    `<b>${tr('telTitle')}</b>` +
    `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:6px">` +
    `<input type="checkbox" id="tel-enabled"> ` +
    `<span>${tr('telAuto')}</span>` +
    `</label>` +
    `<span class="muted">${tr('telPrivacy')}</span>` +
    `<label class="muted" style="font-size:.8em;margin-top:4px">${tr('telManual')}</label>` +
    `<textarea id="tel-feedback" rows="2" style="width:100%;resize:vertical" placeholder="${tr('telPh')}"></textarea>`;
  const telSendBtn = btn(tr('send'), 'primary', async () => {
    const ta = telCard.querySelector('#tel-feedback');
    const text = ta.value.trim();
    if (!text) { toast(tr('writeSomething')); return; }
    const wasEnabled = telemetry.isEnabled();
    if (!wasEnabled) telemetry.setEnabled(true); // envío manual es explícito, se permite aunque el automático esté apagado
    await telemetry.sendFeedback(text);
    if (!wasEnabled) telemetry.setEnabled(false); // no activa el automático de fondo si no lo pidió
    ta.value = '';
    toast(tr('sentThanks'));
  });
  telCard.appendChild(telSendBtn);
  panel.appendChild(telCard);
  panel.appendChild(ext);        // externos: lo último de todo
  telCard.querySelector('#tel-enabled').checked = telemetry.isEnabled();
  telCard.querySelector('#tel-enabled').onchange = e => telemetry.setEnabled(e.target.checked);

  panel.appendChild(el('p', 'muted', tr('skillsTabHint')));
}

async function renderSkills(panel) {
  const inst = skills.installed();
  panel.appendChild(el('div', 'muted', tr('installedN', { n: inst.length })));
  for (const s of inst) {
    const c = el('div', 'card');
    c.dataset.ruta = s.name;        // #/skills/<nombre>
    c.append(el('b', null, s.name), el('span', 'muted', s.repo || 'local'),
      btn(tr('remove'), 'ghost', async () => { await skills.remove(s.name); refreshSettings(); }));
    panel.appendChild(c);
  }
  const srcs = await skills.sources();
  for (const src of srcs) {
    const c = el('div', 'card');
    const link = document.createElement('a');
    link.href = 'https://github.com/' + src.repo; link.target = '_blank'; link.textContent = src.repo + ' ↗';
    link.style.cssText = 'color:var(--accent2);font-size:.74rem;text-decoration:none';
    c.append(el('b', null, src.label), link,
      btn('Explorar', 'primary', () => browseSkillRepo(panel, src.repo)));
    panel.appendChild(c);
  }
  const row = el('div', 'row');
  const inp = el('input'); inp.placeholder = tr('repoPh');
  row.append(inp, btn(tr('addRepo'), 'primary', async () => {
    try { await skills.addSource(inp.value); refreshSettings(); } catch (e) { toast('⚠️ ' + e.message); }
  }));
  panel.appendChild(row);
}

async function browseSkillRepo(panel, repo) {
  const box = el('div');
  box.appendChild(el('div', 'muted', tr('loadingRepo', { repo })));
  panel.appendChild(box);
  try {
    const found = await skills.listFromRepo(repo);
    box.replaceChildren(el('div', 'muted', tr('repoSkills', { repo, n: found.length })));
    for (const sk of found.slice(0, 120)) {
      const c = el('div', 'card');
      const on = skills.isInstalled(sk.repo, sk.path);
      const b = btn(on ? tr('installedOk') : tr('install'), on ? 'ghost' : 'primary', async () => {
        b.textContent = '…';
        try {
          const entry = await skills.installFromRepo(sk);
          b.textContent = tr('installedOk');
          onSkillInstalledCb(entry);           // → mensaje «cómo usarla» en el chat
        } catch (e) { b.textContent = tr('install'); toast('⚠️ ' + e.message); }
      });
      c.append(el('b', null, sk.name), el('span', 'muted', sk.dir), b);
      box.appendChild(c);
    }
  } catch (e) { box.replaceChildren(el('div', 'muted', '⚠️ ' + e.message)); }
}

function labeled(label, input) {
  const row = el('label', 'field');
  row.append(el('span', 'muted', label), input);
  return row;
}

// ---------- botón enviar ↔ parar ----------
// Mientras Elffuss trabaja, #send es ■ y PARA (mismo icono, título y aria que
// en Elffuss Code). Va como type="button" a propósito: así un clic en él —con
// ratón, dedo o teclado— solo para, y Enter en la caja ya no pasa por el botón
// (sin botón de enviar, el formulario se envía directamente) y sigue mandando
// a la cola lo que escribas, que es como funciona la cola de Claw.
const STOP_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor"/></svg>';
let working = false, parando = false;
export function setWorking(on) {
  working = !!on;
  parando = false;
  const b = $('send');
  if (!b) return;
  b.type = working ? 'button' : 'submit';
  b.classList.toggle('is-stop', working);
  b.classList.remove('is-stopping');
  b.removeAttribute('aria-busy');
  b.removeAttribute('aria-disabled');
  b.innerHTML = working ? STOP_ICON : UI.send;
  b.title = working ? tr('stop') : tr('send');
  b.setAttribute('aria-label', b.title);
}

// «Parando…»: ya se pulsó ■ y el turno aún está soltando el modelo (un cerebro
// que no suelta al momento, una herramienta, Hard Work leyendo la carpeta…).
// Antes el ■ seguía igual tras el clic —rojo, «Parar», pulsable— y parecía que
// no había hecho caso. Mientras dura, los clics no hacen nada. Se marca con
// aria-disabled y NO con disabled: deshabilitar el botón que tiene el foco lo
// saca del foco y el teclado cae a <body> (lo mismo que en Elffuss Code).
// Vuelve a ➤ (o a ■ si arranca el siguiente de la cola) con setWorking().
export function setStopping() {
  const b = $('send');
  if (!b || !working) return;
  parando = true;
  b.classList.add('is-stopping');
  b.setAttribute('aria-busy', 'true');
  b.setAttribute('aria-disabled', 'true');
  b.textContent = tr('stopping');
  b.title = tr('stopping');
  b.setAttribute('aria-label', b.title);
}

// ---------- arranque ----------
export function init({ onSend, onStop = () => {}, onModelChange, onSettingsChanged }) {
  perms.setAsker(askPermission);
  apps.setRenderer((name, html) => renderApp(name, html, { ruta: true }));
  onSettingsChangedCb = onSettingsChanged || (() => {});
  // al instalar una skill: mensaje «cómo usarla» en el chat + volver al chat en móvil
  onSkillInstalledCb = entry => {
    addMsg('assistant', skills.usageMessage(entry)); // addMsg renderiza markdown en 'assistant'
    if (isMobile()) flipTo('chat');
  };

  // Historial del prompt: ↑/↓ recuperan lo enviado (como una shell). Persistente.
  const HKEY = 'elffuss.promptHistory';
  let hist = []; try { hist = JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch { /* corrupto */ }
  let hIdx = -1, draft = '';
  $('prompt').addEventListener('keydown', e => {
    if (!$('cmd-menu').hidden) return;             // el menú «/» ya usa ↑/↓
    const inp = e.target;
    if (e.key === 'ArrowUp') {
      if (!hist.length) return;
      if (hIdx === -1) { draft = inp.value; hIdx = hist.length; }
      hIdx = Math.max(0, hIdx - 1); inp.value = hist[hIdx]; e.preventDefault();
      requestAnimationFrame(() => inp.setSelectionRange(inp.value.length, inp.value.length));
    } else if (e.key === 'ArrowDown') {
      if (hIdx === -1) return;
      hIdx++; inp.value = hIdx >= hist.length ? (hIdx = -1, draft) : hist[hIdx]; e.preventDefault();
    }
  });
  $('send').addEventListener('click', e => {
    if (!working) return;        // en reposo es el submit de siempre
    e.preventDefault();
    if (parando) return;         // ya se está parando: otro clic no hace nada
    onStop();
  });
  $('composer').addEventListener('submit', e => {
    e.preventDefault();
    // Mientras trabaja, aquí solo se llega con Enter (el ■ no envía): con texto
    // va a la cola como siempre, y sin texto no hace nada —un segundo Enter
    // dado por inercia no debe tirar el trabajo en curso—. Parar es el ■.
    const text = $('prompt').value.trim();
    if (!text) return;
    $('prompt').value = '';
    if (hist[hist.length - 1] !== text) hist.push(text);
    if (hist.length > 100) hist = hist.slice(-100);
    try { localStorage.setItem(HKEY, JSON.stringify(hist)); } catch { /* lleno */ }
    hIdx = -1; draft = '';
    onSend(text);
  });
  document.querySelectorAll('#chips .chip').forEach(c =>
    c.addEventListener('click', () => onSend(c.textContent)));
  document.querySelectorAll('#tabs button').forEach(b =>
    b.addEventListener('click', () => selectTab(b.dataset.tab, { push: true })));
  // Flechas, Inicio y Fin entre pestañas (patrón de tablist): solo la activa
  // está en el orden de tabulación, y moverse con flechas la activa.
  $('tabs').addEventListener('keydown', e => {
    const tabs = [...document.querySelectorAll('#tabs [role="tab"]')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    tabs[j].focus();
    selectTab(tabs[j].dataset.tab);
  });
  $('btn-perms').addEventListener('click', () => { selectTab('permisos', { push: true }); if (isMobile()) flipTo('viz'); });
  $('model-select').addEventListener('change', e => onModelChange(e.target.value));
  $('btn-flip').addEventListener('click', () =>
    flipTo(document.body.classList.contains('show-viz') ? 'chat' : 'viz'));
  pintarFlip();
  // En el teléfono el botón flota por encima de los chips y del compositor: su
  // alto real (cambia con el idioma y el teclado) va a --alto-pie.
  const altoPie = () => document.documentElement.style.setProperty('--alto-pie',
    (($('composer')?.offsetHeight || 0) + ($('chips')?.offsetHeight || 0)) + 'px');
  try { const ro = new ResizeObserver(altoPie); ro.observe($('composer')); ro.observe($('chips')); } catch { /* sin ResizeObserver: queda el valor por defecto */ }
  altoPie();

  // iconos vectoriales (sin emojis)
  $('model-ico').innerHTML = UI.code;
  $('btn-clear').innerHTML = UI.newChat || UI.clear;
  setWorking(working);   // icono, título y aria del botón enviar/parar
  $('btn-slash').innerHTML = UI.slash;

  // menú de comandos (/) en el chat, estilo plugin de Claude Code
  const cmds = [
    { label: '/reloj', hint: tr('cmClock'), run: () => onSend(tr('pClock')) },
    { label: '/carpeta', hint: tr('cmFolder'), run: () => onSend(tr('pFolder')) },
    { label: '/skills', hint: tr('cmSkills'), run: () => { selectTab('skills'); if (isMobile()) flipTo('viz'); } },
    { label: '/modelo', hint: tr('cmModel'), run: () => { selectTab('ajustes'); if (isMobile()) flipTo('viz'); } },
    { label: '/tareas', hint: tr('cmTasks'), run: () => { selectTab('tareas'); if (isMobile()) flipTo('viz'); } },
    { label: '/vault', hint: tr('cmVault'), run: () => { selectTab('vault'); if (isMobile()) flipTo('viz'); } },
    { label: '/limpiar', hint: tr('cmClear'), run: () => $('btn-clear').click() },
  ];
  const cmdMenu = $('cmd-menu');
  const openCmd = () => {
    cmdMenu.replaceChildren();
    for (const c of cmds) {
      const row = document.createElement('button');
      row.className = 'cmd-item';
      row.innerHTML = `<b>${c.label}</b><span>${c.hint}</span>`;
      row.onclick = () => { cmdMenu.hidden = true; c.run(); };
      cmdMenu.appendChild(row);
    }
    cmdMenu.hidden = false;
  };
  $('btn-slash').addEventListener('click', () => cmdMenu.hidden ? openCmd() : (cmdMenu.hidden = true));
  $('prompt').addEventListener('input', e => {
    if (e.target.value === '/') openCmd(); else if (cmdMenu && !cmdMenu.hidden && !e.target.value.startsWith('/')) cmdMenu.hidden = true;
  });
  document.addEventListener('click', e => { if (!e.target.closest('#cmd-menu, #btn-slash, #prompt')) cmdMenu.hidden = true; });
}


// ---------- indicador de disco, SIEMPRE a la vista ----------
// El dato ya existía, pero dentro del panel de Ajustes: o sea escondido. Nadie
// sabía cuánto ocupaban los modelos en su navegador ni que se podían borrar.
// Aquí va en la cabecera, pequeño y permanente, y solo aparece si hay MODELOS
// guardados (model-storage.js): antes contaba el origen entero —tus apps y tu
// conversación incluidas— y con solo eso decía «💾 0 MB … pulsa para vaciarlo».
const _gbDisk = n => n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.round(n / 1048576) + ' MB';
const UMBRAL_CHIP = 1048576;       // menos de 1 MB de pesos no es un modelo: no se enseña

function avisarLiberado(r) {
  toast(tr('diskFreed', { size: _gbDisk(r?.liberado || 0) }) + (r?.hayCompartido && !r.compartidoOk ? ' ' + tr('diskSharedFail') : ''));
}

export function mountDiskChip() {
  const chip = document.getElementById('disk-chip');
  if (!chip) return;
  async function paint() {
    if (chip.disabled) return;
    const { total } = await modelos.medir();
    if (total < UMBRAL_CHIP) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = '💾 ' + _gbDisk(total);
    const txt = tr('diskChipT', { size: _gbDisk(total) });
    chip.title = txt;
    chip.setAttribute('aria-label', txt);
  }
  chip.addEventListener('click', async () => {
    const { total } = await modelos.medir();
    if (!confirm(tr('diskConfirm', { size: _gbDisk(total) }))) return;
    chip.disabled = true;
    chip.setAttribute('aria-busy', 'true');
    chip.textContent = '💾 …';
    try { avisarLiberado(await modelos.vaciar()); }
    catch (e) { toast(tr('diskFail', { err: e?.message || e })); }
    chip.disabled = false;
    chip.removeAttribute('aria-busy');
    paint();
  });
  paint();
  // Cada minuto y solo con la pestaña a la vista: contar es fichero a fichero.
  setInterval(() => { if (document.visibilityState === 'visible') paint(); }, 60000);
}

// ---------- puerta de móvil ----------
// Antes, abrir esto en un móvil arrancaba SOLO la descarga del cerebro: medio
// giga de datos de alguien que no había pedido nada, y encima con muchas
// papeletas de no llegar a funcionar (el navegador de móvil cierra la pestaña
// bastante antes de sostener un modelo entero). Ahora se avisa y se espera.
//
// `onAccept()` devuelve si el cerebro cargó. Si no, la tarjeta se queda con el
// error y un «Reintentar» (antes desaparecía al pulsar y un fallo solo dejaba un
// aviso pasajero). Quién es un teléfono lo decide el kernel (esTelefono).
export function mobileGate(sizeText, onAccept) {
  const box = el('div', 'card col mobile-gate');
  box.style.cssText = 'margin:14px 0;padding:14px;gap:8px';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', tr('mobTitle'));
  box.appendChild(el('b', null, tr('mobTitle')));
  box.appendChild(el('span', 'muted', tr('mobDesc', { size: sizeText })));
  box.appendChild(el('span', 'muted', tr('mobDesktop')));
  const estado = el('span', 'muted');
  estado.setAttribute('role', 'status');
  const boton = btn(tr('mobAnyway', { size: sizeText }), 'ghost', async () => {
    try { localStorage.setItem('elffuss.movil.ok', '1'); } catch { /* — */ }
    boton.disabled = true;
    estado.textContent = tr('mobLoading');
    let cargo = false;
    try { cargo = await onAccept(); } catch { cargo = false; }
    if (cargo) { box.remove(); return; }
    estado.textContent = tr('mobFailed');
    boton.textContent = tr('mobRetry');
    boton.disabled = false;
  });
  box.append(estado, boton);
  (document.getElementById('log') || document.body).appendChild(box);
}

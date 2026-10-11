// Velocímetro: qué velocidad está dando ESTA máquina, aquí y ahora.
// ─────────────────────────────────────────────────────────────────────────────
// Dos velocidades SEPARADAS, no una. El prefill digiere el prompt entero de
// golpe y la generación saca un token por pasada: promediarlas da un número que
// no significa nada y que además sube cuando el prompt crece, que es justo al
// revés de lo que siente el usuario. El motor las mide por separado
// (`alMedir`/`ultimaMedida` en provider.js) y aquí solo se pintan.
//
// Y dos cifras más que NO salen del motor, porque el motor no sabe de tareas:
// la tasa de resolución y el tiempo por tarea. Las cronometra la app anfitriona
// (la cola de mensajes) llamando a `tarea({ ok, ms, cerebro })` cuando una
// termina. Sin eso, el panel diría 0 % y parecería un fallo en vez de una
// ausencia de datos. Solo cuentan las del motor que está montado, y cada una
// lleva su modelo: antes también entraban los turnos del modo Básico (o de
// cualquier otro cerebro), y el panel los daba por tareas del motor.
//
// El historial vive en localStorage y es una comodidad POR NAVEGADOR: puede
// volver vacío en una ventana privada o si el sitio tiene los datos bloqueados,
// y el accesor puede lanzar. Por eso cada lectura y cada escritura van en
// try/catch y el panel se pinta igual sin él.

const CLAVE = 'elffuss.velocimetro.v1';

// Textos. Este módulo lo comparten Claw y Code y cada una tiene su i18n: la app
// anfitriona pasa su traductor con usarTraductor(t) (t(clave, vars) → texto, o la
// propia clave si no la tiene). Sin traductor, o sin la clave, va en español,
// como hasta ahora. Antes todo estaba escrito aquí en español y en inglés salían
// el título del chip, el panel y su nombre accesible en español.
const ES = {
  vmTitle: 'Velocidad de esta máquina', vmCtx: 'contexto {n}',
  vmPrefill: 'tok/s leyendo el prompt', vmGen: 'tok/s escribiendo', vmTtft: 'hasta la primera letra',
  vmProcessed: 'tokens procesados', vmReused: ' · {n} reusados', vmNoTurns: 'Todavía no has hablado con el modelo.',
  vmAlert: 'Leer el prompt va casi tan lento como escribir, y eso no debería pasar: leer procesa cientos de posiciones a la vez y escribir solo una. Suele significar que algo está compitiendo por la GPU, o que el modelo no cabe holgado. En un equipo despejado leer va varias veces más rápido.',
  vmReading: 'Leyendo el prompt', vmWriting: 'Escribiendo', vmNeed2: '{what}: hacen falta 2 turnos para dibujar',
  vmMax: 'máx {v} tok/s', vmTurns: '{n} turnos', vmTasks: 'Tareas', vmSolved: 'se resuelven ({ok} de {n})',
  vmPerTask: 'por tarea, mediana', vmNoTasks: 'Sin tareas registradas todavía con este modelo.',
  vmNote: 'Son los números de TU equipo, guardados en este navegador (siguen ahí al recargar). Las velocidades las mide el propio motor; las tareas (solo las de este modelo) se cronometran aquí, de principio a fin de cada petición. Cambian con la máquina, con lo que tengas abierto y con la temperatura, así que no son una cifra del producto.',
  vmChipWriting: 'Escribiendo a {g} tok/s · el prompt se leyó a {p} tok/s · primera letra en {t}. Pulsa para ver la gráfica.',
  vmChipReading: 'Leyendo el prompt a {p} tok/s. Pulsa para ver la gráfica.',
};
let traductor = null;
export function usarTraductor(fn) { traductor = typeof fn === 'function' ? fn : null; }
function tx(clave, vars) {
  let s = null;
  try { s = traductor?.(clave, vars); } catch { /* traductor roto: español */ }
  if (typeof s === 'string' && s && s !== clave) return s;
  const base = ES[clave] ?? clave;
  return vars ? base.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : base;
}
// Lo que se mete en innerHTML va escapado (el nombre del modelo, los textos).
const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MAX = 60;                  // turnos guardados: suficiente para ver forma
let hist = [];                   // [{ p: prefillTokS, g: genTokS, t: ttftMs }]
let tareas = [];                 // [{ ok: bool, ms: number, modelo: string }]
let chip = null, panel = null, prov = null, cancelar = null;

const leer = () => {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE) || '{}');
    if (Array.isArray(d.hist)) hist = d.hist.slice(-MAX);
    if (Array.isArray(d.tareas)) tareas = d.tareas.slice(-MAX);
  } catch { /* privada, bloqueado o corrupto: se empieza de cero */ }
};
const guardar = () => {
  try { localStorage.setItem(CLAVE, JSON.stringify({ hist: hist.slice(-MAX), tareas: tareas.slice(-MAX) })); }
  catch { /* cuota o bloqueo: el panel funciona igual, solo no recuerda */ }
};

const uno = n => (n >= 100 ? Math.round(n) : n.toFixed(1));
const ms = n => (n >= 1000 ? (n / 1000).toFixed(1) + ' s' : Math.round(n) + ' ms');
const mediana = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// Gráfica mínima en SVG, sin librería: son dos series cortas y un <path> basta.
// Se escala cada serie a SU propio máximo porque prefill y generación viven en
// órdenes distintos —el prefill va en cientos y la generación en decenas— y una
// escala común dejaría la de generación pegada al suelo, invisible.
function linea(vals, w, h, color) {
  if (vals.length < 2) return '';
  const max = Math.max(...vals) || 1;
  const d = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = h - (v / max) * (h - 2) - 1;
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`;
}

function grafica(key, color, etiqueta) {
  const vals = hist.map(x => x[key]).filter(v => Number.isFinite(v) && v > 0);
  if (vals.length < 2) return `<div class="vm-vacio">${esc(tx('vmNeed2', { what: etiqueta }))}</div>`;
  const max = Math.max(...vals);
  return `<div class="vm-graf">
    <div class="vm-graf-top"><span>${esc(etiqueta)}</span><span>${esc(tx('vmMax', { v: uno(max) }))}</span></div>
    <svg viewBox="0 0 220 38" preserveAspectRatio="none" aria-label="${esc(etiqueta)}">${linea(vals, 220, 38, color)}</svg>
    <div class="vm-graf-pie">${esc(tx('vmTurns', { n: vals.length }))}</div>
  </div>`;
}

// Qué modelo es el motor montado (la etiqueta del panel y la de cada tarea).
const SIN_ETIQUETA = 'motor';
function etiquetaModelo() {
  try { return prov?.modeloEtiqueta?.() || prov?.name || ''; } catch { return ''; }
}

function pintarPanel() {
  if (!panel) return;
  const m = prov?.ultimaMedida?.() || null;
  // El modelo, junto a las cifras. Una velocidad sin saber qué modelo la
  // produjo no se puede diagnosticar: llegó una captura con el prefill mucho
  // mas lento de lo esperable y no habia forma de saber de que modelo era.
  const modelo = etiquetaModelo();
  // Las tareas, solo las de ESTE modelo: la tasa de resolución es del modelo
  // tanto como de la máquina. (Las guardadas sin modelo son de antes, cuando
  // también entraban las de otros cerebros: no se sabe de quién son.)
  const suyas = tareas.filter(t => t.modelo === (modelo || SIN_ETIQUETA));
  const hechas = suyas.length;
  const bien = suyas.filter(t => t.ok).length;
  const tasa = hechas ? Math.round((bien / hechas) * 100) : null;
  const tmed = hechas ? mediana(suyas.map(t => t.ms)) : null;
  // El contexto EFECTIVO, no el del registro: si no cabe, el motor baja por una
  // escalera y abre con la mitad. En el modelo grande cada peldaño son gigas de
  // cache KV, asi que dos sesiones del mismo modelo pueden rendir muy distinto
  // y hasta ahora nada lo decia — dos medidas incomparables parecian la misma.
  let ctx = 0;
  try { ctx = prov?.contextoEfectivo?.() || 0; } catch { /* proveedor sin contexto */ }
  const ctxTxt = ctx ? (ctx >= 1024 ? `${Math.round(ctx / 1024)}k` : String(ctx)) : '';

  panel.innerHTML = `
    <div class="vm-tit">${esc(tx('vmTitle'))}${modelo ? ` <span class="vm-modelo">${esc(modelo)}${ctxTxt ? ` · ${esc(tx('vmCtx', { n: ctxTxt }))}` : ''}</span>` : ''}</div>
    ${m ? `<div class="vm-filas">
      <div><b>${uno(m.prefillTokS)}</b><span>${esc(tx('vmPrefill'))}</span></div>
      <div><b>${uno(m.genTokS)}</b><span>${esc(tx('vmGen'))}</span></div>
      <div><b>${ms(m.ttftMs)}</b><span>${esc(tx('vmTtft'))}</span></div>
      <div><b>${m.procesados}</b><span>${esc(tx('vmProcessed'))}${m.reusados ? esc(tx('vmReused', { n: m.reusados })) : ''}</span></div>
    </div>` : `<div class="vm-vacio">${esc(tx('vmNoTurns'))}</div>`}
    ${m && m.genTokS > 0 && m.prefillTokS < m.genTokS * 1.5 ? `<div class="vm-alerta">${esc(tx('vmAlert'))}</div>` : ''}
    ${grafica('p', 'var(--accent2, #6e63c5)', tx('vmReading'))}
    ${grafica('g', 'var(--accent, #4ade80)', tx('vmWriting'))}
    <div class="vm-tit vm-tit2">${esc(tx('vmTasks'))}</div>
    ${hechas ? `<div class="vm-filas">
      <div><b>${tasa}%</b><span>${esc(tx('vmSolved', { ok: bien, n: hechas }))}</span></div>
      <div><b>${ms(tmed)}</b><span>${esc(tx('vmPerTask'))}</span></div>
    </div>` : `<div class="vm-vacio">${esc(tx('vmNoTasks'))}</div>`}
    <div class="vm-nota">${esc(tx('vmNote'))}</div>`;
  panel.setAttribute('aria-label', tx('vmTitle'));
}

function pintarChip(m) {
  if (!chip) return;
  if (!m) { chip.hidden = true; return; }
  chip.hidden = false;
  // Mientras digiere el prompt se muestra ESO, porque es lo que el usuario está
  // esperando; en cuanto empieza a escribir, se cambia a la de escritura.
  const escribiendo = m.genTokens > 0;
  const v = escribiendo ? m.genTokS : m.prefillTokS;
  chip.textContent = `⚡ ${uno(v)} tok/s`;
  chip.title = escribiendo
    ? tx('vmChipWriting', { g: uno(m.genTokS), p: uno(m.prefillTokS), t: ms(m.ttftMs) })
    : tx('vmChipReading', { p: uno(m.prefillTokS) });
}

/** Una tarea del agente ha terminado. `ok`: ¿se resolvió? `ms`: lo que costó.
 *  `cerebro`: el proveedor que la hizo. Solo se apunta si es el motor montado
 *  aquí (el que mide); la de cualquier otro cerebro no es suya. */
export function tarea({ ok, ms: dur, cerebro = null }) {
  if (!cerebro || cerebro !== prov || !prov?.alMedir) return;
  tareas.push({ ok: !!ok, ms: Number(dur) || 0, modelo: etiquetaModelo() || SIN_ETIQUETA });
  if (tareas.length > MAX) tareas = tareas.slice(-MAX);
  guardar();
  if (panel && !panel.hidden) pintarPanel();
}

// Abrir y cerrar el panel. aria-expanded en el chip dice si está abierto; al
// cerrarlo con Escape el foco vuelve al chip.
function abrirPanel(abrir) {
  if (!panel || !chip) return;
  panel.hidden = !abrir;
  chip.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  if (abrir) pintarPanel();
}

// Los escuchadores del DOM se ponen UNA vez. montar() se llama cada vez que se
// elige un cerebro del motor, y antes añadía otro clic al chip en cada llamada:
// tras volver a elegir el motor, un clic abría y el siguiente escuchador lo
// cerraba en el mismo instante, y el panel ya no se abría nunca.
let cableado = false;
function cablear() {
  if (cableado || !chip) return;
  cableado = true;
  chip.setAttribute('aria-controls', panel?.id || 'speed-panel');
  chip.setAttribute('aria-expanded', 'false');
  if (panel) {
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', tx('vmTitle'));
  }
  chip.addEventListener('click', () => abrirPanel(!!panel?.hidden));
  // Cerrar al pulsar fuera, como el resto de los desplegables de la cabecera.
  document.addEventListener('click', e => {
    if (!panel || panel.hidden) return;
    if (e.target === chip || chip?.contains(e.target) || panel.contains(e.target)) return;
    abrirPanel(false);
  });
  // …y con Escape, devolviendo el foco al chip.
  // (Si otra capa ya atendió ese Escape —la Mente, un diálogo—, no se cierra
  // también este: un Escape, una capa.)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !panel || panel.hidden || e.defaultPrevented) return;
    e.preventDefault();
    abrirPanel(false);
    chip?.focus();
  });
}

/** Engancha el velocímetro. `provider` es el módulo del motor, o null si no hay.
 *  Con null (o un cerebro que no mide) el chip y el panel se ESCONDEN: antes,
 *  al pasar a otro cerebro, el chip seguía enseñando la última cifra del motor. */
export function montar(provider, chipId = 'speed-chip', panelId = 'speed-panel') {
  prov = provider || null;
  chip = document.getElementById(chipId);
  panel = document.getElementById(panelId);
  leer();
  cablear();
  cancelar?.();
  cancelar = null;
  if (!chip || !prov?.alMedir) {
    if (chip) chip.hidden = true;
    abrirPanel(false);
    return;
  }

  cancelar = prov.alMedir(m => {
    pintarChip(m);
    // El historial se apunta UNA vez por turno, al cerrarse: apuntando en cada
    // token, un turno largo llenaría la gráfica él solo y taparía a los demás.
    if (m && m.enCurso === false && m.genTokens > 0) {
      hist.push({ p: m.prefillTokS, g: m.genTokS, t: m.ttftMs });
      if (hist.length > MAX) hist = hist.slice(-MAX);
      guardar();
    }
    if (panel && !panel.hidden) pintarPanel();
  });

  const m = prov.ultimaMedida?.();
  if (m) pintarChip(m); else chip.hidden = true;
}

// Velocímetro: qué velocidad está dando ESTA máquina, aquí y ahora.
// ─────────────────────────────────────────────────────────────────────────────
// Dos velocidades SEPARADAS, no una. El prefill digiere el prompt entero de
// golpe y la generación saca un token por pasada: promediarlas da un número que
// no significa nada y que además sube cuando el prompt crece, que es justo al
// revés de lo que siente el usuario. El motor las mide por separado
// (`alMedir`/`ultimaMedida` en provider.js) y aquí solo se pintan.
//
// Y dos cifras más que NO salen del motor, porque el motor no sabe de tareas:
// la tasa de resolución y el tiempo por tarea. Las alimenta el agente llamando
// a `tarea({ ok, ms })` cuando una termina. Sin eso, el panel diría 0 % y
// parecería un fallo en vez de una ausencia de datos.
//
// El historial vive en localStorage y es una comodidad POR NAVEGADOR: puede
// volver vacío en una ventana privada o si el sitio tiene los datos bloqueados,
// y el accesor puede lanzar. Por eso cada lectura y cada escritura van en
// try/catch y el panel se pinta igual sin él.

const CLAVE = 'elffuss.velocimetro.v1';
const MAX = 60;                  // turnos guardados: suficiente para ver forma
let hist = [];                   // [{ p: prefillTokS, g: genTokS, t: ttftMs }]
let tareas = [];                 // [{ ok: bool, ms: number }]
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
  if (vals.length < 2) return `<div class="vm-vacio">${etiqueta}: hacen falta 2 turnos para dibujar</div>`;
  const max = Math.max(...vals);
  return `<div class="vm-graf">
    <div class="vm-graf-top"><span>${etiqueta}</span><span>máx ${uno(max)} tok/s</span></div>
    <svg viewBox="0 0 220 38" preserveAspectRatio="none" aria-label="${etiqueta}">${linea(vals, 220, 38, color)}</svg>
    <div class="vm-graf-pie">${vals.length} turnos</div>
  </div>`;
}

function pintarPanel() {
  if (!panel) return;
  const m = prov?.ultimaMedida?.() || null;
  const hechas = tareas.length;
  const bien = tareas.filter(t => t.ok).length;
  const tasa = hechas ? Math.round((bien / hechas) * 100) : null;
  const tmed = hechas ? mediana(tareas.map(t => t.ms)) : null;

  // El modelo, junto a las cifras. Una velocidad sin saber qué modelo la
  // produjo no se puede diagnosticar: llegó una captura con el prefill mucho
  // mas lento de lo esperable y no habia forma de saber de que modelo era.
  let modelo = '';
  try { modelo = prov?.modeloEtiqueta?.() || ''; } catch { /* proveedor sin etiqueta */ }
  // El contexto EFECTIVO, no el del registro: si no cabe, el motor baja por una
  // escalera y abre con la mitad. En el modelo grande cada peldaño son gigas de
  // cache KV, asi que dos sesiones del mismo modelo pueden rendir muy distinto
  // y hasta ahora nada lo decia — dos medidas incomparables parecian la misma.
  let ctx = 0;
  try { ctx = prov?.contextoEfectivo?.() || 0; } catch { /* proveedor sin contexto */ }
  const ctxTxt = ctx ? (ctx >= 1024 ? `${Math.round(ctx / 1024)}k` : String(ctx)) : '';

  panel.innerHTML = `
    <div class="vm-tit">Velocidad de esta máquina${modelo ? ` <span class="vm-modelo">${modelo}${ctxTxt ? ` · contexto ${ctxTxt}` : ''}</span>` : ''}</div>
    ${m ? `<div class="vm-filas">
      <div><b>${uno(m.prefillTokS)}</b><span>tok/s leyendo el prompt</span></div>
      <div><b>${uno(m.genTokS)}</b><span>tok/s escribiendo</span></div>
      <div><b>${ms(m.ttftMs)}</b><span>hasta la primera letra</span></div>
      <div><b>${m.procesados}</b><span>tokens procesados${m.reusados ? ` · ${m.reusados} reusados` : ''}</span></div>
    </div>` : `<div class="vm-vacio">Todavía no has hablado con el modelo.</div>`}
    ${m && m.genTokS > 0 && m.prefillTokS < m.genTokS * 1.5 ? `<div class="vm-alerta">
      Leer el prompt va casi tan lento como escribir, y eso no deberia pasar:
      leer procesa cientos de posiciones a la vez y escribir solo una. Suele
      significar que algo esta compitiendo por la GPU, o que el modelo no cabe
      holgado. En un equipo despejado leer va varias veces mas rapido.
    </div>` : ''}
    ${grafica('p', 'var(--accent2, #6e63c5)', 'Leyendo el prompt')}
    ${grafica('g', 'var(--accent, #4ade80)', 'Escribiendo')}
    <div class="vm-tit vm-tit2">Tareas</div>
    ${hechas ? `<div class="vm-filas">
      <div><b>${tasa}%</b><span>se resuelven (${bien} de ${hechas})</span></div>
      <div><b>${ms(tmed)}</b><span>por tarea, mediana</span></div>
    </div>` : `<div class="vm-vacio">Sin tareas registradas todavía.</div>`}
    <div class="vm-nota">Son los números de TU equipo en esta sesión, medidos por el
      propio motor. Cambian con la máquina, con lo que tengas abierto y con la
      temperatura, así que no son una cifra del producto.</div>`;
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
    ? `Escribiendo a ${uno(m.genTokS)} tok/s · el prompt se leyó a ${uno(m.prefillTokS)} tok/s · ` +
      `primera letra en ${ms(m.ttftMs)}. Pulsa para ver la gráfica.`
    : `Leyendo el prompt a ${uno(m.prefillTokS)} tok/s. Pulsa para ver la gráfica.`;
}

/** Una tarea del agente ha terminado. `ok`: ¿se resolvió? `ms`: lo que costó. */
export function tarea({ ok, ms: dur }) {
  tareas.push({ ok: !!ok, ms: Number(dur) || 0 });
  if (tareas.length > MAX) tareas = tareas.slice(-MAX);
  guardar();
  if (panel && !panel.hidden) pintarPanel();
}

/** Engancha el velocímetro. `provider` es el módulo del motor, o null si no hay. */
export function montar(provider, chipId = 'speed-chip', panelId = 'speed-panel') {
  prov = provider || null;
  chip = document.getElementById(chipId);
  panel = document.getElementById(panelId);
  leer();
  if (!chip || !prov?.alMedir) { if (chip) chip.hidden = true; return; }

  cancelar?.();
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

  chip.addEventListener('click', () => {
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) pintarPanel();
  });
  // Cerrar al pulsar fuera, como el resto de los desplegables de la cabecera.
  document.addEventListener('click', e => {
    if (!panel || panel.hidden) return;
    if (e.target === chip || panel.contains(e.target)) return;
    panel.hidden = true;
  });
  const m = prov.ultimaMedida?.();
  if (m) pintarChip(m); else chip.hidden = true;
}

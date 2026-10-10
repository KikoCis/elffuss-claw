// Capas modales que no son <dialog> (la Mente, el splash): mientras están
// abiertas, lo de detrás queda INERTE —ni se enfoca con Tab ni lo lee un lector
// de pantalla— y al cerrarlas el foco vuelve a donde estaba.
// ─────────────────────────────────────────────────────────────────────────────
// Antes eran un <div> encima de todo: se veían modales, pero el primer Tab caía
// en el selector de modelo de DETRÁS y se podía manejar la página tapada sin
// verla. Al cerrar, el foco se perdía en <body>.
//
// Los <dialog> se dejan en paz: se gestionan solos con showModal(), y uno inerte
// no se podría pulsar. Pasa de verdad: el cerebro puede pedir un permiso con la
// Mente abierta, y ese diálogo tiene que poder contestarse.
const FOCABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function abrirModal(capa, { foco = null } = {}) {
  const previo = document.activeElement;
  const marcados = [];
  for (const el of document.body.children) {
    if (el === capa || el.contains(capa) || el.inert) continue;
    if (el.tagName === 'SCRIPT' || el.tagName === 'DIALOG' || el.tagName === 'TEMPLATE') continue;
    el.inert = true;
    marcados.push(el);
  }
  const destino = (typeof foco === 'string' ? capa.querySelector(foco) : foco) || capa.querySelector(FOCABLES);
  try { destino?.focus({ preventScroll: true }); } catch { /* sin foco posible */ }
  let cerrada = false;
  return function cerrar({ devolverFoco = true, a = null } = {}) {
    if (cerrada) return;
    cerrada = true;
    for (const el of marcados) el.inert = false;
    const vuelta = a || previo;
    if (devolverFoco && vuelta && document.contains(vuelta)) {
      try { vuelta.focus({ preventScroll: true }); } catch { /* — */ }
    }
  };
}

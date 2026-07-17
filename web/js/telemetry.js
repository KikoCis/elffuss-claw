// Buzón opt-in de errores/feedback. Apagado por defecto — la promesa de
// «nada sale de tu máquina» sigue siendo cierta salvo que el usuario decida
// lo contrario en Ajustes. Cuando está activo:
//   - errores no capturados (window.onerror / unhandledrejection) y los
//     puntos concretos del código que llaman a reportError() se mandan a
//     /proxy/report (mismo origen, vía el proxy compartido de Elffuss)
//   - sendFeedback() manda texto libre que el usuario escriba a propósito
// Nunca se manda código ni contenido del proyecto — solo el mensaje técnico,
// la pila, la URL y el user-agent. Sin cola ni reintentos: si el envío
// falla, se descarta sin más (evita que un fallo de red se convierta en
// almacenamiento sin límite).
let appName = 'elffuss';
let enabled = false;
let hooked = false;

const storageKey = () => 'elffuss.telemetry.' + appName;

export function isEnabled() { return enabled; }

export function setEnabled(v) {
  enabled = !!v;
  try { localStorage.setItem(storageKey(), enabled ? '1' : '0'); } catch { /* localStorage lleno/bloqueado */ }
  if (enabled) hookGlobalErrors();
}

async function post(kind, message, opts = {}) {
  if (!enabled) return;
  try {
    await fetch('/proxy/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: appName, kind, message: String(message ?? '').slice(0, 2000),
        stack: String(opts.stack || '').slice(0, 4000),
        url: location.href, userAgent: navigator.userAgent,
        extra: String(opts.extra || '').slice(0, 2000),
      }),
    });
  } catch { /* sin conexión o proxy caído: se descarta, no hay reintento */ }
}

export function reportError(message, opts = {}) { return post('error', message, opts); }
export function sendFeedback(text) { return post('feedback', text); }

function hookGlobalErrors() {
  if (hooked) return;
  hooked = true;
  window.addEventListener('error', e => {
    reportError(e.message || String(e.error) || 'error', { stack: e.error?.stack || '' });
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    reportError('unhandledrejection: ' + (r?.message || r), { stack: r?.stack || '' });
  });
}

// Llamar UNA vez al arrancar, con el nombre de la app (para distinguir
// elffuss-code de elffuss-claw en los informes) — lee la preferencia guardada.
export function init(name) {
  appName = name || appName;
  try { enabled = localStorage.getItem(storageKey()) === '1'; } catch { enabled = false; }
  if (enabled) hookGlobalErrors();
}

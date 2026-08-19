// Elffuss Runtime · sonda de capacidades del dispositivo.
// ─────────────────────────────────────────────────────────────────────────────
// PRIMER módulo de nuestro runtime propio. El nudo del problema «cargar modelos
// grandes» es saber QUÉ cabe en cada equipo:
//   · Escritorio (GPU potente, RAM amplia): modelos grandes, pero hay que
//     shardear los pesos porque WebGPU limita el tamaño de cada buffer.
//   · Móvil: RAM total limitada y el navegador mata la pestaña por encima de
//     ~1-2 GB → techo real ~1-2 GB por mucho que la GPU sea potente.
// Esta sonda reporta límites de WebGPU + memoria + un «presupuesto de modelo»
// realista por plataforma. La usan la selección de cerebro y el loader por shards.

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

// Detección de plataforma SIN depender de cadenas frágiles: primero el
// userAgentData estructurado, luego el userAgent como respaldo. Solo se lee el
// entorno del USUARIO para decidir qué correr (feature-detection), no se registra.
function detectPlatform() {
  const uad = navigator.userAgentData;
  const ua = navigator.userAgent || '';
  const touch = (navigator.maxTouchPoints || 0) > 1;
  const iOS = /iPhone|iPad|iPod/i.test(ua) ||
    // iPad moderno se hace pasar por Mac: Mac + pantalla táctil = iPad.
    (/Mac/i.test(ua) && touch);
  const android = /Android/i.test(ua);
  const mobile = !!(uad?.mobile) || iOS || android ||
    matchMedia('(max-width: 820px)').matches || matchMedia('(pointer: coarse)').matches;
  const mac = /Mac/i.test(uad?.platform || ua) && !iOS;
  return { mobile, iOS, android, mac, touch };
}

// Presupuesto de modelo realista (bytes de PESOS que el equipo puede sostener,
// dejando margen para activaciones + KV + el propio navegador).
//   · iOS: el navegador revienta la pestaña sobre ~1.3 GB de datos vivos.
//   · Android: variable; tiramos conservador.
//   · Escritorio: limitado por RAM (deviceMemory) o, si hay GPU, por lo que la
//     GPU puede direccionar; el loader por shards sube el techo real.
function modelBudget(platform, memGB) {
  if (platform.iOS) return Math.round(1.3 * GiB);
  if (platform.android) return Math.round(1.0 * GiB);
  if (platform.mobile) return Math.round(1.0 * GiB);
  // escritorio: ~60 % de la RAM declarada, tope de seguridad 12 GB
  return Math.min(Math.round(memGB * 0.6 * GiB), 12 * GiB);
}

// Tamaño máximo de un SHARD de pesos en la GPU: nunca puede exceder el binding
// de storage buffer del adaptador (a menudo 128 MiB–2 GiB). El loader partirá los
// tensores grandes en trozos de este tamaño. Se deja un pelín por debajo del
// límite para las estructuras auxiliares.
function shardCap(limits) {
  const bind = limits?.maxStorageBufferBindingSize || 128 * MiB;
  // usar como mucho el binding, y no más de 256 MiB por shard (equilibrio entre
  // nº de bind groups y presión de memoria); mínimo 16 MiB.
  return Math.max(16 * MiB, Math.min(bind, 256 * MiB));
}

export async function probe() {
  const platform = detectPlatform();
  // deviceMemory viene redondeado (2,4,8…) y en móvil suele mentir a la baja;
  // si no está, asumimos 4 en móvil y 8 en escritorio.
  const memGB = navigator.deviceMemory || (platform.mobile ? 4 : 8);

  let gpu = false, limits = null, info = null, error = null;
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        gpu = true;
        const L = adapter.limits || {};
        limits = {
          maxBufferSize: L.maxBufferSize || 0,
          maxStorageBufferBindingSize: L.maxStorageBufferBindingSize || 0,
          maxComputeWorkgroupStorageSize: L.maxComputeWorkgroupStorageSize || 0,
          maxComputeInvocationsPerWorkgroup: L.maxComputeInvocationsPerWorkgroup || 0,
          maxComputeWorkgroupSizeX: L.maxComputeWorkgroupSizeX || 0,
        };
        // requestAdapterInfo está deprecándose a favor de adapter.info; probamos ambos.
        try { info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null); } catch { /* opcional */ }
      } else {
        error = 'navigator.gpu existe pero no hay adaptador real';
      }
    } catch (e) { error = String(e?.message || e); }
  } else {
    error = 'sin WebGPU';
  }

  const budget = modelBudget(platform, memGB);
  return {
    platform,
    memGB,
    gpu,
    limits,
    info,                       // {vendor, architecture, device, description} si el navegador lo da
    error,
    budgetBytes: budget,
    budgetGiB: +(budget / GiB).toFixed(2),
    shardCapBytes: shardCap(limits),
    // ¿entra un modelo de N bytes de pesos? (el loader por shards salva el límite
    // de buffer; el muro real es el presupuesto de memoria del equipo).
    fits(weightBytes) { return gpu && weightBytes <= budget; },
  };
}

// Resumen legible de una línea para diagnóstico en la UI (sin datos sensibles).
export function summarize(c) {
  const p = c.platform.iOS ? 'iOS' : c.platform.android ? 'Android'
    : c.platform.mac ? 'Mac' : c.platform.mobile ? 'móvil' : 'escritorio';
  const g = c.gpu
    ? `WebGPU · buffer≤${(c.limits.maxBufferSize / GiB).toFixed(1)}GiB · binding≤${(c.limits.maxStorageBufferBindingSize / MiB) | 0}MiB`
    : `sin GPU (${c.error || '—'})`;
  return `${p} · ~${c.memGB}GB RAM · presupuesto ${c.budgetGiB}GiB · ${g}`;
}

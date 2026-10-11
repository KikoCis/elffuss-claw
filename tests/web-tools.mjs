// Las herramientas web y el botón ■. Sin red: todo lo de fuera lo contesta la
// prueba (rutas de Playwright).
//   · ■ (la señal del turno) corta la descarga en curso de web.fetch y no
//     prueba el proxy después. Antes las herramientas no recibían la señal: el
//     turno dejaba de esperar, pero la descarga seguía por detrás hasta el final.
//
//   BASE=http://localhost:8743 node tests/web-tools.mjs
import { navegador, contexto, pagina, ok, fin, BASE } from './ux-comun.mjs';

const b = await navegador();
const estado = { vistos: [] };
const { ctx } = await contexto(b, {
  grants: ['web'],
  rutas: async (url, route) => {
    estado.vistos.push(url);
    // Una descarga que no termina nunca (para ■).
    if (url.startsWith('https://lento.ejemplo/')) { await new Promise(r => setTimeout(r, 4000)); await route.abort('failed').catch(() => {}); return true; }
    return false;
  },
});
// El proxy del servidor, contestado por la prueba con el texto de la URL pedida.
const esProxy = u => u.origin === new URL(BASE).origin && u.pathname === '/proxy';
await ctx.route(esProxy, async route => {
  const pedida = decodeURIComponent(new URL(route.request().url()).searchParams.get('url') || '');
  estado.vistos.push('proxy:' + pedida);
  return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><p>Texto de ' + pedida + '</p></body></html>' });
});
const { p, errores } = await pagina(ctx);

const llamar = (tool, args, pararTrasMs = null) => p.evaluate(async ({ tool, args, pararTrasMs }) => {
  const { runTool } = await import('/js/tools/index.js');
  const ctl = new AbortController();
  if (pararTrasMs != null) setTimeout(() => ctl.abort(), pararTrasMs);
  const t0 = performance.now();
  try { return { ok: true, res: await runTool(tool, args, { signal: ctl.signal }), rapido: performance.now() - t0 < 2000 }; }
  catch (e) { return { ok: false, err: String(e?.message || e), nombre: e?.name || '', rapido: performance.now() - t0 < 2000 }; }
}, { tool, args, pararTrasMs });

// ── ■ con una descarga en curso ──────────────────────────────────────────────
estado.vistos = [];
const f4 = await llamar('web.fetch', { url: 'https://lento.ejemplo/pesado' }, 150);
ok('■ corta la descarga en curso: web.fetch acaba al momento con AbortError', !f4.ok && f4.nombre === 'AbortError' && f4.rapido, JSON.stringify(f4));
ok('…y no prueba el proxy después de parar', !estado.vistos.some(u => u.startsWith('proxy:https://lento.ejemplo')), JSON.stringify(estado.vistos));

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
await fin(b, 'WEB: ■ corta la descarga');

// web.fetch y web.search cuando algo falla, y ■ con una descarga en curso.
// Sin red: todo lo de fuera lo contesta la prueba (rutas de Playwright).
//   · Sin el proxy de respaldo (/proxy en 404, como estuvo producción semanas),
//     web.fetch dice que no hay proxy y no «HTTP 404» a secas, y web.search
//     falla diciendo por qué en vez de «Sin resultados».
//   · Un 404 del propio sitio es «esa página no existe», haya proxy o no.
//   · La verificación anti-bot de DuckDuckGo es un bloqueo, no una lista vacía.
//   · Con el buscador contestando de verdad, salen los resultados.
//   · ■ (la señal del turno) corta la descarga en curso y no prueba el proxy.
//
//   BASE=http://localhost:8743 node tests/web-tools.mjs
import { navegador, contexto, pagina, ok, hasta, fin, BASE } from './ux-comun.mjs';

const b = await navegador();
const estado = { proxy: 404, ddg: 'ok', vistos: [] };
const DDG_OK = '<html><body><table><tr><td><a href="/l/?uddg=https%3A%2F%2Fejemplo.org%2Fhistoria-del-reloj&rut=x">Historia del reloj</a> Un repaso a la historia del reloj.</td></tr></table></body></html>';
const DDG_ANOMALIA = '<html><body><form id="challenge-form" action="/anomaly.js"><p>Unfortunately, bots use DuckDuckGo too.</p></form></body></html>';
const { ctx } = await contexto(b, {
  grants: ['web'],
  rutas: async (url, route) => {
    estado.vistos.push(url);
    // Un sitio sin CORS: el fetch directo del navegador falla sin respuesta.
    if (url.startsWith('https://sin-cors.ejemplo/')) { await route.abort('failed'); return true; }
    // Un sitio que contesta (con CORS) que la página no existe.
    if (url.startsWith('https://con-cors.ejemplo/')) {
      await route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'no existe' }); return true;
    }
    // Una descarga que no termina nunca (para ■).
    if (url.startsWith('https://lento.ejemplo/')) { await new Promise(r => setTimeout(r, 4000)); await route.abort('failed').catch(() => {}); return true; }
    // DuckDuckGo directo: sin CORS, como el de verdad.
    if (/duckduckgo\.com\//.test(url)) { await route.abort('failed'); return true; }
    return false;
  },
});
// El proxy del servidor, contestado por la prueba: 404 (no existe), la página de
// DuckDuckGo (normal o la de verificación) o el texto de la URL pedida.
const esProxy = u => u.origin === new URL(BASE).origin && u.pathname === '/proxy';
await ctx.route(esProxy, async route => {
  const pedida = decodeURIComponent(new URL(route.request().url()).searchParams.get('url') || '');
  estado.vistos.push('proxy:' + pedida);
  if (estado.proxy === 404) return route.fulfill({ status: 404, contentType: 'text/html', body: '<html><body>404 Not Found</body></html>' });
  if (/duckduckgo\.com\//.test(pedida)) return route.fulfill({ status: 200, contentType: 'text/html', body: estado.ddg === 'anomalia' ? DDG_ANOMALIA : DDG_OK });
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

// ── sin proxy de respaldo ────────────────────────────────────────────────────
estado.proxy = 404;
const f1 = await llamar('web.fetch', { url: 'https://sin-cors.ejemplo/pagina' });
ok('sin proxy, web.fetch dice que este servidor no tiene el proxy de respaldo (no «HTTP 404» a secas)',
  !f1.ok && /proxy de respaldo/.test(f1.err) && /no dice nada de si la página existe/.test(f1.err) && f1.err !== 'HTTP 404', f1.err);
const s1 = await llamar('web.search', { query: 'historia del reloj' });
ok('sin proxy, web.search falla diciendo por qué, no «Sin resultados»', !s1.ok && /proxy de respaldo/.test(s1.err), s1.ok ? s1.res : s1.err);
const f2 = await llamar('web.fetch', { url: 'https://con-cors.ejemplo/no-esta' });
ok('un 404 del propio sitio es «esa página no existe»', !f2.ok && /no existe/.test(f2.err) && !/proxy/.test(f2.err), f2.err);

// ── con proxy ────────────────────────────────────────────────────────────────
estado.proxy = 200; estado.ddg = 'anomalia';
const s2 = await llamar('web.search', { query: 'historia del reloj' });
ok('la verificación anti-bot de DuckDuckGo es un bloqueo, no una lista vacía', !s2.ok && /bloqueó la consulta/.test(s2.err), s2.ok ? s2.res : s2.err);
estado.ddg = 'ok';
const s3 = await llamar('web.search', { query: 'historia del reloj' });
ok('con el buscador contestando, salen los resultados con su enlace', s3.ok && /Resultados para «historia del reloj»/.test(s3.res) && /https:\/\/ejemplo\.org\/historia-del-reloj/.test(s3.res), s3.ok ? s3.res.slice(0, 120) : s3.err);
const f3 = await llamar('web.fetch', { url: 'https://sin-cors.ejemplo/otra' });
ok('y web.fetch de un sitio sin CORS sale por el proxy', f3.ok && /Texto de https:\/\/sin-cors\.ejemplo\/otra/.test(f3.res), f3.ok ? f3.res.slice(0, 80) : f3.err);

// ── ■ con una descarga en curso ──────────────────────────────────────────────
estado.vistos = [];
const f4 = await llamar('web.fetch', { url: 'https://lento.ejemplo/pesado' }, 150);
ok('■ corta la descarga en curso: web.fetch acaba al momento con AbortError', !f4.ok && f4.nombre === 'AbortError' && f4.rapido, JSON.stringify(f4));
ok('…y no prueba el proxy después de parar', !estado.vistos.some(u => u.startsWith('proxy:https://lento.ejemplo')), JSON.stringify(estado.vistos));

// ── en inglés, los mismos avisos en inglés ───────────────────────────────────
{
  const { ctx: c2 } = await contexto(b, { locale: 'en-US', grants: ['web'],
    rutas: async (url, route) => { if (url.startsWith('https://sin-cors.ejemplo/')) { await route.abort('failed'); return true; } return false; } });
  await c2.route(esProxy, route => route.fulfill({ status: 404, contentType: 'text/html', body: 'nope' }));
  const { p: q } = await pagina(c2);
  const r = await q.evaluate(async () => {
    const { runTool } = await import('/js/tools/index.js');
    try { await runTool('web.fetch', { url: 'https://sin-cors.ejemplo/x' }); return 'sin error'; } catch (e) { return String(e.message); }
  });
  ok('en inglés el aviso está en inglés', /no fallback proxy/.test(r) && !/No pude/.test(r), r);
  await c2.close();
}

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
await fin(b, 'WEB: sin proxy o bloqueado se dice por qué, y ■ corta la descarga');

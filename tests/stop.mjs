// Parar de verdad, a nivel de agente y de proveedor (sin UI, sin GPU).
// ─────────────────────────────────────────────────────────────────────────────
// Claw no tenía forma de parar: ni el agente miraba una señal, ni los
// proveedores la recibían, ni Hard Work la comprobaba entre trozos. Aquí se
// prueba cada pieza contra proveedores de mentira, dentro de la página de Claw
// (los módulos son los de verdad, cargados por el navegador):
//   1. Agent.stop() a mitad de una generación: evento «aborted», ni un paso ni
//      una herramienta más, y ningún «error» (parar no es un fallo).
//   2. Un proveedor que LANZA al abortar (como fetch): sigue siendo «aborted».
//   3. Un proveedor que ignora la señal: el agente no pinta sus tokens ni
//      ejecuta lo que devuelva.
//   4. La señal del turno de quien llama ({ signal }) también para al agente.
//   5. Parar justo después de una herramienta: no se vuelve a llamar al modelo.
//   6. rlm.js: Hard Work y deepCreate se cortan ENTRE trozos y rondas, lanzan
//      AbortError y devuelven el muestreo a voraz.
//   7. api.js: la señal llega al fetch (OpenAI y Anthropic), sola o dentro de
//      { signal, onPrefill }, que es como la pasa el agente.
//   8. webllm.js: interruptGenerate() y el flujo se lee hasta el final, porque el
//      cerrojo del modelo se suelta al acabar el generador; si no, la siguiente
//      petición se quedaría esperando para siempre.
//   9. Un AbortError del proveedor con la señal del turno intacta (el motor
//      propio al descargarse) es una parada, también en Hard Work.
// (LiteRT tiene su propia prueba: tests/litert-stop.mjs.)
//
//   python3 server/serve.py 8742 &   BASE=http://localhost:8742 node tests/stop.mjs
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
const p = await ctx.newPage();
const errores = [];
p.on('pageerror', e => errores.push(e.message));
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.elffuss?.agent, null, { timeout: 15000 });

// ── 1 · stop() a mitad de una generación ─────────────────────────────────────
{
  const r = await p.evaluate(async () => {
    const { Agent } = await import('/js/agent.js');
    const eventos = [];
    let llamadas = 0, senal = null, cuarto = null;
    // El agente pasa { signal, onPrefill } como 4º argumento de chat().
    const senalDe = x => (x && typeof x.aborted === 'boolean') ? x : x?.signal;
    // Siempre pide una herramienta y respeta la señal (deja de generar al abortar).
    const lento = { chat: async (h, s, cb, opts) => {
      const signal = senalDe(opts);
      llamadas++; senal = signal; cuarto = opts;
      for (let i = 0; i < 80 && !signal?.aborted; i++) { cb('x'); await new Promise(r => setTimeout(r, 25)); }
      return '```tool\n{"tool":"memory.list","args":{}}\n```';
    } };
    const ag = new Agent(lento);
    const run = ag.handle('haz algo largo', ev => eventos.push(ev));
    while (eventos.filter(e => e.type === 'token').length < 3) await new Promise(r => setTimeout(r, 10));
    const llamadasAntes = llamadas;
    const tokensAntes = eventos.filter(e => e.type === 'token').length;
    ag.stop();
    await run;
    return {
      tipos: [...new Set(eventos.map(e => e.type))],
      llamadasAntes, llamadas,
      tokensDespues: eventos.filter(e => e.type === 'token').length - tokensAntes,
      herramientas: eventos.filter(e => e.type === 'tool').length,
      senalEsAbortSignal: senal instanceof AbortSignal, senalAbortada: !!senal?.aborted,
      cuartoEsObjeto: !!cuarto && cuarto.signal === senal && typeof cuarto.onPrefill === 'function',
      textoAborted: eventos.find(e => e.type === 'aborted')?.text || '',
      historia: ag.history.map(m => m.role),
    };
  });
  ok('1 · stop(): emite «aborted» y ningún «error»', r.tipos.includes('aborted') && !r.tipos.includes('error'), r.tipos.join(','));
  ok('1 · el proveedor recibe la señal del turno en el 4º argumento de chat() ({ signal, onPrefill }) y la ve abortada',
    r.senalEsAbortSignal && r.senalAbortada && r.cuartoEsObjeto);
  ok('1 · no vuelve a llamar al modelo ni ejecuta la herramienta que pidió', r.llamadas === r.llamadasAntes && r.herramientas === 0,
    `llamadas ${r.llamadasAntes}→${r.llamadas}, herramientas ${r.herramientas}`);
  ok('1 · ni un token pintado después de parar', r.tokensDespues <= 1, `${r.tokensDespues} tokens`);
  ok('1 · el aviso es el de parado (i18n), no un texto de error', r.textoAborted === '(Parado.)', r.textoAborted);
  ok('1 · el histórico guarda la petición y nada a medio generar', JSON.stringify(r.historia) === '["user"]', JSON.stringify(r.historia));
}

// ── 2 · proveedor que lanza al abortar (fetch abortado) ──────────────────────
{
  const r = await p.evaluate(async () => {
    const { Agent } = await import('/js/agent.js');
    const eventos = [];
    const lanza = { chat: (h, s, cb, opts) => new Promise((_, rej) => {
      opts.signal.addEventListener('abort', () => rej(new DOMException('The user aborted a request.', 'AbortError')));
    }) };
    const ag = new Agent(lanza);
    const run = ag.handle('hola', ev => eventos.push(ev.type));
    await new Promise(r => setTimeout(r, 50));
    ag.stop();
    await run;
    return eventos;
  });
  ok('2 · un proveedor que LANZA al abortar sigue siendo «aborted», no «El modelo falló»',
    r.includes('aborted') && !r.includes('error'), r.join(','));
}

// ── 3 · proveedor que ignora la señal ────────────────────────────────────────
{
  const r = await p.evaluate(async () => {
    const { Agent } = await import('/js/agent.js');
    const eventos = [];
    let senalAbortadaAlEmitir = 0, llamadas = 0;
    // Sigue generando aunque se aborte (como un motor que aún no sabe parar).
    const sordo = { chat: async (h, s, cb, opts) => {
      llamadas++;
      for (let i = 0; i < 12; i++) { if (opts?.signal?.aborted) senalAbortadaAlEmitir++; cb('y'); await new Promise(r => setTimeout(r, 20)); }
      return '```tool\n{"tool":"memory.list","args":{}}\n```';
    } };
    const ag = new Agent(sordo);
    const run = ag.handle('otra', ev => eventos.push(ev.type));
    while (!eventos.includes('token')) await new Promise(r => setTimeout(r, 5));
    ag.stop();
    const tokensAlParar = eventos.filter(e => e === 'token').length;
    await run;
    return { tokensAlParar, tokens: eventos.filter(e => e === 'token').length, senalAbortadaAlEmitir, llamadas,
      herramientas: eventos.filter(e => e === 'tool').length, aborted: eventos.includes('aborted') };
  });
  ok('3 · proveedor sordo: tras parar no se pinta ni un token suyo', r.tokens === r.tokensAlParar && r.senalAbortadaAlEmitir > 0,
    `${r.tokensAlParar} → ${r.tokens} (emitió ${r.senalAbortadaAlEmitir} con la señal ya abortada)`);
  ok('3 · y lo que devuelve no se ejecuta', r.herramientas === 0 && r.llamadas === 1 && r.aborted);
}

// ── 4 · la señal del turno de quien llama ────────────────────────────────────
{
  const r = await p.evaluate(async () => {
    const { Agent } = await import('/js/agent.js');
    const prov = { llamadas: 0, chat: async (h, s, cb, opts) => {
      prov.llamadas++;
      for (let i = 0; i < 80 && !opts?.signal?.aborted; i++) await new Promise(r => setTimeout(r, 20));
      return 'respuesta';
    } };
    const ag = new Agent(prov);
    const ev1 = [], ctl = new AbortController();
    const run = ag.handle('uno', e => ev1.push(e.type), { signal: ctl.signal });
    await new Promise(r => setTimeout(r, 80));
    ctl.abort();
    await run;
    // Ya abortada al empezar: no llega ni a llamar al modelo.
    const ev2 = [], antes = prov.llamadas;
    const ya = new AbortController(); ya.abort();
    await ag.handle('dos', e => ev2.push(e.type), { signal: ya.signal });
    // Sin señal de fuera, un turno nuevo funciona con normalidad.
    const ev3 = [];
    await ag.handle('tres', e => ev3.push(e.type));
    return { ev1, ev2, llamadasDos: prov.llamadas - antes - 1, ev3 };
  });
  ok('4 · { signal } de quien llama (el kernel) también para al agente', r.ev1.includes('aborted') && !r.ev1.includes('text'), r.ev1.join(','));
  ok('4 · con la señal ya abortada no se llama al modelo', r.ev2.join(',') === 'aborted' && r.llamadasDos === 0, r.ev2.join(','));
  ok('4 · el turno siguiente, sin parar, responde normal', r.ev3.includes('text') && !r.ev3.includes('aborted'), r.ev3.join(','));
}

// ── 5 · parar justo después de una herramienta ───────────────────────────────
{
  const r = await p.evaluate(async () => {
    const { Agent } = await import('/js/agent.js');
    let llamadas = 0;
    const prov = { chat: async () => { llamadas++; return '```tool\n{"tool":"memory.list","args":{}}\n```'; } };
    const ag = new Agent(prov);
    const eventos = [];
    await ag.handle('lista', ev => { eventos.push(ev.type); if (ev.type === 'tool_result') ag.stop(); });
    return { eventos, llamadas, historia: ag.history.map(m => m.role) };
  });
  ok('5 · parado tras una herramienta: no se vuelve a llamar al modelo', r.llamadas === 1 && r.eventos.at(-1) === 'aborted', r.eventos.join(','));
  ok('5 · el resultado de la herramienta queda en el histórico (coherente para el turno siguiente)',
    JSON.stringify(r.historia) === '["user","assistant","user"]', JSON.stringify(r.historia));
}

// ── 6 · rlm.js: Hard Work y deepCreate ───────────────────────────────────────
{
  const r = await p.evaluate(async () => {
    const rlm = await import('/js/rlm.js');
    // hardWork: material de varios trozos; se para al anunciar el trozo 2.
    let llamadas = 0, senales = 0;
    const prov = { chat: async (h, s, cb, signal) => {
      llamadas++; if (signal instanceof AbortSignal) senales++;
      await new Promise(r => setTimeout(r, 30));
      return 'dato del trozo';
    } };
    const ctl = new AbortController();
    let trozos = 0, error = null;
    try {
      await rlm.hardWork({
        question: '¿qué dice?', context: 'línea de material de prueba\n'.repeat(4000), provider: prov, signal: ctl.signal,
        onProgress: pr => { if (pr.phase === 'plan') trozos = pr.chunks; if (pr.phase === 'map' && pr.i === 2) ctl.abort(); },
      });
    } catch (e) { error = e.name; }
    const tras = { llamadas, senales };   // antes de reutilizar el proveedor abajo
    // deepCreate con dos rondas: se para al empezar la crítica de la ronda 1.
    let llamadasDC = 0;
    const html = '<!doctype html><html><body><canvas></canvas></body></html>';
    const provDC = { chat: async () => { llamadasDC++; await new Promise(r => setTimeout(r, 20)); return html; } };
    const ctl2 = new AbortController();
    const fases = [];
    let errorDC = null;
    try {
      await rlm.deepCreate({ brief: 'un juego', provider: provDC, rounds: 2, signal: ctl2.signal,
        onProgress: pr => { fases.push(pr.phase); if (pr.phase === 'critique') ctl2.abort(); } });
    } catch (e) { errorDC = e.name; }
    // bestOf: parar en mitad del segundo candidato devuelve el muestreo a voraz.
    const muestreo = [];
    let llamadasBO = 0;
    const ctl3 = new AbortController();
    const provBO = {
      setSampling: o => muestreo.push(o),
      chat: async () => { llamadasBO++; if (llamadasBO === 2) ctl3.abort(); return html; },
    };
    let errorBO = null;
    try {
      await rlm.deepCreate({ brief: 'otro', provider: provBO, rounds: 0, bestOf: 3, signal: ctl3.signal,
        evaluar: async () => ({ nota: 1 }) });
    } catch (e) { errorBO = e.name; }
    // Sin señal, sigue funcionando como siempre.
    const sinSenal = await rlm.hardWork({ question: 'q', context: 'poco material', provider: prov });
    return { trozos, llamadas: tras.llamadas, senales: tras.senales, error, llamadasDC, fases, errorDC, muestreo, llamadasBO, errorBO, sinSenal: sinSenal.answer };
  });
  ok('6 · Hard Work: se para ENTRE trozos (no pide el trozo 2 ni sintetiza)', r.error === 'AbortError' && r.trozos > 2 && r.llamadas === 1,
    `error=${r.error} · ${r.trozos} trozos · ${r.llamadas} llamada(s)`);
  ok('6 · Hard Work pasa la señal a cada llamada al modelo', r.senales >= 1 && r.senales === r.llamadas);
  ok('6 · deepCreate: se para antes de reescribir', r.errorDC === 'AbortError' && !r.fases.includes('rewrite') && r.llamadasDC <= 2,
    `${r.errorDC} · fases ${r.fases.join(',')} · ${r.llamadasDC} llamadas`);
  ok('6 · deepCreate con varios candidatos: al parar el muestreo vuelve a voraz',
    r.errorBO === 'AbortError' && r.muestreo.length >= 2 && r.muestreo.at(-1) === null && r.llamadasBO === 2,
    `${r.errorBO} · muestreo ${JSON.stringify(r.muestreo)}`);
  ok('6 · sin señal, Hard Work responde igual que antes', r.sinSenal === 'dato del trozo', r.sinSenal);
}

// ── 7 · api.js: la señal llega al fetch ──────────────────────────────────────
{
  const r = await p.evaluate(async () => {
    const api = await import('/js/providers/api.js');
    const real = window.fetch;
    const capturas = [];
    window.fetch = (url, opts) => {
      capturas.push(opts?.signal || null);
      return new Promise((_, rej) => opts?.signal?.addEventListener('abort', () => rej(new DOMException('The user aborted a request.', 'AbortError'))));
    };
    const out = {};
    try {
      // La señal sola (como la pasa rlm.js) y dentro de { signal, onPrefill }
      // (como la pasa el agente): fetch tiene que recibir LA SEÑAL en los dos casos.
      for (const kind of ['openai', 'anthropic']) {
        for (const forma of ['sola', 'objeto']) {
          api.configure({ kind, label: 'prueba', baseURL: 'http://localhost:9/v1', apiKey: 'x', model: 'm' });
          const ctl = new AbortController();
          const cuarto = forma === 'sola' ? ctl.signal : { signal: ctl.signal, onPrefill: () => {} };
          const antes = capturas.length;
          const pr = api.chat([{ role: 'user', content: 'hola' }], 'sistema', () => {}, cuarto);
          while (capturas.length === antes) await new Promise(r => setTimeout(r, 5));
          ctl.abort();
          let nombre = null;
          try { await pr; } catch (e) { nombre = e.name; }
          out[kind + '-' + forma] = { mismaSenal: capturas.at(-1) === ctl.signal, error: nombre };
        }
      }
    } finally { window.fetch = real; }
    return out;
  });
  for (const k of ['openai-sola', 'openai-objeto', 'anthropic-sola', 'anthropic-objeto'])
    ok(`7 · api.js (${k}): el fetch recibe la señal del turno y se aborta`, r[k]?.mismaSenal && r[k]?.error === 'AbortError', JSON.stringify(r[k]));
}

// ── 8 · webllm.js con un motor de mentira que imita el cerrojo de MLC ────────
{
  const r = await p.evaluate(async () => {
    const W = await import('/js/providers/webllm.js');
    const log = { interrupciones: 0, terminados: 0, trozos: 0, esperasCerrojo: 0 };
    let cerrojo = false, bandera = false, alCrear = null;
    // Como MLC 0.2.85: el cerrojo se coge al crear la petición y se suelta al
    // terminar el generador; la bandera de interrupción se pone a false cuando
    // el generador ARRANCA.
    W.__usarMotor({
      interruptGenerate() { log.interrupciones++; bandera = true; },
      chat: { completions: { create: async () => {
        while (cerrojo) {
          if (++log.esperasCerrojo > 100) throw new Error('cerrojo colgado');
          await new Promise(r => setTimeout(r, 10));
        }
        cerrojo = true;
        alCrear?.();
        return (async function* () {
          bandera = false;
          for (let i = 0; i < 60; i++) {
            if (bandera) break;
            await new Promise(r => setTimeout(r, 15));
            log.trozos++;
            yield { choices: [{ delta: { content: 't' + i + ' ' } }] };
          }
          yield { choices: [{ delta: {}, finish_reason: bandera ? 'abort' : 'stop' }] };
          log.terminados++;
          cerrojo = false;
        })();
      } } },
    });
    // a mitad
    let tokens = 0, tokensAlParar = -1;
    const ctl = new AbortController();
    const s1 = await W.chat([{ role: 'user', content: 'hola' }], 'sis', () => { tokens++; if (tokens === 3) { ctl.abort(); tokensAlParar = tokens; } }, ctl.signal);
    const a = { salida: s1, tokens, tokensAlParar, interrupciones: log.interrupciones, terminados: log.terminados, trozos: log.trozos };
    // parada ANTES del primer trozo (la bandera se pondría a false al arrancar)
    log.trozos = 0;
    const ctl2 = new AbortController();
    alCrear = () => ctl2.abort();
    await W.chat([{ role: 'user', content: 'hola' }], 'sis', () => {}, ctl2.signal);
    alCrear = null;
    const b2 = { trozos: log.trozos, terminados: log.terminados };
    // y la siguiente petición, sin parar, no se queda esperando el cerrojo
    let error = null, s3 = '';
    try { s3 = await W.chat([{ role: 'user', content: 'otra' }], 'sis', () => {}); } catch (e) { error = e.message; }
    return { a, b2, s3len: s3.length, error, esperas: log.esperasCerrojo };
  });
  ok('8 · webllm: parar llama a interruptGenerate() y no pinta más tokens', r.a.interrupciones >= 1 && r.a.tokens === r.a.tokensAlParar && r.a.trozos < 60,
    `interrupciones ${r.a.interrupciones} · tokens ${r.a.tokensAlParar}→${r.a.tokens} · trozos ${r.a.trozos}`);
  ok('8 · webllm: el flujo se lee hasta el final (el generador termina y suelta el cerrojo)', r.a.terminados === 1, `terminados ${r.a.terminados}`);
  ok('8 · webllm: una parada anterior al primer trozo no se pierde', r.b2.trozos <= 2 && r.b2.terminados === 2, JSON.stringify(r.b2));
  ok('8 · webllm: la petición siguiente no se queda esperando el cerrojo', r.error === null && r.s3len > 0, r.error || `${r.esperas} esperas`);
}

// ── 9 · AbortError que no viene de ■ (el motor propio al descargarse) ────────
// unload() del motor (vigilante de RAM, «liberar el modelo», cambiar de modelo
// a mitad) corta el turno en marcha y rechaza con AbortError, sin que la señal
// del turno se haya abortado. Es una parada, no «El modelo falló».
{
  const r = await p.evaluate(async () => {
    const { Agent } = await import('/js/agent.js');
    const rlm = await import('/js/rlm.js');
    const abortError = () => Object.assign(new Error('turno parado a petición'), { name: 'AbortError' });
    const descargado = { chat: async (h, s, cb) => { cb('a'); throw abortError(); } };
    const eventos = [];
    await new Agent(descargado).handle('hola', ev => eventos.push(ev));
    // Hard Work: el trozo 1 recibe ese AbortError → se para ahí.
    let llamadas = 0, error = null, res = null;
    const prov = { chat: async () => { llamadas++; throw abortError(); } };
    try { res = await rlm.hardWork({ question: 'q', context: 'línea de material\n'.repeat(3000), provider: prov }); }
    catch (e) { error = e.name; }
    // Un trozo que falla con OTRO error sigue sin tumbar el resto.
    let llamadas2 = 0;
    const roto = { chat: async () => { llamadas2++; if (llamadas2 === 1) throw new Error('fallo raro'); return 'dato'; } };
    const res2 = await rlm.hardWork({ question: 'q', context: 'línea de material\n'.repeat(3000), provider: roto });
    return { tipos: eventos.map(e => e.type), texto: eventos.find(e => e.type === 'aborted')?.text,
      error, llamadas, res: res?.answer || null, kept2: res2.kept, chunks2: res2.chunks };
  });
  ok('9 · AbortError del proveedor con la señal del turno intacta: «aborted», no «El modelo falló»',
    r.tipos.includes('aborted') && !r.tipos.includes('error') && r.texto === '(Parado.)', r.tipos.join(','));
  ok('9 · Hard Work: ese AbortError lo para en el trozo 1 (no sigue pidiendo trozos)',
    r.error === 'AbortError' && r.llamadas === 1, `error=${r.error} · ${r.llamadas} llamadas · ${r.res}`);
  ok('9 · un trozo que falla con otro error sigue sin tumbar el resto', r.chunks2 > 2 && r.kept2 === r.chunks2 - 1, `${r.kept2} de ${r.chunks2}`);
}

ok('sin errores de página en todo el recorrido', errores.length === 0, errores.slice(0, 3).join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ PARAR: agente, Hard Work y proveedores cortan de verdad');
await b.close();
process.exit(fails ? 1 : 0);

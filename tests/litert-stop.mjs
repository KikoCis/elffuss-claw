// Parar con LiteRT (providers/litert.js), sin GPU: un motor de mentira que se
// porta como la conversación de @litert-lm/core 0.15.0 en lo que importa aquí
// —cancel() corta la generación y el flujo termina con error— y se comprueba:
//   · parar a mitad no lanza, devuelve lo generado y llama a cancel();
//   · tras parar no se pinta ni un token más;
//   · parar durante el prefill (antes del primer trozo) cancela en el acto, sin
//     esperar a que llegue un trozo con el que salir del bucle;
//   · el turno SIGUIENTE a una parada: como en la sesión «avanzada» de LiteRT-LM
//     (la del motor web), una conversación cancelada queda envenenada y todo
//     envío posterior falla con «Task cancelled». La conversación parada se
//     tira y se borra, y el turno siguiente contesta en una nueva rehecha desde
//     el historial, sin el reintento de «no cupo» (que la rehacía compactada,
//     con pérdida, y avisaba de un tamaño que no era el problema).
//
//   python3 server/serve.py 8742 &   BASE=http://localhost:8742 node tests/litert-stop.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8742';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffuss.model', 'rules'); localStorage.setItem('elffuss.welcomed', '1'); } catch {} });
const p = await ctx.newPage();
const errores = [];
p.on('pageerror', e => errores.push(e.message));
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.elffuss?.agent, null, { timeout: 15000 });

// ── litert.js con un motor de mentira ────────────────────────────────────
{
  const r = await p.evaluate(async () => {
    const L = await import('/js/providers/litert.js');
    const log = { cancels: 0, trozos: 0 };
    // Se comporta como la conversación de LiteRT 0.15.0 en lo que importa aquí:
    // cancel() corta la generación y el flujo termina con error.
    const motor = (prefill = 0) => ({
      async createConversation() {
        let cancelado = false;
        return {
          async getTokenCount() { return 10; },
          async delete() {},
          cancel() { log.cancels++; cancelado = true; },
          sendMessageStreaming() {
            return (async function* () {
              for (let t = 0; t < prefill && !cancelado; t += 10) await new Promise(r => setTimeout(r, 10));
              for (let i = 0; i < 60; i++) {
                if (cancelado) throw new Error('CANCELLED');
                await new Promise(r => setTimeout(r, 15));
                log.trozos++;
                yield { content: [{ type: 'text', text: 'p' + i + ' ' }] };
              }
            })();
          },
        };
      },
    });
    const SIS = 'Eres Elffuss'.padEnd(220, '.');
    // a mitad de la generación
    L.__usarMotor(motor(), 4096);
    let tokens = 0, tokensAlParar = -1, error = null, salida = null;
    const ctl = new AbortController();
    const pr = L.chat([{ role: 'user', content: 'hola' }], SIS, () => { tokens++; if (tokens === 4) { ctl.abort(); tokensAlParar = tokens; } }, ctl.signal);
    try { salida = await pr; } catch (e) { error = e.message; }
    const r1 = { salida, error, tokens, tokensAlParar, cancels: log.cancels };
    // durante el «prefill»: aún no ha llegado ningún trozo
    log.cancels = 0; log.trozos = 0;
    L.__usarMotor(motor(400), 4096);
    const ctl2 = new AbortController();
    const pr2 = L.chat([{ role: 'user', content: 'hola' }], SIS, () => {}, ctl2.signal);
    await new Promise(r => setTimeout(r, 60));
    ctl2.abort();
    let error2 = null, salida2 = null;
    try { salida2 = await pr2; } catch (e) { error2 = e.message; }
    return { r1, r2: { salida: salida2, error: error2, cancels: log.cancels, trozos: log.trozos } };
  });
  ok('litert: parar a mitad no lanza y devuelve lo generado', r.r1.error === null && /^p0 p1 p2 p3/.test(r.r1.salida || ''), JSON.stringify(r.r1));
  ok('litert: llama a cancel() de la conversación y no pinta más tokens', r.r1.cancels >= 1 && r.r1.tokens === r.r1.tokensAlParar,
    `cancel ${r.r1.cancels} · tokens ${r.r1.tokensAlParar}→${r.r1.tokens}`);
  ok('litert: parar en el prefill cancela en el acto (sin esperar al primer trozo)', r.r2.error === null && r.r2.cancels >= 1 && r.r2.trozos === 0,
    JSON.stringify(r.r2));
}

// ── el turno siguiente a una parada ──────────────────────────────────────
{
  const r = await p.evaluate(async () => {
    const L = await import('/js/providers/litert.js');
    const avisos = [];
    const warnAntes = console.warn;
    console.warn = (...a) => { avisos.push(a.join(' ')); };
    try {
      const convs = [];
      // Como la sesión avanzada de LiteRT-LM: tras cancel(), lo que se le envíe
      // a esa conversación falla con «Task cancelled». Una nueva va limpia.
      const motor = {
        async createConversation(cfg) {
          let generando = false, cancelada = false, envenenada = false;
          const c = {
            prefacio: cfg.preface.messages.map(m => m.content).join('\n'),
            enviados: [], borrada: false,
            async getTokenCount() { return 300; },
            async delete() { this.borrada = true; },
            cancel() { if (generando) cancelada = true; envenenada = true; },
            sendMessageStreaming(texto) {
              const self = this;
              return (async function* () {
                if (envenenada) throw new Error('Task cancelled');
                generando = true; self.enviados.push(texto);
                try {
                  for (let i = 0; i < 40; i++) {
                    if (cancelada) throw new Error('Task cancelled');
                    await new Promise(r => setTimeout(r, 5));
                    yield { content: [{ type: 'text', text: 'w' + i + ' ' }] };
                  }
                } finally { generando = false; }
              })();
            },
          };
          convs.push(c); return c;
        },
      };
      L.__usarMotor(motor, 4096);
      const SIS = 'Eres Elffuss'.padEnd(220, '.');
      const h = [{ role: 'user', content: 'hola, me llamo Ana y mi proyecto se llama Faro' }];
      h.push({ role: 'assistant', content: await L.chat(h, SIS) });
      h.push({ role: 'user', content: 'escribe un poema larguísimo' });
      const ctl = new AbortController(); let n = 0;
      const parcial = await L.chat(h, SIS, () => { if (++n === 3) ctl.abort(); }, ctl.signal);
      // El agente NO apunta la respuesta parada en el historial.
      h.push({ role: 'user', content: '¿cómo se llama mi proyecto?' });
      let r2 = null, e2 = null;
      try { r2 = await L.chat(h, SIS); } catch (e) { e2 = e.message; }
      h.push({ role: 'assistant', content: r2 || '' });
      h.push({ role: 'user', content: 'gracias' });
      const r3 = await L.chat(h, SIS);
      await new Promise(r => setTimeout(r, 20));
      return { parcial, r2: r2 && r2.slice(0, 12), e2, r3: !!r3, conversaciones: convs.length,
        primeraBorrada: convs[0].borrada, segundaBorrada: !!convs[1]?.borrada,
        enviados2: convs[1]?.enviados || [], prefacio2: (convs[1]?.prefacio || '').slice(220), avisos };
    } finally { console.warn = warnAntes; }
  });
  ok('litert: tras parar, el turno siguiente contesta (la conversación cancelada no se reutiliza)', !r.e2 && !!r.r2 && /^w0 w1 w2$/.test(r.parcial),
    r.e2 || `parcial «${r.parcial}» · respuesta «${r.r2}»`);
  ok('  …sin rehacerla compactada ni avisar de que «no cupo»', r.avisos.length === 0 && !/CONVERSACIÓN HASTA AHORA/.test(r.prefacio2),
    JSON.stringify(r.avisos.map(a => a.slice(0, 80))));
  ok('  …en una conversación nueva, y la cancelada se borra', r.conversaciones === 2 && r.primeraBorrada && !r.segundaBorrada,
    `${r.conversaciones} conversaciones · primera borrada ${r.primeraBorrada}`);
  ok('  …rehecha desde el historial, sin la respuesta parada', r.enviados2.length >= 1 && /Faro/.test(r.enviados2[0]) && !/w0 w1 w2/.test(r.enviados2.join('\n')),
    JSON.stringify(r.enviados2));
  ok('  …y el turno de después sigue en esa misma conversación', r.r3 && r.conversaciones === 2);
}

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ LITERT: parar cancela la generación y no lanza');
await b.close();
process.exit(fails ? 1 : 0);

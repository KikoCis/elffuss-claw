// Parar con LiteRT (providers/litert.js), sin GPU: un motor de mentira que se
// porta como la conversación de @litert-lm/core 0.15.0 en lo que importa aquí
// —cancel() corta la generación y el flujo termina con error— y se comprueba:
//   · parar a mitad no lanza, devuelve lo generado y llama a cancel();
//   · tras parar no se pinta ni un token más;
//   · parar durante el prefill (antes del primer trozo) cancela en el acto, sin
//     esperar a que llegue un trozo con el que salir del bucle.
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

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ LITERT: parar cancela la generación y no lanza');
await b.close();
process.exit(fails ? 1 : 0);

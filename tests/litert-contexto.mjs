// ¿Aguanta la conversación de LiteRT un resultado de herramienta más grande que su contexto?
// ─────────────────────────────────────────────────────────────────────────────
// Sin GPU ni navegador: chat() de providers/litert.js contra un motor de mentira
// que se comporta como el de verdad en lo que importa aquí: guarda la
// conversación, cuenta tokens y FALLA si se pasa del máximo. Lo que hace el motor
// real cuando se desborda (fallar, truncar, colgarse) lo mide
// tests/litert-desborde.mjs en el navegador; esto fija la lógica del guardia.
//
//   node tests/litert-contexto.mjs
//   LITERT=/ruta/a/otro-litert.mjs node tests/litert-contexto.mjs   # p. ej. el de antes, que debe fallar
const L = await import(process.env.LITERT ? 'file://' + process.env.LITERT : '../web/js/providers/litert.js');

const CARACTERES_POR_TOKEN = 3.2;   // a propósito distinto del 2 con que arranca el guardia
let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${nombre}${extra ? '  — ' + extra : ''}`);
  if (!cond) fallos++;
};

function motor({ limiteReal = Infinity } = {}) {
  const conversaciones = [];
  return {
    conversaciones,
    async createConversation(cfg) {
      const sistema = cfg.preface.messages.map(m => m.content).join('\n');
      const c = {
        sistema, enviados: [], borrada: false,
        tokens: Math.ceil(sistema.length / CARACTERES_POR_TOKEN),
        async getTokenCount() { return this.tokens; },
        async delete() { this.borrada = true; },
        sendMessageStreaming(texto) {
          const self = this;
          return (async function* () {
            if (self.borrada) throw new Error('conversación borrada');
            const t = Math.ceil(texto.length / CARACTERES_POR_TOKEN);
            if (self.tokens + t > limiteReal) throw new Error(`Input token ids are too long: ${self.tokens + t} > ${limiteReal}`);
            self.tokens += t + 3;
            self.enviados.push(texto);
            yield { content: [{ type: 'text', text: 'vale.' }] };
          })();
        },
      };
      conversaciones.push(c);
      return c;
    },
  };
}
const SISTEMA = 'Eres Elffuss: '.padEnd(200, '·') + '\nreglas y herramientas…';
const ultima = m => m.conversaciones.at(-1);
const intenta = async f => { try { return [await f(), null]; } catch (e) { return [null, e.message]; } };

// 1. Lo normal no cambia: cada mensaje sale tal cual, en la misma conversación.
{
  const m = motor(); L.__usarMotor(m, 4096);
  const h = [{ role: 'user', content: 'hola' }];
  h.push({ role: 'assistant', content: await L.chat(h, SISTEMA) });
  h.push({ role: 'user', content: '¿qué tal?' });
  await L.chat(h, SISTEMA);
  ok('mensajes normales: salen tal cual y en una sola conversación',
    m.conversaciones.length === 1 && JSON.stringify(ultima(m).enviados) === JSON.stringify(['hola', '¿qué tal?']));
}

// 2. Un resultado más grande que todo el contexto no tumba el turno ni la conversación.
{
  const m = motor({ limiteReal: 4096 }); L.__usarMotor(m, 4096);
  const cuerpo = 'PRINCIPIO-MARCADO ' + 'dato '.repeat(40000) + ' FINAL-MARCADO';
  const h = [
    { role: 'user', content: 'lee el informe' },
    { role: 'assistant', content: '```tool\n{"tool": "fs.read", "args": {"path": "i.txt"}}\n```' },
    { role: 'user', content: '[resultado fs.read]\n' + cuerpo },
  ];
  const [out, error] = await intenta(() => L.chat(h, SISTEMA));
  if (out != null) h.push({ role: 'assistant', content: out });
  const enviado = ultima(m).enviados.at(-1) || '';
  ok(`resultado de ${cuerpo.length} caracteres en un contexto de 4.096: el turno no falla`, !error, error || '');
  ok('  lo recorta por el medio y lo avisa', enviado.includes('[recortado:') && enviado.length < cuerpo.length);
  ok('  conserva la petición, la cabecera del resultado, el principio y el final',
    enviado.startsWith('lee el informe\n[resultado fs.read]') && enviado.includes('PRINCIPIO-MARCADO') && enviado.includes('FINAL-MARCADO'));
  h.push({ role: 'user', content: '¿y qué decía al final?' });
  const [, error2] = await intenta(() => L.chat(h, SISTEMA));
  ok('  y la conversación sigue viva en el turno siguiente', !error2, error2 || '');
}

// 3. Turnos que van llenando el contexto: se compacta con lo anterior empaquetado en vez de fallar.
{
  const m = motor({ limiteReal: 4096 }); L.__usarMotor(m, 4096);
  const h = [];
  let error = null;
  for (let i = 0; i < 40 && !error; i++) {
    h.push({ role: 'user', content: `turno ${i}: el código del armario ${i} es ${1000 + i}. ` + 'relleno '.repeat(150) });
    const [out, e] = await intenta(() => L.chat(h, SISTEMA));
    if (e) error = `turno ${i}: ${e}`; else h.push({ role: 'assistant', content: out });
  }
  const compactadas = m.conversaciones.filter(c => c.sistema.includes('CONVERSACIÓN HASTA AHORA'));
  ok('40 turnos medianos en un contexto de 4.096: ninguno falla', !error, error || '');
  ok('  se compacta en vez de desbordar', compactadas.length >= 1, `${m.conversaciones.length} conversaciones, ${compactadas.length} compactadas`);
  ok('  y cada conversación vieja se borra para liberar la caché', m.conversaciones.slice(0, -1).every(c => c.borrada));
}

// 4. Si el motor se queda sin sitio ANTES de lo que calcula el guardia, se rehace y se reintenta una vez.
{
  const m = motor({ limiteReal: 1500 }); L.__usarMotor(m, 4096);
  const h = [{ role: 'user', content: 'hola' }];
  h.push({ role: 'assistant', content: await L.chat(h, SISTEMA) });
  h.push({ role: 'user', content: 'resume esto: ' + 'palabra '.repeat(600) });   // cabe según el guardia, no según el motor
  const [, error] = await intenta(() => L.chat(h, SISTEMA));
  ok('límite real por debajo del calculado: reintenta y no falla', !error, error || '');
  ok('  rehaciendo la conversación', m.conversaciones.length === 2 && m.conversaciones[0].borrada);
}

// 5. Varios resultados en UN mensaje (Elffuss Code junta los de un paso): se recorta cada uno por su lado.
{
  const m = motor({ limiteReal: 4096 }); L.__usarMotor(m, 4096);
  const bloque = n => `[resultado code.read]\n${n}-PRINCIPIO ` + 'x '.repeat(50000) + ` ${n}-FINAL`;
  const h = [{ role: 'user', content: 'compara los dos ficheros' }, { role: 'user', content: bloque('A') + '\n\n' + bloque('B') }];
  const [, error] = await intenta(() => L.chat(h, SISTEMA));
  const enviado = ultima(m).enviados.at(-1) || '';
  ok('dos resultados enormes en un mensaje: el turno no falla', !error, error || '');
  ok('  los dos conservan principio y final, cada uno con su aviso',
    ['A-PRINCIPIO', 'A-FINAL', 'B-PRINCIPIO', 'B-FINAL'].every(s => enviado.includes(s)) && (enviado.match(/\[recortado:/g) || []).length === 2);
}

console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);

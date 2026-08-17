// Mide si un juego generado está VIVO, no cuánto pinta.
//
// Contar píxeles premiaba una pantalla de GAME OVER a toda página por encima
// de un juego jugable (lo vimos: el breakout+jurado marcaba 480.000 px porque
// arrancaba ya terminado). Aquí se comprueban cinco cosas independientes:
//
//   pinta      · dibuja algo en el canvas
//   vivo       · lo que dibuja CAMBIA solo entre dos instantes (hay bucle)
//   responde   · cambia también al recibir teclas y ratón
//   arranca    · no muestra «game over» nada más abrir
//   sinErrores · no lanza excepciones de JS
//
// Puntuación = cuántas cumple (0-5).
const crypto = require('crypto');

const HUELLA = `(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const x = c.getContext('2d');
  if (!x) return null;
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let nb = 0, suma = 0;
  for (let i = 0; i < d.length; i += 16) {          // muestreo: basta para detectar cambio
    if (d[i] || d[i+1] || d[i+2]) nb++;
    suma = (suma * 31 + d[i] + d[i+1] * 3 + d[i+2] * 7) >>> 0;
  }
  return { nb, huella: suma, w: c.width, h: c.height };
})()`;

async function medir(page, url) {
  const errores = [];
  page.on('pageerror', e => errores.push(e.message.slice(0, 80)));
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);

  const a = await page.evaluate(HUELLA).catch(() => null);
  const txtInicio = await page.evaluate(() => (document.body.innerText || '').toLowerCase()).catch(() => '');
  await page.waitForTimeout(2200);
  const b = await page.evaluate(HUELLA).catch(() => null);

  // ¿reacciona a la entrada? teclas + ratón, que es lo que usan estos juegos
  await page.evaluate(() => {
    const c = document.querySelector('canvas'); if (!c) return;
    const r = c.getBoundingClientRect();
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'w', 's']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : k, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : k, bubbles: true }));
    }
    for (let i = 0; i < 6; i++) {
      const ev = new MouseEvent('mousemove', { clientX: r.left + 40 + i * 40, clientY: r.top + r.height / 2, bubbles: true });
      document.dispatchEvent(ev); c.dispatchEvent(ev);
    }
    c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }).catch(() => {});
  await page.waitForTimeout(1600);
  const c = await page.evaluate(HUELLA).catch(() => null);

  // cuarta lectura sin mandar nada: un juego que espera a la primera tecla
  // (que es lo correcto) no puede contarse como muerto por esperar
  await page.waitForTimeout(1400);
  const d = await page.evaluate(HUELLA).catch(() => null);
  const texto = await page.evaluate(() => (document.body.innerText || '').toLowerCase()).catch(() => '');
  // «sobrevive»: la partida no puede acabarse sola sin que el jugador toque nada
  const FIN = /game\s*over|has perdido|fin del juego|puntuaci[óo]n final/;
  const finSolo = FIN.test(texto);            // al final: ¿se acabó sola la partida?
  // el «game over» pintado EN el canvas no está en el DOM: se detecta porque el
  // juego no cambia nada y llena mucho, así que se mira también el texto del DOM
  const gameOverDOM = FIN.test(txtInicio);    // al principio: ¿arrancó ya terminado?

  const pinta = !!(a && a.nb > 0);
  const vivo = !!((a && b && a.huella !== b.huella) || (c && d && c.huella !== d.huella));
  const responde = !!(b && c && b.huella !== c.huella);
  const arranca = !gameOverDOM;
  const sobrevive = !finSolo;
  const sinErrores = errores.length === 0;

  // «pinta» es puerta de entrada: sin dibujar nada, no hay juego que puntuar.
  // Si no, un HTML en blanco se llevaba 2 puntos gratis por «no muestra game
  // over» y «sin errores», que se cumplen trivialmente cuando no hay nada.
  const puntos = pinta ? [pinta, vivo, responde, arranca, sobrevive, sinErrores].filter(Boolean).length : 0;
  return {
    pinta, vivo, responde, arranca, sobrevive, sinErrores, puntos,
    px: a ? a.nb : 0, tam: a ? a.w + 'x' + a.h : '—', error: errores[0] || null,
  };
}

module.exports = { medir };

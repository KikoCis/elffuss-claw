// Flags extra de Chromium para las pruebas con GPU. El backend gráfico que
// necesita cada máquina NO se fija en el código: se pasa por el entorno,
// separado por espacios, p. ej.
//
//   ELFFUSS_CHROME_ARGS="--use-angle=<backend>" node tests/local27.mjs
//
// Sin la variable, Chromium usa el suyo por defecto.
export const CHROME_ARGS = (process.env.ELFFUSS_CHROME_ARGS || '').split(/\s+/).filter(Boolean);

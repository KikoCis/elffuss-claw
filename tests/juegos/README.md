# Arneses de medición de generación de juegos

Reproducen el estudio de `deepCreate` con Gemma E4B en el navegador.

- **ahora.cjs** — genera cada juego (borrador / refinar / best-of-N) y lo puntúa
  DESDE FUERA con un juez independiente, para que la medida no sea circular.
- **jugabilidad.cjs** — el juez externo: abre el juego y comprueba cinco señales
  (pinta, sigue vivo, responde a la entrada, no arranca terminado, sin errores),
  más «sobrevive» (no se acaba solo a los pocos segundos).
- **diversidad.mjs** — comprueba que el muestreo con temperatura produce salidas
  distintas; con decodificado voraz, best-of-N no aporta nada.

`PW` apunta a un node_modules con Playwright si no está en el del proyecto:
`PW=/ruta/a/playwright node tests/juegos/ahora.cjs`

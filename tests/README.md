# Tests E2E de Elffuss

```bash
python3 ../server/serve.py &   # el dev server en :8642
npm i                          # playwright
npm run e2e                    # casos de datos: Excel→gráfico y carpetas vigiladas
```

`e2e_datos.mjs` valida con el **modo básico** (determinista, sin GPU ni modelo):

- **A · Excel → visualización**: siembra un `.xlsx` REAL (SheetJS) en una carpeta
  autorizada, pide «visualiza ventas.xlsx» y comprueba que la cadena
  `fs.read` (xlsx→CSV) → `app.create` renderiza una app de gráfico con la
  columna correcta en el visualizador. Igual con CSV.
- **B · Automatización entre carpetas**: «pones un fichero en una carpeta y
  Elffuss lo procesa y te lo deja en otra» — crea `fs.watch entrada→salida`,
  deja DESPUÉS un `stock.xlsx` y un `nota.txt` en `entrada`, y comprueba que en
  `salida` aparecen `stock.csv` (convertido) y `nota.txt` (copiado), con aviso
  en el chat. También `fs.copy` one-shot con patrón (`*.txt` sí, `.md` no).

Las carpetas del test son **OPFS** (los pickers nativos exigen gesto de
usuario); los handles se registran en el IndexedDB de Elffuss igual que los
reales. Esto valida la plataforma — la calidad del modelo se evalúa con los
casos de `../coordinacion/ERRORES.md`.

## Tests de UX (`ux-*.mjs`)

Cada uno recorre una pantalla con el teclado y el ratón, sin GPU ni modelo
(modo básico; cuando hace falta un cerebro, un servidor de mentira compatible
con OpenAI en un puerto que da el sistema). Cortan las peticiones a terceros
(`ux-comun.mjs`): nada sale a la red ni toca producción.

```bash
python3 ../server/serve.py 8743 &
for t in ux-*.mjs; do BASE=http://localhost:8743 node "$t"; done
```

`ux-dialogos` (permisos y avisos) · `ux-boveda` · `ux-rutas` (pestañas, URL y
enlaces) · `ux-mente` · `ux-borrar` (🧹 y «Borrar todo») · `ux-modelos` (💾) ·
`ux-velocimetro` · `ux-movil` · `ux-copiloto` · `ux-skills` · `ux-ajustes` ·
`ux-paneles` (Apps, Tareas, Permisos) · `ux-teclado` (menú «/», atajos, chips) ·
`ux-hardwork` · `ux-modelo` (selector) · `ux-splash` · `ux-ingles` (lo rehecho, en inglés).

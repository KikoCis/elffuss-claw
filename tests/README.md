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

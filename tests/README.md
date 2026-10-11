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

## Proxy `/proxy?url=…` (Python, sin red)

```bash
python3 test_proxy.py            # el proxy
python3 test_install_proxy.py    # su instalación en el servidor, con sonda y vuelta atrás
node web-proxy.mjs               # lo que el agente recibe del proxy (Playwright)
```

`test_proxy.py` prueba el proxy endurecido de `server/serve.py` sin salir a
internet: el DNS y la conexión TCP se sustituyen, y «la web» es un servidor
local. Cubre cada vector rechazado (esquemas, puertos, usuario en la url,
direcciones no públicas en IPv4 e IPv6, IPv4 escritas en decimal, octal o hex,
nombres que resuelven a direcciones privadas, las direcciones públicas de la
propia máquina, redirecciones hacia ellas, otro origen llamando) y comprueba
en cada uno que el proxy NO llegó a conectar; y el camino bueno: dirección
fijada tras resolver una vez, Host y SNI del nombre, todas las direcciones
alternando IPv6 e IPv4 (con tope), cabeceras mínimas, aviso de recorte, plazo
total y límites por cliente, global y de concurrencia. También deja escrito
que `/proxy` es un relé abierto: un cliente que no es un navegador se atiende.

`test_install_proxy.py` corre `server/install-proxy.sh` contra un «servicio»
local: un backend que pasa `server/proxy-probe.py` se queda; el relé abierto de
antes vuelve al anterior; y sin ninguno que pase, el servicio se para.

`web-proxy.mjs` arranca su propio `serve.py` y corta toda la red: el motivo de
`X-Proxy-Error`, el estado de la web (`X-Proxy-Upstream-Status`) y el recorte
(`X-Proxy-Truncated`) llegan al agente, y la página anti-bot de DuckDuckGo (un
202) o un 429/503 del proxy son un error con su motivo, no «Sin resultados».

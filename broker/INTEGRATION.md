# Elffuss · caché de modelos compartida — guía de integración

Los modelos de IA (cientos de MB a varios GB) se descargan **una vez** y se
reutilizan. Este broker resuelve que cada web (cada *origen*) re-descargue el
mismo modelo: expone **una** caché en disco (OPFS) desde un origen compartido
(`models.elffuss.utopiaia.com`) al que cada web pide los modelos por `postMessage`.

## Qué se comparte y qué NO (léelo antes de nada)

- ✅ **Entre todas las webs de Elffuss** (`*.utopiaia.com`, mismo *site*): se
  comparte **una sola caché**. Un modelo bajado en `claw` está al instante en
  `copilot`, `translator`, `code`. (Probado en vivo.)
- ⚠️ **Desde OTRO dominio** (tú integras Elffuss en `tu-web.com`): el navegador
  **particiona el almacenamiento por site** (privacidad). Tu web tendrá **su
  propia** caché — el modelo se baja **una vez por tu site** y se reutiliza entre
  tus páginas, pero **no** se comparte con Elffuss ni con otros integradores.
  Esto **no lo salta ninguna API de forma fiable en 2026** (Storage Access API
  «beyond cookies» es solo-Chrome, con permiso por sitio, y su variante sin
  permiso se está retirando). Es un límite del navegador, no un bug. El futuro es
  la *Cross-Origin Storage API* (WICG), aún no implementada de forma nativa.

Traducción: **integrarlo es útil** (dentro de tu web no re-descargas), pero no
esperes compartir la descarga entre webs distintas.

## Cómo integrarlo (copiar y pegar)

```html
<script type="module">
const BROKER = 'https://models.elffuss.utopiaia.com/';

let iframe, ready;
function ensure() {
  if (iframe) return ready;
  iframe = document.createElement('iframe');
  iframe.src = BROKER;
  iframe.style.cssText = 'position:absolute;left:-9999px;width:0;height:0;border:0';
  ready = new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('broker timeout')), 8000);
    addEventListener('message', function h(e) {
      if (e.source === iframe.contentWindow && e.data?.kind === 'elffuss-broker-ready') {
        clearTimeout(to); removeEventListener('message', h); res();
      }
    });
  });
  document.body.appendChild(iframe);
  return ready;
}

// Devuelve un File (respaldado en disco) del modelo. Léelo con file.stream()
// para subirlo a la GPU sin cargar los GB en RAM.
async function getModel(url, onProgress) {
  await ensure();
  const origin = new URL(BROKER).origin;
  const id = Math.random();
  return new Promise((res, rej) => {
    addEventListener('message', function h(e) {
      if (e.source !== iframe.contentWindow || e.data?.id !== id) return;
      const m = e.data;
      if (m.kind === 'progress') onProgress?.(m);          // {loaded,total}
      else if (m.kind === 'file') { removeEventListener('message', h); res(m.file); }
      else if (m.kind === 'error') { removeEventListener('message', h); rej(new Error(m.message)); }
    });
    iframe.contentWindow.postMessage({ type: 'elffuss-model-get', id, url }, origin);
  });
}

// uso:
const file = await getModel('https://…/gemma.litertlm', p => console.log(p.loaded, '/', p.total));
// pásalo a tu runtime: Engine.create({ model: file }) / file.stream() → WebGPU
</script>
```

Para saber si ya está sin bajarlo: `postMessage({type:'elffuss-model-has', id, url})`
→ responde `{kind:'has', cached, size}`.

## Requisitos y avisos

- **Origen permitido**: el broker solo responde a `*.utopiaia.com` (y `localhost`
  en desarrollo). Para integrar desde otro dominio, hay que añadirlo a la lista
  del broker — escríbenos. (Da igual para la caché: tu site tendrá la suya.)
- **`targetOrigin` explícito** en los dos sentidos y **valida `event.origin`**;
  nunca uses `'*'` para datos.
- **COOP/COEP**: si tu app está *cross-origin isolated* (usa `SharedArrayBuffer`),
  el broker ya se sirve con `Cross-Origin-Resource-Policy: cross-origin`; pon
  `Cross-Origin-Embedder-Policy: credentialless` en tu web o el iframe no cargará.
  Es el fallo más común al integrar.
- **Safari** desaloja el almacenamiento sin interacción tras ~7 días (durabilidad
  menor) y no soporta transferir *streams*: por eso el broker pasa un **File**
  (funciona en todos los navegadores), no un stream.
- **No dupliques**: lee el File con `.stream()` y súbelo a la GPU; no guardes una
  segunda copia en tu propio OPFS.

## Descarga sin broker (bonus, mismo-site)

Si sirves los modelos desde **un solo origen** (`models.elffuss.utopiaia.com`) con
cabeceras `Cache-Control: public, max-age=31536000, immutable`, el navegador ya
**deduplica la descarga de red** entre subdominios del mismo site (la caché HTTP
se particiona por *site*). Es un extra gratis; el broker + OPFS es la capa
**durable** (la caché HTTP es volátil y se desaloja bajo presión de disco).

## transformers.js (whisper, ONNX)

`transformers.js` gestiona su propia caché (`transformers-cache`, por-origen). Para
que use la caché compartida, dale un `customCache` que hable con el broker:

```js
import { env } from '@huggingface/transformers';
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = {
  async match(req)  { const url = typeof req === 'string' ? req : req?.url; if (!url) return undefined;
                      const file = await getModel(url).catch(() => null); return file ? new Response(file.stream()) : undefined; },
  async put(req, res) { /* el broker baja/guarda por su cuenta en el primer match */ },
};
```
(Protege `match` de entradas `undefined`/no-GET; devuelve `undefined` para caer a red.)

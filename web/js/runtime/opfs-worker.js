// Escribir OPFS desde un Worker — el único camino que existe en iOS.
// ─────────────────────────────────────────────────────────────────────────────
// En escritorio se escribe con `createWritable`, que devuelve un stream y va
// directo a disco. En iOS Safari ESO NO EXISTE en el hilo principal: la única
// forma de escribir OPFS es `createSyncAccessHandle`, y solo dentro de un
// Worker. Sin este fichero, el almacén detecta que no puede escribir y cae a
// Cache Storage — que iOS desaloja entre visitas, así que el teléfono se
// vuelve a descargar el modelo ENTERO cada vez que se abre la página.
//
// No es una optimización: es la diferencia entre un modelo que se guarda y uno
// que no. Por eso el plan lo tenía en el camino crítico.
//
// El handle síncrono bloquea el hilo mientras escribe, y por eso tiene que
// vivir aquí: en el principal congelaría la interfaz durante gigabytes.
//
// Protocolo (un mensaje, una respuesta, siempre con `id` para poder esperar):
//   {id, op:'abrir',    carpeta, nombre}  -> crea/trunca el fichero
//   {id, op:'escribir', buf}              -> escribe al final (buf transferido)
//   {id, op:'cerrar'}                     -> vacía y cierra
//
// Licencia: código propio y PRIVADO — no se publica.

let handle = null;      // FileSystemSyncAccessHandle
let pos = 0;            // dónde va el siguiente byte

async function abrir(carpeta, nombre) {
  await cerrar();                                   // por si quedó uno abierto
  const raiz = await navigator.storage.getDirectory();
  const dir = await raiz.getDirectoryHandle(carpeta, { create: true });
  const fh = await dir.getFileHandle(nombre, { create: true });
  handle = await fh.createSyncAccessHandle();
  // Truncar a cero NO es redundante con `create: true`: si el fichero ya
  // existía de un intento cortado, sin esto quedarían bytes viejos DETRÁS de
  // lo que escribamos, y el modelo saldría más largo de lo que debe sin un
  // solo error. Los restos a medias son la forma más cara de fallar aquí.
  handle.truncate(0);
  pos = 0;
}

function escribir(buf) {
  if (!handle) throw new Error('escritura sin fichero abierto');
  const n = handle.write(new Uint8Array(buf), { at: pos });
  // `write` devuelve cuántos bytes entraron de verdad. Si se ignora y el disco
  // se queda corto, el fichero sale truncado y parece sano.
  if (n !== buf.byteLength) throw new Error(`escritura corta: ${n} de ${buf.byteLength}`);
  pos += n;
  return pos;
}

async function cerrar() {
  if (!handle) return 0;
  const fin = pos;
  try { handle.flush(); handle.close(); } finally { handle = null; pos = 0; }
  return fin;
}

self.onmessage = async (ev) => {
  const { id, op } = ev.data || {};
  try {
    let r = null;
    if (op === 'abrir') r = await abrir(ev.data.carpeta, ev.data.nombre);
    else if (op === 'escribir') r = escribir(ev.data.buf);
    else if (op === 'cerrar') r = await cerrar();
    else throw new Error('operación desconocida: ' + op);
    self.postMessage({ id, ok: true, r });
  } catch (e) {
    // El error viaja como TEXTO: un Error no siempre sobrevive al clonado
    // estructurado y llegaría como «{}», que no dice nada a nadie.
    self.postMessage({ id, ok: false, error: String((e && e.message) || e) });
  }
};

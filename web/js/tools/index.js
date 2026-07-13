// Registro de herramientas: lo único que el agente puede tocar del mundo.
import * as fs from './fs.js';
import * as apps from './apps.js';
import * as vault from './vault.js';
import * as tasks from './tasks.js';
import * as web from './web.js';
import * as memory from './memory.js';
import * as watch from './watch.js';

export { fs, apps, vault, tasks, web, memory, watch };

export const TOOLS = {
  'fs.pick_folder': { desc: 'Pedir al usuario que autorice una carpeta de su ordenador', params: {}, run: () => fs.pickFolder() },
  'fs.list':  { desc: 'Listar archivos de una ruta relativa dentro de la carpeta autorizada', params: { path: 'ruta relativa (opcional)' }, run: a => fs.list(a) },
  'fs.read':  { desc: 'Leer un archivo de texto', params: { path: 'ruta relativa' }, run: a => fs.read(a) },
  'fs.write': { desc: 'Escribir o crear un archivo de texto', params: { path: 'ruta', content: 'contenido' }, run: a => fs.write(a) },
  'fs.copy':  { desc: 'Copiar archivos entre dos carpetas autorizadas (una vez)', params: { pattern: '*.txt', from: 'carpeta origen', to: 'carpeta destino' }, run: a => fs.copy(a) },
  'fs.watch': { desc: 'AUTOMATIZACIÓN: vigilar una carpeta — lo que se deje ahí se procesa (Excel→CSV, resto copia) y se deja en otra', params: { from: 'carpeta origen', to: 'carpeta destino', pattern: 'opcional, p.ej. *.xlsx' }, run: a => watch.add(a) },
  'fs.watch_list':   { desc: 'Ver las automatizaciones de carpetas', params: {}, run: () => watch.listWatches() },
  'fs.watch_remove': { desc: 'Quitar una automatización', params: { id: 'id' }, run: a => watch.removeWatch(a) },
  'app.create': { desc: 'Crear una app: documento HTML completo y autocontenido que se muestra al instante en el visualizador', params: { name: 'nombre corto', html: 'HTML completo' }, run: a => apps.create(a) },
  'app.open':   { desc: 'Abrir una app ya creada', params: { name: 'nombre' }, run: a => apps.open(a) },
  'app.list':   { desc: 'Listar las apps creadas', params: {}, run: () => apps.listApps() },
  'vault.set':  { desc: 'Guardar un secreto cifrado (requiere vault desbloqueado)', params: { name: 'nombre', secret: 'valor' }, run: a => vault.setSecret(a) },
  'vault.get':  { desc: 'Leer un secreto del vault', params: { name: 'nombre' }, run: a => vault.getSecret(a) },
  'vault.list': { desc: 'Listar los nombres de los secretos', params: {}, run: () => vault.listSecrets() },
  'tasks.add':    { desc: 'Programar una tarea futura (Elffuss se enviará ese prompt)', params: { inMinutes: 'minutos desde ahora', at: 'fecha ISO (alternativa)', prompt: 'qué hacer' }, run: a => tasks.add(a) },
  'tasks.list':   { desc: 'Ver las tareas programadas', params: {}, run: () => tasks.listTasks() },
  'tasks.remove': { desc: 'Borrar una tarea programada', params: { id: 'id de la tarea' }, run: a => tasks.removeTask(a) },
  'web.search': { desc: 'Buscar en internet (texto): devuelve títulos, enlaces y fragmentos', params: { query: 'qué buscar' }, run: a => web.search(a) },
  'web.images': { desc: 'Buscar imágenes en internet y mostrarlas en una galería', params: { query: 'qué imágenes' }, run: a => imagesGallery(a) },
  'web.fetch': { desc: 'Visitar una URL concreta y devolver su texto', params: { url: 'https://…' }, run: a => web.fetchUrl(a) },
  'memory.save':   { desc: 'Recordar un hecho sobre el usuario PARA SIEMPRE (memoria persistente)', params: { fact: 'el hecho' }, run: a => memory.save(a) },
  'memory.list':   { desc: 'Ver todo lo recordado', params: {}, run: () => memory.listFacts() },
  'memory.forget': { desc: 'Olvidar un hecho por id', params: { id: 'id del hecho' }, run: a => memory.forget(a) },
};

export function toolHelp() {
  return Object.entries(TOOLS).map(([n, t]) =>
    `- ${n}(${Object.keys(t.params).join(', ')}): ${t.desc}`).join('\n');
}

// web.images → galería HTML mostrada al instante en el visualizador.
async function imagesGallery({ query } = {}) {
  const res = await web.images({ query });
  let data;
  try { data = JSON.parse(res); } catch { return res; } // era «sin imágenes»
  const cards = data.images.map(i =>
    `<a href="${i.url}" target="_blank" rel="noopener"><img src="${i.thumb}" loading="lazy" alt="${(i.title || '').replace(/"/g, '')}"><span>${i.by ? '© ' + i.by : ''}</span></a>`).join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${query}</title><style>
body{margin:0;background:#0d1117;color:#e6edf3;font-family:system-ui;padding:14px}
h2{font-weight:600;margin:4px 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
a{display:block;border-radius:10px;overflow:hidden;background:#161b22;border:1px solid #30363d;position:relative}
img{width:100%;height:140px;object-fit:cover;display:block}
span{position:absolute;bottom:0;left:0;right:0;font-size:.6rem;color:#c9d1d9;background:linear-gradient(transparent,#000a);padding:8px 6px 4px}
</style></head><body><h2>🔎 ${query}</h2><div class="grid">${cards}</div></body></html>`;
  await apps.create({ name: 'imágenes ' + query, html });
  return `Galería con ${data.images.length} imágenes de «${query}» abierta en el visualizador.`;
}

export async function runTool(name, args) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Herramienta desconocida: ${name}`);
  return tool.run(args || {});
}

// Estado real del sistema, inyectado al modelo en cada turno (CONTEXTO AHORA).
export async function snapshot() {
  const [appList, pendingTasks, folderList, facts, watches] = await Promise.all([
    apps.allApps(), tasks.pending(), fs.folders(), memory.recent(8), watch.allWatches(),
  ]);
  const next = pendingTasks.sort((a, b) => a.when - b.when)[0];
  return [
    'Memoria (hechos que recuerdas del usuario): ' +
      (facts.length ? facts.map(f => f.fact).join(' · ') : 'nada aún'),
    'Fecha y hora: ' + new Date().toLocaleString('es-ES'),
    'Apps ya creadas: ' + (appList.length ? appList.map(a => a.name).join(', ') : 'ninguna'),
    'App abierta en el visualizador: ' + (apps.currentApp() || 'ninguna'),
    'Carpetas autorizadas: ' + (folderList.length ? folderList.join(', ') : 'ninguna (usa fs.pick_folder)'),
    `Tareas pendientes: ${pendingTasks.length}` +
      (next ? ` (próxima ${new Date(next.when).toLocaleTimeString('es-ES')}: «${next.prompt}»)` : ''),
    'Automatizaciones de carpetas: ' +
      (watches.length ? watches.map(w => `${w.from}→${w.to}`).join(', ') : 'ninguna'),
    'Vault: ' + (vault.isUnlocked() ? 'desbloqueado' : 'bloqueado'),
  ].join('\n');
}

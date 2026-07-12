// Registro de herramientas: lo único que el agente puede tocar del mundo.
import * as fs from './fs.js';
import * as apps from './apps.js';
import * as vault from './vault.js';
import * as tasks from './tasks.js';
import * as web from './web.js';

export { fs, apps, vault, tasks, web };

export const TOOLS = {
  'fs.pick_folder': { desc: 'Pedir al usuario que autorice una carpeta de su ordenador', params: {}, run: () => fs.pickFolder() },
  'fs.list':  { desc: 'Listar archivos de una ruta relativa dentro de la carpeta autorizada', params: { path: 'ruta relativa (opcional)' }, run: a => fs.list(a) },
  'fs.read':  { desc: 'Leer un archivo de texto', params: { path: 'ruta relativa' }, run: a => fs.read(a) },
  'fs.write': { desc: 'Escribir o crear un archivo de texto', params: { path: 'ruta', content: 'contenido' }, run: a => fs.write(a) },
  'app.create': { desc: 'Crear una app: documento HTML completo y autocontenido que se muestra al instante en el visualizador', params: { name: 'nombre corto', html: 'HTML completo' }, run: a => apps.create(a) },
  'app.open':   { desc: 'Abrir una app ya creada', params: { name: 'nombre' }, run: a => apps.open(a) },
  'app.list':   { desc: 'Listar las apps creadas', params: {}, run: () => apps.listApps() },
  'vault.set':  { desc: 'Guardar un secreto cifrado (requiere vault desbloqueado)', params: { name: 'nombre', secret: 'valor' }, run: a => vault.setSecret(a) },
  'vault.get':  { desc: 'Leer un secreto del vault', params: { name: 'nombre' }, run: a => vault.getSecret(a) },
  'vault.list': { desc: 'Listar los nombres de los secretos', params: {}, run: () => vault.listSecrets() },
  'tasks.add':    { desc: 'Programar una tarea futura (Nastia se enviará ese prompt)', params: { inMinutes: 'minutos desde ahora', at: 'fecha ISO (alternativa)', prompt: 'qué hacer' }, run: a => tasks.add(a) },
  'tasks.list':   { desc: 'Ver las tareas programadas', params: {}, run: () => tasks.listTasks() },
  'tasks.remove': { desc: 'Borrar una tarea programada', params: { id: 'id de la tarea' }, run: a => tasks.removeTask(a) },
  'web.fetch': { desc: 'Visitar una URL y devolver su texto', params: { url: 'https://…' }, run: a => web.fetchUrl(a) },
};

export function toolHelp() {
  return Object.entries(TOOLS).map(([n, t]) =>
    `- ${n}(${Object.keys(t.params).join(', ')}): ${t.desc}`).join('\n');
}

export async function runTool(name, args) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Herramienta desconocida: ${name}`);
  return tool.run(args || {});
}

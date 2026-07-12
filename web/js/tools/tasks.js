// Tareas programadas: prompts que Elffuss se lanza a sí misma en el futuro.
// El planificador corre mientras la pestaña esté abierta (cada 15 s).
import * as db from '../db.js';
import { require as requirePerm } from '../permissions.js';

export async function add({ inMinutes, at, prompt } = {}) {
  if (!prompt) throw new Error('Falta prompt');
  await requirePerm('tasks', prompt);
  const when = at ? new Date(at).getTime() : Date.now() + (Number(inMinutes) || 1) * 60000;
  if (!when || Number.isNaN(when)) throw new Error('Fecha inválida');
  const id = 't' + Math.random().toString(36).slice(2, 8);
  await db.set('tasks', id, { id, when, prompt, done: false });
  return `Tarea ${id} programada para ${new Date(when).toLocaleString('es-ES')}: «${prompt}»`;
}

export async function listTasks() {
  const ts = (await db.all('tasks')).sort((a, b) => a.when - b.when);
  if (!ts.length) return 'No hay tareas programadas.';
  return ts.map(t =>
    `${t.done ? '✅' : '⏳'} ${t.id} · ${new Date(t.when).toLocaleString('es-ES')} · ${t.prompt}`
  ).join('\n');
}

export async function removeTask({ id } = {}) {
  await db.del('tasks', id);
  return `Tarea ${id} borrada.`;
}

export async function pending() {
  return (await db.all('tasks')).filter(t => !t.done);
}

export function startScheduler(fire) {
  setInterval(async () => {
    for (const t of await pending())
      if (t.when <= Date.now()) {
        t.done = true;
        await db.set('tasks', t.id, t);
        fire(t);
      }
  }, 15000);
}

// Tareas programadas: prompts que Elffuss se lanza a sí misma en el futuro.
// El planificador corre mientras la pestaña esté abierta (cada 15 s).
import * as db from '../db.js';
import { require as requirePerm } from '../permissions.js';
import { t, uiLang } from '../i18n.js';

export async function add({ inMinutes, at, prompt } = {}) {
  if (!prompt) throw new Error(t('toolMissing', { arg: 'prompt' }));
  await requirePerm('tasks', prompt);
  const when = at ? new Date(at).getTime() : Date.now() + (Number(inMinutes) || 1) * 60000;
  if (!when || Number.isNaN(when)) throw new Error(t('taskBadDate'));
  const id = 't' + Math.random().toString(36).slice(2, 8);
  await db.set('tasks', id, { id, when, prompt, done: false });
  return t('taskScheduled', { id, when: new Date(when).toLocaleString(uiLang()), prompt });
}

export async function listTasks() {
  const ts = (await db.all('tasks')).sort((a, b) => a.when - b.when);
  if (!ts.length) return t('taskNone');
  return ts.map(x =>
    `${x.done ? '✅' : '⏳'} ${x.id} · ${new Date(x.when).toLocaleString(uiLang())} · ${x.prompt}`
  ).join('\n');
}

export async function removeTask({ id } = {}) {
  await db.del('tasks', id);
  return t('taskRemoved', { id });
}

// «Ejecutar ahora» desde el panel: la marca como hecha en la misma transacción
// (como el planificador) y la devuelve, o null si ya no estaba o ya se lanzó.
export async function marcarHecha(id) {
  const hecha = await db.update('tasks', id,
    actual => (actual && !actual.done) ? { ...actual, done: true } : undefined).catch(() => undefined);
  return hecha || null;
}

export async function pending() {
  return (await db.all('tasks')).filter(t => !t.done);
}

export function startScheduler(fire) {
  setInterval(async () => {
    for (const t of await pending())
      if (t.when <= Date.now()) {
        // Se RELEE antes de escribir, en la misma transacción. Escribir la copia
        // leída al principio de la pasada resucitaba (como hecha) una tarea que
        // acababas de borrar, y pisaba lo que hubiera cambiado entre medias. Si
        // ya no está o ya se lanzó (otra pestaña), no se escribe ni se lanza.
        const hecha = await db.update('tasks', t.id,
          actual => (actual && !actual.done) ? { ...actual, done: true } : undefined).catch(() => undefined);
        if (hecha) fire(hecha);
      }
  }, 15000);
}

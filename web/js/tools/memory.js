// Memoria persistente de Elffuss: hechos sobre el usuario guardados en SU
// navegador (IndexedDB). Sobreviven al refresco y a nuevas conversaciones;
// los últimos entran en el CONTEXTO AHORA de cada turno.
import * as db from '../db.js';
import { require as requirePerm } from '../permissions.js';

export async function save({ fact } = {}) {
  if (!fact) throw new Error('Falta fact');
  await requirePerm('memory', fact);
  const id = 'm' + Math.random().toString(36).slice(2, 8);
  await db.set('memory', id, { id, fact: String(fact).slice(0, 300), at: Date.now() });
  return `Recordado para siempre: «${fact}» (id ${id})`;
}

export async function listFacts() {
  const all = (await db.all('memory')).sort((a, b) => a.at - b.at);
  return all.length
    ? all.map(f => `• [${f.id}] ${f.fact}`).join('\n')
    : 'No recuerdo nada aún. Dime «recuerda que…» y lo guardo.';
}

export async function forget({ id } = {}) {
  await db.del('memory', id);
  return `Olvidado ${id}.`;
}

export async function recent(n = 8) {
  return (await db.all('memory')).sort((a, b) => b.at - a.at).slice(0, n).reverse();
}

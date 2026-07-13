// Skills de Elffuss Code: instrucciones en markdown (formato SKILL.md de
// Claude Code) que el modelo sigue cuando aplican. Se instalan desde el
// catálogo grande OFICIAL (github.com/anthropics/skills), desde los plugins
// oficiales, o desde CUALQUIER repo público (marketplaces de la comunidad
// tipo OpenClaude/openclaw). Todo transparente: se ve el repo, la lista y el
// SKILL.md que se inyecta. Se guardan en IndexedDB (nada sale del navegador).
import * as db from './db.js';

const KEY = 'skills';          // skills instaladas
const SRC_KEY = 'skills.sources'; // repos personalizados añadidos por el usuario
const MAX_SKILL = 12_000;      // caracteres del cuerpo que se inyectan al modelo

export const CATALOG_REPO = 'anthropics/skills';
export const DEFAULT_SOURCES = [
  { repo: 'anthropics/skills', label: 'Anthropic · Agent Skills (oficial de Claude Code)', official: true },
  { repo: 'anthropics/claude-plugins-official', label: 'Anthropic · Claude Code Plugins (oficial)', official: true },
];

let cache = []; // instaladas, en memoria (para que el systemPrompt sea síncrono)

export async function initSkills() {
  cache = (await db.get('kv', KEY).catch(() => null)) || [];
  return cache;
}

export async function all() { return cache; }
export function installed() { return cache; }
export function isInstalled(repo, path) { return cache.some(s => s.repo === repo && s.path === path); }

export async function install(skill) {
  cache = cache.filter(s => !(s.repo === skill.repo && s.path === skill.path) && s.name !== skill.name);
  cache.push({ ...skill, content: (skill.content || '').slice(0, MAX_SKILL) });
  await db.set('kv', KEY, cache);
  return skill.name;
}

export async function remove(nameOrPath) {
  cache = cache.filter(s => s.name !== nameOrPath && s.path !== nameOrPath);
  await db.set('kv', KEY, cache);
}

export async function get(name) {
  return cache.find(s => s.name.toLowerCase() === String(name).toLowerCase()) || null;
}

// ---- fuentes (repos) ----
export async function sources() {
  const custom = (await db.get('kv', SRC_KEY).catch(() => null)) || [];
  return [...DEFAULT_SOURCES, ...custom];
}
export async function addSource(repoOrUrl, label) {
  const repo = repoOrUrl.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Usa owner/repo (o la URL de GitHub)');
  const custom = (await db.get('kv', SRC_KEY).catch(() => null)) || [];
  if (!custom.some(s => s.repo === repo) && !DEFAULT_SOURCES.some(s => s.repo === repo))
    custom.push({ repo, label: label || repo });
  await db.set('kv', SRC_KEY, custom);
  return repo;
}
export async function removeSource(repo) {
  const custom = (await db.get('kv', SRC_KEY).catch(() => null)) || [];
  await db.set('kv', SRC_KEY, custom.filter(s => s.repo !== repo));
}

// ---- catálogo desde GitHub ----
// Una sola llamada al árbol git del repo → todos los SKILL.md.
export async function listFromRepo(repo) {
  let tree, branch;
  for (const b of ['main', 'master']) {
    const r = await fetch(`https://api.github.com/repos/${repo}/git/trees/${b}?recursive=1`);
    if (r.ok) { tree = await r.json(); branch = b; break; }
    if (r.status === 403) throw new Error('GitHub limitó las peticiones (60/h sin login). Reintenta en unos minutos.');
  }
  if (!tree) throw new Error('No pude leer el repo (¿existe y es público?)');
  return (tree.tree || [])
    .filter(n => /(^|\/)SKILL\.md$/i.test(n.path))
    .map(n => ({ repo, branch, path: n.path, dir: n.path.replace(/\/SKILL\.md$/i, ''), name: n.path.replace(/\/SKILL\.md$/i, '').split('/').pop() || repo }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

// Descarga el SKILL.md y lo instala (frontmatter YAML simple).
export async function installFromRepo(entry) {
  let md = null;
  for (const b of [entry.branch, 'main', 'master'].filter(Boolean)) {
    const r = await fetch(`https://raw.githubusercontent.com/${entry.repo}/${b}/${entry.path}`);
    if (r.ok) { md = await r.text(); break; }
  }
  if (md == null) throw new Error('No pude descargar el SKILL.md');
  const skill = parseSkill(md, entry.name);
  return install({ ...skill, repo: entry.repo, path: entry.path });
}

// SKILL.md → { name, description, content }
export function parseSkill(md, fallbackName = 'skill') {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  const meta = fm?.[1] || '';
  const name = meta.match(/^name:\s*(.+)$/m)?.[1]?.trim() || fallbackName;
  const description = (meta.match(/^description:\s*([\s\S]+?)(?:\n\w+:|$)/m)?.[1] || '').replace(/\s+/g, ' ').trim();
  const content = md.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  return { name, description, content };
}

// Bloque para el systemPrompt (síncrono, desde la caché).
export function skillsPromptBlock() {
  if (!cache.length) return '';
  const parts = cache.map(s =>
    `### Skill «${s.name}»${s.repo ? ` (de ${s.repo})` : ''}\n${s.description || ''}\n${(s.content || '').slice(0, MAX_SKILL)}`);
  return `\n\nSKILLS ACTIVAS (instrucciones especializadas; síguelas cuando la tarea encaje):\n${parts.join('\n\n')}`;
}

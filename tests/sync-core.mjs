// sync-core.sh ya no pisa en silencio lo que el core no tiene.
//
// Copiaba los ficheros del core encima de web/js/ a ciegas: un cambio hecho
// aquí y no en el core (la parada del proveedor API, la Mente…) se perdía en la
// siguiente sincronización. Ahora compara el código sin comentarios:
//   1. mismo código (solo cambian los comentarios): copia;
//   2. código distinto: no lo toca, lo dice y sale con error;
//   3. --force: copia igual, como antes.
// Sobre una copia de mentira del repo y del core en una carpeta temporal.
//
//   node tests/sync-core.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'sync-core.sh');
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const FICHEROS = ['context.js', 'embed.js', 'skills.js', 'md.js', 'splash-gl.js', 'ceo.js', 'mind.js', 'humanize.js', 'telemetry.js', 'providers/api.js'];
function montar(aqui, core) {
  const base = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'sync-core-'));
  const repo = join(base, 'repo'), dirCore = join(base, 'core');
  for (const d of [join(repo, 'web/js/providers'), join(dirCore, 'providers')]) mkdirSync(d, { recursive: true });
  copyFileSync(SCRIPT, join(repo, 'sync-core.sh'));
  for (const f of FICHEROS) {
    writeFileSync(join(repo, 'web/js', f), aqui[f] ?? `export const x = 1; // ${f}\n`);
    writeFileSync(join(dirCore, f), core[f] ?? `export const x = 1; // ${f}\n`);
  }
  return { repo, dirCore, corre: (...extra) => spawnSync('bash', [join(repo, 'sync-core.sh'), dirCore, ...extra], { encoding: 'utf8' }) };
}

// 1 · mismo código, comentarios en otro idioma: copia
{
  const m = montar(
    { 'ceo.js': '// cerebro CEO\nconst url = "https://ejemplo"; // la web\nexport const a = 1;\n' },
    { 'ceo.js': '// CEO brain\nconst url = "https://ejemplo"; // the site\nexport const a = 1;\n' });
  const r = m.corre();
  const copiado = readFileSync(join(m.repo, 'web/js/ceo.js'), 'utf8');
  ok('1 · mismo código (solo cambian los comentarios): sincroniza y sale bien', r.status === 0 && /CEO brain/.test(copiado), `${r.status} ${r.stdout}${r.stderr}`);
}
// 2 · aquí hay código que el core no tiene: no lo pisa
{
  const aqui = 'export function f() {\n  if (parar) return; // lo nuevo\n  return 1;\n}\n';
  const m = montar({ 'mind.js': aqui, 'md.js': 'const s = "a // no es comentario";\n' }, { 'mind.js': 'export function f() {\n  return 1;\n}\n', 'md.js': 'const s = "a // tampoco";\n' });
  const r = m.corre();
  const quedo = readFileSync(join(m.repo, 'web/js/mind.js'), 'utf8');
  ok('2 · código distinto: no lo pisa', quedo === aqui, quedo);
  ok('  …lo dice, con el fichero', r.status !== 0 && /web\/js\/mind\.js/.test(r.stdout), `${r.status} ${r.stdout}`);
  ok('  …y un // dentro de una cadena es código, no comentario (md.js tampoco se pisa)', /web\/js\/md\.js/.test(r.stdout), r.stdout);
  ok('  …y el resto sí se sincroniza', /ceo\.js/.test(readFileSync(join(m.repo, 'web/js/ceo.js'), 'utf8')), '');
  // 3 · --force: como antes
  const f = m.corre('--force');
  ok('3 · --force copia igual (como antes)', f.status === 0 && readFileSync(join(m.repo, 'web/js/mind.js'), 'utf8') === 'export function f() {\n  return 1;\n}\n', `${f.status} ${f.stdout}`);
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ sync-core.sh no pisa en silencio lo que el core no tiene');
process.exit(fails ? 1 : 0);

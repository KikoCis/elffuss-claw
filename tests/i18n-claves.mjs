// Las claves de web/js/i18n.js, en Node, sin navegador: que ningún idioma se
// quede atrás en silencio.
//   · Cada clave del español está en los otros cinco idiomas. Antes ucraniano,
//     francés, alemán y portugués tenían 65 de 544: el resto caía al inglés sin
//     que nada lo dijera.
//   · Cada traducción lleva los mismos {huecos} que el inglés (un hueco perdido
//     deja el dato fuera; uno inventado sale tal cual en pantalla).
//   · Ninguna está vacía, y los saltos de línea de los textos largos se respetan.
//
//   node tests/i18n-claves.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'js', 'i18n.js'), 'utf8');
const m = src.match(/const L = (\{[\s\S]*?\n\});\n/);
let fallos = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fallos++; };
ok('se encuentra la tabla de textos', !!m);
const L = new Function('return ' + m[1])();
const huecos = s => (typeof s === 'string' ? (s.match(/\{(\w+)\}/g) || []).sort().join(',') : '');
const IDIOMAS = ['es', 'en', 'uk', 'fr', 'de', 'pt'];
ok('están los seis idiomas', IDIOMAS.every(l => L[l] && typeof L[l] === 'object'), Object.keys(L).join(' '));
const claves = Object.keys(L.es);
for (const l of IDIOMAS) {
  const faltan = claves.filter(k => !(k in L[l]));
  ok(`${l}: tiene todas las claves del español (${claves.length})`, !faltan.length, faltan.slice(0, 12).join(' ') + (faltan.length > 12 ? ` … y ${faltan.length - 12} más` : ''));
  const sobran = Object.keys(L[l]).filter(k => !(k in L.es));
  ok(`${l}: ninguna clave que el español no tenga`, !sobran.length, sobran.slice(0, 12).join(' '));
  const malHueco = claves.filter(k => k in L[l] && typeof L.en[k] === 'string' && huecos(L[l][k]) !== huecos(L.en[k]));
  ok(`${l}: los mismos {huecos} que el inglés`, !malHueco.length, malHueco.slice(0, 8).map(k => `${k}: ${huecos(L[l][k])} ≠ ${huecos(L.en[k])}`).join(' | '));
  const vacias = claves.filter(k => typeof L[l][k] === 'string' && !L[l][k].trim());
  ok(`${l}: ninguna vacía`, !vacias.length, vacias.join(' '));
  const lineas = claves.filter(k => typeof L[l][k] === 'string' && typeof L.en[k] === 'string' && L[l][k].split('\n').length !== L.en[k].split('\n').length);
  ok(`${l}: los textos largos conservan sus saltos de línea`, !lineas.length, lineas.join(' '));
}
console.log(fallos ? `\n❌ ${fallos} FALLO(S)` : '\n✅ IDIOMAS: los seis tienen todas las claves, con sus huecos');
process.exit(fallos ? 1 : 0);

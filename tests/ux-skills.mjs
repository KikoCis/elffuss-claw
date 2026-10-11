// Pestaña Skills: lo que haces se ve al momento. GitHub se stubea aquí (nada
// sale a la red).
//   · «Explorar» abre la lista DENTRO de la tarjeta del repo y otra vez la
//     cierra (antes añadía una copia al final del panel por cada clic); cada
//     skill enlaza a su SKILL.md.
//   · «Instalar» deja el botón desactivado y sube el contador; «Quitar» la quita
//     al momento y deja «Deshacer»; se puede ver lo que se le da al modelo.
//   · «Añadir repo» lo enseña al momento, vacía el campo y se puede quitar (✕).
//   · #/skills/<nombre> señala la skill y abre su texto.
//
//   BASE=http://localhost:8743 node tests/ux-skills.mjs
import { navegador, contexto, pagina, ok, hasta, avisos, fin, BASE } from './ux-comun.mjs';

const REPO = 'KikoCis/elffuss-claw-skills';
const ARBOL = { tree: [
  { path: 'skills/reloj-bonito/SKILL.md' },
  { path: 'skills/notas/SKILL.md' },
] };
const SKILL_MD = '---\nname: reloj-bonito\ndescription: Un reloj con estilo.\n---\nCrea un reloj grande. Ejemplo: «hazme un reloj bonito».';
const b = await navegador();
const { ctx, fuera } = await contexto(b, {
  rutas: async (url, route) => {
    if (url.startsWith(`https://api.github.com/repos/${REPO}/git/trees/main`)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ARBOL) }); return true;
    }
    if (url.startsWith(`https://raw.githubusercontent.com/${REPO}/`)) {
      await route.fulfill({ status: 200, contentType: 'text/plain', body: SKILL_MD }); return true;
    }
    return false;
  },
});
const { p, errores } = await pagina(ctx);
await p.click('#tabs button[data-tab="skills"]');
const contador = () => p.locator('#panel-skills .skills-instaladas > .muted').first().innerText();
ok('empieza con «Instaladas: 0»', (await contador()) === 'Instaladas: 0');

const tarjeta = p.locator(`#panel-skills [data-ruta="repo:${REPO}"]`);
const explorar = tarjeta.locator('button', { hasText: /Explorar|Ocultar/ });
await explorar.click();
ok('«Explorar» abre la lista DENTRO de la tarjeta del repo', await hasta(async () =>
  /reloj-bonito/.test(await tarjeta.locator('.repo-skills').innerText()) && await explorar.getAttribute('aria-expanded') === 'true'));
const md = tarjeta.locator('.repo-skills a', { hasText: 'SKILL.md' }).first();
ok('cada skill enlaza a su SKILL.md (pestaña nueva, sin referrer)', /github\.com\/KikoCis\/elffuss-claw-skills\/blob\/main\/skills\/(notas|reloj-bonito)\/SKILL\.md/.test(await md.getAttribute('href'))
  && await md.getAttribute('rel') === 'noopener noreferrer');
await explorar.click();
ok('otra vez la cierra (sin duplicar nada)', await tarjeta.locator('.repo-skills').isHidden()
  && await p.locator('#panel-skills .repo-skills .card', { hasText: 'reloj-bonito' }).count() === 1);
await explorar.click();

const tarjetaSkill = tarjeta.locator('.repo-skills .card', { hasText: 'reloj-bonito' });
const instalar = tarjetaSkill.locator('button', { hasText: 'Instala' });
await instalar.click();
ok('«Instalar» deja el botón desactivado en «Instalada ✓»', await hasta(async () =>
  (await instalar.innerText()) === 'Instalada ✓' && await instalar.isDisabled()));
ok('…el contador sube y la skill aparece en lo instalado', (await contador()) === 'Instaladas: 1'
  && await p.locator('#panel-skills .skills-instaladas [data-ruta="reloj-bonito"]').count() === 1);
ok('…y el chat explica cómo usarla', /Skill «reloj-bonito» instalada/.test(await p.locator('#log').innerText()));
const verEnChat = tarjetaSkill.locator('button', { hasText: 'Ver cómo usarla en el chat' });
ok('la tarjeta enlaza a ese mensaje del chat', await verEnChat.count() === 1);
await verEnChat.click();
ok('…que lo pone a la vista, con el foco y resaltado', await hasta(() => p.evaluate(() => {
  const a = document.activeElement;
  return a?.classList.contains('msg') && /Skill «reloj-bonito» instalada/.test(a.textContent) && a.classList.contains('resaltado');
})));
const inst = p.locator('#panel-skills .skills-instaladas [data-ruta="reloj-bonito"]');
await inst.locator('summary').click();
ok('se puede ver lo que se le da al modelo', /Crea un reloj grande/.test(await inst.locator('.skill-text').innerText()));

await inst.locator('button[aria-label="Quitar la skill «reloj-bonito»"]').click();
ok('«Quitar» la quita al momento y el contador baja', await hasta(async () =>
  await p.locator('#panel-skills .skills-instaladas [data-ruta="reloj-bonito"]').count() === 0 && (await contador()) === 'Instaladas: 0'));
ok('…sin tocar las demás skills guardadas', (await p.evaluate(async () => (await (await import('/js/db.js')).get('kv', 'skills')) || [])).length === 0);
const deshacer = p.locator('#toasts .toast', { hasText: 'quitada' }).locator('.toast-accion');
await deshacer.click();
ok('«Deshacer» la devuelve', await hasta(async () => await p.locator('#panel-skills .skills-instaladas [data-ruta="reloj-bonito"]').count() === 1));

// ── añadir y quitar un repo ─────────────────────────────────────────────────
await p.fill('#panel-skills form input', 'https://github.com/alguien/sus-skills');
await p.press('#panel-skills form input', 'Enter');
const nueva = p.locator('#panel-skills [data-ruta="repo:alguien/sus-skills"]');
ok('«Añadir repo» lo enseña al momento y vacía el campo', await hasta(async () => await nueva.count() === 1)
  && (await p.inputValue('#panel-skills form input')) === '' && (await avisos(p)).some(t => /añadido/.test(t)));
await nueva.locator('button[aria-label="Quitar el repo alguien/sus-skills"]').click();
ok('✕ quita un repo añadido', await hasta(async () => await nueva.count() === 0));
ok('los repos de serie no tienen ✕', await tarjeta.locator('button[aria-label^="Quitar el repo"]').count() === 0);

// ── dirección de una skill ──────────────────────────────────────────────────
await p.goto(BASE + '/#/skills/reloj-bonito', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.elffuss?.agent);
ok('#/skills/reloj-bonito abre Skills, la señala y abre su texto', await hasta(() => p.evaluate(() => {
  const c = document.querySelector('#panel-skills [data-ruta="reloj-bonito"]');
  return document.getElementById('panel-skills').classList.contains('active') && c?.classList.contains('resaltado') && c.querySelector('details')?.open;
})));

// ── a lo ancho: nada se sale del panel ──────────────────────────────────────
// Hasta 1280 px, «Explorar» y «Quitar» quedaban fuera del panel, que se
// desplazaba de lado sin que nada lo indicara: el nombre de cada fila no podía
// encoger (una regla para el título de la tarjeta caía también en él).
await p.evaluate(async () => {
  const s = await import('/js/skills.js');
  await s.install({ name: 'threejs-escena-con-nombre-largo', description: 'Escenas.', content: 'Usa three.js.',
    repo: 'scottstts/Threejs-Awesome-Graphics-Agent-Skills', path: 'skills/threejs-escena-con-nombre-largo/SKILL.md' });
});
await p.click('#tabs button[data-tab="apps"]');
await p.click('#tabs button[data-tab="skills"]');
await tarjeta.locator('button', { hasText: 'Explorar' }).click();
await hasta(async () => /reloj-bonito/.test(await tarjeta.locator('.repo-skills').innerText()));
for (const ancho of [1280, 1024, 768, 390]) {
  await p.setViewportSize({ width: ancho, height: 900 });
  if (ancho <= 700 && !(await p.evaluate(() => document.body.classList.contains('show-viz')))) await p.click('#btn-flip');
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const r = await p.evaluate(() => {
    const panel = document.getElementById('panel-skills');
    const pr = panel.getBoundingClientRect();
    const fuera = [...panel.querySelectorAll('.card button')].filter(b => b.getClientRects().length).filter(b => {
      const q = b.getBoundingClientRect();
      return q.left < pr.left - 1 || q.right > Math.min(pr.right, innerWidth) + 1;
    }).map(b => b.getAttribute('aria-label') || b.textContent);
    return { scrollW: panel.scrollWidth, clientW: panel.clientWidth, fuera,
      botones: panel.querySelectorAll('.card button').length };
  });
  ok(`a ${ancho} px el panel no se desplaza de lado y todos los botones (Explorar, Quitar, Instalar…) están dentro`,
    r.scrollW <= r.clientW + 1 && !r.fuera.length && r.botones >= 10, JSON.stringify(r));
}
await p.setViewportSize({ width: 1400, height: 900 });

ok('nada salió a GitHub de verdad', !fuera.some(u => /github/.test(u)), fuera.filter(u => /github/.test(u)).join(' | '));
ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
await fin(b, 'SKILLS: explorar dentro de su tarjeta, instalar/quitar al momento, repos que aparecen y se quitan');

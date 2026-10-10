// Pestaña Bóveda con teclado y ratón.
//   · Crear/desbloquear con Enter en la contraseña: no pide el permiso del agente
//     (antes la misma pulsación lo DENEGABA) y no se lo concede a escondidas.
//   · 👁 enseña y vuelve a tapar (aria-pressed); el autobloqueo repinta el panel
//     y tapa lo revelado; 🗑 pide confirmación con el nombre del secreto.
//   · Un solo nombre por idioma: «Bóveda» en español.
//
//   BASE=http://localhost:8743 node tests/ux-boveda.mjs
import { navegador, contexto, pagina, ok, hasta, espera, avisos, fin, OUT } from './ux-comun.mjs';

const b = await navegador();
const { ctx } = await contexto(b, { grants: [] });
const { p, errores } = await pagina(ctx);
const permisoAbierto = () => p.evaluate(() => document.getElementById('perm-dialog').open);

await p.click('#tabs button[data-tab="vault"]');
ok('en español la pestaña y el título dicen «Bóveda»', (await p.locator('#tabs button[data-tab="vault"]').innerText()) === 'Bóveda'
  && /Bóveda/.test(await p.locator('#panel-vault h3').innerText()));
ok('la contraseña maestra tiene nombre accesible', await p.locator('#vault-master').getAttribute('aria-label') === 'Contraseña maestra');

// ── crear con Enter ─────────────────────────────────────────────────────────
await p.fill('#vault-master', 'clave-de-prueba-1');
await p.press('#vault-master', 'Enter');
await espera(300);
ok('Enter NO abre el permiso del agente (ni lo deniega solo)', !(await permisoAbierto())
  && !(await avisos(p)).some(t => /denegado/.test(t)), (await avisos(p)).join(' | '));
ok('la bóveda queda creada y abierta', await hasta(() => p.evaluate(() => !!document.getElementById('vault-name'))));
ok('y lo dice el panel (estado a la vista)', /se bloquea sola/.test(await p.locator('#panel-vault').innerText()));
ok('hacerlo desde el panel NO concede el permiso «Bóveda» al agente', !(await p.evaluate(async () => (await import('/js/permissions.js')).has('vault'))));

// ── guardar con Enter, ver y tapar ──────────────────────────────────────────
await p.fill('#vault-name', 'correo');
await p.fill('#panel-vault input[type=password]', 'secreto-123');
await p.press('#panel-vault input[type=password]', 'Enter');
ok('el secreto se guarda con Enter y aparece en la lista', await hasta(async () =>
  (await p.locator('#panel-vault .card b').allTextContents()).includes('correo')));
const ver = p.locator('#panel-vault .card', { hasText: 'correo' }).locator('button[aria-pressed]');
ok('👁 tiene nombre propio («Ver «correo»»)', await ver.getAttribute('aria-label') === 'Ver «correo»');
await ver.click();
ok('👁 lo enseña (aria-pressed=true)', await hasta(async () =>
  (await p.locator('#panel-vault .card code').innerText()) === 'secreto-123' && await ver.getAttribute('aria-pressed') === 'true'));
await ver.click();
ok('👁 otra vez lo tapa', await hasta(async () =>
  (await p.locator('#panel-vault .card code').innerText()) === '••••••' && await ver.getAttribute('aria-pressed') === 'false'));

// ── 🗑 confirma con el nombre ────────────────────────────────────────────────
p.__aceptar = false;
await p.locator('#panel-vault .card', { hasText: 'correo' }).locator('button[aria-label^="Borrar"]').click();
await espera(200);
ok('🗑 pregunta nombrando el secreto', (p.__dialogos || []).some(m => /«correo»/.test(m)), (p.__dialogos || []).join(' | '));
ok('si dices que no, sigue ahí', (await p.locator('#panel-vault .card b').allTextContents()).includes('correo'));

// ── bloquear: lo revelado se tapa y el panel lo refleja ─────────────────────
await ver.click();
await hasta(async () => (await p.locator('#panel-vault .card code').innerText()) === 'secreto-123');
await p.evaluate(async () => (await import('/js/tools/vault.js')).lock());
ok('al bloquearse, el panel pasa a «Bloqueada» y el secreto deja de verse', await hasta(async () =>
  /Bloqueada/.test(await p.locator('#panel-vault').innerText()) && !(await p.locator('#panel-vault').innerText()).includes('secreto-123')));

// ── contraseña mala ─────────────────────────────────────────────────────────
await p.fill('#vault-master', 'otra-cosa');
await p.press('#vault-master', 'Enter');
ok('una contraseña mala lo dice y la bóveda sigue cerrada', await hasta(async () => (await avisos(p)).some(t => /incorrecta/.test(t)))
  && !(await p.evaluate(async () => (await import('/js/tools/vault.js')).isUnlocked())));
await p.fill('#vault-master', 'clave-de-prueba-1');
await p.press('#vault-master', 'Enter');
await hasta(() => p.evaluate(() => !!document.getElementById('vault-name')));
p.__aceptar = true;
await p.locator('#panel-vault .card', { hasText: 'correo' }).locator('button[aria-label^="Borrar"]').click();
ok('y si dices que sí, se borra', await hasta(async () => !(await p.locator('#panel-vault .card b').allTextContents()).includes('correo')));
if (OUT) await p.screenshot({ path: OUT + '/ux-boveda.png' });
ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));

// ── el autobloqueo de verdad (reloj adelantado 5 min) ───────────────────────
{
  const { ctx: c2 } = await contexto(b, { grants: [] });
  const q = await c2.newPage();
  await q.clock.install();
  await q.goto((process.env.BASE || 'http://localhost:8743') + '/', { waitUntil: 'domcontentloaded' });
  await q.waitForFunction(() => !!window.elffuss?.agent, null, { timeout: 15000 });
  await q.click('#tabs button[data-tab="vault"]');
  await q.fill('#vault-master', 'clave-2');
  await q.press('#vault-master', 'Enter');
  await q.waitForFunction(() => !!document.getElementById('vault-name'));
  await q.fill('#vault-name', 'banco');
  await q.fill('#panel-vault input[type=password]', 'pin-9999');
  await q.press('#panel-vault input[type=password]', 'Enter');
  await q.waitForFunction(() => [...document.querySelectorAll('#panel-vault .card b')].some(e => e.textContent === 'banco'));
  await q.locator('#panel-vault .card', { hasText: 'banco' }).locator('button[aria-pressed]').click();
  await q.waitForFunction(() => document.querySelector('#panel-vault .card code')?.textContent === 'pin-9999');
  await q.clock.fastForward('05:01');
  await q.waitForTimeout(200);
  const tras = await q.evaluate(() => ({ texto: document.getElementById('panel-vault').innerText, avisos: [...document.querySelectorAll('#toasts .toast-txt')].map(t => t.textContent) }));
  ok('autobloqueo: el panel se repinta cerrado, sin el secreto y avisando', /Bloqueada/.test(tras.texto) && !tras.texto.includes('pin-9999')
    && tras.avisos.some(t => /bloqueado sola/.test(t)), JSON.stringify(tras).slice(0, 200));
  await c2.close();
}

// ── en inglés, «Vault» de principio a fin ───────────────────────────────────
{
  const { ctx: c3 } = await contexto(b, { grants: [], locale: 'en-US' });
  const { p: e } = await pagina(c3);
  await e.click('#tabs button[data-tab="vault"]');
  ok('en-US: «Vault» y etiquetas en inglés', (await e.locator('#tabs button[data-tab="vault"]').innerText()) === 'Vault'
    && await e.locator('#vault-master').getAttribute('aria-label') === 'Master password');
  await c3.close();
}

await fin(b, 'BÓVEDA: Enter crea y abre, 👁 tapa, el autobloqueo se ve, 🗑 pregunta');

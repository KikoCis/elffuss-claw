// En inglés (en-US), lo que se rehízo en la auditoría de UX habla inglés:
//   · los avisos del selector de modelo (Básico, un cerebro que no carga);
//   · la respuesta del modo básico, con su enlace al selector de modelo;
//   · «What's stored» en Ajustes;
//   · el error de la bóveda al guardar sin nombre;
//   · el velocímetro (chip, panel y su nombre accesible), con un motor de prueba.
// Antes todo eso salía en español con la página en inglés.
//
//   BASE=http://localhost:8743 node tests/ux-ingles.mjs
import { navegador, contexto, pagina, ok, hasta, escribir, reposo, avisos, fin } from './ux-comun.mjs';

const b = await navegador();
const ESPANOL = /\b(sin modelo|No se pudo|Estoy en modo|selector de modelo|Generadas|Conversación|Bóveda|Faltan|Velocidad|leyendo|escribiendo|Pulsa)\b/;

const { ctx } = await contexto(b, {
  locale: 'en-US', grants: [],
  extraInit: { 'elffuss.providers': JSON.stringify({ openai: { enabled: true, baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' } }) },
});
const { p, errores } = await pagina(ctx);
const elegir = id => p.evaluate(id => { const s = document.getElementById('model-select'); s.value = id; s.dispatchEvent(new Event('change')); }, id);

// ── selector de modelo ──────────────────────────────────────────────────────
await elegir('rules');
ok('choosing Basic says so in English', await hasta(async () => (await avisos(p)).some(t => t === 'Basic mode: no model, direct commands.')),
  (await avisos(p)).join(' | '));
await hasta(() => p.evaluate(() => !document.getElementById('model-select').disabled));
await elegir('ext:openai');           // sin clave: no carga, y no había otro cerebro
ok('a brain that does not load says why in English', await hasta(async () =>
  (await avisos(p)).some(t => /^⚠️ Could not load OpenAI: the API key is missing \(advanced settings\)$/.test(t))), (await avisos(p)).join(' | '));

// ── modo básico ─────────────────────────────────────────────────────────────
await hasta(() => p.evaluate(() => document.getElementById('model-select').value === 'rules' && !document.getElementById('model-select').disabled));
await escribir(p, 'hola');
await reposo(p);
const respuesta = await p.locator('#log .msg.assistant').last();
const texto = await respuesta.innerText();
ok('the Basic-mode reply is in English and says the commands are in Spanish', /I am in Basic mode/.test(texto) && /written in Spanish/.test(texto) && !/Estoy en modo/.test(texto), texto.slice(0, 160));
ok('…and links to the model picker', await respuesta.locator('a[href="#/modelo"]').innerText().catch(() => '') === 'model picker');

// ── Settings › What's stored ────────────────────────────────────────────────
await p.click('#tabs button[data-tab="ajustes"]');
const tarjeta = p.locator('#panel-ajustes .card', { hasText: 'Wipe browser data' });
ok('“What’s stored” names the stores in English', await hasta(async () => {
  const t = await tarjeta.innerText().catch(() => '');
  return /Generated apps/.test(t) && /Conversation/.test(t) && /Vault \(encrypted\)/.test(t) && !/Apps generadas|Bóveda/.test(t);
}), await tarjeta.innerText().catch(() => ''));

// ── Vault: guardar sin nombre ───────────────────────────────────────────────
await p.click('#tabs button[data-tab="vault"]');
await p.fill('#vault-master', 'test-password-1');
await p.press('#vault-master', 'Enter');
await hasta(() => p.evaluate(() => !!document.getElementById('vault-name')));
await p.fill('#panel-vault input[type=password]', 'secret-without-name');
await p.press('#panel-vault input[type=password]', 'Enter');
ok('saving a secret without a name says so in English', await hasta(async () => (await avisos(p)).some(t => /The name or the secret is missing/.test(t))),
  (await avisos(p)).join(' | '));

// ── velocímetro ─────────────────────────────────────────────────────────────
await p.evaluate(async () => {
  const vm = await import('/js/velocimetro.js');
  vm.usarTraductor((await import('/js/i18n.js')).t);   // lo que hace el kernel al montarlo
  vm.montar({
    alMedir: () => () => {},
    ultimaMedida: () => ({ prefillTokS: 300, genTokS: 20, ttftMs: 900, genTokens: 50, procesados: 400, reusados: 3, enCurso: false }),
  });
});
const chip = p.locator('#speed-chip');
ok('speed chip title in English', /^Writing at 20\.0 tok\/s · the prompt was read at 300 tok\/s · first letter after 900 ms\. Click to see the chart\.$/.test(await chip.getAttribute('title') || ''),
  await chip.getAttribute('title'));
await chip.click();
const panel = await p.evaluate(() => ({ text: document.getElementById('speed-panel').innerText, label: document.getElementById('speed-panel').getAttribute('aria-label') }));
ok('speed panel and its accessible name in English', panel.label === 'Speed of this machine' && /tok\/s reading the prompt/.test(panel.text)
  && /3 reused/.test(panel.text) && !ESPANOL.test(panel.text), JSON.stringify(panel).slice(0, 300));

ok('no page errors', errores.length === 0, errores.slice(0, 3).join(' | '));
await fin(b, 'INGLÉS: lo rehecho en la auditoría habla inglés con la página en inglés');

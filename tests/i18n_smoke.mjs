// Smoke-test de i18n del chrome (SIN modelo): carga cada app en locale en/es y
// comprueba que la UI estática/temprana se localiza y que el saludo de Claw ya
// no sale garbled. Caza errores de página que mencionen mis módulos.
import { chromium } from 'playwright';

const MY = /(i18n|humanize|ui\.js|main\.js|mind\.js|apps\.js|kernel\.js|agent\.js)/;
const isMine = m => MY.test(m) || /ReferenceError|is not defined|SyntaxError|Cannot access|before initialization/.test(m);

const CLAW = 'http://localhost:8811';
const CODE = 'http://localhost:8812';
let failures = 0;
const ok = (label, cond, extra = '') => { console.log(`${cond ? '✓' : '✗ FAIL'} ${label}${extra ? ' — ' + extra : ''}`); if (!cond) failures++; };

async function load(browser, url, locale) {
  const ctx = await browser.newContext({ locale });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => { if (isMine(e.message)) errs.push('pageerror: ' + e.message); });
  page.on('console', m => { if (m.type() === 'error' && isMine(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(url + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800); // deja correr applyI18n + boot (no el modelo)
  const lang = await page.evaluate(() => navigator.language);
  return { ctx, page, errs, lang };
}

const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--disable-gpu-watchdog'] });

// ---------- CLAW ----------
for (const locale of ['en-US', 'es-ES']) {
  const { ctx, page, errs, lang } = await load(browser, CLAW, locale);
  const sys = (await page.locator('.msg.sys').first().textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim();
  const ph = await page.locator('#prompt').getAttribute('placeholder').catch(() => '');
  console.log(`\n== CLAW · ${locale} (navigator.language=${lang}) ==`);
  console.log('  saludo:', JSON.stringify(sys.slice(0, 90)));
  console.log('  placeholder:', JSON.stringify(ph));
  ok('sin errores de mis módulos', errs.length === 0, errs.join(' | '));
  ok('saludo NO garbled (sin «se crean» residual)', !/se crean/i.test(sys) || locale.startsWith('es'), sys.slice(0, 90));
  // runtime: t() con sustitución {var} + humanize, evaluados en el navegador real
  const rt = await page.evaluate(async () => {
    const i = await import('/js/i18n.js');
    const h = await import('/js/humanize.js');
    return {
      done: i.t('done', { result: 'App X ready.' }),
      writing: i.t('writing', { n: 7 }),
      using: i.t('using', { name: 'app.create' }),
      modelReady: i.t('modelReady', { where: i.t('whereGpu') }),
      hCreate: h.humanizeTool('app.create', { name: 'Notes' }),
      hRead: h.humanizeTool('fs.read', { path: 'a.txt' }),
    };
  });
  console.log('  runtime:', JSON.stringify(rt));
  // paneles: descartar el splash (intercepta clics) y navegar por las pestañas
  await page.locator('#splash-enter').click({ timeout: 1500 }).catch(()=>{});
  await page.evaluate(() => document.getElementById('splash')?.remove()).catch(()=>{});
  const panels = {};
  for (const [tab, id] of [['apps','panel-apps'],['tareas','panel-tareas'],['permisos','panel-permisos'],['ajustes','panel-ajustes']]) {
    await page.locator(`#tabs button[data-tab="${tab}"]`).click({ timeout: 3000 }).catch(()=>{});
    await page.waitForTimeout(150);
    panels[tab] = ((await page.locator(`#${id} h3`).first().textContent().catch(()=>'' ))||'').trim();
  }
  const scopes = await page.evaluate(async () => {
    const pm = await import('/js/permissions.js');
    return { appsLabel: pm.SCOPES.apps.label, fsDesc: pm.SCOPES.fs.desc };
  });
  const permBtns = { deny: (await page.locator('#perm-deny').textContent().catch(()=>'' )), allow: (await page.locator('#perm-allow').textContent().catch(()=>'' )) };
  console.log('  paneles:', JSON.stringify(panels), '| scopes:', JSON.stringify(scopes), '| permBtns:', JSON.stringify(permBtns));
  if (locale.startsWith('en')) {
    ok('panel Apps EN', panels.apps === 'Apps created', panels.apps);
    ok('panel Tasks EN', panels.tareas === 'Scheduled tasks', panels.tareas);
    ok('panel Perms EN', panels.permisos === 'Granted permissions', panels.permisos);
    ok('panel Settings EN', /Models & advanced settings/.test(panels.ajustes), panels.ajustes);
    ok('SCOPE fs EN', scopes.appsLabel === 'Apps' && /Read and write/.test(scopes.fsDesc), JSON.stringify(scopes));
    ok('perm btns EN', permBtns.deny === 'Deny' && permBtns.allow === 'Allow', JSON.stringify(permBtns));
    ok('saludo EN («I’m Elffuss»)', /I’m Elffuss|I'm Elffuss/.test(sys));
    ok('welcome EN («operating system»)', /operating system/i.test(sys));
    ok('saludo EN sin español', !/soy Elffuss|sistema operativo/i.test(sys));
    ok('placeholder EN', /Ask me anything/i.test(ph || ''));
    ok('done EN + sustitución', rt.done === 'Done! App X ready. Want me to tweak anything?', rt.done);
    ok('writing EN {n}', rt.writing === 'Elffuss is writing · 7', rt.writing);
    ok('modelReady EN', /AI model ready · WebGPU local/.test(rt.modelReady), rt.modelReady);
    ok('humanize EN app.create', rt.hCreate === 'creating the app “Notes”…', rt.hCreate);
    ok('humanize EN fs.read', rt.hRead === 'reading a.txt…', rt.hRead);
  } else {
    ok('panel Apps ES', panels.apps === 'Apps creadas', panels.apps);
    ok('panel Tareas ES', panels.tareas === 'Tareas programadas', panels.tareas);
    ok('SCOPE fs ES', /Leer y escribir/.test(scopes.fsDesc), JSON.stringify(scopes));
    ok('perm btns ES', permBtns.deny === 'Denegar' && permBtns.allow === 'Permitir', JSON.stringify(permBtns));
    ok('saludo ES («soy Elffuss»)', /soy Elffuss/.test(sys));
    ok('welcome ES («sistema operativo»)', /sistema operativo/i.test(sys));
    ok('placeholder ES', /Pídeme lo que necesites/i.test(ph || ''));
    ok('done ES + sustitución', rt.done === '¡Listo! App X ready. ¿Quieres que le cambie algo?', rt.done);
    ok('writing ES {n}', rt.writing === 'Elffuss está escribiendo · 7', rt.writing);
    ok('humanize ES app.create', rt.hCreate === 'creando la app «Notes»…', rt.hCreate);
  }
  await ctx.close();
}

// ---------- CODE ----------
for (const locale of ['en-US', 'es-ES']) {
  const { ctx, page, errs, lang } = await load(browser, CODE, locale);
  const ph = await page.locator('#prompt').getAttribute('placeholder').catch(() => '');
  console.log(`\n== CODE · ${locale} (navigator.language=${lang}) ==`);
  console.log('  placeholder:', JSON.stringify(ph));
  const rt = await page.evaluate(async () => {
    const i = await import('/js/i18n.js');
    return { welcome: i.t('welcome', { name: 'Proj' }), writing: i.t('writing', { n: 3 }), ready: i.t('modelReady') };
  });
  // landing (estático, vía applyI18n): tagline, botón, placeholders, un tooltip
  const land = {
    open: ((await page.locator('#open-project').textContent().catch(()=>'' ))||'').trim(),
    tag: ((await page.locator('#landing .tag').textContent().catch(()=>'' ))||'').replace(/\s+/g,' ').trim(),
    clonePh: await page.locator('#clone-url').getAttribute('placeholder').catch(()=>'' ),
    searchTitle: await page.locator('#act-search').getAttribute('title').catch(()=>'' ),
  };
  // pass-3: command palette (>) + panel de historial
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+KeyP' : 'Control+Shift+KeyP');
  await page.waitForTimeout(250);
  const palCmds = await page.locator('#pal-list .pi-name').allTextContents().catch(()=>[]);
  const palHint = ((await page.locator('#pal-list .pi-hint').first().textContent().catch(()=>'' ))||'').trim();
  await page.keyboard.press('Escape').catch(()=>{});
  // el panel de historial vive en modo IDE (tras abrir carpeta), inalcanzable
  // aquí sin proyecto → validamos sus claves i18n directamente (la wiring en
  // runtime ya la prueba la command palette, mismo import t en el mismo fichero)
  const hist = await page.evaluate(async () => {
    const i = await import('/js/i18n.js');
    return { head: i.t('tHistory'), empty: i.t('histEmpty'), gCommit: i.t('gCommit'), fallback: i.t('fallbackToast') };
  });
  console.log('  runtime:', JSON.stringify(rt), '\n  landing:', JSON.stringify(land),
    '\n  palette:', JSON.stringify(palCmds.slice(0,3)), 'hint:', JSON.stringify(palHint), '| hist(i18n):', JSON.stringify(hist));
  ok('sin errores de mis módulos', errs.length === 0, errs.join(' | '));
  if (locale.startsWith('en')) {
    ok('landing botón EN', land.open === '📁 Open code folder', land.open);
    ok('landing tagline EN', /Open your code folder/.test(land.tag), land.tag);
    ok('landing clone placeholder EN', /paste the URL/.test(land.clonePh || ''), land.clonePh || '');
    ok('tooltip search EN', land.searchTitle === 'Search (Cmd/Ctrl+P)', land.searchTitle || '');
    ok('palette cmds EN', palCmds.includes('New conversation') && palCmds.includes('Search the code…'), JSON.stringify(palCmds));
    ok('palette hint EN', palHint === 'command', palHint);
    ok('history/git i18n EN', hist.head === 'Conversation history' && hist.empty === 'No saved conversations yet.' && hist.gCommit === 'Ask Elffuss to commit' && /didn’t load/.test(hist.fallback), JSON.stringify(hist));
    ok('placeholder EN («Ask Elffuss for code»)', /Ask Elffuss for code/i.test(ph || ''), ph || '');
    ok('welcome EN {name}', /Project “Proj” open/.test(rt.welcome), rt.welcome);
    ok('writing EN {n} chars', rt.writing === 'Elffuss writes · 3 chars', rt.writing);
    ok('modelReady EN', rt.ready === 'AI model ready', rt.ready);
  } else {
    ok('landing botón ES', land.open === '📁 Abrir carpeta de código', land.open);
    ok('landing tagline ES', /Abre tu carpeta de código/.test(land.tag), land.tag);
    ok('tooltip search ES', land.searchTitle === 'Buscar (Cmd/Ctrl+P)', land.searchTitle || '');
    ok('palette cmds ES', palCmds.includes('Nueva conversación') && palCmds.includes('Buscar en el código…'), JSON.stringify(palCmds));
    ok('history/git i18n ES', hist.head === 'Historial de conversaciones' && hist.empty === 'Sin conversaciones guardadas todavía.' && hist.gCommit === 'Pídele a Elffuss que commitee', JSON.stringify(hist));
    ok('placeholder ES («Pídele código»)', /Pídele código a Elffuss/i.test(ph || ''), ph || '');
    ok('welcome ES {name}', /Proyecto «Proj» abierto/.test(rt.welcome), rt.welcome);
    ok('writing ES car.', rt.writing === 'Elffuss escribe · 3 car.', rt.writing);
  }
  await ctx.close();
}

await browser.close();
console.log(`\n${failures ? '✗ ' + failures + ' fallo(s)' : '✓ TODO OK'}`);
process.exit(failures ? 1 : 0);

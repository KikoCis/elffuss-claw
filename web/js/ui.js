// UI: chat + visualizador + paneles. Todo el DOM vive aquí.
import * as db from './db.js';
import * as perms from './permissions.js';
import * as settings from './settings.js';
import * as skills from './skills.js';
import { fs, apps, vault, tasks } from './tools/index.js';
import { renderMarkdown } from './md.js';
import { t as tr, uiLang } from './i18n.js';
import { humanizeStreamPreview } from './humanize.js'; // alias: dentro de tick(t) el token ya se llama t
import { UI } from './icons.js';
import { cacheEstimate, clearModelCache } from './model-cache.js';
import * as workspace from './workspace.js';
import * as telemetry from './telemetry.js';

let onSettingsChangedCb = () => {};
let onSkillInstalledCb = () => {};

const $ = id => document.getElementById(id);

// ---------- chat ----------
export function addMsg(cls, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  // las respuestas de Elffuss se renderizan como markdown; lo del usuario, plano
  if (cls === 'assistant') {
    div.classList.add('md');
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }
  $('log').appendChild(div);
  $('log').scrollTop = $('log').scrollHeight;
  return div;
}

function shortArgs(args = {}) {
  const s = Object.entries(args)
    .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(' · ');
  return s ? ` (${s.slice(0, 120)})` : '';
}

export function addTool(call) {
  addMsg('tool', `🔧 ${call.tool}${shortArgs(call.args)}`);
}

export function addToolResult(tool, result) {
  const err = result.startsWith('ERROR');
  const det = document.createElement('details');
  det.className = 'msg tool-result' + (err ? ' err' : '');
  const sum = document.createElement('summary');
  sum.textContent = (err ? '⚠️ ' : '✓ ') + result.split('\n')[0].slice(0, 110);
  const pre = document.createElement('pre');
  pre.textContent = result.slice(0, 2000);
  det.append(sum, pre);
  $('log').appendChild(det);
  $('log').scrollTop = $('log').scrollHeight;
}

// Burbuja de «pensando»: visible, con avatar, puntos animados y el texto
// del modelo en streaming (cola de 240 caracteres).
export function thinkingBubble() {
  const div = document.createElement('div');
  div.className = 'msg thinking';
  const img = document.createElement('img');
  img.src = 'img/elffuss.svg';
  img.className = 'mini';
  img.alt = '';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = tr('thinking');
  const dots = document.createElement('span');
  dots.className = 'dots';
  dots.append(...[0, 1, 2].map(() => document.createElement('i')));
  const gen = document.createElement('div');
  gen.className = 'gen';
  div.append(img, label, dots, gen);
  $('log').appendChild(div);
  $('log').scrollTop = $('log').scrollHeight;
  let buf = '';
  return {
    tick(t) {
      buf += t;
      label.textContent = tr('writing', { n: buf.length });
      // Si está emitiendo un tool-call (p.ej. app.create con un HTML enorme), NO
      // volcamos el JSON/HTML crudo que parpadea: una frase humana («creando
      // app…»). Para el texto normal, caja que CRECE y se puede leer/scrollear
      // entera (antes se mostraban solo los últimos 240 y desaparecía lo de
      // arriba). Se respeta tu scroll si subes a leer.
      const preview = humanizeStreamPreview(buf);
      if (preview) {
        gen.classList.add('tool-preview');
        gen.textContent = '⟐ ' + preview;
      } else {
        gen.classList.remove('tool-preview');
        const pegado = gen.scrollHeight - gen.scrollTop - gen.clientHeight < 28;
        gen.textContent = buf;
        if (pegado) gen.scrollTop = gen.scrollHeight;
      }
    },
    tool(name) {
      buf = '';
      gen.textContent = '';
      label.textContent = tr('using', { name });
    },
    remove() { div.remove(); },
  };
}

export function toast(text, ms = 4500) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ---------- modal de permisos ----------
export function askPermission(scope, meta, detail) {
  return new Promise(resolve => {
    $('perm-title').textContent = `${meta?.icon || '❓'} ${tr('permWord')}: ${meta?.label || scope}`;
    $('perm-desc').textContent = meta?.desc || '';
    $('perm-detail').textContent = detail || '';
    const dlg = $('perm-dialog');
    const done = ok => { dlg.close(); refreshPerms(); resolve(ok); };
    $('perm-allow').onclick = () => done(true);
    $('perm-deny').onclick = () => done(false);
    dlg.showModal();
  });
}

// ---------- visualizador ----------
const isMobile = () => matchMedia('(max-width: 700px)').matches;

export function renderApp(name, html) {
  $('vista-empty').hidden = true;
  const frame = $('appframe');
  frame.hidden = false;
  frame.srcdoc = html;
  selectTab('vista');
  refreshApps();
  if (isMobile()) flipTo('viz'); // en móvil, saltar a ver la app recién creada
}

// móvil: una sola columna, chat ↔ visualizador conmutables
function flipTo(side) {
  document.body.classList.toggle('show-viz', side === 'viz');
  $('btn-flip').textContent = side === 'viz' ? tr('flipChat') : tr('flipView');
}

// ---------- pestañas ----------
export function selectTab(name) {
  document.querySelectorAll('#tabs button').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p =>
    p.classList.toggle('active', p.id === 'panel-' + name));
  if (name === 'apps') refreshApps();
  if (name === 'tareas') refreshTasks();
  if (name === 'vault') refreshVault();
  if (name === 'permisos') refreshPerms();
  if (name === 'ajustes') refreshSettings();
  if (name === 'skills') refreshSkillsPanel();
}

// Skills en su propia pestaña (visible y descubrible)
export function refreshSkillsPanel() {
  const panel = $('panel-skills');
  panel.replaceChildren(el('h3', null, tr('skillsTitle')));
  panel.appendChild(el('p', 'muted', tr('skillsDesc')));
  renderSkills(panel);
}

function card(...children) {
  const c = document.createElement('div');
  c.className = 'card';
  c.append(...children);
  return c;
}
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (label, cls, onClick) => {
  const b = el('button', cls, label);
  b.onclick = onClick;
  return b;
};

// ---------- panel apps ----------
export async function refreshApps() {
  const list = await apps.allApps();
  const panel = $('panel-apps');
  panel.replaceChildren(el('h3', null, tr('appsTitle')));
  if (!list.length) {
    panel.appendChild(el('p', 'muted', tr('appsEmpty')));
    return;
  }
  for (const app of list) {
    panel.appendChild(card(
      el('b', null, app.name),
      el('span', 'muted', new Date(app.created).toLocaleString(uiLang())),
      btn(tr('open'), 'primary', () => renderApp(app.name, app.html)),
      btn('🗑', 'ghost', async () => { await apps.removeApp({ name: app.name }); refreshApps(); }),
    ));
  }
}

// ---------- panel tareas ----------
export async function refreshTasks() {
  const list = (await db.all('tasks')).sort((a, b) => a.when - b.when);
  const panel = $('panel-tareas');
  panel.replaceChildren(el('h3', null, tr('tasksTitle')));
  if (!list.length) {
    panel.appendChild(el('p', 'muted', tr('tasksEmpty')));
    return;
  }
  for (const t of list) {
    panel.appendChild(card(
      el('span', null, t.done ? '✅' : '⏳'),
      el('b', null, t.prompt),
      el('span', 'muted', new Date(t.when).toLocaleString(uiLang())),
      btn('🗑', 'ghost', async () => { await tasks.removeTask({ id: t.id }); refreshTasks(); }),
    ));
  }
}

// ---------- panel vault ----------
export async function refreshVault() {
  const panel = $('panel-vault');
  panel.replaceChildren(el('h3', null, tr('vaultTitle')));
  const setup = await vault.isSetup();

  if (!vault.isUnlocked()) {
    panel.appendChild(el('p', 'muted', setup ? tr('vaultLocked') : tr('vaultUnset')));
    const input = el('input');
    input.type = 'password';
    input.placeholder = tr('vaultMasterPh');
    const go = btn(setup ? tr('vaultUnlock') : tr('vaultCreate'), 'primary', async () => {
      try { toast(await vault.unlock(input.value)); refreshVault(); }
      catch (e) { toast('⚠️ ' + e.message); }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
    const row = el('div', 'row');
    row.append(input, go);
    panel.appendChild(row);
    return;
  }

  panel.appendChild(btn(tr('vaultLockNow'), 'ghost', () => { vault.lock(); refreshVault(); }));

  const name = el('input');
  name.placeholder = tr('vaultNamePh');
  const secret = el('input');
  secret.type = 'password';
  secret.placeholder = tr('vaultSecretPh');
  const add = btn(tr('save'), 'primary', async () => {
    try {
      toast(await vault.setSecret({ name: name.value.trim(), secret: secret.value }));
      name.value = secret.value = '';
      refreshVault();
    } catch (e) { toast('⚠️ ' + e.message); }
  });
  const row = el('div', 'row');
  row.append(name, secret, add);
  panel.appendChild(row);

  const ks = await db.keys('vault');
  for (const k of ks.filter(k => k.startsWith('s:'))) {
    const n = k.slice(2);
    const val = el('code', null, '••••••');
    panel.appendChild(card(
      el('b', null, n),
      val,
      btn('👁', 'ghost', async () => {
        try { val.textContent = await vault.getSecret({ name: n }); }
        catch (e) { toast('⚠️ ' + e.message); }
      }),
      btn('🗑', 'ghost', async () => { await db.del('vault', k); refreshVault(); }),
    ));
  }
}

// ---------- panel permisos ----------
export async function refreshPerms() {
  const panel = $('panel-permisos');
  panel.replaceChildren(el('h3', null, tr('permsTitle')));
  const g = perms.grants();
  if (!g.length)
    panel.appendChild(el('p', 'muted', tr('permsEmpty')));
  for (const scope of g) {
    const meta = perms.SCOPES[scope] || {};
    panel.appendChild(card(
      el('b', null, `${meta.icon || ''} ${meta.label || scope}`),
      el('span', 'muted', meta.desc || ''),
      btn(tr('revoke'), 'ghost', () => { perms.revoke(scope); refreshPerms(); }),
    ));
  }
  const folders = await fs.folders();
  if (folders.length) {
    panel.appendChild(el('h3', null, tr('foldersTitle')));
    for (const f of folders) {
      panel.appendChild(card(
        el('b', null, '📁 ' + f),
        btn(tr('remove'), 'ghost', async () => { await db.del('fs', f); refreshPerms(); }),
      ));
    }
  }
}

// ---------- progreso y estado del modelo ----------
export function modelProgress(p) {
  const box = $('model-progress');
  if (p == null) { box.hidden = true; return; }
  box.hidden = false;
  if (typeof p === 'string') {
    $('model-progress-text').textContent = p;
    $('model-bar').classList.add('indet');  // sin % conocido → barra animada
    $('model-bar').style.width = '';
    return;
  }
  if (p.status === 'progress' && p.total) {
    const pct = Math.round(p.loaded / p.total * 100);
    $('model-bar').classList.remove('indet');
    $('model-bar').style.width = pct + '%';
    $('model-progress-text').textContent =
      `Descargando modelo · ${pct}% · ${(p.loaded / 1e6 | 0)}/${(p.total / 1e6 | 0)} MB`;
  }
}

export function modelStatus(state) { // 'off' | 'loading' | 'on' | 'gpu'
  $('model-status').className = 'dot ' + state;
}

// ---------- selector de modelo (dinámico) ----------
export function rebuildModelSelect(options, current) {
  const sel = $('model-select');
  sel.replaceChildren();
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  if (current && options.some(o => o.id === current)) sel.value = current;
}

export function setModel(id) { $('model-select').value = id; }


// Consumo en vivo: qué está gastando Elffuss ahora mismo y cómo soltarlo.
// Se refresca solo mientras el panel está abierto.
function usageCard() {
  const card = el('div', 'card col');
  card.appendChild(el('b', null, '📊 ' + tr('useTitle')));
  const ram = el('div', 'row between'), disk = el('div', 'row between'), brain = el('div', 'row between');
  const mk = (row, label) => { row.appendChild(el('span', 'muted', label)); const v = el('span', null, '…'); row.appendChild(v); card.appendChild(row); return v; };
  const vRam = mk(ram, tr('useRam')), vDisk = mk(disk, tr('useDisk')), vBrain = mk(brain, tr('useBrain'));
  const gb = n => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : Math.round(n / 1048576) + ' MB';
  const freeBtn = btn(tr('useFree'), 'ghost', () => { onFreeModelCb(); toast(tr('useFreed')); setTimeout(paint, 400); });
  card.appendChild(freeBtn);
  let timer = null;
  async function paint() {
    const m = performance.memory;
    vRam.textContent = m?.jsHeapSizeLimit
      ? `${gb(m.usedJSHeapSize)} / ${gb(m.jsHeapSizeLimit)} (${Math.round(m.usedJSHeapSize / m.jsHeapSizeLimit * 100)}%)`
      : tr('useNoRam');
    const { usage, quota, persisted } = await cacheEstimate();
    vDisk.textContent = `${gb(usage)}${quota ? ' / ' + gb(quota) : ''} ${persisted ? '· ✓' : '· ⚠'}`;
    const sel = $('model-select');
    vBrain.textContent = sel ? (sel.options[sel.selectedIndex]?.textContent || '—').slice(0, 34) : '—';
    freeBtn.style.display = (sel && sel.value !== 'rules') ? '' : 'none';
    // refrescar solo mientras se está viendo
    clearTimeout(timer);
    if (document.querySelector('#tabs button.active')?.dataset.tab === 'ajustes') timer = setTimeout(paint, 4000);
  }
  paint();
  return card;
}
let onFreeModelCb = () => {};
export function setOnFreeModel(fn) { onFreeModelCb = fn; }

// ---------- espacio de trabajo (carpeta en disco, inventario, limpieza) ----------
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';

function workspaceCard() {
  const card = el('div', 'card col');
  card.appendChild(el('b', null, '💾 ' + tr('wsTitle')));
  card.appendChild(el('span', 'muted', tr('wsDesc')));

  const state = el('div', 'muted');
  const row = el('div', 'row');
  const inv = el('div', 'col');
  card.append(state, row, inv);

  const paint = async () => {
    const st = workspace.status();
    row.replaceChildren();
    state.textContent = !st.supported.pick ? tr('wsNoSupport')
      : !st.folder ? tr('wsNoFolder')
      : st.ready ? tr('wsFolder', { name: st.folder }) + (st.lastSaveAt ? ' · ' + tr('wsSavedAt', { time: new Date(st.lastSaveAt).toLocaleTimeString() }) : '')
      : tr('wsNeedsPerm', { name: st.folder });

    if (st.supported.pick) {
      if (!st.folder) row.appendChild(btn(tr('wsPick'), 'primary', async () => {
        try { await workspace.pick(); toast(tr('wsPicked')); await paint(); } catch (e) { toast('⚠️ ' + e.message); }
      }));
      else if (!st.ready) row.appendChild(btn(tr('wsRegrant'), 'primary', async () => {
        try { await workspace.regrant(); toast(tr('wsPicked')); await paint(); } catch (e) { toast('⚠️ ' + e.message); }
      }));
      else {
        row.appendChild(btn(tr('wsSaveNow'), 'primary', async () => {
          try { const r = await workspace.save({ reason: 'manual' }); toast(r.ok ? tr('wsSaved', { n: r.wrote.length }) : '⚠️ ' + (r.errors[0]?.error || '')); await paint(); }
          catch (e) { toast('⚠️ ' + (e.message === 'needs-regrant' ? tr('wsNeedsPerm', { name: st.folder }) : e.message)); await paint(); }
        }));
        const auto = el('label', 'row');
        const chk = el('input'); chk.type = 'checkbox'; chk.checked = workspace.autosaveEnabled();
        chk.onchange = () => { workspace.autosave({ enabled: chk.checked }); toast(chk.checked ? tr('wsAutoOn') : tr('wsAutoOff')); };
        auto.append(chk, el('span', 'muted', tr('wsAuto')));
        row.appendChild(auto);
        row.appendChild(btn(tr('wsForget'), 'ghost', async () => { await workspace.forget(); await paint(); }));
      }
    }
    // copia descargable: funciona en TODOS los navegadores (Safari/Firefox incluidos)
    row.appendChild(btn(tr('wsDownload'), 'ghost', async () => {
      const blob = await workspace.bundle();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `elffuss-claw-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }));

    // inventario: «ver qué hay» en cada almacén
    inv.replaceChildren(el('b', null, tr('wsWhat')));
    for (const it of await workspace.inventory()) {
      const line = el('div', 'row between');
      line.appendChild(el('span', null, `${it.icon} ${it.label}`));
      line.appendChild(el('span', 'muted', it.error ? '⚠️' : `${it.count} · ${kb(it.bytes)}${it.sensitive ? ' 🔒' : ''}`));
      inv.appendChild(line);
    }
    const danger = el('div', 'row');
    danger.appendChild(btn(tr('wsWipe'), 'ghost', async () => {
      if (!window.confirm(tr('wsWipeConfirm'))) return;
      await workspace.wipe({ confirm: 'BORRAR' });
      toast(tr('wsWiped'));
      await paint();
    }));
    inv.appendChild(danger);
  };
  paint().catch(() => { state.textContent = '—'; });
  return card;
}

// ---------- panel ajustes (config avanzada de proveedores) ----------
export function refreshSettings() {
  const panel = $('panel-ajustes');
  panel.replaceChildren();
  // Lo que se consulta a menudo va PRIMERO: qué está gastando y cómo limpiarlo.
  // Los proveedores externos son configuración avanzada y bajan al final.
  panel.appendChild(usageCard());
  panel.appendChild(workspaceCard());
  // Los modelos EXTERNOS (no locales) van al final, en su propia sección
  // plegada: son la excepción, no la norma — Elffuss corre en tu máquina.
  const ext = document.createElement('details');
  ext.className = 'card col ext-block';
  const extSum = document.createElement('summary');
  extSum.textContent = tr('extTitle');
  ext.appendChild(extSum);
  ext.appendChild(el('p', 'muted', tr('extDesc')));

  const cfgs = settings.configs();
  for (const [id, c] of Object.entries(cfgs)) {
    const wrap = el('div', 'card col');
    const head = el('div', 'row between');
    const title = el('b', null, c.label);
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = c.enabled;
    head.append(title, toggle);
    wrap.appendChild(head);
    wrap.appendChild(el('span', 'muted', c.help || ''));

    const model = el('input');
    model.placeholder = tr('modelPh');
    model.value = c.model || '';
    const base = el('input');
    base.placeholder = tr('endpointPh');
    base.value = c.baseURL || '';
    const key = el('input');
    key.type = 'password';
    key.placeholder = c.kind === 'anthropic' ? 'sk-ant-…' : (id === 'ollama' || id === 'server' ? tr('keyNeeded') : 'sk-…');
    key.value = c.apiKey || '';

    wrap.append(labeled(tr('lblModel'), model), labeled(tr('lblEndpoint'), base));
    if (id !== 'ollama' && id !== 'server') wrap.append(labeled(tr('lblApiKey'), key));

    const save = () => {
      settings.update(id, {
        enabled: toggle.checked,
        model: model.value.trim(),
        baseURL: base.value.trim(),
        apiKey: key.value,
      });
      onSettingsChangedCb();
    };
    toggle.onchange = () => { save(); toast(toggle.checked ? tr('provOn', { label: c.label }) : tr('provOff', { label: c.label })); };
    wrap.appendChild(btn(tr('save'), 'primary', () => { save(); toast(tr('saved')); }));
    ext.appendChild(wrap);
  }

  // --- Almacenamiento del modelo (caché persistente) ---
  const store = el('div', 'card col');
  store.appendChild(el('b', null, tr('storeTitle')));
  const info = el('span', 'muted', tr('storeCalc'));
  store.appendChild(info);
  const clearBtn = btn(tr('storeClear'), 'ghost', async () => {
    info.textContent = tr('storeClearing'); await clearModelCache(); await paintStore(); toast(tr('cacheCleared'));
  });
  store.appendChild(clearBtn);
  panel.appendChild(store);
  async function paintStore() {
    const { usage, quota, persisted } = await cacheEstimate();
    const gb = n => (n / 1073741824).toFixed(2) + ' GB';
    info.textContent = (usage ? tr('storeCached', { gb: gb(usage) }) : tr('storeNone'))
      + (persisted ? tr('storePersist') : tr('storeNoPersist'))
      + (quota ? tr('storeLimit', { gb: gb(quota) }) : '');
  }
  paintStore();

  // --- 📨 Errores y feedback (opt-in — apagado no sale NADA de tu máquina) ---
  const telCard = el('div', 'card col');
  telCard.innerHTML =
    `<b>${tr('telTitle')}</b>` +
    `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:6px">` +
    `<input type="checkbox" id="tel-enabled"> ` +
    `<span>${tr('telAuto')}</span>` +
    `</label>` +
    `<span class="muted">${tr('telPrivacy')}</span>` +
    `<label class="muted" style="font-size:.8em;margin-top:4px">${tr('telManual')}</label>` +
    `<textarea id="tel-feedback" rows="2" style="width:100%;resize:vertical" placeholder="${tr('telPh')}"></textarea>`;
  const telSendBtn = btn(tr('send'), 'primary', async () => {
    const ta = telCard.querySelector('#tel-feedback');
    const text = ta.value.trim();
    if (!text) { toast(tr('writeSomething')); return; }
    const wasEnabled = telemetry.isEnabled();
    if (!wasEnabled) telemetry.setEnabled(true); // envío manual es explícito, se permite aunque el automático esté apagado
    await telemetry.sendFeedback(text);
    if (!wasEnabled) telemetry.setEnabled(false); // no activa el automático de fondo si no lo pidió
    ta.value = '';
    toast(tr('sentThanks'));
  });
  telCard.appendChild(telSendBtn);
  panel.appendChild(telCard);
  panel.appendChild(ext);        // externos: lo último de todo
  telCard.querySelector('#tel-enabled').checked = telemetry.isEnabled();
  telCard.querySelector('#tel-enabled').onchange = e => telemetry.setEnabled(e.target.checked);

  panel.appendChild(el('p', 'muted', tr('skillsTabHint')));
}

async function renderSkills(panel) {
  const inst = skills.installed();
  panel.appendChild(el('div', 'muted', tr('installedN', { n: inst.length })));
  for (const s of inst) {
    const c = el('div', 'card');
    c.append(el('b', null, s.name), el('span', 'muted', s.repo || 'local'),
      btn(tr('remove'), 'ghost', async () => { await skills.remove(s.name); refreshSettings(); }));
    panel.appendChild(c);
  }
  const srcs = await skills.sources();
  for (const src of srcs) {
    const c = el('div', 'card');
    const link = document.createElement('a');
    link.href = 'https://github.com/' + src.repo; link.target = '_blank'; link.textContent = src.repo + ' ↗';
    link.style.cssText = 'color:var(--accent2);font-size:.74rem;text-decoration:none';
    c.append(el('b', null, src.label), link,
      btn('Explorar', 'primary', () => browseSkillRepo(panel, src.repo)));
    panel.appendChild(c);
  }
  const row = el('div', 'row');
  const inp = el('input'); inp.placeholder = tr('repoPh');
  row.append(inp, btn(tr('addRepo'), 'primary', async () => {
    try { await skills.addSource(inp.value); refreshSettings(); } catch (e) { toast('⚠️ ' + e.message); }
  }));
  panel.appendChild(row);
}

async function browseSkillRepo(panel, repo) {
  const box = el('div');
  box.appendChild(el('div', 'muted', tr('loadingRepo', { repo })));
  panel.appendChild(box);
  try {
    const found = await skills.listFromRepo(repo);
    box.replaceChildren(el('div', 'muted', tr('repoSkills', { repo, n: found.length })));
    for (const sk of found.slice(0, 120)) {
      const c = el('div', 'card');
      const on = skills.isInstalled(sk.repo, sk.path);
      const b = btn(on ? tr('installedOk') : tr('install'), on ? 'ghost' : 'primary', async () => {
        b.textContent = '…';
        try {
          const entry = await skills.installFromRepo(sk);
          b.textContent = tr('installedOk');
          onSkillInstalledCb(entry);           // → mensaje «cómo usarla» en el chat
        } catch (e) { b.textContent = tr('install'); toast('⚠️ ' + e.message); }
      });
      c.append(el('b', null, sk.name), el('span', 'muted', sk.dir), b);
      box.appendChild(c);
    }
  } catch (e) { box.replaceChildren(el('div', 'muted', '⚠️ ' + e.message)); }
}

function labeled(label, input) {
  const row = el('label', 'field');
  row.append(el('span', 'muted', label), input);
  return row;
}

// ---------- arranque ----------
export function init({ onSend, onModelChange, onSettingsChanged }) {
  perms.setAsker(askPermission);
  apps.setRenderer(renderApp);
  onSettingsChangedCb = onSettingsChanged || (() => {});
  // al instalar una skill: mensaje «cómo usarla» en el chat + volver al chat en móvil
  onSkillInstalledCb = entry => {
    addMsg('assistant', skills.usageMessage(entry)); // addMsg renderiza markdown en 'assistant'
    if (isMobile()) flipTo('chat');
  };

  // Historial del prompt: ↑/↓ recuperan lo enviado (como una shell). Persistente.
  const HKEY = 'elffuss.promptHistory';
  let hist = []; try { hist = JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch { /* corrupto */ }
  let hIdx = -1, draft = '';
  $('prompt').addEventListener('keydown', e => {
    if (!$('cmd-menu').hidden) return;             // el menú «/» ya usa ↑/↓
    const inp = e.target;
    if (e.key === 'ArrowUp') {
      if (!hist.length) return;
      if (hIdx === -1) { draft = inp.value; hIdx = hist.length; }
      hIdx = Math.max(0, hIdx - 1); inp.value = hist[hIdx]; e.preventDefault();
      requestAnimationFrame(() => inp.setSelectionRange(inp.value.length, inp.value.length));
    } else if (e.key === 'ArrowDown') {
      if (hIdx === -1) return;
      hIdx++; inp.value = hIdx >= hist.length ? (hIdx = -1, draft) : hist[hIdx]; e.preventDefault();
    }
  });
  $('composer').addEventListener('submit', e => {
    e.preventDefault();
    const text = $('prompt').value.trim();
    if (!text) return;
    $('prompt').value = '';
    if (hist[hist.length - 1] !== text) hist.push(text);
    if (hist.length > 100) hist = hist.slice(-100);
    try { localStorage.setItem(HKEY, JSON.stringify(hist)); } catch { /* lleno */ }
    hIdx = -1; draft = '';
    onSend(text);
  });
  document.querySelectorAll('#chips .chip').forEach(c =>
    c.addEventListener('click', () => onSend(c.textContent)));
  document.querySelectorAll('#tabs button').forEach(b =>
    b.addEventListener('click', () => selectTab(b.dataset.tab)));
  $('btn-perms').addEventListener('click', () => { selectTab('permisos'); if (isMobile()) flipTo('viz'); });
  $('model-select').addEventListener('change', e => onModelChange(e.target.value));
  $('btn-flip').addEventListener('click', () =>
    flipTo(document.body.classList.contains('show-viz') ? 'chat' : 'viz'));

  // iconos vectoriales (sin emojis)
  $('model-ico').innerHTML = UI.code;
  $('btn-clear').innerHTML = UI.clear;
  $('send').innerHTML = UI.send;
  $('btn-slash').innerHTML = UI.slash;

  // menú de comandos (/) en el chat, estilo plugin de Claude Code
  const cmds = [
    { label: '/reloj', hint: tr('cmClock'), run: () => onSend(tr('pClock')) },
    { label: '/carpeta', hint: tr('cmFolder'), run: () => onSend(tr('pFolder')) },
    { label: '/skills', hint: tr('cmSkills'), run: () => { selectTab('skills'); if (isMobile()) flipTo('viz'); } },
    { label: '/modelo', hint: tr('cmModel'), run: () => { selectTab('ajustes'); if (isMobile()) flipTo('viz'); } },
    { label: '/tareas', hint: tr('cmTasks'), run: () => { selectTab('tareas'); if (isMobile()) flipTo('viz'); } },
    { label: '/vault', hint: tr('cmVault'), run: () => { selectTab('vault'); if (isMobile()) flipTo('viz'); } },
    { label: '/limpiar', hint: tr('cmClear'), run: () => $('btn-clear').click() },
  ];
  const cmdMenu = $('cmd-menu');
  const openCmd = () => {
    cmdMenu.replaceChildren();
    for (const c of cmds) {
      const row = document.createElement('button');
      row.className = 'cmd-item';
      row.innerHTML = `<b>${c.label}</b><span>${c.hint}</span>`;
      row.onclick = () => { cmdMenu.hidden = true; c.run(); };
      cmdMenu.appendChild(row);
    }
    cmdMenu.hidden = false;
  };
  $('btn-slash').addEventListener('click', () => cmdMenu.hidden ? openCmd() : (cmdMenu.hidden = true));
  $('prompt').addEventListener('input', e => {
    if (e.target.value === '/') openCmd(); else if (cmdMenu && !cmdMenu.hidden && !e.target.value.startsWith('/')) cmdMenu.hidden = true;
  });
  document.addEventListener('click', e => { if (!e.target.closest('#cmd-menu, #btn-slash, #prompt')) cmdMenu.hidden = true; });
}

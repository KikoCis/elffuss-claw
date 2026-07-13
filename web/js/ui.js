// UI: chat + visualizador + paneles. Todo el DOM vive aquí.
import * as db from './db.js';
import * as perms from './permissions.js';
import * as settings from './settings.js';
import * as skills from './skills.js';
import { fs, apps, vault, tasks } from './tools/index.js';
import { renderMarkdown } from './md.js';
import { UI } from './icons.js';

let onSettingsChangedCb = () => {};

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
  label.textContent = 'Elffuss está pensando';
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
      label.textContent = `Elffuss está escribiendo · ${buf.length}`;
      gen.textContent = (buf.length > 240 ? '…' : '') + buf.slice(-240);
      $('log').scrollTop = $('log').scrollHeight;
    },
    tool(name) {
      buf = '';
      gen.textContent = '';
      label.textContent = `Elffuss está usando ${name}`;
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
    $('perm-title').textContent = `${meta?.icon || '❓'} Permiso: ${meta?.label || scope}`;
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
  $('btn-flip').textContent = side === 'viz' ? '💬 Chat' : '✳ Vista';
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
  panel.replaceChildren(el('h3', null, 'Skills de Claude Code'));
  panel.appendChild(el('p', 'muted',
    'Instala instrucciones especializadas (SKILL.md) y plugins desde repos públicos: ' +
    'anthropics/skills (oficial), claude-plugins-official, o cualquier repo (comunidad tipo OpenClaude). ' +
    'Se ve el repo y lo que se inyecta; todo se guarda en tu navegador.'));
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
  panel.replaceChildren(el('h3', null, 'Apps creadas'));
  if (!list.length) {
    panel.appendChild(el('p', 'muted', 'Ninguna aún. Pídele una a Elffuss.'));
    return;
  }
  for (const app of list) {
    panel.appendChild(card(
      el('b', null, app.name),
      el('span', 'muted', new Date(app.created).toLocaleString('es-ES')),
      btn('Abrir', 'primary', () => renderApp(app.name, app.html)),
      btn('🗑', 'ghost', async () => { await apps.removeApp({ name: app.name }); refreshApps(); }),
    ));
  }
}

// ---------- panel tareas ----------
export async function refreshTasks() {
  const list = (await db.all('tasks')).sort((a, b) => a.when - b.when);
  const panel = $('panel-tareas');
  panel.replaceChildren(el('h3', null, 'Tareas programadas'));
  if (!list.length) {
    panel.appendChild(el('p', 'muted', 'Ninguna. Prueba «recuérdame dentro de 5 minutos…».'));
    return;
  }
  for (const t of list) {
    panel.appendChild(card(
      el('span', null, t.done ? '✅' : '⏳'),
      el('b', null, t.prompt),
      el('span', 'muted', new Date(t.when).toLocaleString('es-ES')),
      btn('🗑', 'ghost', async () => { await tasks.removeTask({ id: t.id }); refreshTasks(); }),
    ));
  }
}

// ---------- panel vault ----------
export async function refreshVault() {
  const panel = $('panel-vault');
  panel.replaceChildren(el('h3', null, '🔐 Vault'));
  const setup = await vault.isSetup();

  if (!vault.isUnlocked()) {
    panel.appendChild(el('p', 'muted', setup
      ? 'Bloqueado. Introduce tu contraseña maestra.'
      : 'Sin crear. Elige una contraseña maestra (no hay recuperación posible).'));
    const input = el('input');
    input.type = 'password';
    input.placeholder = 'Contraseña maestra';
    const go = btn(setup ? 'Desbloquear' : 'Crear vault', 'primary', async () => {
      try { toast(await vault.unlock(input.value)); refreshVault(); }
      catch (e) { toast('⚠️ ' + e.message); }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
    const row = el('div', 'row');
    row.append(input, go);
    panel.appendChild(row);
    return;
  }

  panel.appendChild(btn('🔒 Bloquear ahora', 'ghost', () => { vault.lock(); refreshVault(); }));

  const name = el('input');
  name.placeholder = 'nombre (p. ej. gmail)';
  const secret = el('input');
  secret.type = 'password';
  secret.placeholder = 'secreto';
  const add = btn('Guardar', 'primary', async () => {
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
  panel.replaceChildren(el('h3', null, 'Permisos concedidos'));
  const g = perms.grants();
  if (!g.length)
    panel.appendChild(el('p', 'muted', 'Ninguno. Elffuss pedirá permiso la primera vez que necesite algo.'));
  for (const scope of g) {
    const meta = perms.SCOPES[scope] || {};
    panel.appendChild(card(
      el('b', null, `${meta.icon || ''} ${meta.label || scope}`),
      el('span', 'muted', meta.desc || ''),
      btn('Revocar', 'ghost', () => { perms.revoke(scope); refreshPerms(); }),
    ));
  }
  const folders = await fs.folders();
  if (folders.length) {
    panel.appendChild(el('h3', null, 'Carpetas autorizadas'));
    for (const f of folders) {
      panel.appendChild(card(
        el('b', null, '📁 ' + f),
        btn('Quitar', 'ghost', async () => { await db.del('fs', f); refreshPerms(); }),
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

// ---------- panel ajustes (config avanzada de proveedores) ----------
export function refreshSettings() {
  const panel = $('panel-ajustes');
  panel.replaceChildren(el('h3', null, '⚙️ Modelos y configuración avanzada'));
  panel.appendChild(el('p', 'muted',
    'Elffuss corre en tu navegador por defecto. Aquí puedes conectar modelos externos ' +
    '(opcional). Las claves se guardan solo en este navegador y las llamadas van directas ' +
    'al proveedor — nada pasa por nuestros servidores.'));

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
    model.placeholder = 'modelo';
    model.value = c.model || '';
    const base = el('input');
    base.placeholder = 'endpoint';
    base.value = c.baseURL || '';
    const key = el('input');
    key.type = 'password';
    key.placeholder = c.kind === 'anthropic' ? 'sk-ant-…' : (id === 'ollama' || id === 'server' ? 'clave (no necesaria)' : 'sk-…');
    key.value = c.apiKey || '';

    wrap.append(labeled('Modelo', model), labeled('Endpoint', base));
    if (id !== 'ollama' && id !== 'server') wrap.append(labeled('API key', key));

    const save = () => {
      settings.update(id, {
        enabled: toggle.checked,
        model: model.value.trim(),
        baseURL: base.value.trim(),
        apiKey: key.value,
      });
      onSettingsChangedCb();
    };
    toggle.onchange = () => { save(); toast(toggle.checked ? `${c.label} activado — elígelo en el selector 🧠` : `${c.label} desactivado`); };
    wrap.appendChild(btn('Guardar', 'primary', () => { save(); toast('Guardado'); }));
    panel.appendChild(wrap);
  }

  panel.appendChild(el('p', 'muted', 'Las skills y plugins están en su propia pestaña «Skills».'));
}

async function renderSkills(panel) {
  const inst = skills.installed();
  panel.appendChild(el('div', 'muted', `Instaladas: ${inst.length}`));
  for (const s of inst) {
    const c = el('div', 'card');
    c.append(el('b', null, s.name), el('span', 'muted', s.repo || 'local'),
      btn('Quitar', 'ghost', async () => { await skills.remove(s.name); refreshSettings(); }));
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
  const inp = el('input'); inp.placeholder = 'owner/repo o URL (p. ej. OpenClaude/…)';
  row.append(inp, btn('Añadir repo', 'primary', async () => {
    try { await skills.addSource(inp.value); refreshSettings(); } catch (e) { toast('⚠️ ' + e.message); }
  }));
  panel.appendChild(row);
}

async function browseSkillRepo(panel, repo) {
  const box = el('div');
  box.appendChild(el('div', 'muted', `Cargando ${repo}…`));
  panel.appendChild(box);
  try {
    const found = await skills.listFromRepo(repo);
    box.replaceChildren(el('div', 'muted', `${repo} — ${found.length} skills`));
    for (const sk of found.slice(0, 120)) {
      const c = el('div', 'card');
      const on = skills.isInstalled(sk.repo, sk.path);
      const b = btn(on ? 'Instalada ✓' : 'Instalar', on ? 'ghost' : 'primary', async () => {
        b.textContent = '…';
        try { await skills.installFromRepo(sk); b.textContent = 'Instalada ✓'; } catch (e) { b.textContent = 'Instalar'; toast('⚠️ ' + e.message); }
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

  $('composer').addEventListener('submit', e => {
    e.preventDefault();
    const text = $('prompt').value.trim();
    if (!text) return;
    $('prompt').value = '';
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
    { label: '/reloj', hint: 'crear un reloj', run: () => onSend('hazme un reloj') },
    { label: '/carpeta', hint: 'autorizar una carpeta', run: () => onSend('autoriza una carpeta') },
    { label: '/skills', hint: 'gestionar skills y plugins', run: () => { selectTab('skills'); if (isMobile()) flipTo('viz'); } },
    { label: '/modelo', hint: 'modelo y API keys', run: () => { selectTab('ajustes'); if (isMobile()) flipTo('viz'); } },
    { label: '/tareas', hint: 'ver tareas programadas', run: () => { selectTab('tareas'); if (isMobile()) flipTo('viz'); } },
    { label: '/vault', hint: 'secretos cifrados', run: () => { selectTab('vault'); if (isMobile()) flipTo('viz'); } },
    { label: '/limpiar', hint: 'nueva conversación', run: () => $('btn-clear').click() },
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

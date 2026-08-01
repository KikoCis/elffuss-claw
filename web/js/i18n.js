// i18n ligero de la UI estática. La elfa ya responde en el idioma del
// navegador; esto traduce el "chrome" (pestañas, chips, textos). Se aplica por
// selector para no ensuciar el HTML. Idiomas principales; fallback a inglés.
const L = {
  es: {
    welcome: 'Un sistema operativo con alma que vive en tu navegador. Aquí las apps no se instalan: se crean cuando las pides y aparecen a la derecha. Puedo usar tus carpetas (si me das permiso), guardar secretos cifrados, programar tareas y navegar por ti. Todo se queda en tu máquina.',
    hi: 'Привіт, soy Elffuss.',
    chips: ['Hazme un reloj', 'Crea una app de notas', 'Autoriza una carpeta', 'Recuérdame en 1 minuto que estire', 'Abre https://example.com'],
    tabs: { vista: 'Vista', apps: 'Apps', tareas: 'Tareas', vault: 'Bóveda', skills: 'Skills', permisos: 'Permisos', ajustes: 'Ajustes' },
    ph: 'Pídeme lo que necesites…  (/ para comandos)',
    perms: 'Permisos', empty: 'Aquí aparece lo que Elffuss crea.', tryit: 'Prueba: «hazme un reloj»',
    s1: 'Un sistema operativo con alma que vive aquí, en tu navegador.',
    s2: 'Todo lo que pase entre nosotros ocurre solo en tu ordenador.',
    s3: 'Nadie lo registra. Nada sale de tu máquina.', s4: 'Queda entre tú y yo…', enter: 'Entrar',
    // runtime (chat, estado del modelo, payoff): sustitución {var}
    thinking: 'Elffuss está pensando', writing: 'Elffuss está escribiendo · {n}', using: 'Elffuss está usando {name}',
    modelReady: 'Modelo IA listo · {where}', whereGpu: 'WebGPU local', whereCpu: 'CPU/wasm local', whereExt: 'externo',
    done: '¡Listo! {result} ¿Quieres que le cambie algo?',
    appCreated: 'App «{name}» creada y abierta en el visualizador.', appOpened: 'App «{name}» abierta.',
    appNone: 'Aún no has creado ninguna app.', appRemoved: 'App «{name}» eliminada.',
    anythingElse: 'Hecho. ¿Algo más?', mindTitle: 'MENTE DE ELFFUSS',
    // paneles / botones / toasts / menú
    open: 'Abrir', save: 'Guardar', saved: 'Guardado', remove: 'Quitar', revoke: 'Revocar',
    appsTitle: 'Apps creadas', appsEmpty: 'Ninguna aún. Pídele una a Elffuss.',
    tasksTitle: 'Tareas programadas', tasksEmpty: 'Ninguna. Prueba «recuérdame dentro de 5 minutos…».',
    vaultTitle: '🔐 Bóveda', vaultLocked: 'Bloqueado. Introduce tu contraseña maestra.',
    vaultUnset: 'Sin crear. Elige una contraseña maestra (no hay recuperación posible).',
    vaultMasterPh: 'Contraseña maestra', vaultUnlock: 'Desbloquear', vaultCreate: 'Crear bóveda',
    vaultLockNow: '🔒 Bloquear ahora', vaultNamePh: 'nombre (p. ej. gmail)', vaultSecretPh: 'secreto',
    permsTitle: 'Permisos concedidos', permsEmpty: 'Ninguno. Elffuss pedirá permiso la primera vez que necesite algo.',
    foldersTitle: 'Carpetas autorizadas',
    skillsTitle: 'Skills de Claude Code',
    skillsDesc: 'Instala instrucciones especializadas (SKILL.md) y plugins desde repos públicos: anthropics/skills (oficial), claude-plugins-official, o cualquier repo (comunidad tipo OpenClaude). Se ve el repo y lo que se inyecta; todo se guarda en tu navegador.',
    skillsTabHint: 'Las skills y plugins están en su propia pestaña «Skills».',
    installedN: 'Instaladas: {n}', repoPh: 'owner/repo o URL (p. ej. OpenClaude/…)', addRepo: 'Añadir repo',
    loadingRepo: 'Cargando {repo}…', repoSkills: '{repo} — {n} skills', installedOk: 'Instalada ✓', install: 'Instalar',
    settingsTitle: '⚙️ Modelos y configuración avanzada',
    settingsDesc: 'Elffuss corre en tu navegador por defecto. Aquí puedes conectar modelos externos (opcional). Las claves se guardan solo en este navegador y las llamadas van directas al proveedor — nada pasa por nuestros servidores.',
    modelPh: 'modelo', endpointPh: 'endpoint', lblModel: 'Modelo', lblEndpoint: 'Endpoint', lblApiKey: 'API key',
    keyNeeded: 'clave (no necesaria)', provOn: '{label} activado — elígelo en el selector 🧠', provOff: '{label} desactivado',
    storeTitle: 'Modelo descargado (cacheado en tu navegador)', storeCalc: 'Calculando espacio…',
    storeClear: 'Vaciar caché del modelo', storeClearing: 'Vaciando…', cacheCleared: 'Caché vaciada',
    storeCached: '{gb} en caché · ', storeNone: 'Nada cacheado todavía · ',
    storePersist: '✓ persistente (no se borra solo)', storeNoPersist: '⚠ sin persistencia', storeLimit: ' · límite ~{gb}',
    telTitle: '📨 Errores y feedback',
    telAuto: 'Enviar automáticamente los errores técnicos que ocurran, para poder arreglarlos',
    telPrivacy: 'Apagado por defecto — tu conversación y el contenido de tus apps/archivos NUNCA se incluyen, solo el mensaje de error técnico, la pila y datos del navegador.',
    telManual: 'O manda algo tú directamente (un fallo que viste, algo que eches en falta…)',
    telPh: 'Cuéntanos qué ha pasado o qué te gustaría que hiciera…', send: 'Enviar',
    writeSomething: 'escribe algo primero', sentThanks: '¡enviado, gracias!',
    flipChat: '💬 Chat', flipView: '✳ Vista',
    cmClock: 'crear un reloj', cmFolder: 'autorizar una carpeta', cmSkills: 'gestionar skills y plugins',
    cmModel: 'modelo y API keys', cmTasks: 'ver tareas programadas', cmVault: 'secretos cifrados', cmClear: 'nueva conversación',
    pClock: 'hazme un reloj', pFolder: 'autoriza una carpeta',
    // permisos (modal + panel + detalles por tool)
    permWord: 'Permiso', permDeny: 'Denegar', permAllow: 'Permitir',
    permDenied: 'Permiso «{label}» denegado por el usuario',
    scFsL: 'Archivos', scFsD: 'Leer y escribir en las carpetas que autorices',
    scAppsL: 'Apps', scAppsD: 'Crear y mostrar apps HTML en el visualizador',
    scVaultL: 'Bóveda', scVaultD: 'Guardar y leer secretos cifrados',
    scTasksL: 'Tareas', scTasksD: 'Programar tareas que se ejecutan solas',
    scWebL: 'Internet', scWebD: 'Visitar páginas web en tu nombre',
    scMemL: 'Memoria', scMemD: 'Recordar cosas de ti entre sesiones (solo en este navegador)',
    pdApp: 'Crear la app «{name}» y mostrarla en el visualizador',
    pdPickFolder: 'Elegir una carpeta de tu ordenador para trabajar en ella',
    pdVaultSet: 'Guardar el secreto «{name}»', pdVaultGet: 'Leer el secreto «{name}»',
    pdWatch: 'Vigilar «{from}» y dejar lo procesado en «{to}»',
    pdWebSearch: 'buscar: {q}', pdWebImages: 'imágenes: {q}',
  },
  en: {
    welcome: 'An operating system with a soul that lives in your browser. Here apps aren’t installed: they’re created when you ask, appearing on the right. I can use your folders (with permission), store encrypted secrets, schedule tasks and browse for you. Everything stays on your machine.',
    hi: 'Привіт, I’m Elffuss.',
    chips: ['Make me a clock', 'Create a notes app', 'Authorize a folder', 'Remind me in 1 minute to stretch', 'Open https://example.com'],
    tabs: { vista: 'View', apps: 'Apps', tareas: 'Tasks', vault: 'Vault', skills: 'Skills', permisos: 'Permissions', ajustes: 'Settings' },
    ph: 'Ask me anything…  (/ for commands)',
    perms: 'Permissions', empty: 'Whatever Elffuss creates shows up here.', tryit: 'Try: “make me a clock”',
    s1: 'An operating system with a soul that lives here, in your browser.',
    s2: 'Everything between us happens only on your computer.',
    s3: 'No one logs it. Nothing leaves your machine.', s4: 'It stays between you and me…', enter: 'Enter',
    thinking: 'Elffuss is thinking', writing: 'Elffuss is writing · {n}', using: 'Elffuss is using {name}',
    modelReady: 'AI model ready · {where}', whereGpu: 'WebGPU local', whereCpu: 'CPU/wasm local', whereExt: 'external',
    done: 'Done! {result} Want me to tweak anything?',
    appCreated: 'App “{name}” created and opened in the viewer.', appOpened: 'App “{name}” opened.',
    appNone: 'You haven’t created any apps yet.', appRemoved: 'App “{name}” deleted.',
    anythingElse: 'Done. Anything else?', mindTitle: 'ELFFUSS MIND',
    open: 'Open', save: 'Save', saved: 'Saved', remove: 'Remove', revoke: 'Revoke',
    appsTitle: 'Apps created', appsEmpty: 'None yet. Ask Elffuss for one.',
    tasksTitle: 'Scheduled tasks', tasksEmpty: 'None. Try “remind me in 5 minutes…”.',
    vaultTitle: '🔐 Vault', vaultLocked: 'Locked. Enter your master password.',
    vaultUnset: 'Not set up. Choose a master password (there’s no recovery).',
    vaultMasterPh: 'Master password', vaultUnlock: 'Unlock', vaultCreate: 'Create vault',
    vaultLockNow: '🔒 Lock now', vaultNamePh: 'name (e.g. gmail)', vaultSecretPh: 'secret',
    permsTitle: 'Granted permissions', permsEmpty: 'None. Elffuss will ask the first time it needs something.',
    foldersTitle: 'Authorized folders',
    skillsTitle: 'Claude Code skills',
    skillsDesc: 'Install specialized instructions (SKILL.md) and plugins from public repos: anthropics/skills (official), claude-plugins-official, or any repo (community, e.g. OpenClaude). You can see the repo and what gets injected; everything is stored in your browser.',
    skillsTabHint: 'Skills and plugins live in their own “Skills” tab.',
    installedN: 'Installed: {n}', repoPh: 'owner/repo or URL (e.g. OpenClaude/…)', addRepo: 'Add repo',
    loadingRepo: 'Loading {repo}…', repoSkills: '{repo} — {n} skills', installedOk: 'Installed ✓', install: 'Install',
    settingsTitle: '⚙️ Models & advanced settings',
    settingsDesc: 'Elffuss runs in your browser by default. Here you can connect external models (optional). Keys are stored only in this browser and calls go straight to the provider — nothing passes through our servers.',
    modelPh: 'model', endpointPh: 'endpoint', lblModel: 'Model', lblEndpoint: 'Endpoint', lblApiKey: 'API key',
    keyNeeded: 'key (not needed)', provOn: '{label} enabled — pick it in the selector 🧠', provOff: '{label} disabled',
    storeTitle: 'Downloaded model (cached in your browser)', storeCalc: 'Calculating space…',
    storeClear: 'Clear model cache', storeClearing: 'Clearing…', cacheCleared: 'Cache cleared',
    storeCached: '{gb} cached · ', storeNone: 'Nothing cached yet · ',
    storePersist: '✓ persistent (won’t be auto-cleared)', storeNoPersist: '⚠ not persistent', storeLimit: ' · limit ~{gb}',
    telTitle: '📨 Errors & feedback',
    telAuto: 'Automatically send technical errors that occur, so we can fix them',
    telPrivacy: 'Off by default — your conversation and the contents of your apps/files are NEVER included, only the technical error message, stack and browser data.',
    telManual: 'Or send something yourself (a bug you saw, something you’re missing…)',
    telPh: 'Tell us what happened or what you’d like it to do…', send: 'Send',
    writeSomething: 'write something first', sentThanks: 'sent, thank you!',
    flipChat: '💬 Chat', flipView: '✳ View',
    cmClock: 'make a clock', cmFolder: 'authorize a folder', cmSkills: 'manage skills & plugins',
    cmModel: 'model & API keys', cmTasks: 'see scheduled tasks', cmVault: 'encrypted secrets', cmClear: 'new conversation',
    pClock: 'make me a clock', pFolder: 'authorize a folder',
    permWord: 'Permission', permDeny: 'Deny', permAllow: 'Allow',
    permDenied: 'Permission “{label}” denied by the user',
    scFsL: 'Files', scFsD: 'Read and write in the folders you authorize',
    scAppsL: 'Apps', scAppsD: 'Create and show HTML apps in the viewer',
    scVaultL: 'Vault', scVaultD: 'Store and read encrypted secrets',
    scTasksL: 'Tasks', scTasksD: 'Schedule tasks that run on their own',
    scWebL: 'Internet', scWebD: 'Visit web pages on your behalf',
    scMemL: 'Memory', scMemD: 'Remember things about you across sessions (only in this browser)',
    pdApp: 'Create the app “{name}” and show it in the viewer',
    pdPickFolder: 'Pick a folder on your computer to work in',
    pdVaultSet: 'Store the secret “{name}”', pdVaultGet: 'Read the secret “{name}”',
    pdWatch: 'Watch “{from}” and drop the processed output in “{to}”',
    pdWebSearch: 'search: {q}', pdWebImages: 'images: {q}',
  },
  uk: {
    welcome: 'Операційна система з душею, що живе у твоєму браузері. Тут застосунки не встановлюють — їх створюють на твій запит, і вони з’являються праворуч. Можу працювати з твоїми теками (за дозволом), зберігати зашифровані секрети, планувати завдання й гортати за тебе. Усе лишається на твоєму пристрої.',
    hi: 'Привіт, я Elffuss.',
    chips: ['Зроби мені годинник', 'Створи застосунок нотаток', 'Дозволь теку', 'Нагадай за 1 хв розім’ятися', 'Відкрий https://example.com'],
    tabs: { vista: 'Вигляд', apps: 'Застосунки', tareas: 'Завдання', vault: 'Сейф', skills: 'Навички', permisos: 'Дозволи', ajustes: 'Налаштування' },
    ph: 'Проси що завгодно…  (/ для команд)',
    perms: 'Дозволи', empty: 'Тут з’являється те, що створює Elffuss.', tryit: 'Спробуй: «зроби годинник»',
    s1: 'Операційна система з душею, що живе тут, у твоєму браузері.',
    s2: 'Усе між нами відбувається лише на твоєму комп’ютері.',
    s3: 'Ніхто не записує. Ніщо не покидає твій пристрій.', s4: 'Це лишається між нами…', enter: 'Увійти',
  },
  fr: {
    welcome: 'Un système d’exploitation avec une âme qui vit dans ton navigateur. Ici les apps ne s’installent pas : elles se créent quand tu les demandes, à droite. Je peux utiliser tes dossiers (avec permission), garder des secrets chiffrés, planifier des tâches et naviguer pour toi. Tout reste sur ta machine.',
    hi: 'Привіт, je suis Elffuss.',
    chips: ['Fais-moi une horloge', 'Crée une app de notes', 'Autorise un dossier', 'Rappelle-moi dans 1 min de m’étirer', 'Ouvre https://example.com'],
    tabs: { vista: 'Vue', apps: 'Apps', tareas: 'Tâches', vault: 'Coffre', skills: 'Skills', permisos: 'Permissions', ajustes: 'Réglages' },
    ph: 'Demande-moi ce que tu veux…  (/ pour les commandes)',
    perms: 'Permissions', empty: 'Ce qu’Elffuss crée apparaît ici.', tryit: 'Essaie : « fais-moi une horloge »',
    s1: 'Un système d’exploitation avec une âme, ici, dans ton navigateur.',
    s2: 'Tout ce qui se passe entre nous reste sur ton ordinateur.',
    s3: 'Personne ne l’enregistre. Rien ne quitte ta machine.', s4: 'Ça reste entre toi et moi…', enter: 'Entrer',
  },
  de: {
    welcome: 'Ein Betriebssystem mit Seele, das in deinem Browser lebt. Apps werden hier nicht installiert – sie entstehen, wenn du fragst, und erscheinen rechts. Ich kann deine Ordner nutzen (mit Erlaubnis), verschlüsselte Geheimnisse speichern, Aufgaben planen und für dich surfen. Alles bleibt auf deinem Gerät.',
    hi: 'Привіт, ich bin Elffuss.',
    chips: ['Bau mir eine Uhr', 'Erstelle eine Notiz-App', 'Ordner freigeben', 'Erinnere mich in 1 Min ans Strecken', 'Öffne https://example.com'],
    tabs: { vista: 'Ansicht', apps: 'Apps', tareas: 'Aufgaben', vault: 'Tresor', skills: 'Skills', permisos: 'Rechte', ajustes: 'Einstellungen' },
    ph: 'Frag mich alles…  (/ für Befehle)',
    perms: 'Rechte', empty: 'Was Elffuss erstellt, erscheint hier.', tryit: 'Versuch: „bau mir eine Uhr“',
    s1: 'Ein Betriebssystem mit Seele, hier, in deinem Browser.',
    s2: 'Alles zwischen uns passiert nur auf deinem Computer.',
    s3: 'Niemand protokolliert es. Nichts verlässt dein Gerät.', s4: 'Es bleibt unter uns…', enter: 'Eintreten',
  },
  pt: {
    welcome: 'Um sistema operativo com alma que vive no teu navegador. Aqui as apps não se instalam: criam-se quando pedes e aparecem à direita. Posso usar as tuas pastas (com permissão), guardar segredos cifrados, agendar tarefas e navegar por ti. Tudo fica na tua máquina.',
    hi: 'Привіт, sou a Elffuss.',
    chips: ['Faz-me um relógio', 'Cria uma app de notas', 'Autoriza uma pasta', 'Lembra-me em 1 min de me esticar', 'Abre https://example.com'],
    tabs: { vista: 'Vista', apps: 'Apps', tareas: 'Tarefas', vault: 'Cofre', skills: 'Skills', permisos: 'Permissões', ajustes: 'Definições' },
    ph: 'Pede-me o que precisares…  (/ para comandos)',
    perms: 'Permissões', empty: 'O que a Elffuss cria aparece aqui.', tryit: 'Tenta: «faz-me um relógio»',
    s1: 'Um sistema operativo com alma que vive aqui, no teu navegador.',
    s2: 'Tudo o que passa entre nós acontece só no teu computador.',
    s3: 'Ninguém o regista. Nada sai da tua máquina.', s4: 'Fica entre ti e mim…', enter: 'Entrar',
  },
};

// Idioma del chrome (mismos criterios que applyI18n): 2 letras, ES por defecto.
export function uiLang() {
  return (navigator.language || 'es').slice(0, 2).toLowerCase();
}

// Traduce un string de runtime del chrome con sustitución {var}. Fallback:
// idioma → inglés → la propia clave. La elfa ya responde en el idioma del
// navegador; esto localiza los textos que pinta la UI (pensando, modelo listo,
// el «¡Listo!» del payoff, los resultados de app.*).
export function t(key, vars) {
  const s = (L[uiLang()] || L.en)[key] ?? L.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s;
}

export function applyI18n() {
  const code = uiLang();
  const t = L[code] || L.en;
  const $ = s => document.querySelector(s);
  const set = (sel, txt) => { const e = $(sel); if (e && txt) e.textContent = txt; };

  document.documentElement.lang = code;
  const sys = $('.msg.sys');
  if (sys) {
    // Reconstruir el saludo entero: el welcome del HTML mezcla nodos de texto
    // con un <i>se crean</i>, así que limpiar solo los text-nodes dejaba ese
    // fragmento español y salía «Привіт, I'm Elffuss.se crean An operating…».
    // replaceChildren() vacía TODO; conservamos el avatar y ponemos <b>hi</b> welcome.
    const avatar = sys.querySelector('.avatar');
    sys.replaceChildren();
    if (avatar) sys.append(avatar);
    const b = document.createElement('b');
    b.textContent = t.hi;
    sys.append(b, ' ' + t.welcome);
  }
  document.querySelectorAll('#chips .chip').forEach((c, i) => { if (t.chips[i]) c.textContent = t.chips[i]; });
  document.querySelectorAll('#tabs button').forEach(b => { const k = b.dataset.tab; if (t.tabs[k]) b.textContent = t.tabs[k]; });
  const ph = $('#prompt'); if (ph) ph.placeholder = t.ph;
  set('#btn-perms', t.perms);
  set('#vista-empty p', t.empty); // simplifica: solo la 1ª línea
  const emptyP = $('#vista-empty p'); if (emptyP) emptyP.innerHTML = `${t.empty}<br><i>${t.tryit}</i>`;
  set('#splash .l1', t.s1); set('#splash .l2', t.s2); set('#splash .l3', t.s3);
  const s4 = $('#splash .l4'); if (s4) s4.textContent = t.s4 + ' 😉';
  set('#splash-enter', t.enter + ' ✳'.replace(' ✳', ''));
  set('#splash-enter', t.enter);
  const h1 = $('#splash h1'); if (h1) h1.innerHTML = t.hi.replace('Elffuss', '<b>Elffuss Claw</b>');
  set('#perm-deny', t.permDeny);
  set('#perm-allow', t.permAllow);
}

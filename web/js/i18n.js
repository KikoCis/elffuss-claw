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

export function applyI18n() {
  const code = (navigator.language || 'es').slice(0, 2).toLowerCase();
  const t = L[code] || L.en;
  const $ = s => document.querySelector(s);
  const set = (sel, txt) => { const e = $(sel); if (e && txt) e.textContent = txt; };

  document.documentElement.lang = code;
  const hi = $('.msg.sys b'); if (hi) hi.textContent = t.hi;
  const sys = $('.msg.sys');
  if (sys) { // reemplaza el texto tras el <b>, conservando avatar + bold
    [...sys.childNodes].forEach(n => { if (n.nodeType === 3) n.textContent = ''; });
    sys.append(' ' + t.welcome);
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
}

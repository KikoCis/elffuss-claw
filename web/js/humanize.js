// Frase legible por humano para una tool-call («leyendo app.js…»). Compartido
// por el cerebro CEO (ceo.js) y el streaming en vivo del chat — así nunca se
// le enseña JSON crudo al usuario, siempre la misma redacción. Cubre los
// nombres de herramienta de Elffuss Code (code.*, terminal.*) y de Elffuss
// Claw (fs.*, app.*, web.*, skill.*, memory.*, tasks.*) — un tool desconocido
// cae al genérico «nombre argumento» sin romper nada.
//
// Localizado: ES por defecto (usuarios españoles intactos), EN de fallback.
// Autocontenido a propósito — este fichero es IDÉNTICO en Code y en Claw, y
// Code no tiene i18n.js, así que la tabla de idioma vive aquí.
const HL = {
  es: {
    read: p => `leyendo ${p}…`, write: p => `escribiendo ${p}…`,
    tree: p => `explorando ${p || 'el proyecto'}…`, list: p => `explorando ${p || 'la carpeta'}…`,
    search: q => `buscando «${q}»…`, pick: () => 'pidiendo acceso a una carpeta…',
    copy: x => `copiando ${x || 'archivos'}…`, watch: x => `vigilando ${x || 'una carpeta'}…`,
    run: c => `ejecutando: ${c}`,
    appCreate: n => `creando la app «${n}»…`, appOpen: n => `abriendo la app «${n}»…`,
    skillCreate: n => `creando la skill «${n}»…`, memSave: f => `recordando: ${f}…`,
    taskAdd: () => 'programando una tarea…',
    webSearch: q => `buscando en internet «${q}»…`, webImages: q => `buscando imágenes de «${q}»…`,
    webFetch: u => `leyendo ${u}…`, prep: 'preparando una acción…',
  },
  en: {
    read: p => `reading ${p}…`, write: p => `writing ${p}…`,
    tree: p => `exploring ${p || 'the project'}…`, list: p => `exploring ${p || 'the folder'}…`,
    search: q => `searching “${q}”…`, pick: () => 'requesting folder access…',
    copy: x => `copying ${x || 'files'}…`, watch: x => `watching ${x || 'a folder'}…`,
    run: c => `running: ${c}`,
    appCreate: n => `creating the app “${n}”…`, appOpen: n => `opening the app “${n}”…`,
    skillCreate: n => `creating the skill “${n}”…`, memSave: f => `remembering: ${f}…`,
    taskAdd: () => 'scheduling a task…',
    webSearch: q => `searching the web for “${q}”…`, webImages: q => `searching images of “${q}”…`,
    webFetch: u => `reading ${u}…`, prep: 'preparing an action…',
  },
};
function hl() { return HL[(navigator.language || 'es').slice(0, 2).toLowerCase()] || HL.en; }

export function humanizeTool(name, args) {
  const p = args?.path, q = args?.query, c = args?.command, n = args?.name;
  const t = hl();
  switch (name) {
    case 'code.read': case 'fs.read': return t.read(p);
    case 'code.write': case 'fs.write': return t.write(p);
    case 'code.tree': return t.tree(p);
    case 'fs.list': return t.list(p);
    case 'code.search': return t.search(q);
    case 'fs.pick_folder': return t.pick();
    case 'fs.copy': return t.copy(args?.pattern);
    case 'fs.watch': return t.watch(args?.from);
    case 'terminal.run': return t.run(c);
    case 'app.create': return t.appCreate(n);
    case 'app.open': return t.appOpen(n);
    case 'skill.create': return t.skillCreate(n);
    case 'memory.save': return t.memSave(args?.fact);
    case 'tasks.add': return t.taskAdd();
    case 'web.search': return t.webSearch(q);
    case 'web.images': return t.webImages(q);
    case 'web.fetch': return t.webFetch(p || args?.url);
    default: return name + (p || q || c || n ? ' ' + (p || q || c || n) : '');
  }
}

// Detecta si el buffer que va llegando EN STREAMING ha entrado en un bloque de
// tool-call (```tool { … }) y, si es así, devuelve una frase humana en vez del
// JSON crudo — «preparando una acción…» hasta que el nombre de la tool sea
// legible, luego «leyendo app.js…» tan pronto como el campo aparezca, aunque
// el JSON todavía no haya cerrado.
export function humanizeStreamPreview(buf) {
  if (buf.search(/```/) === -1 && !/^\s*\{\s*"tool"/.test(buf)) return null;
  const toolM = buf.match(/"tool"\s*:\s*"([\w.]+)"/);
  if (!toolM) return hl().prep;
  const pathM = buf.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const queryM = buf.match(/"query"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const cmdM = buf.match(/"command"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const nameM = buf.match(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const out = humanizeTool(toolM[1], { path: pathM?.[1], query: queryM?.[1], command: cmdM?.[1], name: nameM?.[1] });
  // el nombre de la tool ya se ve pero su campo (path/query/…) aún no llegó:
  // mejor el genérico que un «leyendo undefined…» a medio streamear
  return /undefined/.test(out) ? hl().prep : out;
}

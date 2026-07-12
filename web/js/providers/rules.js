// «Modo básico»: cerebro determinista sin modelo — cubre las demos clave sin
// descargar nada. Para lenguaje libre, carga un modelo en el selector 🧠.
export const name = 'Básico (sin modelo)';
export async function load() {}

const call = obj => '```tool\n' + JSON.stringify(obj) + '\n```';

const SHELL = (title, body, script) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title><style>
body{font-family:system-ui;background:#0d1117;color:#e6edf3;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;gap:16px}
button{cursor:pointer}
</style></head><body>${body}<script>${script}<\/script></body></html>`;

const APPS = {
  reloj: () => SHELL('Reloj',
    '<h1 id="t" style="font-size:14vw;margin:0;font-variant-numeric:tabular-nums"></h1><p id="d" style="color:#8b949e;font-size:1.2rem"></p>',
    "const f=()=>{const n=new Date();document.getElementById('t').textContent=n.toLocaleTimeString('es-ES');document.getElementById('d').textContent=n.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'})};f();setInterval(f,1000);"),
  notas: () => SHELL('Notas',
    '<h2>📝 Notas</h2><textarea id="n" style="width:82vw;height:60vh;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:10px;padding:14px;font-size:16px;resize:none" placeholder="Escribe aquí…"></textarea><p id="s" style="color:#8b949e;font-size:.85rem"></p>',
    "let mem={};let store;try{store=localStorage;store.getItem('x')}catch(e){store={getItem:k=>mem[k],setItem:(k,v)=>mem[k]=v}}const n=document.getElementById('n'),s=document.getElementById('s');n.value=store.getItem('nastia.notas')||'';n.oninput=()=>{store.setItem('nastia.notas',n.value);s.textContent='guardado '+new Date().toLocaleTimeString('es-ES')};"),
  calculadora: () => SHELL('Calculadora',
    '<div><input id="p" readonly style="width:288px;font-size:1.6rem;text-align:right;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:10px;padding:10px;margin-bottom:10px;box-sizing:border-box"><div id="k" style="display:grid;grid-template-columns:repeat(4,64px);gap:8px"></div></div>',
    "const p=document.getElementById('p'),k=document.getElementById('k');'789/456*123-0.=+C'.split('').forEach(c=>{const b=document.createElement('button');b.textContent=c;b.style.cssText='font-size:1.3rem;padding:14px;border-radius:10px;border:1px solid #30363d;background:#21262d;color:#e6edf3';b.onclick=()=>{if(c==='C')p.value='';else if(c==='='){try{p.value=/^[-+*/.() 0-9]+$/.test(p.value)?String(Function('return ('+p.value+')')()):'error'}catch(e){p.value='error'}}else p.value+=c};k.appendChild(b)});"),
};

const generic = desc => SHELL('Boceto',
  `<div style="max-width:560px;text-align:center;padding:20px"><h2>✳ Boceto de app</h2><p style="color:#8b949e">Esto es un boceto del modo básico. Pediste:</p><blockquote style="background:#161b22;border-left:3px solid #ff4d8d;padding:12px;border-radius:8px;text-align:left">${desc.replace(/</g, '&lt;')}</blockquote><p style="color:#8b949e">Carga un modelo (selector 🧠 arriba) y Nastia generará esta app de verdad, a medida.</p></div>`, '');

const HELP = `Estoy en modo básico (sin modelo). Entiendo órdenes directas:
• «hazme un reloj / una app de notas / una calculadora»
• «autoriza una carpeta» · «lista los archivos» · «lee <archivo>»
• «recuérdame dentro de N minutos <algo>» · «lista las tareas»
• «guarda el secreto <nombre>: <valor>» · «lista los secretos»
• «abre https://…»
Para lenguaje libre y apps a medida, carga un modelo en el selector 🧠 de arriba.`;

export async function chat(history) {
  const last = history[history.length - 1];
  const text = (last?.content || '').trim();

  // Tras una herramienta: convertir su resultado en la respuesta.
  if (text.startsWith('[resultado')) {
    const body = text.slice(text.indexOf('\n') + 1).trim();
    return body.startsWith('ERROR:') ? 'No pude: ' + body.slice(6).trim() : body;
  }

  const t = text.toLowerCase();

  // web (antes que «abre <app>» para que gane la URL)
  const url = text.match(/https?:\/\/[^\s"'<>]+/);
  if (url && /(abre|visita|entra|descarga|mira|lee|busca|ve a)/.test(t))
    return call({ tool: 'web.fetch', args: { url: url[0] } });

  // tareas
  const mTask = text.match(/dentro de (\d+)\s*min(?:uto)?s?\s*(?:que\s*)?(.*)/i);
  if (mTask && /(recu[eé]rdame|av[ií]same|programa|dentro de \d+ *min)/.test(t))
    return call({ tool: 'tasks.add', args: { inMinutes: Number(mTask[1]), prompt: mTask[2].trim() || text } });
  if (/(lista|ver|muestra|qué|que).*(tareas)/.test(t) || t === 'tareas')
    return call({ tool: 'tasks.list', args: {} });

  // vault
  const mSecret = text.match(/guarda (?:el |la )?(?:secreto|contraseña) ([\w.@-]+)\s*[:=]\s*(\S+)/i);
  if (mSecret) return call({ tool: 'vault.set', args: { name: mSecret[1], secret: mSecret[2] } });
  if (/(lista|ver|muestra).*(secretos|contraseñas)/.test(t))
    return call({ tool: 'vault.list', args: {} });
  const mGet = text.match(/(?:dame|lee|cu[aá]l es) (?:el |la )?(?:secreto|contraseña)(?: de)? ([\w.@-]+)/i);
  if (mGet) return call({ tool: 'vault.get', args: { name: mGet[1] } });

  // archivos
  if (/(autoriza|elige|selecciona|añade|conecta).*(carpeta|directorio)/.test(t))
    return call({ tool: 'fs.pick_folder', args: {} });
  if (/(lista|muestra|qué hay|que hay|enséñame|ver).*(archivos|ficheros|carpeta|directorio)/.test(t))
    return call({ tool: 'fs.list', args: {} });
  const mRead = text.match(/lee (?:el (?:archivo|fichero) )?([\w./ -]+\.\w+)/i);
  if (mRead) return call({ tool: 'fs.read', args: { path: mRead[1].trim() } });
  const mWrite = text.match(/escribe (?:en )?([\w./-]+\.\w+)\s*[:=]\s*([\s\S]+)/i);
  if (mWrite) return call({ tool: 'fs.write', args: { path: mWrite[1], content: mWrite[2] } });

  // apps
  if (/(crea|hazme|haz|genera|quiero|móntame|montame)/.test(t) || /^(reloj|notas|calculadora)$/.test(t)) {
    const kind = /reloj|hora/.test(t) ? 'reloj' : /nota/.test(t) ? 'notas' : /calcul/.test(t) ? 'calculadora' : null;
    if (kind) return call({ tool: 'app.create', args: { name: kind, html: APPS[kind]() } });
    if (/(app|aplicaci|web|página|pagina|juego|dashboard|panel)/.test(t))
      return call({ tool: 'app.create', args: { name: 'boceto', html: generic(text) } });
  }
  const mOpen = t.match(/abre (?:la app )?([\wáéíóúñ-]+)/);
  if (mOpen && !url) return call({ tool: 'app.open', args: { name: mOpen[1] } });
  if (/(lista|ver|muestra|qué|que).*apps/.test(t)) return call({ tool: 'app.list', args: {} });

  if (/^(hola|buenas|hey|hi)\b/.test(t)) return '¡Hola! ' + HELP;
  return HELP;
}

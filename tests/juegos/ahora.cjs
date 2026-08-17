// ¿Cómo salen los juegos AHORA, con el arreglo del KV-cache y el parada-por-nota?
//
// Dos variantes por juego:
//   borrador  · lo que sale a la primera, sin tocar
//   nota5     · itera hasta que el evaluador objetivo da 5/5 (tope 3 rondas)
//
// Se puntúa DESDE FUERA con jugabilidad.cjs, que es un arnés independiente. Si
// puntuara el mismo evaluador que dirige el bucle, la medición sería circular:
// diría que 5/5 porque el bucle para justo cuando él dice 5/5.
const {chromium}=require(process.env.PW||"playwright");
const {medir}=require("./jugabilidad.cjs");
const fs=require("fs"),os=require("os"),{execSync}=require("child_process");
const OUT=__dirname+"/ahora"; fs.mkdirSync(OUT,{recursive:true});

const GAMES=[
 {id:"breakout",brief:"Hazme un juego de romper ladrillos: pala con el ratón, bola que rebota, ladrillos de colores, puntuación y game over."},
 {id:"snake",   brief:"Hazme el juego de la serpiente: se mueve con las flechas, come manzanas, crece, y pierde si choca consigo misma."},
 {id:"pong",    brief:"Hazme un pong para dos jugadores: una pala con W/S y otra con las flechas, bola que rebota y marcador."},
];
const VARIANTES=[{k:"borrador",rounds:0,nota:null,bestOf:1},
                 {k:"refina",  rounds:3,nota:6,  bestOf:1},
                 {k:"best-of-3",rounds:0,nota:6, bestOf:3},
                 {k:"b3+refina",rounds:2,nota:6, bestOf:3}];

(async()=>{
  try{execSync("pkill -f elffuss-e4b");}catch{}
  await new Promise(r=>setTimeout(r,3000));
  try{execSync("rm -f ~/.cache/elffuss-e4b/Singleton*");}catch{}
  // la caché HTTP del perfil sirve JS viejo y la medición sale de otra versión
  try{execSync("rm -rf ~/.cache/elffuss-e4b/Default/Cache");}catch{}
  const ctx=await chromium.launchPersistentContext(os.homedir()+"/.cache/elffuss-e4b",
    {channel:"chrome",headless:true,args:["--enable-unsafe-webgpu"]});
  const p=await ctx.newPage();
  await p.goto("https://claw.elffuss.utopiaia.com/",{waitUntil:"domcontentloaded"});
  await p.waitForTimeout(1500);

  // GUARDIA: sin esto se mide una versión del código que no es la que crees
  const listo=await p.evaluate(async()=>{
    const l=await import("/js/providers/litert.js"), r=await import("/js/rlm.js");
    return {kv:l.chat.toString().includes("reiniciada"), evalua:typeof r.rateArtifact==="function",
            medidos:r.deepCreate.toString().includes("defectosMedidos")};
  });
  const ok=listo.kv&&listo.evalua&&listo.medidos;
  console.log(ok ? "✓ el navegador tiene KV-cache arreglado, evaluador y defectos medidos"
                 : `✗ MEDICIÓN INVÁLIDA — kv=${listo.kv} evaluador=${listo.evalua} medidos=${listo.medidos}`);
  if(!ok){await ctx.close();return;}

  console.log("cargando Gemma E4B…");
  await p.evaluate(async()=>{const m=await import("/js/providers/litert.js");m.configure("gemma-e4b");await m.load(()=>{});});
  console.log("listo\n");

  const todo={};
  for(const g of GAMES){
    todo[g.id]={};
    for(const V of VARIANTES){
      const t0=Date.now();
      const out=await p.evaluate(async a=>{
        const m=await import("/js/providers/litert.js"); m.configure("gemma-e4b");
        const rlm=await import("/js/rlm.js");
        const notas=[];
        const res=await rlm.deepCreate({brief:a.brief, provider:m, rounds:a.rounds, bestOf:a.bestOf,
          editMode:"patch", notaMinima:a.nota,
          evaluar:a.nota?(html=>rlm.rateArtifact(html).then(r=>{notas.push(r.nota);return r;})):null,
          onProgress:()=>{}});
        return {html:res.html, notas, rondas:res.trace?res.trace.length-1:0,
                detalles:(res.trace||[]).map(t=>t.detalle?Object.entries(t.detalle).filter(([,v])=>!v).map(([k])=>k).join('/')||'todo ok':'-')};
      },{brief:g.brief,rounds:V.rounds,nota:V.nota,bestOf:V.bestOf}).catch(e=>({html:"",error:e.message.slice(0,90),notas:[]}));

      const file=`${OUT}/${g.id}-${V.k}.html`;
      fs.writeFileSync(file,out.html||"");
      // puntuación EXTERNA, en pestaña aparte
      const pag=await ctx.newPage();
      const nota=(out.html||"").length ? await medir(pag,"file://"+file) : {puntos:0,error:out.error||"sin html"};
      await pag.close();
      todo[g.id][V.k]={...nota, bytes:(out.html||"").length, segs:Math.round((Date.now()-t0)/1000),
                       rondas:out.rondas||0, notasInternas:out.notas};
      const d=todo[g.id][V.k];
      console.log(`  ${g.id.padEnd(9)} ${V.k.padEnd(10)} ${d.puntos}/6  ${String(d.bytes).padStart(6)}B  ${String(d.segs).padStart(4)}s  ` +
        `${d.rondas} rondas` + (d.notasInternas.length?` · notas ${d.notasInternas.join(",")}`:"") +
        (out.detalles?` · falla: ${out.detalles.join(" → ")}`:"") +
        (d.error?` · ${String(d.error).slice(0,45)}`:""));
      fs.writeFileSync(__dirname+"/ahora.json",JSON.stringify(todo,null,1));
    }
  }
  console.log("\n══ RESUMEN (puntuado desde fuera) ══");
  for(const g of GAMES) console.log(`  ${g.id.padEnd(9)} `+VARIANTES.map(V=>`${V.k} ${todo[g.id][V.k].puntos}/6`).join("  ·  "));
  console.log("");
  for(const V of VARIANTES) console.log(`  TOTAL ${V.k.padEnd(10)} ${GAMES.reduce((s,g)=>s+todo[g.id][V.k].puntos,0)}/18`);
  await ctx.close();
})().catch(e=>console.log("FATAL",e.message));

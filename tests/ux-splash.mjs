// Bienvenida (primera visita) con el teclado.
//   · Es un diálogo modal: el foco empieza en «Entrar», lo de detrás está inerte
//     y Tab no se escapa al selector de modelo de detrás.
//   · «Entrar» con Enter la cierra, la recuerda y deja el foco en la caja.
//   · Con «reducir movimiento», «Entrar» se ve desde el principio.
//   · Los atajos globales («?» y «/») no actúan detrás de la bienvenida: antes
//     «?» abría la lista de atajos encima y «/» escribía en la caja inerte de
//     detrás con su menú abierto. Tras entrar, funcionan.
//
//   BASE=http://localhost:8743 node tests/ux-splash.mjs
import { navegador, contexto, ok, hasta, fin, BASE } from './ux-comun.mjs';

const b = await navegador();
const { ctx } = await contexto(b, { welcomed: false });
const p = await ctx.newPage();
const errores = [];
p.on('pageerror', e => { if (!/allow-same-origin/.test(e.message)) errores.push(e.message); });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.elffuss?.agent);
const estado = () => p.evaluate(() => ({
  visible: !document.getElementById('splash').hidden,
  role: document.getElementById('splash').getAttribute('role'),
  modal: document.getElementById('splash').getAttribute('aria-modal'),
  foco: document.activeElement?.id,
  inerte: document.querySelector('header').inert && document.querySelector('main').inert,
}));
const e1 = await estado();
ok('la bienvenida es un diálogo modal con el foco en «Entrar»', e1.visible && e1.role === 'dialog' && e1.modal === 'true' && e1.foco === 'splash-enter', JSON.stringify(e1));
ok('lo de detrás está inerte', e1.inerte);
await p.keyboard.press('Tab');
ok('Tab no se escapa al selector de modelo de detrás', await p.evaluate(() => !document.activeElement?.closest('header, main')));
await p.focus('#splash-enter');
await p.keyboard.press('?');
await p.keyboard.press('/');
await p.waitForTimeout(200);
const atajos = await p.evaluate(() => ({
  lista: !!document.getElementById('atajos')?.open, caja: document.getElementById('prompt').value,
  menu: !document.getElementById('cmd-menu')?.hidden, foco: document.activeElement?.id,
}));
ok('con la bienvenida a la vista, «?» y «/» no actúan detrás', !atajos.lista && atajos.caja === '' && !atajos.menu && atajos.foco === 'splash-enter', JSON.stringify(atajos));
await p.focus('#splash-enter');
await p.keyboard.press('Enter');
ok('Enter en «Entrar» la cierra y el foco va a la caja de texto', await hasta(async () => {
  const e = await p.evaluate(() => ({ foco: document.activeElement?.id, inerte: document.querySelector('header').inert, ok: localStorage.getItem('elffuss.welcomed') }));
  return e.foco === 'prompt' && !e.inerte && e.ok === '1';
}));
ok('…y desaparece', await hasta(() => p.evaluate(() => document.getElementById('splash').hidden)));
await p.click('#log');
await p.keyboard.press('?');
ok('tras entrar, «?» sí enseña la lista de atajos', await hasta(() => p.evaluate(() => !!document.getElementById('atajos')?.open)));
await p.keyboard.press('Escape');

{
  const c2 = await b.newContext({ reducedMotion: 'reduce' });
  const q = await c2.newPage();
  await q.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const opac = await q.evaluate(() => getComputedStyle(document.getElementById('splash-enter')).opacity);
  ok('con «reducir movimiento», «Entrar» se ve desde el principio', opac === '1', opac);
  await c2.close();
}

ok('sin errores de página', errores.length === 0, errores.slice(0, 3).join(' | '));
await fin(b, 'BIENVENIDA: modal, foco en «Entrar», y al entrar el foco va a la caja');

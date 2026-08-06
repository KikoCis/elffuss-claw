// challenge.js — top bar announcing the 15-minute challenge, with the two places to post
// the result. Self-contained (injects its own CSS), dismissible, and it removes itself
// after the deadline so nobody has to remember to take it down.
import { uiLang } from './i18n.js';

const DEADLINE = Date.parse('2026-08-10T00:00:00Z'); // winner announced Sun Aug 9
const KEY = 'elffuss_challenge_v1_dismissed';
const X_URL = 'https://x.com/KikoCisneros/status/2085266098451067141';
const LI_URL = 'https://www.linkedin.com/feed/update/urn:li:activity:7491123650096652289/';

const COPY = {
  es: {
    text: '⚡ Reto de 15 min: crea lo que puedas con Elffuss y enséñalo. Gana el comentario con más likes — ganador el domingo 9.',
    x: 'Publicar en X', li: 'En LinkedIn', close: 'Cerrar aviso',
  },
  en: {
    text: '⚡ 15-min challenge: build whatever you can with Elffuss and show it. Most-liked comment wins — winner on Sun Aug 9.',
    x: 'Post on X', li: 'On LinkedIn', close: 'Dismiss',
  },
};

export function mountChallengeBar() {
  if (Date.now() > DEADLINE) return;
  try { if (localStorage.getItem(KEY)) return; } catch (e) {}
  const c = COPY[uiLang() === 'es' ? 'es' : 'en'];

  const css = document.createElement('style');
  css.textContent = `
    body.elf-ch { padding-top: 38px; }
    .elf-ch-bar {
      position: fixed; inset: 0 0 auto 0; z-index: 400; height: 38px;
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding: 0 42px 0 12px; font-size: .82rem; color: #fff;
      background: linear-gradient(135deg, var(--accent, #7c5cff), var(--accent2, #ff5cd6));
      box-shadow: 0 2px 12px rgba(0,0,0,.35);
    }
    .elf-ch-bar span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .elf-ch-bar a {
      flex: none; padding: 3px 10px; border-radius: 999px; text-decoration: none;
      color: #fff; background: rgba(0,0,0,.28); font-weight: 600;
    }
    .elf-ch-bar a:hover { background: rgba(0,0,0,.45); }
    .elf-ch-bar button {
      position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
      background: none; border: none; color: #fff; font-size: 1.1rem; cursor: pointer; opacity: .8;
    }
    .elf-ch-bar button:hover { opacity: 1; }
    @media (max-width: 620px) { .elf-ch-bar span { font-size: .74rem; } }
  `;
  document.head.appendChild(css);

  const bar = document.createElement('div');
  bar.className = 'elf-ch-bar';
  bar.innerHTML = `<span></span>
    <a target="_blank" rel="noopener" href="${X_URL}"></a>
    <a target="_blank" rel="noopener" href="${LI_URL}"></a>
    <button type="button" aria-label=""></button>`;
  bar.querySelector('span').textContent = c.text;
  const [ax, ali] = bar.querySelectorAll('a');
  ax.textContent = c.x; ali.textContent = c.li;
  const btn = bar.querySelector('button');
  btn.textContent = '✕'; btn.setAttribute('aria-label', c.close);
  btn.addEventListener('click', () => {
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
    bar.remove(); document.body.classList.remove('elf-ch');
  });

  document.body.classList.add('elf-ch');
  document.body.appendChild(bar);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountChallengeBar);
else mountChallengeBar();

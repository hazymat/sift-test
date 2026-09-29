// A small menu of pills under a pill, for changing a status in place (e.g.
// ⚡ ⚡⚡ ⚡⚡⚡ for energy). Picking one calls onPick(value); Esc or clicking
// elsewhere closes it.
//
//   pillMenu(anchorEl, [{ value, label, title?, current? }], onPick, { focus?, className? })
//     focus: false leaves the cursor where it is (e.g. in a note being written)
//     back: false leaves the cursor off the anchor after Esc (e.g. opened by a key while browsing)
//   With the cursor in the menu, ← / → move between its pills, Enter picks.
//   energyMenu(anchorEl, currentEnergy, onPick)   the energy picker used everywhere

import { ENERGY } from './days.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function pillMenu(anchor, options, onPick, { focus = true, back = true, className = '' } = {}) {
  document.querySelector('.pill-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = `pill-menu ${className}`.trim();
  menu.setAttribute('role', 'menu');
  menu.innerHTML = options.map((o, n) => `<button type="button" role="menuitemradio" aria-checked="${!!o.current}" data-n="${n}" title="${esc(o.title || '')}" aria-label="${esc(o.title || o.label)}">${o.label}</button>`).join('');
  document.body.append(menu);

  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, document.documentElement.clientWidth - menu.offsetWidth - 8))}px`; // (clientWidth: inside the scrollbar)
  // Under the anchor, or above it when there's no room below (e.g. from the
  // selection bar at the bottom of the screen).
  const below = r.bottom + 4;
  const room = (visualViewport?.height ?? innerHeight) - 8;
  menu.style.top = `${below + menu.offsetHeight <= room ? below : Math.max(8, r.top - 4 - menu.offsetHeight)}px`;

  const close = () => {
    menu.remove();
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', keys, true);
    removeEventListener('scroll', close, true);
  };
  const outside = ev => { if (!menu.contains(ev.target) && !anchor.contains(ev.target)) close(); };
  const keys = ev => {
    if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && menu.contains(document.activeElement)) {
      const pills = [...menu.querySelectorAll('button')];
      pills[pills.indexOf(document.activeElement) + (ev.key === 'ArrowLeft' ? -1 : 1)]?.focus();
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    close();
    if (focus && back) anchor.focus();
  };
  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', keys, true);
  addEventListener('scroll', close, true);
  menu.addEventListener('click', ev => {
    const b = ev.target.closest('[data-n]');
    if (!b) return;
    close();
    onPick(options[Number(b.dataset.n)].value);
  });
  if (!focus) menu.addEventListener('mousedown', ev => ev.preventDefault());
  else (menu.querySelector('[aria-checked="true"]') || menu.querySelector('button'))?.focus();
  return { close };
}

// Energy, everywhere it can be changed: ⚡ ⚡⚡ ⚡⚡⚡ side by side (the chosen
// one outlined) and, when one is set, ✕ to clear it. Picking the chosen one
// again also clears it. onPick gets the level's id, or null.
export function energyMenu(anchor, current, onPick) {
  const options = ENERGY.map(e => ({ value: e.id, label: e.bolts, title: `${e.label}: ${e.hint}`, current: current === e.id }));
  if (current) options.push({ value: null, label: '✕', title: 'No energy' });
  return pillMenu(anchor, options, v => onPick(v === current ? null : v));
}

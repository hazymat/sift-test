// A small menu of pills under a pill, for changing a status in place (e.g.
// ⚡ ⚡⚡ ⚡⚡⚡ for energy). Picking one calls onPick(value); Esc or clicking
// elsewhere closes it.
//
//   pillMenu(anchorEl, [{ value, label, title?, current? }], onPick)

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function pillMenu(anchor, options, onPick) {
  document.querySelector('.pill-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'pill-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = options.map((o, n) => `<button type="button" role="menuitemradio" aria-checked="${!!o.current}" data-n="${n}" title="${esc(o.title || '')}" aria-label="${esc(o.title || o.label)}">${o.label}</button>`).join('');
  document.body.append(menu);

  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${r.bottom + 4}px`;

  const close = () => {
    menu.remove();
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', keys, true);
    removeEventListener('scroll', close, true);
  };
  const outside = ev => { if (!menu.contains(ev.target) && !anchor.contains(ev.target)) close(); };
  const keys = ev => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    close();
    anchor.focus();
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
  (menu.querySelector('[aria-checked="true"]') || menu.querySelector('button'))?.focus();
  return { close };
}

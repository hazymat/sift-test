// Dropdowns, the same everywhere: a <select> opens the app's own list (glass,
// rounded, joined to the pill or box it hangs from) instead of the browser's
// plain one. The real <select> stays and keeps its value, so views still read
// .value and listen for "change" as before.
//
// Mouse and keyboard only: phones and tablets (no fine pointer) keep their own
// picker, which is made for fingers. Opens with a click, or Space / Enter /
// Alt+↓ on a focused dropdown; ↑ ↓ Home End move, Enter picks, Esc or Tab or a
// click elsewhere closes. Nothing else on the page sees clicks inside the list,
// so panels and pills it belongs to stay open.

const FINE = matchMedia('(any-pointer: fine)');
let open = null; // { select, anchor, menu, active, host }

const usable = s => s instanceof HTMLSelectElement && !s.multiple && !(s.size > 1) && !s.disabled && FINE.matches;
// The pill a select sits in (an .entry-chip label holding an invisible select), or the select itself.
const anchorOf = s => s.closest('.entry-chip') || s;

function build(select) {
  const menu = document.createElement('div');
  menu.className = 'dd-menu';
  menu.setAttribute('role', 'listbox');
  let n = 0;
  for (const node of select.children) {
    if (node.tagName === 'OPTGROUP') {
      const h = document.createElement('div');
      h.className = 'dd-group';
      h.textContent = node.label;
      menu.append(h);
      for (const o of node.children) menu.append(optionEl(o, n++));
    } else if (node.tagName === 'OPTION') menu.append(optionEl(node, n++));
  }
  return menu;
}
function optionEl(o, n) {
  const b = document.createElement('div');
  b.className = 'dd-opt';
  b.setAttribute('role', 'option');
  b.dataset.n = n;
  b.textContent = o.textContent;
  if (o.style.fontFamily) b.style.fontFamily = o.style.fontFamily; // e.g. a font list shows each font
  if (o.disabled) b.setAttribute('aria-disabled', 'true');
  if (o.selected) b.setAttribute('aria-selected', 'true');
  return b;
}

function place() {
  const { anchor, menu, host } = open;
  const r = anchor.getBoundingClientRect();
  const h = r.height;
  const below = innerHeight - r.bottom - 8;
  const above = r.top - 8;
  const up = below < Math.min(menu.scrollHeight, 240) && above > below;
  menu.classList.toggle('up', up);
  anchor.classList.toggle('dd-up', up);
  menu.style.maxHeight = `${Math.max(120, Math.min(360, up ? above : below))}px`;
  menu.style.minWidth = `${r.width}px`;
  // A pill keeps its round ends on the far side and goes square where the list joins it.
  const round = anchor.classList.contains('entry-chip') ? h / 2 : 10;
  anchor.style.borderRadius = up ? `0 0 ${round}px ${round}px` : `${round}px ${round}px 0 0`;
  // Inside an open dialog the list must live in the dialog (the rest of the page is behind it).
  const base = host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect();
  const sx = host === document.body ? 0 : host.scrollLeft;
  const sy = host === document.body ? 0 : host.scrollTop;
  let left = r.left;
  const w = menu.offsetWidth;
  if (left + w > innerWidth - 8) left = Math.max(8, innerWidth - 8 - w);
  menu.style.left = `${left - base.left + sx}px`;
  menu.style.top = up ? `${r.top - menu.offsetHeight - base.top + sy}px` : `${r.bottom - base.top + sy}px`;
  // Where the list is wider than its pill, that corner is rounded.
  menu.classList.toggle('wider', w > r.width + 1 || left !== r.left);
}

function setActive(i) {
  const opts = [...open.menu.querySelectorAll('.dd-opt:not([aria-disabled])')];
  if (!opts.length) return;
  const el = opts[Math.max(0, Math.min(opts.length - 1, i))];
  open.menu.querySelector('.dd-opt.active')?.classList.remove('active');
  el.classList.add('active');
  el.scrollIntoView({ block: 'nearest' });
  open.active = el;
}
const activeIndex = () => [...open.menu.querySelectorAll('.dd-opt:not([aria-disabled])')].indexOf(open.active);

function openFor(select) {
  close();
  const anchor = anchorOf(select);
  const host = select.closest('dialog[open]') || document.body;
  const menu = build(select);
  if (host !== document.body) menu.classList.add('in-dialog');
  host.append(menu);
  anchor.classList.add('dd-open');
  open = { select, anchor, menu, host, active: null };
  place();
  const sel = menu.querySelector('.dd-opt[aria-selected="true"]') || menu.querySelector('.dd-opt:not([aria-disabled])');
  if (sel) setActive([...menu.querySelectorAll('.dd-opt:not([aria-disabled])')].indexOf(sel));
  select.focus({ preventScroll: true });
}

export function close() {
  if (!open) return;
  const { anchor, menu } = open;
  menu.remove();
  anchor.classList.remove('dd-open', 'dd-up');
  anchor.style.borderRadius = '';
  open = null;
}

function pick(optEl) {
  const { select } = open;
  const o = select.options[Number(optEl.dataset.n)];
  close();
  if (!o || o.disabled) return;
  select.focus({ preventScroll: true });
  if (select.value === o.value && o.selected) return;
  select.value = o.value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

export function installDropdowns() {
  // Clicks on a select open our list instead of the browser's.
  document.addEventListener('mousedown', ev => {
    const s = ev.target.closest?.('select');
    if (!usable(s) || ev.button !== 0) return;
    ev.preventDefault();
    if (open?.select === s) close(); else openFor(s);
  }, true);
  // Inside the list: nobody else hears about it (so panels, pills and menus
  // it sits over don't take it as a click outside them).
  for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
    addEventListener(type, ev => {
      if (!open) return;
      // (Immediate: other listeners on window don't hear it either, e.g. a pop-up's click-away.)
      if (open.menu.contains(ev.target)) { ev.stopImmediatePropagation(); if (type !== 'touchstart') ev.preventDefault(); return; }
      if (!open.anchor.contains(ev.target)) close();
    }, true);
  }
  addEventListener('click', ev => {
    if (!open || !open.menu.contains(ev.target)) return;
    ev.stopPropagation();
    ev.preventDefault();
    const o = ev.target.closest('.dd-opt:not([aria-disabled])');
    if (o) pick(o);
  }, true);
  addEventListener('mousemove', ev => {
    const o = open && ev.target.closest?.('.dd-menu .dd-opt:not([aria-disabled])');
    if (o && o !== open.active) { open.menu.querySelector('.dd-opt.active')?.classList.remove('active'); o.classList.add('active'); open.active = o; }
  }, true);
  addEventListener('keydown', ev => {
    const s = ev.target;
    if (!open) {
      if (usable(s) && (ev.key === ' ' || ev.key === 'Enter' || ev.key === 'F4' || (ev.altKey && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')))) {
        ev.preventDefault();
        ev.stopPropagation();
        openFor(s);
      }
      return;
    }
    if (s !== open.select) { close(); return; }
    const k = ev.key;
    if (k === 'Tab') { close(); return; }
    ev.stopPropagation();
    if (k === 'Escape') { ev.preventDefault(); close(); return; }
    if (k === 'ArrowDown') { ev.preventDefault(); setActive(activeIndex() + 1); }
    else if (k === 'ArrowUp') { ev.preventDefault(); setActive(activeIndex() - 1); }
    else if (k === 'Home' || k === 'PageUp') { ev.preventDefault(); setActive(0); }
    else if (k === 'End' || k === 'PageDown') { ev.preventDefault(); setActive(1e6); }
    else if (k === 'Enter' || k === ' ') { ev.preventDefault(); if (open.active) pick(open.active); }
    else if (k.length === 1) {
      // Typing a letter jumps to the next choice starting with it.
      ev.preventDefault();
      const opts = [...open.menu.querySelectorAll('.dd-opt:not([aria-disabled])')];
      const from = activeIndex();
      const hit = [...opts.slice(from + 1), ...opts.slice(0, from + 1)].find(o => o.textContent.trim().toLowerCase().startsWith(k.toLowerCase()));
      if (hit) setActive(opts.indexOf(hit));
    }
  }, true);
  // Scrolling the page or resizing puts it away; scrolling inside the list doesn't.
  addEventListener('scroll', ev => { if (open && !open.menu.contains(ev.target)) close(); }, true);
  addEventListener('resize', close);
  addEventListener('hashchange', close);
}

// ⋯ menus (<details class="tool-menu">) open under their button, or above it
// when there's no room below (e.g. a card's ⋯ at the bottom of the screen).
export function installMenuFlip() {
  document.addEventListener('toggle', ev => {
    const d = ev.target;
    if (!(d instanceof HTMLDetailsElement) || !d.matches('.tool-menu')) return;
    if (!d.open) { d.querySelector(':scope > .menu')?.classList.remove('placed'); return; }
    const menu = d.querySelector(':scope > .menu');
    if (!menu) return;
    menu.classList.remove('up');
    menu.classList.add('placed'); // shown only now it's placed (CSS), so it never flashes the wrong way first
    const r = menu.getBoundingClientRect();
    const room = (visualViewport?.height ?? innerHeight) - 8;
    const above = d.getBoundingClientRect().top - 8;
    if (r.bottom > room && above > room - d.getBoundingClientRect().bottom) menu.classList.add('up');
  }, true);
}

// The dropdown that opens after 📞, 📝 or ⚠️ in a note: search for something
// to link (most recently touched first), or just keep the emoji.
//
//   openPicker({ host, at, kind, onPick(things[]), onNewContact(name), onClose({ restore }) })
//
// `host` is the element it's placed in (so focus stays "inside the note"),
// `at` a DOMRect to sit under. Enter links the highlighted one; Ctrl+click or
// Ctrl+Enter ticks several; Esc (or the first row) keeps just the emoji.

import { PICKERS, loadThings, searchThings } from './refs.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function openPicker({ host, at, kind, exclude = null, onPick, onNewContact, onClose }) {
  const cfg = PICKERS[kind];
  host.querySelector('.ref-picker')?.remove();
  const box = document.createElement('div');
  box.className = 'ref-picker';
  box.innerHTML = `
    <input class="ref-q no-inline" type="text" placeholder="${esc(cfg.placeholder)}" autocomplete="off" aria-label="${esc(cfg.placeholder)}">
    <ul class="ref-list" role="listbox"></ul>
    <div class="ref-foot muted"><span>Ctrl+click to pick several</span><button type="button" class="ref-go primary" hidden></button></div>`;
  host.append(box);

  // Under the caret, kept inside the note's width, and scrolled into view.
  const hostRect = host.getBoundingClientRect();
  const width = Math.min(340, hostRect.width);
  box.style.width = `${width}px`;
  box.style.left = `${Math.max(0, Math.min((at?.left ?? hostRect.left) - hostRect.left, hostRect.width - width))}px`;
  box.style.top = `${(at?.bottom ?? hostRect.top + 30) - hostRect.top + 6}px`;
  requestAnimationFrame(() => box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));

  const q = box.querySelector('.ref-q');
  const listEl = box.querySelector('.ref-list');
  const go = box.querySelector('.ref-go');
  let things = [];
  let shown = [];
  let active = 0; // row index; 0 = "don't link"
  const ticked = new Map();
  let closed = false;
  let loaded = false;

  const rows = () => {
    const out = [{ none: true }, ...shown.map(t => ({ t }))];
    if (kind === 'contact' && q.value.trim()) out.push({ create: q.value.trim() });
    return out;
  };

  function draw() {
    shown = searchThings(things, q.value);
    const all = rows();
    active = Math.min(active, all.length - 1);
    listEl.innerHTML = all.map((r, n) => {
      const cls = `${n === active ? 'active' : ''}`;
      if (r.none) return `<li class="ref-none ${cls}" data-n="${n}" role="option">${esc(cfg.none)} <kbd>Esc</kbd></li>`;
      if (r.create) return `<li class="ref-new ${cls}" data-n="${n}" role="option">+ New contact “${esc(r.create)}”</li>`;
      const key = `${r.t.collection}/${r.t.id}`;
      return `<li class="${cls}${ticked.has(key) ? ' ticked' : ''}" data-n="${n}" role="option" aria-selected="${ticked.has(key)}">
        <span class="ref-icon" aria-hidden="true">${r.t.icon}</span>
        <span class="ref-title">${esc(r.t.title)}</span>
        <span class="ref-sub muted">${esc(r.t.sub || r.t.label)}</span></li>`;
    }).join('') + (shown.length || !loaded ? '' : `<li class="ref-empty muted">${esc(q.value.trim() ? cfg.empty : 'Nothing yet')}</li>`);
    go.hidden = !ticked.size;
    go.textContent = `Link ${ticked.size}`;
    listEl.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  function close(result, { restore = true } = {}) {
    if (closed) return;
    closed = true;
    box.remove();
    document.removeEventListener('pointerdown', outside, true);
    if (result?.things?.length) onPick(result.things);
    else if (result?.create) onNewContact?.(result.create);
    else onClose?.({ restore });
  }

  function choose(n, { tick = false } = {}) {
    const r = rows()[n];
    if (!r) return;
    if (r.none) return close(ticked.size ? { things: [...ticked.values()] } : null);
    if (r.create) return close({ create: r.create });
    const key = `${r.t.collection}/${r.t.id}`;
    if (tick) {
      ticked.has(key) ? ticked.delete(key) : ticked.set(key, r.t);
      active = n;
      draw();
      q.focus();
      return;
    }
    if (!ticked.has(key)) ticked.set(key, r.t);
    close({ things: [...ticked.values()] });
  }

  q.addEventListener('input', () => { active = q.value.trim() ? 1 : 0; draw(); });
  q.addEventListener('keydown', ev => {
    const n = rows().length;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); active = (active + 1) % n; draw(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = (active - 1 + n) % n; draw(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); choose(active, { tick: ev.ctrlKey || ev.metaKey }); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(null); }
    else if (ev.key === 'Tab') { close(null); }
  });
  listEl.addEventListener('mousedown', ev => ev.preventDefault()); // keep typing in the search box
  listEl.addEventListener('click', ev => {
    const li = ev.target.closest('[data-n]');
    if (li) choose(Number(li.dataset.n), { tick: ev.ctrlKey || ev.metaKey || ev.shiftKey });
  });
  go.addEventListener('click', () => close({ things: [...ticked.values()] }));
  const outside = ev => { if (!box.contains(ev.target)) close(null, { restore: false }); };
  document.addEventListener('pointerdown', outside, true);

  draw();
  q.focus();
  loadThings(cfg.kinds, { important: cfg.important }).then(t => { things = t.filter(x => `${x.collection}/${x.id}` !== exclude); loaded = true; if (!closed) draw(); });
  return { close: () => close(null) };
}

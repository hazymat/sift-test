// Pills under an item while you edit it in place, the same in every list
// (Tasks, Day Planner, Find Things, Lists). Tap an item's text to edit it and
// a row of small pills opens under it (energy, time needed, dates… whatever
// that list offers) plus "More", which opens the item's full panel. They stay
// open while you use them (even when the list redraws), and close when you
// tap somewhere else or press Esc.
//
// On phones the ⋯ button is hidden (CSS, body.pills-only) and More / holding
// the text / tapping the note open the panel; on a laptop ⋯ stays as well.
//
//   editPills(root, {
//     title: '.task-title',                   the editable text of a row
//     row:   'li[data-task]',                 the row it belongs to
//     key:   row => row.dataset.task,         which record the row shows
//     html:  key => '<label class="entry-chip" …><select data-pill="energy">…',
//     change: (key, name, value) => …,        a pill's field changed
//     closed: key => …,                       (optional) the pills were put away
//     done: true,                             (optional) the row has a tick box (.tick): Ctrl+Enter
//                                             (⌘+Enter) in its text ticks or unticks it, and on a wide
//                                             screen a ✓ Done chip beside More says so
//   }) → { destroy() }
//
// A pill is a label.entry-chip holding a real <select> or date <input> with
// data-pill="<name>" (so phones show their own pickers), or a button with
// data-pill-act="<name>" (sent to change() with value null). "More" is added by
// this module: it clicks the row's own details (⋯) button.

import { ENERGY } from './days.js';
import { keys, CTRL_ENTER } from './keys.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export { esc as escPill };

// Helpers for views building their pills.
export function selectPill(name, label, glyph, options, value) {
  const cur = options.find(o => String(o[0]) === String(value ?? ''));
  const set = value != null && value !== '' && cur;
  const g = typeof glyph === 'function' ? glyph(set ? value : null) : glyph;
  return `<label class="entry-chip${set ? ' set' : ''}" data-chip="${name}">${g} <span class="chip-text">${esc(set ? cur[1] : label)}</span>`
    + `<select data-pill="${name}" aria-label="${esc(label)}">${options.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
}
// Energy: a button (not a dropdown) that opens the ⚡ picker (pillmenu.js
// energyMenu); change() gets ('energy', null) and opens it.
export function energyPill(value) {
  const e = ENERGY.find(x => x.id === value);
  return `<button type="button" class="entry-chip${e ? ' set' : ''}" data-chip="energy" data-pill-act="energy" aria-haspopup="menu">${e ? e.bolts : '⚡'} <span class="chip-text">${esc(e ? e.label : 'Energy')}</span></button>`;
}
// The date goes in data-value, not value (fillDates puts it in), so Reset in the
// iPhone picker empties it. The picker's Clear / Reset removes a set date (change()
// gets the name with value '').
export function datePill(name, label, glyph, value, shown) {
  return `<label class="entry-chip${value ? ' set' : ''}" data-chip="${name}">${glyph} <span class="chip-text">${esc(value ? shown(value) : label)}</span>`
    + `<input type="date" data-pill="${name}" data-value="${esc(value || '')}" data-sent="${esc(value || '')}" aria-label="${esc(label)}"></label>`;
}
export const fillDates = box => { for (const d of box.querySelectorAll('input[type="date"][data-value]')) d.value = d.dataset.value; };
// On touch screens a date is only saved when the picker is closed (the field
// is left): an iPhone fills in today as its picker opens.
export const touch = matchMedia('(pointer: coarse)').matches;

document.body.classList.toggle('pills-only', touch);

export function editPills(root, spec) {
  let editing = null; // key of the row whose pills are open
  const rowOf = key => [...root.querySelectorAll(spec.row)].find(r => spec.key(r) === key);
  const place = () => {
    for (const p of root.querySelectorAll('.edit-pills')) if (p.dataset.key !== editing || !p.isConnected) p.remove();
    if (!editing) return;
    const row = rowOf(editing);
    if (!row) { editing = null; return; }
    if (row.querySelector('[data-act$="details"][aria-expanded="true"]')) return; // its full panel is open instead
    const title = row.querySelector(spec.title);
    const host = title?.parentElement || row;
    if (host.querySelector(':scope > .edit-pills')) return;
    const box = document.createElement('div');
    box.className = 'edit-pills';
    box.dataset.key = editing;
    const done = spec.done && row.querySelector('.tick') ? `<button type="button" class="entry-chip pill-done" data-pill-done>${row.classList.contains('done') ? '↺ Not done' : '✓ Done'}${keys(CTRL_ENTER)}</button>` : '';
    box.innerHTML = `${spec.html(editing)}<button type="button" class="entry-chip pill-more" data-pill-more>More…</button>${done}`;
    fillDates(box);
    // After the note line if there is one, so the pills sit right under the text.
    const sub = host.querySelector(':scope > .item-sub');
    if (sub) sub.after(box); else host.append(box);
    row.classList.add('pills-open');
  };
  const open = key => { editing = key; place(); };
  const close = () => {
    if (!editing) return;
    const row = rowOf(editing);
    row?.classList.remove('pills-open');
    const was = editing;
    editing = null;
    place();
    spec.closed?.(was);
  };

  const onFocus = ev => {
    if (!ev.target.isConnected) return; // swapped for something else as it got the cursor (e.g. "Add note" for the notes editor)
    const title = ev.target.closest?.(spec.title);
    const row = title?.closest(spec.row);
    // The cursor moved somewhere else on the page (Tab, Shift+Tab): put the pills away.
    if (!row && editing && !rowOf(editing)?.contains(ev.target) && !ev.target.closest?.('.edit-pills, .pill-menu, .ref-picker, dialog')) { close(); return; }
    if (!row || !root.contains(row)) return;
    const key = spec.key(row);
    if (key !== editing) { close(); open(key); }
  };
  // Tapping outside the row (and its pills) closes them; pickers and menus that
  // float above the page don't count.
  const onPointer = ev => {
    if (!editing) return;
    const row = rowOf(editing);
    if (row?.contains(ev.target) || ev.target.closest?.('.edit-pills, .pill-menu, .ref-picker, dialog, .toast')) return;
    close();
  };
  // Tick or untick the row (its own tick box does the work). From its text (Ctrl+Enter): what's typed
  // is saved first (leaving the field saves it), and the cursor goes back once the list has redrawn.
  const toggleDone = (key, fromText) => {
    const row = rowOf(key), tick = row?.querySelector('.tick');
    if (!tick) return;
    if (fromText) row.querySelector(spec.title)?.blur();
    tick.click();
    if (!fromText) return;
    const back = () => { const t = rowOf(key)?.querySelector(spec.title); if (t && document.activeElement !== t) { t.focus(); t.setSelectionRange?.(t.value.length, t.value.length); } };
    requestAnimationFrame(back); setTimeout(back, 150); setTimeout(back, 400);
  };
  // Before inline.js takes Enter as "save and leave" (capture, on the list).
  const onDoneKey = ev => {
    if (ev.key !== 'Enter' || !(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey || ev.isComposing) return;
    const row = ev.target.closest?.(spec.title)?.closest(spec.row);
    if (!row || !root.contains(row)) return;
    ev.preventDefault();
    ev.stopPropagation();
    toggleDone(spec.key(row), true);
  };
  const onKey = ev => {
    if (ev.key === 'Escape' && editing && !ev.target.closest?.('.edit-pills select')) {
      // A note typed under the title is saved ("change", on leaving it) before the pills go.
      if (ev.target.closest?.('.edit-pills textarea, .edit-pills input')) ev.target.blur();
      close();
    }
    // Ctrl+Enter (⌘+Enter) in the note under the title: save it and finish, as in every note.
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && ev.target.closest?.('.edit-pills textarea')) {
      ev.preventDefault();
      ev.target.blur(); // "change" saves it
      close();
    }
  };
  // A date picked in a date pill arrives as "input", "change" or only when the
  // pill is left, depending on the browser and its picker: whichever comes
  // first saves it, once.
  const onChange = ev => {
    const f = ev.target.closest?.('.edit-pills [data-pill]');
    if (!f) return;
    if (ev.type === 'change') ev.stopPropagation();
    const isDate = f.type === 'date';
    if (isDate && touch && ev.type !== 'focusout') return;
    if (isDate && !f.value && f.validity.badInput) return; // half-typed (a Clear in the picker comes as "input" with nothing half-typed)
    if (isDate && f.dataset.sent === f.value) return;
    if (isDate) f.dataset.sent = f.value;
    else if (ev.type !== 'change') return;
    spec.change(f.closest('.edit-pills').dataset.key, f.dataset.pill, f.value);
  };
  const onClick = ev => {
    const pills = ev.target.closest?.('.edit-pills');
    if (!pills) return;
    const d = ev.target.closest('input[type="date"]');
    if (d) { try { d.showPicker(); } catch { /* the tap opens it */ } return; }
    const act = ev.target.closest('[data-pill-act]');
    if (act) { ev.stopPropagation(); spec.change(pills.dataset.key, act.dataset.pillAct, null); return; }
    if (ev.target.closest('[data-pill-done]')) { ev.stopPropagation(); toggleDone(pills.dataset.key, false); return; }
    if (ev.target.closest('[data-pill-more]')) {
      ev.stopPropagation();
      const row = rowOf(pills.dataset.key);
      const btn = row?.querySelector('[data-act="details"], [data-act="item-details"]');
      close();
      btn?.click();
    }
  };

  root.addEventListener('focusin', onFocus);
  const onLifted = () => { if (editing) close(); }; // held and lifted to be dragged (sortable.js)
  root.addEventListener('sortable-lift', onLifted);
  if (spec.done) root.addEventListener('keydown', onDoneKey, true);
  root.addEventListener('change', onChange, true);
  root.addEventListener('input', onChange, true);
  root.addEventListener('focusout', onChange, true);
  // The keyboard took the cursor out of the task to nowhere (Esc in its name):
  // its pills go too. (A click on a bare part of the row doesn't count.)
  let keyAt = 0;
  const onAnyKey = () => { keyAt = Date.now(); };
  addEventListener('keydown', onAnyKey, true);
  root.addEventListener('focusout', ev => {
    if (!editing || ev.relatedTarget || Date.now() - keyAt > 150) return;
    setTimeout(() => { if (editing && (document.activeElement === document.body || !document.activeElement) && !document.querySelector('.pill-menu, .ref-picker, dialog[open]')) close(); });
  });
  root.addEventListener('click', onClick, true);
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('keydown', onKey);
  // The list is redrawn after most changes: put the pills back under the same item.
  const watch = new MutationObserver(() => { if (editing) place(); });
  watch.observe(root, { childList: true, subtree: true });

  return {
    close,
    get editing() { return editing; },
    destroy() {
      removeEventListener('keydown', onAnyKey, true);
      root.removeEventListener('focusin', onFocus);
      root.removeEventListener('sortable-lift', onLifted);
      root.removeEventListener('keydown', onDoneKey, true);
      root.removeEventListener('change', onChange, true);
      root.removeEventListener('input', onChange, true);
      root.removeEventListener('focusout', onChange, true);
      root.removeEventListener('click', onClick, true);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
      watch.disconnect();
    },
  };
}

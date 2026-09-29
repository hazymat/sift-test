// Multi App Item Browsing with Keyboard. At an area's top level (nothing being
// edited: where ← / → change tabs and Ctrl+← / → change areas):
//   ↑, Esc   do nothing here (Esc still steps back from a record's page,
//            and clears a search left in the search box)
//   ↓        Tasks / Day Planner: start editing the first entry (Tasks with
//            its New task line at the top: that line) (↑ / ↓ then
//            walk the list, as while editing). Elsewhere: into the search box
//            above the items, if there is one; ↓ again starts browsing.
//            With nothing in the list yet, ↓ does what Enter does.
//   Enter    start typing a new one (New task, New note, Add items…)
// Browsing: one item is highlighted (.kb-cur, the same look in every area).
//   ← / →    previous / next item
//   ↑ / ↓    the item above / below, at about the same place across
//            (↑ from the top row goes back to the search box; in Brain
//            Dump, ↑ again goes up into New note, where the arrows are the
//            note's own until Esc)
//   Enter    open it: edit it (cursor at the end), or go into it
//   Alt+Enter  the same, going one level further in: a note opens full
//            screen (in a note being written, Alt+Enter does that too;
//            richtext.js). At the top level: a new one, full screen.
//   Esc      stop browsing. After editing an item, Esc leaves the editing and
//            the same item is highlighted again; Esc once more stops.
// A click anywhere, or changing page, stops browsing too.
// Areas with a filter bar (Brain Dump's All / Thought / Idea…) have it as a
// layer between the search box and the items: ↓ from the search box (or ← / →
// at the top level) highlights the filter showing; ← / → switch filter there
// and then (at either end: a flash, nothing changes); ↓ goes on to the items,
// and ↑ from their top row comes back to the bar, ↑ again to the search box.
// Esc in the search box goes back to the top level, keeping the search; Esc
// again there clears it.
// Tab / Shift+Tab still walk the page's buttons, links and filters (the
// browser's own ring shows where): Esc takes the cursor off them, back to
// the page, where the keys above work again (in every area).

import { caretTo } from './walk.js';

const $ = s => document.querySelector(s);
const vis = el => !!el && el.getClientRects().length > 0;
const all = sel => [...document.querySelectorAll(sel)].filter(vis);
const focusEnd = el => {
  if (!vis(el)) return false;
  el.focus();
  caretTo(el, 'end');
  return true;
};
const waitFor = (sel, ms = 1500) => new Promise(done => {
  const t0 = Date.now();
  const tick = () => { const e = $(sel); if (vis(e)) done(e); else if (Date.now() - t0 > ms) done(null); else setTimeout(tick, 40); };
  tick();
});
const click = el => { el?.click(); return !!el; };
// After Enter's job: the note now being written, full screen (as its ⤢ does).
const fullNow = () => {
  const rich = document.activeElement?.closest?.('.rich');
  if (rich && !rich.classList.contains('is-full')) rich.querySelector('.md-full')?.click();
};

// Per area: the search box above the items, the items, what Enter does to one
// (open), and what ↓ / Enter do at the top level (down / enter).
const AREAS = {
  dump: {
    search: '#dump-q',
    bar: '#dump-filter [data-filter]',
    aboveSearch: () => focusEnd($('.dump-capture .rich-edit')),
    items: '#thoughts > li[data-id]',
    enter: () => focusEnd($('.dump-capture .rich-edit')),
    async open(li) {
      click(li.querySelector('[data-act="edit"]'));
      const ed = await waitFor(`#thoughts [data-id="${li.dataset.id}"] .thought-edit [contenteditable]`);
      if (ed) focusEnd(ed);
    },
  },
  tasks: {
    // The New task line is at the top: ↓ starts typing there too.
    down: () => focusEnd($('#task-new')),
    enter: () => focusEnd($('#task-new')),
  },
  planner: {
    down: () => focusEnd(all('#lines .line.has-item .item-title')[0] || all('#main .line.has-item .item-title')[0]) || focusEnd($('#dump')),
    enter: () => focusEnd($('#dump')),
  },
  lists: {
    items: '#main .project-grid .list-card, #main li[data-id]:has(> input[name="text"])',
    enter: () => focusEnd($('#list-new')),
    open: el => (el.matches('a') ? click(el) : focusEnd(el.querySelector('input[name="text"]'))),
  },
  places: {
    search: '#find-q, #box-q',
    items: '#main .box-card, #main li[data-item]:not(.thing-panel)',
    enter: () => focusEnd($('#new-items')),
    open: el => (el.matches('.box-card') ? click(el) : focusEnd(el.querySelector('input[name="name"]'))),
  },
  contacts: {
    search: '#c-q',
    items: '#main .c-card',
    enter: () => focusEnd($('#c-new')),
    open: el => click(el.querySelector('a.c-main')),
  },
  scans: { search: '.scan-search', items: '#main .scan-card', open: el => click(el) },
  recipes: { search: '.bb-search', bar: '#main .bb-sections [data-section]', items: '#main .bb-cards > li[data-id], #main .bb-shared > li, #main .bb-batch-list > li[data-id], #main div.bb-batches > .bb-batch-row', open: el => click(el.querySelector('.bb-card, .bb-batch-row') || el) },
  contracts: { search: '.contract-search', items: '#main tr[data-id], #main .contract-card', open: el => click(el.querySelector('a') || el) },
};

let on = false;
let goTo = null;
// Outline this item (e.g. the next note, after the outlined one was archived).
export const browseTo = el => { if (el) goTo?.(el); };
let inBar = false; // browsing the filter bar, not the items
let barPick = null; // the filter just switched to (the page marks it a moment later)
let key = null;
const keyOf = el => el.dataset.id || el.dataset.box || el.getAttribute('href') || '';

// The item above / below: one overlapping the same place across if there is
// one (a grid's column, a masonry column), the nearest such; else the closest
// across in the nearest row.
function nearest(list, from, dir) {
  const r = from.getBoundingClientRect();
  const x = (r.left + r.right) / 2;
  const cand = list.filter(e => e !== from).map(e => ({ e, q: e.getBoundingClientRect() }))
    .filter(({ q }) => (dir > 0 ? q.top >= r.bottom - 4 : q.bottom <= r.top + 4));
  if (!cand.length) return null;
  const gap = ({ q }) => (dir > 0 ? q.top - r.bottom : r.top - q.bottom);
  const over = cand.filter(({ q }) => q.left <= x && q.right >= x);
  if (over.length) return over.reduce((a, b) => (gap(b) < gap(a) ? b : a)).e;
  const row = Math.min(...cand.map(gap));
  return cand.filter(c => gap(c) <= row + 8)
    .reduce((a, b) => (Math.abs((b.q.left + b.q.right) / 2 - x) < Math.abs((a.q.left + a.q.right) / 2 - x) ? b : a)).e;
}

export function installBrowse({ busy, area }) {
  const cfg = () => AREAS[area()];
  const items = c => (c?.items ? all(c.items) : []);
  const current = c => items(c).find(e => keyOf(e) === key) || null;
  const bar = c => (c?.bar ? all(c.bar) : []);
  const barId = b => b.dataset.filter || b.textContent;
  const pressed = c => (barPick && bar(c).find(b => barId(b) === barPick))
    || bar(c).find(b => b.getAttribute('aria-pressed') === 'true') || bar(c)[0] || null;
  const paint = () => {
    const c = cfg();
    const cur = on && !busy() ? (inBar ? pressed(c) : current(c)) : null;
    for (const e of document.querySelectorAll('.kb-cur')) if (e !== cur) e.classList.remove('kb-cur');
    cur?.classList.add('kb-cur');
  };
  let queued = 0;
  const later = () => { if (!queued) queued = setTimeout(() => { queued = 0; paint(); }, 30); };
  const go = el => {
    key = keyOf(el);
    on = true;
    inBar = false;
    paint();
    el.scrollIntoView({ block: 'nearest' });
  };
  goTo = go;
  const stop = () => { on = false; inBar = false; key = null; barPick = null; paint(); };
  const goBar = () => { on = true; inBar = true; paint(); pressed(cfg())?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); };
  const flash = el => {
    if (!el) return;
    el.classList.remove('kb-flash');
    void el.offsetWidth; // start the animation again
    el.classList.add('kb-flash');
    setTimeout(() => el.classList.remove('kb-flash'), 600);
  };
  // ← / → on the bar: the next filter, switched to at once; at an end, a flash.
  const moveBar = (c, dir) => {
    const btns = bar(c);
    const at = btns.indexOf(pressed(c));
    const to = btns[at + dir];
    goBar();
    if (to) { barPick = barId(to); to.click(); paint(); } else flash(btns[at]);
  };
  const take = ev => { ev.preventDefault(); ev.stopPropagation(); };

  addEventListener('keydown', ev => {
    const deeper = ev.altKey && ev.key === 'Enter';
    if ((ev.altKey && !deeper) || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.isComposing) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(ev.key)) return;
    const t = ev.target;
    if (ev.key === 'Escape' && !deeper && t !== document.body && t.matches?.('a, button, summary, [tabindex]:not([contenteditable]), input[type="checkbox"], input[type="radio"]')
      && !t.closest('dialog, .pill-menu, .dd-menu, .ref-picker, .thought-pop, details[open], .item-details, .task-details, .thing-panel, .list-panel')) {
      take(ev);
      t.blur();
      later();
      return;
    }
    const c = cfg();
    if (!c) return;
    // In the search box: ↓ goes on to browse what it found.
    if (c.search && t.matches?.(c.search)) {
      const first = items(c)[0];
      if (ev.key === 'Escape') { take(ev); t.blur(); stop(); }
      else if (ev.key === 'ArrowDown' && bar(c).length) { take(ev); t.blur(); goBar(); }
      else if (ev.key === 'ArrowDown' && first) { take(ev); t.blur(); go(first); }
      else if (ev.key === 'ArrowDown' && c.enter?.()) take(ev);
      else if (ev.key === 'ArrowUp' && c.aboveSearch?.()) take(ev);
      return;
    }
    if (busy()) return;
    const list = items(c);
    if (on) {
      if (ev.key === 'Escape') { take(ev); stop(); return; }
      if (inBar) {
        take(ev);
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') moveBar(c, ev.key === 'ArrowLeft' ? -1 : 1);
        else if (ev.key === 'ArrowDown' || ev.key === 'Enter') { if (list[0]) go(list[0]); }
        else if (ev.key === 'ArrowUp') { const s = c.search && all(c.search)[0]; stop(); s?.focus(); }
        return;
      }
      const cur = current(c);
      if (ev.key === 'Enter') { if (cur) { take(ev); Promise.resolve(c.open?.(cur)).then(() => { if (deeper) setTimeout(fullNow, 50); }); } return; }
      take(ev);
      if (!cur) { if (list[0]) go(list[0]); return; }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        const to = list[list.indexOf(cur) + (ev.key === 'ArrowLeft' ? -1 : 1)];
        if (to) go(to);
        return;
      }
      const to = nearest(list, cur, ev.key === 'ArrowDown' ? 1 : -1);
      if (to) go(to);
      else if (ev.key === 'ArrowUp' && bar(c).length) goBar();
      else if (ev.key === 'ArrowUp' && c.search) { const s = all(c.search)[0]; if (s) { stop(); s.focus(); } }
      return;
    }
    // The top level: only when nothing in particular has the keyboard (a
    // button or link with focus keeps its own Enter).
    if (t !== document.body && t !== document.documentElement && t.closest?.('a, button, summary, [role="button"], [tabindex], input, textarea, select')) return;
    // Esc after leaving the search box (the search kept): a second Esc clears it.
    if (ev.key === 'Escape') {
      const s = c.search && all(c.search).find(e => e.value);
      if (s) { take(ev); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); }
      return;
    }
    if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && bar(c).length) { take(ev); moveBar(c, ev.key === 'ArrowLeft' ? -1 : 1); return; }
    if (ev.key === 'ArrowDown') {
      let done = false;
      if (c.down) done = c.down();
      else if (c.search && all(c.search)[0]) { all(c.search)[0].focus(); done = true; }
      else if (list[0]) { go(list[0]); done = true; }
      else done = !!c.enter?.();
      if (done) take(ev);
    } else if (ev.key === 'Enter' && c.enter?.()) { take(ev); if (deeper) fullNow(); }
  }, true);

  addEventListener('pointerdown', () => { if (on) stop(); }, true);
  addEventListener('hashchange', () => { barPick = null; if (on) stop(); });
  // Editing hides the highlight; leaving the editing (or a redraw) brings it back.
  addEventListener('focusin', later);
  addEventListener('focusout', later);
  new MutationObserver(() => { if (on) later(); }).observe(document.body, { childList: true, subtree: true });
}

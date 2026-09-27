// Find Things: life areas (tabs; stored as kind "edition") → sections → box
// cards. Tapping a card zooms into the box (#/find-things/<box id>); Back zooms
// out again. Search across all life areas, CSV import/export.

import { cogHtml } from '../viewcog.js';
import { loadTree, search, importCsv, exportCsv, archivedMatchCount, splitQuantity } from '../places.js';
import { richText, previewLine } from '../richtext.js';
import { createListKit } from '../listkit.js';
import { listEntry, listHint, SHORTCUT } from '../listentry.js';
import { toast, undoable } from '../toast.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const EDITION_KEY = 'sift-find-edition';
// What the headings holding boxes are called (stored as kind "section").
const GROUP = { one: 'group', One: 'Group' };
const ZOOM = 'box-zoom'; // view-transition-name shared by a card and its box page

function remember(key, value) {
  try { siftTestStorage.setItem(key, value); } catch {}
}
function recall(key) {
  try { return siftTestStorage.getItem(key); } catch { return null; }
}

// Animate a DOM change as a zoom between a card and the box page, where the
// browser supports view transitions; otherwise just make the change. With
// "reduce motion" on, the zoom still runs, a little quicker (see app.css).
async function zoom(update) {
  if (!document.startViewTransition) return update();
  const t = document.startViewTransition(update);
  await t.finished.catch(() => {});
}

export default {
  async mount(el, { store }) {
    let tree = [];
    let editionId = recall(EDITION_KEY);
    let query = '';
    let openId = null; // box currently zoomed into
    let gridScroll = 0;

    el.innerHTML = `
      <div id="find-grid">
        <div class="find-bar">
          <input type="search" id="find-q" class="search" placeholder="Find anything… (press /)" autocomplete="off" enterkeyhint="search">
        </div>
        <div class="find-tools">
          <div class="segmented" id="editions" role="tablist" aria-label="Life areas"></div>
          ${cogHtml('places')}
          <details class="tool-menu">
            <summary class="icon-btn" aria-label="More actions">${icon('i-more')}</summary>
            <div class="menu">
              <button type="button" data-act="add-box">Add box</button>
              <button type="button" data-act="add-section">Add ${GROUP.one}</button>
              <button type="button" data-act="add-edition">New life area</button>
              <button type="button" data-act="rename-edition">Rename life area</button>
              <button type="button" data-act="import">Import CSV</button>
              <button type="button" data-act="export">Export CSV</button>
              <button type="button" data-act="split-quantities">Split "3x …" quantities out of names</button>
              <hr>
              <a href="#/bin/archive/places">Archive</a>
              <a href="#/bin/bin/places">Bin</a>
            </div>
          </details>
        </div>
        <div id="find-body"></div>
      </div>
      <div id="box-page" hidden></div>

      <dialog class="sheet" id="import-sheet" aria-label="Import CSV">
        <div class="sheet-handle"></div>
        <h2>Import CSV</h2>
        <p class="muted">One row per item. Columns: <code>life_area, group, box_code, box_name, box_location, box_notes, item, item_notes</code>. Only a box name or code is required. Anything already here is kept; importing the same file twice won't duplicate it.</p>
        <p><input type="file" id="import-file" accept=".csv,text/csv"></p>
        <p class="muted">or paste it:</p>
        <textarea id="import-text" rows="6" placeholder="box_code,box_name,item&#10;A,Electronics,555 timers"></textarea>
        <p id="import-result" class="muted"></p>
        <div class="sheet-actions">
          <button type="button" data-close>Close</button>
          <button type="button" class="primary" id="import-go">Import</button>
        </div>
      </dialog>
    `;

    const grid = el.querySelector('#find-grid');
    const body = el.querySelector('#find-body');
    const page = el.querySelector('#box-page');
    const q = el.querySelector('#find-q');
    const importSheet = el.querySelector('#import-sheet');

    // ---------- grid ----------

    const edition = () => tree.find(e => e.id === editionId) || tree[0];

    // Items show as pills so short ones share a line; the pill area is
    // clipped to a few lines and fitPills() fills in "+ n more".
    function card(box, { path, highlight } = {}) {
      const items = highlight ?? box.items;
      return `<div class="box-card${box.label_code ? '' : ' no-code'}" data-box="${box.id}" role="button" tabindex="0" aria-label="${esc(box.label_code ? `${box.label_code} ${box.name}` : box.name)}">
        ${path ? `<span class="box-path">${esc(path)}</span>` : ''}
        <span class="box-head">
          ${box.label_code ? `<span class="box-code">${esc(box.label_code)}</span>` : ''}
          <span class="box-name">${esc(box.name || 'Untitled box')}</span>
        </span>
        ${box.location_note ? `<span class="box-where">${esc(box.location_note)}</span>` : ''}
        <span class="box-pills${highlight ? ' all' : ''}">${items.map(i => `<span class="item-pill${i.depth ? ' sub' : ''}">${esc(i.name)}</span>`).join('')}</span>
        <span class="muted box-more"></span>
        <input class="quick-add" data-add="${box.id}" placeholder="+ item" aria-label="Add item to ${esc(box.label_code || box.name)}" enterkeyhint="done" autocomplete="off">
      </div>`;
    }

    function fitPills(root = body) {
      for (const wrap of root.querySelectorAll('.box-pills:not(.all)')) {
        for (const pill of wrap.children) pill.style.display = '';
        const limit = wrap.getBoundingClientRect().bottom;
        let hidden = 0;
        for (const pill of wrap.children) {
          if (pill.getBoundingClientRect().bottom > limit + 1) hidden++;
        }
        // Measure first, then take the overflow out of the layout.
        if (hidden) [...wrap.children].slice(-hidden).forEach(pill => { pill.style.display = 'none'; });
        wrap.nextElementSibling.textContent = hidden ? `+ ${hidden} more` : (wrap.children.length ? '' : 'Empty');
      }
    }

    function renderGrid() {
      const tabs = el.querySelector('#editions');
      const current = edition();
      tabs.innerHTML = tree.map(e =>
        `<button type="button" role="tab" data-edition="${e.id}" aria-pressed="${e.id === current?.id}">${esc(e.name)}</button>`
      ).join('');
      tabs.hidden = query !== '' || tree.length === 0;

      if (query) {
        const results = search(tree, query);
        const count = results.reduce((n, r) => n + (r.items.length || 1), 0);
        body.innerHTML = results.length
          ? `<p class="muted result-count">${count} match${count === 1 ? '' : 'es'}</p>
             <div class="box-grid">${results.map(r => card(r.box, {
               path: `${r.edition.name} › ${r.section.name}`,
               highlight: r.boxMatch && !r.items.length ? null : r.items,
             })).join('')}</div>`
          : `<div class="empty"><h2>Nothing found</h2><p class="muted">Try fewer or different words.</p></div>`;
        body.insertAdjacentHTML('beforeend', '<p class="archive-hint" hidden></p>');
        const asked = query;
        archivedMatchCount(query).then(n => {
          const hint = body.querySelector('.archive-hint');
          if (!n || !hint || asked !== query) return;
          hint.innerHTML = `<a href="#/bin/archive/places/${encodeURIComponent(query)}">+ ${n} in archive</a>`;
          hint.hidden = false;
        });
        requestAnimationFrame(() => fitPills());
        return;
      }
      if (!current) {
        body.innerHTML = `<div class="empty">
          <h2>Where is everything?</h2>
          <p class="muted">Import a CSV of your boxes, or start adding them.</p>
          <p><button type="button" class="primary" data-act="import">Import CSV</button>
             <button type="button" data-act="add-box">Add a box</button></p>
        </div>`;
        return;
      }
      body.innerHTML = current.sections.map(s => `
        <section class="find-section">
          <h2>${esc(s.name)}${s.location_note ? ` <span class="box-where">${esc(s.location_note)}</span>` : ''}</h2>
          <div class="box-grid">${s.boxes.map(b => card(b)).join('')}
            <button type="button" class="box-card add-card" data-act="add-box" data-section="${s.id}">+ Add box</button>
          </div>
        </section>`).join('') || '<div class="empty"><p class="muted">No boxes in this life area yet.</p></div>';
      requestAnimationFrame(() => fitPills());
    }

    // ---------- box page ----------

    const findBox = id => {
      for (const e of tree) for (const s of e.sections) for (const b of s.boxes) if (b.id === id) return { e, s, b };
      return null;
    };

    function renderPage() {
      const found = findBox(openId);
      if (!found) return false;
      const { e, s, b } = found;
      const sections = tree.flatMap(ed => ed.sections.map(sec => ({ id: sec.id, label: `${ed.name} › ${sec.name}` })));
      page.innerHTML = `
        <div class="box-page-bar">
          <button type="button" class="back" data-act="back">‹ ${esc(s.name)}</button>
          <span class="muted box-path">${esc(e.name)}</span>
        </div>
        <div class="find-bar box-find">
          <input type="search" id="box-q" class="search" placeholder="Search in this box…" value="${esc(query)}" autocomplete="off" enterkeyhint="search">
          <span class="muted box-hits" aria-live="polite"></span>
        </div>
        <article class="box-page">
          <header class="box-page-head">
            <input class="box-code-input" name="label_code" value="${esc(b.label_code)}" placeholder="Label" aria-label="Label (what is written on it, e.g. BB)" title="Label: what is written on it, e.g. BB" autocomplete="off">
            <input class="box-name-input" name="name" value="${esc(b.name)}" placeholder="Box name" aria-label="Name" autocomplete="off">
          </header>
          <div class="box-fields">
            <label>Where it lives<input name="location_note" value="${esc(b.location_note)}" placeholder="e.g. Under desk back" autocomplete="off"></label>
            <label>Notes<input name="notes" value="${esc(b.notes)}" placeholder="e.g. 9L Really Useful" autocomplete="off"></label>
          </div>
          <h3>Contents <span class="muted">${b.items.length}</span></h3>
          <ul class="item-list">${b.items.map(i => `
            <li data-id="${i.id}" data-item="${i.id}" data-depth="${i.depth}">
              <button type="button" class="drag-handle" aria-label="Select or move ${esc(i.name)}">${icon('i-grip')}</button>
              <input name="name" value="${esc(i.name)}" aria-label="Item">
              ${i.quantity ? `<span class="span-tag qty" title="Quantity">×${i.quantity}</span>` : ''}
              <button type="button" class="more" data-act="item-details" aria-label="Details" aria-expanded="${openItem === i.id}">⋯</button>
              ${thingSub(i)}
            </li>
            ${openItem === i.id ? thingPanel(i) : ''}`).join('')}
          </ul>
          <datalist id="thing-tags">${allTags().map(t => `<option value="${esc(t)}">`).join('')}</datalist>
          <textarea id="new-items" class="list-entry" rows="2" placeholder="Add items"></textarea>
          <p class="muted hint">${listHint()} ≡: tap to select, swipe down the ≡ column to select several, press and hold to drag (sideways to indent; or Tab / Shift+Tab). Changes save as you go; Esc closes.</p>
          <div class="sheet-actions">
            <button type="button" data-act="add-items">Add items <kbd>${SHORTCUT}</kbd></button>
            <span class="spacer"></span>
            <label class="inline">Move to <select name="parent_place_id">${sections.map(o => `<option value="${o.id}" ${o.id === s.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
            <button type="button" data-act="archive-box">Archive box</button>
            <button type="button" class="danger" data-act="delete-box">Delete box</button>
          </div>
        </article>`;
      kit.attach(page.querySelector('.item-list'));
      addItems = listEntry(page.querySelector('#new-items'), addLines, { draft: `places:${openId}` });
      mountThingNotes();
      page.querySelector('#box-q').addEventListener('input', ev => {
        query = ev.target.value.trim(); // the same search as the grid's; stays in this box
        q.value = ev.target.value;
        markHits();
      });
      markHits(true);
      return true;
    }

    // ---------- a thing's panel: note, quantity, tags ----------

    let openItem = null; // thing whose panel is open
    let pendingNote = null;
    let noteTimer;
    const allTags = () => [...new Set(tree.flatMap(e => e.sections.flatMap(s => s.boxes.flatMap(b => b.items.flatMap(i => i.tags || [])))))].sort((a, b) => a.localeCompare(b));

    // Under the name: tags (click one to find everything with it), then the
    // note's first line (click to open the panel).
    function thingSub(i) {
      const tags = (i.tags || []).map(t => `<button type="button" class="pill-act tag-pill" data-act="tag-search" data-tag="${esc(t)}" title="Find everything tagged ${esc(t)}">#${esc(t)}</button>`).join('');
      const { html, more } = previewLine(i.notes || '');
      const note = html ? `<span class="item-note" data-act="item-details" role="button" tabindex="0" title="${openItem === i.id ? 'Close' : 'Open to read or edit'}"><span class="note-emoji" aria-hidden="true">📝</span>${html}${more ? ` <span class="more-lines">+${more} more</span>` : ''}</span>` : '';
      return tags || note ? `<div class="item-sub">${tags}${note}</div>` : '';
    }

    function thingPanel(i) {
      return `<li class="thing-panel item-details" data-item="${i.id}" data-for="${i.id}">
        <div class="detail-grid">
          <label>Quantity<input type="number" name="quantity" min="0" step="1" value="${i.quantity ?? ''}" placeholder="—" inputmode="numeric"></label>
          <div class="wide tag-edit"><span class="field-label">Tags</span>
            <span class="tag-list">${(i.tags || []).map(t => `<span class="chip">#${esc(t)} <button type="button" class="chip-x" data-act="remove-tag" data-tag="${esc(t)}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join('')}</span>
            <input class="tag-add no-inline" list="thing-tags" placeholder="+ tag (Enter)" aria-label="Add a tag" autocomplete="off">
          </div>
          <div class="wide"><span class="field-label">Note</span><div class="thing-notes"></div></div>
        </div>
        <div class="detail-actions">
          <button type="button" class="close-details" data-act="close-item">Close</button>
          <span class="spacer"></span>
          <button type="button" class="danger" data-act="delete-item">Delete</button>
        </div>
      </li>`;
    }

    function mountThingNotes() {
      const box = page.querySelector('.thing-panel .thing-notes');
      if (!box || !openItem) return;
      const id = openItem;
      const it = findBox(openId)?.b.items.find(x => x.id === id);
      richText(box, {
        value: it?.notes || '',
        origin: () => ({ collection: 'items', id, title: it?.name, field: 'notes' }),
        onChange: md => { clearTimeout(noteTimer); pendingNote = { id, md }; noteTimer = setTimeout(flushThingNote, 600); },
      });
    }
    async function flushThingNote() {
      clearTimeout(noteTimer);
      const p = pendingNote;
      pendingNote = null;
      if (p) { await store.update('items', p.id, { notes: p.md }); tree = await loadTree(); }
    }
    async function toggleThing(id) {
      await flushThingNote();
      openItem = openItem === id ? null : id;
      renderPage();
      markHits();
    }
    async function setTags(id, tags, label) {
      const before = (await store.get('items', id))?.tags || [];
      await store.update('items', id, { tags });
      await reload();
      markHits();
      page.querySelector('.thing-panel .tag-add')?.focus();
      undoable(label, async () => { await store.update('items', id, { tags: before }); await reload(); });
    }

    // Clicking outside the open panel (and its thing) closes it.
    this.onThingPointer = ev => {
      if (!openItem || !el.isConnected) return;
      if (ev.target.closest(`[data-item="${openItem}"], dialog, .toast, .ref-picker, .ref-menu, .pill-menu`)) return;
      toggleThing(openItem);
    };
    document.addEventListener('pointerdown', this.onThingPointer, true);
    page.addEventListener('keydown', ev => {
      const t = ev.target;
      if (!t.classList?.contains('tag-add') || ev.key !== 'Enter') return;
      ev.preventDefault();
      const tag = t.value.trim().replace(/^#/, '');
      const id = t.closest('[data-item]')?.dataset.item;
      const it = findBox(openId)?.b.items.find(x => x.id === id);
      if (!tag || !it) return;
      if ((it.tags || []).some(x => x.toLowerCase() === tag.toLowerCase())) { t.value = ''; return; }
      setTags(id, [...(it.tags || []), tag], `Tagged #${tag}`);
    });

    // In a box, things matching the search are marked like a highlighter
    // pen; the first one is scrolled into view when the box opens.
    function markHits(scroll = false) {
      const found = findBox(openId);
      if (!found) return;
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      let n = 0;
      for (const li of page.querySelectorAll('.item-list li[data-id]')) {
        const it = found.b.items.find(i => i.id === li.dataset.item);
        const text = `${it?.name || ''} ${it?.notes || ''} ${(it?.tags || []).join(' ')}`.toLowerCase();
        const hit = words.length > 0 && words.every(w => text.includes(w));
        li.classList.toggle('hit', hit);
        if (hit) n++;
      }
      const out = page.querySelector('.box-hits');
      if (out) out.textContent = words.length ? (n ? `${n} found` : 'Not in this box') : '';
      if (scroll && n) page.querySelector('.item-list .hit')?.scrollIntoView({ block: 'center' });
    }

    // Lines from the list entry → items; sub-lines go under the line above
    // (or under the last top-level item already in the box).
    let addItems = () => {};
    async function addLines(lines) {
      const existing = findBox(openId)?.b.items || [];
      let parent = existing.filter(i => !i.depth).at(-1)?.id || null;
      let n = existing.length;
      const made = [];
      for (const line of lines) {
        const sub = line.sub && parent;
        const item = await store.create('items', { ...splitQuantity(line.text), place_id: openId, parent_item_id: sub ? parent : null, notes: '', sort_order: n++, last_moved_at: null });
        made.push(item.id);
        if (!sub) parent = item.id;
      }
      await reload();
      page.querySelector('#new-items')?.focus();
      undoable(`Added ${made.length} item${made.length === 1 ? '' : 's'}`, async () => {
        for (const id of made) await store.remove('items', id);
        await reload();
      });
    }

    // Persist the list as the kit reports it: order, and each sub-item's
    // parent (the nearest top-level item above it).
    async function persistOrder(rows, label = 'Moved') {
      const before = (findBox(openId)?.b.items || []).map(i => [i.id, { sort_order: i.sort_order, parent_item_id: i.parent_item_id || null }]);
      let parent = null;
      const changes = rows.map((r, n) => {
        const sub = r.depth > 0 && parent;
        if (!sub) parent = r.id;
        return [r.id, { sort_order: n, parent_item_id: sub ? parent : null }];
      });
      await store.updateMany('items', changes);
      tree = await loadTree();
      undoable(label, async () => {
        await store.updateMany('items', before);
        await reload();
      });
    }

    // Selected items plus their sub-items.
    const withSubs = ids => {
      const items = findBox(openId)?.b.items || [];
      return [...new Set([...ids, ...items.filter(i => ids.includes(i.parent_item_id)).map(i => i.id)])];
    };
    async function batch(ids, field, label) {
      const all = withSubs(ids);
      const now = new Date().toISOString();
      await store.updateMany('items', all.map(id => [id, { [field]: now }]));
      await reload();
      undoable(`${label} ${all.length} item${all.length === 1 ? '' : 's'}`, async () => {
        await store.updateMany('items', all.map(id => [id, { [field]: null }]));
        await reload();
      });
    }

    const kit = this.kit = createListKit({
      reorder: true,
      indent: true,
      maxDepth: 1,
      noun: 'item',
      onReorder: (rows, label) => persistOrder(rows, label),
      actions: [
        { id: 'archive', label: 'Archive', run: ids => batch(ids, 'archived_at', 'Archived') },
        { id: 'delete', label: 'Delete', danger: true, run: ids => batch(ids, 'deleted_at', 'Removed') },
      ],
    });

    // Show the grid or the open box.    // Show the grid or the open box. `name` pairs the card and page for the zoom.
    function show() {
      const opening = openId && renderPage();
      grid.hidden = !!opening;
      page.hidden = !opening;
      if (!opening) {
        q.value = query; // a search changed inside a box carries back out
        renderGrid();
        const back = el.querySelector(`[data-box="${CSS.escape(page.dataset.was || '')}"]`);
        if (back) back.style.viewTransitionName = ZOOM;
        scrollTo(0, gridScroll);
      } else {
        page.querySelector('.box-page').style.viewTransitionName = ZOOM;
        scrollTo(0, 0);
      }
    }

    async function openBox(id) {
      if (id === openId) return;
      kit.clear();
      const leaving = openId;
      if (id) {
        gridScroll = scrollY;
        el.querySelectorAll('.box-card').forEach(c => { c.style.viewTransitionName = c.dataset.box === id ? ZOOM : ''; });
      } else if (leaving) {
        const open = page.querySelector('.box-page');
        if (open) open.style.viewTransitionName = ZOOM; // shrinks back into its card
      }
      page.dataset.was = leaving || '';
      await zoom(() => { openId = id; show(); });
      el.querySelectorAll('[style*="view-transition-name"]').forEach(n => { n.style.viewTransitionName = ''; });
    }

    async function reload() {
      tree = await loadTree();
      if (openId && !findBox(openId)) openId = null;
      openId ? renderPage() : renderGrid();
    }

    // Returns true if something changed.
    async function saveField(t) {
      if (!t?.name || !page.contains(t) || t.id === 'new-items') return false;
      const itemLi = t.closest('[data-item]');
      const [collection, id] = itemLi ? ['items', itemLi.dataset.item] : ['places', openId];
      const old = (await store.get(collection, id))?.[t.name] ?? '';
      const value = t.name === 'quantity' ? (t.value.trim() === '' ? null : Math.max(0, Math.round(Number(t.value)))) : t.value.trim();
      if (value === (old ?? '') || (t.name === 'quantity' && value === (old ?? null))) return false;
      await store.update(collection, id, { [t.name]: value });
      if (t.name === 'parent_place_id') await reload();
      tree = await loadTree(); // keep the grid behind in step
      undoable('Saved', async () => {
        await store.update(collection, id, { [t.name]: old });
        await reload();
      });
      return true;
    }
    page.addEventListener('change', ev => saveField(ev.target));

    // Escape anywhere in a box: save what's being typed (including lines not
    // yet added), then zoom back out.
    async function saveAndClose() {
      const active = document.activeElement;
      let changed = false;
      if (active?.id === 'new-items' && active.value.trim()) { await addItems(); changed = true; }
      else changed = await saveField(active);
      active?.blur?.();
      if (!changed) toast('✓ Saved'); // a change shows its own "… · Undo" toast
      act('back');
    }

    // ---------- actions ----------

    async function act(name, target) {
      const current = edition();
      if (name === 'back') {
        history.length > 1 ? history.back() : (location.hash = '#/find-things');
      } else if (name === 'add-items') {
        await addItems();
      } else if (name === 'archive-box') {
        const { b: box } = findBox(openId);
        const boxId = openId;
        await store.update('places', boxId, { archived_at: new Date().toISOString() });
        tree = await loadTree();
        location.hash = '#/find-things';
        undoable(`Archived box ${box.label_code || box.name || ''}`.trim(), async () => {
          await store.update('places', boxId, { archived_at: null });
          await reload();
        });
      } else if (name === 'item-details') {
        await toggleThing(target.closest('[data-item]').dataset.item);
      } else if (name === 'close-item') {
        await toggleThing(openItem);
      } else if (name === 'remove-tag') {
        const id = target.closest('[data-item]').dataset.item;
        const it = findBox(openId)?.b.items.find(x => x.id === id);
        await setTags(id, (it?.tags || []).filter(x => x !== target.dataset.tag), `Removed #${target.dataset.tag}`);
      } else if (name === 'tag-search') {
        await flushThingNote();
        openItem = null;
        query = target.dataset.tag;
        q.value = query;
        location.hash = '#/find-things';
      } else if (name === 'split-quantities') {
        const all = tree.flatMap(e => e.sections.flatMap(s => s.boxes.flatMap(b => b.items)));
        const changes = all.map(i => [i, splitQuantity(i.name)]).filter(([i, s]) => s.quantity && !i.quantity);
        if (!changes.length) return toast('No names start with a quantity like "3x"');
        if (!confirm(`Move the quantity out of ${changes.length} name${changes.length === 1 ? '' : 's'} (e.g. "3x Ethernet kits" → "Ethernet kits", quantity 3)?`)) return;
        await store.updateMany('items', changes.map(([i, s]) => [i.id, { name: s.name, quantity: s.quantity }]));
        await reload();
        undoable(`Quantities split out of ${changes.length} name${changes.length === 1 ? '' : 's'}`, async () => {
          await store.updateMany('items', changes.map(([i]) => [i.id, { name: i.name, quantity: i.quantity ?? null }]));
          await reload();
        });
      } else if (name === 'delete-item') {
        if (openItem) { await flushThingNote(); openItem = null; }
        const id = target.closest('[data-item]').dataset.item;
        const items = findBox(openId)?.b.items || [];
        const gone = [id, ...items.filter(i => i.parent_item_id === id).map(i => i.id)];
        const label = items.find(i => i.id === id)?.name || 'item';
        for (const g of gone) await store.remove('items', g);
        await reload();
        undoable(`Removed "${label}"${gone.length > 1 ? ` and ${gone.length - 1} sub-item${gone.length > 2 ? 's' : ''}` : ''}`, async () => {
          for (const g of gone) await store.restore('items', g);
          await reload();
        });
      } else if (name === 'delete-box') {
        const { b: box } = findBox(openId);
        const boxId = openId;
        const itemIds = box.items.map(i => i.id);
        await store.updateMany('items', itemIds.map(i => [i, { deleted_at: new Date().toISOString() }]));
        await store.remove('places', boxId);
        tree = await loadTree();
        location.hash = '#/find-things';
        undoable(`Deleted box ${box.label_code || box.name || ''}`.trim(), async () => {
          await store.restore('places', boxId);
          await store.updateMany('items', itemIds.map(i => [i, { deleted_at: null }]));
          await reload();
        });
      } else if (name === 'import') {
        importSheet.querySelector('#import-result').textContent = '';
        importSheet.showModal();
      } else if (name === 'export') {
        const blob = new Blob([await exportCsv()], { type: 'text/csv' });
        const a = Object.assign(document.createElement('a'), {
          href: URL.createObjectURL(blob),
          download: `sift-find-things-${new Date().toISOString().slice(0, 10)}.csv`,
        });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } else if (name === 'add-edition') {
        const n = prompt('Name for the new life area (e.g. Home, Build, Garage):');
        if (!n?.trim()) return;
        const e = await store.create('places', { kind: 'edition', name: n.trim(), parent_place_id: null, notes: '', sort_order: tree.length });
        editionId = e.id; remember(EDITION_KEY, e.id);
        await reload();
      } else if (name === 'rename-edition' && current) {
        const n = prompt('Rename life area:', current.name);
        if (n?.trim()) { await store.update('places', current.id, { name: n.trim() }); await reload(); }
      } else if (name === 'add-section') {
        const ed = current || await store.create('places', { kind: 'edition', name: 'Standard', parent_place_id: null, notes: '', sort_order: 0 });
        const n = prompt(`${GROUP.One} name (e.g. Wardrobe, Garage shelves):`);
        if (!n?.trim()) return;
        await store.create('places', { kind: 'section', name: n.trim(), parent_place_id: ed.id, location_note: '', notes: '', sort_order: current?.sections.length || 0 });
        await reload();
      } else if (name === 'add-box') {
        let sectionId = target?.dataset.section;
        if (!sectionId) {
          const ed = current || await store.create('places', { kind: 'edition', name: 'Standard', parent_place_id: null, notes: '', sort_order: 0 });
          const sec = current?.sections.at(-1) || await store.create('places', { kind: 'section', name: 'Boxes', parent_place_id: ed.id, location_note: '', notes: '', sort_order: 0 });
          sectionId = sec.id;
        }
        const count = tree.flatMap(e => e.sections).find(s => s.id === sectionId)?.boxes.length || 0;
        const box = await store.create('places', { kind: 'box', name: '', label_code: '', parent_place_id: sectionId, location_note: '', notes: '', sort_order: count });
        tree = await loadTree();
        location.hash = `#/find-things/${box.id}`;
      }
    }

    // Inline add on a card: Enter adds the item and keeps the field ready.
    body.addEventListener('keydown', async ev => {
      const input = ev.target.closest('.quick-add');
      if (input) {
        if (ev.key !== 'Enter' || !input.value.trim()) return;
        ev.preventDefault();
        const boxId = input.dataset.add;
        const count = findBox(boxId)?.b.items.length || 0;
        const made = await store.create('items', { ...splitQuantity(input.value), place_id: boxId, notes: '', sort_order: count, last_moved_at: null });
        tree = await loadTree();
        undoable(`Added "${made.name}"`, async () => { await store.remove('items', made.id); await reload(); });
        input.closest('.box-card').outerHTML = card(findBox(boxId).b);
        const fresh = body.querySelector(`.box-card[data-box="${boxId}"]`);
        fitPills(fresh.parentElement);
        fresh.querySelector('.quick-add').focus();
        return;
      }
      const c = ev.target.closest('.box-card[data-box]');
      if (c && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); c.click(); }
    });

    el.addEventListener('click', ev => {
      if (ev.target.closest('.quick-add')) return;
      const t = ev.target.closest('[data-act], [data-box], [data-edition]');
      if (!t || importSheet.contains(t)) return;
      if (t.dataset.edition) {
        editionId = t.dataset.edition; remember(EDITION_KEY, editionId);
        renderGrid();
      } else if (t.dataset.box) {
        location.hash = `#/find-things/${t.dataset.box}`;
      } else {
        t.closest('details')?.removeAttribute('open');
        act(t.dataset.act, t);
      }
    });

    importSheet.addEventListener('click', async ev => {
      if (ev.target === importSheet || ev.target.closest('[data-close]')) { importSheet.close(); return; }
      if (!ev.target.closest('#import-go')) return;
      const file = importSheet.querySelector('#import-file').files[0];
      const text = file ? await file.text() : importSheet.querySelector('#import-text').value;
      const out = importSheet.querySelector('#import-result');
      if (!text.trim()) { out.textContent = 'Choose a file or paste some CSV first.'; return; }
      out.textContent = 'Importing…';
      try {
        const c = await importCsv(text);
        out.textContent = `Added ${c.boxes} boxes and ${c.items} items` +
          (c.editions ? `, ${c.editions} life area${c.editions === 1 ? '' : 's'}` : '') +
          (c.sections ? `, ${c.sections} ${GROUP.one}${c.sections === 1 ? '' : 's'}` : '') +
          (c.skipped ? `. ${c.skipped} items were already here.` : '.');
        await reload();
      } catch (err) {
        out.textContent = `Couldn't import: ${err.message}`;
      }
    });

    let timer;
    q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { query = q.value.trim(); renderGrid(); }, 120);
    });

    this.onKey = ev => {
      if (ev.key === '/' && !openId && !ev.target.closest('input, textarea, select')) { ev.preventDefault(); q.focus(); }
      if (ev.key === 'Escape' && openItem && !ev.defaultPrevented) { ev.preventDefault(); toggleThing(openItem); return; }
      if (ev.key === 'Escape' && ev.target.id === 'box-q' && ev.target.value) { ev.preventDefault(); ev.target.value = ''; query = ''; q.value = ''; markHits(); return; }
      if (ev.key === 'Escape' && openId && !ev.target.closest('input, textarea') && kit.escape()) { ev.preventDefault(); return; }
      if (ev.key === 'Escape' && openId && !importSheet.open) { ev.preventDefault(); saveAndClose(); return; }
      if (ev.key === 'Escape' && document.activeElement === q && q.value) { q.value = ''; query = ''; renderGrid(); }
    };
    addEventListener('keydown', this.onKey);

    this.onResize = () => { if (!openId) fitPills(); };
    addEventListener('resize', this.onResize);
    this.openBox = openBox;
    tree = await loadTree();
    show();
  },

  // Called by the router with the path after #/find-things/.
  route([boxId]) {
    return this.openBox?.(boxId || null);
  },

  unmount() {
    this.kit?.destroy();
    removeEventListener('keydown', this.onKey);
    document.removeEventListener('pointerdown', this.onThingPointer, true);
    removeEventListener('resize', this.onResize);
  },

  quickAdd() {
    document.querySelector('[data-act="add-box"]')?.click();
  },
};

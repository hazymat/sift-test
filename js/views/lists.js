// Lists: templates you reuse (packing, the weekly shop), the copies made
// from them, and plain lists. #/lists  and  #/lists/<list id>

import { cogHtml, layoutOn } from '../viewcog.js';
import { shareHtml } from '../share.js';
import * as store from '../store.js';
import { loadLists, nestItems, progress, createList, addItems, useTemplate, missingFromTemplate } from '../lists.js';
import { createListKit } from '../listkit.js';
import { listEntry, listHint } from '../listentry.js';
import { toast, undoable } from '../toast.js';
import { richText, previewLine } from '../richtext.js';
import { debounced } from '../autosave.js';
import * as att from '../attachments.js';
import { editPills } from '../editpills.js';
import { word } from '../words.js';
import { tintHex, tintId, colourMenu } from '../colours.js';
import { rankOf, reorderWrites } from '../order.js';
import { dateText } from '../days.js';
import { shareSheet, sharedWithText, people, invitesHtml, theirsHtml } from '../sharing.js';
import { askEmptied } from '../ask.js';
import { rowSwipe } from '../rowswipe.js';
import { keyBetween } from '../order.js';
import { treeHtml, groupOf, measureRows, slideRows } from '../rows.js';
import { flash, SOFT } from '../flash.js';
import { touch } from '../editpills.js';
import { atEdge, caretTo } from '../walk.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const shortDate = iso => dateText(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' });
// 👁 Layout switches (viewcog.js): Lined paper and its margin, as in Tasks.
const lay = id => layoutOn('lists', id);
const wait = ms => new Promise(done => setTimeout(done, ms));

export default {
  async mount(el) {
    // Page-wide listeners are tied to this signal and removed in unmount().
    this.gone?.abort();
    const gone = this.gone = new AbortController();
    document.addEventListener('sift-layout', ev => { if (ev.detail?.area === 'lists') render(); }, { signal: gone.signal });
    const collapsed = new Set(); // items whose sub-items are folded away
    let chainAfter = null; // Enter in a new item's line: another line opens after it once drawn
    let nameNext = null; // a list just made: select its name for typing
    let atts = new Map(); // list item id → its attachments
    let focusAdd = false; // Enter or Tab from the list name carries on into "Add items"
    const state = this.state = { id: null, owner: null, hideTicked: false };
    let data = { lists: [], items: [] };
    let shared = []; // lists others share with you: [{ l, items, owner_id, name, share }]

    const itemsOf = id => data.items.filter(i => i.list_id === id);
    const listOf = id => data.lists.find(l => l.id === id);
    const go = hash => { if (location.hash !== hash) location.hash = hash; else render(); };

    // ---------- overview ----------

    function card(l, from = null) {
      const items = from ? from.items : itemsOf(l.id);
      const pr = progress(items);
      const copies = from ? 0 : data.lists.filter(x => x.template_id === l.id).length;
      const who = from ? '' : sharedWithText({ kind: 'list', id: l.id });
      return `
        <a class="project-card list-card" href="#/lists/${l.id}${from ? `/from/${from.owner_id}` : ''}" style="--tint: ${tintHex(l)}">
          <span class="project-title">${esc(l.name || 'Untitled')}</span>
          ${from ? `<span class="muted">👥 from ${esc(from.name)}</span>` : who ? `<span class="muted">👥 shared with ${esc(who)}</span>` : ''}
          ${l.kind === 'template'
            ? `<span class="muted">${items.length} item${items.length === 1 ? '' : 's'}${copies ? ` · used ${copies}×` : ''}${l.used_at ? ` · last ${shortDate(l.used_at)}` : ''}</span>`
            : `<span class="bar"><span style="width:${pr.pct}%"></span></span><span class="muted">${pr.done} of ${pr.total} ticked</span>`}
          ${!from && l.kind === 'instance' && listOf(l.template_id) ? `<span class="muted">from ${esc(listOf(l.template_id).name)}</span>` : ''}
        </a>`;
    }

    function overview() {
      const templates = data.lists.filter(l => l.kind === 'template');
      const inUse = data.lists.filter(l => l.kind !== 'template').sort((a, b) => b.created_at.localeCompare(a.created_at));
      return `
        <div class="lists-head">
          <button type="button" class="primary" data-act="new-template">+ New template</button>
          <button type="button" data-act="new-list">+ New list</button>
          ${shareHtml()}
          ${cogHtml('lists')}
          <details class="tool-menu page-more">
            <summary class="icon-btn" aria-label="More actions">${icon('i-more')}</summary>
            <div class="menu"><a href="#/bin/archive/lists">Show Archive</a><a href="#/bin/bin/lists">Show Bin</a></div>
          </details>
        </div>
        <h3 class="milestone">Templates</h3>
        <p class="muted hint">${esc(word('ph_lists_templates'))}</p>
        <div class="project-grid">${templates.map(card).join('') || '<p class="muted">' + esc(word('ph_lists_no_templates')) + '</p>'}</div>
        <h3 class="milestone">Lists</h3>
        <div class="project-grid">${inUse.map(l => card(l)).join('') || '<p class="muted">' + esc(word('ph_lists_none')) + '</p>'}</div>
        ${shared.length || invitesHtml(['list']) ? `<h3 class="milestone">Shared with me</h3>${invitesHtml(['list'])}
        <div class="project-grid">${shared.map(x => card(x.l, x)).join('')}</div>` : ''}`;
    }

    // Lists others share with you, from each person's space (store.js).
    async function loadShared() {
      const out = [];
      for (const p of people(['list'])) {
        const space = store.spaceOf(p.owner_id);
        const ids = new Set(p.shares.map(sh => sh.info.id));
        const lists = await space.list('lists', { filter: l => ids.has(l.id) && !l.archived_at });
        const items = await space.list('list_items', { filter: i => ids.has(i.list_id) && !i.archived_at });
        for (const l of lists) out.push({ l, items: items.filter(i => i.list_id === l.id), owner_id: p.owner_id, name: p.name, share: p.shares.find(sh => sh.info.id === l.id) });
      }
      return out;
    }
    const theirs = () => state.owner && shared.find(x => x.owner_id === state.owner && x.l.id === state.id);

    // ---------- an item's note and panel ----------

    let openItem = null;
    let pendingNote = null;
    // Under the item: its sub-items' count (▾ folds them away, as in Tasks), then the
    // note's first line; clicking the note opens the panel.
    function subLine(i, isTemplate) {
      const kids = i.depth ? [] : data.items.filter(k => k.parent_id === i.id && k.list_id === i.list_id);
      const count = isTemplate ? kids.length : `${progress(kids).done}/${kids.length}`;
      const chip = kids.length ? `<span class="chips"><button type="button" class="chip kids" data-act="collapse" aria-expanded="${!collapsed.has(i.id)}">${collapsed.has(i.id) ? '▸' : '▾'} ${count}</button></span>` : '';
      const { html, more } = previewLine(i.notes || '');
      const note = html && openItem !== i.id ? `<span class="item-note task-note" data-act="item-details" role="button" tabindex="0" title="Open to read or edit">${html}${more ? ` <span class="more-lines">+${more} more</span>` : ''}</span>` : ''; // the open panel already shows the whole note
      return chip || note ? `<div class="item-sub">${chip}${note}</div>` : '';
    }
    const noteAuto = debounced(async () => {
      const p = pendingNote;
      pendingNote = null;
      if (p) await store.update('list_items', p.id, { notes: p.md });
    }, 600);
    const flushNote = noteAuto.flush;
    async function toggleItem(id) {
      await flushNote();
      openItem = openItem === id ? null : id;
      await render();
    }
    function mountNotes() {
      const box = el.querySelector('.list-panel .list-notes');
      if (!box || !openItem) return;
      const id = openItem;
      const it = data.items.find(x => x.id === id);
      richText(box, {
        value: it?.notes || '',
        placeholder: word('ph_notes'),
        origin: () => ({ collection: 'list_items', id, title: it?.text, field: 'notes' }),
        onChange: md => { pendingNote = { id, md }; noteAuto.trigger(); },
      });
    }

    // ---------- one list ----------

    function page() {
      const l = listOf(state.id);
      if (!l) return '<div class="empty"><h2>That list has gone.</h2></div>';
      const isTemplate = l.kind === 'template';
      const all = nestItems(itemsOf(l.id));
      const pr = progress(all);
      // Ticked ones hidden (Hide ticked), and sub-items of a folded item.
      const shown = all.filter(i => !(state.hideTicked && i.checked_at) && !(i.depth && collapsed.has(i.parent_id)));
      const template = l.template_id && listOf(l.template_id);
      const copies = isTemplate ? data.lists.filter(x => x.template_id === l.id) : [];
      const missing = template ? missingFromTemplate(all, itemsOf(template.id)) : [];
      const from = theirs();
      const who = sharedWithText({ kind: 'list', id: l.id });
      // Items are drawn as Tasks draws tasks (rows.js): cards, or lined paper (👁), sub-items joined by fine lines.
      const row = (i, n) => `
          <li data-id="${i.id}" data-task="${i.id}" data-depth="${i.depth}" class="${i.checked_at ? 'done' : ''} ${groupOf(shown, n)}">${treeHtml(shown, n, lay('margin'))}
            <button type="button" class="drag-handle" aria-label="Select or move">${icon('i-grip')}</button>
            ${isTemplate ? '<input type="checkbox" class="tick" disabled tabindex="-1" aria-hidden="true" style="visibility:hidden">' : `<input type="checkbox" class="tick" ${i.checked_at ? 'checked' : ''} aria-label="Ticked">`}
            <input class="task-title" name="text" value="${esc(i.text)}" aria-label="Item" autocomplete="off">
            <button type="button" class="more" data-act="item-details" aria-label="Details" aria-expanded="${openItem === i.id}">⋯</button>
            ${subLine(i, isTemplate)}
          </li>
          ${openItem === i.id ? `<li class="task-details list-panel" data-for="${i.id}">
            <div class="list-notes"></div>
            ${att.rowHtml(atts.get(i.id), { parent: i.id })}
            <div class="detail-actions">
              <button type="button" class="close-details" data-act="close-item" title="Close (or Esc)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Close</button>
              <span class="spacer"></span>
              <button type="button" data-act="archive-item">Archive</button>
              <button type="button" class="danger" data-act="remove">Delete</button>
            </div>
          </li>` : ''}`;
      // The name, progress, Reset ticks and Show / hide ticked stay at the top while the items scroll.
      return `
        <div class="list-top-mark" aria-hidden="true"></div>
        <div class="list-top">
        ${from ? theirsHtml(`${from.name} shared this ${isTemplate ? 'template' : 'list'} with you. You can both change it.`, `<button type="button" data-share-leave="${from.share.id}">Leave</button>`) : ''}
        <div class="project-head">
          <button type="button" class="back" data-act="home">‹ Lists</button>
          <button type="button" class="note-dot list-colour" data-act="list-colour" title="List colour" aria-label="List colour"><span class="swatch" style="--sw:${tintHex(l)}"></span></button>
          <input class="project-name" name="name" value="${esc(l.name)}" data-list-name="${l.id}" aria-label="List name" placeholder="${esc(word('ph_list_name'))}">
          ${isTemplate ? '<span class="chip">Template</span>' : ''}
          ${from ? '' : `<button type="button" class="share-btn-people" data-act="share-people" title="${who ? `Shared with ${esc(who)}` : 'Share with someone on your server'}">👥<span class="share-words"> ${who ? `Shared with ${esc(who)}` : 'Share'}</span></button>`}
          ${cogHtml('lists')}
        </div>
        ${isTemplate ? `
          <div class="list-actions">
            ${from ? '' : '<button type="button" class="primary" data-act="use">Use this template</button>'}
            ${copies.length ? `<span class="muted">Copies: ${copies.map(c => `<a href="#/lists/${c.id}">${esc(c.name)}</a>`).join(', ')}</span>` : ''}
          </div>` : `
          <div class="list-actions">
            <div class="bar list-bar"><span style="width:${pr.pct}%"></span></div>
            <span class="muted">${pr.done} of ${pr.total} ticked</span>
            <button type="button" data-act="reset" ${pr.done ? '' : 'disabled'}>Reset ticks</button>
            <button type="button" data-act="hide" aria-pressed="${state.hideTicked}">${state.hideTicked ? 'Show ticked' : 'Hide ticked'}</button>
            ${template ? `<span class="muted">from <a href="#/lists/${template.id}">${esc(template.name)}</a></span>` : ''}
            ${missing.length ? `<button type="button" data-act="add-missing">Add ${missing.length} missing from template</button>` : ''}
          </div>`}
        </div>
        <div class="task-entry list-entry-box" id="list-entry">
          <div class="task-add-line">
            <span class="add-mark" aria-hidden="true"></span>
            <textarea id="list-new" class="new-task-line list-entry" rows="1" placeholder="${esc(word('ph_add_items'))}" enterkeyhint="done" aria-label="New item"></textarea>
            <button type="button" class="entry-add" data-act="add" title="Add (Enter)">Add <kbd>Enter</kbd></button>
          </div>
          <p class="muted hint list-hint">${listHint({ enterAdds: true })}</p>
        </div>
        <ul class="task-list checklist" style="--tint: ${tintHex(l)}">${shown.map(row).join('')}</ul>
        ${state.hideTicked && pr.done ? `<p class="muted hint">${pr.done} ticked item${pr.done === 1 ? '' : 's'} hidden.</p>` : ''}
        ${from ? '' : `<div class="detail-actions list-end">
          <span class="spacer"></span>
          <button type="button" data-act="archive-list">Archive list</button>
          <button type="button" class="danger" data-act="delete-list">Delete list</button>
        </div>`}`;
    }

    // ---------- render ----------

    const body = el;
    // Tap an item to edit it: More (its note and files) opens under it (js/editpills.js).
    this.pills = editPills(body, { title: '.checklist .task-title', row: '.checklist > li[data-id]', key: r => r.dataset.id, html: () => '', change: () => {} });
    const attDone = async parent => {
      if (att.writingIn(el)) { atts = await att.byParent(); await att.redrawRows(el, parent?.id); return; }
      render();
    };
    att.enableDrop(el, 'li.list-panel[data-for], ul.checklist > li[data-id]', node => ({ collection: 'list_items', id: node.dataset.for || node.dataset.id }), attDone);
    // After a sync the app calls refresh(): redraw from fresh data, keeping what's open.
    const render = this.render = this.refresh = async () => {
      // A list someone shares with you is read and changed in their space.
      store.useSpace(state.owner ? store.spaceOf(state.owner) : null);
      shared = await loadShared();
      if (state.owner && !theirs()) { state.owner = null; store.useSpace(null); if (state.id) return go('#/lists'); }
      data = await loadLists();
      atts = await att.byParent();
      const l = state.id && listOf(state.id);
      body.innerHTML = state.id ? page() : overview();
      kit = l?.kind === 'template' ? kitTemplate : kitChecklist;
      (l?.kind === 'template' ? kitChecklist : kitTemplate).attach(null);
      kit.attach(state.id ? body.querySelector('.checklist') : null);
      if (nameNext && nameNext === state.id) {
        nameNext = null;
        const n = body.querySelector('[data-list-name]');
        if (n) { n.focus(); n.select(); }
      }
      mountNotes();
      const ta = body.querySelector('#list-new');
      if (ta && focusAdd) { focusAdd = false; ta.focus(); }
      if (ta) {
        addEntry = listEntry(ta, addLines, { draft: `lists:${state.id || 'new'}`, enterAdds: true });
        // One line, growing with what's typed or pasted.
        const fit = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
        ta.addEventListener('input', fit);
        fit();
      }
      measureRows(body, body.querySelector('.checklist'), ta);
      // The top gets a glass backing once it sticks (as Brain Dump's bar).
      this.topWatch?.disconnect();
      const mark = body.querySelector('.list-top-mark'), top = body.querySelector('.list-top');
      if (mark && top) {
        this.topWatch = new IntersectionObserver(([e]) => top.classList.toggle('stuck', !e.isIntersecting && e.boundingClientRect.top < 200), { rootMargin: `-${parseFloat(getComputedStyle(top).top) || 0}px 0px 0px 0px` });
        this.topWatch.observe(mark);
      }
      if (chainAfter) { const id = chainAfter; chainAfter = null; openNewAfter(id); }
    };
    // New items pulse once, soft blue, and the list scrolls to them (👁 Highlight item when added).
    const showAdded = ids => { if (lay('added-flash')) ids.forEach((id, n) => flash(body.querySelector(`.checklist > li[data-id="${id}"]`), Object.assign({ scroll: n ? false : 'nearest' }, SOFT))); };

    // ---------- editing ----------

    let addEntry = () => {};
    async function addLines(lines) {
      const made = await addItems(state.id, lines, nestItems(itemsOf(state.id)));
      await render();
      body.querySelector('#list-new')?.focus();
      showAdded(made.map(m => m.id));
      undoable(`Added ${made.length} item${made.length === 1 ? '' : 's'}`, async () => {
        await store.updateMany('list_items', made.map(m => [m.id, { deleted_at: new Date().toISOString() }]));
        render();
      });
    }

    // Only the moved items get a new place (order.js) and only changed parents
    // are written, so moves on two devices merge.
    async function persistOrder(rows, label, ul, moved) {
      const item = id => data.items.find(x => x.id === id);
      const places = new Map(reorderWrites(rows, r => rankOf(item(r.id)), moved).map(([r, k]) => [r.id, k]));
      let parent = null;
      const changes = [];
      const before = [];
      for (const r of rows) {
        const sub = r.depth > 0 && parent;
        if (!sub) parent = r.id;
        const i = item(r.id);
        const fields = {};
        if (places.has(r.id)) fields.rank = places.get(r.id);
        if ((sub ? parent : null) !== (i.parent_id || null)) fields.parent_id = sub ? parent : null;
        if (!Object.keys(fields).length) continue;
        changes.push([r.id, fields]);
        before.push([r.id, Object.fromEntries(Object.keys(fields).map(k => [k, i[k] ?? null]))]);
      }
      if (changes.length) await store.updateMany('list_items', changes);
      await render();
      undoable(label, async () => { await store.updateMany('list_items', before); render(); });
    }

    async function batch(ids, fields, label, { subs = true } = {}) {
      const all = subs ? [...new Set([...ids, ...data.items.filter(i => ids.includes(i.parent_id)).map(i => i.id)])] : ids;
      const before = all.map(id => { const i = data.items.find(x => x.id === id); return [id, Object.fromEntries(Object.keys(fields).map(k => [k, i?.[k] ?? null]))]; });
      await store.updateMany('list_items', all.map(id => [id, fields]));
      await render();
      undoable(`${label} ${all.length} item${all.length === 1 ? '' : 's'}`, async () => { await store.updateMany('list_items', before); render(); });
    }

    // Dropped onto the middle of another item: they become its sub-items, at the end of its
    // group. Onto a sub-item: they join that group, just after it. One level only.
    async function nestUnder(ids, targetId) {
      const target = data.items.find(i => i.id === targetId);
      if (!target) return render();
      const parentId = target.parent_id || target.id;
      const moving = ids.map(id => data.items.find(i => i.id === id)).filter(i => i && i.id !== parentId && i.id !== targetId);
      if (!moving.length) return render();
      if (moving.some(i => data.items.some(k => k.parent_id === i.id))) { toast('Sub-items go one level deep'); return render(); }
      const inList = data.items.filter(i => i.list_id === target.list_id && !moving.includes(i));
      const after = (target.parent_id ? [target] : inList.filter(i => i.id === parentId || i.parent_id === parentId)).map(i => rankOf(i)).sort().at(-1);
      const next = inList.map(i => rankOf(i)).filter(k => k > after).sort()[0] || null;
      const before = moving.map(i => [i.id, { parent_id: i.parent_id ?? null, rank: i.rank ?? null }]);
      let k = after;
      await store.updateMany('list_items', moving.map(i => { k = keyBetween(k, next); return [i.id, { parent_id: parentId, rank: k }]; }));
      collapsed.delete(parentId);
      await render();
      const parent = data.items.find(i => i.id === parentId);
      undoable(`${moving.length === 1 ? `"${moving[0].text}" is` : `${moving.length} items are`} now under "${parent?.text || ''}"`, async () => { await store.updateMany('list_items', before); await render(); });
    }

    // Phones: swipe an item sideways (rowswipe.js): left for ⋯ More and ✓ Tick, right for Delete.
    rowSwipe(el, {
      rows: '.checklist > li[data-id]',
      actions: li => ({
        left: [
          { label: '⋯ More', cls: 'ra-more', run: row => row.querySelector(':scope > [data-act="item-details"]')?.click() },
          ...(li.querySelector(':scope > .tick:not([disabled])') ? [{ label: li.classList.contains('done') ? '↺ Untick' : '✓ Tick', cls: 'ra-done', run: row => row.querySelector(':scope > .tick')?.click() }] : []),
        ],
        right: [{ label: 'Delete', cls: 'ra-delete', run: row => batch([row.dataset.id], { deleted_at: new Date().toISOString() }, 'Removed') }],
      }),
    });

    // Enter in an item's name (as in Tasks): a new line just below it and its sub-items, at
    // the same level. Enter there adds it and opens the next; Tab / Shift+Tab or "- " change
    // its level; Esc or leaving it empty drops the line.
    function openNewAfter(id) {
      const item = data.items.find(i => i.id === id);
      const li = body.querySelector(`.checklist > li[data-id="${id}"]`);
      if (!item || !li) return;
      const d = Number(li.dataset.depth || 0);
      let last = li;
      while (last.nextElementSibling && !(last.nextElementSibling.matches('li[data-id]') && Number(last.nextElementSibling.dataset.depth || 0) <= d)) last = last.nextElementSibling;
      const row = document.createElement('li');
      row.className = `task-new-row${d ? ' group-kid' : ''}`;
      row.dataset.task = ''; // laid out like an item (CSS), but not one yet
      row.dataset.depth = d;
      row.innerHTML = `<span class="drag-handle" aria-hidden="true" style="visibility:hidden">${icon('i-grip')}</span>
        <input type="checkbox" class="tick" disabled tabindex="-1" aria-hidden="true">
        <input class="task-title no-inline" placeholder="${d ? 'New sub-item' : 'New item'}" aria-label="New item" autocomplete="off">`;
      last.after(row);
      const input = row.querySelector('.task-title');
      const setLevel = n => { row.dataset.depth = n; row.classList.toggle('group-kid', n > 0); input.placeholder = n ? 'New sub-item' : 'New item'; };
      let done = false;
      const finish = async chain => {
        if (done) return;
        done = true;
        const text = input.value.trim();
        if (!text) { row.remove(); return; }
        const sub = Number(row.dataset.depth || 0) > 0;
        const inList = data.items.filter(i => i.list_id === item.list_id);
        const after = (d ? [item] : inList.filter(i => i.id === item.id || i.parent_id === item.id)).map(i => rankOf(i)).sort().at(-1);
        const next = inList.map(i => rankOf(i)).filter(k => k > after).sort()[0] || null;
        const made = await store.create('list_items', { list_id: item.list_id, text, notes: '', parent_id: sub ? (d ? item.parent_id : item.id) : null, sort_order: 0, rank: keyBetween(after, next), checked_at: null });
        if (chain) chainAfter = made.id;
        await render();
        showAdded([made.id]);
        undoable(`Added ${sub ? 'sub-item' : 'item'}: ${text}`, async () => { await store.remove('list_items', made.id); await render(); });
      };
      input.addEventListener('input', () => {
        const m = input.value.match(/^[-*•] /);
        if (!m || Number(row.dataset.depth)) return;
        setLevel(1);
        input.value = input.value.slice(m[0].length);
      });
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) { ev.preventDefault(); ev.stopPropagation(); setLevel(ev.shiftKey ? 0 : 1); return; }
        if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); ev.stopPropagation(); finish(true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); }
      });
      input.addEventListener('blur', () => finish(false));
      input.focus();
    }
    body.addEventListener('keydown', async ev => {
      const t = ev.target;
      if (ev.key !== 'Enter' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || !t.matches?.('.checklist > li[data-id] > .task-title')) return;
      const id = t.closest('li').dataset.id;
      // Shift+Enter: on into the item's note (its panel), as in Tasks.
      if (ev.shiftKey) {
        ev.preventDefault(); ev.stopPropagation();
        t.blur();
        if (openItem !== id) await toggleItem(id);
        body.querySelector('.list-panel .list-notes .rich-edit')?.focus();
        return;
      }
      if (t.value.trim()) setTimeout(() => openNewAfter(id), 0); // after inline.js saves it
    }, { capture: true });

    // ↑ / ↓ in an item's name: straight to the item above / below; from the top one up to
    // the new item line, and from there down into the list.
    body.addEventListener('keydown', ev => {
      if ((ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') || ev.defaultPrevented || ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing) return;
      const t = ev.target;
      if (!t.matches?.('#list-new, .checklist > li[data-id] > .task-title')) return;
      const up = ev.key === 'ArrowUp';
      if (t.id === 'list-new' && !atEdge(t, up ? 'up' : 'down')) return;
      const stops = [body.querySelector('#list-new'), ...body.querySelectorAll('.checklist > li[data-id] > .task-title')].filter(f => f?.getClientRects().length);
      const to = stops[stops.indexOf(t) + (up ? -1 : 1)];
      if (!to) return;
      ev.preventDefault();
      to.focus();
      caretTo(to, up ? 'end' : 'start');
    });

    // Click on the empty part of the page: the new item line (not on a phone, where the
    // keyboard only comes up for a tap in the line itself).
    body.addEventListener('click', ev => { if (!touch && state.id && (ev.target === body || ev.target.matches('.checklist, .list-entry-box'))) body.querySelector('#list-new')?.focus(); });

    async function addToTemplate(ids) {
      const l = listOf(state.id);
      const template = l?.template_id && listOf(l.template_id);
      if (!template) { toast('This list isn\'t from a template'); return; }
      const have = itemsOf(template.id);
      const lines = data.items.filter(i => ids.includes(i.id) && !have.some(t => t.text.trim().toLowerCase() === i.text.trim().toLowerCase())).map(i => ({ text: i.text, sub: false }));
      if (!lines.length) { toast('Those are already in the template'); return; }
      const made = await addItems(template.id, lines, nestItems(have));
      await render();
      undoable(`Added ${made.length} to ${template.name}`, async () => {
        await store.updateMany('list_items', made.map(m => [m.id, { deleted_at: new Date().toISOString() }]));
        render();
      });
    }

    const common = [
      { id: 'archive', label: 'Archive', run: ids => batch(ids, { archived_at: new Date().toISOString() }, 'Archived') },
      { id: 'delete', label: 'Delete', danger: true, run: ids => batch(ids, { deleted_at: new Date().toISOString() }, 'Removed') },
    ];
    // As in Tasks: press and hold anywhere on an item moves it; dropped onto another item it
    // becomes its sub-item; a sub-item dragged down off the end of its group comes out of it.
    const dragRules = { reorder: true, indent: true, maxDepth: 1, holdAnywhere: true, sideways: false, onNest: (ids, target) => nestUnder(ids, target), noun: 'item', onReorder: persistOrder };
    const kitChecklist = this.kitChecklist = createListKit({
      ...dragRules,
      actions: [
        { id: 'tick', label: 'Tick', run: ids => batch(ids, { checked_at: new Date().toISOString() }, 'Ticked', { subs: false }) },
        { id: 'untick', label: 'Untick', run: ids => batch(ids, { checked_at: null }, 'Unticked', { subs: false }) },
        { id: 'to-template', label: 'Add to template', run: addToTemplate },
        ...common,
      ],
    });
    const kitTemplate = this.kitTemplate = createListKit({ ...dragRules, actions: common });
    let kit = kitChecklist;

    // Naming a list: Enter or Tab saves the name and goes on to "Add items".
    body.addEventListener('keydown', ev => {
      const n = ev.target.closest?.('[data-list-name]');
      if (!n || ev.isComposing || ev.altKey || ev.ctrlKey || ev.metaKey || (ev.key !== 'Enter' && !(ev.key === 'Tab' && !ev.shiftKey))) return;
      ev.preventDefault();
      focusAdd = true;
      n.blur();
      // A changed name redraws the page (which picks the flag up); otherwise go straight there.
      setTimeout(() => { if (focusAdd) { focusAdd = false; body.querySelector('#list-new')?.focus(); } }, 250);
    });

    el.addEventListener('change', async ev => {
      const t = ev.target;
      if (t.dataset.listName) {
        const l = listOf(t.dataset.listName);
        // A list's name removed: put it back (deleting a whole list stays a deliberate act).
        if (!t.value.trim()) { t.value = l.name; toast('A list needs a name, so it was put back'); return; }
        if (t.value.trim() === l.name) return;
        const old = l.name;
        await store.update('lists', l.id, { name: t.value.trim() });
        data = await loadLists();
        undoable('Renamed', async () => { await store.update('lists', l.id, { name: old }); render(); });
        return;
      }
      const li = t.closest('li[data-id]');
      if (!li) return;
      const item = data.items.find(i => i.id === li.dataset.id);
      if (t.classList.contains('tick')) {
        const old = item.checked_at;
        await store.update('list_items', item.id, { checked_at: t.checked ? new Date().toISOString() : null });
        // With ticked ones hidden it fades and the items below slide up into its place.
        if (t.checked && state.hideTicked) {
          li.classList.add('done', 'ticked-away');
          li.style.setProperty('--fade', '700ms');
          void li.offsetHeight;
          li.classList.add('fading');
          await wait(700);
          await slideRows([li], false);
        }
        await render();
        undoable(t.checked ? `Ticked "${item.text}"` : `Unticked "${item.text}"`, async () => { await store.update('list_items', item.id, { checked_at: old }); render(); });
      } else if (t.name === 'text' && !t.value.trim()) {
        if (await askEmptied('item')) {
          await store.remove('list_items', item.id);
          await render();
          undoable(`Deleted "${item.text}"`, async () => { await store.restore('list_items', item.id); render(); });
        } else t.value = item.text;
      } else if (t.name === 'text' && t.value.trim() !== item.text) {
        const old = item.text;
        await store.update('list_items', item.id, { text: t.value.trim() });
        data = await loadLists();
        undoable('Saved', async () => { await store.update('list_items', item.id, { text: old }); render(); });
      }
    });

    el.addEventListener('click', async ev => {
      if (att.onClick(ev, b => { const id = b.closest('[data-for]')?.dataset.for; return id ? { collection: 'list_items', id } : null; }, attDone)) return;
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      b.closest('details')?.removeAttribute('open');
      const l = listOf(state.id);
      const act = b.dataset.act;
      if (act === 'home') return go('#/lists');
      if (act === 'list-colour') {
        // The list's colour (colours.js): kept whatever the Look, shown in Multicolour.
        const l = listOf(state.id);
        const old = l.colour ?? null;
        colourMenu(b, tintId(l), async v => {
          await store.update('lists', l.id, { colour: v });
          await render();
          undoable('List colour', async () => { await store.update('lists', l.id, { colour: old }); await render(); });
        });
        return;
      }
      // New ones are made straight away and opened with the name selected:
      // just type to name it (no pop-up box).
      if (act === 'new-template' || act === 'new-list') {
        const template = act === 'new-template';
        const made = await createList({ name: template ? 'New template' : 'New list', kind: template ? 'template' : 'list' });
        nameNext = made.id;
        go(`#/lists/${made.id}`);
        undoable(template ? 'New template' : 'New list', async () => { await store.remove('lists', made.id); go('#/lists'); });
        return;
      }
      if (!l) return;
      if (act === 'share-people') return shareSheet({ kind: 'list', id: l.id, name: l.name || 'Untitled' }, `"${l.name || 'Untitled'}"`);
      if (act === 'add') return addEntry();
      if (act === 'use') {
        const name = `${l.name} – ${shortDate(new Date().toISOString())}`;
        const inst = await useTemplate(l, itemsOf(l.id), name);
        nameNext = inst.id;
        go(`#/lists/${inst.id}`);
        undoable(`Made "${inst.name}"`, async () => {
          await store.remove('lists', inst.id);
          go('#/lists');
        });
        return;
      }
      if (act === 'reset') {
        const ticked = itemsOf(l.id).filter(i => i.checked_at);
        await store.updateMany('list_items', ticked.map(i => [i.id, { checked_at: null }]));
        await render();
        undoable(`Reset ${ticked.length} tick${ticked.length === 1 ? '' : 's'}`, async () => {
          await store.updateMany('list_items', ticked.map(i => [i.id, { checked_at: i.checked_at }]));
          render();
        });
        return;
      }
      if (act === 'hide') { state.hideTicked = !state.hideTicked; return render(); }
      if (act === 'add-missing') {
        const missing = missingFromTemplate(itemsOf(l.id), itemsOf(l.template_id));
        const made = await addItems(l.id, missing.map(m => ({ text: m.text, sub: false })), nestItems(itemsOf(l.id)));
        await render();
        undoable(`Added ${made.length} from the template`, async () => {
          await store.updateMany('list_items', made.map(m => [m.id, { deleted_at: new Date().toISOString() }]));
          render();
        });
        return;
      }
      if (act === 'collapse') {
        // The sub-items slide closed, or slide open once drawn.
        const id = b.closest('li[data-id]').dataset.id;
        const kidRows = () => { const out = []; for (let r = body.querySelector(`.checklist > li[data-id="${id}"]`)?.nextElementSibling; r && !(r.matches('li[data-id]') && r.dataset.depth === '0'); r = r.nextElementSibling) out.push(r); return out; };
        if (collapsed.has(id)) { collapsed.delete(id); await render(); slideRows(kidRows(), true); }
        else { await slideRows(kidRows(), false); collapsed.add(id); render(); }
        return;
      }
      if (act === 'item-details') return toggleItem(b.closest('li[data-id], li[data-for]').dataset.id || b.closest('li[data-for]').dataset.for);
      if (act === 'close-item') return toggleItem(openItem);
      if (act === 'archive-item') {
        const row = b.closest('li[data-id], li[data-for]');
        const id = row.dataset.id || row.dataset.for;
        if (openItem === id) { await flushNote(); openItem = null; }
        return batch([id], { archived_at: new Date().toISOString() }, 'Archived');
      }
      if (act === 'remove') {
        const row = b.closest('li[data-id], li[data-for]');
        const id = row.dataset.id || row.dataset.for;
        if (openItem === id) { await flushNote(); openItem = null; }
        return batch([id], { deleted_at: new Date().toISOString() }, 'Removed');
      }
      if (act === 'archive-list' || act === 'delete-list') {
        const field = act === 'delete-list' ? 'deleted_at' : 'archived_at';
        const now = new Date().toISOString();
        const ids = itemsOf(l.id).map(i => i.id);
        await store.updateMany('list_items', ids.map(id => [id, { [field]: now }]));
        await store.update('lists', l.id, { [field]: now });
        go('#/lists');
        undoable(`${act === 'delete-list' ? 'Deleted' : 'Archived'} "${l.name}"`, async () => {
          await store.update('lists', l.id, { [field]: null });
          await store.updateMany('list_items', ids.map(id => [id, { [field]: null }]));
          render();
        });
      }
    });

    this.onKey = ev => {
      if (ev.key === 'Escape' && openItem && !ev.defaultPrevented && !document.querySelector('.ref-picker')) { ev.preventDefault(); toggleItem(openItem); return; }
      if (ev.key === 'Escape' && !ev.target.closest('input, textarea, select, [contenteditable]') && kit.escape()) ev.preventDefault();
    };
    addEventListener('keydown', this.onKey);
    await render();
  },

  route([id, from, owner]) {
    this.state.id = id || null;
    this.state.owner = from === 'from' ? owner || null : null;
    return this.render();
  },

  unmount() {
    this.gone?.abort();
    this.topWatch?.disconnect();
    this.kitChecklist?.destroy();
    this.pills?.destroy();
    this.kitTemplate?.destroy();
    removeEventListener('keydown', this.onKey);
  },

  quickAdd() {
    const ta = document.querySelector('#list-new');
    if (ta) ta.focus(); else document.querySelector('[data-act="new-list"]')?.click();
  },
};

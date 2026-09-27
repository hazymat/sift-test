// Lists: templates you reuse (packing, the weekly shop), the copies made
// from them, and plain lists. #/lists  and  #/lists/<list id>

import { cogHtml } from '../viewcog.js';
import * as store from '../store.js';
import { loadLists, nestItems, progress, createList, addItems, useTemplate, missingFromTemplate } from '../lists.js';
import { createListKit } from '../listkit.js';
import { listEntry, listHint, SHORTCUT } from '../listentry.js';
import { toast, undoable } from '../toast.js';
import { richText, previewLine } from '../richtext.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const shortDate = iso => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default {
  async mount(el) {
    let nameNext = null; // a list just made: select its name for typing
    const state = this.state = { id: null, hideTicked: false };
    let data = { lists: [], items: [] };

    const itemsOf = id => data.items.filter(i => i.list_id === id);
    const listOf = id => data.lists.find(l => l.id === id);
    const go = hash => { if (location.hash !== hash) location.hash = hash; else render(); };

    // ---------- overview ----------

    function card(l) {
      const items = itemsOf(l.id);
      const pr = progress(items);
      const copies = data.lists.filter(x => x.template_id === l.id).length;
      return `
        <a class="project-card list-card" href="#/lists/${l.id}">
          <span class="project-title">${esc(l.name || 'Untitled')}</span>
          ${l.kind === 'template'
            ? `<span class="muted">${items.length} item${items.length === 1 ? '' : 's'}${copies ? ` · used ${copies}×` : ''}${l.used_at ? ` · last ${shortDate(l.used_at)}` : ''}</span>`
            : `<span class="bar"><span style="width:${pr.pct}%"></span></span><span class="muted">${pr.done} of ${pr.total} ticked</span>`}
          ${l.kind === 'instance' && listOf(l.template_id) ? `<span class="muted">from ${esc(listOf(l.template_id).name)}</span>` : ''}
        </a>`;
    }

    function overview() {
      const templates = data.lists.filter(l => l.kind === 'template');
      const inUse = data.lists.filter(l => l.kind !== 'template').sort((a, b) => b.created_at.localeCompare(a.created_at));
      return `
        <div class="lists-head">
          <button type="button" class="primary" data-act="new-template">+ New template</button>
          <button type="button" data-act="new-list">+ New list</button>
          ${cogHtml('lists')}
          <details class="tool-menu">
            <summary class="icon-btn" aria-label="More actions">${icon('i-more')}</summary>
            <div class="menu"><a href="#/bin/archive/lists">Archive</a><a href="#/bin/bin/lists">Bin</a></div>
          </details>
        </div>
        <h3 class="milestone">Templates</h3>
        <p class="muted hint">A template is the list you reuse (holiday packing, the weekly shop). Open one and "Use this template" to get a fresh copy to tick off.</p>
        <div class="project-grid">${templates.map(card).join('') || '<p class="muted">No templates yet.</p>'}</div>
        <h3 class="milestone">Lists</h3>
        <div class="project-grid">${inUse.map(card).join('') || '<p class="muted">No lists yet.</p>'}</div>`;
    }

    // ---------- an item's note and panel ----------

    let openItem = null;
    let pendingNote = null;
    let noteTimer;
    // Under the item: the note's first line; clicking it opens the panel.
    function noteLine(i) {
      const { html, more } = previewLine(i.notes || '');
      if (!html) return '';
      return `<div class="item-sub"><span class="item-note task-note" data-act="item-details" role="button" tabindex="0" title="${openItem === i.id ? 'Close' : 'Open to read or edit'}"><span class="note-emoji" aria-hidden="true">📝</span>${html}${more ? ` <span class="more-lines">+${more} more</span>` : ''}</span></div>`;
    }
    async function flushNote() {
      clearTimeout(noteTimer);
      const p = pendingNote;
      pendingNote = null;
      if (p) await store.update('list_items', p.id, { notes: p.md });
    }
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
        placeholder: 'Notes…',
        origin: () => ({ collection: 'list_items', id, title: it?.text, field: 'notes' }),
        onChange: md => { clearTimeout(noteTimer); pendingNote = { id, md }; noteTimer = setTimeout(flushNote, 600); },
      });
    }
    this.onItemPointer = ev => {
      if (!openItem || !el.isConnected) return;
      if (ev.target.closest(`li[data-id="${openItem}"], li[data-for="${openItem}"], dialog, .toast, .ref-picker, .ref-menu, .pill-menu`)) return;
      toggleItem(openItem);
    };
    document.addEventListener('pointerdown', this.onItemPointer, true);

    // ---------- one list ----------

    function page() {
      const l = listOf(state.id);
      if (!l) return '<div class="empty"><h2>That list has gone.</h2></div>';
      const isTemplate = l.kind === 'template';
      const all = nestItems(itemsOf(l.id));
      const pr = progress(all);
      const shown = state.hideTicked ? all.filter(i => !i.checked_at) : all;
      const template = l.template_id && listOf(l.template_id);
      const copies = isTemplate ? data.lists.filter(x => x.template_id === l.id) : [];
      const missing = template ? missingFromTemplate(all, itemsOf(template.id)) : [];
      return `
        <div class="project-head">
          <button type="button" class="back" data-act="home">‹ Lists</button>
          <input class="project-name" name="name" value="${esc(l.name)}" data-list-name="${l.id}" aria-label="List name" placeholder="List name">
          <span class="chip">${isTemplate ? 'Template' : template ? 'From a template' : 'List'}</span>
        </div>
        ${isTemplate ? `
          <div class="list-actions">
            <button type="button" class="primary" data-act="use">Use this template</button>
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
        <ul class="task-list checklist">${shown.map(i => `
          <li data-id="${i.id}" data-depth="${i.depth}" class="${i.checked_at ? 'done' : ''}">
            <button type="button" class="drag-handle" aria-label="Select or move">${icon('i-grip')}</button>
            ${isTemplate ? '' : `<input type="checkbox" class="tick" ${i.checked_at ? 'checked' : ''} aria-label="Ticked">`}
            <input class="task-title" name="text" value="${esc(i.text)}" aria-label="Item" autocomplete="off">
            <button type="button" class="more" data-act="item-details" aria-label="Details" aria-expanded="${openItem === i.id}">⋯</button>
            ${noteLine(i)}
          </li>
          ${openItem === i.id ? `<li class="task-details list-panel" data-for="${i.id}">
            <div class="list-notes"></div>
            <div class="detail-actions">
              <button type="button" class="close-details" data-act="close-item">Close</button>
              <span class="spacer"></span>
              <button type="button" class="danger" data-act="remove">Remove</button>
            </div>
          </li>` : ''}`).join('')}
        </ul>
        ${state.hideTicked && pr.done ? `<p class="muted hint">${pr.done} ticked item${pr.done === 1 ? '' : 's'} hidden.</p>` : ''}
        <textarea id="list-new" class="list-entry" rows="2" placeholder="Add items"></textarea>
        <p class="muted hint">${listHint()}</p>
        <div class="detail-actions">
          <button type="button" data-act="add">Add items <kbd>${SHORTCUT}</kbd></button>
          <span class="spacer"></span>
          <button type="button" data-act="archive-list">Archive list</button>
          <button type="button" class="danger" data-act="delete-list">Delete list</button>
        </div>`;
    }

    // ---------- render ----------

    const body = el;
    const render = this.render = async () => {
      data = await loadLists();
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
      if (ta) addEntry = listEntry(ta, addLines, { draft: `lists:${state.id || 'new'}` });
    };

    // ---------- editing ----------

    let addEntry = () => {};
    async function addLines(lines) {
      const made = await addItems(state.id, lines, nestItems(itemsOf(state.id)));
      await render();
      body.querySelector('#list-new')?.focus();
      undoable(`Added ${made.length} item${made.length === 1 ? '' : 's'}`, async () => {
        await store.updateMany('list_items', made.map(m => [m.id, { deleted_at: new Date().toISOString() }]));
        render();
      });
    }

    async function persistOrder(rows, label) {
      const before = rows.map(r => { const i = data.items.find(x => x.id === r.id); return [r.id, { sort_order: i.sort_order, parent_id: i.parent_id || null }]; });
      let parent = null;
      const changes = rows.map((r, n) => {
        const sub = r.depth > 0 && parent;
        if (!sub) parent = r.id;
        return [r.id, { sort_order: n, parent_id: sub ? parent : null }];
      });
      await store.updateMany('list_items', changes);
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
    const kitChecklist = this.kitChecklist = createListKit({
      reorder: true, indent: true, maxDepth: 1, noun: 'item', onReorder: persistOrder,
      actions: [
        { id: 'tick', label: 'Tick', run: ids => batch(ids, { checked_at: new Date().toISOString() }, 'Ticked', { subs: false }) },
        { id: 'untick', label: 'Untick', run: ids => batch(ids, { checked_at: null }, 'Unticked', { subs: false }) },
        { id: 'to-template', label: 'Add to template', run: addToTemplate },
        ...common,
      ],
    });
    const kitTemplate = this.kitTemplate = createListKit({ reorder: true, indent: true, maxDepth: 1, noun: 'item', onReorder: persistOrder, actions: common });
    let kit = kitChecklist;

    el.addEventListener('change', async ev => {
      const t = ev.target;
      if (t.dataset.listName) {
        const l = listOf(t.dataset.listName);
        if (!t.value.trim() || t.value.trim() === l.name) return;
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
        await render();
        undoable(t.checked ? `Ticked "${item.text}"` : `Unticked "${item.text}"`, async () => { await store.update('list_items', item.id, { checked_at: old }); render(); });
      } else if (t.name === 'text' && t.value.trim() && t.value.trim() !== item.text) {
        const old = item.text;
        await store.update('list_items', item.id, { text: t.value.trim() });
        data = await loadLists();
        undoable('Saved', async () => { await store.update('list_items', item.id, { text: old }); render(); });
      }
    });

    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      b.closest('details')?.removeAttribute('open');
      const l = listOf(state.id);
      const act = b.dataset.act;
      if (act === 'home') return go('#/lists');
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
      if (act === 'add') return addEntry();
      if (act === 'use') {
        const name = `${l.name} – ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
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
      if (act === 'item-details') return toggleItem(b.closest('li[data-id], li[data-for]').dataset.id || b.closest('li[data-for]').dataset.for);
      if (act === 'close-item') return toggleItem(openItem);
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
      if (ev.key === 'Escape' && !ev.target.closest('input, textarea') && kit.escape()) ev.preventDefault();
    };
    addEventListener('keydown', this.onKey);
    await render();
  },

  route([id]) {
    this.state.id = id || null;
    return this.render();
  },

  unmount() {
    this.kitChecklist?.destroy();
    this.kitTemplate?.destroy();
    removeEventListener('keydown', this.onKey);
    document.removeEventListener('pointerdown', this.onItemPointer, true);
  },

  quickAdd() {
    const ta = document.querySelector('#list-new');
    if (ta) ta.focus(); else document.querySelector('[data-act="new-list"]')?.click();
  },
};

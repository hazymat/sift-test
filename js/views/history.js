// History: every change on this device, newest first. Undo any one (or a
// selection) in any order; an undo is itself an entry you can undo (redo).

import * as store from '../store.js';
import { describe, lines, areasOf, undoEntries } from '../history.js';
import { createListKit } from '../listkit.js';
import { toast } from '../toast.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const dayOf = iso => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const timeOf = iso => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export default {
  async mount(el) {
    let entries = [];
    let open = null;
    let q = '';

    el.innerHTML = `
      <p class="muted hint">Every change on this device. Undo any of them, in any order; undoing is itself a change you can undo. Tap ≡ to select several, then Undo in the bar.</p>
      <input type="search" id="h-q" class="search" placeholder="Search history…" autocomplete="off">
      <div id="h-body"></div>`;
    const body = el.querySelector('#h-body');

    async function run(list) {
      const { changedSince, label } = await undoEntries(list);
      await render();
      toast(`${label}${changedSince ? ` (${changedSince} field${changedSince === 1 ? '' : 's'} had changed again since)` : ''}`);
    }

    const kit = this.kit = createListKit({
      reorder: false,
      noun: 'change',
      actions: [{ id: 'undo', label: 'Undo', run: ids => run(entries.filter(e => ids.includes(e.id))) }],
    });

    const render = this.render = async () => {
      entries = await store.historyList();
      const undone = new Set(entries.flatMap(e => e.undo_of || []));
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const shown = entries.filter(e => words.every(w => `${describe(e)} ${areasOf(e).join(' ')} ${lines(e).join(' ')}`.toLowerCase().includes(w)));
      let day = '';
      const rows = shown.map(e => {
        const d = dayOf(e.at);
        const headRow = d !== day ? `<li class="list-head">${esc(d)}</li>` : '';
        day = d;
        return `${headRow}
          <li class="h-row${undone.has(e.id) ? ' undone' : ''}" data-id="${e.id}">
            <button type="button" class="drag-handle kit-grip" aria-label="Select">${icon('i-grip')}</button>
            <span class="h-time muted">${timeOf(e.at)}</span>
            <span class="h-main">
              <span class="h-label">${esc(describe(e))}</span>
              <span class="muted h-sub">${esc(areasOf(e).join(', '))} · ${e.changes.length} record${e.changes.length === 1 ? '' : 's'}${undone.has(e.id) ? ' · undone' : ''}${e.undo_of ? ' · an undo' : ''}</span>
            </span>
            <button type="button" class="more" data-act="details" aria-label="Details">⋯</button>
            <button type="button" data-act="undo">Undo</button>
          </li>
          ${open === e.id ? `<li class="h-details"><ul>${lines(e).map(l => `<li>${esc(l)}</li>`).join('')}</ul></li>` : ''}`;
      }).join('');
      body.innerHTML = rows ? `<ul class="task-list history-list">${rows}</ul>` : '<div class="empty"><h2>No history yet.</h2></div>';
      kit.attach(body.querySelector('.history-list'));
    };

    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      const id = b.closest('[data-id]')?.dataset.id;
      const entry = entries.find(e => e.id === id);
      if (!entry) return;
      if (b.dataset.act === 'details') { open = open === id ? null : id; render(); }
      if (b.dataset.act === 'undo') run([entry]);
    });

    let t;
    el.querySelector('#h-q').addEventListener('input', ev => { clearTimeout(t); t = setTimeout(() => { q = ev.target.value.trim(); render(); }, 150); });

    // New changes (made in another tab, or by undoing) show up here.
    this.unsubscribe = store.subscribe(ch => { if (ch.collection === 'history') { clearTimeout(this.rt); this.rt = setTimeout(render, 200); } });
    this.onKey = ev => { if (ev.key === 'Escape' && !ev.target.closest('input, textarea')) kit.escape(); };
    addEventListener('keydown', this.onKey);
    await render();
  },

  unmount() {
    this.kit?.destroy();
    this.unsubscribe?.();
    removeEventListener('keydown', this.onKey);
  },
};

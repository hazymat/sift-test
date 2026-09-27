// Brain Dump: get it out of your head, sort it later. #/dump/<kind>
// Capture box (focused on open) with kind pills; the list below can be
// filtered, searched, edited, pinned, and converted into a task, a day plan
// item, a Find Things item or (select text) a contact.

import { cogHtml } from '../viewcog.js';
import * as store from '../store.js';
import { linkDetailsInText } from '../refs.js';
import { readDraft, writeDraft } from '../drafts.js';
import { titleFrom, cleanLine } from '../summary.js';
import { SHORTCUT } from '../listentry.js';
import { toast, undoable } from '../toast.js';
import { toHtml, richText } from '../richtext.js';
import { addTask } from '../tasks.js';
import { addItem, isoDate, parseTimed, daySettings, durationChoices, durationLabel } from '../days.js';
import { loadTree } from '../places.js';
import { contactFromText } from '../contacts.js';
import { createListKit } from '../listkit.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;

export const KINDS = [
  { id: 'thought', label: 'Thought' },
  { id: 'idea', label: 'Idea' },
  { id: 'task', label: 'Task' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'journal', label: 'Journal' },
  { id: 'place_item', label: 'Thing to store' },
];
const kindLabel = id => KINDS.find(k => k.id === id)?.label || 'Thought';
const TARGET = { tasks: ['Task', 'tasks/list'], day_items: ['Day plan', 'planner'], items: ['Find Things', 'find-things'], contacts: ['Contact', 'contacts'] };

function ago(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export default {
  async mount(el) {
    const state = this.state = { filter: 'all', q: '', showConverted: false };
    let kind = 'thought';
    let thoughts = [];
    let panel = null; // { id, type: 'plan' | 'store' }
    let editing = null;

    el.innerHTML = `
      <section class="dump-capture">
        <div id="dump-body"></div>
        <div class="dump-row">
          <div class="segmented" id="dump-kinds" role="group" aria-label="Kind">
            ${KINDS.map(k => `<button type="button" data-kind="${k.id}">${k.label}</button>`).join('')}
          </div>
          <span class="spacer"></span>
          <button type="button" data-act="save-lines" title="Each line becomes its own thought">Save lines separately</button>
          <button type="button" class="primary" data-act="save">Save <kbd>${SHORTCUT}</kbd></button>
        </div>
      </section>
      <div class="dump-tools">
        <input type="search" id="dump-q" class="search" placeholder="Search thoughts…" autocomplete="off">
        <div class="segmented" id="dump-filter" aria-label="Show">
          <button type="button" data-filter="all">All</button>
          ${KINDS.map(k => `<button type="button" data-filter="${k.id}">${k.label}</button>`).join('')}
          <button type="button" data-filter="pinned">★ Pinned</button>
        </div>
        ${cogHtml('dump')}
        <details class="tool-menu">
          <summary class="icon-btn" aria-label="More actions">${icon('i-more')}</summary>
          <div class="menu">
            <button type="button" data-act="toggle-converted">Show / hide converted</button>
            <hr>
            <a href="#/bin/archive/dump">Archive</a>
            <a href="#/bin/bin/dump">Bin</a>
          </div>
        </details>
      </div>
      <p class="muted hint">Select any text in a thought to make it a contact.</p>
      <ul id="thoughts" class="thought-list"></ul>
      <button type="button" class="make-contact" hidden>Make contact</button>`;

    const $ = s => el.querySelector(s);
    // The capture box is the notes editor (toolbar, emoji links, numbers and
    // emails become contacts). What you're typing is kept as a draft until
    // it's saved, and the thought it will become already has its id, so
    // contacts made while typing link back to it.
    let captureId = readDraft('dump:id') || store.uuidv7();
    writeDraft('dump:id', captureId);
    const captureBox = $('#dump-body');
    const input = richText(captureBox, {
      value: readDraft('dump'),
      placeholder: "What's on your mind?",
      origin: () => ({ collection: 'thoughts', id: captureId, title: titleFrom(input?.value || '') || 'Brain dump', field: 'body' }),
      onChange: md => writeDraft('dump', md),
    });
    const list = $('#thoughts');

    function paintKinds() {
      for (const b of el.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', b.dataset.kind === kind);
      for (const b of el.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', b.dataset.filter === state.filter);
    }

    const render = this.render = async () => {
      thoughts = (await store.list('thoughts', { filter: t => !t.archived_at }))
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.created_at.localeCompare(a.created_at));
      paintKinds();
      const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      const shown = thoughts.filter(t =>
        (state.filter === 'all' || (state.filter === 'pinned' ? t.pinned : t.kind === state.filter))
        && (state.showConverted || !t.converted_to || t.pinned)
        && words.every(w => t.body.toLowerCase().includes(w)));
      const hidden = thoughts.filter(t => t.converted_to && !state.showConverted).length;
      list.innerHTML = shown.map(t => card(t)).join('')
        || `<li class="empty"><h2>${thoughts.length ? 'Nothing matches.' : 'Empty head. Nice.'}</h2></li>`;
      if (hidden && !state.showConverted) list.insertAdjacentHTML('beforeend', `<li class="muted hint converted-note"><button type="button" data-act="toggle-converted">Show ${hidden} converted</button></li>`);
      kit.attach(list);
    };

    // Like iPhone Notes: the first line is the title (shown bold); if it had
    // to be shortened, the whole text follows underneath.
    function thoughtBody(t) {
      const title = t.title || titleFrom(t.body);
      const lines = t.body.split('\n');
      const firstAt = lines.findIndex(l => l.trim());
      // Only when the title is the whole first line is that line left out below.
      const whole = cleanLine(lines[firstAt] || '').toLowerCase() === title.toLowerCase();
      const rest = whole ? lines.slice(firstAt + 1).join('\n') : t.body;
      return `<div class="thought-body hand" data-act="edit"><div class="thought-title">${esc(title)}</div>${rest.trim() ? toHtml(rest) : ''}</div>`;
    }

    function card(t) {
      const conv = t.converted_to && TARGET[t.converted_to.collection];
      const href = conv && (t.converted_to.collection === 'day_items' ? `#/planner/${t.converted_to.date || ''}` : t.converted_to.collection === 'contacts' ? `#/contacts/c/${t.converted_to.id}` : `#/${conv[1]}`);
      return `
        <li class="thought${t.converted_to ? ' converted' : ''}${t.pinned ? ' pinned' : ''}" data-id="${t.id}">
          <div class="thought-head">
            <button type="button" class="drag-handle kit-grip" aria-label="Select">${icon('i-grip')}</button>
            <select class="kind-select" aria-label="Kind">${KINDS.map(k => `<option value="${k.id}" ${k.id === t.kind ? 'selected' : ''}>${k.label}</option>`).join('')}</select>
            <span class="muted">${ago(t.created_at)}</span>
            ${conv ? `<a class="chip" href="${href}">→ ${conv[0]}</a>` : ''}
            <span class="spacer"></span>
            <button type="button" class="pin" data-act="pin" aria-pressed="${!!t.pinned}" title="Pin">${t.pinned ? '★' : '☆'}</button>
          </div>
          ${editing === t.id
            ? `<div class="thought-edit" data-thought="${t.id}"></div>`
            : thoughtBody(t)}
          <div class="thought-actions">
            <button type="button" data-act="to-task">→ Task</button>
            <button type="button" data-act="plan">Plan it</button>
            <button type="button" data-act="store">→ Find Things</button>
            <span class="spacer"></span>
            <button type="button" data-act="archive">Archive</button>
            <button type="button" class="danger" data-act="delete">Delete</button>
          </div>
          ${panel?.id === t.id ? panelHtml(t) : ''}
        </li>`;
    }

    let boxes = [];
    let maxDuration = 240;
    daySettings().then(d => { maxDuration = d.duration_max_min; });
    function panelHtml(t) {
      if (panel.type === 'plan') {
        const p = parseTimed(t.body.split('\n')[0]);
        return `<div class="thought-panel">
          <label>Day<input type="date" name="plan_date" value="${isoDate()}"></label>
          <label>Time (optional)<input type="time" name="plan_time" value="${p.time || ''}"></label>
          <label>Duration<select name="plan_est"><option value="">Pick a duration</option><option value="unsure">Not sure yet</option>${durationChoices(maxDuration).map(m => `<option value="${m}">${durationLabel(m)}</option>`).join('')}</select></label>
          <button type="button" class="primary" data-act="plan-go">Add to the day</button>
        </div>`;
      }
      return `<div class="thought-panel">
        <label class="wide">Box<select name="box">${boxes.map(b => `<option value="${b.id}">${esc(b.label)}</option>`).join('')}</select></label>
        <button type="button" class="primary" data-act="store-go">Add to box</button>
      </div>`;
    }

    // ---------- selecting several ----------

    async function batch(ids, fields, label) {
      const before = ids.map(id => { const t = thoughts.find(x => x.id === id); return [id, Object.fromEntries(Object.keys(fields).map(k => [k, t?.[k] ?? null]))]; });
      await store.updateMany('thoughts', ids.map(id => [id, fields]));
      await render();
      undoable(`${label} ${ids.length} thought${ids.length === 1 ? '' : 's'}`, async () => { await store.updateMany('thoughts', before); await render(); });
    }
    const kit = this.kit = createListKit({
      reorder: false,
      noun: 'thought',
      actions: [
        { id: 'tasks', label: '→ Tasks', run: async ids => {
          const made = [];
          for (const id of ids) {
            const t = thoughts.find(x => x.id === id);
            if (!t || t.converted_to) continue;
            const [first, ...rest] = t.body.split('\n');
            const task = await addTask({ title: first.trim().slice(0, 200), notes: rest.join('\n').trim(), source_thought_id: t.id });
            await store.update('thoughts', t.id, { converted_to: { collection: 'tasks', id: task.id } });
            made.push([t.id, task.id]);
          }
          await render();
          undoable(`Made ${made.length} task${made.length === 1 ? '' : 's'}`, async () => {
            for (const [tid, taskId] of made) { await store.remove('tasks', taskId); await store.update('thoughts', tid, { converted_to: null }); }
            await render();
          });
        } },
        { id: 'pin', label: 'Pin', run: ids => batch(ids, { pinned: true }, 'Pinned') },
        { id: 'unpin', label: 'Unpin', run: ids => batch(ids, { pinned: false }, 'Unpinned') },
        { id: 'archive', label: 'Archive', run: ids => batch(ids, { archived_at: new Date().toISOString() }, 'Archived') },
        { id: 'delete', label: 'Delete', danger: true, run: ids => batch(ids, { deleted_at: new Date().toISOString() }, 'Deleted') },
      ],
    });

    // ---------- capture ----------

    async function save(splitLines) {
      const text = input.value.trim();
      if (!text) return;
      const bodies = splitLines ? text.split('\n').map(l => l.replace(/^[\s\-*•]+/, '').trim()).filter(Boolean) : [text];
      const made = [];
      const contacts = [];
      for (const body of bodies) {
        const t = await store.create('thoughts', { ...(made.length ? {} : { id: captureId }), title: titleFrom(body), body, kind, pinned: false, converted_to: null });
        // Phone numbers and emails become linked contacts.
        const linked = await linkDetailsInText(body, { collection: 'thoughts', id: t.id, title: body.split('\n')[0].slice(0, 60) });
        if (linked.linked) await store.update('thoughts', t.id, { body: linked.text, title: titleFrom(linked.text) });
        contacts.push(...linked.made);
        made.push(t);
      }
      input.setValue('');
      writeDraft('dump', '');
      captureId = store.uuidv7();
      writeDraft('dump:id', captureId);
      input.focus();
      await render();
      const extra = contacts.length ? `, ${contacts.length} new contact${contacts.length === 1 ? '' : 's'}` : '';
      undoable(`Saved ${made.length > 1 ? `${made.length} thoughts` : kindLabel(kind).toLowerCase()}${extra}`, async () => {
        await store.updateMany('thoughts', made.map(m => [m.id, { deleted_at: new Date().toISOString() }]));
        if (contacts.length) await store.updateMany('contacts', contacts.map(id => [id, { deleted_at: new Date().toISOString() }]));
        await render();
      });
    }

    captureBox.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && !ev.target.closest('.ref-picker')) { ev.preventDefault(); save(ev.shiftKey); }
    });

    // ---------- converting ----------

    async function convert(t, target, label) {
      const before = t.converted_to || null;
      await store.update('thoughts', t.id, { converted_to: target });
      panel = null;
      await render();
      toast(`${label}`, {
        action: 'Undo',
        onAction: async () => {
          await store.remove(target.collection, target.id);
          await store.update('thoughts', t.id, { converted_to: before });
          render();
        },
      });
    }

    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act], [data-kind], [data-filter]');
      if (!b) return;
      if (b.dataset.kind) { kind = b.dataset.kind; paintKinds(); input.focus(); return; }
      if (b.dataset.filter) { state.filter = b.dataset.filter; render(); return; }
      b.closest('details')?.removeAttribute('open');
      const li = b.closest('[data-id]');
      const t = li && thoughts.find(x => x.id === li.dataset.id);
      const act = b.dataset.act;
      if (act === 'save') return save(false);
      if (act === 'save-lines') return save(true);
      if (act === 'toggle-converted') { state.showConverted = !state.showConverted; return render(); }
      if (!t) return;
      if (act === 'edit') {
        editing = t.id;
        await render();
        const box = list.querySelector(`[data-id="${t.id}"] .thought-edit`);
        if (box) {
          box._editor = richText(box, { value: t.body, origin: () => ({ collection: 'thoughts', id: t.id, title: t.body.split('\n')[0].slice(0, 60), field: 'body' }) });
          box._editor.focus();
        }
      }
      else if (act === 'pin') {
        await store.update('thoughts', t.id, { pinned: !t.pinned });
        render();
      } else if (act === 'to-task') {
        const [first, ...rest] = t.body.split('\n');
        const task = await addTask({ title: first.trim().slice(0, 200), notes: rest.join('\n').trim(), source_thought_id: t.id });
        await convert(t, { collection: 'tasks', id: task.id }, `Now a task: ${task.title}`);
      } else if (act === 'plan' || act === 'store') {
        if (act === 'store') {
          boxes = [];
          for (const e of await loadTree()) for (const s of e.sections) for (const bx of s.boxes) boxes.push({ id: bx.id, label: `${bx.label_code ? `${bx.label_code} · ` : ''}${bx.name} (${e.name} › ${s.name})` });
          if (!boxes.length) { toast('Add a box in Find Things first'); return; }
        }
        panel = panel?.id === t.id && panel.type === act ? null : { id: t.id, type: act };
        render();
      } else if (act === 'plan-go') {
        const p = li.querySelector('.thought-panel');
        const date = p.querySelector('[name="plan_date"]').value || isoDate();
        const time = p.querySelector('[name="plan_time"]').value || null;
        const estRaw = p.querySelector('[name="plan_est"]').value;
        const est = Number(estRaw) || null;
        const parsed = parseTimed(t.body.split('\n')[0]);
        const item = await addItem(date, { title: parsed.title.slice(0, 200), time: time || parsed.time, end_time: parsed.end_time, estimate_min: est, estimate_unsure: estRaw === 'unsure', source_thought_id: t.id });
        await convert(t, { collection: 'day_items', id: item.id, date }, `On the plan for ${date === isoDate() ? 'today' : date}`);
      } else if (act === 'store-go') {
        const boxId = li.querySelector('[name="box"]').value;
        const count = (await store.list('items', { filter: i => i.place_id === boxId })).length;
        const item = await store.create('items', { name: t.body.split('\n')[0].trim().slice(0, 200), place_id: boxId, parent_item_id: null, notes: '', quantity: null, sort_order: count, last_moved_at: null });
        await convert(t, { collection: 'items', id: item.id }, 'Added to the box');
      } else if (act === 'archive' || act === 'delete') {
        const field = act === 'delete' ? 'deleted_at' : 'archived_at';
        await store.update('thoughts', t.id, { [field]: new Date().toISOString() });
        await render();
        undoable(act === 'delete' ? 'Deleted' : 'Archived', async () => { await store.update('thoughts', t.id, { [field]: null }); render(); });
      }
    });

    el.addEventListener('change', async ev => {
      const li = ev.target.closest('[data-id]');
      const t = li && thoughts.find(x => x.id === li.dataset.id);
      if (!t) return;
      if (ev.target.classList.contains('kind-select')) {
        const old = t.kind;
        await store.update('thoughts', t.id, { kind: ev.target.value });
        await render();
        undoable(`Now: ${kindLabel(ev.target.value)}`, async () => { await store.update('thoughts', t.id, { kind: old }); render(); });
      }
    });

    // Editing a thought saves when you leave it (Esc cancels, Ctrl+Enter saves).
    list.addEventListener('focusout', async ev => {
      const box = ev.target.closest?.('.thought-edit');
      if (!box?._editor || box.contains(ev.relatedTarget)) return;
      const t = thoughts.find(x => x.id === box.dataset.thought);
      const body = box.dataset.cancel ? t.body : box._editor.value.trim();
      box._editor = null;
      editing = null;
      if (body && body !== t.body) {
        await store.update('thoughts', t.id, { body, title: titleFrom(body) });
        undoable('Saved', async () => { await store.update('thoughts', t.id, { body: t.body, title: t.title ?? null }); render(); });
      }
      render();
    });
    this.onKey = ev => {
      if (ev.key === 'Escape' && !ev.target.closest('input, textarea, select, [contenteditable]')) kit.escape();
    };
    addEventListener('keydown', this.onKey);
    list.addEventListener('keydown', ev => {
      const box = ev.target.closest?.('.thought-edit');
      if (!box) return;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); box.dataset.cancel = '1'; ev.target.blur(); }
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ev.target.blur(); }
    });

    // Select text in a thought → "Make contact" button by the selection.
    const makeBtn = $('.make-contact');
    this.onSelect = () => {
      const sel = getSelection();
      const text = sel && !sel.isCollapsed ? sel.toString().trim() : '';
      const body = text && sel.anchorNode?.parentElement?.closest('.thought-body');
      if (!body || !el.contains(body)) { makeBtn.hidden = true; return; }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      makeBtn.hidden = false;
      Object.assign(makeBtn.style, { top: `${r.bottom + 6}px`, left: `${Math.max(8, Math.min(innerWidth - 150, r.left))}px` });
      makeBtn.dataset.text = text;
      makeBtn.dataset.thought = body.closest('[data-id]').dataset.id;
    };
    document.addEventListener('selectionchange', this.onSelect);
    makeBtn.addEventListener('mousedown', ev => ev.preventDefault());
    makeBtn.addEventListener('click', async () => {
      const t = thoughts.find(x => x.id === makeBtn.dataset.thought);
      const contact = await contactFromText(makeBtn.dataset.text, { source_thought_id: t.id, captured_at: t.created_at });
      makeBtn.hidden = true;
      getSelection().removeAllRanges();
      if (!t.converted_to) await store.update('thoughts', t.id, { converted_to: { collection: 'contacts', id: contact.id } });
      await render();
      toast(`Contact: ${contact.name || 'new'}${contact.details.length ? ` (${contact.details.map(d => d.label.toLowerCase()).join(', ')})` : ''}`, {
        action: 'Open', onAction: () => { location.hash = `#/contacts/c/${contact.id}`; },
      });
    });

    let qTimer;
    $('#dump-q').addEventListener('input', ev => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { state.q = ev.target.value.trim(); render(); }, 150);
    });

    await render();
    if (matchMedia('(hover: hover)').matches) input.focus();
  },

  route([filter]) {
    if (filter) this.state.filter = filter;
    return this.render();
  },

  unmount() {
    this.kit?.destroy();
    removeEventListener('keydown', this.onKey);
    document.removeEventListener('selectionchange', this.onSelect);
  },

  quickAdd() {
    document.querySelector('#dump-body .rich-edit')?.focus();
  },
};

// ---------- archive & bin ----------
export const binProvider = {
  area: 'dump',
  label: 'Brain Dump',
  async entries(kindOf) {
    const inState = r => !r.purged_at && (kindOf === 'bin' ? !!r.deleted_at : !r.deleted_at && !!r.archived_at);
    return (await store.list('thoughts', { includeDeleted: true, filter: inState })).map(t => ({
      collection: 'thoughts', id: t.id, kind: kindLabel(t.kind), title: t.body.split('\n')[0].slice(0, 80), subtitle: '',
      detail: t.body.includes('\n') ? `${t.body.split('\n').length} lines` : '',
      at: kindOf === 'bin' ? t.deleted_at : t.archived_at, children: [], search: t.body,
    })).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  },
};

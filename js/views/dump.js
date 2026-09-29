// Brain Dump: get it out of your head, sort it later. #/dump/<kind>
// A "New note" card (editor, kind, Attach, Save), then "Your notes" with
// search and filter tabs; the list below can be
// filtered, searched, edited, pinned, and converted into a task, a day plan
// item, a Find Things item or (select text) a contact.

import { cogHtml } from '../viewcog.js';
import { shareHtml } from '../share.js';
import * as store from '../store.js';
import { linkDetailsInText, unlinkText } from '../refs.js';
import { readDraft, writeDraft } from '../drafts.js';
import { titleFrom } from '../summary.js';
import { SHORTCUT } from '../listentry.js';
import { toast, undoable } from '../toast.js';
import { toHtml, richText, titleHtml, afterTitle, inlineAll } from '../richtext.js';
import { debounced } from '../autosave.js';
import { addTaskFirst } from '../tasks.js';
import { askEmptied, askText } from '../ask.js';
import { pickTask } from '../taskpicker.js';
import { tintHex, tintId, colourMenu } from '../colours.js';
import { rankOf, byRank, keyBetween, reorderWrites } from '../order.js';
import { addItem, isoDate, dateText, parseTimed, daySettings, durationChoices, durationLabel } from '../days.js';
import { loadTree } from '../places.js';
import { contactFromText } from '../contacts.js';
import { createListKit, typingIn } from '../listkit.js';
import { browseTo } from '../browse.js';
import * as att from '../attachments.js';
import { pointTo, flash } from '../flash.js';
import { word, dumpTypes } from '../words.js';
import { shareSheet, sharedWithText, people, fromOthers, invitesHtml, theirsHtml } from '../sharing.js';
import { slide } from '../slide.js';
import { keys } from '../keys.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;

// The types are yours (Settings → Brain Dump types; words.js). They are only
// labels to filter by: none of them changes what the app does. A note whose
// type was removed keeps it, and shows it by its id until you pick another.
const kindLabel = id => dumpTypes().find(k => k.id === id)?.label || (id ? id.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : dumpTypes()[0]?.label || 'Thought');
const TARGET = { tasks: ['Task', 'tasks/list'], day_items: ['Day plan', 'planner'], items: ['Find Things', 'find-things'], contacts: ['Contact', 'contacts'], comments: ['Comment on a task', 'tasks/list'] };

function ago(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return dateText(new Date(iso), { weekday: 'short', day: 'numeric', month: 'short' });
}

// When a note's text was last changed: the sync clock of its body (so notes
// edited before this was added get the right time too), else when it was made.
export function editedAt(t) {
  const wall = t._field_clocks?.body ? store.parseHlc(t._field_clocks.body).wall : 0;
  return new Date(Math.max(wall || 0, Date.parse(t.created_at) || 0)).toISOString();
}

// Pinned first, then the order you dragged them into (order.js: a note's
// `rank`). A new note, or one whose text you change, goes to the top. Notes
// from before ranks sort by their old order number, or if they never had one,
// most recently edited first (in hundredths of a second).
const orderKey = t => t.sort_order ?? -Date.parse(editedAt(t)) / 1e4;
const byPlace = byRank(orderKey);
const byOrder = (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || byPlace(a, b);
const rankOfNote = t => rankOf(t, orderKey);

export default {
  async mount(el) {
    // Page-wide listeners are tied to this signal and removed in unmount().
    this.gone?.abort();
    const gone = this.gone = new AbortController();
    const state = this.state = { filter: 'all', q: '' };
    let kind = dumpTypes()[0]?.id || 'thought';
    let thoughts = [];
    let pop = null; // the Plan it / → Find Things pop-up, when open
    let editing = null;
    let atts = new Map(); // note id → its attachments
    // The little "Saved ✓ / Saving… / Not saved" line above an editor.
    const showSaved = (line, state, saved = 'Saved ✓') => {
      if (!line) return;
      line.hidden = state === 'clear';
      line.dataset.state = state;
      line.textContent = state === 'saving' ? 'Saving…' : state === 'failed' ? 'Not saved: try again' : saved;
    };

    el.innerHTML = `
      <section class="dump-capture card" aria-labelledby="dump-new-h" data-sync-safe>
        <div class="dump-h-row">
          <h2 class="dump-h" id="dump-new-h">${esc(word('dump_new'))}</h2>
          <div class="save-state" id="dump-save" aria-live="polite" hidden></div>
        </div>
        <div id="dump-body"></div>
        <div id="dump-att"></div>
        <div class="dump-kinds-row">
          <span class="dump-caption" id="dump-kinds-cap">${esc(word('dump_kind'))}</span>
          <div class="dump-kinds" id="dump-kinds" role="group" aria-labelledby="dump-kinds-cap">
            ${dumpTypes().map(k => `<button type="button" data-kind="${esc(k.id)}">${esc(k.label)}</button>`).join('')}
            <button type="button" class="kind-new" data-act="new-kind" title="Add a type of note">+ New</button>
          </div>
        </div>
        <div class="dump-foot">
          <button type="button" class="att-add" data-att-add title="Attach photos, PDFs or text files (or drop them onto the box)">${icon('i-clip')}<span>Attach</span></button>
          <span class="spacer"></span>
          <button type="button" class="primary" data-act="save">Save ${keys(SHORTCUT)}</button>
        </div>
      </section>
      <section class="dump-find" aria-labelledby="dump-notes-h">
        <div class="dump-h-row">
          <h2 class="dump-h" id="dump-notes-h">${esc(word('dump_mine'))}</h2>
        </div>
        <p class="muted hint">${esc(word('ph_dump_select'))}</p>
      </section>
      <div class="dump-bar-mark" aria-hidden="true"></div>
      <div class="dump-bar">
        <!-- 👁 and ⋯ sit on the search line, so they stay on screen with it (191). -->
        <div class="dump-search-row">
          <input type="search" id="dump-q" data-sync-safe class="search" placeholder="${esc(word('ph_dump_search'))}" autocomplete="off">
          ${shareHtml()}
          ${cogHtml('dump')}
          <details class="tool-menu page-more">
            <summary class="icon-btn" aria-label="More actions">${icon('i-more')}</summary>
            <div class="menu">
              <a href="#/bin/archive/dump">Show Archive</a>
              <a href="#/bin/bin/dump">Show Bin</a>
            </div>
          </details>
        </div>
        <!-- ⋯ sits outside the scrolling filters so it stays on screen on phones (30). -->
        <div class="dump-filter-row">
          <div class="dump-filter" id="dump-filter" role="group" aria-label="Show">
          </div>
          <button type="button" class="filter-more" data-act="edit-kinds" title="Add, rename, reorder or remove types" aria-label="Edit note types">⋯</button>
        </div>
      </div>
      <div id="dump-shared"></div>
      <ul id="thoughts" class="thought-list"></ul>
      <button type="button" class="make-contact" hidden>Make contact</button>`;

    const $ = s => el.querySelector(s);
    // Search and the kinds stay at the top while you scroll through the notes;
    // once they're stuck there they get a glass background and a shadow, so
    // it's clear the list carries on above.
    this.barWatch?.disconnect();
    this.barWatch = new IntersectionObserver(([e]) => {
      $('.dump-bar')?.classList.toggle('stuck', !e.isIntersecting && e.boundingClientRect.top < 200);
    }, { rootMargin: `-${parseFloat(getComputedStyle($('.dump-bar')).top) || 0}px 0px 0px 0px` });
    this.barWatch.observe($('.dump-bar-mark'));
    // The capture box is the notes editor (toolbar, emoji links, numbers and
    // emails become contacts). What you're typing is kept as a draft until
    // it's saved, and the thought it will become already has its id, so
    // contacts made while typing link back to it.
    let captureId = readDraft('dump:id') || store.uuidv7();
    writeDraft('dump:id', captureId);
    const captureBox = $('#dump-body');
    captureBox.dataset.ctrlEnter = 'keep'; // Ctrl+Enter saves the note and you carry on writing
    // Pressing a "This is a:" pill keeps the cursor in the note: otherwise the
    // note's toolbar folds away mid-press, the pills jump up, and the click misses.
    el.addEventListener('mousedown', ev => { if (ev.target.closest('.dump-capture :is([data-kind], .kind-new)') && captureBox.contains(document.activeElement)) ev.preventDefault(); });
    // Its toolbar shows only once you click or type in it (the cursor is put
    // there when the page opens, which doesn't count), and goes again when you
    // leave it empty (CSS: #dump-body.in-use).
    for (const type of ['pointerdown', 'keydown']) captureBox.addEventListener(type, () => captureBox.classList.add('in-use'));
    captureBox.addEventListener('focusout', ev => { if (!captureBox.contains(ev.relatedTarget) && !input?.value.trim()) captureBox.classList.remove('in-use'); });
    // Esc: stop writing and see the whole page, un-dimmed (what's typed stays as the draft).
    captureBox.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ev.defaultPrevented) { ev.preventDefault(); ev.stopPropagation(); document.activeElement?.blur(); } });
    const input = richText(captureBox, {
      value: readDraft('dump'),
      placeholder: word('ph_dump_new'),
      origin: () => ({ collection: 'thoughts', id: captureId, title: titleFrom(input?.value || '') || 'Brain dump', field: 'body' }),
      onChange: md => { writeDraft('dump', md); showSaved($('#dump-save'), md.trim() ? 'saved' : 'clear', 'Draft saved ✓'); },
    });
    const list = $('#thoughts');
    // Files attached to what's being typed belong to the thought it will become.
    const paintCapture = () => { const a = atts.get(captureId); $('#dump-att').innerHTML = a?.length ? att.rowHtml(a, { addButton: false }) : ''; };

    // The type pills (New note) and filters, drawn again after types change.
    function redrawKinds() {
      const types = dumpTypes();
      $('#dump-kinds').innerHTML = types.map(k => `<button type="button" data-kind="${esc(k.id)}">${esc(k.label)}</button>`).join('')
        + '<button type="button" class="kind-new" data-act="new-kind" title="Add a type of note">+ New</button>';
      if (!types.some(k => k.id === kind)) kind = types[0]?.id || 'thought';
      if (!['all', 'pinned'].includes(state.filter) && !types.some(k => k.id === state.filter) && !state.filter.startsWith('from:')) state.filter = 'all';
      render();
    }
    // The filters: All, each type, Pinned, then each person sharing notes with you.
    function drawFilters() {
      const others = people(['note']);
      if (state.filter.startsWith('from:') && !others.some(p => `from:${p.owner_id}` === state.filter)) state.filter = 'all';
      const html = '<button type="button" data-filter="all">All</button>'
        + dumpTypes().map(k => `<button type="button" data-filter="${esc(k.id)}">${esc(k.label)}</button>`).join('')
        + '<button type="button" data-filter="pinned">★ Pinned</button>'
        + others.map(p => `<button type="button" data-filter="from:${esc(p.owner_id)}" title="Notes ${esc(p.name)} shares with you">👥 ${esc(p.name)}</button>`).join('');
      if ($('#dump-filter').innerHTML !== html) $('#dump-filter').innerHTML = html;
    }
    // Whose notes are showing: null for your own, or the person sharing them (their space, store.js).
    const theirsOwner = () => (state.filter.startsWith('from:') ? state.filter.slice(5) : null);
    // New note stays usable while someone's shared notes show: anything made
    // while writing there (the note, contacts, files) is your own.
    const useOwnSpaceWhileWriting = () => store.useSpace(theirsOwner() && !$('.dump-capture').contains(document.activeElement) ? store.spaceOf(theirsOwner()) : null);
    $('.dump-capture').addEventListener('focusin', useOwnSpaceWhileWriting);
    $('.dump-capture').addEventListener('focusout', () => setTimeout(useOwnSpaceWhileWriting));

    function paintKinds() {
      for (const b of el.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', b.dataset.kind === kind);
      for (const b of el.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', b.dataset.filter === state.filter);
    }

    // After a sync the app calls refresh(): redraw from fresh data, keeping what's open.
    const render = this.render = this.refresh = async () => {
      drawFilters();
      const owner = theirsOwner();
      useOwnSpaceWhileWriting();
      el.classList.toggle('theirs', !!owner);
      const sharedIds = new Set(fromOthers(['note']).filter(sh => sh.owner_id === owner).map(sh => sh.info.id));
      const who = owner && people(['note']).find(p => p.owner_id === owner)?.name;
      $('#dump-shared').innerHTML = owner ? theirsHtml(`Notes ${who} shares with you. You can both change them.`, '<button type="button" data-filter="all">Back to mine</button>') : invitesHtml(['note']);
      thoughts = (await (owner ? store.spaceOf(owner) : store.local).list('thoughts', { filter: t => !t.archived_at && (!owner || sharedIds.has(t.id)) })).sort(byOrder);
      atts = await att.byParent();
      paintCapture();
      paintKinds();
      const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      const shown = thoughts.filter(t =>
        (state.filter === 'all' || owner || (state.filter === 'pinned' ? t.pinned : t.kind === state.filter))
        && words.every(w => t.body.toLowerCase().includes(w)));
      list.innerHTML = shown.map(t => card(t)).join('')
        || `<li class="empty"><h2>${thoughts.length ? 'Nothing matches.' : 'Empty head. Nice.'}</h2></li>`;
      // Compact spacing: the note you're editing fills the page (like opening a box in Find Things).
      el.dataset.zoom = zoomId() || '';
      if (!el.dataset.zoom) delete el.dataset.zoom;
      kit.attach(list);
    };

    // Like iPhone Notes: the first line is the title (shown bold); if it had
    // to be shortened, the whole text follows underneath.
    function thoughtBody(t) {
      const title = t.title || titleFrom(t.body);
      const lines = t.body.split('\n');
      const firstAt = lines.findIndex(l => l.trim());
      // The title is how the first line starts (often its first sentence): below
      // it, the note carries on from where the title stops, so nothing shows twice.
      // (afterTitle keeps that part's formatting; null when the title isn't how the line starts.)
      const after = afterTitle(t.body, title);
      // (When the title is the whole first line, nothing is left of it: no empty line either.)
      const rest = after !== null ? [...(after ? [after] : []), ...lines.slice(firstAt + 1)].join('\n') : t.body;
      // Compact spacing shows the whole note run together, filling its square (CSS picks).
      // (Title and run-together text keep the note's formatting: richtext.js.)
      return `<div class="thought-body hand" data-act="edit"><div class="thought-title">${titleHtml(t.body, title)}</div>${rest.trim() ? toHtml(rest) : ''}<div class="thought-flat">${inlineAll(t.body)}</div></div>`;
    }

    // How much is in a note decides its card size: s (a jotted number or one
    // short line), m, or l (lots of text).
    function sizeOf(t) {
      const text = (t.body || '').trim();
      const lines = text.split('\n').filter(l => l.trim()).length;
      if (text.length <= 60 && lines <= 1) return 's';
      if (text.length <= 320 && lines <= 6) return 'm';
      return 'l';
    }

    // Compact spacing: the note being edited fills the page.
    const zoomId = () => (el.dataset.density === 'tight' ? editing : null);

    // Each note has its own colour (colours.js), shown when the Look is Multicolour.
    function card(t) {
      const conv = t.converted_to && TARGET[t.converted_to.collection];
      const href = conv && (t.converted_to.collection === 'day_items' ? `#/planner/${t.converted_to.date || ''}` : t.converted_to.collection === 'contacts' ? `#/contacts/c/${t.converted_to.id}` : `#/${conv[1]}`);
      return `
        <li class="thought size-${sizeOf(t)}${t.converted_to ? ' converted' : ''}${t.pinned ? ' pinned' : ''}${zoomId() === t.id ? ' zoomed' : ''}" data-id="${t.id}" style="--tint: ${tintHex(t)}">
          ${zoomId() === t.id ? '<div class="zoom-back">‹ Back to notes <span class="muted">(click anywhere outside the note, or Esc)</span></div>' : ''}
          <div class="thought-head">
            <button type="button" class="drag-handle kit-grip" aria-label="Select">${icon('i-grip')}</button>
            <button type="button" class="note-dot" data-act="colour" title="Note colour" aria-label="Note colour"><span class="swatch" style="--sw:${tintHex(t)}"></span></button>
            <select class="kind-select" aria-label="Kind">${[...dumpTypes(), ...(dumpTypes().some(k => k.id === t.kind) || !t.kind ? [] : [{ id: t.kind, label: kindLabel(t.kind) }])].map(k => `<option value="${esc(k.id)}" ${k.id === t.kind ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select>
            <span class="muted" title="Edited ${esc(new Date(editedAt(t)).toLocaleString())} · made ${esc(new Date(t.created_at).toLocaleString())}">${ago(editedAt(t))}</span>
            ${conv ? `<a class="chip" href="${href}" data-focus="${t.converted_to.collection}:${t.converted_to.id}">→ ${conv[0]}</a>` : ''}
            ${att.countChip(atts.get(t.id))}
            ${!theirsOwner() && sharedWithText({ kind: 'note', id: t.id }) ? `<button type="button" class="chip share-chip" data-act="share-people" title="Shared: see who has it">👥 ${esc(sharedWithText({ kind: 'note', id: t.id }))}</button>` : ''}
            <span class="spacer"></span>
            <button type="button" class="pin" data-act="pin" aria-pressed="${!!t.pinned}" title="Pin">${t.pinned ? '★' : '☆'}</button>
          </div>
          ${editing === t.id
            ? `<div class="save-state" data-state="saved">Saved ✓</div><div class="thought-edit" data-thought="${t.id}"></div>`
            : thoughtBody(t)}
          ${atts.get(t.id)?.length ? att.rowHtml(atts.get(t.id), { addButton: false }) : ''}
          <div class="thought-actions">
            <button type="button" data-act="to-task">→ Task</button>
            <button type="button" data-act="plan">Plan it</button>
            <button type="button" data-act="store">→ Find Things</button>
            <span class="spacer"></span>
            <span class="note-end">
            <button type="button" class="archive-pill" data-act="archive" title="Done with it: into the Archive (Undo)">Archive</button>
            <details class="tool-menu share-note note-more">
              <summary role="button" aria-label="More: colour, attach, share, delete" title="Colour, attach, share, delete">⋯</summary>
              <div class="menu">
                <button type="button" data-act="colour"><span class="swatch" style="--sw:${tintHex(t)}"></span> Colour…</button>
                <button type="button" data-act="comment" title="Add this note to a task, as a dated comment">💬 Add as comment to task…</button>
                <button type="button" data-act="append" title="Add this note to the end of a task's note">📝 Append to task note…</button>
                <button type="button" data-att-add title="Attach photos, PDFs or text files (or drop them onto the note)">${icon('i-clip')} Attach…</button>
                <button type="button" data-act="copy-plain">${icon('i-share')} Copy – plain text</button>
                <button type="button" data-act="copy-rich">${icon('i-share')} Copy – with formatting</button>
                ${navigator.share ? `<button type="button" data-act="share-sheet">${icon('i-share')} Share…</button>` : ''}
                ${theirsOwner() ? '' : '<button type="button" data-act="share-people">👥 Share with someone…</button>'}
                <hr>
                ${theirsOwner() ? `<button type="button" data-share-leave="${fromOthers(['note']).find(sh => sh.info.id === t.id)?.id || ''}">Leave this shared note</button>` : '<button type="button" class="danger" data-act="delete">Delete</button>'}
              </div>
            </details>
            </span>
          </div>
        </li>`;
    }

    let boxes = [];
    let maxDuration = 240;
    daySettings().then(d => { maxDuration = d.duration_max_min; });
    function panelHtml(t, type) {
      if (type === 'plan') {
        const p = parseTimed(t.body.split('\n')[0]);
        return `<div class="thought-panel">
          <label>Day<input type="date" name="plan_date" value="${isoDate()}"></label>
          <label>Time (optional)<input type="time" name="plan_time" value="${p.time || ''}"></label>
          <label>Estimated time<select name="plan_est"><option value="">Not estimated</option><option value="unsure">Not sure yet</option>${durationChoices(maxDuration).map(m => `<option value="${m}">${durationLabel(m)}</option>`).join('')}</select></label>
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
    // A place at the top of all notes (for a new or just-edited note), or
    // nothing if it's already there.
    function toTop(t) {
      const first = thoughts.filter(x => x !== t && x.id !== t?.id).map(rankOfNote).sort()[0] || null;
      if (t && first && rankOfNote(t) < first) return {};
      const rank = keyBetween(null, first);
      if (t) t.rank = rank;
      return { rank };
    }
    // A note's colour: saved on the note (so it stays whatever the Look), shown
    // at once without redrawing (a note may be open for writing).
    const paintTint = id => {
      const t = thoughts.find(x => x.id === id);
      const li = el.querySelector(`li.thought[data-id="${id}"]`);
      if (!t || !li) return;
      li.style.setProperty('--tint', tintHex(t));
      for (const sw of li.querySelectorAll('.note-dot .swatch, .note-more .swatch')) sw.style.setProperty('--sw', tintHex(t));
    };
    async function setColour(ids, colour) {
      const before = ids.map(id => [id, { colour: thoughts.find(x => x.id === id)?.colour ?? null }]);
      await store.updateMany('thoughts', ids.map(id => [id, { colour }]));
      for (const id of ids) { const t = thoughts.find(x => x.id === id); if (t) t.colour = colour; paintTint(id); }
      undoable(ids.length > 1 ? `Colour of ${ids.length} notes` : 'Note colour', async () => {
        await store.updateMany('thoughts', before);
        for (const [id, f] of before) { const t = thoughts.find(x => x.id === id); if (t) t.colour = f.colour; paintTint(id); }
      });
    }
    // Dragging cards (hold ⠿, then move): only the moved notes get a new place,
    // between their new neighbours (order.js), so moves on two devices merge.
    // Pinned and unpinned notes are placed separately (pinned always come first).
    async function persistOrder(order, label, ul, moved) {
      const note = id => thoughts.find(x => x.id === id);
      const writes = [];
      for (const pinned of [true, false]) {
        const group = order.filter(r => !!note(r.id)?.pinned === pinned);
        writes.push(...reorderWrites(group, r => rankOfNote(note(r.id)), moved));
      }
      if (!writes.length) return;
      const before = writes.map(([r]) => [r.id, { rank: note(r.id)?.rank ?? null }]);
      await store.updateMany('thoughts', writes.map(([r, k]) => [r.id, { rank: k }]));
      await render();
      undoable('Moved a note', async () => { await store.updateMany('thoughts', before); await render(); });
    }
    const kit = this.kit = createListKit({
      reorder: true,
      grid: true,
      onReorder: persistOrder,
      noun: 'thought',
      actions: [
        { id: 'colour', label: 'Colour…', run: ids => { colourMenu(document.querySelector('[data-kit-action="colour"]'), null, v => setColour(ids, v)); } },
        { id: 'tasks', label: '→ Tasks', run: async ids => {
          const made = [];
          for (const id of ids) {
            const t = thoughts.find(x => x.id === id);
            if (!t || t.converted_to) continue;
            const [first, ...rest] = t.body.split('\n');
            const task = await addTaskFirst({ title: first.trim().slice(0, 200), notes: rest.join('\n').trim(), source_thought_id: t.id });
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

    async function save() {
      if (theirsOwner()) { state.filter = 'all'; store.useSpace(null); } // a new note is always your own
      const text = input.value.trim();
      if (!text) return;
      const bodies = [text];
      const made = [];
      const contacts = [];
      for (const body of bodies) {
        const t = await store.create('thoughts', { ...(made.length ? {} : { id: captureId }), title: titleFrom(body), body, kind, pinned: false, converted_to: null, ...toTop(null) });
        thoughts.push(t);
        // Phone numbers and emails become linked contacts.
        const linked = await linkDetailsInText(body, { collection: 'thoughts', id: t.id, title: body.split('\n')[0].slice(0, 60) });
        if (linked.linked) await store.update('thoughts', t.id, { body: linked.text, title: titleFrom(linked.text) });
        contacts.push(...linked.made);
        made.push(t);
      }
      input.setValue('');
      writeDraft('dump', '');
      showSaved($('#dump-save'), 'clear');
      captureId = store.uuidv7();
      writeDraft('dump:id', captureId);
      input.focus();
      await render();
      // Where it went: the new note pulses in the list (showing through the
      // dimming, as you carry on writing the next one).
      for (const m of made) flash(list.querySelector(`li.thought[data-id="${m.id}"]`), { scroll: false });
      const extra = contacts.length ? `, ${contacts.length} new contact${contacts.length === 1 ? '' : 's'}` : '';
      undoable(`Saved ${made.length > 1 ? `${made.length} thoughts` : kindLabel(kind).toLowerCase()}${extra}`, async () => {
        await store.updateMany('thoughts', made.map(m => [m.id, { deleted_at: new Date().toISOString() }]));
        if (contacts.length) await store.updateMany('contacts', contacts.map(id => [id, { deleted_at: new Date().toISOString() }]));
        await render();
      });
    }

    captureBox.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && !ev.target.closest('.ref-picker')) { ev.preventDefault(); save(); }
    });

    // ---------- converting ----------

    async function convert(t, target, label) {
      const before = t.converted_to || null;
      await store.update('thoughts', t.id, { converted_to: target });
      closePop();
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

    const parentOf = node => {
      if (node.closest('.dump-capture')) return { collection: 'thoughts', id: captureId };
      const li = node.closest('li[data-id]');
      return li ? { collection: 'thoughts', id: li.dataset.id } : null;
    };
    // While a note is being edited its box isn't redrawn; the files show when you finish.
    // Files attached: while a note is being written in, only its files row
    // (and the new-note box's) is redrawn, so the writing isn't disturbed.
    const attachedDone = async () => {
      if (!editing) return render();
      atts = await att.byParent();
      paintCapture();
      const li = list.querySelector(`li.thought[data-id="${editing}"]`);
      if (!li) return;
      li.querySelector(':scope > .att-row')?.remove();
      const a = atts.get(editing);
      if (a?.length) li.querySelector('.thought-edit')?.insertAdjacentHTML('afterend', att.rowHtml(a, { addButton: false }));
    };
    att.enableDrop(el, 'li.thought[data-id], .dump-capture', parentOf, attachedDone);

    // Plan it / → Find Things: a small pop-up by the button, over the page. The
    // note stays as it is (still open for writing, if it was); Esc or a click
    // elsewhere closes the pop-up.
    function openPop(anchor, t, type) {
      const again = pop?.dataset.id === t.id && pop.dataset.type === type;
      closePop();
      if (again) return;
      pop = document.createElement('div');
      pop.className = 'thought-pop glass';
      pop.dataset.id = t.id;
      pop.dataset.type = type;
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', type === 'plan' ? 'Plan it' : 'Add to a box');
      pop.innerHTML = panelHtml(t, type);
      el.append(pop);
      const r = anchor.getBoundingClientRect();
      const w = pop.offsetWidth, h = pop.offsetHeight;
      const room = (visualViewport?.height ?? innerHeight) - 8;
      pop.style.left = `${Math.max(8, Math.min(r.left, document.documentElement.clientWidth - w - 8))}px`;
      pop.style.top = `${r.bottom + 6 + h <= room ? r.bottom + 6 : Math.max(8, r.top - 6 - h)}px`;
      pop._anchor = anchor;
    }
    function closePop() { pop?.remove(); pop = null; }
    // Leave the note being written in, as clicking away would (it saves).
    const noteEditor = () => list.querySelector('.thought-edit [contenteditable]');
    const leaveNote = () => new Promise(done => { const e = noteEditor(); if (!e) return done(); e.focus(); e.blur(); setTimeout(done, 60); });
    addEventListener('pointerdown', ev => {
      if (!pop || pop.contains(ev.target) || pop._anchor?.contains(ev.target)) return;
      closePop();
      // Clicked away from the note too: it closes, as it would have.
      if (editing && !ev.target.closest('.thought-edit')) leaveNote();
    }, { capture: true, signal: gone.signal });
    addEventListener('scroll', ev => { if (pop && !pop.contains(ev.target) && !ev.target.closest?.('.dd-menu')) closePop(); }, { capture: true, signal: gone.signal });
    el.addEventListener('click', async ev => {
      if (ev.target.closest('.note-more [data-att-add]')) ev.target.closest('details')?.removeAttribute('open');
      if (att.onClick(ev, parentOf, attachedDone)) return;
      // "→ Task" chips go to the task and light it up when you get there.
      const jump = ev.target.closest('a[data-focus]');
      if (jump) { const [c, id] = jump.dataset.focus.split(':'); pointTo(c, id); return; }
      const b = ev.target.closest('[data-act], [data-kind], [data-filter]');
      if (!b) return;
      // Choosing the kind doesn't go back into the note (on a phone that would open it full screen).
      if (b.dataset.kind) { kind = b.dataset.kind; paintKinds(); return; }
      if (b.dataset.filter) {
        // The notes slide to the chosen filter, from the side it's on (slide.js).
        const to = b.dataset.filter, from = state.filter;
        if (to === from) return;
        const order = Array.from(el.querySelectorAll('#dump-filter [data-filter]'), x => x.dataset.filter);
        slide(order.indexOf(to) > order.indexOf(from), () => { state.filter = to; return render(); });
        return;
      }
      b.closest('details')?.removeAttribute('open');
      const li = b.closest('[data-id]');
      // (From the store: if you were just writing in this note, its latest text.)
      const t = li && (thoughts.find(x => x.id === li.dataset.id) && await store.get('thoughts', li.dataset.id));
      const act = b.dataset.act;
      // Someone else's note: only changing it here (nothing made from it lands in their space).
      if (theirsOwner() && ['to-task', 'plan', 'store', 'comment', 'append', 'archive', 'delete', 'plan-go', 'store-go'].includes(act)) return;
      if (act === 'share-people' && t) return shareSheet({ kind: 'note', id: t.id, name: t.title || titleFrom(t.body) }, `"${t.title || titleFrom(t.body) || 'this note'}"`);
      if (act === 'save') return save();
      if (act === 'new-kind') {
        // A new type of note, picked for the note being written.
        const name = await askText('New type of note', { placeholder: word('ph_set_new_type'), ok: 'Add' });
        if (!name?.trim()) return;
        const { addType } = await import('../typesheet.js');
        const made = await addType(name.trim());
        kind = made.id;
        redrawKinds();
        toast(`Added "${made.label}"`);
        return;
      }
      if (act === 'edit-kinds') {
        const { openTypesSheet } = await import('../typesheet.js');
        return openTypesSheet(() => redrawKinds());
      }
      if (!t) return;
      if (act === 'edit') {
        editing = t.id;
        closePop();
        await render();
        const box = list.querySelector(`[data-id="${t.id}"] .thought-edit`);
        if (box) {
          box._orig = t.body;
          box._saved = t.body;   // what is stored right now (t itself goes stale when the list redraws)
          const line = box.previousElementSibling;
          const auto = debounced(async () => {
            const body = box._editor?.value.trim();
            if (!body || body === box._saved) return showSaved(line, 'saved');
            try {
              await store.update('thoughts', t.id, { body, title: titleFrom(body), ...toTop(t) }); // edited: goes to the top
              box._saved = body;
              showSaved(line, 'saved');
            } catch { showSaved(line, 'failed'); }
          }, 700);
          box._flush = auto.flush;
          box._editor = richText(box, {
            value: t.body,
            origin: () => ({ collection: 'thoughts', id: t.id, title: t.body.split('\n')[0].slice(0, 60), field: 'body' }),
            onChange: () => { showSaved(line, 'saving'); auto.trigger(); },
            colour: { get: () => tintId(t), set: v => setColour([t.id], v) },
          });
          box._editor.focus();
        }
      }
      else if (act === 'colour') {
        const anchor = b.closest('.note-more')?.querySelector('summary') || b;
        colourMenu(anchor, tintId(t), v => setColour([t.id], v));
      }
      else if (act === 'pin') {
        await store.update('thoughts', t.id, { pinned: !t.pinned });
        render();
      } else if (act === 'to-task') {
        const [first, ...rest] = t.body.split('\n');
        const task = await addTaskFirst({ title: first.trim().slice(0, 200), notes: rest.join('\n').trim(), source_thought_id: t.id });
        await convert(t, { collection: 'tasks', id: task.id }, `Now a task in ${word('list_inbox')}: ${task.title}`);
      } else if (act === 'plan' || act === 'store') {
        if (act === 'store') {
          boxes = [];
          for (const e of await loadTree()) for (const s of e.sections) for (const bx of s.boxes) boxes.push({ id: bx.id, label: `${bx.label_code ? `${bx.label_code} · ` : ''}${bx.name} (${e.name} › ${s.name})` });
          if (!boxes.length) { toast('Add a box in Find Things first'); return; }
        }
        openPop(b, t, act);
      } else if (act === 'plan-go') {
        if (editing) await leaveNote();
        const p = li.querySelector('.thought-panel');
        const date = p.querySelector('[name="plan_date"]').value || isoDate();
        const time = p.querySelector('[name="plan_time"]').value || null;
        const estRaw = p.querySelector('[name="plan_est"]').value;
        const est = Number(estRaw) || null;
        const [first, ...rest] = t.body.split('\n');
        const parsed = parseTimed(first);
        // The rest of the note goes in the item's note (all of it, if the title had to be cut short).
        const notes = parsed.title.length > 200 ? t.body.trim() : rest.join('\n').trim();
        const item = await addItem(date, { title: parsed.title.slice(0, 200), notes, time: time || parsed.time, end_time: parsed.end_time, estimate_min: est, estimate_unsure: estRaw === 'unsure', source_thought_id: t.id });
        await convert(t, { collection: 'day_items', id: item.id, date }, `On the plan for ${date === isoDate() ? 'today' : date}`);
      } else if (act === 'comment' || act === 'append') {
        // Pick the task (search, grouped by list: js/taskpicker.js); Cancel changes nothing.
        li.querySelector('details.note-more')?.removeAttribute('open');
        const task = await pickTask({ title: act === 'comment' ? 'Add as comment to…' : 'Append to the note of…' });
        if (!task) return;
        if (act === 'comment') {
          const made = await store.create('comments', { task_id: task.id, at: new Date().toISOString(), body: t.body.trim(), from_thought_id: t.id });
          await convert(t, { collection: 'comments', id: made.id }, `Added to "${task.title}" as a comment`);
        } else {
          // The note goes at the end of the task's note; Undo puts both back.
          const fresh = await store.get('tasks', task.id);
          const before = { notes: fresh?.notes || '' };
          const was = t.converted_to || null;
          await store.update('tasks', task.id, { notes: [before.notes.trim(), t.body.trim()].filter(Boolean).join('\n\n') });
          await store.update('thoughts', t.id, { converted_to: { collection: 'tasks', id: task.id } });
          await render();
          undoable(`Added to the note of "${task.title}"`, async () => {
            await store.update('tasks', task.id, before);
            await store.update('thoughts', t.id, { converted_to: was });
            render();
          });
        }
      } else if (act === 'store-go') {
        if (editing) await leaveNote();
        const boxId = li.querySelector('[name="box"]').value;
        const count = (await store.list('items', { filter: i => i.place_id === boxId })).length;
        const item = await store.create('items', { name: t.body.split('\n')[0].trim().slice(0, 200), place_id: boxId, parent_item_id: null, notes: '', quantity: null, sort_order: count, last_moved_at: null });
        await convert(t, { collection: 'items', id: item.id }, 'Added to the box');
      } else if (act === 'copy-plain' || act === 'copy-rich' || act === 'share-sheet') {
        // Share a saved note: the text as written (links as their words).
        const text = unlinkText(t.body);
        try {
          if (act === 'share-sheet') { await navigator.share({ title: t.title || titleFrom(t.body), text: text.replace(/\*\*|~~/g, '') }); return; }
          if (act === 'copy-rich' && window.ClipboardItem) {
            await navigator.clipboard.write([new ClipboardItem({
              'text/html': new Blob([toHtml(text)], { type: 'text/html' }),
              'text/plain': new Blob([text], { type: 'text/plain' }),
            })]);
          } else await navigator.clipboard.writeText(text.replace(/\*\*|~~/g, '')); // plain: no bold or cross-out marks
          toast(act === 'copy-rich' ? 'Copied with formatting' : 'Copied');
        } catch (err) {
          if (err?.name !== 'AbortError') toast("Couldn't share it from here");
        }
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

    // Editing a thought saves as you type, and when you leave it (click away, Esc or Ctrl+Enter).
    list.addEventListener('focusout', async ev => {
      const box = ev.target.closest?.('.thought-edit');
      // (Into the Plan it pop-up or the file viewer: still writing in the note.)
      if (!box?._editor || box.contains(ev.relatedTarget) || ev.relatedTarget?.closest?.('.thought-pop, dialog.att-view')) return;
      const t = thoughts.find(x => x.id === box.dataset.thought);
      const orig = box._orig ?? t.body;
      const body = box._editor.value.trim();
      box._editor = null;
      editing = null;
      // Everything cut or deleted, then left: ask, rather than quietly keeping
      // the old text (it was never saved empty).
      if (!body) {
        await render();
        if (!(await askEmptied('note'))) return;
        await store.update('thoughts', t.id, { deleted_at: new Date().toISOString() });
        await render();
        undoable('Deleted', async () => { await store.update('thoughts', t.id, { deleted_at: null }); render(); });
        return;
      }
      // It has been saving as you typed; this puts the last bit in.
      if (body && body !== (box._saved ?? t.body)) await store.update('thoughts', t.id, { body, title: titleFrom(body), ...toTop(t) });
      if (body && body !== orig) {
        undoable('Saved', async () => { await store.update('thoughts', t.id, { body: orig, title: titleFrom(orig) }); render(); });
      }
      // Left by pressing one of the note's own buttons (→ Task, Plan it…): redraw
      // only after that press has done its job, or the button would vanish from
      // under the finger first and nothing would happen.
      if (pressingIn(box.closest('[data-id]'))) await afterPress();
      render();
    });
    // The ⋯ of the note being written in opens its menu without taking the
    // cursor out of the note (which would close the note, and the menu with it).
    // (So do Plan it and → Find Things, which open a pop-up by the button.)
    list.addEventListener('mousedown', ev => { if (editing && ev.target.closest('.note-more > summary, [data-act="plan"], [data-act="store"]')) ev.preventDefault(); });
    // Is a press (mouse or finger) under way inside this element right now?
    let pressedOn = null;
    addEventListener('pointerdown', ev => { pressedOn = ev.target; }, { capture: true, signal: gone.signal });
    addEventListener('pointerup', () => setTimeout(() => { pressedOn = null; }, 400), { capture: true, signal: gone.signal });
    const pressingIn = node => !!(pressedOn && node?.contains(pressedOn) && !pressedOn.closest('.note-full-done')); // Done has already done its job
    const afterPress = () => new Promise(done => {
      const go = () => { removeEventListener('click', go, true); clearTimeout(timer); setTimeout(done, 0); };
      addEventListener('click', go, true);
      const timer = setTimeout(go, 800);
    });
    // Browsing with the keyboard (one note outlined, browse.js): single keys act on
    // that note, as its buttons do (#46). Ctrl+C / Ctrl+V copy the note, or attach
    // a picture or file from the clipboard to it.
    const NOTE_KEYS = { c: 'colour', t: 'to-task', a: 'archive', p: 'plan', d: 'delete', '*': 'pin' };
    const outlined = ev => !typingIn(ev.target) && !pop && !document.querySelector('dialog[open], .pill-menu, details[open]') && list.querySelector(':scope > li.kb-cur[data-id]');
    const until = async (test, ms = 1500) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise(done => setTimeout(done, 30))) { const v = test(); if (v) return v; } return null; };
    async function noteKey(li, act) {
      const t = thoughts.find(x => x.id === li.dataset.id);
      if (!t) return;
      if (act === 'colour') return colourMenu(li.querySelector('.note-dot'), tintId(t), v => setColour([t.id], v), { keyboard: true });
      const nextId = [li.nextElementSibling, li.previousElementSibling].find(e => e?.matches('li[data-id]'))?.dataset.id;
      li.querySelector(`[data-act="${act}"]`).click();
      // Plan it: the pop-up takes the keys (Enter adds it to today, Tab to its fields, Esc closes).
      if (act === 'plan' && await until(() => pop)) { pop.tabIndex = -1; pop.focus(); }
      // Gone from the list: the outline moves on to the next note.
      if ((act === 'archive' || act === 'delete') && nextId && await until(() => !list.querySelector(`li[data-id="${t.id}"]`))) browseTo(list.querySelector(`li[data-id="${nextId}"]`));
    }
    this.onKey = ev => {
      if (ev.key === 'Escape' && pop) { ev.preventDefault(); ev.stopPropagation(); closePop(); if (editing) noteEditor()?.focus(); return; }
      if (ev.key === 'Escape' && !ev.target.closest('input, textarea, select, [contenteditable]') && kit.escape()) ev.preventDefault();
      // Enter in the Plan it pop-up: Add to the day.
      if (ev.key === 'Enter' && pop?.contains(ev.target) && !ev.target.closest('button')) { ev.preventDefault(); pop.querySelector('.primary')?.click(); return; }
      const act = NOTE_KEYS[String(ev.key || '').toLowerCase()];
      const li = act && !ev.ctrlKey && !ev.metaKey && !ev.altKey && outlined(ev);
      if (!li) return;
      ev.preventDefault();
      if (!ev.repeat) noteKey(li, act);
    };
    addEventListener('keydown', this.onKey);
    // Ctrl+V: a picture or file on the clipboard is attached (text only: nothing happens).
    document.addEventListener('paste', async ev => {
      const li = outlined(ev);
      const files = li ? [...(ev.clipboardData?.files || [])] : [];
      if (!files.length) return;
      ev.preventDefault();
      const parent = parentOf(li);
      const made = await att.addFiles(parent, files);
      if (!made.length) return;
      await attachedDone(parent);
      undoable(`Clipboard ${made.every(m => m.kind === 'image') ? 'image' : 'file'} detected: attached to note`, async () => {
        for (const m of made) await store.remove('attachments', m.id);
        attachedDone(parent);
      });
    }, { signal: gone.signal });
    // Ctrl+C: the whole note, with formatting (unless some text in it is selected).
    document.addEventListener('copy', ev => {
      const li = !getSelection()?.toString() && outlined(ev);
      const t = li && thoughts.find(x => x.id === li.dataset.id);
      if (!t || !ev.clipboardData) return;
      ev.preventDefault();
      const text = unlinkText(t.body);
      ev.clipboardData.setData('text/html', toHtml(text));
      ev.clipboardData.setData('text/plain', text.replace(/\*\*|~~/g, ''));
      toast('Copied note with formatting', {
        action: 'Copy markdown instead',
        onAction: () => navigator.clipboard.writeText(text).then(() => toast('Copied as markdown'), () => toast("Couldn't copy it from here")),
      });
    }, { signal: gone.signal });
    list.addEventListener('keydown', ev => {
      const box = ev.target.closest?.('.thought-edit');
      if (!box) return;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); ev.target.blur(); }
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
    this.gone?.abort();
    this.barWatch?.disconnect();
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

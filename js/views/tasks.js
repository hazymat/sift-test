// Tasks: a simple checklist that grows into a project planner.
// #/tasks/<view>/<project id>   views: list, now, next, later, projects, done
// Every extra (day, aim, energy, project, milestone, notes) lives behind a
// task's ⋯ so the list stays simple until you want more.

import { keepDraft, draftCleared } from '../drafts.js';
import { cogHtml, layoutOn } from '../viewcog.js';
import { shareHtml } from '../share.js';
import { flash, SOFT } from '../flash.js';
import * as store from '../store.js';
import { loadAll, nest, progress, addTask, doneFields, aimDate, isDone, STATUSES, PRIORITIES, HORIZONS, horizonOf, planDay, MAX_DEPTH, depthIn, levelsUnder } from '../tasks.js';
import { ENERGY, isoDate, dateText, addDays, parseDate, addItem, durationChoices, durationLabel } from '../days.js';
import { energyMenu } from '../pillmenu.js';
import { summarise } from '../summary.js';
import { createListKit } from '../listkit.js';
import { rowSwipe } from '../rowswipe.js';
import { rankOf, reorderWrites, keyBetween } from '../order.js';
import { toast, undoable } from '../toast.js';
import { richText, toHtml, previewLine, inlineAll } from '../richtext.js';
import { loadContacts } from '../contacts.js';
import * as att from '../attachments.js';
import { atEdge, caretTo } from '../walk.js';
import { debounced } from '../autosave.js';
import { editPills, selectPill, datePill, energyPill, fillDates, touch } from '../editpills.js';
import { ask, askText, askEmptied } from '../ask.js';
import { word } from '../words.js';
import { commentsHtml, mountComments, closingComment } from '../comments.js';
import { REPEAT_CHOICES, choiceOf, repeatLabel, firstDate } from '../repeat.js';
import { keys } from '../keys.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const VIEWS = [...HORIZONS, { id: 'done', label: 'Done' }];
const LISTS = ['inbox', 'now', 'next', 'later'];   // where a task lives
const EMPTY = { get inbox() { return `${word('list_inbox')} is empty.`; }, now: 'Nothing for now.', next: 'Nothing lined up next.', later: 'Nothing for later.' };
// 👁 Layout switches (viewcog.js), all off by default.
const lay = id => layoutOn('tasks', id);
// Without the lined paper (cards, as in earlier versions) the New task box is always at the top.
const entryOnTop = () => lay('new-top') || !lay('lined');
// Highlight item when added (👁 Layout): the new tasks pulse once, soft blue (flash.js), and
// the list scrolls to them if they're out of view.
const showAdded = (root, ids) => { if (lay('added-flash')) ids.forEach((id, n) => flash(root.querySelector(`.task-list > li[data-task="${id}"]`), Object.assign({ scroll: n ? false : 'nearest' }, SOFT))); };
const COLOURS = ['#6fb0ff', '#7dd3a8', '#f5a66a', '#e58fd0', '#f0d264', '#a99cff', '#ff8a8a'];

function shortDate(iso) {
  if (!iso) return '';
  const today = isoDate();
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  if (iso === addDays(today, -1)) return 'Yesterday';
  const d = parseDate(iso);
  return dateText(d, { weekday: 'short', day: 'numeric', month: 'short' });
}

export default {
  async mount(el) {
    // Page-wide listeners are tied to this signal and removed in unmount().
    this.gone?.abort();
    const gone = this.gone = new AbortController();
    // Whether a press on the new-task entry is under way (one page-wide listener,
    // not one per redraw of the list).
    let pressing = false;
    addEventListener('pointerup', () => setTimeout(() => { pressing = false; }, 400), { passive: true, signal: gone.signal });
    const state = this.state = { view: 'now', project: null, showDone: false };
    // A 👁 Layout switch changed: draw the list again the new way.
    document.addEventListener('sift-layout', ev => { if (ev.detail?.area === 'tasks') render(); }, { signal: gone.signal });
    let aimTimeFor = null; // a task whose panel is showing the aim time field
    let data = { tasks: [], projects: [], milestones: [] };
    let people = { contacts: [], cases: [] };
    let atts = new Map(); // task id → its attachments
    let open = null; // task id with details open
    // Notes typed in the panel save shortly after typing stops, or at once
    // when the panel closes.
    let pendingNote = null;
    const noteAuto = debounced(async () => {
      const p = pendingNote;
      pendingNote = null;
      if (p) await store.update('tasks', p.id, { notes: p.md });
    }, 600);
    const flushNote = noteAuto.flush;
    const collapsed = new Set();
    let notesEditor = null;

    el.innerHTML = `
      <div class="tasks-head">
        <div class="segmented" id="task-views" role="tablist" aria-label="Views">
          ${VIEWS.map(v => `<button type="button" data-view="${v.id}">${v.label}</button>`).join('')}
        </div>
        ${shareHtml()}
          ${cogHtml('tasks')}
        <details class="tool-menu page-more">
          <summary class="icon-btn" aria-label="More actions">${icon('i-more')}</summary>
          <div class="menu">
            <button type="button" data-view="list">All tasks</button>
            <button type="button" data-view="projects">Projects</button>
            <hr>
            <button type="button" data-act="new-project">New project</button>
            <button type="button" data-act="toggle-done">Show / hide done</button>
            <hr>
            <a href="#/bin/archive/tasks">Show Archive</a>
            <a href="#/bin/bin/tasks">Show Bin</a>
          </div>
        </details>
      </div>
      <div id="task-body"></div>`;

    const body = el.querySelector('#task-body');
    const go = (view, project = state.project) => {
      const url = `#/tasks/${view}${project ? `/${project}` : ''}`;
      if (location.hash !== url) location.hash = url; else render();
    };

    // ---------- pieces ----------

    const projectOf = t => data.projects.find(p => p.id === t.project_id);
    const kidsOf = t => data.tasks.filter(k => k.parent_task_id === t.id);
    // A place just after a task and its sub-tasks (for a new sub-task at the end).
    const afterFamily = t => {
      const after = [t, ...kidsOf(t)].map(x => rankOf(x)).sort().at(-1);
      const next = data.tasks.map(x => rankOf(x)).filter(k => k > after).sort()[0] || null;
      return keyBetween(after, next);
    };

    function chips(t) {
      const out = [];
      const p = projectOf(t);
      if (p && !state.project) out.push(`<span class="chip" style="--c:${p.colour || COLOURS[0]}">${esc(p.name)}</span>`);
      // Values only, in every spacing: the icons say what they are (hover for the words).
      if (t.start_date) out.push(`<span class="chip" title="Planned for ${shortDate(t.start_date)}">📅 ${shortDate(t.start_date)}</span>`);
      const aim = aimDate(t);
      if (aim) out.push(`<span class="chip${!isDone(t) && aim < isoDate() ? ' late' : ''}" title="Target end date">⚑ ${shortDate(aim)}${t.aim_at.length > 10 ? ` ${t.aim_at.slice(11, 16)}` : ''}</span>`);
      if (t.repeat) out.push(`<span class="chip" title="Repeats">🔁 ${repeatLabel(t.repeat)}</span>`);
      if (t.estimate_min) out.push(`<span class="chip" title="Estimated time">⏱ ${durationLabel(t.estimate_min)}</span>`);
      if (t.priority && t.priority < 3) out.push(`<span class="chip pri-${t.priority}">${PRIORITIES.find(p => p.id === t.priority)?.label}</span>`);
      if (t.status === 'doing' || t.status === 'waiting') out.push(`<span class="chip">${STATUSES.find(s => s.id === t.status)?.label}</span>`);
      const kids = kidsOf(t);
      if (kids.length) {
        const pr = progress(kids);
        out.push(`<button type="button" class="chip kids" data-act="collapse" aria-expanded="${!collapsed.has(t.id)}">${collapsed.has(t.id) ? '▸' : '▾'} ${pr.done}/${pr.total}</button>`);
      }
      const files = atts.get(t.id)?.length;
      if (files) out.push(`<button type="button" class="chip" data-att-view="${t.id}" title="Attached files: press to look">📎 ${files}</button>`);
      for (const cid of t.contact_ids || []) {
        const c = people.contacts.find(x => x.id === cid);
        if (c) out.push(`<a class="chip" href="#/contacts/c/${c.id}" title="Contact">👤 ${esc(c.name || '?')}</a>`);
      }
      const kase = t.case_id && people.cases.find(k => k.id === t.case_id);
      if (kase) out.push(`<a class="chip" href="#/contacts/cases/${kase.id}" title="Case">📁 ${esc(kase.title)}</a>`);
      return out.join('');
    }

    function row(t, { draggable = true, group = '', tree = '' } = {}) {
      return `
        <li data-task="${t.id}" data-id="${t.id}" data-depth="${t.depth ?? 0}" class="${isDone(t) ? 'done' : ''} ${group}">${tree}
          <button type="button" class="drag-handle" aria-label="Select${draggable ? ' or move' : ''} ${esc(t.title)}">${icon('i-grip')}</button>
          <input type="checkbox" class="tick" ${isDone(t) ? 'checked' : ''} aria-label="Done">
          <input class="task-title" value="${esc(t.title)}" aria-label="Task" autocomplete="off">
          <button type="button" class="more" data-act="details" aria-label="Details" aria-expanded="${open === t.id}">⋯</button>
          ${subLine(t)}
        </li>
        ${open === t.id ? `<li class="task-details" data-for="${t.id}">${details(t)}</li>` : ''}`;
    }

    // Under the title: status pills, then the note (the app-wide convention).
    // Clicking a pill changes it in place.
    function subLine(t) {
      const e = ENERGY.find(x => x.id === t.energy);
      const h = horizonOf(t);
      // A "Take the tour" task (tour.js) carries a pill that starts its tour.
      const pills = (t.tour && !isDone(t) ? '<button type="button" class="pill-act tour-pill" data-act="tour" title="Start the tour of Sift">▶ Start the tour</button>' : '')
        + (e ? `<button type="button" class="pill-act bolts" data-act="energy-pill" title="Energy: ${e.label}. Click to edit the task" aria-label="Energy ${e.label}, edit">${e.bolts}</button>` : '')
        + (h !== 'now' && state.view !== h && !isDone(t) ? `<button type="button" class="pill-act" data-act="horizon-pill" title="For ${h}. Click to edit the task">${h}</button>` : '');
      const note = t.notes && open !== t.id ? noteHtml(t) : ''; // the open panel already shows the whole note
      // Expanded spacing: photos attached show as small pictures too.
      const photos = open !== t.id ? (atts.get(t.id) || []).filter(a => a.kind === 'image' && a.thumb) : [];
      const pics = photos.length ? `<span class="loose-only task-pics">${photos.slice(0, 4).map(a => `<button type="button" data-att-open="${a.id}" title="${esc(a.name)}" aria-label="Look at ${esc(a.name)}"><img src="${a.thumb}" alt="" loading="lazy"></button>`).join('')}</span>` : '';
      const c = chips(t);
      return pills || c || note || pics ? `<div class="item-sub">${pills}${c ? `<span class="chips">${c}</span>` : ''}${note}${pics}</div>` : '';
    }

    // Notes under tasks: the first line; clicking it opens (or closes) the
    // task's panel, where the whole note can be read and edited.
    function noteHtml(t) {
      const { html } = previewLine(t.notes);
      if (!html) return '';
      // All three spacings are drawn; the page's spacing shows one (CSS):
      // tight = just 📝 beside the pills, medium = every line run together (two
      // lines at most), loose = the note as written, about 8 lines at most
      // ("… more" if longer). Medium and loose start on their own line under the pills.
      const long = t.notes.split('\n').length > 8 || t.notes.length > 480;
      return `<span class="item-note task-note${long ? ' is-long' : ''}" data-act="toggle-note" role="button" tabindex="0" aria-expanded="${open === t.id}" title="${open === t.id ? 'Close' : 'Open to read or edit'}">`
        + `<span class="note-icon" title="${esc(t.notes.split('\n').map(l => l.trim()).find(Boolean)?.slice(0, 120) || 'Note')}">📝</span>`
        + `<span class="note-medium">${inlineAll(t.notes)}</span>`
        + `<span class="note-loose">${toHtml(t.notes)}</span>${long ? '<span class="note-more">… more</span>' : ''}</span>`;
    }

    // The panel: the note first, then the plan (list, time needed, dates,
    // energy), then a folded "More" for project, people, case, priority.
    function details(t) {
      const ms = data.milestones.filter(m => m.project_id === t.project_id);
      const aim = aimDate(t) || '';
      const aimTime = t.aim_at && t.aim_at.length > 10 ? t.aim_at.slice(11, 16) : '';
      const showTime = !!aimTime || aimTimeFor === t.id;
      const moreSet = t.project_id || (t.contact_ids || []).length || t.case_id || (t.priority && Number(t.priority) !== 3) || (t.status && t.status !== 'todo');
      return `
        <div class="task-notes"></div>
        ${att.rowHtml(atts.get(t.id), { parent: t.id })}
        ${commentsHtml({ task_id: t.id })}
        <div class="panel-sec detail-sec"><span class="panel-h">Details</span>
        <div class="energy-pick" role="group" aria-label="Energy"><span>Energy</span>
          ${ENERGY.map(e => `<button type="button" class="bolts" data-energy="${e.id}" aria-pressed="${t.energy === e.id}" title="${esc(`${e.label}: ${e.hint}`)}" aria-label="${e.label}">${e.bolts}</button>`).join('')}
        </div>
        <div class="detail-grid">
          <label>List<select name="horizon">${HORIZONS.map(x => `<option value="${x.id}" ${horizonOf(t) === x.id ? 'selected' : ''}>${x.label}</option>`).join('')}</select></label>
          <label>Estimated time<select name="estimate_min"><option value="">Not estimated</option>${durationChoices(480).map(m => `<option value="${m}" ${Number(t.estimate_min) === m ? 'selected' : ''}>${durationLabel(m)}</option>`).join('')}</select></label>
          <label><span class="label-row">Plan for day<span class="date-quick">${t.start_date !== isoDate() ? '<button type="button" class="linklike" data-act="plan-today" title="Plan it for today">Today</button>' : ''}${t.start_date ? '<button type="button" class="linklike date-clear" data-act="plan-clear" title="Remove the date">✕ Remove</button>' : ''}</span></span><input type="date" name="start_date" data-value="${t.start_date || ''}"></label>
          <label>Target end date<input type="date" name="aim_date" data-value="${aim}"></label>
          <label>Repeats<select name="repeat">${REPEAT_CHOICES.map(c => `<option value="${c.id}" ${choiceOf(t.repeat) === c.id ? 'selected' : ''}>${c.id === 'custom' && choiceOf(t.repeat) === 'custom' ? repeatLabel(t.repeat) : c.label}</option>`).join('')}</select></label>
          ${aim && showTime ? `<label>…at<input type="time" name="aim_time" value="${aimTime}"></label>` : ''}
          ${aim && !showTime ? `<button type="button" class="linklike" data-act="aim-time">+ add a time</button>` : ''}
        </div>
        </div>
        <details class="detail-more"${moreSet ? ' open' : ''}>
          <summary>More <span class="more-what">project, people, case, priority</span></summary>
          <div class="detail-grid">
            <label>Priority<select name="priority">${PRIORITIES.map(p => `<option value="${p.id}" ${Number(t.priority) === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
            <label>Status<select name="status">${STATUSES.map(s => `<option value="${s.id}" ${t.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
            <label>Project<select name="project_id"><option value="">None</option>${data.projects.map(p => `<option value="${p.id}" ${t.project_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="__new">+ New project…</option></select></label>
            ${t.project_id ? `<label>Milestone<select name="milestone_id"><option value="">None</option>${ms.map(m => `<option value="${m.id}" ${t.milestone_id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}<option value="__new">+ New milestone…</option></select></label>` : ''}
            <label>People<select name="add_contact"><option value="">+ Add a contact…</option>${people.contacts.filter(c => !(t.contact_ids || []).includes(c.id)).map(c => `<option value="${c.id}">${esc(c.name || '(no name)')}</option>`).join('')}</select></label>
            <label>Case<select name="case_id"><option value="">None</option>${people.cases.map(k => `<option value="${k.id}" ${t.case_id === k.id ? 'selected' : ''}>${esc(k.title)}</option>`).join('')}</select></label>
            ${(t.contact_ids || []).length ? `<div class="energy-pick"><span>With</span>${t.contact_ids.map(cid => people.contacts.find(c => c.id === cid)).filter(Boolean).map(c => `<span class="chip">${esc(c.name)} <button type="button" class="chip-x" data-act="remove-contact" data-id="${c.id}" aria-label="Remove">×</button></span>`).join('')}</div>` : ''}
          </div>
        </details>
        <div class="detail-actions">
          <button type="button" class="close-details" data-act="close-details" title="Close (or Esc)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Close</button>
          ${depthIn(t, data.tasks) < MAX_DEPTH ? '<button type="button" data-act="add-sub">+ Sub-task</button>' : ''}
          <span class="spacer"></span>
          <button type="button" data-act="archive">Archive</button>
          <button type="button" class="danger" data-act="delete">Delete</button>
        </div>`;
    }

    // New tasks: a line at the end of the list (or, on an empty page, a big ＋).
    // Focus it and it opens out like Reminders: a note space and the things you can
    // set while adding. Enter adds it and leaves the line ready for the next one.
    const dateChip = (name, label, glyph) => `<label class="entry-chip" data-chip="${name}">${glyph} <span class="chip-text" data-empty="${label}">${label}</span><input type="date" data-entry="${name}" aria-label="${label}"></label>`;
    function addBox(placeholder, empty = false, listName = null) {
      const opt = (v, t, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${t}</option>`;
      return `
        <div class="task-entry${empty ? ' is-empty' : ''}" id="task-entry">
          ${empty ? `<button type="button" class="entry-plus" data-act="focus-entry" aria-label="New task"><svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg></button>` : ''}
          <div class="task-add-line">
            <span class="add-mark" aria-hidden="true"></span>
            <input id="task-new" class="new-task-line no-inline" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="done" aria-label="New task">
            <button type="button" class="entry-add" data-act="add" title="Add (Enter)">Add <kbd>Enter</kbd></button>
            ${lay('pills-hide') ? `<button type="button" class="entry-chip pill-reveal" data-act="entry-reveal">More${keys('Shift+Enter')}</button>` : ''}
          </div>
          <div class="task-entry-more">
            <div id="task-new-note" class="add-note" data-ctrl-enter="keep"></div>
            <div class="entry-actions">
              <button type="button" class="entry-chip" data-chip="energy" aria-haspopup="menu"><span class="chip-glyph">⚡</span> <span class="chip-text" data-empty="Energy">Energy</span></button>
              <input type="hidden" data-entry="energy" value="">
              ${dateChip('start_date', 'Plan for day', '📅')}
              ${dateChip('aim_date', 'Target end date', '⚑')}
              <label class="entry-chip" data-chip="estimate_min">⏱ <span class="chip-text" data-empty="Estimated time">Estimated time</span>
                <select data-entry="estimate_min" aria-label="Estimated time"><option value="">Not estimated</option>${durationChoices(480).map(m => opt(m, durationLabel(m))).join('')}</select></label>
              <label class="entry-chip" data-chip="horizon">📥 <span class="chip-text" data-empty="${esc(listName || word('list_inbox'))}">${esc(listName || word('list_inbox'))}</span>
                <select data-entry="horizon" aria-label="Which list">${HORIZONS.map(x => opt(x.id, x.label, x.label === (listName || word('list_inbox')))).join('')}</select></label>
            </div>
            <p class="muted hint">${esc(word('ph_tasks_entry'))}</p>
          </div>
        </div>`;
    }

    // Views render one <ul> with heading rows between groups, so selection
    // (and, in List, dragging) works across the whole view.
    const head = (html, attrs = '') => `<li class="list-head"${attrs}>${html}</li>`;
    // A task and its sub-tasks share one card: the parent opens it, sub-tasks
    // sit inside, the last one closes it.
    // Lines joining a task to its sub-tasks: from just under the task's tick
    // box, down and across to each sub-task's tick box, an L that carries on
    // down while more sub-tasks follow. Level k's line runs down the middle of
    // the tick boxes one level up (the page measures where they sit: CSS
    // --tick-top / --tick-h on the list).
    // With the margin shown (👁 Layout) every tick box sits in the margin and
    // only the text is indented. The line then drops from the ruled line under
    // the task, down the left of each sub-task, and turns along the sub-task's
    // own ruled line (which starts there): the joining lines are the ruled
    // lines, so they never cross them. Level k's line is under the first letter
    // of the text one level up (CSS: the ruled lines start at 50px + indent).
    const treeX = k => 49 + (k - 1) * 28;
    const treeOf = (tasks, n) => {
      const depthAt = j => tasks[j]?.depth ?? 0;
      // Does a later row at depth k follow before the family ends?
      const goesOn = k => { for (let j = n + 1; j < tasks.length; j++) { const dj = depthAt(j); if (dj < k) return false; if (dj === k) return true; } return false; };
      const d = depthAt(n);
      const v = (k, top, bottom) => `<i class="tree-v" style="left:${treeX(k)}px;top:${top};bottom:${bottom}"></i>`;
      const parts = [];
      if (lay('margin')) {
        for (let k = 1; k <= d; k++) if (k === d || goesOn(k)) parts.push(`<i class="tree-v" style="left:calc(${50 + k * 28}px + var(--mshift, 0px));top:0;bottom:0"></i>`);
        return parts.length ? `<span class="tree" aria-hidden="true">${parts.join('')}</span>` : '';
      }
      for (let k = 1; k < d; k++) if (goesOn(k)) parts.push(v(k, '0', '0'));
      if (d > 0) {
        parts.push(v(d, '0', goesOn(d) ? '0' : 'calc(100% - var(--tick-top) - var(--tick-h) / 2)'));
        parts.push(`<i class="tree-h" style="left:${treeX(d)}px;width:${40 + d * 28 - 4 - treeX(d)}px"></i>`);
      }
      if (depthAt(n + 1) === d + 1 && n + 1 < tasks.length) parts.push(v(d + 1, 'calc(var(--tick-top) + var(--tick-h) + 4px)', '0'));
      return parts.length ? `<span class="tree" aria-hidden="true">${parts.join('')}</span>` : '';
    };
    const rowsOf = (tasks, opts) => tasks.map((t, n) => {
      const d = t.depth ?? 0;
      const next = tasks[n + 1];
      const nd = next ? next.depth ?? 0 : 0;
      const group = d === 0 ? (nd > 0 ? 'group-top' : '') : `group-kid${nd === 0 ? ' group-end' : ''}`;
      return row(t, { ...opts, group, tree: treeOf(tasks, n) });
    }).join('');
    const listOf = (inner, empty = '') => (inner ? `<ul class="task-list">${inner}</ul>` : empty);

    // Tasks in list order, hiding done ones (unless shown) and collapsed sub-trees.
    // A ticked sub-task stays with its task until the task itself is ticked.
    const waitsForParent = t => {
      const p = t.parent_task_id && data.tasks.find(x => x.id === t.parent_task_id);
      return !!p && !isDone(p);
    };
    // A task with everything under it (ticked sub-tasks too), in order.
    const familyOf = t => nest(data.tasks.filter(x => x.id === t.id || descends(x, t.id))).map(x => ({ ...x }));
    const descends = (x, id) => { for (let p = x.parent_task_id, n = 0; p && n < 10; n++) { if (p === id) return true; p = data.tasks.find(y => y.id === p)?.parent_task_id; } return false; };

    function visible(tasks) {
      const nested = nest(tasks);
      const out = [];
      let hideBelow = null;
      for (const t of nested) {
        if (hideBelow != null && t.depth > hideBelow) continue;
        hideBelow = null;
        if (!state.showDone && isDone(t) && !waitsForParent(t) && !(t.done_at > new Date(Date.now() - 60000).toISOString())) continue;
        out.push(t);
        if (collapsed.has(t.id)) hideBelow = t.depth;
      }
      return out;
    }

    // ---------- views ----------

    function viewList() {
      const project = data.projects.find(p => p.id === state.project);
      const scoped = data.tasks.filter(t => !project || t.project_id === project.id);
      let html = '';
      if (project) {
        const pr = progress(scoped);
        html += `
          <div class="project-head" style="--c:${project.colour || COLOURS[0]}">
            <button type="button" class="back" data-act="all-tasks">‹ All tasks</button>
            <input class="project-name" value="${esc(project.name)}" aria-label="Project name" data-project="${project.id}">
            <div class="bar"><span style="width:${pr.pct}%"></span></div>
            <span class="muted">${pr.done} of ${pr.total} done</span>
            <button type="button" data-act="new-milestone">+ Milestone</button>
          </div>`;
      }
      html += '<!--list-->';
      const ph = project ? `New task in ${project.name}` : 'New task';
      let entry = addBox(ph, false, word('list_inbox'));
      if (project) {
        const ms = data.milestones.filter(m => m.project_id === project.id);
        const groups = [{ id: null, name: ms.length ? 'No milestone' : '' }, ...ms];
        // Top-level tasks group by milestone; sub-tasks follow their parent.
        const top = scoped.filter(t => !t.parent_task_id || !scoped.some(p => p.id === t.parent_task_id));
        const under = id => {
          const out = [];
          const walk = pid => scoped.filter(k => k.parent_task_id === pid).forEach(k => { out.push(k); walk(k.id); });
          walk(id);
          return out;
        };
        html += listOf(groups.map(g => {
          const roots = top.filter(t => (t.milestone_id || null) === g.id);
          const tasks = visible(roots.flatMap(t => [t, ...under(t.id)]));
          const pr = progress(scoped.filter(t => t.milestone_id === g.id));
          const label = g.name ? `${esc(g.name)}${g.due_date ? ` <span class="muted">⚑ ${shortDate(g.due_date)}</span>` : ''}${g.id ? ` <span class="muted">${pr.done}/${pr.total}</span>` : ''}` : '';
          return (label ? head(label, ` data-milestone="${g.id || ''}"`) : '') + rowsOf(tasks);
        }).join(''));
      } else {
        const tasks = visible(scoped);
        html += listOf(rowsOf(tasks));
        entry = addBox(ph, !tasks.length, word('list_inbox'));
      }
      // New task line at the top (👁 Layout): before the list, after the project's heading.
      if (entryOnTop()) html = html.replace('<!--list-->', entry); else html += entry;
      html = html.replace('<!--list-->', '');
      const doneCount = scoped.filter(isDone).length;
      if (doneCount) html += `<p class="muted done-toggle"><button type="button" data-act="toggle-done">${state.showDone ? 'Hide' : 'Show'} ${doneCount} done</button></p>`;
      return html;
    }

    // Inbox / Now / Next / Later: the open tasks on that list (a task with no list
    // is in Now), with anything overdue or planned for today first in Now.
    function viewHorizon(h) {
      const today = isoDate();
      // Sub-tasks go with their task, whichever list they were given.
      const open = data.tasks.filter(t => !isDone(t) && horizonOf(t) === h && (!state.project || t.project_id === state.project)
        && !(t.parent_task_id && data.tasks.some(p => p.id === t.parent_task_id && !isDone(p))));
      const flat = list => rowsOf(list.flatMap(t => (collapsed.has(t.id) ? [{ ...t, depth: 0 }] : familyOf(t))));
      const urgent = h === 'now' ? open.filter(t => (aimDate(t) && aimDate(t) <= today) || (t.start_date && t.start_date <= today)) : [];
      const rest = open.filter(t => !urgent.includes(t));
      const body = (urgent.length ? head('Due or planned') + flat(urgent) + (rest.length ? head('Everything else') : '') : '') + flat(rest);
      const label = HORIZONS.find(x => x.id === h).label;
      const entry = addBox(h === 'inbox' ? 'New task' : `New task for ${word(`list_${h}`)}`, !open.length, label);
      return entryOnTop() ? entry + listOf(open.length ? body : '') : listOf(open.length ? body : '') + entry;
    }

    function viewProjects() {
      const cards = data.projects.map(p => {
        const tasks = data.tasks.filter(t => t.project_id === p.id);
        const pr = progress(tasks);
        const next = tasks.filter(t => !isDone(t) && !t.parent_task_id).slice(0, 3);
        return `
          <button type="button" class="project-card" data-open-project="${p.id}" style="--c:${p.colour || COLOURS[0]}">
            <span class="project-title">${esc(p.name)}</span>
            <span class="bar"><span style="width:${pr.pct}%"></span></span>
            <span class="muted">${pr.done} of ${pr.total} done${p.due_date ? ` · ⚑ ${shortDate(p.due_date)}` : ''}</span>
            ${next.length ? `<span class="project-next">${next.map(t => `<span>${esc(t.title)}</span>`).join('')}</span>` : ''}
          </button>`;
      }).join('');
      return `<div class="project-grid">${cards}<button type="button" class="project-card add-card" data-act="new-project">+ New project</button></div>
        <p class="muted hint">${esc(word('ph_tasks_projects'))}</p>`;
    }

    function viewDone() {
      const done = data.tasks.filter(t => isDone(t) && !(t.parent_task_id && data.tasks.some(p => p.id === t.parent_task_id))).sort((a, b) => b.done_at.localeCompare(a.done_at));
      if (!done.length) return '<div class="empty"><h2>Nothing ticked off yet.</h2></div>';
      const byDay = new Map();
      for (const t of done) {
        const d = isoDate(new Date(t.done_at));
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(...familyOf(t));
      }
      return listOf([...byDay].map(([d, list]) => head(`${shortDate(d)} <span class="muted">${list.length}</span>`) + rowsOf(list, { draggable: false })).join(''));
    }

    // ---------- Enter in a task's title: a new one below ----------
    // Enter saves the title (inline.js) and opens a new line just below the
    // task and its sub-tasks, at the same level: a new sub-task under the same
    // task, or a new task. Enter there adds it and opens the next; Esc or
    // leaving it empty drops the line.
    let nextAfter = null; // open a new line after this task once the list is drawn
    // Shift+Enter in a task's name or the New task line: presses More (when
    // pills are hidden behind it), then goes on into the task's note, since
    // Shift+Enter means "and more".
    body.addEventListener('keydown', async ev => {
      if (ev.key !== 'Enter' || !ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
      const t = ev.target;
      const id = t.classList?.contains('task-title') ? t.closest('li[data-task]')?.dataset.task : null;
      if (t.id !== 'task-new' && !id) return;
      ev.preventDefault(); ev.stopPropagation();
      const more = id ? t.closest('li[data-task]').querySelector('.edit-pills > .pill-reveal') : t.parentElement.querySelector(':scope > .pill-reveal');
      if (more?.getClientRects().length) more.click();
      // The note: New task's own; a task's in its panel, its note shown under it, or "Add note" (drawn a moment after More).
      for (let tries = 0; tries < 20; tries++) {
        if (!id) { body.querySelector('#task-new-note .rich-edit')?.focus(); return; }
        const row = body.querySelector(`li[data-task="${id}"]`);
        const into = body.querySelector(`.task-details[data-for="${id}"] .task-notes .rich-edit`) || row?.querySelector(':scope > .task-notes .rich-edit');
        if (into) { into.focus(); return; }
        const note = row?.querySelector(':scope > .item-sub .item-note, .edit-pills .pill-note');
        if (note) { note.matches('.item-note') ? note.click() : note.focus(); return; }
        await new Promise(ok => setTimeout(ok, 50));
      }
    }, { capture: true });
    body.addEventListener('keydown', ev => {
      const t = ev.target;
      if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.isComposing) return;
      if (!t.classList?.contains('task-title') || !t.closest('.task-list > li[data-task]')) return;
      if (!LISTS.includes(state.view) && state.view !== 'list') return;
      const id = t.closest('li[data-task]').dataset.task;
      // More pressed (its note showing): Enter goes into the note instead.
      if (revealed === id && !lay('more-panel')) { ev.preventDefault(); ev.stopPropagation(); walkGo({ li: t.closest('li[data-task]'), key: id, title: t }, 'note', 0); return; }
      const task = data.tasks.find(x => x.id === id);
      if (!task || !t.value.trim()) return;
      if (t.value.trim() === task.title) setTimeout(() => openNewAfter(id), 0); // nothing to save: no redraw
      else nextAfter = id; // opens once the saved title is redrawn
    }, { capture: true });

    // The joining lines again, from the rows as they are now (with a new line
    // in, and the New task line under the list when it's a sub-task).
    function redrawTrees() {
      const ul = body.querySelector('.task-list');
      if (!ul) return;
      const rows = [...ul.querySelectorAll(':scope > li[data-task]')];
      const line = ul.nextElementSibling?.id === 'task-entry' ? ul.nextElementSibling.querySelector('.task-add-line') : null;
      const tail = line && entryDepth > 0 ? [{ depth: entryDepth }] : [];
      const depths = [...rows.map(li => ({ depth: Number(li.dataset.depth || 0) })), ...tail];
      rows.forEach((li, n) => {
        li.querySelector(':scope > .tree')?.remove();
        const html = treeOf(depths, n);
        if (html) li.insertAdjacentHTML('afterbegin', html);
      });
      line?.querySelector(':scope > .tree')?.remove();
      if (!tail.length) return;
      // Where its tick box sits, as for a task row (the lines meet its middle).
      const mark = line.querySelector('.add-mark');
      const m = mark.getBoundingClientRect(), l = line.getBoundingClientRect();
      if (m.height > 0) { line.style.setProperty('--tick-top', `${m.top - l.top}px`); line.style.setProperty('--tick-h', `${m.height}px`); }
      line.insertAdjacentHTML('afterbegin', treeOf(depths, depths.length - 1));
    }

    // Shift+Tab in a task's note (under its name, while editing) goes back to
    // the name; Tab moves on as usual. (In the name, Tab indents: listkit.js.)
    body.addEventListener('keydown', ev => {
      if (ev.key !== 'Tab' || !ev.shiftKey || ev.defaultPrevented || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      const t = ev.target;
      if (t.closest?.('#task-new-note')) { ev.preventDefault(); body.querySelector('#task-new')?.focus(); return; }
      if (!t.closest?.('.pill-note, .note-in-place')) return;
      const title = t.closest('.task-list > li[data-task]')?.querySelector(':scope > .task-title');
      if (!title) return;
      ev.preventDefault();
      title.focus();
    });

    function openNewAfter(id) {
      const task = data.tasks.find(x => x.id === id);
      const li = body.querySelector(`.task-list > li[data-task="${id}"]`);
      if (!task || !li) return;
      const d = Number(li.dataset.depth || 0);
      let last = li;
      while (last.nextElementSibling?.matches('li[data-task]') && Number(last.nextElementSibling.dataset.depth || 0) > d) last = last.nextElementSibling;
      const row = document.createElement('li');
      row.className = `task-new-row${d ? ' group-kid' : ''}`;
      row.dataset.task = ''; // laid out like a task row (CSS), but not one yet
      row.dataset.depth = d;
      row.innerHTML = `<span class="drag-handle" aria-hidden="true" style="visibility:hidden">${icon('i-grip')}</span>
        <input type="checkbox" class="tick" disabled tabindex="-1" aria-hidden="true">
        <input class="task-title no-inline" placeholder="${d ? 'New sub-task' : 'New task'}" aria-label="${d ? 'New sub-task' : 'New task'}" autocomplete="off">`;
      last.after(row);
      redrawTrees();
      const input = row.querySelector('.task-title');
      let done = false;
      const finish = async chain => {
        if (done) return;
        done = true;
        const title = input.value.trim();
        if (!title) { row.remove(); redrawTrees(); return; }
        // Just after the task and everything under it.
        const fam = withSubs([id]).map(x => data.tasks.find(y => y.id === x)).filter(Boolean).map(x => rankOf(x)).sort();
        const next = data.tasks.map(x => rankOf(x)).filter(k => k > fam.at(-1)).sort()[0] || null;
        // Its task: the nearest row above one level up (Tab / "- " may have moved it).
        const lvl = Number(row.dataset.depth || 0);
        let up = null;
        for (let p = row.previousElementSibling; p && lvl; p = p.previousElementSibling) if (p.matches('li[data-task][data-id]') && Number(p.dataset.depth || 0) === lvl - 1) { up = p.dataset.task; break; }
        const made = await addTask({ title, parent_task_id: up, horizon: task.horizon || null, project_id: task.project_id || null, milestone_id: task.milestone_id || null, rank: keyBetween(fam.at(-1), next) });
        if (chain) nextAfter = made.id;
        await render();
        showAdded(body, [made.id]);
        undoable(`Added ${lvl ? 'sub-task' : 'task'}: ${title}`, async () => { await store.remove('tasks', made.id); await render(); });
      };
      // Tab / Shift+Tab, or "- " at the start: in a level, or back out.
      const above = () => { let p = row.previousElementSibling; while (p && !p.matches('li[data-task][data-id]')) p = p.previousElementSibling; return p; };
      const setLevel = n => {
        row.dataset.depth = n;
        row.classList.toggle('group-kid', n > 0);
        input.placeholder = n ? 'New sub-task' : 'New task';
        redrawTrees();
      };
      const deeper = () => {
        const n = Number(row.dataset.depth || 0), a = above();
        if (!a) { toast('Nothing above to go under'); return false; }
        if (n >= MAX_DEPTH) { toast('Sub-tasks go three levels deep at most'); return false; }
        if (n > Number(a.dataset.depth || 0)) { toast('Already as far in as it goes here'); return false; }
        setLevel(n + 1);
        return true;
      };
      input.addEventListener('input', () => {
        const m = input.value.match(/^[-*•] /);
        if (!m) return;
        const was = Number(row.dataset.depth || 0);
        if (!deeper()) return;
        input.value = input.value.slice(m[0].length);
        toast('Made it a sub-task', { action: 'Undo', onAction: () => { if (!row.isConnected) return; setLevel(was); input.value = m[0] + input.value; input.focus(); } });
      });
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
          ev.preventDefault(); ev.stopPropagation();
          const n = Number(row.dataset.depth || 0);
          if (ev.shiftKey) { if (n) setLevel(n - 1); else toast('Already a task of its own'); } else deeper();
          return;
        }
        if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); ev.stopPropagation(); finish(true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); }
      });
      input.addEventListener('blur', () => finish(false));
      input.focus();
    }

    // ---------- render ----------

    // After a sync the app calls refresh(): redraw from fresh data, keeping what's open.
    const render = this.render = this.refresh = async () => {
      data = await loadAll();
      people = await loadContacts();
      atts = await att.byParent();
      for (const b of el.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', b.dataset.view === state.view);
      const tabs = el.querySelector('#task-views');
      // The fade at the right edge says there are more tabs that way; none once it's scrolled to the end.
      const fade = () => tabs.classList.toggle('overflows', tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 1);
      tabs.onscroll = fade;
      fade();
      body.innerHTML = { list: viewList, inbox: () => viewHorizon('inbox'), now: () => viewHorizon('now'), next: () => viewHorizon('next'), later: () => viewHorizon('later'), projects: viewProjects, done: viewDone }[state.view]();
      fillDates(body);
      wireEntry();
      const ul = body.querySelector('.task-list');
      // Where tick boxes sit in a row, for the lines joining sub-tasks (CSS).
      const tk = ul?.querySelector(':scope > li[data-task] .tick');
      if (tk) {
        const t = tk.getBoundingClientRect();
        const top = t.top - tk.closest('li').getBoundingClientRect().top;
        if (t.height > 0 && top >= 0) { ul.style.setProperty('--tick-top', `${top}px`); ul.style.setProperty('--tick-h', `${t.height}px`); }
      }
      // Where a task's text starts, so its pills and "Add note" line (while
      // editing) start there too, at any width (CSS --title-x, --entry-x).
      const textX = (input, box) => {
        const b = box.getBoundingClientRect(), cs = getComputedStyle(box);
        return input.getBoundingClientRect().left + parseFloat(getComputedStyle(input).paddingLeft) - b.left - parseFloat(cs.paddingLeft) - parseFloat(cs.borderLeftWidth);
      };
      const ti = ul?.querySelector(':scope > li[data-task][data-depth="0"] > .task-title');
      if (ti) { const x = textX(ti, ti.closest('li')); if (x > 0) body.style.setProperty('--title-x', `${x}px`); }
      const nt = body.querySelector('#task-new'), en = nt?.closest('.task-entry');
      if (nt && en) { const x = textX(nt, en) - (parseFloat(en.style.getPropertyValue('--ind')) || 0); if (x > 0) body.style.setProperty('--entry-x', `${x}px`); }
      // Every line the same height: the New task line matches a plain task row (CSS --task-row-h).
      const plain = [...(ul?.querySelectorAll(':scope > li[data-task]') || [])].map(li => li.getBoundingClientRect().height).filter(h => h > 0);
      if (plain.length) body.style.setProperty('--task-row-h', `${Math.min(...plain)}px`);
      const ordered = state.view === 'list';
      const flatOrder = LISTS.includes(state.view); // Task Dump, Now, Next, Later: drag to reorder, no nesting
      kitOrdered.attach(ordered ? ul : null);
      kitFlat.attach(flatOrder ? ul : null);
      kitPlain.attach(ordered || flatOrder ? null : ul);
      mountComments(body, render);
      if (nextAfter) { const id = nextAfter; nextAfter = null; openNewAfter(id); }
      walkAgain();
      const notesBox = body.querySelector('.task-notes');
      if (notesBox && open) {
        const id = open;
        const t = data.tasks.find(x => x.id === id);
        notesEditor = richText(notesBox, {
          value: t?.notes || '',
          placeholder: word('ph_notes'),
          origin: () => ({ collection: 'tasks', id, title: t?.title, field: 'notes' }),
          onChange: md => { pendingNote = { id, md }; noteAuto.trigger(); },
        });
      }
    };

    // Repeats: a recurring task needs a first date; without one it's today
    // (on the Day Planner if Settings says so). Custom asks every how many what.
    async function setRepeat(task, id) {
      let repeat = REPEAT_CHOICES.find(c => c.id === id)?.repeat || null;
      if (id === 'custom') {
        const got = await ask({ title: 'Repeats every…', fields: [{ name: 'n', label: 'How many', type: 'number', value: task.repeat?.n || 3 }, { name: 'unit', label: 'Days, weeks, months or years', value: task.repeat?.every && task.repeat.every !== 'weekday' ? `${task.repeat.every}s` : 'days' }], ok: 'Set' });
        const unit = { day: 'day', days: 'day', week: 'week', weeks: 'week', month: 'month', months: 'month', year: 'year', years: 'year' }[(got?.unit || '').trim().toLowerCase()];
        const n = Math.max(1, Math.round(Number(got?.n) || 0));
        if (!got || !unit || !n) { if (got) toast('Try e.g. 3 and days'); await render(); return; }
        repeat = { every: unit, n };
      }
      const before = { repeat: task.repeat || null };
      await store.update('tasks', task.id, { repeat });
      let undoDate = null;
      if (repeat && !task.start_date && !aimDate(task)) {
        const { daySettings } = await import('../days.js');
        const first = firstDate(repeat);
        if ((await daySettings()).recurring_on_planner !== false) undoDate = await planDay({ ...task, repeat }, first);
        else await store.update('tasks', task.id, { aim_at: first });
      }
      await render();
      undoable(repeat ? `Repeats: ${repeatLabel(repeat)}` : "Doesn't repeat", async () => {
        await store.update('tasks', task.id, before);
        if (undoDate) await undoDate();
        await render();
      });
    }

    // Clicking a task's note (panel closed) edits it right there, under the
    // title: the notes editor without its toolbar or dimming, the same in every
    // spacing and width. It saves as you type and when you leave it (Esc, click
    // away, or ↑ / ↓ past its first / last line).
    function editNoteInPlace(task, noteEl) {
      const li = noteEl.closest('li[data-task]');
      const host = document.createElement('div');
      host.className = 'task-notes note-in-place';
      noteEl.remove();
      li.querySelector(':scope > .item-sub:empty')?.remove();
      li.append(host);
      let pending = null;
      const auto = debounced(async () => {
        if (pending === null || pending === (task.notes || '')) return;
        await store.update('tasks', task.id, { notes: pending });
        task = { ...task, notes: pending };
      }, 600);
      const ed = richText(host, {
        value: task.notes || '',
        placeholder: noteEl.matches('.add-note') ? 'Add note' : word('ph_notes'),
        origin: () => ({ collection: 'tasks', id: task.id, title: task.title, field: 'notes' }),
        onChange: md => { pending = md; auto.trigger(); },
        bare: true,
      });
      ed.focus();
      const leave = async () => {
        if (walkTo?.key === task.id && walkTo.part === 'note') walkTo = null; // left on purpose (Esc, Ctrl+Enter, click away): the redraw doesn't come back here
        await auto.flush(); render();
      };
      host.addEventListener('focusout', ev => {
        if (host.contains(ev.relatedTarget)) return;
        setTimeout(() => { if (host.isConnected && !host.contains(document.activeElement) && !document.querySelector('.ref-picker, dialog[open]')) leave(); }, 0);
      });
      host.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !isFullNote(host) && !document.querySelector('.ref-picker')) { ev.preventDefault(); ev.stopPropagation(); document.activeElement?.blur(); } });
    }
    const isFullNote = h => h.classList.contains('is-full');
    // "Add note" under a task being edited: typing goes straight into the notes
    // editor, as for a task's note.
    body.addEventListener('focusin', ev => {
      if (!ev.target.matches?.('.edit-pills .pill-note')) return;
      const task = data.tasks.find(x => x.id === ev.target.closest('li[data-task]')?.dataset.task);
      if (task) editNoteInPlace(task, ev.target);
    });

    // ↑ / ↓ while editing walk the list: from a task's name straight to the
    // next (or previous) task's name, down to the New task line (or from it,
    // when it's at the top). From inside a note, past its first / last line:
    // its task's name, or the next task's.
    // Moving saves the one you leave, as clicking away does. (A redraw after
    // that save puts the cursor back where it was going: walkTo.)
    let walkTo = null;
    const walkStops = () => {
      const stops = [...body.querySelectorAll('.task-list > li[data-task]')]
        .filter(li => li.getClientRects().length && li.querySelector(':scope > .task-title'))
        .map(li => ({ li, key: li.dataset.task, title: li.querySelector(':scope > .task-title') }));
      const nt = body.querySelector('#task-new');
      if (nt?.getClientRects().length) stops[entryOnTop() ? 'unshift' : 'push']({ key: 'entry', title: nt });
      return stops;
    };
    function walkApply(stop, part, at) {
      if (part === 'name') { stop.title.focus(); caretTo(stop.title, at); return true; }
      if (stop.key === 'entry') {
        const n = body.querySelector('#task-new-note .rich-edit');
        stop.title.focus(); // opens the line's note
        if (!n?.getClientRects().length) return false;
        n.focus(); caretTo(n, at); return true;
      }
      const li = stop.li;
      const task = data.tasks.find(x => x.id === stop.key);
      if (!task) return false; // a line not added yet has no note
      if (!li.querySelector('.edit-pills .pill-note, .note-in-place')) stop.title.focus(); // opens its pills ("Add note")
      const f = li.querySelector('.edit-pills .pill-note') || li.querySelector('.note-in-place [contenteditable]');
      if (f) { f.focus(); caretTo(f, at); return true; }
      const preview = [...li.querySelectorAll('.edit-pills .note-shown, .item-sub .task-note')].find(note => note.getClientRects().length);
      if (!preview) return false;
      editNoteInPlace(task, preview);
      const ed = li.querySelector('.note-in-place [contenteditable]');
      if (ed) caretTo(ed, at);
      return !!ed;
    }
    const walkGo = (stop, part, at) => {
      walkTo = { key: stop.key, part, at, until: Date.now() + 1500 };
      return walkApply(stop, part, at);
    };
    // After a redraw: back to where the cursor was going.
    const walkAgain = () => {
      if (!walkTo || Date.now() > walkTo.until) { walkTo = null; return; }
      const w = walkTo;
      const stop = walkStops().find(s => s.key === w.key);
      if (stop && !stop.li?.contains(document.activeElement) && document.activeElement !== stop.title) setTimeout(() => walkApply(stop, w.part, w.at));
    };
    body.addEventListener('pointerdown', () => { walkTo = null; }, true);
    body.addEventListener('keydown', ev => {
      if ((ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') || ev.defaultPrevented || ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing) return;
      if (document.querySelector('.ref-picker, .pill-menu')) return;
      const t = ev.target;
      if (t.closest?.('.is-full')) return; // full-screen note: the cursor stays in it
      const stops = walkStops();
      const i = stops.findIndex(s => s.title === t || (s.li ? s.li.contains(t) : !!t.closest?.('#task-entry')));
      if (i < 0) return;
      const s = stops[i], up = ev.key === 'ArrowUp';
      // In a name: straight to the task above / below (its note is Enter, after More, or a click).
      if (t === s.title) {
        ev.preventDefault();
        const to = stops[i + (up ? -1 : 1)];
        if (to) walkGo(to, 'name', up ? 'end' : 'start');
        return;
      }
      const inNote = t.matches?.('.edit-pills .pill-note') || (t.isContentEditable && t.closest('.note-in-place, #task-new-note'));
      if (!inNote || !atEdge(t, up ? 'up' : 'down')) return;
      ev.preventDefault();
      if (up) walkGo(s, 'name', 'end');
      else if (stops[i + 1]) walkGo(stops[i + 1], 'name', 'start');
    });

    // Plan for day: the task goes on that day in the Day Planner (tasks.js planDay).
    async function setPlanDay(task, date) {
      if ((task.start_date || null) === (date || null)) return;
      const undo = await planDay(task, date);
      await render();
      const day = d => (d === isoDate() ? 'today' : shortDate(d));
      undoable(date ? `${task.start_date ? 'Moved to' : 'On the Day Planner for'} ${day(date)}` : 'Taken off the Day Planner', async () => { await undo(); await render(); });
    }

    // ---------- adding ----------

    let lastTop = null; // the last top-level task added here ("- " lines go under it)
    let entryDepth = 0; // the New task line's level: 0 a task, 1 a sub-task, 2 under that
    async function addLines(lines, { parent: startParent = null, extras = {}, focus = true } = {}) {
      const made = [];
      let parent = startParent;
      const base = { project_id: state.project || null, horizon: LISTS.includes(state.view) ? state.view : 'inbox', ...extras.fields };
      let shortened = 0;
      // New tasks added at the top (👁 Layout): above every task, in the order typed.
      const top = lay('add-top') ? data.tasks.map(x => rankOf(x)).sort()[0] || null : undefined;
      let prev = null;
      for (const line of lines) {
        // A long line gets a short title; the note keeps it all.
        const { title, notes } = summarise(line.text);
        if (notes) shortened++;
        const note = [notes, extras.note].filter(Boolean).join('\n');
        const at = {};
        if (top !== undefined) { prev = keyBetween(prev, top); at.rank = prev; }
        const t = await addTask({ ...base, ...at, title, notes: note, parent_task_id: line.sub && parent ? parent : null, start_date: null });
        if (base.start_date) await planDay(t, base.start_date);
        made.push(t.id);
        if (!line.sub) { parent = t.id; lastTop = t.id; }
      }
      await render();
      if (focus) body.querySelector('#task-new')?.focus();
      showAdded(body, made); // after the focus, so its scroll to the new task wins
      undoable(`Added ${made.length} task${made.length === 1 ? '' : 's'} to ${HORIZONS.find(x => x.id === base.horizon)?.label || word('list_inbox')}${shortened ? ` (${shortened} long one${shortened === 1 ? '' : 's'} shortened, full text in the note)` : ''}`, async () => {
        await store.updateMany('tasks', made.map(id => [id, { deleted_at: new Date().toISOString() }]));
        await render();
      });
    }

    // Open the new-task entry (on an empty page it unfolds from the ＋) and put the cursor in it.
    function focusEntry() {
      body.querySelector('#task-entry')?.classList.add('open');
      body.querySelector('#task-new')?.focus();
    }

    // The new-task entry: title, note and the extras chips.
    function wireEntry() {
      const entry = body.querySelector('#task-entry');
      const ta = body.querySelector('#task-new');
      if (!entry || !ta) return;
      // Its note: the notes editor without its toolbar or dimming, as for a task's note edited in place.
      const noteBox = entry.querySelector('#task-new-note');
      const noteEd = richText(noteBox, { placeholder: 'Add note', bare: true });
      keepDraft(ta, `tasks:${state.view}:${state.project || ''}`);
      const chipOf = name => entry.querySelector(`[data-chip="${name}"]`);
      const field = name => entry.querySelector(`[data-entry="${name}"]`);
      // Show the choice on its chip.
      const paint = name => {
        const c = chipOf(name);
        const f = field(name);
        const text = c.querySelector('.chip-text');
        let shown = '';
        if (name === 'energy') { const e = ENERGY.find(x => x.id === f.value); shown = e ? e.label : ''; c.querySelector('.chip-glyph').textContent = e ? e.bolts : '⚡'; }
        else if (f.tagName === 'SELECT') shown = f.value ? f.selectedOptions[0].textContent : '';
        else shown = f.value ? shortDate(f.value) : '';
        if (name === 'horizon' && f.value === defaultList()) shown = '';
        text.textContent = shown || text.dataset.empty;
        c.classList.toggle('set', !!shown);
      };
      const defaultList = () => (LISTS.includes(state.view) ? state.view : 'inbox');
      field('horizon').value = defaultList();
      // (A date picker may report its date as "input" rather than "change": both show it.)
      for (const type of ['change', 'input']) entry.addEventListener(type, ev => { const n = ev.target.dataset?.entry; if (n) paint(n); });
      chipOf('energy').addEventListener('click', ev => {
        energyMenu(ev.currentTarget, field('energy').value || null, v => { field('energy').value = v || ''; paint('energy'); ta.focus(); });
      });
      for (const d of entry.querySelectorAll('input[type="date"]')) d.addEventListener('click', () => { try { d.showPicker(); } catch { /* not supported: the tap opens it */ } });
      const reset = () => {
        noteEd.setValue('');
        for (const f of entry.querySelectorAll('[data-entry]')) f.value = f.dataset.entry === 'horizon' ? defaultList() : '';
        for (const n of ['energy', 'start_date', 'aim_date', 'estimate_min', 'horizon']) paint(n);
        entry.classList.remove('revealed');
        showExtras();
      };
      // The extras stay open while the entry is in use. They are shown by the
      // .open class, not by focus: on an iPhone a tap takes the focus away
      // before it lands, so focus-based showing hid them under your finger.
      entry.addEventListener('focusin', () => entry.classList.add('open'));
      entry.addEventListener('pointerdown', () => { pressing = true; });
      // Leaving it with nothing typed or set puts the extras away.
      const idle = () => !ta.value.trim() && !noteEd.value.trim() && ![...entry.querySelectorAll('[data-entry]')].some(f => f.value && !(f.dataset.entry === 'horizon' && f.value === defaultList()));
      // "Add note" and the pills only show once something is typed (or still set): an empty line is just a line.
      const showExtras = () => entry.classList.toggle('typed', !!ta.value || !idle());
      entry.addEventListener('focusout', () => {
        setTimeout(() => {
          if (pressing || entry.contains(document.activeElement) || document.querySelector('.pill-menu')) return;
          // Left with a task typed: it's added, as Enter would.
          if (ta.value.trim()) { submit({ focus: false }); entry.classList.remove('open'); return; }
          if (!idle()) return;
          reset();
          entry.classList.remove('open');
        }, 300);
      });
      // Its level: "- " at the start, or Tab / Shift+Tab, make it a sub-task
      // (of the last task above) or bring it back out, straight away.
      const rowsNow = () => [...body.querySelectorAll('.task-list > li[data-task][data-id]')];
      // At the top (👁 Layout) there's nothing above it to go under.
      const onTop = entryOnTop();
      const deepest = () => { const last = !onTop && rowsNow().at(-1); return last ? Math.min(MAX_DEPTH, Number(last.dataset.depth || 0) + 1) : 0; };
      const setDepth = d => { entryDepth = d; entry.dataset.depth = d; entry.style.setProperty('--ind', `${d * 28}px`); redrawTrees(); };
      setDepth(Math.min(entryDepth, deepest()));
      const parentAt = d => (d ? [...rowsNow()].reverse().find(li => Number(li.dataset.depth || 0) === d - 1)?.dataset.task || null : null);
      const deeper = () => {
        if (onTop || !rowsNow().length) { toast('Nothing above to go under'); return false; }
        if (entryDepth >= deepest()) { toast(entryDepth >= MAX_DEPTH ? 'Sub-tasks go three levels deep at most' : 'Already as far in as it goes here'); return false; }
        setDepth(entryDepth + 1);
        return true;
      };
      ta.addEventListener('input', () => {
        const m = ta.value.match(/^[-*•] /);
        if (!m) return;
        const was = entryDepth;
        if (!deeper()) return;
        ta.value = ta.value.slice(m[0].length);
        toast(entryDepth === 1 ? 'Made it a sub-task' : 'Made it a sub-task of the sub-task', { action: 'Undo', onAction: () => { setDepth(was); ta.value = m[0] + ta.value; ta.focus(); } });
      });
      entry.addEventListener('keydown', ev => {
        if (ev.target === ta && ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
          ev.preventDefault();
          if (ev.shiftKey) { if (entryDepth) setDepth(entryDepth - 1); else toast('Already a task of its own'); } else deeper();
        }
      });
      const submit = ({ focus = true } = {}) => {
        const raw = ta.value;
        const text = raw.replace(/^[\s\-*•]+/, '').trim();
        if (!text) return;
        const under = parentAt(entryDepth);
        const sub = !!under || /^(\s|[-*•])/.test(raw);
        const aim = field('aim_date').value;
        const fields = {
          energy: field('energy').value || null,
          start_date: field('start_date').value || null,
          aim_at: aim || null,
          estimate_min: field('estimate_min').value ? Number(field('estimate_min').value) : null,
        };
        if (field('horizon').value !== defaultList()) fields.horizon = field('horizon').value;
        const note = noteEd.value.trim();
        ta.value = '';
        draftCleared(ta);
        reset();
        return addLines([{ text, sub }], { parent: under || (sub ? lastTop : null), extras: { fields, note }, focus });
      };
      // Esc or Ctrl+Enter in the note (before the notes editor's own Esc): with a
      // task typed, it's added (as Enter on its line); without, a note written is
      // kept for later and an empty one closes the entry. Enter is a new line.
      entry.addEventListener('keydown', ev => {
        if (!noteBox.contains(ev.target) || noteBox.classList.contains('is-full') || document.querySelector('.ref-picker')) return;
        const esc = ev.key === 'Escape', done = ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey);
        if (!esc && !done) return;
        ev.preventDefault(); ev.stopPropagation();
        walkTo = null; // left on purpose: the redraw doesn't bring the cursor back here
        if (ta.value.trim()) {
          submit({ focus: done })?.then(() => { if (esc) body.querySelector('#task-new')?.closest('.open')?.classList.remove('open'); });
          if (esc) document.activeElement?.blur(); else ta.focus(); // Ctrl+Enter: on to the next task
          return;
        }
        if (!noteEd.value.trim()) { reset(); entry.classList.remove('open'); }
        document.activeElement?.blur();
      }, true);
      entry.addEventListener('keydown', ev => {
        if (ev.target !== ta) return;
        // Esc with something typed: keep it (add the task, as Enter does) and stop editing.
        if (ev.key === 'Escape' && ta.value.trim()) {
          ev.preventDefault(); ev.stopPropagation();
          submit()?.then(() => {
            const line = body.querySelector('#task-new');
            line?.blur();
            line?.closest('.open')?.classList.remove('open');
          });
          return;
        }
        // Esc on an empty line closes the entry: the extras go away, unset.
        if (ev.key === 'Escape' && !ta.value) {
          ev.preventDefault(); ev.stopPropagation();
          reset();
          entry.classList.remove('open');
          ta.blur();
          return;
        }
        if (ev.key !== 'Enter' || ev.isComposing || ev.shiftKey) return;
        ev.preventDefault();
        submit();
      });
      ta.addEventListener('input', showExtras); // after the "- " check, which may empty the line
      showExtras();
      entry.submitEntry = submit;
    }

    // ---------- reorder, nest, select (shared list behaviour) ----------

    // Persist what the kit reports: a new place (order.js) for just the moved
    // tasks, parents from depth, and in a project the milestone of the heading a
    // top-level task sits under. Only what changed is written, so moves made on
    // two devices merge.
    async function persistOrder(rows, label, ul, moved) {
      const task = id => data.tasks.find(x => x.id === id);
      const places = new Map(reorderWrites(rows, r => rankOf(task(r.id)), moved).map(([r, k]) => [r.id, k]));
      const milestoneOf = new Map();
      let current = null;
      for (const li of ul.children) {
        if (li.matches('.list-head[data-milestone]')) current = li.dataset.milestone || null;
        else if (li.dataset.id) milestoneOf.set(li.dataset.id, current);
      }
      const stack = [];
      const changes = [];
      const before = [];
      for (const r of rows) {
        const depth = Math.min(r.depth, stack.length);
        const parent = depth ? stack[depth - 1] : null;
        stack.length = depth;
        stack.push(r.id);
        const t = task(r.id);
        const fields = {};
        if (places.has(r.id)) fields.rank = places.get(r.id);
        if (parent !== (t.parent_task_id || null)) {
          fields.parent_task_id = parent;
          // Out of its task on Now / Next / Later: it joins the list it's on, so it stays in view.
          if (!parent && LISTS.includes(state.view) && horizonOf(t) !== state.view) fields.horizon = state.view;
        }
        if (state.project && !parent && ul.querySelector('.list-head[data-milestone]')) {
          const m = milestoneOf.get(r.id) ?? null;
          if (m !== (t.milestone_id || null)) fields.milestone_id = m;
        }
        if (!Object.keys(fields).length) continue;
        changes.push([r.id, fields]);
        before.push([r.id, Object.fromEntries(Object.keys(fields).map(k => [k, t[k] ?? null]))]);
      }
      if (changes.length) await store.updateMany('tasks', changes);
      await render();
      undoable(label, async () => { await store.updateMany('tasks', before); await render(); });
    }

    // Selected tasks plus everything under them.
    const withSubs = ids => {
      const out = new Set(ids);
      const walk = pid => data.tasks.filter(k => k.parent_task_id === pid).forEach(k => { out.add(k.id); walk(k.id); });
      ids.forEach(walk);
      return [...out];
    };
    async function batchSet(ids, fields, label, { subs = false, fade = false } = {}) {
      const all = subs ? withSubs(ids) : ids;
      const before = all.map(id => { const t = data.tasks.find(x => x.id === id); return [id, Object.fromEntries(Object.keys(fields).map(k => [k, t?.[k] ?? null]))]; });
      const leaving = fade ? all.filter(id => { const t = data.tasks.find(x => x.id === id); return t && leavesList(t); }) : [];
      await store.updateMany('tasks', all.map(id => [id, fields]));
      // Done: they fade out, with a note, as one ticked on its own does (tickAway redraws after).
      if (leaving.length) tickAway(leaving); else await render();
      undoable(`${label} ${all.length} task${all.length === 1 ? '' : 's'}`, async () => { await store.updateMany('tasks', before); await render(); });
    }
    const taskActions = [
      { id: 'done', label: 'Done', key: 'Ctrl+Enter', run: ids => batchSet(ids, doneFields(true), 'Done:', { fade: true }) },
      // Move ▸ opens sideways to the lists, less the one being looked at.
      { id: 'now', label: 'Now', group: 'Move', when: () => state.view !== 'now', run: ids => batchSet(ids, { horizon: 'now' }, 'Transferred to Now:') },
      { id: 'next', label: 'Next', group: 'Move', when: () => state.view !== 'next', run: ids => batchSet(ids, { horizon: 'next' }, 'Transferred to Next:') },
      { id: 'later', label: 'Later', group: 'Move', when: () => state.view !== 'later', run: ids => batchSet(ids, { horizon: 'later' }, 'Transferred to Later:') },
      { id: 'archive', label: 'Archive', key: 'A', run: ids => batchSet(ids, { archived_at: new Date().toISOString() }, 'Archived', { subs: true }) },
      { id: 'delete', label: 'Delete', key: 'D', danger: true, run: ids => batchSet(ids, { deleted_at: new Date().toISOString() }, 'Deleted', { subs: true }) },
    ];

    // Phones: swipe a task sideways (rowswipe.js): left for ✓ Done and ⋯ More, right for Delete.
    rowSwipe(body, {
      rows: '.task-list > li[data-task]',
      actions: li => ({
        left: [
          { label: '⋯ More', cls: 'ra-more', run: row => row.querySelector(':scope > [data-act="details"]')?.click() },
          { label: li.classList.contains('done') ? '↺ Not done' : '✓ Done', cls: 'ra-done', run: row => row.querySelector(':scope > .tick')?.click() },
        ],
        right: [{ label: 'Delete', cls: 'ra-delete', run: row => taskActions.find(x => x.id === 'delete').run([row.dataset.task]) }],
      }),
    });
    // Dragged onto the middle of another task: they become its sub-tasks, at the end.
    async function nestUnder(ids, targetId) {
      const target = data.tasks.find(t => t.id === targetId);
      if (!target) return;
      const moving = ids.map(id => data.tasks.find(t => t.id === id)).filter(t => t && t.id !== targetId && !descends(target, t.id));
      if (!moving.length) return;
      // Three levels at most: the target's depth, plus one, plus what's under the moved task.
      if (moving.some(t => depthIn(target, data.tasks) + 1 + levelsUnder(t, data.tasks) > MAX_DEPTH)) {
        toast('Sub-tasks go three levels deep at most');
        await render();
        return;
      }
      const family = data.tasks.filter(t => t.id === targetId || descends(t, targetId)).map(t => rankOf(t)).sort();
      const end = family.at(-1);
      const next = data.tasks.map(t => rankOf(t)).filter(k => k > end).sort()[0] || null;
      const before = moving.map(t => [t.id, { parent_task_id: t.parent_task_id ?? null, rank: t.rank ?? null, project_id: t.project_id ?? null }]);
      let k = end;
      const writes = moving.map(t => { k = keyBetween(k, next); return [t.id, { parent_task_id: targetId, rank: k, project_id: target.project_id ?? null }]; });
      await store.updateMany('tasks', writes);
      collapsed.delete(targetId);
      await render();
      undoable(`${moving.length === 1 ? `"${moving[0].title}" is` : `${moving.length} tasks are`} now under "${target.title}"`, async () => { await store.updateMany('tasks', before); await render(); });
    }
    const kitOrdered = this.kitOrdered = createListKit({ reorder: true, indent: true, maxDepth: MAX_DEPTH, holdAnywhere: true, sideways: false, noun: 'task', actions: taskActions, onReorder: persistOrder, onNest: nestUnder });
    const kitPlain = this.kitPlain = createListKit({ reorder: false, noun: 'task', actions: taskActions });
    // In Task Dump / Now / Next / Later only the order changes: just the moved
    // tasks get a new place (order.js), so tasks on other lists keep theirs.
    // Now / Next / Later: the same drag rules as All tasks (sideways, onto a task,
    // in and out of a task's sub-tasks), with only the moved tasks re-placed.
    const kitFlat = this.kitFlat = createListKit({ reorder: true, indent: true, maxDepth: MAX_DEPTH, holdAnywhere: true, sideways: false, onNest: (ids, target) => nestUnder(ids, target), noun: 'task', onReorder: persistOrder, actions: taskActions });

        // ---------- editing ----------

    async function change(id, fields, label = 'Saved', opts, away = null) {
      const before = data.tasks.find(t => t.id === id);
      const old = Object.fromEntries(Object.keys(fields).map(k => [k, before?.[k] ?? null]));
      await store.update('tasks', id, fields);
      if (away) tickAway(away); else await render();
      undoable(label, async () => { await store.update('tasks', id, old); await render(); }, opts);
    }

    // A task ticked off a list doesn't vanish at once: it stays, crossed out,
    // fading while its "Done" message shows, then the rows below slide up into
    // its place. (Several ticked close together each finish their own fade.)
    const FADE_MS = 6000; // as long as a message with Undo shows (toast.js)
    let fading = 0;
    async function tickAway(ids) {
      const rows = ids.map(x => el.querySelector(`.task-list > li[data-task="${x}"]`)).filter(Boolean);
      if (!rows.length) return render();
      fading++;
      for (const r of rows) { r.classList.add('done', 'ticked-away'); r.style.setProperty('--fade', `${FADE_MS}ms`); const tick = r.querySelector(':scope > .tick'); if (tick) tick.checked = true; }
      // On the task ticked: a note while it fades (untick it to keep it here). Several
      // ticked at once: one note on each run of them next to each other.
      const heads = rows.filter(r => !rows.includes(r.previousElementSibling));
      heads.forEach((r, n) => r.insertAdjacentHTML('beforeend', `<span class="done-note"${n ? '' : ' aria-live="polite"'}><span class="done-glass" aria-hidden="true">⏳</span> Transferring to Done list</span>`));
      void rows[0].offsetHeight; // start from full view, then fade
      rows.forEach(r => r.classList.add('fading'));
      await new Promise(done => setTimeout(done, FADE_MS));
      if (rows.some(r => r.isConnected)) {
        for (const r of rows) { r.style.height = `${r.offsetHeight}px`; r.style.overflow = 'hidden'; }
        void rows[0].offsetHeight;
        rows.forEach(r => r.classList.add('closing'));
        await new Promise(done => setTimeout(done, 280));
        rows.forEach(r => r.remove());
      }
      if (--fading === 0) render();
    }
    // Would ticking this task take it off the list being shown? (A sub-task
    // stays, crossed out, under its open task; the Done list keeps everything.)
    const leavesList = task => state.view !== 'done' && !(task.parent_task_id && data.tasks.some(p => p.id === task.parent_task_id && !isDone(p)));

    async function newProject() {
      const name = await askText('New project', { ok: 'Add' });
      if (!name?.trim()) return null;
      return store.create('projects', {
        name: name.trim(), description: '', status: 'active', colour: COLOURS[data.projects.length % COLOURS.length],
        sort_order: data.projects.length, due_date: null,
      });
    }

    // A task's panel: date fields save when left (inline.js); a Clear in a
    // laptop's picker leaves the field, so it's saved straight away.
    body.addEventListener('input', ev => {
      const t = ev.target;
      if (t.type === 'date' && t.name && !touch && !t.value && !t.validity.badInput) t.blur();
    });
    body.addEventListener('change', async ev => {
      const t = ev.target;
      const li = t.closest('[data-task], [data-for]');
      const id = li?.dataset.task || li?.dataset.for;
      if (t.dataset.project) {
        const p = data.projects.find(x => x.id === t.dataset.project);
        // A project's name removed: put it back (deleting a project stays a deliberate act).
        if (!t.value.trim()) { t.value = p?.name || ''; toast('A project needs a name, so it was put back'); return; }
        if (t.value.trim() === p?.name) return;
        const old = p.name;
        await store.update('projects', p.id, { name: t.value.trim() });
        undoable('Saved', async () => { await store.update('projects', p.id, { name: old }); render(); });
        return;
      }
      if (!id) return;
      const task = data.tasks.find(x => x.id === id);
      if (t.classList.contains('tick')) {
        const kids = t.checked ? data.tasks.filter(x => descends(x, id) && !isDone(x)) : [];
        if (kids.length) {
          // The task and everything still open under it go to Done together.
          await store.updateMany('tasks', [id, ...kids.map(k => k.id)].map(x => [x, doneFields(true)]));
          if (leavesList(task)) tickAway(withSubs([id])); else await render();
          undoable(`Done: ${task.title} and ${kids.length} sub-task${kids.length === 1 ? '' : 's'}`, async () => {
            await store.updateMany('tasks', [id, ...kids.map(k => k.id)].map(x => [x, doneFields(false)]));
            await render();
          }, { more: closingComment({ task_id: id }) });
          return;
        }
        await change(id, doneFields(t.checked), t.checked ? `Done: ${task.title}` : 'Not done', t.checked ? { more: closingComment({ task_id: id }) } : undefined, t.checked && leavesList(task) ? withSubs([id]) : null);
      } else if (t.classList.contains('task-title')) {
        if (!t.value.trim()) {
          // The whole title removed: delete the task, or put the title back.
          if (await askEmptied('task')) await retire(task, 'delete'); else t.value = task.title;
          return;
        }
        if (t.value.trim() !== task.title) await change(id, { title: t.value.trim() });
      } else if (t.name === 'aim_date' || t.name === 'aim_time') {
        // (The time field is only there once a time has been asked for.)
        const d = body.querySelector(`[data-for="${id}"] [name="aim_date"]`)?.value || '';
        const tm = body.querySelector(`[data-for="${id}"] [name="aim_time"]`)?.value || '';
        await change(id, { aim_at: d ? (tm ? `${d}T${tm}` : d) : null }, d ? `Target end date: ${shortDate(d)}` : 'Target end date cleared');
      } else if (t.name === 'add_contact') {
        if (t.value) await change(id, { contact_ids: [...(task.contact_ids || []), t.value] }, 'Added a person');
      } else if (t.name === 'project_id' && t.value === '__new') {
        const p = await newProject();
        if (p) await change(id, { project_id: p.id, milestone_id: null }, `Moved to ${p.name}`); else render();
      } else if (t.name === 'milestone_id' && t.value === '__new') {
        const name = await askText('New milestone', { placeholder: word('ph_milestone'), ok: 'Add' });
        if (!name?.trim()) { render(); return; }
        const m = await store.create('milestones', { project_id: task.project_id, name: name.trim(), due_date: null, done_at: null, sort_order: data.milestones.length });
        await change(id, { milestone_id: m.id });
      } else if (t.name === 'start_date') {
        await setPlanDay(task, t.value || null);
      } else if (t.name === 'repeat') {
        await setRepeat(task, t.value);
      } else if (t.name) {
        let value = t.value || null;
        if (t.name === 'priority') value = Number(t.value);
        if (t.name === 'estimate_min') value = t.value ? Number(t.value) : null;
        const fields = { [t.name]: value };
        if (t.name === 'status') Object.assign(fields, value === 'done' ? doneFields(true) : { done_at: null });
        if (t.name === 'project_id') fields.milestone_id = null;
        await change(id, fields, t.name === 'start_date' && value ? `Planned for ${shortDate(value)}` : t.name === 'horizon' ? `Transferred to ${HORIZONS.find(x => x.id === value)?.label || value}` : 'Saved');
      }
    });

    const attParent = b => { const id = b.closest('[data-for]')?.dataset.for; return id ? { collection: 'tasks', id } : null; };
    const attDone = async parent => {
      if (att.writingIn(body)) { atts = await att.byParent(); await att.redrawRows(body, parent?.id); return; }
      await flushNote();
      await render();
    };
    att.enableDrop(el, '.task-details[data-for], li[data-task]', node => ({ collection: 'tasks', id: node.dataset.for || node.dataset.task }), attDone);
    // The pills under a task only show what's set; clicking one opens the
    // task's editing pills (under its title), where each can be changed.
    function editInPlace(id) {
      const input = body.querySelector(`li[data-task="${id}"] .task-title`);
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    el.addEventListener('click', async ev => {
      if (att.onClick(ev, attParent, attDone)) return;
      const shown = ev.target.closest('li[data-task] > .item-sub .chip');
      if (shown && !shown.matches('a, .kids')) { editInPlace(shown.closest('li[data-task]').dataset.task); return; }
      const b = ev.target.closest('[data-act], [data-view], [data-energy], [data-horizon], [data-open-project]');
      if (!b) return;
      if (b.dataset.view) { b.closest('details')?.removeAttribute('open'); state.project = null; go(b.dataset.view, null); return; }
      if (b.dataset.act === 'focus-entry') { focusEntry(); return; }
      if (b.dataset.act === 'entry-reveal') { b.closest('.task-entry').classList.add('revealed'); body.querySelector('#task-new')?.focus(); return; }
      if (b.dataset.act === 'note-shown') { const row = b.closest('li[data-task]'); walkGo({ li: row, key: row.dataset.task, title: row.querySelector(':scope > .task-title') }, 'note', 0); return; }
      if (b.dataset.act === 'pills-reveal') {
        const row = b.closest('li[data-task]');
        if (lay('more-panel')) { this.pills.close(); row?.querySelector(':scope > [data-act="details"]')?.click(); return; }
        revealed = b.closest('.edit-pills').dataset.key;
        b.closest('.edit-pills').remove(); // drawn again with everything in it
        row?.querySelector(':scope > .task-title')?.focus();
        return;
      }
      if (b.dataset.act === 'aim-time') { aimTimeFor = b.closest('[data-for]')?.dataset.for; render(); return; }
      if (b.dataset.openProject) { go('list', b.dataset.openProject); return; }
      const li = b.closest('[data-task], [data-for]');
      const id = li?.dataset.task || li?.dataset.for;
      const task = data.tasks.find(x => x.id === id);
      const act = b.dataset.act;
      b.closest('details')?.removeAttribute('open');
      if (act === 'remove-contact' && id) {
        await change(id, { contact_ids: (task.contact_ids || []).filter(x => x !== b.dataset.id) }, 'Removed a person');
        return;
      }
      if (b.dataset.horizon && id) {
        await change(id, { horizon: b.dataset.horizon }, `Transferred to ${HORIZONS.find(x => x.id === b.dataset.horizon)?.label || b.dataset.horizon}`);
        return;
      }
      if ((act === 'horizon-pill' || act === 'energy-pill') && id) return editInPlace(id);
      if (act === 'tour') { const tours = await import('../tour.js'); return tours.startTour({ which: tours.tourOf(task) }); }
      if (b.dataset.energy && id) {
        await change(id, { energy: task.energy === b.dataset.energy ? null : b.dataset.energy }, 'Energy saved');
      } else if (act === 'close-details') {
        await closeDetails();
      } else if (act === 'toggle-note' && open !== id && task) {
        editNoteInPlace(task, b);
      } else if (act === 'details' || act === 'toggle-note') {
        await flushNote();
        open = open === id ? null : id;
        render();
      } else if (act === 'collapse') {
        // The sub-tasks slide closed, or slide open once drawn.
        if (collapsed.has(id)) { collapsed.delete(id); await render(); slideRows(kidRows(id), true); }
        else { await slideRows(kidRows(id), false); collapsed.add(id); render(); }
      } else if (act === 'add') {
        body.querySelector('#task-entry')?.submitEntry?.(); // the Add button (no lined paper): as Enter
        body.querySelector('#task-new')?.focus();
      } else if (act === 'toggle-done') {
        state.showDone = !state.showDone;
        render();
      } else if (act === 'all-tasks') {
        go('list', null);
      } else if (act === 'new-project') {
        const p = await newProject();
        if (p) go('list', p.id);
      } else if (act === 'new-milestone') {
        const r = await ask({ title: 'New milestone', ok: 'Add', fields: [{ name: 'name', label: 'Name', placeholder: word('ph_milestone') }, { name: 'due', label: 'Aim date (optional)', type: 'date' }] });
        const name = r?.name;
        if (!name?.trim()) return;
        const due = r.due || null;
        await store.create('milestones', { project_id: state.project, name: name.trim(), due_date: /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? due : null, done_at: null, sort_order: data.milestones.length });
        render();
      } else if (act === 'add-sub' && task) {
        const sub = await addTask({ title: 'New sub-task', parent_task_id: task.id, project_id: task.project_id, milestone_id: task.milestone_id, rank: afterFamily(task) });
        open = null;
        collapsed.delete(task.id);
        await render();
        const input = body.querySelector(`li[data-task="${sub.id}"] .task-title`);
        input?.focus();
        input?.select();
        undoable('Added a sub-task', async () => { await store.remove('tasks', sub.id); await render(); });
      } else if ((act === 'plan-today' || act === 'plan-clear') && task) {
        await setPlanDay(task, act === 'plan-today' ? isoDate() : null);
      } else if ((act === 'delete' || act === 'archive') && task) {
        await retire(task, act);
      }
    });

    // The rows under a task (its sub-tasks, and any open panel among them), as drawn.
    function kidRows(id) {
      const li = body.querySelector(`.task-list > li[data-task="${id}"]`);
      if (!li) return [];
      const d = Number(li.dataset.depth || 0), out = [];
      for (let r = li.nextElementSibling; r && !(r.matches('li[data-task]') && Number(r.dataset.depth || 0) <= d) && !r.matches('.list-head'); r = r.nextElementSibling) out.push(r);
      return out;
    }
    // Rows sliding open (from nothing to their height) or closed.
    const slideRows = (rows, opening) => Promise.all(rows.map(r => {
      const cs = getComputedStyle(r);
      const full = { height: `${r.offsetHeight}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1 };
      const none = { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 };
      r.style.overflow = 'hidden'; r.style.minHeight = '0';
      const anim = r.animate(opening ? [none, full] : [full, none], { duration: 220, easing: 'ease-in-out', fill: opening ? 'none' : 'forwards' });
      return anim.finished.then(() => { if (opening) { r.style.overflow = ''; r.style.minHeight = ''; } }, () => {});
    }));

    // Delete or archive a task, with its sub-tasks.
    async function retire(task, act) {
      const field = act === 'delete' ? 'deleted_at' : 'archived_at';
      const ids = [task.id];
      const collect = pid => data.tasks.filter(k => k.parent_task_id === pid).forEach(k => { ids.push(k.id); collect(k.id); });
      collect(task.id);
      const now = new Date().toISOString();
      await store.updateMany('tasks', ids.map(x => [x, { [field]: now }]));
      open = null;
      await render();
      undoable(`${act === 'delete' ? 'Deleted' : 'Archived'} "${task.title}"${ids.length > 1 ? ` and ${ids.length - 1} sub-task${ids.length > 2 ? 's' : ''}` : ''}`, async () => {
        await store.updateMany('tasks', ids.map(x => [x, { [field]: null }]));
        await render();
      });
    }

    // Click on the empty part of the page (like Reminders): a new task line opens.
    // Not on a phone: the keyboard only comes up for a tap in the New task line itself.
    body.addEventListener('click', ev => {
      if (ev.target === body || ev.target.matches('.task-entry, .task-list, .list-head')) { if (!touch) focusEntry(); }
      // Compact spacing: the space right of a short name still edits it.
      else if (ev.target.matches('.task-list > li[data-task]')) ev.target.querySelector(':scope > .task-title')?.focus();
    });

    this.closeDetails = () => { open = null; };
    // Arriving on Tasks (nav, Ctrl+← / →): with the 👁 Layout switch on, the cursor goes in New task.
    this.arrived = () => { if (lay('new-focus') && !touch) focusEntry(); }; // phones: the keyboard only for a tap in the line

    // Tap a task's title to edit it: pills for energy, time, dates and list
    // open under it, plus More for the whole panel (js/editpills.js).
    const hours = durationChoices(480).map(m => [m, durationLabel(m)]);
    // Hide pills behind More (👁 Layout): a task being edited shows only a More pill, at the right
    // of its name (the row doesn't grow); More shows "Add note" and the pills (and More…, for the
    // whole panel), or with "More goes straight to the full panel" opens the panel. The New task
    // line the same (it has no panel: More shows its note and pills). revealed: the task shown,
    // until its pills are put away (leaving the task): back in, it's behind More again.
    let revealed = null;
    this.pills = editPills(body, {
      title: '.task-title',
      row: 'li[data-task]',
      key: r => r.dataset.task,
      closed: id => { if (revealed === id) revealed = null; },
      done: true,
      html: id => {
        const t = data.tasks.find(x => x.id === id);
        if (!t) return '';
        const aim = t.aim_at ? t.aim_at.slice(0, 10) : '';
        // No note yet: an "Add note" line under the title, like adding a new task.
        // With More pressed, a note already there shows in full (Enter in the name goes into it).
        const addNote = !(t.notes || '').trim() ? `<textarea class="entry-note add-note pill-note no-inline" data-pill="notes" rows="1" placeholder="Add note" aria-label="Note"></textarea>`
          : lay('pills-hide') ? `<div class="entry-note note-shown" data-act="note-shown" title="Edit the note (Enter)">${toHtml(t.notes)}</div>` : '';
        if (lay('pills-hide') && (revealed !== id || lay('more-panel'))) return `<button type="button" class="entry-chip pill-reveal" data-act="pills-reveal">More${keys('Shift+Enter')}</button>`;
        return addNote + energyPill(t.energy)
          + selectPill('estimate_min', 'Estimated time', '⏱', [['', 'Not estimated'], ...hours], t.estimate_min)
          + datePill('start_date', 'Plan for day', '📅', t.start_date, shortDate)
          + datePill('aim_date', 'Target end date', '⚑', aim, shortDate)
          + selectPill('horizon', 'List', '📥', HORIZONS.map(h => [h.id, h.label]), horizonOf(t));
      },
      change: async (id, name, value) => {
        const t = data.tasks.find(x => x.id === id);
        if (!t) return;
        if (name === 'aim_date') {
          const time = t.aim_at?.length > 10 ? t.aim_at.slice(10) : '';
          return change(id, { aim_at: value ? `${value}${time}` : null }, value ? `Target end date: ${shortDate(value)}` : 'Target end date cleared');
        }
        if (name === 'notes') { if (value.trim()) await change(id, { notes: value.trim() }, 'Note saved'); return; }
        if (name === 'energy') {
          energyMenu(body.querySelector('.edit-pills [data-pill-act="energy"]'), t.energy, v => change(id, { energy: v }, v ? 'Energy saved' : 'Energy cleared'));
          return;
        }
        if (name === 'start_date') return setPlanDay(t, value || null);
        const v = name === 'estimate_min' ? (value ? Number(value) : null) : value || null;
        await change(id, { [name]: v }, name === 'start_date' && v ? `Planned for ${shortDate(v)}` : name === 'horizon' ? `Transferred to ${HORIZONS.find(x => x.id === v)?.label || v}` : 'Saved');
      },
    });

    // The panel closes with Close, ⋯ again or Esc (not by clicking elsewhere, so
    // it stays put while you look around). Whatever you were typing is saved first.
    async function closeDetails() {
      if (!open) return;
      const panel = body.querySelector(`.task-details[data-for="${open}"]`);
      if (panel?.contains(document.activeElement)) document.activeElement.blur();
      await flushNote();
      open = null;
      setTimeout(render);
    }
    // Buttons in the panel don't take focus from the notes while pressed.
    body.addEventListener('mousedown', ev => {
      if (ev.target.closest('.task-details .detail-actions button')) ev.preventDefault();
    });

    this.onKey = ev => {
      if (ev.key === 'Escape' && !ev.target.closest('input, textarea, select, [contenteditable]') && (kitOrdered.escape() || kitFlat.escape() || kitPlain.escape())) return;
      if (ev.key === 'Escape' && open && !ev.defaultPrevented && !document.querySelector('.ref-picker, .pill-menu')) { ev.preventDefault(); closeDetails(); }
    };
    addEventListener('keydown', this.onKey);

    // Opens on the Inbox if anything is waiting there, otherwise Now.
    const first = await loadAll();
    state.view = first.tasks.some(t => !isDone(t) && !t.parent_task_id && t.horizon === 'inbox') ? 'inbox' : 'now';
    await render();
  },

  async route([view, project]) {
    // Old links to Today / Upcoming land on Now.
    const v = { today: 'now', upcoming: 'now' }[view] || view;
    this.state.view = ['inbox', 'now', 'next', 'later', 'list', 'projects', 'done'].includes(v) ? v : 'now';
    this.state.project = view === 'list' ? project || null : null;
    this.closeDetails?.();
    await this.render();
  },

  unmount() {
    this.kitOrdered?.destroy();
    this.kitPlain?.destroy();
    this.kitFlat?.destroy();
    this.gone?.abort();
    removeEventListener('keydown', this.onKey);
    this.pills?.destroy();
  },

  quickAdd() {
    document.querySelector('#task-entry')?.classList.add('open');
    document.querySelector('#task-new')?.focus();
  },
};

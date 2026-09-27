// Tasks: a simple checklist that grows into a project planner.
// #/tasks/<view>/<project id>   views: list, now, next, later, projects, done
// Every extra (day, aim, energy, project, milestone, notes) lives behind a
// task's ⋯ so the list stays simple until you want more.

import { cogHtml } from '../viewcog.js';
import * as store from '../store.js';
import { loadAll, nest, progress, addTask, doneFields, aimDate, isDone, STATUSES, PRIORITIES, HORIZONS, horizonOf } from '../tasks.js';
import { ENERGY, isoDate, addDays, parseDate, addItem } from '../days.js';
import { pillMenu } from '../pillmenu.js';
import { summarise } from '../summary.js';
import { createListKit } from '../listkit.js';
import { listEntry, listHint, SHORTCUT } from '../listentry.js';
import { toast, undoable } from '../toast.js';
import { richText, toHtml, previewLine, inlineAll } from '../richtext.js';
import { loadContacts } from '../contacts.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const VIEWS = [
  { id: 'list', label: 'List' },
  { id: 'now', label: 'Now' },
  { id: 'next', label: 'Next' },
  { id: 'later', label: 'Later' },
  { id: 'projects', label: 'Projects' },
  { id: 'done', label: 'Done' },
];
const COLOURS = ['#6fb0ff', '#7dd3a8', '#f5a66a', '#e58fd0', '#f0d264', '#a99cff', '#ff8a8a'];

function shortDate(iso) {
  if (!iso) return '';
  const today = isoDate();
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  if (iso === addDays(today, -1)) return 'Yesterday';
  const d = parseDate(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export default {
  async mount(el) {
    const state = this.state = { view: 'list', project: null, showDone: false };
    let data = { tasks: [], projects: [], milestones: [] };
    let people = { contacts: [], cases: [] };
    let open = null; // task id with details open
    // Notes typed in the panel save shortly after typing stops, or at once
    // when the panel closes.
    let pendingNote = null;
    let noteTimer;
    async function flushNote() {
      clearTimeout(noteTimer);
      const p = pendingNote;
      pendingNote = null;
      if (p) await store.update('tasks', p.id, { notes: p.md });
    }
    const collapsed = new Set();
    let notesEditor = null;

    el.innerHTML = `
      <div class="tasks-head">
        <div class="segmented" id="task-views" role="tablist" aria-label="Views">
          ${VIEWS.map(v => `<button type="button" data-view="${v.id}">${v.label}</button>`).join('')}
        </div>
        ${cogHtml('tasks')}
        <details class="tool-menu">
          <summary class="icon-btn" aria-label="More actions">${icon('i-more')}</summary>
          <div class="menu">
            <button type="button" data-act="new-project">New project</button>
            <button type="button" data-act="toggle-done">Show / hide done</button>
            <hr>
            <a href="#/bin/archive/tasks">Archive</a>
            <a href="#/bin/bin/tasks">Bin</a>
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

    function chips(t) {
      const out = [];
      const p = projectOf(t);
      if (p && !state.project) out.push(`<span class="chip" style="--c:${p.colour || COLOURS[0]}">${esc(p.name)}</span>`);
      if (t.start_date) out.push(`<span class="chip" title="Planned for">📅 ${shortDate(t.start_date)}</span>`);
      const aim = aimDate(t);
      if (aim) out.push(`<span class="chip${!isDone(t) && aim < isoDate() ? ' late' : ''}" title="Completion aim">⚑ ${shortDate(aim)}${t.aim_at.length > 10 ? ` ${t.aim_at.slice(11, 16)}` : ''}</span>`);
      if (t.priority && t.priority < 3) out.push(`<span class="chip pri-${t.priority}">${PRIORITIES.find(p => p.id === t.priority)?.label}</span>`);
      if (t.status === 'doing' || t.status === 'waiting') out.push(`<span class="chip">${STATUSES.find(s => s.id === t.status)?.label}</span>`);
      const kids = kidsOf(t);
      if (kids.length) {
        const pr = progress(kids);
        out.push(`<button type="button" class="chip kids" data-act="collapse" aria-expanded="${!collapsed.has(t.id)}">${collapsed.has(t.id) ? '▸' : '▾'} ${pr.done}/${pr.total}</button>`);
      }
      for (const cid of t.contact_ids || []) {
        const c = people.contacts.find(x => x.id === cid);
        if (c) out.push(`<a class="chip" href="#/contacts/c/${c.id}" title="Contact">👤 ${esc(c.name || '?')}</a>`);
      }
      const kase = t.case_id && people.cases.find(k => k.id === t.case_id);
      if (kase) out.push(`<a class="chip" href="#/contacts/cases/${kase.id}" title="Case">📁 ${esc(kase.title)}</a>`);
      return out.join('');
    }

    function row(t, { draggable = true, group = '' } = {}) {
      return `
        <li data-task="${t.id}" data-id="${t.id}" data-depth="${t.depth ?? 0}" class="${isDone(t) ? 'done' : ''} ${group}">
          <button type="button" class="drag-handle" aria-label="Select${draggable ? ' or move' : ''} ${esc(t.title)}">${icon('i-grip')}</button>
          <input type="checkbox" class="tick" ${isDone(t) ? 'checked' : ''} aria-label="Done">
          <input class="task-title" value="${esc(t.title)}" aria-label="Task" autocomplete="off">
          <span class="chips">${chips(t)}</span>
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
      const pills = (e ? `<button type="button" class="pill-act bolts" data-act="energy-pill" title="Energy: ${e.label}. Click to change" aria-label="Energy ${e.label}, change">${e.bolts}</button>` : '')
        + (h !== 'now' && state.view !== h && !isDone(t) ? `<button type="button" class="pill-act" data-act="horizon-pill" title="For ${h}. Click to change">${h}</button>` : '');
      const note = t.notes ? noteHtml(t) : '';
      return pills || note ? `<div class="item-sub">${pills}${note}</div>` : '';
    }

    // Notes under tasks: the first line; clicking it opens (or closes) the
    // task's panel, where the whole note can be read and edited.
    function noteHtml(t) {
      const { html } = previewLine(t.notes);
      if (!html) return '';
      // All three spacings are drawn; the page's spacing shows one (CSS):
      // tight = just 📝, medium = every line run together, loose = the note as written.
      return `<span class="item-note task-note" data-act="toggle-note" role="button" tabindex="0" aria-expanded="${open === t.id}" title="${open === t.id ? 'Close' : 'Open to read or edit'}">`
        + `<span class="note-emoji" aria-hidden="true">📝</span>`
        + `<span class="note-medium">${inlineAll(t.notes)}</span>`
        + `<span class="note-loose">${toHtml(t.notes)}</span></span>`;
    }

    function details(t) {
      const ms = data.milestones.filter(m => m.project_id === t.project_id);
      const aim = aimDate(t) || '';
      const aimTime = t.aim_at && t.aim_at.length > 10 ? t.aim_at.slice(11, 16) : '';
      return `
        <div class="detail-grid">
          <label>Plan for day<input type="date" name="start_date" value="${t.start_date || ''}"></label>
          <label>Completion aim<input type="date" name="aim_date" value="${aim}"></label>
          <label>Aim time<input type="time" name="aim_time" value="${aimTime}" ${aim ? '' : 'disabled'}></label>
          <label>Priority<select name="priority">${PRIORITIES.map(p => `<option value="${p.id}" ${Number(t.priority) === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
          <label>Status<select name="status">${STATUSES.map(s => `<option value="${s.id}" ${t.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
          <label>Project<select name="project_id"><option value="">None</option>${data.projects.map(p => `<option value="${p.id}" ${t.project_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="__new">+ New project…</option></select></label>
          ${t.project_id ? `<label>Milestone<select name="milestone_id"><option value="">None</option>${ms.map(m => `<option value="${m.id}" ${t.milestone_id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}<option value="__new">+ New milestone…</option></select></label>` : ''}
          <label>People<select name="add_contact"><option value="">+ Add a contact…</option>${people.contacts.filter(c => !(t.contact_ids || []).includes(c.id)).map(c => `<option value="${c.id}">${esc(c.name || '(no name)')}</option>`).join('')}</select></label>
          <label>Case<select name="case_id"><option value="">None</option>${people.cases.map(k => `<option value="${k.id}" ${t.case_id === k.id ? 'selected' : ''}>${esc(k.title)}</option>`).join('')}</select></label>
          ${(t.contact_ids || []).length ? `<div class="energy-pick"><span>With</span>${t.contact_ids.map(cid => people.contacts.find(c => c.id === cid)).filter(Boolean).map(c => `<span class="chip">${esc(c.name)} <button type="button" class="chip-x" data-act="remove-contact" data-id="${c.id}" aria-label="Remove">×</button></span>`).join('')}</div>` : ''}
          <div class="energy-pick" role="group" aria-label="When"><span>When</span>
            ${HORIZONS.map(x => `<button type="button" data-horizon="${x.id}" aria-pressed="${horizonOf(t) === x.id}">${x.label}</button>`).join('')}
          </div>
          <div class="energy-pick" role="group" aria-label="Energy"><span>Energy</span>
            ${ENERGY.map(e => `<button type="button" class="bolts" data-energy="${e.id}" aria-pressed="${t.energy === e.id}" title="${esc(`${e.label}: ${e.hint}`)}" aria-label="${e.label}">${e.bolts}</button>`).join('')}
          </div>
        </div>
        <div class="task-notes"></div>
        <div class="detail-actions">
          <button type="button" class="close-details" data-act="close-details" title="Close (or click anywhere outside, or Esc)">Close</button>
          <button type="button" data-act="plan-today">Put on today's plan</button>
          <button type="button" data-act="add-sub">+ Sub-task</button>
          <span class="spacer"></span>
          <button type="button" data-act="archive">Archive</button>
          <button type="button" class="danger" data-act="delete">Delete</button>
        </div>`;
    }

    function addBox(placeholder) {
      return `
        <div class="task-add">
          <textarea id="task-new" class="list-entry" rows="1" placeholder="${esc(placeholder)}"></textarea>
          <button type="button" data-act="add">Add <kbd>${SHORTCUT}</kbd></button>
        </div>
        <p class="muted hint">${listHint()} Tap ⋯ on a task for a day, an aim, energy, a project and more.</p>`;
    }

    // Views render one <ul> with heading rows between groups, so selection
    // (and, in List, dragging) works across the whole view.
    const head = (html, attrs = '') => `<li class="list-head"${attrs}>${html}</li>`;
    // A task and its sub-tasks share one card: the parent opens it, sub-tasks
    // sit inside, the last one closes it.
    const rowsOf = (tasks, opts) => tasks.map((t, n) => {
      const d = t.depth ?? 0;
      const next = tasks[n + 1];
      const nd = next ? next.depth ?? 0 : 0;
      const group = d === 0 ? (nd > 0 ? 'group-top' : '') : `group-kid${nd === 0 ? ' group-end' : ''}`;
      return row(t, { ...opts, group });
    }).join('');
    const listOf = (inner, empty = '') => (inner ? `<ul class="task-list">${inner}</ul>` : empty);

    // Tasks in list order, hiding done ones (unless shown) and collapsed sub-trees.
    function visible(tasks) {
      const nested = nest(tasks);
      const out = [];
      let hideBelow = null;
      for (const t of nested) {
        if (hideBelow != null && t.depth > hideBelow) continue;
        hideBelow = null;
        if (!state.showDone && isDone(t) && !(t.done_at > new Date(Date.now() - 60000).toISOString())) continue;
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
      html += addBox(project ? `Add to ${project.name}…` : 'Add a task…');
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
        html += listOf(rowsOf(tasks), '<div class="empty"><h2>Nothing to do. Add something above.</h2></div>');
      }
      const doneCount = scoped.filter(isDone).length;
      if (doneCount) html += `<p class="muted done-toggle"><button type="button" data-act="toggle-done">${state.showDone ? 'Hide' : 'Show'} ${doneCount} done</button></p>`;
      return html;
    }

    // Now / Next / Later: the open tasks for that horizon (no horizon = Now),
    // with anything overdue or planned for today first in Now.
    function viewHorizon(h) {
      const today = isoDate();
      const open = data.tasks.filter(t => !isDone(t) && horizonOf(t) === h && (!state.project || t.project_id === state.project));
      const flat = list => rowsOf(list.map(t => ({ ...t, depth: 0 })), { draggable: false });
      const urgent = h === 'now' ? open.filter(t => (aimDate(t) && aimDate(t) <= today) || (t.start_date && t.start_date <= today)) : [];
      const rest = open.filter(t => !urgent.includes(t));
      const body = (urgent.length ? head('Due or planned') + flat(urgent) + (rest.length ? head('Everything else') : '') : '') + flat(rest);
      const empty = { now: 'Nothing for now. Add something above.', next: 'Nothing lined up next.', later: 'Nothing for later.' }[h];
      return addBox({ now: 'Add tasks for now…', next: 'Add tasks for next…', later: 'Add tasks for later…' }[h])
        + listOf(open.length ? body : '', `<div class="empty"><h2>${empty}</h2></div>`);
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
        <p class="muted hint">A project is just a group of tasks. Give it milestones to see progress in stages.</p>`;
    }

    function viewDone() {
      const done = data.tasks.filter(isDone).sort((a, b) => b.done_at.localeCompare(a.done_at));
      if (!done.length) return '<div class="empty"><h2>Nothing ticked off yet.</h2></div>';
      const byDay = new Map();
      for (const t of done) {
        const d = isoDate(new Date(t.done_at));
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push({ ...t, depth: 0 });
      }
      return listOf([...byDay].map(([d, list]) => head(`${shortDate(d)} <span class="muted">${list.length}</span>`) + rowsOf(list, { draggable: false })).join(''));
    }

    // ---------- render ----------

    const render = this.render = async () => {
      data = await loadAll();
      people = await loadContacts();
      for (const b of el.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', b.dataset.view === state.view);
      body.innerHTML = { list: viewList, now: () => viewHorizon('now'), next: () => viewHorizon('next'), later: () => viewHorizon('later'), projects: viewProjects, done: viewDone }[state.view]();
      const ta = body.querySelector('#task-new');
      if (ta) listEntry(ta, addLines, { draft: `tasks:${state.view}:${state.project || ''}` });
      const ul = body.querySelector('.task-list');
      const ordered = state.view === 'list';
      kitOrdered.attach(ordered ? ul : null);
      kitPlain.attach(ordered ? null : ul);
      const notesBox = body.querySelector('.task-notes');
      if (notesBox && open) {
        const id = open;
        const t = data.tasks.find(x => x.id === id);
        notesEditor = richText(notesBox, {
          value: t?.notes || '',
          placeholder: 'Notes…',
          origin: () => ({ collection: 'tasks', id, title: t?.title, field: 'notes' }),
          onChange: md => {
            clearTimeout(noteTimer);
            pendingNote = { id, md };
            noteTimer = setTimeout(flushNote, 600);
          },
        });
      }
    };

    // ---------- adding ----------

    async function addLines(lines) {
      const made = [];
      let parent = null;
      const base = { project_id: state.project || null };
      if (['next', 'later'].includes(state.view)) base.horizon = state.view;
      let shortened = 0;
      for (const line of lines) {
        // A long line gets a short title; the note keeps it all.
        const { title, notes } = summarise(line.text);
        if (notes) shortened++;
        const t = await addTask({ ...base, title, notes, parent_task_id: line.sub && parent ? parent : null });
        made.push(t.id);
        if (!line.sub) parent = t.id;
      }
      await render();
      body.querySelector('#task-new')?.focus();
      undoable(`Added ${made.length} task${made.length === 1 ? '' : 's'}${shortened ? ` (${shortened} long one${shortened === 1 ? '' : 's'} shortened, full text in the note)` : ''}`, async () => {
        await store.updateMany('tasks', made.map(id => [id, { deleted_at: new Date().toISOString() }]));
        await render();
      });
    }

    // ---------- reorder, nest, select (shared list behaviour) ----------

    // Persist what the kit reports: order, parents from depth, and in a
    // project the milestone of the heading a top-level task sits under.
    async function persistOrder(rows, label, ul) {
      const before = rows.map(r => {
        const t = data.tasks.find(x => x.id === r.id);
        return [t.id, { sort_order: t.sort_order, parent_task_id: t.parent_task_id || null, milestone_id: t.milestone_id || null }];
      });
      const minOrder = Math.min(...before.map(b => b[1].sort_order ?? 0));
      const milestoneOf = new Map();
      let current = null;
      for (const li of ul.children) {
        if (li.matches('.list-head[data-milestone]')) current = li.dataset.milestone || null;
        else if (li.dataset.id) milestoneOf.set(li.dataset.id, current);
      }
      const stack = [];
      const changes = rows.map((r, n) => {
        const depth = Math.min(r.depth, stack.length);
        const parent = depth ? stack[depth - 1] : null;
        stack.length = depth;
        stack.push(r.id);
        const fields = { sort_order: minOrder + n, parent_task_id: parent };
        if (state.project && !parent && ul.querySelector('.list-head[data-milestone]')) fields.milestone_id = milestoneOf.get(r.id) ?? null;
        return [r.id, fields];
      });
      await store.updateMany('tasks', changes);
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
    async function batchSet(ids, fields, label, { subs = false } = {}) {
      const all = subs ? withSubs(ids) : ids;
      const before = all.map(id => { const t = data.tasks.find(x => x.id === id); return [id, Object.fromEntries(Object.keys(fields).map(k => [k, t?.[k] ?? null]))]; });
      await store.updateMany('tasks', all.map(id => [id, fields]));
      await render();
      undoable(`${label} ${all.length} task${all.length === 1 ? '' : 's'}`, async () => { await store.updateMany('tasks', before); await render(); });
    }
    const taskActions = [
      { id: 'done', label: 'Done', run: ids => batchSet(ids, doneFields(true), 'Done:') },
      { id: 'now', label: 'Now', run: ids => batchSet(ids, { horizon: 'now' }, 'Now:') },
      { id: 'next', label: 'Next', run: ids => batchSet(ids, { horizon: 'next' }, 'Next:') },
      { id: 'later', label: 'Later', run: ids => batchSet(ids, { horizon: 'later' }, 'Later:') },
      { id: 'archive', label: 'Archive', run: ids => batchSet(ids, { archived_at: new Date().toISOString() }, 'Archived', { subs: true }) },
      { id: 'delete', label: 'Delete', danger: true, run: ids => batchSet(ids, { deleted_at: new Date().toISOString() }, 'Deleted', { subs: true }) },
    ];
    const kitOrdered = this.kitOrdered = createListKit({ reorder: true, indent: true, maxDepth: 4, noun: 'task', actions: taskActions, onReorder: persistOrder });
    const kitPlain = this.kitPlain = createListKit({ reorder: false, noun: 'task', actions: taskActions });

        // ---------- editing ----------

    async function change(id, fields, label = 'Saved') {
      const before = data.tasks.find(t => t.id === id);
      const old = Object.fromEntries(Object.keys(fields).map(k => [k, before?.[k] ?? null]));
      await store.update('tasks', id, fields);
      await render();
      undoable(label, async () => { await store.update('tasks', id, old); await render(); });
    }

    async function newProject() {
      const name = prompt('Project name:');
      if (!name?.trim()) return null;
      return store.create('projects', {
        name: name.trim(), description: '', status: 'active', colour: COLOURS[data.projects.length % COLOURS.length],
        sort_order: data.projects.length, due_date: null,
      });
    }

    body.addEventListener('change', async ev => {
      const t = ev.target;
      const li = t.closest('[data-task], [data-for]');
      const id = li?.dataset.task || li?.dataset.for;
      if (t.dataset.project) {
        const p = data.projects.find(x => x.id === t.dataset.project);
        if (!t.value.trim() || t.value.trim() === p?.name) return;
        const old = p.name;
        await store.update('projects', p.id, { name: t.value.trim() });
        undoable('Saved', async () => { await store.update('projects', p.id, { name: old }); render(); });
        return;
      }
      if (!id) return;
      const task = data.tasks.find(x => x.id === id);
      if (t.classList.contains('tick')) {
        await change(id, doneFields(t.checked), t.checked ? `Done: ${task.title}` : 'Not done');
      } else if (t.classList.contains('task-title')) {
        if (t.value.trim() && t.value.trim() !== task.title) await change(id, { title: t.value.trim() });
      } else if (t.name === 'aim_date' || t.name === 'aim_time') {
        const d = body.querySelector(`[data-for="${id}"] [name="aim_date"]`).value;
        const tm = body.querySelector(`[data-for="${id}"] [name="aim_time"]`).value;
        await change(id, { aim_at: d ? (tm ? `${d}T${tm}` : d) : null }, d ? `Aim: ${shortDate(d)}` : 'Aim cleared');
      } else if (t.name === 'add_contact') {
        if (t.value) await change(id, { contact_ids: [...(task.contact_ids || []), t.value] }, 'Added a person');
      } else if (t.name === 'project_id' && t.value === '__new') {
        const p = await newProject();
        if (p) await change(id, { project_id: p.id, milestone_id: null }, `Moved to ${p.name}`); else render();
      } else if (t.name === 'milestone_id' && t.value === '__new') {
        const name = prompt('Milestone name:');
        if (!name?.trim()) { render(); return; }
        const m = await store.create('milestones', { project_id: task.project_id, name: name.trim(), due_date: null, done_at: null, sort_order: data.milestones.length });
        await change(id, { milestone_id: m.id });
      } else if (t.name) {
        let value = t.value || null;
        if (t.name === 'priority') value = Number(t.value);
        const fields = { [t.name]: value };
        if (t.name === 'status') Object.assign(fields, value === 'done' ? doneFields(true) : { done_at: null });
        if (t.name === 'project_id') fields.milestone_id = null;
        await change(id, fields, t.name === 'start_date' && value ? `Planned for ${shortDate(value)}` : 'Saved');
      }
    });

    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act], [data-view], [data-energy], [data-horizon], [data-open-project]');
      if (!b) return;
      if (b.dataset.view) { state.project = null; go(b.dataset.view, null); return; }
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
        await change(id, { horizon: b.dataset.horizon }, `For ${b.dataset.horizon}`);
        return;
      }
      if (act === 'horizon-pill' && id) {
        pillMenu(b, HORIZONS.map(x => ({ value: x.id, label: x.label, current: horizonOf(task) === x.id })),
          v => change(id, { horizon: v }, `For ${v}`));
        return;
      }
      if (act === 'energy-pill' && id) {
        pillMenu(b, ENERGY.map(e => ({ value: e.id, label: e.bolts, title: `${e.label}${task.energy === e.id ? ' (click to clear)' : ''}`, current: task.energy === e.id })),
          v => change(id, { energy: task.energy === v ? null : v }, 'Energy saved'));
        return;
      }
      if (b.dataset.energy && id) {
        await change(id, { energy: task.energy === b.dataset.energy ? null : b.dataset.energy }, 'Energy saved');
      } else if (act === 'close-details') {
        await closeDetails();
      } else if (act === 'details' || act === 'toggle-note') {
        await flushNote();
        open = open === id ? null : id;
        render();
      } else if (act === 'collapse') {
        collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
        render();
      } else if (act === 'add') {
        body.querySelector('#task-new')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
      } else if (act === 'toggle-done') {
        state.showDone = !state.showDone;
        render();
      } else if (act === 'all-tasks') {
        go('list', null);
      } else if (act === 'new-project') {
        const p = await newProject();
        if (p) go('list', p.id);
      } else if (act === 'new-milestone') {
        const name = prompt('Milestone name (e.g. "Walls done"):');
        if (!name?.trim()) return;
        const due = prompt('Aim date for this milestone (YYYY-MM-DD), or leave blank:') || null;
        await store.create('milestones', { project_id: state.project, name: name.trim(), due_date: /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? due : null, done_at: null, sort_order: data.milestones.length });
        render();
      } else if (act === 'add-sub' && task) {
        const sub = await addTask({ title: 'New sub-task', parent_task_id: task.id, project_id: task.project_id, milestone_id: task.milestone_id, sort_order: task.sort_order + 0.5 });
        open = null;
        collapsed.delete(task.id);
        await render();
        const input = body.querySelector(`li[data-task="${sub.id}"] .task-title`);
        input?.focus();
        input?.select();
        undoable('Added a sub-task', async () => { await store.remove('tasks', sub.id); await render(); });
      } else if (act === 'plan-today' && task) {
        const made = await addItem(isoDate(), { title: task.title, task_id: task.id });
        if (!task.start_date) await store.update('tasks', task.id, { start_date: isoDate() });
        await render();
        undoable(`On today's plan: ${task.title}`, async () => {
          await store.remove('day_items', made.id);
          if (!task.start_date) await store.update('tasks', task.id, { start_date: null });
          await render();
        });
      } else if ((act === 'delete' || act === 'archive') && task) {
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
    });

    this.closeDetails = () => { open = null; };

    // The panel closes when you click anywhere outside it (or its task), press
    // Esc, or use Close. Whatever you were typing in it is saved first.
    async function closeDetails() {
      if (!open) return;
      const panel = body.querySelector(`.task-details[data-for="${open}"]`);
      if (panel?.contains(document.activeElement)) document.activeElement.blur();
      await flushNote();
      open = null;
      setTimeout(render);
    }
    this.onPointer = ev => {
      if (!open || !el.isConnected) return;
      if (ev.target.closest(`.task-details[data-for="${open}"], [data-task="${open}"], dialog, .toast, .ref-picker, .pill-menu`)) return;
      closeDetails();
    };
    document.addEventListener('pointerdown', this.onPointer, true);
    // Buttons in the panel don't take focus from the notes while pressed.
    body.addEventListener('mousedown', ev => {
      if (ev.target.closest('.task-details .detail-actions button')) ev.preventDefault();
    });

    this.onKey = ev => {
      if (ev.key === 'Escape' && !ev.target.closest('input, textarea, select, [contenteditable]') && (kitOrdered.escape() || kitPlain.escape())) return;
      if (ev.key === 'Escape' && open && !ev.defaultPrevented && !document.querySelector('.ref-picker, .pill-menu')) { ev.preventDefault(); closeDetails(); }
    };
    addEventListener('keydown', this.onKey);

    await render();
  },

  route([view, project]) {
    // Old links to Today / Upcoming land on Now.
    const v = { today: 'now', upcoming: 'now' }[view] || view;
    this.state.view = ['list', 'now', 'next', 'later', 'projects', 'done'].includes(v) ? v : 'list';
    this.state.project = view === 'list' ? project || null : null;
    this.closeDetails?.();
    return this.render();
  },

  unmount() {
    this.kitOrdered?.destroy();
    this.kitPlain?.destroy();
    removeEventListener('keydown', this.onKey);
    document.removeEventListener('pointerdown', this.onPointer, true);
  },

  quickAdd() {
    document.querySelector('#task-new')?.focus();
  },
};

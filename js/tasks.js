// Tasks data: tasks (nested via parent_task_id), projects, milestones.
// A task shows in Day Planner on its start_date, and on the day of its
// aim_at (completion aim) while not done.

import * as store from './store.js';
import { byRank, firstKey } from './order.js';
import { word } from './words.js';

export const STATUSES = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'Doing' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'done', label: 'Done' },
];

export const PRIORITIES = [
  { id: 1, label: 'Urgent' },
  { id: 2, label: 'High' },
  { id: 3, label: 'Normal' },
  { id: 4, label: 'Low' },
];

const byOrder = byRank(); // order.js: merges cleanly across devices
export const aimDate = t => (t.aim_at ? t.aim_at.slice(0, 10) : null);
export const isDone = t => !!t.done_at;

export async function loadAll() {
  const live = r => !r.archived_at;
  const [tasks, projects, milestones] = await Promise.all([
    store.list('tasks', { filter: live }),
    store.list('projects', { filter: live }),
    store.list('milestones', { filter: live }),
  ]);
  return { tasks: tasks.sort(byOrder), projects: projects.sort(byOrder), milestones: milestones.sort(byOrder) };
}

// Tasks in display order with `depth`: each task followed by its sub-tasks.
// A sub-task whose parent isn't in the list shows at the top level.
export function nest(tasks) {
  const ids = new Set(tasks.map(t => t.id));
  const kids = new Map();
  for (const t of tasks) {
    const p = t.parent_task_id && ids.has(t.parent_task_id) ? t.parent_task_id : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(t);
  }
  const out = [];
  const walk = (parent, depth) => {
    for (const t of kids.get(parent) || []) {
      out.push({ ...t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function progress(tasks) {
  const total = tasks.length;
  const done = tasks.filter(isDone).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export async function addTask(fields) {
  const count = (await store.list('tasks')).length;
  return store.create('tasks', {
    title: '', notes: '', project_id: null, milestone_id: null, parent_task_id: null,
    status: 'todo', priority: 3, energy: null, start_date: null, aim_at: null, done_at: null,
    calendar_event_id: null, calendar_sync: 'none', recurrence_rule: null,
    horizon: 'inbox', estimate_min: null,
    source_thought_id: null, source_scan_id: null, source_contract_id: null,
    contact_ids: [], case_id: null, sort_order: count,
    ...fields,
  });
}

// A new task at the top of the list (where you'll see it), e.g. one made from a
// Brain Dump note.
export async function addTaskFirst(fields) {
  return addTask({ ...fields, rank: firstKey(await store.list('tasks')) });
}

// Tick / untick: done_at is set when ticked and cleared when unticked.
export function doneFields(done) {
  return done ? { done_at: new Date().toISOString(), status: 'done' } : { done_at: null, status: 'todo' };
}

// Plan for day puts the task on that day in the Day Planner, and a task is on
// one day only: its open copy moves with the date (from whichever day it's
// on), any other open copies go, and removing the date takes it off. Ticked
// copies stay where they are, as a record. Returns an undo.
//   planDay(task, date, { keepDate })   date = 'YYYY-MM-DD' or null;
//     keepDate: leave the task's Plan for day alone (e.g. dragged to "To place")
export async function planDay(task, date, { keepDate = false } = {}) {
  const { addItem } = await import('./days.js');
  const before = task.start_date || null;
  const open = (await store.list('day_items', { filter: i => i.task_id === task.id && !i.archived_at && !i.done_at }))
    .sort((x, y) => Number(y.date === before) - Number(x.date === before)); // the one on its planned day first
  if (!keepDate) await store.update('tasks', task.id, { start_date: date });
  let made = null;
  const moved = [];
  const removed = [];
  const onNew = date && open.find(i => i.date === date);
  const others = open.filter(i => i !== onNew);
  if (date && !onNew && others.length) {
    const m = others.shift();
    moved.push({ ...m });
    await store.update('day_items', m.id, { date, time: null, end_time: null });
    made = null;
  } else if (date && !onNew) {
    made = await addItem(date, { title: task.title, task_id: task.id, estimate_min: task.estimate_min ?? null, energy: task.energy ?? null, notes: task.notes || '', contact_ids: task.contact_ids || [], case_id: task.case_id || null });
  }
  for (const o of others) { removed.push(o); await store.remove('day_items', o.id); }
  return async () => {
    if (!keepDate) await store.update('tasks', task.id, { start_date: before });
    if (made) await store.remove('day_items', made.id);
    for (const m of moved) await store.update('day_items', m.id, { date: m.date, time: m.time ?? null, end_time: m.end_time ?? null });
    for (const r of removed) await store.restore('day_items', r.id);
  };
}

// Sub-tasks go three levels deep at most: a task, its sub-tasks, and theirs.
export const MAX_DEPTH = 2; // depth of the deepest sub-task (a task is 0)
// How deep a task is (0 for a task of its own), and how many levels sit under it.
export function depthIn(t, all) { let d = 0; for (let p = t?.parent_task_id; p && d < 20; d++) p = all.find(x => x.id === p)?.parent_task_id; return d; }
export function levelsUnder(t, all) { const kids = all.filter(x => x.parent_task_id === t.id); return kids.length ? 1 + Math.max(...kids.map(k => levelsUnder(k, all))) : 0; }

// What Day Planner shows for a date.
export function forDay(tasks, date) {
  const planned = tasks.filter(t => t.start_date === date && (!aimDate(t) || aimDate(t) <= date));
  const aimed = tasks.filter(t => !isDone(t) && aimDate(t) === date && t.start_date !== date);
  const ongoing = tasks.filter(t => !isDone(t) && t.start_date && aimDate(t) && t.start_date <= date && aimDate(t) > date);
  return { planned, aimed, ongoing };
}

// When a task is for: now (the default), next, or later.
// The names are yours (Settings → Dictionary).
export const HORIZONS = ['inbox', 'now', 'next', 'later'].map(id => ({ id, get label() { return word(`list_${id}`); } }));
export const horizonOf = t => t.horizon || 'now';

// Unplanned, unfinished tasks matching an energy level (for "adopt").
export function suggestions(tasks, energy, limit = 5) {
  if (!energy) return [];
  return tasks.filter(t => !isDone(t) && !t.start_date && t.energy === energy && !t.parent_task_id).slice(0, limit);
}

// ---------- archive & bin ----------

export const binProvider = {
  area: 'tasks',
  label: 'Tasks',
  async entries(kind) {
    const inState = r => !r.purged_at && (kind === 'bin' ? !!r.deleted_at : !r.deleted_at && !!r.archived_at);
    const tasks = await store.list('tasks', { includeDeleted: true });
    const projects = await store.list('projects', { includeDeleted: true });
    const pname = new Map(projects.map(p => [p.id, p.name]));
    const at = r => (kind === 'bin' ? r.deleted_at : r.archived_at);
    const out = [];
    for (const p of projects.filter(inState)) {
      out.push({ collection: 'projects', id: p.id, kind: 'Project', title: p.name, subtitle: '', detail: '', at: at(p), children: [], search: `${p.name} ${p.description || ''}` });
    }
    const gone = tasks.filter(inState);
    const goneIds = new Set(gone.map(t => t.id));
    for (const t of gone) {
      if (t.parent_task_id && goneIds.has(t.parent_task_id)) continue; // comes back with its parent
      const kids = [];
      const collect = id => gone.filter(k => k.parent_task_id === id).forEach(k => { kids.push(k); collect(k.id); });
      collect(t.id);
      out.push({
        collection: 'tasks', id: t.id, kind: 'Task', title: t.title,
        subtitle: pname.get(t.project_id) || '',
        detail: kids.length ? `${kids.length} sub-task${kids.length === 1 ? '' : 's'}` : '',
        at: at(t),
        children: kids.map(k => ({ collection: 'tasks', id: k.id })),
        search: `${t.title} ${t.notes || ''} ${kids.map(k => k.title).join(' ')}`,
      });
    }
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  },
};

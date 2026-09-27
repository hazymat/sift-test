// Tasks data: tasks (nested via parent_task_id), projects, milestones.
// A task shows in Day Planner on its start_date, and on the day of its
// aim_at (completion aim) while not done.

import * as store from './store.js';

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

const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at.localeCompare(b.created_at);
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
    source_thought_id: null, source_scan_id: null, source_contract_id: null,
    contact_ids: [], case_id: null, sort_order: count,
    ...fields,
  });
}

// Tick / untick: done_at is set when ticked and cleared when unticked.
export function doneFields(done) {
  return done ? { done_at: new Date().toISOString(), status: 'done' } : { done_at: null, status: 'todo' };
}

// What Day Planner shows for a date.
export function forDay(tasks, date) {
  const planned = tasks.filter(t => t.start_date === date && (!aimDate(t) || aimDate(t) <= date));
  const aimed = tasks.filter(t => !isDone(t) && aimDate(t) === date && t.start_date !== date);
  const ongoing = tasks.filter(t => !isDone(t) && t.start_date && aimDate(t) && t.start_date <= date && aimDate(t) > date);
  return { planned, aimed, ongoing };
}

// When a task is for: now (the default), next, or later.
export const HORIZONS = [
  { id: 'now', label: 'Now' },
  { id: 'next', label: 'Next' },
  { id: 'later', label: 'Later' },
];
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

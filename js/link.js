// A task and the day items made from it share some fields, and they stay the
// same whichever side you edit (Tasks or the Day Planner):
//
//   title, notes, energy, estimated time, people, case
//
// For each shared field the more recently edited copy wins and the other side
// follows (by each field's own clock, so it is "last edit wins", not "whoever
// saved last"). Ticking (or unticking) either side ticks the other. Day-only things (which
// day, start and end time, order, let go, carried over) and task-only things
// (project, dates, list, priority) are not touched, with one exception: when
// an item moves to another day and no copy is left on the task's Plan for day,
// the task's Plan for day follows it.
//
// Run once at start-up. It works on every change, including ones that arrive
// from another device, and settles by itself: a value that is already the same
// isn't written again.

import * as store from './store.js';

export const SHARED = ['title', 'notes', 'energy', 'estimate_min', 'contact_ids', 'case_id'];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const newer = (a, b, field) => store.compareHlc(a._field_clocks?.[field], b._field_clocks?.[field]) > 0;

// What must change on `to` so it matches `from`, for fields where `from` is newer.
function follow(from, to) {
  const diff = {};
  for (const f of SHARED) {
    if (from[f] === undefined || same(from[f], to[f])) continue;
    if (newer(from, to, f)) diff[f] = from[f] ?? null;
  }
  return diff;
}

async function reconcile(change) {
  if (change.deleted) return;
  if (change.collection === 'tasks') {
    const task = await store.get('tasks', change.id);
    if (!task) return;
    const items = await store.list('day_items', { filter: i => i.task_id === task.id && !i.archived_at });
    for (const item of items) {
      const diff = follow(task, item);
      // Ticked (or unticked) in Tasks: the day item follows.
      if (newer(task, item, 'done_at') && !same(task.done_at, item.done_at)) diff.done_at = task.done_at ?? null;
      if (Object.keys(diff).length) await store.update('day_items', item.id, diff);
    }
  } else if (change.collection === 'day_items') {
    const item = await store.get('day_items', change.id);
    if (!item?.task_id) return;
    const task = await store.get('tasks', item.task_id);
    if (!task || task.archived_at) return;
    const diff = follow(item, task);
    // Ticked (or unticked) on the Day Planner: the task follows.
    if (newer(item, task, 'done_at') && !same(item.done_at, task.done_at)) Object.assign(diff, { done_at: item.done_at ?? null, status: item.done_at ? 'done' : 'todo' });
    // Moved to another day: the task's Plan for day follows, unless another copy is still on that day.
    if (task.start_date && item.date && item.date !== task.start_date && store.compareHlc(item._field_clocks?.date, task._field_clocks?.start_date) > 0) {
      const copies = await store.list('day_items', { filter: i => i.task_id === task.id && !i.archived_at });
      if (!copies.some(i => i.date === task.start_date)) diff.start_date = item.date;
    }
    if (Object.keys(diff).length) await store.update('tasks', task.id, diff);
    // …and on to the task's other day items.
    const fresh = await store.get('tasks', task.id);
    for (const other of await store.list('day_items', { filter: i => i.task_id === task.id && i.id !== item.id && !i.archived_at })) {
      const d = follow(fresh, other);
      if (newer(fresh, other, 'done_at') && !same(fresh.done_at, other.done_at)) d.done_at = fresh.done_at ?? null;
      if (Object.keys(d).length) await store.update('day_items', other.id, d);
    }
  }
}

let installed = false;
export function installMirror() {
  if (installed) return;
  installed = true;
  let chain = Promise.resolve();
  store.subscribe(change => {
    if (change.collection !== 'tasks' && change.collection !== 'day_items') return;
    chain = chain.then(() => reconcile(change)).catch(err => console.warn('Linking task and day item failed:', err));
  });
}

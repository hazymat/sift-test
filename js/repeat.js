// Recurring tasks. A task's `repeat` says how often: { every: 'day' | 'weekday'
// | 'week' | 'month' | 'year', n: 1 } (every n days / weeks / months / years;
// 'weekday' is Monday to Friday). Monthly and yearly ones also keep the day of
// the month they started on (`day`), so the 31st falls on the 28th in February
// and goes back to the 31st after. When a recurring task is ticked, the next
// one is made straight away with the next date, so missed ones never pile up;
// its sub-tasks come along unticked, its comments stay with this one. The new
// one goes on the Day Planner on its date (Settings → Day Planner, on at
// first); with that off, its date is its Target end date instead. Unticking
// takes the next one away again (if it hasn't been touched).
//
//   REPEAT_CHOICES                  the Repeats list in a task's panel
//   repeatLabel(repeat)             "Every week", "Every 3 days"…
//   nextDate(repeat, 'YYYY-MM-DD')  the date after the given one
//   firstDate(repeat)               the first date from today
//   installRepeats()                once at start-up

import * as store from './store.js';
import { addTask, aimDate, planDay } from './tasks.js';
import { isoDate, addDays, daySettings } from './days.js';

export const REPEAT_CHOICES = [
  { id: '', label: "Doesn't repeat" },
  { id: 'day', label: 'Every day', repeat: { every: 'day', n: 1 } },
  { id: 'weekday', label: 'Every weekday (Mon–Fri)', repeat: { every: 'weekday', n: 1 } },
  { id: 'week', label: 'Every week', repeat: { every: 'week', n: 1 } },
  { id: 'week2', label: 'Every 2 weeks', repeat: { every: 'week', n: 2 } },
  { id: 'month', label: 'Every month', repeat: { every: 'month', n: 1 } },
  { id: 'year', label: 'Every year', repeat: { every: 'year', n: 1 } },
  { id: 'custom', label: 'Custom…' },
];
const UNITS = { day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'], year: ['year', 'years'] };

export const choiceOf = r => (r ? REPEAT_CHOICES.find(c => c.repeat && c.repeat.every === r.every && c.repeat.n === (r.n || 1))?.id || 'custom' : '');

export function repeatLabel(r) {
  if (!r) return '';
  if (r.every === 'weekday') return 'Every weekday';
  const n = r.n || 1;
  return n === 1 ? `Every ${UNITS[r.every]?.[0] || r.every}` : `Every ${n} ${UNITS[r.every]?.[1] || r.every}`;
}

const dow = iso => new Date(`${iso}T12:00`).getDay();
// `day`: the day of the month it's meant to fall on (a short month takes its last day).
function addMonths(iso, m, day) {
  const [y, mo, d] = iso.split('-').map(Number);
  const last = new Date(y, mo - 1 + m + 1, 0).getDate();
  return isoDate(new Date(y, mo - 1 + m, Math.min(day || d, last)));
}

export function nextDate(r, from) {
  const n = Math.max(1, Number(r?.n) || 1);
  switch (r?.every) {
    case 'day': return addDays(from, n);
    case 'weekday': { let d = addDays(from, 1); while ([0, 6].includes(dow(d))) d = addDays(d, 1); return d; }
    case 'week': return addDays(from, 7 * n);
    case 'month': return addMonths(from, n, r.day);
    case 'year': return addMonths(from, 12 * n, r.day);
    default: return null;
  }
}

// The first one: today, or for "every weekday" the next Monday at a weekend.
export function firstDate(r) {
  const today = isoDate();
  return r?.every === 'weekday' && [0, 6].includes(dow(today)) ? nextDate(r, today) : today;
}

const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00`) - new Date(`${a}T12:00`)) / 864e5);

// The next one after `task` (just ticked): same details, next date, sub-tasks unticked.
async function makeNext(task) {
  const base = task.start_date || aimDate(task) || isoDate();
  // Monthly and yearly: the day of the month the series started on stays with
  // it (unless this one's date was moved by hand: then the new day does).
  let repeat = task.repeat;
  if (['month', 'year'].includes(repeat.every)) {
    const [y, m, d] = base.split('-').map(Number);
    const fits = repeat.day && Math.min(repeat.day, new Date(y, m, 0).getDate()) === d;
    repeat = { ...repeat, day: fits ? repeat.day : d };
  }
  let date = nextDate(repeat, base);
  if (!date) return null;
  // Ticked late: skip ahead to a date that hasn't passed, so they never pile up.
  for (let guard = 0; date < isoDate() && guard < 400; guard++) date = nextDate(repeat, date);
  const onPlanner = (await daySettings()).recurring_on_planner !== false;
  const shift = daysBetween(base, date);
  const aim = aimDate(task);
  const next = await addTask({
    title: task.title, notes: task.notes || '', project_id: task.project_id || null, milestone_id: task.milestone_id || null,
    horizon: task.horizon || 'now', energy: task.energy ?? null, estimate_min: task.estimate_min ?? null, priority: task.priority ?? 3,
    contact_ids: task.contact_ids || [], case_id: task.case_id || null, colour: task.colour ?? null,
    repeat, repeat_of: task.repeat_of || task.id, ...(task.rank ? { rank: task.rank } : {}), // where this one was
    aim_at: aim ? `${addDays(aim, shift)}${task.aim_at.slice(10)}` : (onPlanner ? null : date),
  });
  if (onPlanner) await planDay(next, date);
  // Its sub-tasks (and theirs), unticked.
  const all = await store.list('tasks', { filter: t => !t.archived_at });
  const copy = async (from, to) => {
    for (const k of all.filter(t => t.parent_task_id === from)) {
      const made = await addTask({ title: k.title, notes: k.notes || '', parent_task_id: to, project_id: k.project_id || null, horizon: k.horizon || 'now', energy: k.energy ?? null, estimate_min: k.estimate_min ?? null, ...(k.rank ? { rank: k.rank } : {}) });
      await copy(k.id, made.id);
    }
  };
  await copy(task.id, next.id);
  return next;
}

// Unticked again: take the next one away, unless it's been ticked or changed since.
async function takeBack(task) {
  const next = task.repeat_next_id && await store.get('tasks', task.repeat_next_id);
  if (next && !next.done_at) {
    const kids = [];
    const walk = async id => { for (const k of await store.list('tasks', { filter: t => t.parent_task_id === id })) { kids.push(k.id); await walk(k.id); } };
    await walk(next.id);
    for (const id of [next.id, ...kids]) {
      for (const i of await store.list('day_items', { filter: x => x.task_id === id && !x.done_at })) await store.remove('day_items', i.id);
      await store.remove('tasks', id);
    }
  }
  await store.update('tasks', task.id, { repeat_next_id: null });
}

let installed = false;
export function installRepeats() {
  if (installed) return;
  installed = true;
  let chain = Promise.resolve();
  store.subscribe(change => {
    // Only changes made here: another device's tick made its own next one, which syncs in.
    if (change.collection !== 'tasks' || !change.id || change.deleted || change.remote) return;
    chain = chain.then(() => withLock(async () => {
      const t = await store.get('tasks', change.id);
      if (!t?.repeat || t.archived_at) return;
      if (t.done_at && !t.repeat_next_id) {
        const next = await makeNext(t);
        if (next) await store.update('tasks', t.id, { repeat_next_id: next.id });
      } else if (!t.done_at && t.repeat_next_id) {
        await takeBack(t);
      }
    })).catch(err => console.warn('Recurring task failed:', err));
  });
}

// Two open tabs both see the tick: only one makes the next one.
const withLock = fn => (navigator.locks ? navigator.locks.request('sift-repeat', fn) : fn());

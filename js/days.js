// Day Planner data: one `days` record per date (focus, energy, notes; id is
// the date so every device edits the same record) and `day_items`.

import * as store from './store.js';

export const DAY_DEFAULTS = {
  day_start: '08:00',
  day_end: '18:00',
  slot_min: 60,
  down_days: [0], // 0 = Sunday … 6 = Saturday
  hint_down_day: true,
  hint_walk_breaks: true,
  paper_style: 'glass',
  duration_max_min: 240, // longest choice in the Duration list
  show_now_marker: true, // ▶ in the margin at the current time (today only)
  show_evening: true, // a section after the day's last line
  evening_label: 'Evening plans',
};

// Page styles for the planner (default in Settings, overridable per day).
export const PAPERS = [
  { id: 'notebook', label: 'Notebook' },
  { id: 'techie', label: 'Techie' },
  { id: 'dots', label: 'Dot journal' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'glass', label: 'Glass' },
];

// Duration choices: 5, 10, 15, 30, 45, 60 min, then every 15 min up to the max.
export function durationChoices(max = 240) {
  const out = [5, 10, 15, 30, 45, 60];
  for (let m = 75; m <= max; m += 15) out.push(m);
  return out.filter(m => m <= Math.max(60, max));
}

// 45 → "45 min", 60 → "60 min", 75 → "1h 15", 120 → "2h"
export function durationLabel(m) {
  if (m <= 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}` : `${h}h`;
}

// Energy is shown as lightning: ⚡ low, ⚡⚡ medium, ⚡⚡⚡ high (low first).
export const ENERGY = [
  { id: 'low', label: 'Low', bolts: '⚡', hint: 'Laptop work: coding, accounts, design' },
  { id: 'medium', label: 'Medium', bolts: '⚡⚡', hint: 'Pottering jobs' },
  { id: 'high', label: 'High', bolts: '⚡⚡⚡', hint: 'Big tidy-ups, starting big projects' },
];

export async function daySettings() {
  const s = await store.getSettings();
  return { ...DAY_DEFAULTS, ...Object.fromEntries(Object.keys(DAY_DEFAULTS).filter(k => s[k] != null).map(k => [k, s[k]])) };
}

// ---------- dates and times (local, not UTC) ----------

export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const showTime = t => { const [h, m] = t.split(':'); return `${Number(h)}.${m}`; }; // 8.30, as on paper

// "12.45 speak to L", "12:45-13:30 speak to L", "9.00 gym" → { time, end_time, title }
export function parseTimed(text) {
  const m = text.match(/^(\d{1,2})[.:](\d{2})(?:\s*[-–]\s*(\d{1,2})[.:](\d{2}))?[\s\t]+(.+)$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { time: null, end_time: null, title: text.trim() };
  const t = (h, mm) => `${String(Number(h)).padStart(2, '0')}:${mm}`;
  return { time: t(m[1], m[2]), end_time: m[3] ? t(m[3], m[4]) : null, title: m[5].trim() };
}

// ---------- records ----------

export async function getDay(date) {
  return (await store.get('days', date)) || { id: date, date, focus: '', energy: null, notes: '', paper: null };
}

// Saves run one at a time: two quick edits on a new day must not both create it.
let queue = Promise.resolve();
export function saveDay(date, fields) {
  const run = async () => {
    const existing = await store.get('days', date, { includeDeleted: true });
    return existing
      ? store.update('days', date, fields)
      : store.create('days', { id: date, date, focus: '', energy: null, notes: '', ...fields });
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || (a.sort_order ?? 0) - (b.sort_order ?? 0);

export async function itemsFor(date) {
  return (await store.list('day_items', { filter: i => i.date === date && !i.archived_at })).sort(byTime);
}

export async function addItem(date, fields) {
  const count = (await itemsFor(date)).length;
  return store.create('day_items', {
    date, title: '', notes: '', time: null, end_time: null, estimate_min: null, estimate_unsure: false, done_at: null, dropped_at: null,
    sort_order: count, task_id: null, case_id: null, contact_ids: [], source_thought_id: null, carried_from: null,
    ...fields,
  });
}

// Unfinished items from the last `days` days before `date`.
export async function unfinishedBefore(date, days = 7) {
  const from = addDays(date, -days);
  // Done and let-go items are finished either way; neither comes back.
  return (await store.list('day_items', { filter: i => i.date < date && i.date >= from && !i.done_at && !i.dropped_at && !i.archived_at }))
    .sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b));
}

// Dates between from and to (inclusive) that have anything planned or written.
export async function datesWithContent(from, to) {
  const out = new Set();
  for (const i of await store.list('day_items', { filter: i => i.date >= from && i.date <= to })) out.add(i.date);
  for (const d of await store.list('days', { filter: d => d.date >= from && d.date <= to && (d.focus || d.notes || d.energy) })) out.add(d.date);
  return out;
}

// ---------- archive & bin ----------
// Letting an item go archives it (and marks dropped_at). The Archive shows it
// like any archived item; the "Let go, not done" filter finds just those.
// Restoring one recalls it: back on its day, unfinished, not "let go".

const niceDay = d => parseDate(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export const binProvider = {
  area: 'planner',
  label: 'Day Planner',
  filters: [{ id: 'letgo', label: 'Let go, not done' }],
  async entries(kind, { filter } = {}) {
    const inState = r => !r.purged_at && (kind === 'bin' ? !!r.deleted_at : !r.deleted_at && !!r.archived_at);
    let rows = await store.list('day_items', { includeDeleted: true, filter: inState });
    if (filter === 'letgo') rows = rows.filter(i => i.dropped_at && !i.done_at);
    return rows.map(i => ({
      collection: 'day_items', id: i.id, kind: 'Plan item', title: i.title,
      subtitle: `Planned for ${niceDay(i.date)}`,
      detail: i.time ? showTime(i.time) : '',
      at: kind === 'bin' ? i.deleted_at : i.archived_at,
      children: [],
      search: `${i.title} ${i.notes || ''}`,
      restoreExtra: kind === 'archive' && i.dropped_at ? { dropped_at: null } : null,
      returnExtra: kind === 'archive' && i.dropped_at ? { dropped_at: i.dropped_at } : null,
    })).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  },
};

// Undo any change from History, in any order. Undoing writes the "before"
// values back through the store, so the undo is itself a new History entry
// (undoing that is a redo).

import * as store from './store.js';

export const AREA_OF = {
  places: 'Find Things', items: 'Find Things',
  tasks: 'Tasks', projects: 'Tasks', milestones: 'Tasks',
  day_items: 'Day Planner', days: 'Day Planner',
  thoughts: 'Brain Dump',
  contacts: 'Contacts', contact_categories: 'Contacts', contact_jobs: 'Contacts', interactions: 'Contacts', cases: 'Contacts', case_notes: 'Contacts',
  lists: 'Lists', list_items: 'Lists',
  scans: 'Scans', contracts: 'Contracts', settings: 'Settings',
};

const NAME_FIELDS = ['title', 'name', 'text', 'body', 'label_code', 'summary'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const short = v => {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'object') return '…';
  const s = String(v).replace(/\s+/g, ' ');
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
};

export function areasOf(entry) {
  return [...new Set(entry.changes.map(c => AREA_OF[c.collection] || c.collection))];
}

// A name for an entry that no toast named.
export function describe(entry) {
  if (entry.label) return entry.label;
  const c = entry.changes[0];
  const fields = Object.keys(c.after).filter(f => !['created_at', 'tags', '_field_clocks'].includes(f));
  if (c.created) return `Created ${c.collection.replace(/_/g, ' ').replace(/s$/, '')}`;
  if (entry.changes.length > 1) return `Changed ${entry.changes.length} records`;
  if ('deleted_at' in c.after) return c.after.deleted_at ? 'Deleted' : 'Restored';
  if ('archived_at' in c.after) return c.after.archived_at ? 'Archived' : 'Unarchived';
  return `Edited ${fields.map(f => f.replace(/_/g, ' ')).join(', ')}`;
}

// Per-change lines for the details view.
export function lines(entry) {
  return entry.changes.slice(0, 50).map(c => {
    const nameField = NAME_FIELDS.find(f => c.after[f] != null || c.before?.[f] != null);
    const name = nameField ? short(c.after[nameField] ?? c.before?.[nameField]) : c.collection;
    if (c.created) return `${AREA_OF[c.collection] || c.collection}: created “${name}”`;
    const parts = Object.keys(c.after)
      .filter(f => !['_field_clocks'].includes(f))
      .map(f => `${f.replace(/_/g, ' ')}: ${short(c.before?.[f])} → ${short(c.after[f])}`);
    return `“${name}”: ${parts.join('; ')}`;
  });
}

// Undo entries (newest first so later changes are unwound before earlier
// ones). Returns how many fields had changed again since, which are still
// put back.
export async function undoEntries(entries) {
  let changedSince = 0;
  for (const entry of entries) {
    for (const c of [...entry.changes].reverse()) {
      const current = await store.get(c.collection, c.id, { includeDeleted: true });
      if (!current) continue;
      if (c.created) {
        if (!current.deleted_at) await store.update(c.collection, c.id, { deleted_at: new Date().toISOString() });
        continue;
      }
      const fields = {};
      for (const [f, v] of Object.entries(c.before || {})) {
        if (!same(current[f], c.after[f])) changedSince++;
        if (!same(current[f], v)) fields[f] = v;
      }
      if (Object.keys(fields).length) await store.update(c.collection, c.id, fields);
    }
  }
  // Undoing an undo is a redo: say so rather than "Undo: Undo: …".
  const one = entries.length === 1 && describe(entries[0]);
  const label = one ? (one.startsWith('Undo: ') ? `Redo: ${one.slice(6)}` : one.startsWith('Redo: ') ? `Undo: ${one.slice(6)}` : `Undo: ${one}`)
    : `Undo ${entries.length} changes`;
  await store.labelHistory(label, { undo_of: entries.map(e => e.id) });
  return { changedSince, label };
}

// Archive & Bin across the app. Each area provides its entries; this module
// restores, purges and empties.
//   Bin:     records with deleted_at (soft deleted). Kept BIN_DAYS, then purged.
//   Archive: records with archived_at (and not deleted). Hidden, still searchable.
// A provider: { area, label, async entries(kind) → [{ collection, id, kind,
//   title, subtitle, detail, at, children: [{ collection, id }], search }] }

import * as store from './store.js';
import { binProvider as findThings } from './places.js';
import { binProvider as tasks } from './tasks.js';
import { binProvider as contacts } from './contacts.js';
import { binProvider as dump } from './views/dump.js';
import { binProvider as lists } from './lists.js';
import { binProvider as planner } from './days.js';

export const BIN_DAYS = 30;
const PROVIDERS = [planner, tasks, dump, findThings, lists, contacts];

export function binProviders(area = 'all') {
  return PROVIDERS.filter(p => area === 'all' || p.area === area);
}

const field = kind => (kind === 'bin' ? 'deleted_at' : 'archived_at');

function byCollection(entries) {
  const out = new Map();
  for (const e of entries) {
    for (const r of [e, ...e.children]) {
      if (!out.has(r.collection)) out.set(r.collection, []);
      out.get(r.collection).push(r.id);
    }
  }
  return out;
}

// Take entries out of the bin/archive.
// An entry may carry restoreExtra (e.g. a let-go plan item stops being "let go").
export async function restoreEntries(entries, kind) {
  for (const [collection, ids] of byCollection(entries)) {
    await store.updateMany(collection, ids.map(id => {
      const e = entries.find(x => x.collection === collection && x.id === id);
      return [id, { [field(kind)]: null, ...(e?.restoreExtra || {}) }];
    }));
  }
}

// Put them back (used to undo a restore).
export async function returnEntries(entries, kind) {
  const f = field(kind);
  for (const e of entries) {
    const stamp = e.at || new Date().toISOString();
    for (const r of [e, ...e.children]) await store.updateMany(r.collection, [[r.id, { [f]: stamp, ...(r === e ? e.returnExtra || {} : {}) }]]);
  }
}

// Archive → Bin (and back, to undo).
export async function binEntries(entries, back = false) {
  const now = new Date().toISOString();
  for (const [collection, ids] of byCollection(entries)) {
    await store.updateMany(collection, ids.map(id => [id, { deleted_at: back ? null : now }]));
  }
}

export async function purgeEntries(entries) {
  for (const [collection, ids] of byCollection(entries)) await store.purgeMany(collection, ids);
}

// Purge anything that has been in the bin for longer than BIN_DAYS.
export async function autoEmpty() {
  const cutoff = new Date(Date.now() - BIN_DAYS * 86400000).toISOString();
  for (const p of PROVIDERS) {
    const old = (await p.entries('bin')).filter(e => e.at && e.at < cutoff);
    if (old.length) await purgeEntries(old);
  }
}

export async function counts(area = 'all') {
  let archive = 0;
  let bin = 0;
  for (const p of binProviders(area)) {
    archive += (await p.entries('archive')).length;
    bin += (await p.entries('bin')).length;
  }
  return { archive, bin };
}

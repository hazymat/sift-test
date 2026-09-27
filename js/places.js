// Find Things data: life areas (kind "edition") → sections → boxes (all in `places`, told apart
// by `kind`) → items. Plus CSV import/export and search.

import * as store from './store.js';
import { parseCsvObjects, toCsv } from './csv.js';

export const CSV_COLUMNS = ['life_area', 'group', 'box_code', 'box_name', 'box_location', 'box_notes', 'item', 'item_notes', 'sub_of'];
const DEFAULT_EDITION = 'Standard';
const DEFAULT_SECTION = 'Boxes';

const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at.localeCompare(b.created_at);
const same = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

// Everything in one pass, nested and sorted.
export async function loadTree() {
  // Archived boxes and items are hidden here; they live in Archive (bin.js).
  const [places, items] = (await Promise.all([store.list('places'), store.list('items')]))
    .map(rows => rows.filter(r => !r.archived_at));
  const children = new Map();
  for (const p of places) {
    const key = p.parent_place_id || null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(p);
  }
  const itemsByBox = new Map();
  for (const i of items) {
    if (!itemsByBox.has(i.place_id)) itemsByBox.set(i.place_id, []);
    itemsByBox.get(i.place_id).push(i);
  }
  const kids = id => (children.get(id) || []).sort(byOrder);
  return kids(null).filter(p => p.kind === 'edition').map(edition => ({
    ...edition,
    sections: kids(edition.id).map(section => ({
      ...section,
      boxes: kids(section.id).map(box => ({
        ...box,
        items: nest((itemsByBox.get(box.id) || []).sort(byOrder)),
      })),
    })),
  }));
}

// Items in display order: each top-level item followed by its sub-items,
// with `depth` 0 or 1. A sub-item whose parent is gone shows at top level.
export function nest(items) {
  const ids = new Set(items.map(i => i.id));
  const kids = new Map();
  for (const i of items) {
    if (i.parent_item_id && ids.has(i.parent_item_id)) {
      if (!kids.has(i.parent_item_id)) kids.set(i.parent_item_id, []);
      kids.get(i.parent_item_id).push(i);
    }
  }
  const out = [];
  for (const i of items) {
    if (i.parent_item_id && ids.has(i.parent_item_id)) continue;
    out.push({ ...i, depth: 0 });
    for (const k of kids.get(i.id) || []) out.push({ ...k, depth: 1 });
  }
  return out;
}

export function boxTitle(box) {
  return box.label_code ? `${box.label_code} · ${box.name}` : box.name;
}

// ---------- search ----------

// Plain substring match on every word, across codes, names, locations,
// notes and items. Full-text search across the app comes in step 9.
// "3x Ethernet kits" / "3 × kits" → { name: 'Ethernet kits', quantity: 3 }.
export function splitQuantity(text) {
  const m = String(text || '').trim().match(/^(\d{1,5})\s?[x×]\s+(.+)$/i);
  return m ? { name: m[2].trim(), quantity: Number(m[1]) } : { name: String(text || '').trim(), quantity: null };
}
const itemText = i => `${i.name} ${i.notes || ''} ${(i.tags || []).join(' ')}`;

export function search(tree, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hit = text => words.every(w => text.toLowerCase().includes(w));
  const results = [];
  for (const edition of tree) {
    for (const section of edition.sections) {
      for (const box of section.boxes) {
        const path = [edition.name, section.name];
        const boxText = [box.label_code, box.name, box.location_note, box.notes].join(' ');
        const boxMatch = hit(boxText);
        // Words may be split between box and item ("BB microphone").
        const items = box.items.filter(i => hit(itemText(i)) || (!boxMatch && hit(`${boxText} ${itemText(i)}`)));
        if (boxMatch || items.length) results.push({ edition, section, box, items, path, boxMatch });
      }
    }
  }
  return results;
}

// ---------- archive & bin ----------

export const binProvider = {
  area: 'places',
  label: 'Find Things',
  async entries(kind) {
    const inState = r => !r.purged_at && (kind === 'bin' ? !!r.deleted_at : !r.deleted_at && !!r.archived_at);
    const places = await store.list('places', { includeDeleted: true });
    const items = await store.list('items', { includeDeleted: true });
    const byId = new Map(places.map(p => [p.id, p]));
    const path = p => {
      const names = [];
      for (let cur = byId.get(p.parent_place_id); cur; cur = byId.get(cur.parent_place_id)) names.unshift(cur.name);
      return names.join(' › ');
    };
    const out = [];
    const claimed = new Set();
    for (const b of places.filter(p => p.kind === 'box' && inState(p))) {
      const inside = items.filter(i => i.place_id === b.id && !i.purged_at);
      // Items deleted together with the box come back with it.
      const kids = kind === 'bin'
        ? inside.filter(i => i.deleted_at && Math.abs(Date.parse(i.deleted_at) - Date.parse(b.deleted_at)) < 5000)
        : [];
      kids.forEach(i => claimed.add(i.id));
      const count = kind === 'bin' ? kids.length : inside.filter(i => !i.deleted_at).length;
      out.push({
        collection: 'places', id: b.id, kind: 'Box',
        title: b.label_code ? `${b.label_code} · ${b.name}` : b.name,
        subtitle: path(b),
        detail: count ? `${count} item${count === 1 ? '' : 's'}` : 'empty',
        at: kind === 'bin' ? b.deleted_at : b.archived_at,
        children: kids.map(i => ({ collection: 'items', id: i.id })),
        search: [b.label_code, b.name, b.location_note, b.notes, ...inside.map(i => i.name)].join(' '),
      });
    }
    for (const i of items) {
      if (!inState(i) || claimed.has(i.id)) continue;
      const box = byId.get(i.place_id);
      out.push({
        collection: 'items', id: i.id, kind: 'Item',
        title: i.name,
        subtitle: box ? [path(box), box.label_code || box.name].filter(Boolean).join(' › ') : '',
        detail: i.notes || '',
        at: kind === 'bin' ? i.deleted_at : i.archived_at,
        children: [],
        search: `${i.name} ${i.notes || ''}`,
      });
    }
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  },
};

// How many archived entries match a search (for "+ n in archive").
export async function archivedMatchCount(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  return (await binProvider.entries('archive'))
    .filter(e => words.every(w => `${e.title} ${e.subtitle} ${e.search}`.toLowerCase().includes(w))).length;
}

// ---------- import / export ----------

function normalise(row) {
  const pick = (...keys) => keys.map(k => row[k]).find(v => v != null && v !== '') || '';
  return {
    edition: pick('life_area', 'edition') || DEFAULT_EDITION,
    section: pick('group', 'section') || DEFAULT_SECTION,
    box_code: pick('box_code', 'label_code', 'code'),
    box_name: pick('box_name', 'box', 'name', 'desc'),
    box_location: pick('box_location', 'location', 'location_note'),
    box_notes: pick('box_notes'),
    item: pick('item', 'item_name', 'contents'),
    item_notes: pick('item_notes', 'notes'),
    sub_of: pick('sub_of', 'parent_item'),
  };
}

// Merge a CSV into what's already here. Matching is by name (and code for
// boxes), so importing the same file twice doesn't create duplicates.
export async function importCsv(text) {
  const rows = parseCsvObjects(text).map(normalise).filter(r => r.box_name || r.box_code);
  const count = { editions: 0, sections: 0, boxes: 0, items: 0, skipped: 0 };
  const places = await store.list('places');
  const items = await store.list('items');
  const nextOrder = parentId => places.filter(p => (p.parent_place_id || null) === parentId).length;

  async function place(kind, parentId, match, fields) {
    let found = places.find(p => p.kind === kind && (p.parent_place_id || null) === parentId && match(p));
    if (found) return found;
    found = await store.create('places', { kind, parent_place_id: parentId, sort_order: nextOrder(parentId), ...fields });
    places.push(found);
    count[kind === 'box' ? 'boxes' : `${kind}s`]++;
    return found;
  }

  for (const r of rows) {
    const edition = await place('edition', null, p => same(p.name, r.edition), { name: r.edition, notes: '' });
    const section = await place('section', edition.id, p => same(p.name, r.section), { name: r.section, location_note: '', notes: '' });
    const box = await place('box', section.id,
      p => (r.box_code ? same(p.label_code, r.box_code) : !p.label_code && same(p.name, r.box_name)),
      { name: r.box_name || r.box_code, label_code: r.box_code, location_note: r.box_location, notes: r.box_notes });
    if (!r.item) continue;
    const parent = r.sub_of && items.find(i => i.place_id === box.id && !i.parent_item_id && same(i.name, r.sub_of));
    const existing = items.find(i => i.place_id === box.id && same(i.name, r.item));
    if (existing) {
      // Already here: only fill in a missing parent (older imports were flat).
      if (parent && !existing.parent_item_id && parent.id !== existing.id) {
        const oldNote = `part of: ${r.sub_of.replace(/:\s*$/, '').trim()}`;
        Object.assign(existing, await store.update('items', existing.id, {
          parent_item_id: parent.id,
          ...(same(existing.notes, oldNote) ? { notes: '' } : {}),
        }));
        count.nested = (count.nested || 0) + 1;
      } else {
        count.skipped++;
      }
      continue;
    }
    const order = items.filter(i => i.place_id === box.id).length;
    items.push(await store.create('items', {
      ...splitQuantity(r.item), place_id: box.id, parent_item_id: parent?.id || null, notes: r.item_notes, sort_order: order, last_moved_at: null,
    }));
    count.items++;
  }
  return count;
}

export async function exportCsv() {
  const rows = [CSV_COLUMNS];
  for (const edition of await loadTree()) {
    for (const section of edition.sections) {
      for (const box of section.boxes) {
        const base = [edition.name, section.name, box.label_code, box.name, box.location_note, box.notes];
        if (!box.items.length) rows.push([...base, '', '', '']);
        const names = new Map(box.items.map(i => [i.id, i.name]));
        for (const i of box.items) rows.push([...base, i.name, i.notes, names.get(i.parent_item_id) || '']);
      }
    }
  }
  return toCsv(rows);
}

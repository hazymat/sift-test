// Lists: reusable checklists. A template (e.g. "Holiday packing") is used to
// make instances ("Holiday packing – Portugal"), each with its own ticks.
// Plain lists have ticks but no template.
//   lists:      name, kind (template|instance|list), template_id?, notes, sort_order, used_at?
//   list_items: list_id, text, parent_id? (one level), sort_order, checked_at?

import * as store from './store.js';
import { byRank } from './order.js';

const byOrder = byRank(); // order.js: merges cleanly across devices
const same = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

export async function loadLists() {
  const [lists, items] = await Promise.all([
    store.list('lists', { filter: l => !l.archived_at }),
    store.list('list_items', { filter: i => !i.archived_at }),
  ]);
  return { lists: lists.sort(byOrder), items: items.sort(byOrder) };
}

// Items in display order with depth (each item followed by its sub-items).
export function nestItems(items) {
  const ids = new Set(items.map(i => i.id));
  const out = [];
  for (const i of items.filter(x => !x.parent_id || !ids.has(x.parent_id))) {
    out.push({ ...i, depth: 0 });
    for (const k of items.filter(x => x.parent_id === i.id)) out.push({ ...k, depth: 1 });
  }
  return out;
}

export function progress(items) {
  const total = items.length;
  const done = items.filter(i => i.checked_at).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function createList(fields) {
  return store.create('lists', { name: '', kind: 'list', template_id: null, notes: '', sort_order: Date.now(), used_at: null, ...fields });
}

export async function addItems(listId, lines, after = []) {
  let parent = after.filter(i => !i.parent_id).at(-1)?.id || null;
  let n = after.length;
  const made = [];
  for (const line of lines) {
    const sub = line.sub && parent;
    const item = await store.create('list_items', { list_id: listId, text: line.text, parent_id: sub ? parent : null, sort_order: n++, checked_at: null });
    made.push(item);
    if (!sub) parent = item.id;
  }
  return made;
}

// Copy a template's items into a new instance (no ticks).
export async function useTemplate(template, templateItems, name) {
  const inst = await createList({ name, kind: 'instance', template_id: template.id });
  const idMap = new Map();
  for (const i of nestItems(templateItems)) {
    const made = await store.create('list_items', {
      list_id: inst.id, text: i.text, notes: i.notes || '', parent_id: i.parent_id ? idMap.get(i.parent_id) || null : null, sort_order: i.sort_order, checked_at: null,
    });
    idMap.set(i.id, made.id);
  }
  await store.update('lists', template.id, { used_at: new Date().toISOString() });
  return inst;
}

// Template items that an instance doesn't have (matched by text).
export function missingFromTemplate(instanceItems, templateItems) {
  return templateItems.filter(t => !instanceItems.some(i => same(i.text, t.text)));
}

// ---------- archive & bin ----------

export const binProvider = {
  area: 'lists',
  label: 'Lists',
  async entries(kind) {
    const inState = r => !r.purged_at && (kind === 'bin' ? !!r.deleted_at : !r.deleted_at && !!r.archived_at);
    const at = r => (kind === 'bin' ? r.deleted_at : r.archived_at);
    const lists = await store.list('lists', { includeDeleted: true });
    const items = await store.list('list_items', { includeDeleted: true });
    const out = [];
    const claimed = new Set();
    for (const l of lists.filter(inState)) {
      // Items deleted together with the list come back with it.
      const kids = kind === 'bin' ? items.filter(i => i.list_id === l.id && i.deleted_at && Math.abs(Date.parse(i.deleted_at) - Date.parse(l.deleted_at)) < 5000) : [];
      kids.forEach(k => claimed.add(k.id));
      out.push({ collection: 'lists', id: l.id, kind: l.kind === 'template' ? 'Template' : 'List', title: l.name, subtitle: '', detail: kids.length ? `${kids.length} items` : '', at: at(l), children: kids.map(k => ({ collection: 'list_items', id: k.id })), search: `${l.name} ${kids.map(k => k.text).join(' ')}` });
    }
    const name = new Map(lists.map(l => [l.id, l.name]));
    for (const i of items.filter(inState)) {
      if (claimed.has(i.id)) continue;
      out.push({ collection: 'list_items', id: i.id, kind: 'List item', title: i.text, subtitle: name.get(i.list_id) || '', detail: '', at: at(i), children: [], search: i.text });
    }
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  },
};

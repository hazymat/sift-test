// Links between things. Any note can link to anything else in Sift; the link
// is kept in the note's markdown as [label](sift:<collection>/<id>) and shown
// as an underlined chip. This module knows the kinds of thing there are, how
// to search them (most recently touched first), how to open one, and how to
// spot phone numbers and email addresses typed into a note.

import * as store from './store.js';
import { createContact, CAPTURED_HEADING } from './contacts.js';

const firstLine = s => (s || '').split('\n').map(l => l.trim()).find(Boolean) || '';
const niceDate = d => (d ? new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '');
export const unlinkText = s => (s || '').replace(/\[([^\]]*)\]\(sift:[^)]*\)/g, '$1');

// Each kind: how to name it, what to search, where it lives.
export const KINDS = {
  contacts: {
    label: 'Contact', icon: '👤',
    title: c => c.name || c.details?.[0]?.value || 'Unnamed contact',
    sub: c => (c.name ? c.details?.map(d => d.value).join(' · ') : '') || c.about || (c.status === 'stored' ? '' : 'transient'),
    text: c => [c.name, c.about, c.notes, ...(c.details || []).map(d => d.value)].join(' '),
    route: c => `#/contacts/c/${c.id}`,
  },
  day_items: {
    label: 'Plan item', icon: '🗓️',
    title: i => i.title || '(untitled)', sub: i => `Day Planner · ${niceDate(i.date)}`,
    text: i => `${i.title} ${i.notes || ''}`, route: i => `#/planner/${i.date}`,
  },
  days: {
    label: 'Day notes', icon: '📅',
    title: d => `Notes for ${niceDate(d.date)}`, sub: d => unlinkText(firstLine(d.notes)),
    text: d => d.notes || '', route: d => `#/planner/${d.date}`, only: d => !!d.notes?.trim(),
  },
  tasks: {
    label: 'Task', icon: '☑️',
    title: t => t.title || '(untitled)', sub: t => (t.done_at ? 'Task · done' : 'Task'),
    text: t => `${t.title} ${t.notes || ''}`, route: t => `#/tasks/list${t.project_id ? `/${t.project_id}` : ''}`,
    important: t => !t.done_at && t.priority && t.priority <= 2,
  },
  thoughts: {
    label: 'Brain dump', icon: '💭',
    title: t => t.title || unlinkText(firstLine(t.body)).slice(0, 80) || '(empty)', sub: () => 'Brain Dump',
    text: t => t.body || '', route: () => '#/dump', important: t => !!t.pinned,
  },
  cases: {
    label: 'Case', icon: '📁',
    title: k => k.title || '(untitled case)', sub: k => k.summary || 'Case',
    text: k => `${k.title} ${k.summary || ''}`, route: k => `#/contacts/cases/${k.id}`,
  },
  items: {
    label: 'Thing', icon: '📦',
    title: i => i.name || '(unnamed)', sub: () => 'Find Things',
    text: i => `${i.name} ${i.notes || ''}`, route: i => `#/find-things/${i.place_id}`,
  },
  places: {
    label: 'Box', icon: '🗃️',
    title: b => [b.label_code, b.name].filter(Boolean).join(' ') || '(box)', sub: b => b.location_note || 'Find Things',
    text: b => `${b.label_code || ''} ${b.name} ${b.location_note || ''} ${b.notes || ''}`, route: b => `#/find-things/${b.id}`,
    only: b => b.kind === 'box',
  },
  list_items: {
    label: 'List item', icon: '☐',
    title: i => i.text || '(item)', sub: () => 'Lists',
    text: i => `${i.text} ${i.notes || ''}`, route: i => `#/lists/${i.list_id}`,
  },
  lists: {
    label: 'List', icon: '📋',
    title: l => l.name || '(list)', sub: () => 'Lists',
    text: l => `${l.name} ${l.notes || ''}`, route: l => `#/lists/${l.id}`,
  },
};

// What each emoji offers to link.
export const PICKERS = {
  contact: { kinds: ['contacts'], placeholder: 'Search contacts', none: "Don't link a contact", empty: 'No contacts match' },
  note: { kinds: Object.keys(KINDS), placeholder: 'Search everything', none: "Don't link anything", empty: 'Nothing matches' },
  important: { kinds: Object.keys(KINDS), important: true, placeholder: 'Search important things', none: "Don't link anything", empty: 'Nothing marked important matches' },
};

const isImportant = (kind, r) => !!kind.important?.(r) || /⚠|\bimportant\b/i.test(kind.text(r));

// Everything linkable, newest-touched first. Loaded once per picker.
export async function loadThings(kinds = Object.keys(KINDS), { important = false } = {}) {
  const out = [];
  for (const collection of kinds) {
    const kind = KINDS[collection];
    for (const r of await store.list(collection, { filter: x => !x.archived_at && !x.purged_at })) {
      if (kind.only && !kind.only(r)) continue;
      if (important && !isImportant(kind, r)) continue;
      out.push({
        collection, id: r.id, icon: kind.icon, label: kind.label,
        title: kind.title(r), sub: kind.sub(r), at: r.updated_at || r.created_at || '',
        search: `${kind.title(r)} ${unlinkText(kind.text(r))}`.toLowerCase(),
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function searchThings(things, q, limit = 30) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const digits = q.replace(/\D/g, '');
  return things.filter(t => words.every(w => t.search.includes(w)) || (digits.length >= 4 && t.search.replace(/\D/g, '').includes(digits))).slice(0, limit);
}

export const linkMd = (label, collection, id) => `[${String(label).replace(/[[\]\n]/g, ' ').trim()}](sift:${collection}/${id})`;

export async function openRef(ref) {
  const [collection, id] = ref.split('/');
  const kind = KINDS[collection];
  const r = kind && await store.get(collection, id, { includeDeleted: true });
  if (!r || r.purged_at) return (await import('./toast.js')).toast('That has been deleted');
  if (r.deleted_at) return (await import('./toast.js')).toast('That is in the Bin');
  location.hash = kind.route(r);
}

// Notes anywhere that link to a record ("Mentioned in").
export async function mentionsOf(collection, id) {
  const needle = `sift:${collection}/${id}`;
  const out = [];
  for (const [c, kind] of Object.entries(KINDS)) {
    for (const r of await store.list(c, { filter: x => !x.archived_at && kind.text(x).includes(needle) })) {
      out.push({ collection: c, id: r.id, icon: kind.icon, label: kind.label, title: kind.title(r), route: kind.route(r) });
    }
  }
  return out;
}

// ---------- contacts linked from a note ----------

// The thing a note belongs to also lists the contact (where it can).
export async function attachContact(origin, contactId) {
  if (!origin?.id || !['day_items', 'tasks'].includes(origin.collection)) return;
  const r = await store.get(origin.collection, origin.id);
  if (r && !(r.contact_ids || []).includes(contactId)) await store.update(origin.collection, origin.id, { contact_ids: [...(r.contact_ids || []), contactId] });
}
export async function detachContact(origin, contactId) {
  if (!origin?.id || !['day_items', 'tasks'].includes(origin.collection)) return;
  const r = await store.get(origin.collection, origin.id);
  if (r?.contact_ids?.includes(contactId)) await store.update(origin.collection, origin.id, { contact_ids: r.contact_ids.filter(x => x !== contactId) });
}

// ---------- spotting phone numbers and emails ----------

export const COUNTRIES = [
  ['44', 'United Kingdom', 11], ['353', 'Ireland', 10], ['1', 'USA / Canada', 10], ['61', 'Australia', 10], ['64', 'New Zealand', 10],
  ['33', 'France', 10], ['49', 'Germany', 11], ['34', 'Spain', 9], ['39', 'Italy', 10], ['31', 'Netherlands', 10], ['32', 'Belgium', 10],
  ['41', 'Switzerland', 10], ['43', 'Austria', 11], ['45', 'Denmark', 8], ['46', 'Sweden', 10], ['47', 'Norway', 8], ['358', 'Finland', 10],
  ['351', 'Portugal', 9], ['48', 'Poland', 9], ['30', 'Greece', 10], ['90', 'Turkey', 11], ['972', 'Israel', 10], ['971', 'UAE', 10],
  ['91', 'India', 11], ['27', 'South Africa', 10], ['234', 'Nigeria', 11], ['254', 'Kenya', 10], ['81', 'Japan', 11], ['82', 'South Korea', 11],
  ['86', 'China', 11], ['852', 'Hong Kong', 8], ['65', 'Singapore', 8], ['60', 'Malaysia', 10], ['63', 'Philippines', 11], ['55', 'Brazil', 11],
  ['52', 'Mexico', 10], ['54', 'Argentina', 11],
];

export const SPOT_DEFAULTS = { spot_details: true, phone_country: '44' };
export async function spotSettings() {
  const s = await store.getSettings();
  return { spot_details: s.spot_details ?? SPOT_DEFAULTS.spot_details, phone_country: s.phone_country || SPOT_DEFAULTS.phone_country };
}

// A number: starts with +, 00, (44)/(+44) or a digit, then digits with spaces,
// dots, dashes or brackets between; 9 to 15 digits in all.
const PHONE_RE = /(?:\+|\(\+?\d{1,4}\)|\b\d)[\d  ().\-]{6,}\d/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi;

// The same number written any way comes out the same: +447970938694.
export function normPhone(raw, cc = '44') {
  const s = raw.replace(/\(0\)/g, '');
  const d = s.replace(/\D/g, '');
  if (/^\s*(\+|\(\+?\d)/.test(s)) return `+${d}`;
  if (d.startsWith('00')) return `+${d.slice(2)}`;
  if (d.startsWith('0')) return `+${cc}${d.slice(1)}`;
  return cc === '1' && d.length === 10 ? `+1${d}` : `+${d}`;
}

function looksLikePhone(raw, cc) {
  const d = raw.replace(/\D/g, '');
  if (d.length < 9 || d.length > 15) return false;
  if (/^\s*(\+|\(|00)/.test(raw) || d.startsWith('0')) return true;
  return cc === '1' && d.length === 10; // US/Canada: no leading 0
}

// Matches in `text` that are finished: typed past (the caret is beyond them),
// or `final` (leaving the note). A number followed only by a space that's
// shorter than a full number waits: you may be typing it in groups.
export function findDetails(text, { caret = -1, final = false, cc = '44' } = {}) {
  const full = COUNTRIES.find(c => c[0] === cc)?.[2] || 10;
  const out = [];
  const taken = [];
  for (const m of text.matchAll(EMAIL_RE)) {
    const end = m.index + m[0].length;
    if (!final && !(caret > end)) continue;
    out.push({ type: 'email', raw: m[0], start: m.index, end });
    taken.push([m.index, end]);
  }
  for (const m of text.matchAll(PHONE_RE)) {
    let raw = m[0].replace(/[\s .(-]+$/, '');
    const start = m.index;
    const end = start + raw.length;
    if (taken.some(([a, b]) => start < b && end > a)) continue;
    if (!looksLikePhone(raw, cc)) continue;
    if (!final) {
      if (!(caret > end)) continue;
      const d = raw.replace(/\D/g, '');
      const need = /^\s*(\+|\(|00)/.test(raw) ? 11 : full;
      if (d.length < need && /^[\s ]*$/.test(text.slice(end, caret))) continue;
    }
    out.push({ type: 'phone', raw, start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

// Numbers and emails already on contacts, so the same one links to the same
// contact however it's written. Kept by each notes editor and topped up as it
// makes contacts, so spotting can link straight away without waiting.
export const detailKey = (type, raw, cc = '44') => (type === 'phone' ? normPhone(raw, cc) : raw.trim().toLowerCase());
export async function loadDetailIndex(cc = '44') {
  const index = new Map();
  for (const c of await store.list('contacts', { filter: x => !x.archived_at })) {
    for (const d of c.details || []) {
      const type = /@/.test(d.value) ? 'email' : 'phone';
      if (type === 'phone' && d.value.replace(/\D/g, '').length < 6) continue;
      index.set(detailKey(type, d.value, cc), { id: c.id, name: c.name });
    }
  }
  return index;
}

// A transient contact for a number or email typed into a note. It remembers
// the line it was typed on and links back to where it came from.
export function createDetailContact({ id, type, raw }, { origin, line = '' } = {}) {
  const from = origin?.id ? `From ${linkMd(origin.title || KINDS[origin.collection]?.label || 'a note', origin.collection, origin.id)}` : '';
  const context = unlinkText(line).trim();
  return createContact({
    id,
    details: [{ label: type === 'phone' ? 'Phone' : 'Email', value: raw.trim() }],
    body: context,
    notes: [CAPTURED_HEADING, context, from].filter(Boolean).join('\n'),
    source_ref: origin?.id ? { collection: origin.collection, id: origin.id } : null,
    source_thought_id: origin?.collection === 'thoughts' ? origin.id : null,
  });
}

// Turn a link back into plain text in a stored record's notes (for Undo once
// the editor has gone).
export async function unlinkInRecord(origin, ref, field = 'notes') {
  if (!origin?.id) return;
  const r = await store.get(origin.collection, origin.id);
  if (!r?.[field]) return;
  const re = new RegExp(`\\[([^\\]]*)\\]\\(sift:${ref.replace('/', '\\/')}\\)`, 'g');
  const next = r[field].replace(re, '$1');
  if (next !== r[field]) await store.update(origin.collection, origin.id, { [field]: next });
}

// Chips in notes that aren't being edited open what they link to.
export function installRefLinks() {
  document.addEventListener('click', ev => {
    const chip = ev.target.closest?.('.ref[data-ref]');
    if (!chip || chip.closest('.rich-edit')) return;
    ev.preventDefault();
    ev.stopPropagation();
    openRef(chip.dataset.ref);
  }, true);
}

// Numbers and emails in plain text become links to contacts (known ones, or
// new transient ones). Returns the new text and the contacts it made.
export async function linkDetailsInText(text, origin) {
  const { spot_details: on, phone_country: cc } = await spotSettings();
  if (!on || !text) return { text, made: [], linked: 0 };
  const index = await loadDetailIndex(cc);
  const lines = text.split('\n');
  const made = [];
  let linked = 0;
  for (let n = 0; n < lines.length; n++) {
    // Skip anything already inside a link.
    const plain = lines[n].replace(/\[[^\]]*\]\(sift:[^)]*\)/g, m => ' '.repeat(m.length));
    for (const m of findDetails(plain, { final: true, cc }).reverse()) {
      const key = detailKey(m.type, m.raw, cc);
      let id = index.get(key)?.id;
      if (!id) {
        id = store.uuidv7();
        index.set(key, { id, name: '' });
        await createDetailContact({ id, type: m.type, raw: m.raw }, { origin, line: lines[n] });
        made.push(id);
      }
      lines[n] = lines[n].slice(0, m.start) + linkMd(m.raw, 'contacts', id) + lines[n].slice(m.end);
      linked++;
    }
  }
  return { text: lines.join('\n'), made, linked };
}

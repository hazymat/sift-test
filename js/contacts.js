// Contacts data: transient and stored contacts, categories, the interactions
// log, cases and case notes (spec §4.4, §4.4a).

import * as store from './store.js';

export const HOW = [
  { id: 'call', label: 'Call', icon: '📞' },
  { id: 'text', label: 'Text', icon: '💬' },
  { id: 'email', label: 'Email', icon: '✉️' },
  { id: 'letter', label: 'Letter', icon: '📄' },
  { id: 'visit', label: 'Visit', icon: '🚪' },
  { id: 'meeting', label: 'Meeting', icon: '🤝' },
  { id: 'other', label: 'Other', icon: '•' },
];

export const RESEARCH = [
  { id: 'candidate', label: 'Candidate' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'quoted', label: 'Quoted' },
  { id: 'booked', label: 'Booked' },
  { id: 'rejected', label: 'Rejected' },
];

export const CASE_STATUS = [
  { id: 'open', label: 'Open' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'closed', label: 'Closed' },
];

// ---------- pulling details out of free text ----------

const PHONE = /(?:\+|\b0|\b00)[\d\s().-]{7,}\d/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"]+|\bwww\.[^\s<>"]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:co\.uk|org\.uk|com|net|org|uk|io)\b(?:\/[^\s<>"]*)?/gi;

export function extractDetails(text = '') {
  const out = [];
  const seen = new Set();
  const add = (label, value) => {
    const v = value.trim().replace(/[.,;:)]+$/, '');
    if (v && !seen.has(v)) { seen.add(v); out.push({ label, value: v }); }
  };
  for (const m of text.match(EMAIL) || []) add('Email', m);
  for (const m of text.replace(EMAIL, ' ').match(URL_RE) || []) add('Website', m);
  for (const m of text.match(PHONE) || []) if (m.replace(/\D/g, '').length >= 9) add('Phone', m);
  return out;
}

// Split free text into a name (the first line up to its first email, link or
// number), the details, and whatever's left over (becomes a note).
export function splitContactText(text = '') {
  const first = text.split('\n').map(l => l.trim()).find(Boolean) || '';
  const blank = s => ' '.repeat(s.length);
  // Blank out each kind of detail in turn, keeping positions, to find the first.
  let masked = first.replace(EMAIL, blank);
  masked = masked.replace(URL_RE, blank);
  masked = masked.replace(PHONE, m => (m.replace(/\D/g, '').length >= 9 ? blank(m) : m));
  let cut = first.length;
  for (let i = 0; i < first.length; i++) if (masked[i] !== first[i]) { cut = i; break; }
  const name = first.slice(0, cut).replace(/[\s,;:–-]+$/, '').trim();
  const rest = masked.slice(cut).replace(/\s+/g, ' ').replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '').trim();
  return { name: (name || first).slice(0, 60), details: extractDetails(text), rest };
}

export const guessName = text => splitContactText(text).name;

export const telHref = v => `tel:${v.replace(/[^\d+]/g, '')}`;
export const detailHref = d => {
  const v = d.value || '';
  if (/phone|mobile|tel/i.test(d.label) || /^[+\d][\d\s().-]{6,}$/.test(v)) return telHref(v);
  if (/@/.test(v)) return `mailto:${v}`;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^www\./i.test(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(v)) return `https://${v}`;
  return null;
};
export const howFor = d => (/@/.test(d.value) ? 'email' : /^https?:|^www\.|^[a-z0-9-]+\.[a-z]/i.test(d.value) ? 'other' : 'call');

// ---------- records ----------

export async function loadContacts() {
  const live = r => !r.archived_at;
  const [contacts, categories, cases, interactions] = await Promise.all([
    store.list('contacts', { filter: live }),
    store.list('contact_categories', { filter: live }),
    store.list('cases', { filter: live }),
    store.list('interactions'),
  ]);
  return { contacts, categories: categories.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)), cases, interactions };
}

export function createContact(fields) {
  return store.create('contacts', {
    name: '', kind: 'person', status: 'transient', category_ids: [], about: '', details: [], body: '', notes: '',
    research_status: null, rating: null, would_use_again: null, area_covered: '',
    captured_at: new Date().toISOString(), source_thought_id: null, looked_up_at: [], last_contacted_at: null, pinned: false,
    ...fields,
  });
}

export const CAPTURED_HEADING = '## Captured when created';

// Notes with the original text kept under a heading (the user can edit or
// delete it like any other note).
export function withCapturedText(notes = '', body = '') {
  if (!body.trim() || notes.includes(CAPTURED_HEADING)) return notes;
  return `${notes.trim() ? `${notes.trim()}\n\n` : ''}${CAPTURED_HEADING}\n${body.trim()}`;
}

// Whatever is left over after the name and details becomes the note, and the
// original text is kept under "Captured when created".
export function contactFromText(text, extra = {}) {
  const { name, details, rest } = splitContactText(text);
  return createContact({ name, body: text.trim(), details, notes: withCapturedText(rest, text), ...extra });
}

export async function logInteraction(fields) {
  const made = await store.create('interactions', {
    at: new Date().toISOString(), how: 'call', direction: 'out', contact_id: null, case_id: null,
    detail_used: null, summary: '', scan_id: null, task_id: null, ...fields,
  });
  if (made.contact_id) {
    const c = await store.get('contacts', made.contact_id);
    if (c) {
      const details = made.detail_used
        ? c.details.map(d => (d.value === made.detail_used ? { ...d, last_used_at: made.at } : d))
        : c.details;
      await store.update('contacts', c.id, { last_contacted_at: made.at, details });
    }
  }
  return made;
}

// Last activity: captured, looked up or contacted.
export const lastActivity = c => [c.captured_at, c.looked_up_at?.[0], c.last_contacted_at].filter(Boolean).sort().at(-1) || c.created_at;

// ---------- archive & bin ----------

export const binProvider = {
  area: 'contacts',
  label: 'Contacts',
  async entries(kind) {
    const inState = r => !r.purged_at && (kind === 'bin' ? !!r.deleted_at : !r.deleted_at && !!r.archived_at);
    const at = r => (kind === 'bin' ? r.deleted_at : r.archived_at);
    const out = [];
    for (const c of await store.list('contacts', { includeDeleted: true, filter: inState })) {
      out.push({ collection: 'contacts', id: c.id, kind: c.status === 'stored' ? 'Contact' : 'Number', title: c.name || '(no name)', subtitle: c.about || '', detail: c.details?.map(d => d.value).join(' · ') || '', at: at(c), children: [], search: `${c.name} ${c.about} ${c.body} ${c.notes} ${c.details?.map(d => d.value).join(' ')}` });
    }
    for (const k of await store.list('cases', { includeDeleted: true, filter: inState })) {
      out.push({ collection: 'cases', id: k.id, kind: 'Case', title: k.title, subtitle: k.summary || '', detail: '', at: at(k), children: [], search: `${k.title} ${k.summary} ${k.references?.map(r => r.value).join(' ')}` });
    }
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  },
};

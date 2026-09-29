// Contracts: insurance, utilities, subscriptions, loans… what you pay, when it
// renews and how much notice it needs. A renewal or a switch is a new
// contract pointing back at the old one (previous_contract_id), so each line
// of cover keeps its history.
//   contracts: name, category, provider, provider_phone?, provider_url?, reference?,
//     covers?, start_date?, end_date?, renewal_date?, auto_renew, notice_days?,
//     cost?, cost_frequency (monthly|quarterly|annual|one_off), payment_method_note?,
//     status (current|ended|cancelled), previous_contract_id?, contact_id?,
//     custom_fields [{label, value}], notes, reminder_task_id?
//
//   CATEGORIES, FREQUENCIES, STATUSES
//   perYear(c)             the cost over a year (one-off costs count as 0)
//   money(n)               "£1,234.50"
//   renewalSoon(c)         'past' | 'soon' (within 60 days) | ''
//   newContract(fields)    renew(c) → the new one
//   binProvider            for Archive & Bin

import * as store from './store.js';
import { isoDate } from './days.js';

export const CATEGORIES = [
  ['insurance', 'Insurance'], ['utility', 'Utility'], ['broadband', 'Broadband'], ['phone', 'Phone'],
  ['mortgage', 'Mortgage'], ['rent', 'Rent'], ['loan', 'Loan'], ['subscription', 'Subscription'],
  ['warranty', 'Warranty'], ['pension', 'Pension'], ['other', 'Other'],
];
export const FREQUENCIES = [['monthly', 'a month'], ['quarterly', 'a quarter'], ['annual', 'a year'], ['one_off', 'once']];
export const STATUSES = [['current', 'Current'], ['ended', 'Ended'], ['cancelled', 'Cancelled']];
export const categoryLabel = id => CATEGORIES.find(c => c[0] === id)?.[1] || 'Other';

const TIMES = { monthly: 12, quarterly: 4, annual: 1, one_off: 0 };
export const perYear = c => (Number(c.cost) || 0) * (TIMES[c.cost_frequency || 'monthly'] ?? 0);
const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
export const money = n => GBP.format(Number(n) || 0);

export function renewalSoon(c, today = isoDate()) {
  const d = c.renewal_date || c.end_date;
  if (!d || c.status !== 'current') return '';
  if (d < today) return 'past';
  return (Date.parse(d) - Date.parse(today)) / 864e5 <= 60 ? 'soon' : '';
}

export function newContract(fields = {}) {
  return store.create('contracts', {
    name: '', category: 'other', provider: '', provider_phone: '', provider_url: '', reference: '', covers: '',
    start_date: null, end_date: null, renewal_date: null, auto_renew: false, notice_days: null,
    cost: null, cost_frequency: 'monthly', payment_method_note: '', status: 'current',
    previous_contract_id: null, contact_id: null, custom_fields: [], notes: '', ...fields,
  });
}

// A year on: the old one ends, a new current one carries on from its renewal date.
const yearOn = d => { if (!d) return null; const x = new Date(`${d}T12:00`); x.setFullYear(x.getFullYear() + 1); return isoDate(x); };
export async function renew(c) {
  const start = c.renewal_date || isoDate();
  const { id, created_at, updated_at, deleted_at, archived_at, purged_at, _field_clocks, _dirty_fields, _server_seq, reminder_task_id, ...keep } = c;
  const made = await newContract({ ...keep, status: 'current', start_date: start, end_date: null, renewal_date: c.renewal_date ? yearOn(c.renewal_date) : null, previous_contract_id: c.id, notes: '' });
  await store.update('contracts', c.id, { status: 'ended', end_date: c.end_date || start });
  return made;
}

// ---------- archive & bin ----------

export const binProvider = {
  area: 'contracts',
  label: 'Contracts',
  async entries(kind) {
    const inState = r => !r.purged_at && (kind === 'bin' ? !!r.deleted_at : !r.deleted_at && !!r.archived_at);
    const at = r => (kind === 'bin' ? r.deleted_at : r.archived_at);
    return (await store.list('contracts', { includeDeleted: true })).filter(inState)
      .map(c => ({ collection: 'contracts', id: c.id, kind: categoryLabel(c.category), title: c.name || c.provider || 'Contract', subtitle: c.provider || '', detail: c.cost ? `${money(c.cost)} ${FREQUENCIES.find(f => f[0] === c.cost_frequency)?.[1] || ''}` : '', at: at(c), children: [], search: `${c.name} ${c.provider} ${c.covers || ''}` }))
      .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  },
};

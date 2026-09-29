// Days from the Day Planner as plain text, for pasting or saving:
//
//   Wednesday 23 September 2026
//   Task list
//   - DONE
//    - 9.00 Item 1
//     - Item 1 note, with links(1)
//   - NOT DONE
//    - Item 4
//   Notes
//    - …
//
//   Links
//   (1) Contact: Maria. Phone: 07970 938694
//
// With `links` off, links are just their text.

import * as store from './store.js';
import { byRank } from './order.js';
import { KINDS } from './refs.js';

const byPlace = byRank(); // order.js

const LINK = /\[([^\]]*)\]\(sift:([a-z_]+)\/([\w-]+)\)/g;
const plain = s => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/~~(.+?)~~/g, '$1').replace(/(^|\s)_(\S.*?)_(?=$|[\s).,!?:;])/g, '$1$2').replace(/^(?:#{1,6}|-#|\+#|#\+)\s+/, '');
const showTime = t => { const [h, m] = t.split(':'); return `${Number(h)}.${m}`; };
const longDate = d => new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export async function daysAsText(from, to, { links = true } = {}) {
  if (to < from) [from, to] = [to, from];
  const items = await store.list('day_items', { filter: i => i.date >= from && i.date <= to && !i.archived_at });
  const days = await store.list('days', { filter: d => d.date >= from && d.date <= to });
  const dates = [...new Set([...items.map(i => i.date), ...days.filter(d => (d.notes || '').trim() || d.focus).map(d => d.date)])].sort();

  const found = []; // [{ ref, label }]
  const numberOf = new Map();
  const withLinks = text => text.replace(LINK, (m, label, c, id) => {
    if (!links) return label;
    const ref = `${c}/${id}`;
    if (!numberOf.has(ref)) { found.push({ ref, label, collection: c, id }); numberOf.set(ref, found.length); }
    return `${label}(${numberOf.get(ref)})`;
  });
  const noteLines = (notes, indent) => (notes || '').split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => `${indent}- ${withLinks(plain(l.replace(/^[-*•]\s+/, '')))}`);

  const out = [];
  for (const date of dates) {
    const day = days.find(d => d.date === date);
    const list = items.filter(i => i.date === date)
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || byPlace(a, b));
    const line = i => [` - ${i.time ? `${showTime(i.time)}${i.end_time ? `–${showTime(i.end_time)}` : ''} ` : ''}${withLinks(i.title)}`, ...noteLines(i.notes, '  ')];
    if (out.length) out.push('');
    out.push(longDate(date));
    if (day?.focus) out.push(`Focus: ${day.focus}`);
    if (list.length) {
      out.push('Task list');
      const done = list.filter(i => i.done_at);
      const todo = list.filter(i => !i.done_at);
      if (done.length) out.push('- DONE', ...done.flatMap(line));
      if (todo.length) out.push('- NOT DONE', ...todo.flatMap(line));
    }
    if ((day?.notes || '').trim()) out.push('Notes', ...noteLines(day.notes, ' '));
  }
  if (!dates.length) out.push('Nothing planned or written on those days.');

  if (links && found.length) {
    out.push('', 'Links');
    for (const [n, f] of found.entries()) {
      const kind = KINDS[f.collection];
      const r = kind && await store.get(f.collection, f.id, { includeDeleted: true });
      let text = f.label;
      if (r && f.collection === 'contacts') {
        const details = (r.details || []).map(d => `${d.label}: ${d.value}`).join(', ');
        text = [r.name ? `Contact: ${r.name}` : 'Contact', details].filter(Boolean).join('. ');
      } else if (r && kind) {
        text = `${kind.label}: ${kind.title(r)}`;
      }
      out.push(`(${n + 1}) ${text}`);
    }
  }
  return out.join('\n');
}

// Search everything: one box over every kind of item (Brain Dump notes,
// tasks, day items and day notes, contacts, cases, things and boxes, lists
// and list items). On a laptop it's in the top bar (Ctrl+K, or / when you're
// not typing); on a phone it's at the top of the More list.
//
// Results are grouped by kind, with a line from where the words were found
// (highlighted). Opening one goes to it and makes it pulse (flash.js).

import * as store from './store.js';
import { KINDS, unlinkText, openRef } from './refs.js';
import { commentTexts } from './comments.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PER_GROUP = 6;
const GROUP = { Contact: 'Contacts', 'Plan item': 'Day Planner', 'Day notes': 'Day notes', Task: 'Tasks', 'Brain dump': 'Brain Dump', Case: 'Cases', Thing: 'Things', Box: 'Boxes', 'List item': 'List items', List: 'Lists' };

// Everything searchable, read once and kept until something changes.
let cache = null;
store.subscribe(() => { cache = null; });
async function load() {
  if (cache) return cache;
  const out = [];
  const said = await commentTexts(); // a task's comments are searched with it
  for (const [collection, kind] of Object.entries(KINDS)) {
    for (const r of await store.list(collection, { filter: x => !x.archived_at && !x.purged_at })) {
      if (kind.only && !kind.only(r)) continue;
      const title = kind.title(r);
      const own = collection === 'tasks' ? said.get(`task_id:${r.id}`) : collection === 'day_items' && !r.task_id ? said.get(`item_id:${r.id}`) : '';
      let text = unlinkText(`${kind.text(r)} ${own || ''}`).replace(/\s+/g, ' ').trim();
      if (text.toLowerCase().startsWith(title.toLowerCase())) text = text.slice(title.length).trim(); // a note's text starts with its title
      out.push({ collection, id: r.id, icon: kind.icon, label: kind.label, title, sub: kind.sub(r), text, at: r.updated_at || r.created_at || '', hay: `${title} ${text}`.toLowerCase() });
    }
  }
  cache = out;
  return out;
}

function find(things, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const digits = q.replace(/\D/g, '');
  const hits = things.filter(t => words.every(w => t.hay.includes(w)) || (digits.length >= 4 && t.hay.replace(/\D/g, '').includes(digits)));
  // Title matches first, then the most recently changed.
  const inTitle = t => words.every(w => t.title.toLowerCase().includes(w));
  return { words, hits: hits.sort((a, b) => Number(inTitle(b)) - Number(inTitle(a)) || b.at.localeCompare(a.at)) };
}

function mark(text, words) {
  let html = esc(text);
  for (const w of words.filter(x => x.length > 1).sort((a, b) => b.length - a.length)) {
    html = html.replace(new RegExp(`(${esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
  }
  return html;
}

// A line of the text around the first word found (when it isn't in the title).
function snippet(t, words) {
  const low = t.text.toLowerCase();
  const at = Math.min(...words.map(w => low.indexOf(w)).filter(i => i >= 0));
  if (!Number.isFinite(at) || words.every(w => t.title.toLowerCase().includes(w))) return t.sub || '';
  let start = Math.max(0, at - 30);
  if (start) { const sp = t.text.indexOf(' ', start); start = sp >= 0 && sp < at ? sp + 1 : start; } // begin at a whole word
  return `${start ? '…' : ''}${t.text.slice(start, start + 110)}${start + 110 < t.text.length ? '…' : ''}`;
}

function resultsHtml(q, things, openGroups) {
  const { words, hits } = find(things, q);
  if (!hits.length) return `<p class="muted sr-empty">Nothing found for “${esc(q)}”.</p>`;
  const groups = new Map();
  for (const h of hits) { if (!groups.has(h.label)) groups.set(h.label, []); groups.get(h.label).push(h); }
  return [...groups].map(([label, list]) => {
    const all = openGroups.has(label);
    const shown = all ? list : list.slice(0, PER_GROUP);
    return `<section class="sr-group"><h4><span aria-hidden="true">${list[0].icon}</span> ${esc(GROUP[label] || label)} <span class="muted">${list.length}</span></h4>
      ${shown.map(t => `<button type="button" class="sr-item" data-ref="${t.collection}/${t.id}"><span class="sr-title">${mark(t.title, words)}</span>${snippet(t, words) ? `<span class="sr-snip">${mark(snippet(t, words), words)}</span>` : ''}</button>`).join('')}
      ${list.length > shown.length ? `<button type="button" class="sr-more" data-group="${esc(label)}">Show all ${list.length}</button>` : ''}</section>`;
  }).join('');
}

// Wire a search box to a results area. `onOpen` runs when a result is chosen
// (to close the dropdown or sheet); `onClear` when the box is emptied.
export function mountSearch(input, box, { onOpen = () => {}, onShow = () => {}, onClear = () => {} } = {}) {
  let timer;
  let openGroups = new Set();
  const show = async () => {
    const q = input.value.trim();
    if (!q) { box.hidden = true; box.innerHTML = ''; onClear(); return; }
    const things = await load();
    if (input.value.trim() !== q) return;
    box.innerHTML = resultsHtml(q, things, openGroups);
    box.hidden = false;
    onShow();
  };
  input.addEventListener('input', () => { clearTimeout(timer); openGroups = new Set(); timer = setTimeout(show, 120); });
  input.addEventListener('focus', () => { if (input.value.trim()) show(); });
  const items = () => [...box.querySelectorAll('.sr-item')];
  input.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown' && items().length) { ev.preventDefault(); items()[0].focus(); }
    if (ev.key === 'Enter') { ev.preventDefault(); items()[0]?.click(); }
    if (ev.key === 'Escape') { input.value = ''; show(); input.blur(); }
  });
  box.addEventListener('keydown', ev => {
    const list = items();
    const n = list.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown' && n >= 0) { ev.preventDefault(); list[Math.min(n + 1, list.length - 1)].focus(); }
    if (ev.key === 'ArrowUp' && n >= 0) { ev.preventDefault(); (n ? list[n - 1] : input).focus(); }
    if (ev.key === 'Escape') { input.focus(); }
  });
  box.addEventListener('mousedown', ev => { if (ev.target.closest('.sr-more')) ev.preventDefault(); });
  box.addEventListener('click', ev => {
    const more = ev.target.closest('.sr-more');
    if (more) { openGroups.add(more.dataset.group); show(); return; }
    const item = ev.target.closest('.sr-item');
    if (!item) return;
    onOpen();
    openRef(item.dataset.ref);
  });
  return { show, clear() { input.value = ''; show(); } };
}

// Contacts (spec §4.4, §4.4a).
//   #/contacts                 Recent: transient numbers + recently used, quick capture
//   #/contacts/directory/<cat> Stored contacts by category; research mode per category
//   #/contacts/cases           Cases list;  #/contacts/cases/<id>  one case's timeline
//   #/contacts/c/<id>          One contact (opening it stamps "looked up")

import { cogHtml } from '../viewcog.js';
import * as store from '../store.js';
import {
  loadContacts, createContact, contactFromText, extractDetails, logInteraction, lastActivity,
  detailHref, howFor, HOW, RESEARCH, CASE_STATUS, withCapturedText, CAPTURED_HEADING,
} from '../contacts.js';
import { listEntry, listHint, SHORTCUT } from '../listentry.js';
import { toast, undoable } from '../toast.js';
import { richText } from '../richtext.js';
import { mentionsOf } from '../refs.js';
import { keepDraft, draftCleared } from '../drafts.js';
import { addTask } from '../tasks.js';
import { isoDate } from '../days.js';
import { createListKit } from '../listkit.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const OLDER_DAYS = 60;

function ago(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
const when = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default {
  async mount(el) {
    const state = this.state = { tab: 'recent', id: null, q: '' };
    let data = { contacts: [], categories: [], cases: [], interactions: [] };
    let editors = [];

    el.innerHTML = `
      <div class="tasks-head">
        <div class="segmented" id="c-tabs" role="tablist">
          <button type="button" data-tab="recent">Recent</button>
          <button type="button" data-tab="directory">Directory</button>
          <button type="button" data-tab="cases">Cases</button>
        </div>
        ${cogHtml('contacts')}
        <details class="tool-menu">
          <summary class="icon-btn" aria-label="More actions">${icon('i-more')}</summary>
          <div class="menu">
            <button type="button" data-act="new-contact">New contact</button>
            <button type="button" data-act="new-category">New category</button>
            <button type="button" data-act="new-case">New case</button>
            <hr>
            <a href="#/bin/archive/contacts">Archive</a>
            <a href="#/bin/bin/contacts">Bin</a>
          </div>
        </details>
      </div>
      <div id="c-body"></div>`;
    const body = el.querySelector('#c-body');
    const go = hash => { if (location.hash !== hash) location.hash = hash; else render(); };

    const byId = id => data.contacts.find(c => c.id === id);
    // First real line of the notes, for cards (not the "Captured" heading).
    const noteLine = c => (c.notes || '').split('\n').map(l => l.replace(/[*_~#]/g, '').trim()).find(l => l && !CAPTURED_HEADING.includes(l))?.slice(0, 90) || '';
    const catName = id => data.categories.find(k => k.id === id)?.name || '';

    // ---------- shared bits ----------

    function detailChips(c, { log = true } = {}) {
      return (c.details || []).map(d => {
        const href = detailHref(d);
        return href
          ? `<a class="chip detail-chip" href="${esc(href)}" ${href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''} ${log ? `data-log="${esc(d.value)}" data-contact="${c.id}"` : ''}>${esc(d.value)}</a>`
          : `<span class="chip">${esc(d.label)}: ${esc(d.value)}</span>`;
      }).join('');
    }

    function contactCard(c) {
      return `
        <li class="c-card${c.pinned ? ' pinned' : ''}" data-contact-card="${c.id}" data-id="${c.id}">
          <button type="button" class="drag-handle kit-grip" aria-label="Select">${icon('i-grip')}</button>
          <a class="c-main" href="#/contacts/c/${c.id}">
            <span class="c-name">${esc(c.name || '(no name)')}</span>
            ${c.about ? `<span class="muted c-about">${esc(c.about)}</span>` : c.status === 'transient' ? '<span class="what-was-this">What was this?</span>' : ''}
            ${c.category_ids?.length ? `<span class="muted c-about">${c.category_ids.map(catName).filter(Boolean).map(esc).join(' · ')}</span>` : ''}
            ${noteLine(c) ? `<span class="muted c-about c-note">${esc(noteLine(c))}</span>` : ''}
          </a>
          <span class="c-details">${detailChips(c)}</span>
          <span class="muted c-when">${ago(lastActivity(c))}${c.research_status ? ` · ${RESEARCH.find(r => r.id === c.research_status)?.label}` : ''}</span>
        </li>`;
    }

    // ---------- Recent ----------

    function viewRecent() {
      const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      const match = c => words.every(w => `${c.name} ${c.about} ${c.body} ${c.notes} ${(c.details || []).map(d => d.value).join(' ')}`.toLowerCase().includes(w));
      const cutoff = new Date(Date.now() - OLDER_DAYS * 86400000).toISOString();
      const sorted = data.contacts.filter(match).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || lastActivity(b).localeCompare(lastActivity(a)));
      const recent = sorted.filter(c => c.pinned || lastActivity(c) >= cutoff || c.status === 'stored' && lastActivity(c) >= cutoff);
      const older = sorted.filter(c => !recent.includes(c));
      return `
        <div class="c-capture">
          <textarea id="c-new" rows="2" placeholder="Paste or type a number, email, name… (one contact)"></textarea>
          <button type="button" class="primary" data-act="capture">Save <kbd>${SHORTCUT}</kbd></button>
        </div>
        <input type="search" id="c-q" class="search" placeholder="Search contacts…" value="${esc(state.q)}" autocomplete="off">
        <ul class="c-list kit-list">${recent.map(contactCard).join('') || (older.length ? '' : '<li class="empty"><h2>No contacts yet. Paste a number above.</h2></li>')}
          ${older.length ? `<li class="list-head older-head">Older <span class="muted">(untouched for ${OLDER_DAYS} days)</span></li>${older.map(contactCard).join('')}` : ''}
        </ul>`;
    }

    // ---------- Directory ----------

    function viewDirectory() {
      const stored = data.contacts.filter(c => c.status === 'stored');
      const cat = data.categories.find(k => k.id === state.id);
      if (cat) {
        const inCat = stored.filter(c => c.category_ids?.includes(cat.id))
          .sort((a, b) => RESEARCH.findIndex(r => r.id === a.research_status) - RESEARCH.findIndex(r => r.id === b.research_status) || (a.name || '').localeCompare(b.name || ''));
        return `
          <div class="project-head">
            <button type="button" class="back" data-act="dir-home">‹ Directory</button>
            <input class="project-name" value="${esc(cat.name)}" data-category="${cat.id}" aria-label="Category name">
            <span class="muted">${inCat.length} contact${inCat.length === 1 ? '' : 's'}</span>
          </div>
          <details class="research" ${inCat.length ? '' : 'open'}>
            <summary>Research mode: add lots at once</summary>
            <p class="muted hint">One per line: name, number, website, a note, in any order. Numbers, emails and links are recognised. Each becomes a candidate in ${esc(cat.name)}. ${SHORTCUT} to add.</p>
            <textarea id="research-new" rows="4" placeholder="Smith Plumbing 0161 555 0101 smithplumbing.co.uk good reviews&#10;Dave (Anna's plumber) 07700 900123 not sure he'll do it, but maybe"></textarea>
          </details>
          <ul class="c-list research-list kit-list">${inCat.map(c => `
            ${contactCard(c)}
            <li class="research-row" data-research="${c.id}">
              ${RESEARCH.map(r => `<button type="button" data-status="${r.id}" aria-pressed="${c.research_status === r.id}">${r.label}</button>`).join('')}
              <span class="stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-rate="${n}" aria-pressed="${(c.rating || 0) >= n}">★</button>`).join('')}</span>
            </li>`).join('') || '<li class="muted hint">Nobody here yet.</li>'}
          </ul>`;
      }
      const uncategorised = stored.filter(c => !c.category_ids?.length);
      return `
        <div class="cat-grid">
          ${data.categories.map(k => {
            const n = stored.filter(c => c.category_ids?.includes(k.id)).length;
            return `<a class="project-card" href="#/contacts/directory/${k.id}"><span class="project-title">${esc(k.name)}</span><span class="muted">${n} contact${n === 1 ? '' : 's'}</span></a>`;
          }).join('')}
          <button type="button" class="project-card add-card" data-act="new-category">+ New category</button>
        </div>
        <p class="muted hint">Categories are anything you like: Plumber, Sparky, Carers, Mum Care…</p>
        ${uncategorised.length ? `<h3 class="milestone">Stored, no category</h3><ul class="c-list">${uncategorised.map(contactCard).join('')}</ul>` : ''}`;
    }

    // ---------- one contact ----------

    function linkedTo(c) {
      return {
        tasks: [], cases: data.cases.filter(k => k.contact_ids?.includes(c.id)),
        log: data.interactions.filter(i => i.contact_id === c.id).sort((a, b) => b.at.localeCompare(a.at)),
      };
    }

    function logForm(prefix) {
      return `
        <div class="log-form" data-log-form="${prefix}">
          <select name="how">${HOW.map(h => `<option value="${h.id}">${h.icon} ${h.label}</option>`).join('')}</select>
          <select name="direction"><option value="out">I contacted them</option><option value="in">They contacted me</option></select>
          <input name="summary" placeholder="What happened? (optional)" autocomplete="off">
          <button type="button" data-act="log-${prefix}">Log it</button>
        </div>`;
    }

    async function viewContact() {
      const c = byId(state.id);
      if (!c) return '<div class="empty"><h2>That contact has gone.</h2></div>';
      const { cases, log } = linkedTo(c);
      const tasks = await store.list('tasks', { filter: t => t.contact_ids?.includes(c.id) && !t.archived_at });
      const dayItems = await store.list('day_items', { filter: i => i.contact_ids?.includes(c.id) && !i.archived_at });
      const known = new Set([...tasks, ...dayItems].map(r => r.id));
      const mentions = (await mentionsOf('contacts', c.id)).filter(m => !known.has(m.id) && m.id !== c.id);
      const timeline = [
        { at: c.captured_at, text: 'Recorded', kind: 'captured' },
        ...log.map(i => ({ at: i.at, text: `${HOW.find(h => h.id === i.how)?.icon || ''} ${i.direction === 'in' ? 'They' : 'I'} ${i.how === 'call' ? 'called' : i.how === 'email' ? 'emailed' : i.how === 'text' ? 'texted' : i.how}${i.detail_used ? ` (${i.detail_used})` : ''}${i.summary ? `: ${i.summary}` : ''}`, kind: 'log', id: i.id })),
        ...(c.looked_up_at || []).slice(0, 5).map(at => ({ at, text: 'Looked up', kind: 'look' })),
      ].filter(e => e.at).sort((a, b) => b.at.localeCompare(a.at));
      return `
        <div class="project-head">
          <button type="button" class="back" data-act="back">‹ Back</button>
          <input class="project-name" name="name" value="${esc(c.name)}" placeholder="Who is this?" data-edit="${c.id}" aria-label="Name">
          <button type="button" class="pin" data-act="pin-contact" aria-pressed="${!!c.pinned}" title="Pin">${c.pinned ? '★' : '☆'}</button>
        </div>
        <div class="c-page" data-contact="${c.id}">
          <div class="detail-grid">
            <label class="wide">What was this? / who are they<input name="about" value="${esc(c.about)}" data-edit="${c.id}" placeholder="e.g. The plumber Anna recommended" autocomplete="off"></label>
            <label>Kind<select name="kind" data-edit="${c.id}"><option value="person" ${c.kind === 'person' ? 'selected' : ''}>Person</option><option value="organisation" ${c.kind === 'organisation' ? 'selected' : ''}>Organisation</option></select></label>
            <div class="energy-pick"><span>Keep as</span>
              <button type="button" data-act="status" data-value="transient" aria-pressed="${c.status !== 'stored'}">Transient</button>
              <button type="button" data-act="status" data-value="stored" aria-pressed="${c.status === 'stored'}">Stored</button>
            </div>
            ${c.status === 'stored' ? `<div class="energy-pick wide"><span>Categories</span>
              ${data.categories.map(k => `<button type="button" data-act="toggle-cat" data-cat="${k.id}" aria-pressed="${!!c.category_ids?.includes(k.id)}">${esc(k.name)}</button>`).join('')}
              <button type="button" data-act="new-category-here">+ New</button></div>` : ''}
          </div>
          <h3 class="milestone">Details</h3>
          <ul class="detail-rows">${(c.details || []).map((d, n) => `
            <li data-n="${n}">
              <input name="label" value="${esc(d.label)}" class="d-label" aria-label="Label">
              <input name="value" value="${esc(d.value)}" aria-label="Value">
              ${detailHref(d) ? `<a class="icon-btn small" href="${esc(detailHref(d))}" data-log="${esc(d.value)}" data-contact="${c.id}" title="${howFor(d) === 'call' ? 'Call' : 'Open'}">${howFor(d) === 'call' ? '📞' : howFor(d) === 'email' ? '✉️' : '↗'}</a>` : ''}
              <button type="button" class="icon-btn small" data-act="del-detail" aria-label="Remove">×</button>
              ${d.last_used_at ? `<span class="muted d-used">used ${ago(d.last_used_at)}</span>` : ''}
            </li>`).join('')}
          </ul>
          <button type="button" data-act="add-detail">+ Detail</button>
          <h3 class="milestone">Notes</h3>
          <div id="c-notes"></div>
          <h3 class="milestone">Log</h3>
          ${logForm('contact')}
          <ul class="timeline">${timeline.map(e => `<li class="${e.kind}"><span class="muted">${when(e.at)}</span> ${esc(e.text)}</li>`).join('')}</ul>
          ${cases.length || tasks.length || dayItems.length || mentions.length ? `<h3 class="milestone">Connected</h3><ul class="links">
            ${cases.map(k => `<li><a href="#/contacts/cases/${k.id}">Case: ${esc(k.title)}</a></li>`).join('')}
            ${tasks.map(t => `<li><a href="#/tasks/list${t.project_id ? `/${t.project_id}` : ''}">Task: ${esc(t.title)}</a></li>`).join('')}
            ${dayItems.map(i => `<li><a href="#/planner/${i.date}">Plan ${i.date}: ${esc(i.title)}</a></li>`).join('')}
            ${mentions.map(m => `<li><a href="${m.route}">${m.icon} Mentioned in ${esc(m.label.toLowerCase())}: ${esc(m.title)}</a></li>`).join('')}
          </ul>` : ''}
          <div class="detail-actions">
            <button type="button" data-act="contact-task">+ Task with this contact</button>
            <span class="spacer"></span>
            <button type="button" data-act="archive-contact">Archive</button>
            <button type="button" class="danger" data-act="delete-contact">Delete</button>
          </div>
        </div>`;
    }

    // ---------- cases ----------

    function viewCases() {
      if (state.id) return viewCase();
      const cases = [...data.cases].sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || (b.updated_at || '').localeCompare(a.updated_at || ''));
      return `
        <ul class="c-list">${cases.map(k => `
          <li class="c-card"><a class="c-main" href="#/contacts/cases/${k.id}">
            <span class="c-name">${esc(k.title)}</span>
            <span class="muted c-about">${CASE_STATUS.find(s => s.id === k.status)?.label} · ${(k.contact_ids || []).map(id => byId(id)?.name).filter(Boolean).map(esc).join(', ')}</span>
          </a><span class="muted c-when">${ago(k.updated_at)}</span></li>`).join('') || '<li class="empty"><h2>No cases.</h2></li>'}
        </ul>
        <button type="button" data-act="new-case">+ New case</button>
        <p class="muted hint">A case is an ongoing saga (e.g. care funding with the council): references, people, calls, letters, tasks and notes in one timeline.</p>`;
    }

    async function viewCase() {
      const k = data.cases.find(x => x.id === state.id);
      if (!k) return '<div class="empty"><h2>That case has gone.</h2></div>';
      const log = data.interactions.filter(i => i.case_id === k.id);
      const notes = await store.list('case_notes', { filter: n => n.case_id === k.id });
      const tasks = await store.list('tasks', { filter: t => t.case_id === k.id && !t.archived_at });
      const scans = await store.list('scans', { filter: s => s.linked?.collection === 'cases' && s.linked.id === k.id });
      const events = [
        ...log.map(i => ({ at: i.at, type: 'log', html: `${HOW.find(h => h.id === i.how)?.icon || ''} <b>${i.direction === 'in' ? 'In' : 'Out'}</b>${i.contact_id ? ` · ${esc(byId(i.contact_id)?.name || '')}` : ''}${i.detail_used ? ` · ${esc(i.detail_used)}` : ''}${i.summary ? `: ${esc(i.summary)}` : ''}` })),
        ...notes.map(n => ({ at: n.at, type: 'note', html: `✎ ${esc(n.body)}` })),
        ...tasks.map(t => ({ at: t.created_at, type: 'task', html: `☐ Task: <a href="#/tasks/list">${esc(t.title)}</a>${t.done_at ? ' (done)' : ''}` })),
        ...scans.map(sc => ({ at: sc.letter_date || sc.created_at, type: 'letter', html: `📄 ${esc(sc.title)}${sc.summary ? `: ${esc(sc.summary)}` : ''}` })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      return `
        <div class="project-head">
          <button type="button" class="back" data-act="cases-home">‹ Cases</button>
          <input class="project-name" name="title" value="${esc(k.title)}" data-case="${k.id}" aria-label="Case title">
        </div>
        <div class="c-page" data-case-page="${k.id}">
          <div class="energy-pick"><span>Status</span>${CASE_STATUS.map(s => `<button type="button" data-act="case-status" data-value="${s.id}" aria-pressed="${k.status === s.id}">${s.label}</button>`).join('')}</div>
          <label class="wide">Summary<input name="summary" value="${esc(k.summary)}" data-case="${k.id}" placeholder="What is this about?" autocomplete="off"></label>
          <h3 class="milestone">References</h3>
          <ul class="detail-rows">${(k.references || []).map((r, n) => `
            <li data-ref="${n}"><input name="label" value="${esc(r.label)}" class="d-label" aria-label="Label"><input name="value" value="${esc(r.value)}" aria-label="Value">
              <button type="button" class="icon-btn small" data-act="copy-ref" title="Copy">⧉</button>
              <button type="button" class="icon-btn small" data-act="del-ref" aria-label="Remove">×</button></li>`).join('')}
          </ul>
          <button type="button" data-act="add-ref">+ Reference (case no, ref…)</button>
          <h3 class="milestone">People</h3>
          <div class="c-details">${(k.contact_ids || []).map(id => byId(id)).filter(Boolean).map(c => `<span class="chip"><a href="#/contacts/c/${c.id}">${esc(c.name)}</a> ${detailChips(c)} <button type="button" class="chip-x" data-act="case-unlink" data-id="${c.id}">×</button></span>`).join('')}
            <select id="case-add-contact"><option value="">+ Add a contact…</option>${data.contacts.filter(c => !k.contact_ids?.includes(c.id)).map(c => `<option value="${c.id}">${esc(c.name || '(no name)')}</option>`).join('')}</select>
          </div>
          <h3 class="milestone">Timeline</h3>
          ${logForm('case')}
          <div class="case-note"><input id="case-note" placeholder="Add a note (e.g. letter received: they want bank statements)" autocomplete="off"><button type="button" data-act="case-note">Add note</button>
            <button type="button" data-act="case-task">+ Task</button></div>
          <ul class="timeline">${events.map(e => `<li class="${e.type}"><span class="muted">${when(e.at)}</span> ${e.html}</li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul>
          <p class="muted hint">Letters: scans linked to this case will show here once Scans is built.</p>
          <div class="detail-actions"><span class="spacer"></span>
            <button type="button" data-act="archive-case">Archive</button>
            <button type="button" class="danger" data-act="delete-case">Delete</button>
          </div>
        </div>`;
    }

    // ---------- render ----------

    const render = this.render = async () => {
      data = await loadContacts();
      for (const b of el.querySelectorAll('[data-tab]')) b.setAttribute('aria-pressed', b.dataset.tab === (state.tab === 'contact' ? '' : state.tab));
      body.innerHTML = state.tab === 'directory' ? viewDirectory()
        : state.tab === 'cases' ? await viewCases()
        : state.tab === 'contact' ? await viewContact()
        : viewRecent();
      const cap = body.querySelector('#c-new');
      if (cap) keepDraft(cap, 'contacts:new');
      if (cap) cap.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); capture(); } });
      kit.attach(body.querySelector('.kit-list'));
      const research = body.querySelector('#research-new');
      if (research) listEntry(research, addCandidates, { draft: `contacts:research:${state.id}` });
      const q = body.querySelector('#c-q');
      if (q) q.addEventListener('input', () => { clearTimeout(this.qt); this.qt = setTimeout(() => { state.q = q.value.trim(); render().then(() => { const n = body.querySelector('#c-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 200); });
      const notesBox = body.querySelector('#c-notes');
      if (notesBox) {
        const c = byId(state.id);
        let t;
        richText(notesBox, { value: c.notes || '', placeholder: 'Record contact notes here', spot: false, origin: () => ({ collection: 'contacts', id: c.id, title: c.name, field: 'notes' }), onChange: md => { clearTimeout(t); t = setTimeout(() => store.update('contacts', c.id, { notes: md }), 600); } });
      }
    };

    // ---------- selecting several ----------

    async function batch(ids, fields, label) {
      const before = ids.map(id => { const c = byId(id); return [id, Object.fromEntries(Object.keys(fields).map(k => [k, c?.[k] ?? null]))]; });
      await store.updateMany('contacts', ids.map(id => [id, fields]));
      await render();
      undoable(`${label} ${ids.length} contact${ids.length === 1 ? '' : 's'}`, async () => { await store.updateMany('contacts', before); await render(); });
    }
    const kit = this.kit = createListKit({
      reorder: false,
      noun: 'contact',
      actions: [
        { id: 'store', label: 'Store', run: ids => batch(ids, { status: 'stored' }, 'Stored') },
        { id: 'pin', label: 'Pin', run: ids => batch(ids, { pinned: true }, 'Pinned') },
        { id: 'archive', label: 'Archive', run: ids => batch(ids, { archived_at: new Date().toISOString() }, 'Archived') },
        { id: 'delete', label: 'Delete', danger: true, run: ids => batch(ids, { deleted_at: new Date().toISOString() }, 'Deleted') },
      ],
    });
    this.onKey = ev => {
      if (ev.key === 'Escape' && !ev.target.closest('input, textarea, select, [contenteditable]')) kit.escape();
    };
    addEventListener('keydown', this.onKey);

    // ---------- actions ----------

    async function capture() {
      const ta = body.querySelector('#c-new');
      const text = ta.value.trim();
      if (!text) return;
      const c = await contactFromText(text);
      ta.value = '';
      draftCleared(ta);
      await render();
      undoable(`Saved ${c.name || 'contact'}`, async () => { await store.remove('contacts', c.id); render(); });
    }

    async function addCandidates(lines) {
      const made = [];
      for (const line of lines) {
        made.push(await contactFromText(line.text, { status: 'stored', category_ids: [state.id], research_status: 'candidate' }));
      }
      await render();
      undoable(`Added ${made.length} candidate${made.length === 1 ? '' : 's'}`, async () => {
        await store.updateMany('contacts', made.map(c => [c.id, { deleted_at: new Date().toISOString() }]));
        render();
      });
    }

    async function newCategory() {
      const name = prompt('Category name (e.g. Plumber, Carers, Mum Care):');
      if (!name?.trim()) return null;
      return store.create('contact_categories', { name: name.trim(), colour: null, sort_order: data.categories.length });
    }

    async function newCase() {
      const title = prompt('Case title (e.g. Mum\'s care funding: council):');
      if (!title?.trim()) return;
      const k = await store.create('cases', { title: title.trim(), status: 'open', summary: '', references: [], contact_ids: [], project_id: null, opened_at: new Date().toISOString(), closed_at: null });
      go(`#/contacts/cases/${k.id}`);
    }

    async function updateContact(id, fields, label = 'Saved') {
      const before = byId(id);
      const old = Object.fromEntries(Object.keys(fields).map(k => [k, before?.[k] ?? null]));
      await store.update('contacts', id, fields);
      await render();
      undoable(label, async () => { await store.update('contacts', id, old); render(); });
    }

    // Tapping a number/email logs a contact attempt, then lets the link work.
    el.addEventListener('click', async ev => {
      const link = ev.target.closest('a[data-log]');
      if (!link) return;
      const c = byId(link.dataset.contact);
      const d = c?.details.find(x => x.value === link.dataset.log);
      if (!c || !d) return;
      await logInteraction({ contact_id: c.id, how: howFor(d), direction: 'out', detail_used: d.value });
      toast(`Logged: ${howFor(d) === 'call' ? 'called' : 'contacted'} ${c.name || ''}`.trim());
    }, true);

    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act], [data-tab], [data-status], [data-rate]');
      if (!b) return;
      if (b.dataset.tab) { go(b.dataset.tab === 'recent' ? '#/contacts' : `#/contacts/${b.dataset.tab}`); return; }
      b.closest('details.tool-menu')?.removeAttribute('open');
      const act = b.dataset.act;
      const c = state.tab === 'contact' ? byId(state.id) : null;
      const k = state.tab === 'cases' && state.id ? data.cases.find(x => x.id === state.id) : null;

      if (b.dataset.status || b.dataset.rate) {
        const id = b.closest('[data-research]').dataset.research;
        const cur = byId(id);
        if (b.dataset.status) await updateContact(id, { research_status: cur.research_status === b.dataset.status ? 'candidate' : b.dataset.status }, RESEARCH.find(r => r.id === b.dataset.status).label);
        else await updateContact(id, { rating: Number(b.dataset.rate) === cur.rating ? null : Number(b.dataset.rate) }, 'Rated');
        return;
      }
      if (act === 'capture') return capture();
      if (act === 'new-contact') { const n = await createContact({ name: '' }); go(`#/contacts/c/${n.id}`); return; }
      if (act === 'new-category') { const cat = await newCategory(); if (cat) go(`#/contacts/directory/${cat.id}`); return; }
      if (act === 'new-case') return newCase();
      if (act === 'dir-home') return go('#/contacts/directory');
      if (act === 'cases-home') return go('#/contacts/cases');
      if (act === 'back') { history.length > 1 ? history.back() : go('#/contacts'); return; }

      if (c) {
        if (act === 'pin-contact') return updateContact(c.id, { pinned: !c.pinned }, c.pinned ? 'Unpinned' : 'Pinned');
        if (act === 'status') {
          const stored = b.dataset.value === 'stored';
          return updateContact(c.id, { status: b.dataset.value }, stored ? 'Stored in your directory' : 'Back to transient');
        }
        if (act === 'toggle-cat') {
          const ids = c.category_ids || [];
          const next = ids.includes(b.dataset.cat) ? ids.filter(x => x !== b.dataset.cat) : [...ids, b.dataset.cat];
          return updateContact(c.id, { category_ids: next }, 'Categories saved');
        }
        if (act === 'new-category-here') { const cat = await newCategory(); if (cat) await updateContact(c.id, { category_ids: [...(c.category_ids || []), cat.id] }); return; }
        if (act === 'add-detail') return updateContact(c.id, { details: [...(c.details || []), { label: 'Phone', value: '' }] }, 'Added a detail');
        if (act === 'del-detail') { const n = Number(b.closest('[data-n]').dataset.n); return updateContact(c.id, { details: c.details.filter((_, i) => i !== n) }, 'Removed'); }
        if (act === 'log-contact') {
          const f = b.closest('.log-form');
          const made = await logInteraction({ contact_id: c.id, how: f.querySelector('[name="how"]').value, direction: f.querySelector('[name="direction"]').value, summary: f.querySelector('[name="summary"]').value.trim() });
          await render();
          undoable('Logged', async () => { await store.remove('interactions', made.id); render(); });
          return;
        }
        if (act === 'contact-task') {
          const t = await addTask({ title: `Contact ${c.name || 'them'}`, contact_ids: [c.id] });
          toast('Task added', { action: 'Open', onAction: () => go('#/tasks/list') });
          return void t;
        }
        if (act === 'archive-contact' || act === 'delete-contact') {
          const field = act === 'delete-contact' ? 'deleted_at' : 'archived_at';
          await store.update('contacts', c.id, { [field]: new Date().toISOString() });
          go('#/contacts');
          undoable(act === 'delete-contact' ? 'Deleted' : 'Archived', async () => { await store.update('contacts', c.id, { [field]: null }); render(); });
          return;
        }
      }

      if (k) {
        const upd = async (fields, label = 'Saved') => {
          const old = Object.fromEntries(Object.keys(fields).map(x => [x, k[x] ?? null]));
          await store.update('cases', k.id, fields);
          await render();
          undoable(label, async () => { await store.update('cases', k.id, old); render(); });
        };
        if (act === 'case-status') return upd({ status: b.dataset.value, closed_at: b.dataset.value === 'closed' ? new Date().toISOString() : null }, CASE_STATUS.find(s => s.id === b.dataset.value).label);
        if (act === 'add-ref') return upd({ references: [...(k.references || []), { label: 'Case no', value: '' }] }, 'Added a reference');
        if (act === 'del-ref') { const n = Number(b.closest('[data-ref]').dataset.ref); return upd({ references: k.references.filter((_, i) => i !== n) }, 'Removed'); }
        if (act === 'copy-ref') { const n = Number(b.closest('[data-ref]').dataset.ref); await navigator.clipboard?.writeText(k.references[n].value); toast('Copied'); return; }
        if (act === 'case-unlink') return upd({ contact_ids: k.contact_ids.filter(x => x !== b.dataset.id) }, 'Removed from case');
        if (act === 'log-case') {
          const f = b.closest('.log-form');
          const made = await logInteraction({ case_id: k.id, contact_id: k.contact_ids?.[0] || null, how: f.querySelector('[name="how"]').value, direction: f.querySelector('[name="direction"]').value, summary: f.querySelector('[name="summary"]').value.trim() });
          await store.update('cases', k.id, { status: k.status });
          await render();
          undoable('Logged', async () => { await store.remove('interactions', made.id); render(); });
          return;
        }
        if (act === 'case-note') {
          const text = body.querySelector('#case-note').value.trim();
          if (!text) return;
          const n = await store.create('case_notes', { case_id: k.id, at: new Date().toISOString(), body: text });
          await render();
          undoable('Note added', async () => { await store.remove('case_notes', n.id); render(); });
          return;
        }
        if (act === 'case-task') {
          const title = prompt('Task:');
          if (!title?.trim()) return;
          const t = await addTask({ title: title.trim(), case_id: k.id, contact_ids: k.contact_ids || [] });
          await render();
          undoable('Task added', async () => { await store.remove('tasks', t.id); render(); });
          return;
        }
        if (act === 'archive-case' || act === 'delete-case') {
          const field = act === 'delete-case' ? 'deleted_at' : 'archived_at';
          await store.update('cases', k.id, { [field]: new Date().toISOString() });
          go('#/contacts/cases');
          undoable(act === 'delete-case' ? 'Deleted case' : 'Archived case', async () => { await store.update('cases', k.id, { [field]: null }); render(); });
        }
      }
    });

    el.addEventListener('change', async ev => {
      const t = ev.target;
      if (t.dataset.category) {
        const cat = data.categories.find(k => k.id === t.dataset.category);
        if (!t.value.trim() || t.value.trim() === cat?.name) return;
        const old = cat.name;
        await store.update('contact_categories', cat.id, { name: t.value.trim() });
        undoable('Saved', async () => { await store.update('contact_categories', cat.id, { name: old }); render(); });
        return;
      }
      if (t.id === 'case-add-contact' && t.value) {
        const k = data.cases.find(x => x.id === state.id);
        await store.update('cases', k.id, { contact_ids: [...(k.contact_ids || []), t.value] });
        return render();
      }
      if (t.dataset.case && t.name) {
        const k = data.cases.find(x => x.id === t.dataset.case);
        const old = k?.[t.name] ?? '';
        if (t.value.trim() === old) return;
        await store.update('cases', k.id, { [t.name]: t.value.trim() });
        data = await loadContacts();
        undoable('Saved', async () => { await store.update('cases', k.id, { [t.name]: old }); render(); });
        return;
      }
      const refRow = t.closest('[data-ref]');
      if (refRow) {
        const k = data.cases.find(x => x.id === state.id);
        const refs = structuredClone(k.references);
        refs[Number(refRow.dataset.ref)][t.name] = t.value.trim();
        const oldRefs = k.references;
        await store.update('cases', k.id, { references: refs });
        data = await loadContacts();
        undoable('Saved', async () => { await store.update('cases', k.id, { references: oldRefs }); render(); });
        return;
      }
      if (t.dataset.edit && t.name) return updateContact(t.dataset.edit, { [t.name]: t.value.trim() });
      const row = t.closest('[data-n]');
      if (row && state.tab === 'contact') {
        const c = byId(state.id);
        const details = structuredClone(c.details);
        details[Number(row.dataset.n)][t.name] = t.value.trim();
        await updateContact(c.id, { details }, 'Saved');
      }
    });

    await render();
  },

  async route([tab, id]) {
    if (tab === 'c' && id) {
      Object.assign(this.state, { tab: 'contact', id });
      // Opening a contact counts as looking it up.
      const c = await store.get('contacts', id);
      if (c) {
        const fields = { looked_up_at: [new Date().toISOString(), ...(c.looked_up_at || [])].slice(0, 20) };
        const notes = withCapturedText(c.notes || '', c.body || '');
        if (notes !== (c.notes || '')) fields.notes = notes;
        await store.update('contacts', id, fields);
      }
    } else {
      Object.assign(this.state, { tab: ['directory', 'cases'].includes(tab) ? tab : 'recent', id: id || null });
    }
    return this.render();
  },

  unmount() {
    this.kit?.destroy();
    removeEventListener('keydown', this.onKey);
  },

  quickAdd() {
    location.hash = '#/contacts';
    setTimeout(() => document.querySelector('#c-new')?.focus(), 50);
  },
};

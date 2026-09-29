// Contracts: #/contracts (a table on a laptop, cards by category on a phone)
// and #/contracts/<id> (one contract). The reference number stays hidden until
// you ask for it, for anyone looking over your shoulder.

import * as store from '../store.js';
import { cogHtml } from '../viewcog.js';
import { shareHtml } from '../share.js';
import { CATEGORIES, FREQUENCIES, STATUSES, categoryLabel, perYear, money, renewalSoon, newContract, renew } from '../contracts.js';
import * as att from '../attachments.js';
import { richText } from '../richtext.js';
import { debounced } from '../autosave.js';
import { toast, undoable } from '../toast.js';
import { openPicker } from '../linkpicker.js';
import { openRef } from '../refs.js';
import { addTask } from '../tasks.js';
import { isoDate, dateText } from '../days.js';
import { telHref } from '../contacts.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const niceDate = iso => (iso ? dateText(new Date(`${iso.slice(0, 10)}T12:00`), { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const daysBefore = (iso, n) => { const d = new Date(`${iso}T12:00`); d.setDate(d.getDate() - n); return isoDate(d); };
const freqLabel = f => FREQUENCIES.find(x => x[0] === f)?.[1] || '';
const costText = c => (c.cost ? `${money(c.cost)} ${freqLabel(c.cost_frequency)}` : '');
const masked = v => (v.length > 4 ? `${'•'.repeat(Math.min(8, v.length - 4))}${v.slice(-4)}` : '••••');
const VIEWS = [['current', 'Current'], ['soon', 'Renewing soon'], ['ended', 'Ended'], ['all', 'All']];
const COLS = [['name', 'Name'], ['category', 'Kind'], ['provider', 'Provider'], ['cost', 'Cost'], ['year', 'A year'], ['renewal', 'Renews'], ['status', 'Status']];

export default {
  async mount(el) {
    const state = this.state = { id: null, view: 'current', q: '', sort: 'renewal', dir: 1, reveal: false };
    let all = [];
    let atts = new Map();
    const gone = this.gone = new AbortController();
    el.innerHTML = '<div class="contracts"></div>';
    const root = el.querySelector('.contracts');
    const byId = id => all.find(c => c.id === id);

    // ---------- the list ----------

    function shown() {
      const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      const keep = c => (state.view === 'all' || (state.view === 'current' ? c.status === 'current' : state.view === 'ended' ? c.status !== 'current' : !!renewalSoon(c)))
        && words.every(w => `${c.name} ${c.provider} ${c.covers || ''} ${categoryLabel(c.category)} ${(c.custom_fields || []).map(f => `${f.label} ${f.value}`).join(' ')}`.toLowerCase().includes(w));
      const key = {
        name: c => (c.name || '').toLowerCase(), category: c => categoryLabel(c.category), provider: c => (c.provider || '').toLowerCase(),
        cost: c => Number(c.cost) || 0, year: c => perYear(c), renewal: c => c.renewal_date || c.end_date || '9999', status: c => c.status,
      }[state.sort];
      return all.filter(keep).sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * state.dir);
    }
    const renewCell = c => {
      const d = c.renewal_date || c.end_date;
      const soon = renewalSoon(c);
      return d ? `<span class="${soon ? `chip renew-${soon}` : ''}">${niceDate(d)}</span>` : '<span class="muted">–</span>';
    };

    function listHtml() {
      const rows = shown();
      const current = all.filter(c => c.status === 'current');
      const total = current.reduce((n, c) => n + perYear(c), 0);
      const byCat = CATEGORIES.map(([id, label]) => [label, current.filter(c => c.category === id).reduce((n, c) => n + perYear(c), 0)]).filter(([, n]) => n);
      const groups = CATEGORIES.map(([id, label]) => [label, rows.filter(c => c.category === id)]).filter(([, g]) => g.length);
      return `
        <div class="scans-head contracts-head">
          <button type="button" class="primary" data-act="new">+ New contract</button>
          <input type="search" class="scan-search contract-search" placeholder="Search contracts…" value="${esc(state.q)}" aria-label="Search contracts">
          ${shareHtml()}
          ${cogHtml('contracts')}
          <details class="tool-menu page-more">
            <summary class="icon-btn" aria-label="More actions">${icon('i-more')}</summary>
            <div class="menu"><a href="#/bin/archive/contracts">Show Archive</a><a href="#/bin/bin/contracts">Show Bin</a></div>
          </details>
        </div>
        <div class="segmented scan-kinds" role="tablist" aria-label="Which contracts">
          ${VIEWS.map(([id, label]) => `<button type="button" data-view="${id}" aria-pressed="${state.view === id}">${label}</button>`).join('')}
        </div>
        ${rows.length ? `
          <table class="contract-table">
            <thead><tr>${COLS.map(([id, label]) => `<th scope="col"><button type="button" class="th-sort" data-sort="${id}" aria-pressed="${state.sort === id}">${label}${state.sort === id ? (state.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}</tr></thead>
            <tbody>${rows.map(c => `
              <tr data-id="${c.id}" tabindex="0">
                <td class="c-name">${esc(c.name || 'Untitled')}</td><td>${esc(categoryLabel(c.category))}</td><td>${esc(c.provider || '')}</td>
                <td class="num">${costText(c)}</td><td class="num">${perYear(c) ? money(perYear(c)) : ''}</td><td>${renewCell(c)}</td>
                <td>${c.status === 'current' ? '' : `<span class="muted">${esc(STATUSES.find(s => s[0] === c.status)?.[1] || '')}</span>`}</td>
              </tr>`).join('')}</tbody>
          </table>
          <div class="contract-cards">${groups.map(([label, g]) => `
            <h3 class="milestone">${esc(label)}</h3>
            ${g.map(c => `<a class="contract-card${renewalSoon(c) ? ` renew-${renewalSoon(c)}` : ''}" href="#/contracts/${c.id}">
              <span class="c-name">${esc(c.name || 'Untitled')}</span>
              <span class="muted">${esc(c.provider || '')}${c.status !== 'current' ? ` · ${esc(STATUSES.find(s => s[0] === c.status)?.[1] || '')}` : ''}</span>
              <span class="c-line"><span>${costText(c)}</span>${renewCell(c)}</span>
            </a>`).join('')}`).join('')}
          </div>`
        : `<div class="empty"><h2>${all.length ? 'Nothing here.' : 'No contracts yet.'}</h2>${all.length ? '' : '<p class="muted">Insurance, utilities, broadband, subscriptions: what they cost, when they renew and how much notice they need.</p>'}</div>`}
        ${total ? `<p class="contract-total"><b>${money(total)} a year</b> <span class="muted">for everything current${byCat.length > 1 ? `: ${byCat.map(([l, n]) => `${esc(l)} ${money(n)}`).join(' · ')}` : ''}</span></p>` : ''}`;
    }

    // ---------- one contract ----------

    const field = (name, label, c, { type = 'text', placeholder = '', mode = '' } = {}) =>
      `<label>${label}<input type="${type}" name="${name}" value="${esc(c[name] ?? '')}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${mode ? ` inputmode="${mode}"` : ''} autocomplete="off"></label>`;
    const select = (name, label, options, value) => `<label>${label}<select name="${name}">${options.map(([v, t]) => `<option value="${v}"${v === value ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;

    async function pageHtml(c) {
      const earlier = [];
      for (let p = byId(c.previous_contract_id) || (c.previous_contract_id && await store.get('contracts', c.previous_contract_id)); p && earlier.length < 20; p = p.previous_contract_id && (byId(p.previous_contract_id) || await store.get('contracts', p.previous_contract_id))) earlier.push(p);
      const later = all.filter(x => x.previous_contract_id === c.id);
      const contact = c.contact_id && await store.get('contacts', c.contact_id);
      const scans = await store.list('scans', { filter: s => s.linked?.collection === 'contracts' && s.linked.id === c.id && !s.archived_at });
      const renews = c.renewal_date;
      return `
        <div class="project-head">
          <button type="button" class="back" data-act="home">‹ Contracts</button>
          <input class="project-name" name="name" value="${esc(c.name)}" aria-label="Name" placeholder="e.g. Home insurance">
        </div>
        <div class="scan-page contract-page" data-id="${c.id}">
          <div class="panel-sec"><span class="panel-h">Status</span>
            <div class="energy-pick" role="group" aria-label="Status">${STATUSES.map(([id, label]) => `<button type="button" data-status="${id}" aria-pressed="${c.status === id}">${label}</button>`).join('')}</div>
          </div>
          <div class="panel-sec"><span class="panel-h">Details</span>
            <div class="detail-grid">
              ${select('category', 'Kind', CATEGORIES, c.category)}
              ${field('provider', 'Provider', c, { placeholder: 'e.g. Aviva' })}
              <label>Reference<span class="ref-field">${state.reveal || !c.reference
                ? `<input type="text" name="reference" value="${esc(c.reference || '')}" autocomplete="off" placeholder="Policy or account number">`
                : `<button type="button" class="masked" data-act="reveal" title="Show the reference">${esc(masked(c.reference))}</button>`}${c.reference ? `<button type="button" class="icon-btn small" data-act="copy-ref" title="Copy">⧉</button>` : ''}</span></label>
              ${field('covers', 'Covers', c, { placeholder: 'What it covers' })}
              <label>Cost<span class="cost-field"><input type="text" name="cost" value="${c.cost ?? ''}" inputmode="decimal" placeholder="0.00" autocomplete="off"><select name="cost_frequency" aria-label="How often">${FREQUENCIES.map(([v, t]) => `<option value="${v}"${v === (c.cost_frequency || 'monthly') ? ' selected' : ''}>${t}</option>`).join('')}</select></span></label>
              ${field('payment_method_note', 'Paid by', c, { placeholder: 'e.g. Direct debit, Monzo' })}
              ${field('start_date', 'Started', c, { type: 'date' })}
              ${field('renewal_date', 'Renews', c, { type: 'date' })}
              ${field('end_date', 'Ends', c, { type: 'date' })}
              ${field('notice_days', 'Notice (days)', c, { mode: 'numeric', placeholder: '30' })}
              <label class="check-label"><input type="checkbox" name="auto_renew"${c.auto_renew ? ' checked' : ''}> Renews by itself</label>
            </div>
            ${perYear(c) && c.cost_frequency !== 'annual' ? `<p class="muted contract-year">${money(perYear(c))} a year</p>` : ''}
            ${renews ? `<div class="scan-reminder">${c.reminder_task_id
              ? '<span class="muted">A task reminds you before it renews.</span> <a class="linklike" href="#/tasks/list">Tasks</a>'
              : `<button type="button" class="linklike" data-act="remind">+ Remind me ${Number(c.notice_days) || 30} days before it renews</button>`}</div>` : ''}
          </div>
          <div class="panel-sec"><span class="panel-h">Provider</span>
            <div class="detail-grid">
              ${field('provider_phone', 'Phone', c, { type: 'tel', placeholder: 'e.g. 0345 000 000' })}
              ${field('provider_url', 'Website', c, { type: 'url', placeholder: 'https://…' })}
            </div>
            <div class="scan-filed">
              ${c.provider_phone ? `<a class="chip" href="${esc(telHref(c.provider_phone))}">📞 Call ${esc(c.provider_phone)}</a>` : ''}
              ${c.provider_url ? `<a class="chip" href="${esc(/^https?:/.test(c.provider_url) ? c.provider_url : `https://${c.provider_url}`)}" target="_blank" rel="noopener">↗ Website</a>` : ''}
              ${contact ? `<span class="chip filed-chip"><button type="button" class="linklike" data-act="open-contact">👤 ${esc(contact.name || 'Contact')}</button><button type="button" class="chip-x" data-act="unlink-contact" aria-label="Take it off">×</button></span>`
                : '<button type="button" class="linklike" data-act="pick-contact">Link a contact…</button>'}
            </div>
          </div>
          <div class="panel-sec"><span class="panel-h">More details</span>
            <ul class="detail-rows">${(c.custom_fields || []).map((f, n) => `
              <li data-field="${n}"><input name="cf-label" value="${esc(f.label)}" class="d-label" aria-label="Label" placeholder="Label"><input name="cf-value" value="${esc(f.value)}" aria-label="Value" placeholder="Value">
                <button type="button" class="icon-btn small" data-act="del-field" aria-label="Remove">×</button></li>`).join('')}
            </ul>
            <button type="button" class="linklike" data-act="add-field">+ Add a detail (e.g. Excess, Account holder)</button>
          </div>
          <div class="panel-sec"><span class="panel-h">Files</span>
            ${att.rowHtml(atts.get(c.id) || [])}
            ${scans.length ? `<div class="scan-filed">${scans.map(s => `<a class="chip" href="#/scans/${s.id}">🧾 ${esc(s.title)}</a>`).join('')}</div>` : ''}
          </div>
          <div class="panel-sec"><span class="panel-h">Note</span><div class="contract-note"></div></div>
          ${earlier.length || later.length ? `<div class="panel-sec"><span class="panel-h">History</span><ul class="links">
            ${later.map(x => `<li><a href="#/contracts/${x.id}">Renewed as: ${esc(x.name || 'Untitled')}${x.start_date ? `, from ${niceDate(x.start_date)}` : ''}</a></li>`).join('')}
            ${earlier.map(x => `<li><a href="#/contracts/${x.id}">Before: ${esc(x.name || 'Untitled')}${x.provider ? ` (${esc(x.provider)})` : ''}${x.start_date ? `, from ${niceDate(x.start_date)}` : ''}</a></li>`).join('')}
          </ul></div>` : ''}
          <div class="detail-actions scan-actions">
            ${c.status === 'current' ? '<button type="button" data-act="renew" title="The same again from its renewal date: this one ends, a new one starts">Renew or switch…</button>' : ''}
            <span class="spacer"></span>
            <button type="button" data-act="archive">Archive</button>
            <button type="button" class="danger" data-act="delete">Delete</button>
          </div>
        </div>`;
    }

    const render = this.render = this.refresh = async () => {
      all = await store.list('contracts', { filter: c => !c.archived_at });
      atts = await att.byParent();
      const c = state.id && byId(state.id);
      if (state.id && !c) { state.id = null; if (location.hash !== '#/contracts') location.hash = '#/contracts'; }
      // Leave the page alone while something on it is being typed in (a sync may call this).
      if (c && root.querySelector('.contract-page')?.contains(document.activeElement) && document.activeElement.matches('input, textarea, [contenteditable]')) return;
      root.innerHTML = c ? await pageHtml(c) : listHtml();
      if (c) {
        let notePend = null;
        const noteAuto = debounced(async () => { const md = notePend; notePend = null; if (md !== null) await store.update('contracts', c.id, { notes: md }); }, 600);
        const box = root.querySelector('.contract-note');
        richText(box, {
          value: c.notes || '',
          placeholder: 'Anything to remember: what the excess is, who you spoke to…',
          origin: () => ({ collection: 'contracts', id: c.id, title: c.name, field: 'notes' }),
          onChange: md => { notePend = md; noteAuto.trigger(); },
        });
        box.addEventListener('focusout', ev => { if (!box.contains(ev.relatedTarget)) noteAuto.flush(); });
      }
    };
    this.route = rest => { state.id = rest[0] || null; state.reveal = false; render(); };

    // Files dropped anywhere on a contract's page go into its Files.
    att.enableDrop(root, '.contract-page', node => ({ collection: 'contracts', id: node.dataset.id }), () => render());
    root.addEventListener('dragover', () => { root.dataset.dropHint = state.id ? "Drop to add to this contract's files" : 'Open a contract to add files to it'; });

    // ---------- changes ----------

    async function change(id, fields, label = 'Saved') {
      const before = await store.get('contracts', id);
      const old = Object.fromEntries(Object.keys(fields).map(k => [k, before[k] ?? null]));
      await store.update('contracts', id, fields);
      await render();
      undoable(label, async () => { await store.update('contracts', id, old); await render(); });
    }

    root.addEventListener('input', ev => {
      if (!ev.target.matches('.contract-search')) return;
      state.q = ev.target.value;
      const at = ev.target.selectionStart;
      render().then(() => { const q = root.querySelector('.contract-search'); q?.focus(); q?.setSelectionRange(at, at); });
    });
    root.addEventListener('change', ev => {
      const f = ev.target;
      const c = state.id && byId(state.id);
      if (!c || !f.name || f.matches('.contract-search')) return;
      if (f.name === 'cf-label' || f.name === 'cf-value') {
        const n = Number(f.closest('[data-field]').dataset.field);
        const list = (c.custom_fields || []).map((x, i) => (i === n ? { ...x, [f.name === 'cf-label' ? 'label' : 'value']: f.value.trim() } : x));
        return change(c.id, { custom_fields: list });
      }
      let v = f.type === 'checkbox' ? f.checked : f.type === 'date' ? f.value || null : f.value.trim();
      if (f.name === 'cost') {
        if (v === '') v = null;
        else { v = Number(String(v).replace(/[£,\s]/g, '')); if (!Number.isFinite(v)) { toast('Type the cost as a number, e.g. 12.50'); f.value = c.cost ?? ''; return; } }
      }
      if (f.name === 'notice_days') v = v === '' ? null : Math.max(0, Math.round(Number(v)) || 0);
      if (f.name === 'name' && !v && c.name) { f.value = c.name; return; }
      const norm = x => (x === '' || x === undefined ? null : x);
      if (norm(c[f.name]) === norm(v)) return;
      change(c.id, { [f.name]: v });
    });
    // The reference goes back behind dots when you leave it.
    root.addEventListener('focusout', ev => { if (ev.target.name === 'reference' && state.reveal) setTimeout(() => { if (!root.querySelector('input[name="reference"]')?.matches(':focus')) { state.reveal = false; render(); } }, 200); });

    root.addEventListener('click', async ev => {
      if (att.onClick(ev, () => (state.id ? { collection: 'contracts', id: state.id } : null), () => render())) return;
      const row = ev.target.closest('tr[data-id]');
      if (row) { location.hash = `#/contracts/${row.dataset.id}`; return; }
      const sort = ev.target.closest('[data-sort]');
      if (sort) { state.dir = state.sort === sort.dataset.sort ? -state.dir : 1; state.sort = sort.dataset.sort; render(); return; }
      const view = ev.target.closest('[data-view]');
      if (view) { state.view = view.dataset.view; render(); return; }
      const c = state.id && byId(state.id);
      const st = ev.target.closest('[data-status]');
      if (st && c) { if (st.dataset.status !== c.status) change(c.id, { status: st.dataset.status }, STATUSES.find(s => s[0] === st.dataset.status)[1]); return; }
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'new') {
        const made = await newContract();
        location.hash = `#/contracts/${made.id}`;
        undoable('New contract', async () => { await store.remove('contracts', made.id); location.hash = '#/contracts'; });
        setTimeout(() => root.querySelector('.project-name')?.focus(), 300);
        return;
      }
      if (act === 'home') { location.hash = '#/contracts'; return; }
      if (!c) return;
      if (act === 'reveal') { state.reveal = true; await render(); root.querySelector('input[name="reference"]')?.focus(); return; }
      if (act === 'copy-ref') { try { await navigator.clipboard.writeText(c.reference); toast('Reference copied'); } catch { toast("Couldn't copy"); } return; }
      if (act === 'add-field') return change(c.id, { custom_fields: [...(c.custom_fields || []), { label: '', value: '' }] }, 'Detail added');
      if (act === 'del-field') { const n = Number(b.closest('[data-field]').dataset.field); return change(c.id, { custom_fields: (c.custom_fields || []).filter((_, i) => i !== n) }, 'Detail removed'); }
      if (act === 'open-contact') return openRef(`contacts/${c.contact_id}`);
      if (act === 'unlink-contact') return change(c.id, { contact_id: null }, 'Contact taken off');
      if (act === 'pick-contact') {
        const r = b.getBoundingClientRect();
        return openPicker({
          host: root.querySelector('.contract-page'), at: { left: r.left, bottom: r.bottom }, kind: 'contact',
          onPick: list => change(c.id, { contact_id: list[0].id }, `Linked ${list[0].title}`),
          onNewContact: async name => {
            const { createContact } = await import('../contacts.js');
            const made = await createContact({ name, details: c.provider_phone ? [{ label: 'Phone', value: c.provider_phone }] : [] });
            change(c.id, { contact_id: made.id }, `Linked ${name}`);
          },
          onClose: () => {},
        });
      }
      if (act === 'remind') {
        const aim = [daysBefore(c.renewal_date, Number(c.notice_days) || 30), isoDate()].sort().at(-1);
        const task = await addTask({ title: `Before it renews: ${c.name || c.provider || 'contract'}`, horizon: 'later', aim_at: aim, source_contract_id: c.id, contact_ids: c.contact_id ? [c.contact_id] : [] });
        return change(c.id, { reminder_task_id: task.id }, `Task added: Target end date ${niceDate(aim)}`);
      }
      if (act === 'renew') {
        const made = await renew(c);
        location.hash = `#/contracts/${made.id}`;
        undoable('Renewed: the old one has ended', async () => {
          await store.remove('contracts', made.id);
          await store.update('contracts', c.id, { status: c.status, end_date: c.end_date ?? null });
          location.hash = `#/contracts/${c.id}`;
        });
        return;
      }
      if (act === 'archive' || act === 'delete') {
        const f = act === 'archive' ? 'archived_at' : 'deleted_at';
        await store.update('contracts', c.id, { [f]: new Date().toISOString() });
        location.hash = '#/contracts';
        undoable(act === 'archive' ? 'Archived' : 'Deleted', async () => { await store.update('contracts', c.id, { [f]: null }); await render(); });
      }
    }, { signal: gone.signal });
    root.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.matches('tr[data-id]')) location.hash = `#/contracts/${ev.target.dataset.id}`; });

    await render();
  },

  unmount() {
    this.gone?.abort();
  },
};

// Scans: #/scans (every scan, newest first) and #/scans/<id> (one scan).
// Scan takes a photo on a phone (or picks files on a laptop) and saves it at
// once as "Receipt 26 Sep 14:32"; the scan then opens so its kind, dates and
// note can be filled in, or not. Photos and PDFs dropped on the page become
// scans too (on a scan's page, more pages of it). IDs (passport, licence) are
// shown blurred until you tap them, for anyone looking over your shoulder.

import * as store from '../store.js';
import { cogHtml } from '../viewcog.js';
import { shareHtml } from '../share.js';
import { KINDS, kindLabel, newScan, addPages, pagesByScan, expirySoon } from '../scans.js';
import * as att from '../attachments.js';
import { richText } from '../richtext.js';
import { debounced } from '../autosave.js';
import { toast, undoable } from '../toast.js';
import { openPicker } from '../linkpicker.js';
import { KINDS as REF_KINDS, openRef } from '../refs.js';
import { addTask } from '../tasks.js';
import { isoDate, dateText } from '../days.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const niceDate = iso => (iso ? dateText(new Date(`${iso.slice(0, 10)}T12:00`), { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const DOC = '<svg class="scan-doc" viewBox="0 0 48 48" aria-hidden="true"><path d="M12 4h17l9 9v31H12z"/><path d="M29 4v9h9"/><path d="M18 22h14M18 28h14M18 34h9"/></svg>';
const COARSE = matchMedia('(pointer: coarse)').matches;

// Three months before a date (the day a reminder task is aimed at).
const monthsBefore = (iso, n) => { const d = new Date(`${iso}T12:00`); d.setMonth(d.getMonth() - n); return isoDate(d); };

export default {
  async mount(el) {
    const state = this.state = { id: null, kind: 'all', q: '' };
    let scans = [];
    let pages = new Map();
    let noteEditor = null;
    const revealed = new Set(); // ID scans shown unblurred on this visit
    const gone = this.gone = new AbortController();

    el.innerHTML = '<div class="scans"></div><input type="file" class="scan-input" hidden multiple>';
    const root = el.querySelector('.scans');
    const input = el.querySelector('.scan-input');
    input.accept = 'image/*,application/pdf';
    const scanOf = id => scans.find(s => s.id === id);

    // ---------- the list ----------

    function card(s) {
      const p = pages.get(s.id) || [];
      const first = p[0];
      const soon = expirySoon(s);
      const thumb = first?.thumb ? `<img src="${first.thumb}" alt="" loading="lazy">` : DOC;
      return `
        <a class="scan-card${s.kind === 'id' ? ' is-id' : ''}" href="#/scans/${s.id}" data-id="${s.id}">
          <span class="scan-thumb">${thumb}${p.length > 1 ? `<span class="scan-count">${p.length} pages</span>` : ''}</span>
          <span class="scan-title">${esc(s.title || 'Untitled')}</span>
          <span class="scan-meta"><span class="chip">${esc(kindLabel(s.kind))}</span><span class="muted">${niceDate(s.letter_date || s.created_at)}</span>${s.expiry_date ? `<span class="chip${soon ? ` expiry-${soon}` : ''}" title="Expiry date">${soon === 'past' ? 'expired' : 'expires'} ${niceDate(s.expiry_date)}</span>` : ''}</span>
        </a>`;
    }

    function listHtml() {
      const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      const shown = scans.filter(s => (state.kind === 'all' || s.kind === state.kind)
        && words.every(w => `${s.title} ${s.summary || ''} ${s.note || ''} ${kindLabel(s.kind)} ${s.linked?.title || ''}`.toLowerCase().includes(w)));
      return `
        <div class="scans-head">
          <button type="button" class="primary scan-btn" data-act="scan">${icon('i-scans')}<span>Scan</span></button>
          <input type="search" class="scan-search" placeholder="Search scans…" value="${esc(state.q)}" aria-label="Search scans">
          ${shareHtml()}
          ${cogHtml('scans')}
          <details class="tool-menu page-more">
            <summary class="icon-btn" aria-label="More actions">${icon('i-more')}</summary>
            <div class="menu"><button type="button" data-act="files">Add from files…</button><a href="#/bin/archive/scans">Show Archive</a><a href="#/bin/bin/scans">Show Bin</a></div>
          </details>
        </div>
        <div class="segmented scan-kinds" role="tablist" aria-label="Kinds">
          <button type="button" data-kind="all" aria-pressed="${state.kind === 'all'}">All</button>
          ${KINDS.map(k => `<button type="button" data-kind="${k.id}" aria-pressed="${state.kind === k.id}">${k.plural}</button>`).join('')}
        </div>
        <p class="muted hint">${COARSE ? 'Scan takes a photo; it is saved straight away.' : 'Scan picks photos or PDFs, or drop them anywhere on this page. Each is saved straight away.'}</p>
        <div class="scan-grid">${shown.map(card).join('') || `<div class="empty"><h2>${scans.length ? 'Nothing matches.' : 'No scans yet.'}</h2>${scans.length ? '' : '<p class="muted">Receipts, warranties, letters and IDs, kept on this device (and your server, if you sync).</p>'}</div>`}</div>`;
    }

    // ---------- one scan ----------

    function pageHtml(s) {
      const p = pages.get(s.id) || [];
      const letter = s.kind === 'letter';
      const linked = s.linked && REF_KINDS[s.linked.collection];
      const reminder = s.reminder_task_id;
      return `
        <div class="project-head">
          <button type="button" class="back" data-act="home">‹ Scans</button>
          <input class="project-name" name="title" value="${esc(s.title)}" aria-label="Title" placeholder="Title">
        </div>
        <div class="scan-page" data-id="${s.id}">
          <div class="panel-sec"><span class="panel-h">Kind</span>
            <div class="energy-pick scan-kind-pick" role="group" aria-label="Kind">${KINDS.map(k => `<button type="button" data-set-kind="${k.id}" aria-pressed="${s.kind === k.id}">${k.label}</button>`).join('')}</div>
          </div>
          <div class="panel-sec scan-pages${s.kind === 'id' && !revealed.has(s.id) ? ' is-id' : ''}"><span class="panel-h">Pages${s.kind === 'id' ? (revealed.has(s.id) ? '' : ' <button type="button" class="linklike" data-act="reveal">Show</button>') : ''}</span>
            ${att.rowHtml(p, { addButton: false }).replace('</div>', `<button type="button" class="att-add" data-act="add-page">${icon('i-plus')}<span>Page</span></button></div>`)}
          </div>
          <div class="panel-sec"><span class="panel-h">Details</span>
            <div class="detail-grid">
              ${letter ? `<label>Letter date<input type="date" name="letter_date" value="${s.letter_date || ''}"></label>` : ''}
              <label>Expiry date<input type="date" name="expiry_date" value="${s.expiry_date || ''}"></label>
            </div>
            ${letter ? `<label class="scan-summary">What it says<textarea name="summary" rows="2" placeholder="In a line or two">${esc(s.summary || '')}</textarea></label>` : ''}
            <div class="scan-filed"><span class="field-label">Filed with</span>
              ${linked ? `<span class="chip filed-chip"><button type="button" class="linklike" data-act="open-linked">${linked.icon} ${esc(s.linked.title || linked.label)}</button><button type="button" class="chip-x" data-act="unlink" aria-label="Take it off">×</button></span>`
                : '<button type="button" class="linklike" data-act="file-with">File with a contact, case, task…</button>'}
            </div>
            ${s.expiry_date ? `<div class="scan-reminder">${reminder
              ? `<span class="muted">A task reminds you before it expires.</span> <a class="linklike" href="#/tasks/list">Tasks</a>`
              : '<button type="button" class="linklike" data-act="remind">+ Remind me 3 months before it expires</button>'}</div>` : ''}
          </div>
          <div class="panel-sec"><span class="panel-h">Note</span><div class="scan-note"></div></div>
          <div class="detail-actions scan-actions">
            <span class="muted">Added ${niceDate(s.created_at)}</span>
            <span class="spacer"></span>
            ${s.linked?.collection === 'contracts' ? '' : '<button type="button" data-act="make-contract" title="Start a contract from this scan (it\'s filed with it)">→ Contract</button>'}
            <button type="button" data-act="archive">Archive</button>
            <button type="button" class="danger" data-act="delete">Delete</button>
          </div>
        </div>`;
    }

    const render = this.render = this.refresh = async () => {
      scans = (await store.list('scans', { filter: s => !s.archived_at })).sort((a, b) => b.created_at.localeCompare(a.created_at));
      pages = await pagesByScan();
      const s = state.id && scanOf(state.id);
      if (state.id && !s) { state.id = null; if (location.hash !== '#/scans') location.hash = '#/scans'; }
      // Keep the note being written (a sync may redraw the page).
      if (s && noteEditor && root.querySelector('.scan-note')?.contains(document.activeElement)) return;
      noteEditor = null;
      root.innerHTML = s ? pageHtml(s) : listHtml();
      if (s) {
        let notePend = null;
        const noteAuto = debounced(async () => { const md = notePend; notePend = null; if (md !== null) await store.update('scans', s.id, { note: md }); }, 600);
        noteEditor = richText(root.querySelector('.scan-note'), {
          value: s.note || '',
          placeholder: 'Anything to remember about it…',
          origin: () => ({ collection: 'scans', id: s.id, title: s.title, field: 'note' }),
          onChange: md => { notePend = md; noteAuto.trigger(); },
        });
        const box = root.querySelector('.scan-note');
        box.addEventListener('focusout', ev => { if (!box.contains(ev.relatedTarget)) noteAuto.flush(); });
      }
    };

    this.route = rest => {
      state.id = rest[0] || null;
      render();
    };

    // ---------- adding ----------

    let pickFor = null; // a scan getting another page, or null for new scans
    function pick(forScan = null, camera = COARSE) {
      pickFor = forScan;
      input.multiple = !camera;
      if (camera) input.setAttribute('capture', 'environment'); else input.removeAttribute('capture');
      input.value = '';
      input.click();
    }
    async function take(files) {
      if (!files.length) return;
      if (pickFor) {
        const made = await addPages(pickFor, files);
        await render();
        if (made.length) undoable(`Added ${made.length === 1 ? 'a page' : `${made.length} pages`}`, async () => { for (const m of made) await store.remove('attachments', m.id); await render(); });
        return;
      }
      const made = [];
      for (const f of files) { const s = await newScan([f]); if (s) made.push(s); }
      if (!made.length) return;
      undoable(made.length === 1 ? `Saved: ${made[0].title}` : `Saved ${made.length} scans`, async () => { for (const s of made) await store.remove('scans', s.id); location.hash = '#/scans'; await render(); });
      if (made.length === 1) location.hash = `#/scans/${made[0].id}`;
      else await render();
    }
    input.addEventListener('change', () => take([...input.files]));

    // Files dropped anywhere on the page (el is shared by every area: these go when Scans is left).
    const hasFiles = ev => [...(ev.dataTransfer?.types || [])].includes('Files');
    const signal = gone.signal;
    signal.addEventListener('abort', () => delete el.dataset.dropHint);
    el.addEventListener('dragover', ev => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      root.classList.add('drop-over');
      el.dataset.dropHint = state.id ? 'Drop to add pages to this scan' : 'Drop to save each file as a new scan';
    }, { signal });
    el.addEventListener('dragleave', ev => { if (!el.contains(ev.relatedTarget)) root.classList.remove('drop-over'); }, { signal });
    el.addEventListener('drop', ev => {
      root.classList.remove('drop-over');
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      pickFor = state.id ? scanOf(state.id) : null;
      take([...ev.dataTransfer.files]);
    }, { signal });

    // ---------- changes ----------

    async function change(id, fields, label = 'Saved') {
      const before = await store.get('scans', id);
      const old = Object.fromEntries(Object.keys(fields).map(k => [k, before[k] ?? null]));
      await store.update('scans', id, fields);
      await render();
      undoable(label, async () => { await store.update('scans', id, old); await render(); });
    }

    root.addEventListener('input', ev => {
      if (!ev.target.matches('.scan-search')) return;
      state.q = ev.target.value;
      const at = ev.target.selectionStart;
      render().then(() => { const q = root.querySelector('.scan-search'); q?.focus(); q?.setSelectionRange(at, at); });
    });
    root.addEventListener('change', ev => {
      const f = ev.target;
      const s = state.id && scanOf(state.id);
      if (!s || !f.name || f.matches('.scan-search')) return;
      const v = f.type === 'date' ? f.value || null : f.value.trim();
      if (f.name === 'title' && !v) { f.value = s.title; return; }
      if ((s[f.name] ?? (f.type === 'date' ? null : '')) === v) return;
      change(s.id, { [f.name]: v }, f.name === 'expiry_date' ? (v ? `Expires ${niceDate(v)}` : 'Expiry date removed') : 'Saved');
    });

    root.addEventListener('click', async ev => {
      // A blurred ID: the first tap shows it, rather than opening it.
      if (ev.target.closest('.scan-pages.is-id [data-att-open]')) { ev.preventDefault(); ev.stopPropagation(); revealed.add(state.id); render(); return; }
      if (att.onClick(ev, () => (state.id ? { collection: 'scans', id: state.id } : null), () => render())) return;
      const kindBtn = ev.target.closest('[data-kind]');
      if (kindBtn) { state.kind = kindBtn.dataset.kind; render(); return; }
      const setKind = ev.target.closest('[data-set-kind]');
      const s = state.id && scanOf(state.id);
      if (setKind && s) {
        const k = setKind.dataset.setKind;
        if (k === s.kind) return;
        // A title still as it was made ("Receipt 26 Sep 14:32") follows the kind.
        const was = `${kindLabel(s.kind)} `;
        const title = s.title.startsWith(was) && /\d{2}:\d{2}$/.test(s.title) ? `${kindLabel(k)} ${s.title.slice(was.length)}` : s.title;
        return change(s.id, { kind: k, title }, `Now: ${kindLabel(k)}`);
      }
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'scan') return pick();
      if (act === 'files') { b.closest('details')?.removeAttribute('open'); return pick(null, false); }
      if (act === 'home') { location.hash = '#/scans'; return; }
      if (!s) return;
      if (act === 'add-page') return pick(s);
      if (act === 'reveal') { revealed.add(s.id); return render(); }
      if (act === 'open-linked') return openRef(`${s.linked.collection}/${s.linked.id}`);
      if (act === 'unlink') return change(s.id, { linked: null }, 'Taken off');
      if (act === 'file-with') {
        const r = b.getBoundingClientRect();
        return openPicker({
          host: root.querySelector('.scan-page'), at: { left: r.left, bottom: r.bottom }, kind: 'note', exclude: `scans/${s.id}`,
          onPick: list => { const t = list[0]; change(s.id, { linked: { collection: t.collection, id: t.id, title: t.title } }, `Filed with ${t.title}`); },
          onNewContact: async name => {
            const { createContact } = await import('../contacts.js');
            const made = await createContact({ name });
            change(s.id, { linked: { collection: 'contacts', id: made.id, title: name } }, `Filed with ${name}`);
          },
          onClose: () => {},
        });
      }
      if (act === 'make-contract') {
        const { newContract } = await import('../contracts.js');
        const kind = { warranty: 'warranty', letter: 'other', receipt: 'other', id: 'other' }[s.kind] || 'other';
        const made = await newContract({ name: s.title, category: kind, renewal_date: s.expiry_date || null });
        await store.update('scans', s.id, { linked: { collection: 'contracts', id: made.id, title: s.title } });
        location.hash = `#/contracts/${made.id}`;
        undoable('Contract started', async () => { await store.remove('contracts', made.id); await store.update('scans', s.id, { linked: s.linked || null }); });
        return;
      }
      if (act === 'remind') {
        const aim = [monthsBefore(s.expiry_date, 3), isoDate()].sort().at(-1);
        const task = await addTask({ title: `Before it expires: ${s.title}`, horizon: 'later', aim_at: aim, source_scan_id: s.id });
        await change(s.id, { reminder_task_id: task.id }, `Task added: Target end date ${niceDate(aim)}`);
        return;
      }
      if (act === 'archive' || act === 'delete') {
        const field = act === 'archive' ? 'archived_at' : 'deleted_at';
        await store.update('scans', s.id, { [field]: new Date().toISOString() });
        location.hash = '#/scans';
        undoable(act === 'archive' ? 'Archived' : 'Deleted', async () => { await store.update('scans', s.id, { [field]: null }); await render(); });
      }
    }, { signal: gone.signal });

    await render();
  },

  unmount() {
    this.gone?.abort();
  },
};

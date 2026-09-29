// Pick a task: a sheet with a search box at the top and the open tasks grouped
// by list (Task Dump, Now, Next, Later), in the same order as on the Tasks
// page, sub-tasks under their task. Typing filters; ↑ ↓ and Enter pick; Cancel,
// Esc or tapping outside closes it without picking.
//
//   const task = await pickTask({ title: 'Add as comment to…', hint })   → task | null

import { loadAll, nest, HORIZONS, horizonOf, isDone } from './tasks.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ORDER = ['inbox', 'now', 'next', 'later'];

export async function pickTask({ title = 'Pick a task', hint = '' } = {}) {
  const { tasks } = await loadAll();
  const open = tasks.filter(t => !isDone(t));
  const top = t => { let p = t; for (let n = 0; p?.parent_task_id && n < 10; n++) p = open.find(x => x.id === p.parent_task_id) || null; return p || t; };
  const groups = ORDER.map(h => ({
    h,
    label: HORIZONS.find(x => x.id === h)?.label || h,
    rows: nest(open.filter(t => horizonOf(top(t)) === h)),
  })).filter(g => g.rows.length);

  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet task-picker';
    dlg.innerHTML = `
      <div class="sheet-handle"></div>
      <h2>${esc(title)}</h2>
      ${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
      <input type="search" class="search tp-q no-inline" placeholder="Search tasks…" autocomplete="off" aria-label="Search tasks">
      <div class="tp-list" role="listbox"></div>
      <div class="sheet-actions"><span class="spacer"></span><button type="button" data-tp="cancel">Cancel</button></div>`;
    document.body.append(dlg);
    const q = dlg.querySelector('.tp-q');
    const list = dlg.querySelector('.tp-list');
    let answer = null;
    let at = 0;

    const draw = () => {
      const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      const hit = t => words.every(w => `${t.title} ${t.notes || ''}`.toLowerCase().includes(w));
      const html = groups.map(g => {
        const rows = words.length ? g.rows.filter(hit) : g.rows;
        if (!rows.length) return '';
        return `<div class="tp-group">${esc(g.label)}</div>${rows.map(t => `<button type="button" class="tp-row" role="option" data-id="${t.id}" style="--d:${words.length ? 0 : t.depth || 0}">${t.depth && !words.length ? '<span class="tp-sub" aria-hidden="true">↳</span>' : ''}${esc(t.title)}</button>`).join('')}`;
      }).join('');
      list.innerHTML = html || `<p class="muted tp-none">${open.length ? 'No tasks match.' : 'No open tasks.'}</p>`;
      at = 0;
      mark();
    };
    const rows = () => [...list.querySelectorAll('.tp-row')];
    const mark = () => rows().forEach((r, n) => { r.classList.toggle('on', n === at); r.setAttribute('aria-selected', n === at); if (n === at) r.scrollIntoView({ block: 'nearest' }); });
    const pick = id => { answer = open.find(t => t.id === id) || null; dlg.close(); };

    q.addEventListener('input', draw);
    q.addEventListener('keydown', ev => {
      const r = rows();
      if (ev.key === 'ArrowDown') { ev.preventDefault(); at = Math.min(r.length - 1, at + 1); mark(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); at = Math.max(0, at - 1); mark(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); if (r[at]) pick(r[at].dataset.id); }
    });
    list.addEventListener('click', ev => { const b = ev.target.closest('.tp-row'); if (b) pick(b.dataset.id); });
    dlg.querySelector('[data-tp="cancel"]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { dlg.remove(); resolve(answer); });
    draw();
    dlg.showModal();
    if (matchMedia('(hover: hover)').matches) q.focus();
  });
}

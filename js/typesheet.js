// Brain Dump types: the sheet to add, rename, drag to reorder and remove them
// (Settings → Your words, and the ⋯ at the end of the Brain Dump's type
// filters), and adding one straight from the New note's "+ New" pill.
// Types are labels for filtering only.
//
//   openTypesSheet(changed)   changed() runs after every change (to redraw the page)
//   addType(label) → { id, label }

import { sortable } from './sortable.js';
import { toast } from './toast.js';
import { word, dumpTypes, setDumpTypes, DEFAULT_TYPES, applyWords } from './words.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;

const idFor = (label, list) => {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'type';
  return list.some(t => t.id === slug) ? `${slug}_${Math.random().toString(36).slice(2, 6)}` : slug;
};

export async function addType(label) {
  await applyWords();
  const list = dumpTypes().map(t => ({ ...t }));
  const made = { id: idFor(label, list), label };
  list.push(made);
  await setDumpTypes(list);
  return made;
}

export async function openTypesSheet(changed) {
  await applyWords();
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet words-sheet';
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  let list = dumpTypes().map(t => ({ ...t }));
  const save = async () => { await setDumpTypes(list); draw(); changed?.(); };
  const draw = () => {
    dlg.innerHTML = `<div class="sheet-handle"></div><h2>Brain Dump types</h2>
      <p class="muted">${esc(word('ph_set_types'))}</p>
      <ul class="types-list">${list.map((t, n) => `
        <li data-n="${n}">
          <button type="button" class="drag-handle" aria-label="Move ${esc(t.label)}">${icon('i-grip')}</button>
          <input data-type-label value="${esc(t.label)}" aria-label="Type name" autocomplete="off">
          <button type="button" class="icon-btn small" data-type="remove" ${list.length > 1 ? '' : 'disabled'} aria-label="Remove">×</button>
        </li>`).join('')}
      </ul>
      <form class="types-add"><input name="new" placeholder="${esc(word('ph_set_new_type'))}" autocomplete="off"><button type="submit">Add</button></form>
      <div class="backup-row"><button type="button" data-type="defaults">Put back the defaults</button></div>`;
    // Drag a type by its grip (or focus the grip and use the arrow keys).
    sortable(dlg.querySelector('.types-list'), {
      async onEnd({ item }) {
        const moved = list[Number(item.dataset.n)].id;
        list = [...dlg.querySelectorAll('.types-list > li')].map(li => list[Number(li.dataset.n)]);
        await save();
        dlg.querySelector(`.types-list > li:nth-child(${list.findIndex(t => t.id === moved) + 1}) .drag-handle`)?.focus();
      },
    });
  };
  draw();
  dlg.addEventListener('change', async e => {
    if (!e.target.matches('[data-type-label]')) return;
    const n = Number(e.target.closest('li').dataset.n);
    const label = e.target.value.trim();
    if (!label) { e.target.value = list[n].label; return; }
    list[n].label = label;
    await save();
    toast('✓ Saved');
  });
  dlg.addEventListener('click', async e => {
    const act = e.target.closest('[data-type]')?.dataset.type;
    if (!act) return;
    if (act === 'defaults') { list = DEFAULT_TYPES.map(t => ({ ...t })); await save(); toast('✓ Back to the defaults'); return; }
    const n = Number(e.target.closest('li').dataset.n);
    if (act === 'remove' && list.length > 1) list.splice(n, 1);
    await save();
  });
  dlg.addEventListener('submit', async e => {
    e.preventDefault();
    const label = e.target.elements.new.value.trim();
    if (!label) return;
    list.push({ id: idFor(label, list), label });
    await save();
    dlg.querySelector('.types-add input')?.focus();
  });
  dlg.showModal();
}

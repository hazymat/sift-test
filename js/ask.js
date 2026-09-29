// The app's own questions, instead of the browser's prompt() and confirm()
// boxes: a sheet in the app's look (it closes like every sheet, js/sheets.js).
//
//   await ask({ title, text, fields: [{ name, label, type, value, placeholder }], ok, danger })
//        → { name: value, … } when OK is pressed (or Enter), null when closed
//   await askText(title, { value, placeholder, label, ok, type, text }) → string | null
//   await askYes(title, { text, ok, danger }) → true | false

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function ask({ title, text = '', fields = [], ok = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet ask-sheet';
    dlg.innerHTML = `
      <div class="sheet-handle"></div>
      <form method="dialog">
        <h2>${esc(title)}</h2>
        ${text ? text.split('\n\n').map(p => `<p class="muted">${esc(p)}</p>`).join('') : ''}
        ${fields.map(f => `<label class="ask-field">${f.label ? `<span>${esc(f.label)}</span>` : ''}<input name="${esc(f.name)}" type="${esc(f.type || 'text')}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="${f.type === 'password' ? 'new-password' : 'off'}"${f.type === 'password' ? '' : ' autocapitalize="sentences"'}></label>`).join('')}
        <div class="sheet-actions">
          <button type="button" data-ask="cancel">${esc(cancel)}</button>
          <span class="spacer"></span>
          <button type="submit" class="${danger ? 'danger' : 'primary'}" value="ok">${esc(ok)}</button>
        </div>
      </form>`;
    document.body.append(dlg);
    let answer = null;
    const form = dlg.querySelector('form');
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      answer = Object.fromEntries(fields.map(f => [f.name, form.elements[f.name].value]));
      dlg.close();
    });
    dlg.querySelector('[data-ask="cancel"]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { dlg.remove(); resolve(answer); });
    dlg.showModal();
    (dlg.querySelector('input') || dlg.querySelector('[type="submit"]')).focus();
  });
}

export async function askText(title, { value = '', placeholder = '', label = '', ok = 'Save', type = 'text', text = '' } = {}) {
  const r = await ask({ title, text, ok, fields: [{ name: 'v', value, placeholder, label, type }] });
  return r ? r.v : null;
}

export async function askYes(title, { text = '', ok = 'Yes', cancel = 'Cancel', danger = false } = {}) {
  return !!(await ask({ title, text, ok, cancel, danger }));
}

// All the text of a note (or an item's name) was removed, e.g. select all and
// cut, then you left it. Rather than quietly keeping the old text, ask:
// true → delete it (the caller offers Undo), false → leave it as it was.
export function askEmptied(what = 'note') {
  return askYes(`Did you mean to save an empty ${what}?`, {
    text: `Yes: delete the ${what}.\n\nNo: leave the ${what} as it was.`,
    ok: `Yes, delete it`, cancel: 'No, keep it', danger: true,
  });
}

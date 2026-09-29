import { labelHistory } from './store.js';
import { keyEls } from './keys.js';

// Brief message pill above the tab bar.
//   toast('✓ Saved')
//   toast('Removed "Jumpers"', { action: 'Undo', onAction: () => … })
//   toast(…, { action, onAction, more: { label, onAction } })   a second button
// With an action it stays a little longer (like "Undo send") and the button
// runs once, then the toast goes. An Undo button also answers Ctrl+Z (⌘Z)
// while it shows, until something is typed after it: then Ctrl+Z is the
// field's own undo again (the last thing done is the one undone).

let el = null;
let timer = null;
let undoNow = null; // the showing toast's Undo, for Ctrl+Z
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

addEventListener('keydown', ev => {
  if (!undoNow || ev.key.toLowerCase() !== 'z' || !(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey) return;
  ev.preventDefault();
  ev.stopImmediatePropagation(); // not also the note's own undo
  undoNow();
}, true);
addEventListener('beforeinput', () => {
  if (!undoNow) return;
  undoNow = null;
  el?.querySelectorAll('kbd').forEach(k => k.remove());
}, true);

export function toast(message, { action, onAction, more, ms = action ? 6000 : 1600 } = {}) {
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.replaceChildren(Object.assign(document.createElement('span'), { textContent: message }));
  undoNow = null;
  if (action) {
    const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: action });
    let done = false;
    const run = async () => {
      if (done) return;
      done = true;
      hide();
      await onAction?.();
    };
    btn.addEventListener('click', run, { once: true });
    if (action === 'Undo') {
      btn.append(...keyEls(MAC ? '⌘Z' : 'Ctrl+Z'));
      undoNow = run;
    }
    el.append(btn);
  }
  if (more) {
    const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: more.label });
    btn.addEventListener('click', async () => {
      hide();
      await more.onAction?.();
    }, { once: true });
    el.append(btn);
  }
  el.classList.toggle('has-action', !!action);
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(hide, ms);
}

function hide() {
  clearTimeout(timer);
  undoNow = null;
  el?.classList.remove('show');
}

// Show an undo toast for a change that has just been made. The change is
// also named in History under the same message.
// (Its Undo is recorded as the undo of that entry, so Ctrl+Z / Ctrl+Y later
// know it's been undone: undo.js.)
export function undoable(message, undo, { more } = {}) {
  const entry = labelHistory(message);
  toast(message, {
    more,
    action: 'Undo',
    onAction: async () => {
      await undo();
      const id = await entry;
      await labelHistory(`Undo: ${message}`, id ? { undo_of: [id] } : {});
    },
  });
}

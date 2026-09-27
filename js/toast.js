import { labelHistory } from './store.js';

// Brief message pill above the tab bar.
//   toast('✓ Saved')
//   toast('Removed "Jumpers"', { action: 'Undo', onAction: () => … })
// With an action it stays a little longer (like "Undo send") and the button
// runs once, then the toast goes.

let el = null;
let timer = null;

export function toast(message, { action, onAction, ms = action ? 6000 : 1600 } = {}) {
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.replaceChildren(Object.assign(document.createElement('span'), { textContent: message }));
  if (action) {
    const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: action });
    btn.addEventListener('click', async () => {
      hide();
      await onAction?.();
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
  el?.classList.remove('show');
}

// Show an undo toast for a change that has just been made. The change is
// also named in History under the same message.
export function undoable(message, undo) {
  labelHistory(message);
  toast(message, {
    action: 'Undo',
    onAction: async () => {
      await undo();
      await labelHistory(`Undo: ${message}`);
    },
  });
}

// Inline editing, the same everywhere: any single-line field you click into
// remembers what was there.
//   Enter        saves (the field loses focus; the view saves with "Saved · Undo")
//   click away   saves the same way
//   Esc          puts the old text back, with an "Escape cancelled change" toast
//                whose Undo brings your edit back (and saves it)
// Fields with their own Enter/Escape handling (e.g. "+ item", a new line on
// the planner) handle those keys first and are left alone.

import { toast } from './toast.js';

const SKIP = '.new-line, .quick-add, #case-note, input[type="search"], input[type="checkbox"], input[type="radio"], input[type="file"], input[type="date"], input[type="time"], .no-inline';
const original = new WeakMap();

// A textarea.one-line behaves like a single-line field (Enter saves, no line
// breaks) but wraps long text onto more lines and grows to fit.
const inline = el => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement && el.classList.contains('one-line'))
  && !el.matches(SKIP) && !el.closest('dialog.sheet form');

const NATIVE_FIT = CSS.supports?.('field-sizing', 'content');
export function autosize(el) {
  if (NATIVE_FIT) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
export function autosizeAll(root = document) {
  if (!NATIVE_FIT) for (const el of root.querySelectorAll('textarea.one-line')) autosize(el);
}

export function installInlineEditing() {
  document.addEventListener('focusin', ev => {
    if (inline(ev.target)) original.set(ev.target, ev.target.value);
  });

  // Capture phase so Esc is handled here before a view's own Esc (which may
  // close a box or clear a selection).
  document.addEventListener('keydown', ev => {
    const el = ev.target;
    if (!inline(el) || !original.has(el)) return;
    if (ev.key === 'Escape') {
      const before = original.get(el);
      const typed = el.value;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (typed === before) { el.blur(); return; }
      el.value = before; // setting it in code means no "change" fires on blur
      el.blur();
      toast('Escape cancelled change', {
        action: 'Undo',
        onAction: () => {
          if (!el.isConnected) return;
          el.value = typed;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        },
      });
    }
  }, true);

  // One-line textareas: pasted line breaks become spaces; grow as you type.
  document.addEventListener('input', ev => {
    const el = ev.target;
    if (!(el instanceof HTMLTextAreaElement) || !el.classList.contains('one-line')) return;
    if (/\n/.test(el.value)) {
      const at = el.selectionStart;
      el.value = el.value.replace(/\s*\n\s*/g, ' ');
      el.setSelectionRange(at, at);
    }
    autosize(el);
  });

  // Enter saves: leaving the field fires "change", which the view saves.
  document.addEventListener('keydown', ev => {
    const el = ev.target;
    if (ev.key !== 'Enter' || ev.defaultPrevented || ev.isComposing || !inline(el)) return;
    ev.preventDefault();
    el.blur();
  });

  // After a save the field's new value becomes the one to go back to.
  document.addEventListener('change', ev => {
    if (inline(ev.target)) original.set(ev.target, ev.target.value);
  }, true);

  installDateFields();
}

// Date and time fields fire "change" while you're still typing (e.g. after
// the first digit of a day), which would save and redraw mid-edit. Hold those
// back: the change is let through once, when you leave the field or press
// Enter. Esc puts the old value back (with an Undo toast).
const DATEISH = 'input[type="date"], input[type="time"], input[type="datetime-local"], input[type="month"]';
function installDateFields() {
  const was = new WeakMap();
  let releasing = false;
  const isDate = el => el instanceof HTMLInputElement && el.matches(DATEISH) && !el.matches('.no-inline');

  document.addEventListener('focusin', ev => { if (isDate(ev.target)) was.set(ev.target, ev.target.value); });

  document.addEventListener('change', ev => {
    if (!releasing && isDate(ev.target) && was.has(ev.target)) ev.stopImmediatePropagation();
  }, true);

  const release = el => {
    if (!was.has(el)) return;
    const before = was.get(el);
    was.delete(el);
    if (el.value === before) return;
    releasing = true;
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } finally { releasing = false; }
  };

  document.addEventListener('focusout', ev => { if (isDate(ev.target)) release(ev.target); });

  document.addEventListener('keydown', ev => {
    const el = ev.target;
    if (!isDate(el) || !was.has(el)) return;
    if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const before = was.get(el);
      const typed = el.value;
      was.delete(el);
      el.value = before;
      el.blur();
      if (typed !== before) {
        toast('Escape cancelled change', {
          action: 'Undo',
          onAction: () => {
            if (!el.isConnected) return;
            el.value = typed;
            releasing = true;
            try { el.dispatchEvent(new Event('change', { bubbles: true })); } finally { releasing = false; }
          },
        });
      }
    }
  }, true);
}

// Shared "type or paste lines, turn them into a list" entry, used anywhere a
// block of plain text becomes list items (Find Things contents, Day Planner
// dump box, Brain Dump …). Same keys and rules everywhere:
//   - one item per line; blank lines ignored
//   - a line starting with a space, "-", "*" or "•" is a sub-item of the line above
//   - Ctrl+Enter (⌘+Enter on Mac) adds; the button does the same

import { keepDraft, draftCleared } from './drafts.js';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const SHORTCUT = MAC ? '⌘↵' : 'Ctrl+Enter';

export function listHint({ subItems = true } = {}) {
  return `One per line.${subItems ? ' Start a line with - for a sub-item.' : ''} ${SHORTCUT} to add.`;
}

// Text → [{ text, sub }]
export function parseLines(text) {
  return text.split('\n')
    .map(raw => ({ text: raw.replace(/^[\s\-*•]+/, '').trim(), sub: /^(\s|[-*•])/.test(raw) }))
    .filter(line => line.text);
}

// Wire a textarea: Ctrl/⌘+Enter calls onSubmit(lines). The textarea is
// cleared and refocused after a successful submit. With `draft` (a key, or a
// function giving one) unsaved text is kept until it's added (drafts.js).
export function listEntry(textarea, onSubmit, { draft } = {}) {
  if (draft) keepDraft(textarea, draft);
  const submit = async () => {
    const text = textarea.value;
    const lines = parseLines(text);
    if (!lines.length) return;
    // Empty the box and forget the draft first: adding may redraw the view,
    // and a fresh box would otherwise get the old draft back.
    textarea.value = '';
    draftCleared(textarea);
    try {
      await onSubmit(lines);
    } catch (err) {
      if (textarea.isConnected) { textarea.value = text; textarea.dispatchEvent(new Event('input')); }
      throw err;
    }
    if (textarea.isConnected) textarea.focus();
  };
  textarea.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      submit();
    }
  });
  return submit;
}

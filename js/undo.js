// Ctrl+Z (⌘Z) anywhere but in something being typed: undo the last thing done,
// what its message said (a History entry with a name: history.js undoes it),
// and say so. Ctrl+Y or Ctrl+Shift+Z (⌘⇧Z) does it again (redo), back to the
// last new thing done. While a message with Undo shows, Ctrl+Z is its Undo
// (toast.js). In a note, the keys are the note's own (noteundo.js).
// It works from the History (on this device), so it goes on working after a reload.

import * as store from './store.js';
import { undoEntries } from './history.js';
import { toast } from './toast.js';
import { typingIn } from './listkit.js';

// Newest first. An entry is undone while an undo of it stands (an undo that isn't itself undone).
function standing(entries) {
  const byId = new Map(entries.map(e => [e.id, e]));
  const undoneBy = new Map(); // id → the undos of it
  for (const e of entries) for (const t of e.undo_of || []) { if (!undoneBy.has(t)) undoneBy.set(t, []); undoneBy.get(t).push(e); }
  const memo = new Map();
  const undone = e => {
    if (memo.has(e.id)) return memo.get(e.id);
    memo.set(e.id, false); // (no loops)
    const v = (undoneBy.get(e.id) || []).some(u => byId.has(u.id) && !undone(u));
    memo.set(e.id, v);
    return v;
  };
  return undone;
}

async function lastToUndo() {
  const entries = (await store.historyList()).filter(e => e.label);
  const undone = standing(entries);
  return entries.find(e => !e.undo_of && !undone(e)) || null;
}

async function lastToRedo() {
  const entries = (await store.historyList()).filter(e => e.label);
  const undone = standing(entries);
  for (const e of entries) {
    if (!e.undo_of) return null; // something new was done since: nothing to redo
    if (!undone(e) && e.label.startsWith('Undo')) return e; // an undo that stands (not a redo)
  }
  return null;
}

export function installUndoKeys(refresh) {
  addEventListener('keydown', async ev => {
    const k = ev.key.toLowerCase();
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || (k !== 'z' && k !== 'y') || ev.defaultPrevented) return;
    if (typingIn(ev.target) || typingIn(document.activeElement) || document.querySelector('dialog[open]')) return;
    ev.preventDefault();
    const redo = k === 'y' || ev.shiftKey;
    const entry = await (redo ? lastToRedo() : lastToUndo());
    if (!entry) { toast(redo ? 'Nothing to redo' : 'Nothing to undo'); return; }
    const { label, changedSince } = await undoEntries([entry]);
    await refresh();
    toast(`${label}${changedSince ? ` (${changedSince} field${changedSince === 1 ? '' : 's'} had changed again since)` : ''}`);
  });
}

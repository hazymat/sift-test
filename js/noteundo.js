// Undo in notes, done by Sift rather than the browser, so it's the same in
// every browser and on the iPhone, and it carries on past this visit: when
// this visit's steps run out, Ctrl+Z steps back through the note's saved
// versions (and Ctrl+Y / Ctrl+Shift+Z forward again).
//
// Steps follow the usual rules: a new step after a pause of about a second,
// when switching between typing and deleting, after moving the cursor, and on
// its own for Enter, pasting and formatting.
//
// A version is saved (as its own synced record, `note_versions`) each time you
// leave a note having changed it; the first time a note is opened, its text as
// it was is saved too. Versions older than Settings → Notes → "Keep note
// history for" are removed at start-up.
//
//   const u = noteUndo(edit, { get, set, ref })   get() → markdown; set(md) shows and saves it;
//                                                  ref() → { collection, id, field } or null
//   u.mark()                                       a step boundary before a change the editor makes itself
//   u.left()                                       the note was left: save a version if it changed
//   showVersions(ref, current, pick)               the list of versions (🕘 in the toolbar)
//   pruneVersions()                                once at start-up

import * as store from './store.js';
import { dateTimeText } from './days.js';

const PAUSE = 1000; // ms without typing that starts a new step
const MAX_STEPS = 500;

// Where the cursor is, as a count of characters from the start (and back).
function caretOffset(edit) {
  const sel = getSelection();
  if (!sel.rangeCount || !edit.contains(sel.anchorNode)) return null;
  const r = document.createRange();
  r.selectNodeContents(edit);
  r.setEnd(sel.anchorNode, sel.anchorOffset);
  return r.toString().length;
}
function setCaret(edit, n) {
  if (n == null) return;
  const walk = document.createTreeWalker(edit, NodeFilter.SHOW_TEXT);
  let left = n;
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    if (left <= t.nodeValue.length) { getSelection().collapse(t, left); return; }
    left -= t.nodeValue.length;
  }
  const r = document.createRange();
  r.selectNodeContents(edit);
  r.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
}

const same = (a, b) => a && b && a.collection === b.collection && a.id === b.id && (a.field || '') === (b.field || '');
async function versionsOf(ref) {
  if (!ref?.id) return [];
  const list = await store.list('note_versions', { filter: v => v.ref_collection === ref.collection && v.ref_id === ref.id && (v.field || '') === (ref.field || '') });
  return list.sort((a, b) => (a.at || '').localeCompare(b.at || ''));
}
async function saveVersion(ref, md) {
  if (!ref?.id) return;
  const list = await versionsOf(ref);
  if (list.at(-1)?.md === md) return; // nothing new
  await store.create('note_versions', { ref_collection: ref.collection, ref_id: ref.id, field: ref.field || '', at: new Date().toISOString(), md });
}

export function noteUndo(edit, { get, set, ref }) {
  let undo = [];
  let redo = [];
  let lastKind = null;
  let lastAt = 0;
  let moved = false;
  let visitStart = null; // the text when this visit began
  let olderLoaded = false; // saved versions already added under this visit's steps
  let seenRef = null;

  const snap = () => ({ md: get(), caret: caretOffset(edit) });
  const push = s => {
    if (undo.at(-1)?.md === s.md) return;
    undo.push(s);
    if (undo.length > MAX_STEPS) undo.shift();
  };
  const apply = s => {
    set(s.md);
    edit.focus();
    setCaret(edit, s.caret);
    lastKind = null;
  };

  // A new visit: remember where it began; the very first time, keep the text as it was.
  edit.addEventListener('focus', () => {
    if (visitStart !== null) return;
    visitStart = get();
    const r = ref();
    if (!same(r, seenRef)) { seenRef = r; olderLoaded = false; undo = []; redo = []; }
    if (visitStart.trim()) versionsOf(r).then(list => { if (!list.length) saveVersion(r, visitStart); });
  });
  // Moving the cursor (arrows, clicking) ends a run of typing.
  edit.addEventListener('keydown', ev => { if (/^(Arrow|Home|End|Page)/.test(ev.key)) moved = true; });
  edit.addEventListener('pointerdown', () => { moved = true; });

  edit.addEventListener('beforeinput', ev => {
    const t = ev.inputType || '';
    if (t === 'historyUndo') { ev.preventDefault(); stepBack(); return; }
    if (t === 'historyRedo') { ev.preventDefault(); stepForward(); return; }
    const kind = /^insert(Text|CompositionText|ReplacementText)$/.test(t) ? 'type' : t.startsWith('delete') ? 'delete' : 'other';
    const now = Date.now();
    if (kind === 'other' || kind !== lastKind || now - lastAt > PAUSE || moved) push(snap());
    lastKind = kind === 'other' ? null : kind;
    lastAt = now;
    moved = false;
    redo = [];
  });
  edit.addEventListener('keydown', ev => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    const k = ev.key.toLowerCase();
    if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); stepBack(); }
    else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); stepForward(); }
  });

  async function stepBack() {
    if (!undo.length && !olderLoaded) {
      // This visit's steps have run out: the saved versions before it go underneath.
      olderLoaded = true;
      const cur = get();
      const older = (await versionsOf(ref())).map(v => v.md).filter((m, n, all) => m !== all[n + 1]); // no repeats in a row
      while (older.length && older.at(-1) === cur) older.pop();
      undo = [...older.map(md => ({ md, caret: null })), ...undo];
    }
    const s = undo.pop();
    if (!s) return;
    redo.push(snap());
    apply(s);
  }
  function stepForward() {
    const s = redo.pop();
    if (!s) return;
    push(snap());
    apply(s);
  }

  return {
    mark() { push(snap()); lastKind = null; redo = []; },
    // Leaving the note: a version if it changed during this visit.
    left() {
      if (visitStart === null) return;
      const md = get();
      if (md !== visitStart) saveVersion(ref(), md);
      visitStart = null;
    },
    // A version picked from the list: one more step, so it can be undone.
    restore(md) { push(snap()); redo = []; set(md); edit.focus(); },
  };
}

// The list of a note's saved versions, newest first; picking one puts it back.
export async function showVersions(ref, current, pick) {
  const list = (await versionsOf(ref)).reverse();
  if (!list.length) { (await import('./toast.js')).toast('No earlier versions of this note yet'); return; }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const when = iso => dateTimeText(new Date(iso), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const line = md => md.split('\n').map(l => l.replace(/^(?:#{1,6}|-#|\+#|#\+|\s*[-*]|\s*\d+[.)])\s+/, '').replace(/\*\*|~~/g, '').trim()).filter(Boolean).slice(0, 2).join(' · ') || '(empty)';
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet versions-sheet';
  dlg.innerHTML = `<div class="sheet-handle"></div><h2>Earlier versions</h2>
    <p class="muted">Tap one to put the note back to it (Ctrl+Z undoes that too).</p>
    <div class="versions-list">${list.map((v, n) => `<button type="button" data-n="${n}"${v.md === current ? ' aria-current="true"' : ''}><span class="v-when">${esc(when(v.at))}${v.md === current ? ' · now' : ''}</span><span class="v-text">${esc(line(v.md))}</span></button>`).join('')}</div>
    <div class="sheet-actions"><span class="spacer"></span><button type="button" data-v="close">Close</button></div>`;
  document.body.append(dlg);
  dlg.addEventListener('click', ev => {
    const b = ev.target.closest('[data-n]');
    if (b) { const v = list[Number(b.dataset.n)]; dlg.close(); if (v.md !== current) pick(v.md); return; }
    if (ev.target.closest('[data-v="close"]')) dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

// Settings → Notes → Keep note history for: older versions go (the newest of each note always stays).
export async function pruneVersions() {
  const days = Number((await store.getSettings())?.note_history_days ?? 90);
  if (!days) return; // forever
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();
  const all = await store.list('note_versions');
  const newest = new Map();
  for (const v of all) { const k = `${v.ref_collection}/${v.ref_id}/${v.field}`; if (!newest.has(k) || newest.get(k).at < v.at) newest.set(k, v); }
  const keep = new Set([...newest.values()].map(v => v.id));
  for (const v of all) if (v.at < cutoff && !keep.has(v.id)) await store.remove('note_versions', v.id);
}


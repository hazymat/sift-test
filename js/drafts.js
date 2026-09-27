// Text typed into an "add new…" box is kept on this device until it's added,
// so closing the app or wandering off doesn't lose it: the box is a running
// page, and adding it starts a fresh one. Kept in siftTestStorage (not synced,
// not in backups: it's only ever an unfinished draft).
//
//   keepDraft(textarea, key)   key: a string, or a function for boxes whose
//                              context changes (e.g. the planner's day)
//   draftCleared(textarea)     after adding: forget the draft
//   readDraft(key) / writeDraft(key, text) for editors that aren't textareas

const slot = key => `sift:draft:${key}`;

export function readDraft(key) {
  try { return siftTestStorage.getItem(slot(key)) || ''; } catch { return ''; }
}

export function writeDraft(key, text) {
  try {
    if (text && text.trim()) siftTestStorage.setItem(slot(key), text);
    else siftTestStorage.removeItem(slot(key));
  } catch { /* storage unavailable: drafts just aren't kept */ }
}

export function keepDraft(el, key) {
  const k = typeof key === 'function' ? key : () => key;
  el._draftKey = k;
  if (!el.value) el.value = readDraft(k());
  if (!el._draftWired) {
    el._draftWired = true;
    el.addEventListener('input', () => writeDraft(el._draftKey(), el.value));
  }
  return { restore: () => { el.value = readDraft(k()); } };
}

export function draftCleared(el) {
  if (el._draftKey) writeDraft(el._draftKey(), '');
}

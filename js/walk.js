// ↑ / ↓ from one field to the next while editing a list (Tasks, the Day
// Planner): a name, its note, the next name… These say where the cursor is in
// a field and put it at a field's start or end.
//
//   atEdge(el, 'up' | 'down')   → is the cursor on the field's first / last line?
//   caretTo(el, 'start' | 'end')

export function atEdge(el, dir) {
  if (el.matches('input')) return true;
  if (el.matches('textarea')) {
    const v = el.value;
    if (dir === 'up' ? v.slice(0, el.selectionStart).includes('\n') : v.slice(el.selectionEnd).includes('\n')) return false;
    // A long line wraps: the cursor is on the first / last line only if it's drawn there (a copy of the text measures it).
    const cs = getComputedStyle(el);
    const copy = document.createElement('div');
    for (const k of ['boxSizing', 'width', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'wordSpacing', 'textIndent', 'tabSize']) copy.style[k] = cs[k];
    Object.assign(copy.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', paddingTop: '0', paddingBottom: '0', height: 'auto' });
    const mark = document.createElement('span');
    mark.textContent = '\u200b';
    copy.append(v.slice(0, dir === 'up' ? el.selectionStart : el.selectionEnd), mark, v.slice(dir === 'up' ? el.selectionStart : el.selectionEnd) || '\u200b');
    document.body.append(copy);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 20;
    const at = mark.offsetTop, all = copy.offsetHeight;
    copy.remove();
    return dir === 'up' ? at < lh * 0.8 : all - at - lh < lh * 0.8;
  }
  // A note being written (rich text): compare where the cursor is drawn with
  // the note's first and last lines.
  const sel = getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return false;
  const r = sel.getRangeAt(0).cloneRange();
  r.collapse(dir === 'up');
  let box = r.getClientRects()[0];
  if (!box || !box.height) {
    // An empty line (or the very start) has no box of its own: use its line's.
    const n = r.startContainer;
    let e = n.nodeType === 1 ? (n.childNodes[r.startOffset] || n) : n.parentElement;
    if (e?.nodeType !== 1) e = e?.parentElement;
    box = e?.getBoundingClientRect();
    if (box && !box.height) box = e.parentElement?.getBoundingClientRect();
  }
  if (!box) return true;
  // The text's own extent (the box may be taller than what's written in it).
  const all = document.createRange();
  all.selectNodeContents(el);
  const text = all.getBoundingClientRect();
  const ed = text.height ? text : el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 20;
  return dir === 'up' ? box.top - ed.top < line * 0.8 : ed.bottom - box.bottom < line * 0.8;
}

export function caretTo(el, at) {
  if (el.matches('input, textarea')) {
    const n = at === 'start' ? 0 : el.value.length;
    el.setSelectionRange(n, n);
    return;
  }
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(at === 'start');
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

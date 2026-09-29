// Rows drawn the Tasks way (Tasks, and the items of an open list): a row and its
// sub-rows share one card, joined by fine lines, and the page measures where
// tick boxes and text sit so the lines, pills and notes line up (CSS).
//
//   treeHtml(rows, n, margin)   the lines joining row n to the rows around it (rows: [{ depth }])
//   groupOf(rows, n)            its card class: group-top, group-kid, group-end
//   measureRows(page, ul, entryInput)   after drawing: --tick-top / --tick-h, --title-x,
//                               --entry-x and --task-row-h
//   slideRows(rows, opening)    rows sliding open (from nothing to their height) or closed

// Lines joining a row to its sub-rows: from just under the row's tick box,
// down and across to each sub-row's tick box, an L that carries on down while
// more sub-rows follow. Level k's line runs down the middle of the tick boxes
// one level up (--tick-top / --tick-h on the list).
// With the margin shown (👁 Layout) every tick box sits in the margin and only
// the text is indented. The line then drops from the ruled line under the row,
// down the left of each sub-row, and turns along the sub-row's own ruled line
// (which starts there): the joining lines are the ruled lines, so they never
// cross them. Level k's line is under the first letter of the text one level
// up (CSS: the ruled lines start at 50px + indent).
const treeX = k => 49 + (k - 1) * 28;
export function treeHtml(rows, n, margin = false) {
  const depthAt = j => rows[j]?.depth ?? 0;
  // Does a later row at depth k follow before the family ends?
  const goesOn = k => { for (let j = n + 1; j < rows.length; j++) { const dj = depthAt(j); if (dj < k) return false; if (dj === k) return true; } return false; };
  const d = depthAt(n);
  const v = (k, top, bottom) => `<i class="tree-v" style="left:${treeX(k)}px;top:${top};bottom:${bottom}"></i>`;
  const parts = [];
  if (margin) {
    for (let k = 1; k <= d; k++) if (k === d || goesOn(k)) parts.push(`<i class="tree-v" style="left:calc(${50 + k * 28}px + var(--mshift, 0px));top:0;bottom:0"></i>`);
    return parts.length ? `<span class="tree" aria-hidden="true">${parts.join('')}</span>` : '';
  }
  for (let k = 1; k < d; k++) if (goesOn(k)) parts.push(v(k, '0', '0'));
  if (d > 0) {
    parts.push(v(d, '0', goesOn(d) ? '0' : 'calc(100% - var(--tick-top) - var(--tick-h) / 2)'));
    parts.push(`<i class="tree-h" style="left:${treeX(d)}px;width:${40 + d * 28 - 4 - treeX(d)}px"></i>`);
  }
  if (depthAt(n + 1) === d + 1 && n + 1 < rows.length) parts.push(v(d + 1, 'calc(var(--tick-top) + var(--tick-h) + 4px)', '0'));
  return parts.length ? `<span class="tree" aria-hidden="true">${parts.join('')}</span>` : '';
}

// A row and its sub-rows share one card: the row opens it, sub-rows sit inside, the last one closes it.
export function groupOf(rows, n) {
  const d = rows[n].depth ?? 0, nd = rows[n + 1]?.depth ?? 0;
  return d === 0 ? (nd > 0 ? 'group-top' : '') : `group-kid${nd === 0 ? ' group-end' : ''}`;
}

export function measureRows(page, ul, entryInput = null) {
  // Where tick boxes sit in a row, for the lines joining sub-rows.
  const tk = ul?.querySelector(':scope > li[data-task] .tick');
  if (tk) {
    const t = tk.getBoundingClientRect();
    const top = t.top - tk.closest('li').getBoundingClientRect().top;
    if (t.height > 0 && top >= 0) { ul.style.setProperty('--tick-top', `${top}px`); ul.style.setProperty('--tick-h', `${t.height}px`); }
  }
  // Where a row's text starts, so its pills and "Add note" line (while editing) start there too, at any width.
  const textX = (input, box) => {
    const b = box.getBoundingClientRect(), cs = getComputedStyle(box);
    return input.getBoundingClientRect().left + parseFloat(getComputedStyle(input).paddingLeft) - b.left - parseFloat(cs.paddingLeft) - parseFloat(cs.borderLeftWidth);
  };
  const ti = ul?.querySelector(':scope > li[data-task][data-depth="0"] > .task-title');
  if (ti) { const x = textX(ti, ti.closest('li')); if (x > 0) page.style.setProperty('--title-x', `${x}px`); }
  const en = entryInput?.closest('.task-entry');
  if (en) { const x = textX(entryInput, en) - (parseFloat(en.style.getPropertyValue('--ind')) || 0); if (x > 0) page.style.setProperty('--entry-x', `${x}px`); }
  // Every line the same height: the new line matches a plain row, measured to the bottom of its
  // text (a note, chips or pills under a row don't count, even when every row has them).
  const lineH = li => { const b = li.getBoundingClientRect(), t = li.querySelector(':scope > .task-title')?.getBoundingClientRect(), cs = getComputedStyle(li); return t?.height ? t.bottom - b.top + parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth) : b.height; };
  const plain = [...(ul?.querySelectorAll(':scope > li[data-task]') || [])].map(lineH).filter(h => h > 0);
  if (plain.length) page.style.setProperty('--task-row-h', `${Math.min(...plain)}px`);
}

export const slideRows = (rows, opening) => Promise.all(rows.map(r => {
  const cs = getComputedStyle(r);
  const full = { height: `${r.offsetHeight}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1 };
  const none = { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 };
  r.style.overflow = 'hidden'; r.style.minHeight = '0';
  const anim = r.animate(opening ? [none, full] : [full, none], { duration: 220, easing: 'ease-in-out', fill: opening ? 'none' : 'forwards' });
  return anim.finished.then(() => { if (opening) { r.style.overflow = ''; r.style.minHeight = ''; } }, () => {});
}));

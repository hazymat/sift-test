// Phones: swipe a row of a list sideways, as in a phone's mail app. Its
// actions slide in over the row from the side the finger comes from, and once
// they reach the name they push the row along, so the name is always there up
// against them: swipe left for the right-hand ones
// (e.g. ✓ Done, ⋯ More), right for the left-hand ones (e.g. Delete). Let go
// past half of them and it stays open for a tap; less and it springs back; a
// tap anywhere else closes it. Not from a grab bar, a tick, a button, a
// field being typed in or a row got ready to move (.armed: the Day
// Planner's), nor while things are chosen (the actions bar is up).
// A row's swipe isn't also the page's (app.js: a side swipe changes page). One
// place for every list that swipes: Tasks and the Day Planner so far.
//
//   rowSwipe(root, { rows, face, actions })
//     rows: the swipeable rows inside root (a selector)
//     face: the part of a row the actions cover (a selector inside it; none: the whole row),
//       e.g. a Day Planner line from its grab bar on, leaving the time uncovered
//     actions(row): { left: [{ label, cls, run(row) }], right: [...] }
//       left: shown on the right when swiped left; right: on the left when swiped right

const SKIP = '.drag-handle, .drag-grip, .resize-grip, .tick, button:not(.pill-act), .row-acts, .armed, input:focus, textarea:focus, [contenteditable="true"]';

export function rowSwipe(root, { rows, face = null, actions }) {
  if (!matchMedia('(pointer: coarse)').matches) return;
  const faceOf = row => (face && row.querySelector(face)) || row;
  let sw = null, openRow = null, shown = null; // shown: the open row's actions
  let closing = false; // this touch closes the open row, and does nothing else
  let quietUntil = 0; // just after a swipe: a click on the row isn't a tap on it
  // The actions cover x of the row, from its edge. Once they reach the name's
  // text they push the row's contents along ahead of them (app.css: .swipe-push),
  // cut off at the face's edge, so the name stays readable up against them.
  const gapOf = new WeakMap(); // row → how far the actions come in before they reach the name
  const slideTo = (row, x, animate) => {
    row.classList.toggle('swipe-anim', animate);
    row.style.setProperty('--swipe-w', `${Math.abs(x)}px`);
    row.style.setProperty('--swipe-p', `${Math.max(0, Math.abs(x) - (gapOf.get(row) ?? Infinity))}px`);
  };
  const tidy = row => {
    row.classList.remove('swiping', 'swipe-anim');
    row.querySelector(':scope > .row-acts')?.remove();
    const f = faceOf(row);
    f.classList.remove('swipe-push', 'left', 'right');
    for (const mover of f.querySelectorAll(':scope > .swipe-mover')) { mover.classList.remove('swipe-mover'); mover.style.removeProperty('--swipe-off'); }
  };
  const shut = () => {
    const row = openRow;
    openRow = null;
    if (!row) return;
    slideTo(row, 0, true);
    setTimeout(() => { if (openRow !== row) tidy(row); }, 220);
  };
  // Where the name's text starts and ends on screen (the field itself is wider).
  const measure = document.createElement('canvas').getContext('2d');
  const textSpan = field => {
    const box = field.getBoundingClientRect(), cs = getComputedStyle(field);
    const start = box.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    measure.font = cs.font;
    const end = Math.min(start + measure.measureText(field.value ?? field.textContent).width, box.right - parseFloat(cs.paddingRight));
    return { start, end };
  };
  // The actions for that side, over the face's end (its rounded corners too); returns how far it opens.
  const reveal = (row, side) => {
    tidy(row);
    shown = actions(row)[side] || [];
    const acts = document.createElement('div');
    acts.className = `row-acts ${side}`;
    acts.innerHTML = shown.map((a, n) => `<button type="button" class="${a.cls || ''}" data-ra="${n}">${a.label}</button>`).join('');
    row.classList.add('swiping');
    const rowBox = row.getBoundingClientRect(), rowStyle = getComputedStyle(row), f = faceOf(row), faceBox = f.getBoundingClientRect(), faceStyle = getComputedStyle(f);
    const top = faceBox.top - rowBox.top - parseFloat(rowStyle.borderTopWidth);
    Object.assign(acts.style, { top: `${top}px`, height: `${faceBox.height}px` });
    if (side === 'left') Object.assign(acts.style, { right: `${rowBox.right - faceBox.right - parseFloat(rowStyle.borderRightWidth)}px`, borderRadius: `0 ${faceStyle.borderTopRightRadius} ${faceStyle.borderBottomRightRadius} 0` });
    else Object.assign(acts.style, { left: `${faceBox.left - rowBox.left - parseFloat(rowStyle.borderLeftWidth)}px`, borderRadius: `${faceStyle.borderTopLeftRadius} 0 0 ${faceStyle.borderBottomLeftRadius}` });
    // What gets pushed: the face's contents in its flow (not what's placed elsewhere, e.g. a day task's tick in the margin).
    const inner = { left: faceBox.left + parseFloat(faceStyle.borderLeftWidth), right: faceBox.right - parseFloat(faceStyle.borderRightWidth) };
    for (const mover of f.children) {
      if (getComputedStyle(mover).position === 'absolute' || !mover.getClientRects().length) continue;
      const box = mover.getBoundingClientRect();
      mover.classList.add('swipe-mover');
      mover.style.setProperty('--swipe-off', `${side === 'left' ? box.left - inner.left : inner.right - box.right}px`); // room before it's cut off
    }
    f.classList.add('swipe-push', side);
    const name = f.querySelector('.task-title, .item-title'), text = name && textSpan(name), SPACE = 10;
    gapOf.set(row, text ? Math.max(0, side === 'left' ? faceBox.right - text.end - SPACE : text.start - faceBox.left - SPACE) : Infinity);
    row.append(acts);
    acts.style.width = 'max-content'; // its buttons' own width: how far it opens
    let wide = Math.min(acts.offsetWidth, faceBox.width);
    acts.style.width = '';
    // Swiped right, it opens at least as far as the name, over whatever comes before it (grab bar, tick box, a sub-task's lines).
    if (side === 'right' && gapOf.get(row) < faceBox.width - 40) wide = Math.max(wide, gapOf.get(row));
    return wide;
  };
  root.addEventListener('touchstart', ev => {
    closing = false;
    if (openRow && !ev.target.closest('.row-acts')) {
      closing = openRow.contains(ev.target); // on the open row: closing it, not editing it
      shut();
      if (closing) { sw = null; return; }
    }
    const row = ev.target.closest(rows);
    sw = row && root.contains(row) && ev.touches.length === 1 && !ev.target.closest(SKIP) && !document.body.classList.contains('has-select-bar')
      ? { row, x: ev.touches[0].clientX, y: ev.touches[0].clientY, dx: 0, side: null, wide: 0 } : null;
  }, { passive: true });
  root.addEventListener('touchmove', ev => {
    if (!sw) return;
    if (document.body.classList.contains('is-dragging')) { if (sw.side) tidy(sw.row); sw = null; return; } // the row was lifted (held): it's being dragged, not swiped
    const dx = ev.touches[0].clientX - sw.x, dy = ev.touches[0].clientY - sw.y;
    if (!sw.side) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; } // scrolling the page
      if (Math.abs(dx) < 12) return;
      sw.side = dx < 0 ? 'left' : 'right';
      sw.wide = reveal(sw.row, sw.side);
      if (!sw.wide) { tidy(sw.row); sw = null; return; } // nothing on that side
    }
    ev.preventDefault(); // the page doesn't scroll while a row is swiped
    const most = sw.wide + 40;
    sw.dx = sw.side === 'left' ? Math.max(-most, Math.min(0, dx)) : Math.min(most, Math.max(0, dx));
    slideTo(sw.row, sw.dx, false);
  }, { passive: false });
  root.addEventListener('touchend', ev => {
    const s = sw;
    sw = null;
    // A swipe, or the touch that closed an open row, isn't also a tap (which would start editing the row).
    if (closing || s?.side) { ev.preventDefault(); quietUntil = Date.now() + 400; }
    if (closing) { closing = false; ev.stopPropagation(); return; }
    if (!s?.side) return;
    ev.stopPropagation(); // the row's swipe, not the page's
    openRow = s.row;
    if (Math.abs(s.dx) > s.wide / 2) slideTo(s.row, s.side === 'left' ? -s.wide : s.wide, true);
    else shut();
  }, { passive: false });
  root.addEventListener('click', ev => {
    const b = ev.target.closest('.row-acts [data-ra]');
    if (!b && Date.now() < quietUntil && ev.target.closest(rows)) { ev.preventDefault(); ev.stopPropagation(); return; }
    if (!b || !root.contains(b)) return;
    ev.stopPropagation();
    const row = b.closest(rows), act = shown?.[Number(b.dataset.ra)];
    shut();
    if (row && act) act.run(row);
  }, true);
}

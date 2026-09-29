// Press and hold anywhere on a row to pick it up (mouse or finger): Tasks
// (sortable.js) and the Day Planner. A shading spreads from the pointer to the
// row's edges while it's held; when it's full the row lifts, and it stays full
// (not pulsing again as the row moves) until the drag ends. A tap, or moving
// first (scrolling, choosing text), is left alone. While lifted: its fields
// are read-only and any keyboard goes down (an iPhone focuses a held field
// after half a second, and the keyboard shifts the page under the finger), the
// page doesn't scroll, and the release isn't a tap or click into it.
//
//   const hold = holdToLift(root, { rowAt, shadeOf, skip, ms, busy, onLift })
//     rowAt(target): the row a press there would lift (or null)
//     shadeOf(row): the part that shades (default: the row)
//     skip: where a press never lifts (buttons, tick boxes…); busy(): a drag is on already
//     onLift(row, x, y, pointerId): it lifted, at the pointer's latest place
//   hold.letGo()   when the drag ends: the shading fades, fields are editable again
//   hold.cancel()  a press let go of before it lifted
//   hold.liftedAt  when it last lifted (so the view doesn't take the release for a tap)

export const HOLD_SKIP = 'button, a, select, label, input[type="checkbox"], input[type="radio"], .tick, .edit-pills, .row-acts, .note-in-place, [contenteditable="true"], .task-details';

// While anything is carried, the page stays still and the touch's end isn't a tap: on the
// whole document, since a view may redraw the row under the finger as it's picked up
// (the touch's events then no longer reach the view).
let carrying = 0;
let quietTouchEnd = false;
document.addEventListener('touchstart', () => { quietTouchEnd = false; }, { passive: true, capture: true });
document.addEventListener('touchmove', e => { if (carrying && e.cancelable) e.preventDefault(); }, { passive: false, capture: true });
document.addEventListener('touchend', e => { if (quietTouchEnd) { quietTouchEnd = false; if (e.cancelable) e.preventDefault(); } }, { passive: false, capture: true });

// The element a touch began on must stay in the page for the touch's events to reach the
// document: if the view redrew it away as the row lifted, it's kept, unseen, till let go.
const keeper = () => document.getElementById('hold-keep') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'hold-keep', hidden: true }));

export function holdToLift(root, { rowAt, shadeOf = row => row, skip = HOLD_SKIP, ms = 300, busy = () => false, onLift }) {
  let holding = null; // pressed, waiting for the hold
  let held = null; // lifted: undone by letGo
  let quietClick = false;
  let x = 0, y = 0;
  let liftedAt = 0;

  const cancel = () => {
    if (!holding) return;
    clearTimeout(holding.timer);
    holding.ripple.remove();
    holding.shade.classList.remove('hold-pending');
    holding = null;
  };
  const letGo = () => {
    const h = held;
    held = null;
    if (!h) return;
    carrying = Math.max(0, carrying - 1);
    setTimeout(() => { if (h.target.parentElement?.id === 'hold-keep') h.target.remove(); }, 400);
    h.ripple.classList.add('done');
    setTimeout(() => { h.ripple.remove(); h.shade.classList.remove('hold-pending'); for (const f of h.locked) f.readOnly = false; }, 350); // after the touch's end and its click
  };

  root.addEventListener('pointerdown', e => {
    if (e.button > 0 || busy() || held || e.target.closest(skip)) return;
    const row = rowAt(e.target);
    if (!row) return;
    cancel();
    const shade = shadeOf(row) || row;
    const box = shade.getBoundingClientRect();
    const ripple = document.createElement('span'); // a clip the size of the row, holding the spreading circle
    ripple.className = 'hold-ripple';
    ripple.setAttribute('aria-hidden', 'true');
    ripple.innerHTML = '<span></span>';
    // It spreads from the pointer to the farthest corner, filling the row just as it lifts.
    const px = e.clientX - box.left, py = e.clientY - box.top;
    const reach = (Math.max(Math.hypot(px, py), Math.hypot(box.width - px, py), Math.hypot(px, box.height - py), Math.hypot(box.width - px, box.height - py)) / 8) * 1.05; // the circle starts 16px across
    const dot = ripple.firstChild;
    Object.assign(dot.style, { left: `${px}px`, top: `${py}px`, animationDuration: `${ms}ms` });
    dot.style.setProperty('--reach', reach);
    shade.classList.add('hold-pending');
    shade.append(ripple);
    x = e.clientX; y = e.clientY;
    holding = {
      row, shade, ripple, x, y, pointerId: e.pointerId, locked: [], target: e.target,
      timer: setTimeout(() => {
        const h = holding;
        holding = null;
        held = h;
        carrying++;
        liftedAt = Date.now();
        // Full now, and it stays so: no animation to start again when the row moves in the page.
        Object.assign(dot.style, { animation: 'none', transform: `scale(${reach})`, opacity: '1' });
        if (h.row.contains(document.activeElement) || document.activeElement?.matches?.('input, textarea, [contenteditable="true"]')) document.activeElement.blur();
        getSelection()?.removeAllRanges();
        for (const f of h.row.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), textarea')) if (!f.readOnly) { f.readOnly = true; h.locked.push(f); }
        quietClick = true;
        setTimeout(() => { quietClick = false; }, 1500);
        quietTouchEnd = true;
        navigator.vibrate?.(10);
        onLift(h.row, x, y, h.pointerId);
        if (!h.target.isConnected) keeper().append(h.target);
      }, ms),
    };
  });
  root.addEventListener('pointermove', e => {
    x = e.clientX; y = e.clientY;
    if (holding && Math.hypot(e.clientX - holding.x, e.clientY - holding.y) >= 6) cancel(); // moved first: scrolling, or choosing text
  });
  for (const type of ['pointerup', 'pointercancel']) root.addEventListener(type, cancel);
  root.addEventListener('click', e => { if (quietClick) { quietClick = false; e.preventDefault(); e.stopPropagation(); } }, true);

  return { letGo, cancel, get held() { return !!held; }, get liftedAt() { return liftedAt; } };
}

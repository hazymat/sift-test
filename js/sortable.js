// Drag-to-reorder for a list, driven by a grip handle in each item.
// Pointer events rather than HTML5 drag and drop, which doesn't work on
// iOS touch. Keyboard: focus a handle and use the arrow keys.
//
//   sortable(ul, { onMove(item), onEnd({ item, dx }) })
//   onMove runs after each step so callers can enforce rules (e.g. a limit);
//   onEnd({ item, dx }) runs once when the drag finishes; dx is the sideways
//   distance dragged (used for indenting), 0 for keyboard moves.
//
// With `holdMs`, the grip does three things:
//   tap                       → onTap(item, event)
//   press and move straight away → onPaint(firstItem, itemUnderPointer) (swipe-select)
//   press and hold, then drag → drag as above (onLift(item) when it lifts)

export function sortable(list, { handle = '.drag-handle', holdMs = 0, keyboard = true, onMove, onEnd, onTap, onPaint, onLift, onDrag } = {}) {
  let dragging = null;
  let pending = null; // pressed; waiting to see if it's a tap, swipe or hold
  let painting = null;
  let offsetY = 0;
  let startX = 0;
  let lastX = 0;
  let lastY = 0;

  // Hidden rows (e.g. the rest of a group being dragged) don't take part.
  const siblings = () => [...list.children].filter(el => el !== dragging && !el.hidden);

  const rowAt = y => {
    const rows = [...list.children].filter(el => !el.hidden);
    return rows.find(r => { const b = r.getBoundingClientRect(); return y >= b.top && y < b.bottom; })
      || (y < rows[0]?.getBoundingClientRect().top ? rows[0] : rows.at(-1));
  };

  // Where the dragged item's visual centre now is, so the DOM follows it.
  function place(clientY) {
    for (const el of siblings()) {
      const r = el.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const before = dragging.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING;
      if (before && clientY < mid) {
        list.insertBefore(dragging, el);
        onMove?.(dragging);
        return;
      }
      if (!before && clientY > mid && el.nextElementSibling !== dragging) {
        el.after(dragging);
        onMove?.(dragging);
      }
    }
  }

  function follow(clientY) {
    // Translate so the item stays under the finger even after DOM moves.
    dragging.style.transform = '';
    const top = dragging.getBoundingClientRect().top;
    dragging.style.transform = `translate(var(--dx, 0px), ${clientY - offsetY - top}px)`;
  }

  function lift(item, x, y) {
    dragging = item;
    offsetY = y - item.getBoundingClientRect().top;
    startX = lastX = x;
    item.classList.add('dragging');
    onLift?.(item);
    navigator.vibrate?.(10);
  }

  list.addEventListener('pointerdown', e => {
    const grip = e.target.closest(handle);
    if (!grip || !list.contains(grip) || e.button > 0) return;
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch {} // synthetic events have no real pointer
    const item = grip.closest('li');
    lastX = e.clientX;
    lastY = e.clientY;
    if (!holdMs) return lift(item, e.clientX, e.clientY);
    pending = {
      item, x: e.clientX, y: e.clientY, event: e,
      timer: setTimeout(() => {
        if (!pending) return;
        const p = pending;
        pending = null;
        lift(p.item, lastX, lastY);
      }, holdMs),
    };
  });

  list.addEventListener('pointermove', e => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (pending) {
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < 6) return;
      clearTimeout(pending.timer);
      painting = pending.item;
      pending = null;
    }
    if (painting) {
      onPaint?.(painting, rowAt(e.clientY));
      return;
    }
    if (!dragging) return;
    // onDrag may return the sideways shift to show (e.g. snapped to a depth).
    const shown = onDrag?.({ item: dragging, dx: lastX - startX });
    dragging.style.setProperty('--dx', `${shown ?? Math.max(-40, Math.min(40, lastX - startX))}px`);
    place(e.clientY);
    follow(e.clientY);
  });

  const finish = e => {
    if (pending) {
      clearTimeout(pending.timer);
      const { item, event } = pending;
      pending = null;
      if (e.type === 'pointerup') onTap?.(item, event);
      return;
    }
    if (painting) {
      painting = null;
      return;
    }
    if (!dragging) return;
    const item = dragging;
    item.classList.remove('dragging');
    item.style.transform = '';
    item.style.removeProperty('--dx');
    dragging = null;
    onEnd?.({ item, dx: lastX - startX });
  };
  list.addEventListener('pointerup', finish);
  list.addEventListener('pointercancel', finish);

  list.addEventListener('keydown', e => {
    const grip = e.target.closest(handle);
    if (!keyboard || !grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const item = grip.closest('li');
    const target = e.key === 'ArrowUp' ? item.previousElementSibling : item.nextElementSibling;
    if (!target) return;
    if (e.key === 'ArrowUp') target.before(item); else target.after(item);
    onMove?.(item);
    grip.focus();
    onEnd?.({ item, dx: 0 });
  });
}

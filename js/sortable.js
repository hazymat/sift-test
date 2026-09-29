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

// With `anywhere` (a hold in ms): press and hold anywhere on a row (not on its
// buttons or tick box; also while its name is being edited) lifts it too
// (hold.js: the shading, and the keyboard kept down).
// While dragging, the other rows slide out of the way (not jump). onDrag({ item,
// dx, dy }) may return the sideways shift to show (e.g. snapped to a depth).

// With `grid: true` the items sit in rows and columns (cards): the dragged one
// follows the pointer both ways and drops into the card it is over.
//
// With `onOnto(target | null)`, the middle of a row means "onto it" (e.g. make
// it a sub-task) rather than before or after it: the list isn't reordered
// there, onOnto says which row it's over, and onEnd gets it as `onto`. The
// gap it would drop into otherwise has the same dashed outline (.drop-slot),
// so there's always one outline saying where it will land.
import { holdToLift, HOLD_SKIP } from './hold.js';

export function sortable(list, { handle = '.drag-handle', holdMs = 0, anywhere = 0, keyboard = true, grid = false, onMove, onEnd, onTap, onPaint, onLift, onDrag, onOnto } = {}) {
  let onto = null; // the row the dragged one is over the middle of (onOnto)
  const setOnto = el => { if (el === onto) return; onto = el; onOnto?.(el); if (slot) slot.hidden = !!el; };
  let slot = null; // the dashed outline of the gap it will drop into (with onOnto)
  let dragging = null;
  let pending = null; // pressed; waiting to see if it's a tap, swipe or hold
  let painting = null;
  let offsetY = 0;
  let offsetX = 0;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;

  // Hidden rows (e.g. the rest of a group being dragged) don't take part.
  const siblings = () => [...list.children].filter(el => el !== dragging && !el.hidden);

  const rowAt = y => {
    const rows = [...list.children].filter(el => !el.hidden);
    return rows.find(r => { const b = r.getBoundingClientRect(); return y >= b.top && y < b.bottom; })
      || (y < rows[0]?.getBoundingClientRect().top ? rows[0] : rows.at(-1));
  };

  // The other rows slide to their new places rather than jump (from where they're showing now).
  function slid(move) {
    const others = siblings();
    const was = new Map(others.map(el => [el, el.getBoundingClientRect().top]));
    for (const el of others) for (const a of el.getAnimations()) if (a.id === 'make-room') a.cancel();
    move();
    for (const el of others) {
      const d = was.get(el) - el.getBoundingClientRect().top;
      if (Math.abs(d) > 1) el.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 150, easing: 'cubic-bezier(.2, .8, .2, 1)', id: 'make-room' });
    }
  }

  // Where the dragged item's visual centre now is, so the DOM follows it.
  function place(clientY, clientX = 0) {
    if (grid) {
      // The card under the pointer (its middle part, so cards of different sizes don't jitter).
      const under = siblings().find(el => {
        const r = el.getBoundingClientRect();
        return clientX > r.left + r.width * 0.2 && clientX < r.right - r.width * 0.2 && clientY > r.top + r.height * 0.2 && clientY < r.bottom - r.height * 0.2;
      });
      if (!under) return;
      if (dragging.compareDocumentPosition(under) & Node.DOCUMENT_POSITION_PRECEDING) list.insertBefore(dragging, under); else under.after(dragging);
      onMove?.(dragging);
      return;
    }
    if (onOnto) {
      // Over the middle third of a row: onto it, no reordering.
      const over = siblings().find(el => { const r = el.getBoundingClientRect(); return clientY > r.top + r.height / 3 && clientY < r.bottom - r.height / 3; });
      setOnto(over || null);
      if (over) return;
    }
    for (const el of siblings()) {
      const r = el.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const before = dragging.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING;
      if (before && clientY < mid) {
        slid(() => list.insertBefore(dragging, el));
        onMove?.(dragging);
        return;
      }
      if (!before && clientY > mid && el.nextElementSibling !== dragging) {
        slid(() => el.after(dragging));
        onMove?.(dragging);
      }
    }
  }

  function follow(clientY, clientX = 0) {
    // Translate so the item stays under the finger even after DOM moves.
    dragging.style.transform = '';
    const box = dragging.getBoundingClientRect();
    // Where it is in the list, before it's moved to follow the pointer; its corners as the row's are now (e.g. coming out of a group).
    if (slot) Object.assign(slot.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, borderRadius: getComputedStyle(dragging).borderRadius });
    dragging.style.transform = grid
      ? `translate(${clientX - offsetX - box.left}px, ${clientY - offsetY - box.top}px)`
      : `translate(var(--dx, 0px), ${clientY - offsetY - box.top}px) rotate(-.8deg)`; // a slight twist while carried, as in the Day Planner
  }

  function lift(item, x, y) {
    dragging = item;
    offsetY = y - item.getBoundingClientRect().top;
    offsetX = x - item.getBoundingClientRect().left;
    startX = lastX = x;
    startY = lastY = y;
    item.classList.add('dragging');
    onLift?.(item);
    if (onOnto && !grid) {
      slot = document.createElement('div');
      slot.className = 'drop-slot';
      slot.setAttribute('aria-hidden', 'true');
      slot.style.borderRadius = getComputedStyle(item).borderRadius;
      document.body.append(slot);
      follow(y, x);
    }
    navigator.vibrate?.(10);
  }

  // A hold anywhere on a row lifts it too (hold.js).
  const hold = anywhere ? holdToLift(list, {
    rowAt: t => { const li = t.closest('li'); return li && li.parentElement === list && !li.hidden ? li : null; },
    skip: `${handle}, ${HOLD_SKIP}`,
    ms: anywhere,
    busy: () => !!dragging,
    onLift: (li, x, y, pointerId) => {
      li.dispatchEvent(new CustomEvent('sortable-lift', { bubbles: true })); // e.g. its editing pills close
      try { list.setPointerCapture(pointerId); } catch {}
      lastX = x; lastY = y;
      lift(li, x, y);
    },
  }) : null;

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
    if (!grid) {
      const shown = onDrag?.({ item: dragging, dx: lastX - startX, dy: lastY - startY });
      dragging.style.setProperty('--dx', `${shown ?? Math.max(-40, Math.min(40, lastX - startX))}px`);
    }
    place(e.clientY, e.clientX);
    follow(e.clientY, e.clientX);
  });

  const finish = e => {
    hold?.cancel();
    hold?.letGo();
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
    slot?.remove();
    slot = null;
    item.classList.remove('dragging');
    item.style.transform = '';
    item.style.removeProperty('--dx');
    dragging = null;
    const target = onto;
    if (onto) setOnto(null);
    onEnd?.({ item, dx: lastX - startX, onto: target });
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

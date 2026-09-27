// Open an item's panel without reaching for the ⋯ on the far right:
//   press and hold (mouse or touch) on the item's text, or
//   Alt+Enter while typing in it.
// A short click still just edits the text in place. Works for every list
// whose rows carry a details button (Day Planner, Tasks, Find Things, Lists).

const TITLE = '.item-title, .task-title, .item-list input[name="name"]';
const ROW = 'li[data-id], li[data-task], .line.has-item[data-item]';
const DETAILS = '[data-act="details"], [data-act="item-details"]';
const HOLD_MS = 450;

function openFor(title) {
  const row = title.closest(ROW);
  const btn = row?.querySelector(`:scope > ${DETAILS}, :scope > .content > ${DETAILS}, ${DETAILS}`);
  if (!btn) return false;
  btn.click();
  return true;
}

export function installHoldToOpen() {
  let hold = null;
  const cancel = () => {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold.row?.classList.remove('holding');
    hold = null;
  };

  document.addEventListener('pointerdown', ev => {
    const title = ev.target.closest?.(TITLE);
    if (!title || ev.button > 0) return;
    const row = title.closest(ROW);
    cancel();
    hold = {
      x: ev.clientX, y: ev.clientY, row,
      timer: setTimeout(() => {
        const h = hold;
        hold = null;
        h?.row?.classList.remove('holding');
        if (openFor(title)) {
          // Don't let the release place a caret or start a selection.
          const stop = e => {
            if (!title.contains(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            document.removeEventListener('click', stop, true);
          };
          document.addEventListener('click', stop, true);
          setTimeout(() => document.removeEventListener('click', stop, true), 800);
          navigator.vibrate?.(10);
        }
      }, HOLD_MS),
    };
    row?.classList.add('holding');
  }, true);
  document.addEventListener('pointermove', ev => {
    if (hold && Math.hypot(ev.clientX - hold.x, ev.clientY - hold.y) > 8) cancel();
  }, true);
  for (const type of ['pointerup', 'pointercancel', 'scroll']) document.addEventListener(type, cancel, true);

  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || !ev.altKey) return;
    const title = ev.target.closest?.(TITLE);
    if (!title) return;
    ev.preventDefault();
    ev.stopPropagation();
    title.dispatchEvent(new Event('change', { bubbles: true })); // keep what was typed
    openFor(title);
  }, true);
}

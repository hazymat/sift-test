// Bottom sheets (<dialog class="sheet">), the same everywhere: close one by
// dragging its handle down, tapping outside it, or Esc (no ✕, by request).
// Views that need to know listen for the dialog's `close` event.

const DRAG_CLOSE = 110; // px pulled down that closes it (or a quick flick)

function drag(ev) {
  const handle = ev.target.closest('dialog.sheet[open] > .sheet-handle');
  if (!handle || ev.button > 0) return;
  const dlg = handle.parentElement;
  const y0 = ev.clientY;
  const t0 = ev.timeStamp;
  let dy = 0;
  handle.setPointerCapture?.(ev.pointerId);
  dlg.style.transition = 'none';
  const move = e => {
    dy = Math.max(0, e.clientY - y0);
    dlg.style.transform = dy ? `translateY(${dy}px)` : '';
  };
  const up = e => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    const flick = dy > 30 && dy / Math.max(1, e.timeStamp - t0) > 0.6;
    dlg.style.transition = 'transform .18s ease';
    if (e.type === 'pointerup' && (dy > Math.min(DRAG_CLOSE, dlg.offsetHeight / 3) || flick)) {
      dlg.style.transform = `translateY(${dlg.offsetHeight}px)`;
      setTimeout(() => { dlg.close(); dlg.style.transform = ''; dlg.style.transition = ''; }, 180);
    } else {
      dlg.style.transform = '';
    }
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}

let installed = false;
export function installSheets() {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerdown', drag);
  document.addEventListener('click', ev => {
    const dlg = ev.target;
    if (!(dlg instanceof HTMLDialogElement) || !dlg.matches('.sheet[open]')) return;
    const r = dlg.getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) dlg.close(); // tapped outside
  });
}

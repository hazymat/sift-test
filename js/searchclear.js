// Every search box (input.search) gets a ✕ inside it while it has text.
// Tapping it empties the box and tells the page (an `input` event), so the
// page goes back to showing everything. Phones have no Esc key, and iPhone
// Safari shows no clear button of its own.

function wrap(input) {
  input.dataset.clear = '';
  const box = document.createElement('span');
  box.className = 'search-wrap';
  input.replaceWith(box);
  box.append(input);
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'search-x';
  x.setAttribute('aria-label', 'Clear search');
  x.textContent = '✕';
  x.hidden = !input.value;
  box.append(x);
}

let installed = false;
export function installSearchClear() {
  if (installed) return;
  installed = true;
  const scan = () => { for (const i of document.querySelectorAll('input.search:not([data-clear])')) wrap(i); };
  new MutationObserver(scan).observe(document.body, { subtree: true, childList: true });
  scan();
  const sync = i => { const x = i.parentElement?.querySelector(':scope > .search-x'); if (x) x.hidden = !i.value; };
  document.addEventListener('input', ev => { if (ev.target.matches?.('input.search')) sync(ev.target); });
  // Pages also set the value themselves (Esc, a search carried into a box).
  document.addEventListener('keyup', ev => { if (ev.target.matches?.('input.search')) sync(ev.target); });
  document.addEventListener('focusin', ev => { if (ev.target.matches?.('input.search')) sync(ev.target); });
  document.addEventListener('pointerdown', ev => { if (ev.target.closest?.('.search-x')) ev.preventDefault(); }); // keep the keyboard where it is
  document.addEventListener('click', ev => {
    const x = ev.target.closest?.('.search-x');
    if (!x) return;
    const i = x.parentElement.querySelector('input.search');
    i.value = '';
    x.hidden = true;
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.blur();
  });
}

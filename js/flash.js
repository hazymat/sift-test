// "Here it is": after following a link to an item in a list (a task from a
// note, the note a task came from, …), that item's outline pulses yellow five
// times, then stops. One look, used everywhere.
//
//   pointTo(collection, id)   before changing page: which item to show
//   flash(el, { scroll, pulses, colour, strength, ms, width, glow })
//                             pulse an element now. scroll: true (to the
//                             middle), 'nearest' (only if out of view) or false;
//                             colour 'r g b'; strength 0 to 1; ms per pulse;
//                             width of the ring and glow (blur), in px.
//                             inset: the ring inside the element (not clipped by
//                             a scrolling parent); radius: its corners, in px.
//   SOFT                      a gentler look: one thin blue pulse (e.g. a task
//                             just added)
//   RING                      one crisp light blue 1px ring, no glow (e.g. the tab
//                             a swipe lands on)
//   WASH                      one flash of see-through yellow filling it (e.g. the
//                             tab a swipe lands on)
//   unflash(el)               stop its pulse now
//
// installFlash() (from app.js) watches for the item to appear after the page
// changes, since views draw a moment after the address changes.

const KEY = 'sift:focus';
const PULSE_MS = 700;
const PULSES = 5;

// Where each kind of item is drawn.
const FIND = {
  tasks: id => `#main li[data-task="${id}"]`,
  thoughts: id => `#main li.thought[data-id="${id}"]`,
  capture: () => '#main .dump-capture', // the New note box (a note not saved yet)
  day_items: id => `#main .line[data-item="${id}"]`,
  items: id => `#main li[data-item="${id}"]`,
  list_items: id => `#main .checklist li[data-id="${id}"]`,
  contacts: id => `#main [data-contact-card="${id}"], #main .c-page[data-contact="${id}"]`,
};

export const SOFT = { pulses: 1, colour: '60 125 230', strength: .7, ms: 1100, width: 1.5, glow: 8 };

export const WASH = { pulses: 1, colour: '255 224 70', strength: .55, ms: 450, width: 60, glow: 0, inset: true, radius: 8 }; // width: enough ring to fill it
export const RING = { pulses: 1, colour: '125 195 255', strength: 1, ms: 900, width: 1, glow: 0, inset: true, radius: 8 };

export function flash(el, { scroll = true, pulses = PULSES, colour = null, strength = 1, ms = PULSE_MS, width = 3, glow = 18, inset = false, radius = 12 } = {}) {
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth; // restart the animation
  el.style.setProperty('--flash-n', pulses);
  el.style.setProperty('--flash-ms', `${ms}ms`);
  el.style.setProperty('--flash-a', strength);
  el.style.setProperty('--flash-w', `${width}px`);
  el.style.setProperty('--flash-glow', `${glow}px`);
  el.style.setProperty('--flash-radius', `${radius}px`);
  if (inset) el.style.setProperty('--flash-inset', 'inset'); else el.style.removeProperty('--flash-inset');
  if (colour) el.style.setProperty('--flash-rgb', colour); else el.style.removeProperty('--flash-rgb');
  el.classList.add('flash');
  if (scroll) el.scrollIntoView({ block: scroll === 'nearest' ? 'nearest' : 'center', behavior: 'smooth' });
  clearTimeout(el._flashT);
  el._flashT = setTimeout(() => el.classList.remove('flash'), ms * pulses + 100);
}

export function unflash(el) {
  if (!el) return;
  clearTimeout(el._flashT);
  el.classList.remove('flash');
}

export function pointTo(collection, id) {
  try { sessionStorage.setItem(KEY, `${collection}:${id}`); } catch { /* the page still opens */ }
  lookSoon();
}

let timer = null;
function lookSoon() {
  clearInterval(timer);
  const until = Date.now() + 4000;
  timer = setInterval(() => {
    let want;
    try { want = sessionStorage.getItem(KEY); } catch { want = null; }
    if (!want || Date.now() > until) { clearInterval(timer); if (want) try { sessionStorage.removeItem(KEY); } catch { /* fine */ } return; }
    const at = want.indexOf(':');
    const find = FIND[want.slice(0, at)];
    const el = find && document.querySelector(find(CSS.escape(want.slice(at + 1))));
    if (!find) { try { sessionStorage.removeItem(KEY); } catch { /* fine */ } return; }
    if (!el) return;
    try { sessionStorage.removeItem(KEY); } catch { /* fine */ }
    clearInterval(timer);
    flash(el);
  }, 150);
}

export function installFlash() {
  addEventListener('hashchange', lookSoon);
  lookSoon();
}

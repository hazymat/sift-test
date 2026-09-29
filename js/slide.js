// The page slides sideways, as a phone's own screens do: the old page out and
// the next one in over it from the side (View Transitions: iOS 18 on, and
// Chrome; before that the next one just slides in). Used for side swipes on a
// phone (app.js) and for Brain Dump's filters. Only what changes slides (the
// tasks, the notes, the day); the rest stays put (app.css names the parts),
// and a tab bar's highlight glides from the old tab to the new one, then
// flashes once, see-through yellow (flash.js), with the bar scrolled to show it and the
// tab past it. Another swipe straight away stops the last one's glide and ring.
//
//   slide(forward, change)  change(): makes the change and resolves once it's
//                           drawn, or rejects when there was nothing to change
//                           to (then the page gives a nudge instead)
//   drawnAfter(fn)          runs fn, then resolves once #main has been drawn
//                           again, or rejects if nothing changed
//   nudge(forward)          a small push that goes nowhere: "nothing that way"

import { flash, unflash, WASH } from './flash.js';

const main = () => document.getElementById('main');
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// The part of the page that changes (app.css: the same list).
const region = () => document.querySelector('#task-body, #thoughts, #main .planner') || main();

// A tab bar's highlight (the underline under Now, or a filter) glides from
// where it was to the new tab; the real one shows again when it gets there.
const tabBar = () => Array.from(document.querySelectorAll('#main [role="tablist"], #main #dump-filter')).find(b => b.offsetParent) || null;
const pressedIn = bar => bar?.querySelector('[aria-pressed="true"], [aria-selected="true"]') || null;
let gliding = null; // the glide under way: { bar, ghost }
function stopGlide() {
  const bar = gliding?.bar || tabBar();
  gliding?.ghost.remove();
  gliding = null;
  bar?.classList.remove('glide-on');
  for (const tab of bar?.querySelectorAll('.flash') || []) unflash(tab);
}
// The bar scrolls (if it does) to show the chosen tab and the ones either side of it.
function keepInView(bar, to) {
  if (!bar || !to || bar.scrollWidth <= bar.clientWidth + 1) return;
  const b = bar.getBoundingClientRect(), at = el => el.getBoundingClientRect().left - b.left - bar.clientLeft + bar.scrollLeft;
  const tab = el => (el && !el.classList.contains('tab-glide') && el.offsetParent ? el : null);
  const first = tab(to.previousElementSibling) || to, last = tab(to.nextElementSibling) || to;
  let left = bar.scrollLeft;
  const lo = at(first), hi = at(last) + last.offsetWidth;
  if (hi > left + bar.clientWidth) left = hi - bar.clientWidth;
  if (lo < left) left = lo;
  if (Math.abs(left - bar.scrollLeft) > 1) bar.scrollTo({ left, behavior: still() ? 'auto' : 'smooth' });
}
function glide(from) {
  stopGlide();
  const bar = tabBar(), to = pressedIn(bar);
  if (!from || !to || still()) return keepInView(bar, to);
  const z = to.getBoundingClientRect();
  if (Math.abs(z.left - from.left) < 1) return keepInView(bar, to);
  // Its look, read before the real one is hidden (app.css: .glide-on).
  const cs = getComputedStyle(to), look = {
    background: cs.backgroundColor, borderRadius: cs.borderRadius,
    border: `${cs.borderTopWidth} solid ${cs.borderTopColor}`, borderBottom: `${cs.borderBottomWidth} solid ${cs.borderBottomColor}`,
  };
  // Inside the bar (so it's drawn with it, and scrolls with it), placed where the new tab is.
  bar.classList.add('glide-on');
  const b = bar.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'tab-glide';
  Object.assign(ghost.style, look, { left: `${z.left - b.left - bar.clientLeft + bar.scrollLeft}px`, top: `${z.top - b.top - bar.clientTop + bar.scrollTop}px`, width: `${z.width}px`, height: `${z.height}px` });
  bar.append(ghost);
  const mine = gliding = { bar, ghost };
  keepInView(bar, to);
  // Arrived: the real one shows again and flashes, unless another swipe has taken over (or it isn't the chosen tab now).
  const done = () => {
    if (gliding !== mine) return;
    ghost.remove(); bar.classList.remove('glide-on'); gliding = null;
    if (to.isConnected && to === pressedIn(bar)) flash(to, Object.assign({}, WASH, { scroll: false }));
  };
  ghost.animate([{ transform: `translate(${from.left - z.left}px, ${from.top - z.top}px)`, width: `${from.width}px` }, { transform: 'none', width: `${z.width}px` }],
    { duration: 300, easing: 'cubic-bezier(.2, .8, .2, 1)' }).finished.then(done, done);
}

export function drawnAfter(fn) {
  const el = main();
  return new Promise((done, none) => {
    let changed = false, over = false, quiet = 0;
    const finish = () => { if (over) return; over = true; seen.disconnect(); changed ? done() : none(); };
    const seen = new MutationObserver(() => { changed = true; clearTimeout(quiet); quiet = setTimeout(finish, 30); });
    seen.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
    fn();
    quiet = setTimeout(finish, 120);
    setTimeout(finish, 600);
  });
}

export function nudge(forward) {
  if (still()) return;
  region().animate([{ transform: 'none' }, { transform: `translateX(${forward ? -24 : 24}px)` }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
}

export function slide(forward, whenDone) {
  stopGlide(); // a swipe straight after another: the last one's glide and ring stop now
  const was = pressedIn(tabBar())?.getBoundingClientRect(); // before the bar is drawn again
  const change = () => Promise.resolve(whenDone()).then(() => glide(was));
  if (still()) return change().catch(() => {});
  if (document.startViewTransition) {
    const root = document.documentElement;
    root.dataset.slide = forward ? 'next' : 'back'; // app.css: which way the snapshots go
    const moving = document.startViewTransition(change);
    moving.updateCallbackDone.catch(() => nudge(forward));
    moving.ready.catch(() => {}); // nothing to go to: skipped, which isn't an error
    const after = () => { delete root.dataset.slide; };
    return moving.finished.then(after, after);
  }
  return change().then(
    () => { region().animate([{ transform: `translateX(${forward ? 40 : -40}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2, .8, .2, 1)' }); },
    () => nudge(forward));
}

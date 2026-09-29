// A note that saves itself as you type: `trigger()` after every change starts
// (or restarts) a short pause before `save()` runs, so quick typing doesn't
// hit the database on every keystroke; `flush()` runs it right away instead
// (leaving the box). Every note editor in the app saves this way.
//
// `flushAll()` saves every note still waiting on its pause: before a reload,
// on changing page, and when the app goes into the background (a phone may
// close it there without warning).
const waiting = new Set();

export function debounced(save, delay = 700) {
  let timer = null;
  const d = {
    trigger() { clearTimeout(timer); waiting.add(d); timer = setTimeout(d.flush, delay); },
    flush() { clearTimeout(timer); timer = null; waiting.delete(d); return save(); },
  };
  return d;
}

export function flushAll() {
  return Promise.all([...waiting].map(d => d.flush()));
}

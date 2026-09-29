// Development check (not part of the app, not in the service worker): visits
// every page, tries the 👁 view options, opens the first item's panel and a
// few menus, goes through the Scans and Contracts filters and opens the first
// scan's and contract's own page, and reports any errors, plus "undefined" / "NaN" / "[object"
// showing on the page. Run it in the browser (the pane) before committing:
//
//   (await import('/js/smoke.js')).run()        → { pages, errors, problems, skipped }
//
// It only looks and opens things; it never saves, ticks or deletes. The view
// options it tries are put back as they were.

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function run({ wait = 600 } = {}) {
  const errors = [];
  const problems = [];
  const skipped = [];
  let where = 'start';
  const onError = e => errors.push(`${where}: ${e.message || e}`);
  const onRejection = e => errors.push(`${where}: ${e.reason?.message || e.reason}`);
  const consoleError = console.error;
  console.error = (...a) => { errors.push(`${where}: ${a.map(String).join(' ')}`); consoleError(...a); };
  addEventListener('error', onError);
  addEventListener('unhandledrejection', onRejection);

  const { AREAS } = await import('./app.js');
  const pages = [];
  const visit = async hash => {
    where = hash;
    location.hash = hash;
    await sleep(wait);
    pages.push(hash);
    look(hash);
  };
  const look = label => {
    const text = document.querySelector('#main')?.innerText || '';
    for (const bad of ['undefined', 'NaN', '[object']) if (text.includes(bad)) problems.push(`${label}: shows "${bad}"`);
  };
  const click = async (el, label) => {
    if (!el) return;
    where = `${location.hash} → ${label}`;
    el.click();
    await sleep(wait / 2);
  };
  const escape = async () => {
    // Like a real key press: it starts at an element (the focused one, or the page).
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.activeElement?.blur?.();
    await sleep(wait / 3);
  };

  try {
    const hashes = [];
    for (const a of AREAS) hashes.push(`#/${a.slug || a.id}`);
    hashes.push('#/tasks/now', '#/tasks/next', '#/tasks/later', '#/tasks/list', '#/tasks/done', '#/tasks/projects', '#/planner/2031-01-01', '#/history', '#/bin/archive/dump');
    for (const hash of hashes) {
      await visit(hash);
      const main = document.querySelector('#main');
      if (!main) continue;
      // Every Look and Spacing, then back to how it was.
      for (const group of ['[data-shade-set]', '[data-density-set]']) {
        const buttons = [...main.querySelectorAll(group)];
        const was = buttons.find(b => b.getAttribute('aria-pressed') === 'true');
        for (const b of buttons) await click(b, `${group} ${b.dataset.shadeSet || b.dataset.densitySet}`);
        if (was) await click(was, 'restore view');
      }
      // The first item's panel, then close it.
      await click(main.querySelector('[data-act="details"], [data-act="item-details"]'), 'open first item');
      await escape();
      // Brain Dump: open the first note for writing, then leave it.
      await click(main.querySelector('.thought-body'), 'edit first note');
      await escape();
      // Find Things / Lists: open the first box or list, then come back.
      const first = main.querySelector('.box-card[data-box], a.list-card');
      if (first) { await click(first, 'open first box / list'); await sleep(wait); history.back(); await sleep(wait); }
      // Scans and Contracts: each filter (Scans' kinds, Contracts' Current / Ended…), then back.
      const filter = main.querySelector('.scans, .contracts') && '[data-kind], [data-view]';
      if (filter) {
        const was = main.querySelector(`:is(${filter})[aria-pressed="true"]`);
        const names = [...main.querySelectorAll(filter)].map(b => [b.dataset.kind ? 'kind' : 'view', b.dataset.kind || b.dataset.view]);
        for (const [key, value] of names) { await click(main.querySelector(`[data-${key}="${value}"]`), `filter ${value}`); look(`${hash} filter ${value}`); }
        if (was) await click(main.querySelector(`[data-${was.dataset.kind ? 'kind' : 'view'}="${was.dataset.kind || was.dataset.view}"]`), 'restore filter');
        // The first scan's or contract's own page, then back to the list.
        const own = main.querySelector('a.scan-card[data-id], .contracts tr[data-id]');
        if (own) { await click(own, 'open first'); await sleep(wait); look(`${location.hash} (own page)`); history.back(); await sleep(wait); }
        else skipped.push(`${hash}: none yet, so no own page opened`);
      }
    }
  } finally {
    removeEventListener('error', onError);
    removeEventListener('unhandledrejection', onRejection);
    console.error = consoleError;
  }
  return { pages: pages.length, errors, problems, skipped };
}

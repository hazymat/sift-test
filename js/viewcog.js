// The 👁 view menu every page has (same style as the Day Planner's). It always
// offers Spacing: tight / medium / loose, remembered per page on this device,
// and on pages with lists of things a Look: Original, Multicolour (each item
// in its own soft colour) and/or Alternate shading (every other item a touch
// darker). The look is remembered the same way and put on <main data-shade>.
// Pages can add their own sections above it. Some pages have a Layout: on /
// off switches (all off by default), remembered the same way, put on <main> as
// data-layout-<id> and announced with a "sift-layout" event on document.
//
//   cogHtml(extraSectionsHtml)   the 👁 view button and its menu, for a page header
//   spacingHtml(area)            just the Spacing section (the Day Planner adds
//                                it to its own menu)
//   installViewCog(getArea)      once, in app.js: wires the switch and applies
//                                each page's spacing to <main data-density>
//
// Sync: every view choice is also kept in the settings record (so it syncs),
// one copy for phones and one for computers (view_phone:<key>, view_computer:<key>).
// The latest change wins. "Keep this device's view separate" (this device only)
// stops sending and receiving them.

export const DENSITIES = [
  { id: 'tight', label: 'Tight', icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 7h12M2 10h12M2 13h12"/></svg>' },
  { id: 'medium', label: 'Medium', icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12M2 8h12M2 12.5h12"/></svg>' },
  { id: 'loose', label: 'Loose', icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12M2 13h12"/><path d="M2 8h8" opacity=".55"/></svg>' },
];

// Which looks each page offers (the first is the default).
const LOOKS = {
  dump: ['plain', 'colour', 'alt'],
  places: ['plain', 'colour', 'alt'],
  contacts: ['plain', 'colour', 'alt'],
  lists: ['plain', 'colour', 'alt'],
  tasks: ['plain', 'alt'],
  planner: ['plain', 'alt'],
};
import * as store from './store.js';

const kind = () => Math.min(screen.width, screen.height) < 600 ? 'phone' : 'computer';
const SEPARATE = 'sift-view-separate';
const separate = () => { try { return siftTestStorage.getItem(SEPARATE) === '1'; } catch { return false; } };
const isViewKey = k => /^sift-(layout|shade|density):/.test(k);
// A view choice: kept on this device and, unless it's kept separate, synced to the same kind of device.
function saveView(k, value) {
  try { siftTestStorage.setItem(k, value); } catch { /* not kept */ }
  if (!separate()) store.updateSettings({ [`view_${kind()}:${k}`]: value }).catch(err => console.warn('View setting not synced:', err));
}
// The synced view choices for this kind of device onto this device. True if any changed.
async function pullViews() {
  if (separate()) return false;
  const settings = await store.getSettings();
  const prefix = `view_${kind()}:`;
  let changed = false;
  for (const [field, value] of Object.entries(settings)) {
    const k = field.slice(prefix.length);
    if (!field.startsWith(prefix) || !isViewKey(k) || typeof value !== 'string') continue;
    try { if (siftTestStorage.getItem(k) !== value) { siftTestStorage.setItem(k, value); changed = true; } } catch { /* not kept */ }
  }
  return changed;
}
export function separateHtml() {
  return `<div class="layout-opts view-separate"><label class="layout-opt"><input type="checkbox" data-view-separate${separate() ? ' checked' : ''}> Keep this device's view separate</label></div>`;
}

const LOOK_LABEL = { plain: 'Original', colour: 'Multicolour', alt: 'Alternate shading' };
const shadeKey = area => `sift-shade:${area}`;
export function shadeOf(area) {
  const opts = LOOKS[area];
  if (!opts) return 'plain';
  try { const v = siftTestStorage.getItem(shadeKey(area)); return opts.includes(v) ? v : opts[0]; } catch { return opts[0]; }
}
export function lookHtml(area) {
  const opts = LOOKS[area];
  if (!opts) return '';
  const on = shadeOf(area);
  return `<h4>Look</h4>
    <div class="view-opts shade-opts" role="group" aria-label="Look">
      ${opts.map(o => `<button type="button" data-shade-set="${o}" aria-pressed="${o === on}">${LOOK_LABEL[o]}</button>`).join('')}
    </div>`;
}

// Layout switches per page (trying out layouts; the labels are rough for now).
// needs: a switch that only works with another on: shown under it (indented, joined by a
// line) only while that one is ticked. def: true for one that starts on.
const LAYOUTS = {
  tasks: [
    { id: 'lined', label: 'Lined Paper' },
    { id: 'new-top', label: 'New task line at the top', needs: 'lined' },
    { id: 'margin', label: 'Show margin', needs: 'lined' },
    { id: 'empty-lines', label: 'Show additional lines when list is empty', def: true, needs: 'lined' },
    { id: 'new-focus', label: 'Start typing a new task on arriving', def: true },
    { id: 'add-top', label: 'New tasks appear at top', def: true },
    { id: 'added-flash', label: 'Highlight task when added', def: true },
    { id: 'pills-hide', label: 'Hide pills behind More (editing / new)', def: true },
    { id: 'more-panel', label: 'More goes straight to the full panel', needs: 'pills-hide' },
  ],
  planner: [
    { id: 'day-rel', label: 'Show "Today" or "In 5 days" under the date', def: true },
    { id: 'carry', label: 'Show unfinished items from earlier days' },
    { id: 'achievements', label: 'Show achievement count when tasks completed' },
    { id: 'focus', label: 'Show day focus', def: true },
    { id: 'energy', label: 'Show energy', def: true },
    { id: 'gcal', label: 'Show Google Calendar' },
  ],
};
const layoutKey = (area, id) => `sift-layout:${area}:${id}`;
export function layoutOn(area, id) {
  const needs = LAYOUTS[area]?.find(o => o.id === id)?.needs;
  if (needs && !layoutOn(area, needs)) return false;
  return setOn(area, id);
}
function setOn(area, id) {
  const def = !!LAYOUTS[area]?.find(o => o.id === id)?.def;
  try { const v = siftTestStorage.getItem(layoutKey(area, id)); return v === null ? def : v === '1'; } catch { return def; }
}
export function layoutHtml(area, heading = true) {
  const opts = LAYOUTS[area];
  if (!opts) return '';
  return `${heading ? '<h4>Layout</h4>' : ''}
    <div class="layout-opts" role="group" aria-label="Layout">
      ${opts.map(o => `<label class="layout-opt${o.needs ? ' layout-sub' : ''}"${o.needs && !setOn(area, o.needs) ? ' hidden' : ''}><input type="checkbox" data-layout-set="${o.id}"${o.needs ? ` data-layout-needs="${o.needs}"` : ''}${setOn(area, o.id) ? ' checked' : ''}> ${o.label}</label>`).join('')}
    </div>`;
}

const key = area => `sift-density:${area}`;
export function densityOf(area) {
  try { return siftTestStorage.getItem(key(area)) || 'medium'; } catch { return 'medium'; }
}

export function spacingHtml(area) {
  const on = densityOf(area);
  return `<h4>Spacing</h4>
    <div class="view-opts density-opts" role="group" aria-label="Spacing">
      ${DENSITIES.map(d => `<button type="button" class="density-btn" data-density-set="${d.id}" aria-pressed="${d.id === on}" title="${d.label}" aria-label="${d.label}">${d.icon}</button>`).join('')}
    </div>`;
}

export function cogHtml(area, extra = '') {
  return `<details class="tool-menu view-menu page-cog">
      <summary class="icon-btn" aria-label="View settings" title="View settings"><svg class="icon" aria-hidden="true"><use href="#i-view"/></svg></summary>
      <div class="menu view-settings">${extra}${layoutHtml(area)}${lookHtml(area)}${spacingHtml(area)}${separateHtml()}</div>
    </details>`;
}

export function installViewCog(getArea) {
  const apply = () => {
    const main = document.querySelector('#main');
    if (!main) return;
    main.dataset.density = densityOf(getArea());
    main.dataset.shade = shadeOf(getArea());
    for (const o of LAYOUTS[getArea()] || []) main.toggleAttribute(`data-layout-${o.id}`, layoutOn(getArea(), o.id));
  };
  // Another device's (or tab's) view choices arrived: the page follows them.
  const follow = async () => {
    if (!(await pullViews())) return;
    apply();
    for (const m of document.querySelectorAll('.view-settings')) {
      for (const b of m.querySelectorAll('[data-layout-set]')) b.checked = setOn(getArea(), b.dataset.layoutSet);
      for (const b of m.querySelectorAll('[data-layout-needs]')) b.closest('.layout-opt').hidden = !setOn(getArea(), b.dataset.layoutNeeds);
      for (const b of m.querySelectorAll('[data-shade-set]')) b.setAttribute('aria-pressed', String(b.dataset.shadeSet === shadeOf(getArea())));
      for (const b of m.querySelectorAll('[data-density-set]')) b.setAttribute('aria-pressed', String(b.dataset.densitySet === densityOf(getArea())));
    }
    document.dispatchEvent(new CustomEvent('sift-layout', { detail: { area: getArea(), id: null } }));
  };
  store.subscribe(change => { if (change?.collection === 'settings') follow(); });
  follow();
  document.addEventListener('change', ev => {
    const sep = ev.target.closest?.('[data-view-separate]');
    if (sep) {
      try { siftTestStorage.setItem(SEPARATE, sep.checked ? '1' : '0'); } catch { /* not kept */ }
      for (const b of document.querySelectorAll('[data-view-separate]')) b.checked = sep.checked;
      if (!sep.checked) follow(); // back in step: this device takes the shared view
      return;
    }
    const box = ev.target.closest?.('[data-layout-set]');
    if (!box) return;
    saveView(layoutKey(getArea(), box.dataset.layoutSet), box.checked ? '1' : '0');
    for (const sub of box.closest('.layout-opts').querySelectorAll(`[data-layout-needs="${box.dataset.layoutSet}"]`)) sub.closest('.layout-opt').hidden = !box.checked;
    apply();
    document.dispatchEvent(new CustomEvent('sift-layout', { detail: { area: getArea(), id: box.dataset.layoutSet } }));
  });
  document.addEventListener('click', ev => {
    const sh = ev.target.closest?.('[data-shade-set]');
    if (sh) {
      saveView(shadeKey(getArea()), sh.dataset.shadeSet);
      for (const x of sh.parentElement.querySelectorAll('[data-shade-set]')) x.setAttribute('aria-pressed', String(x === sh));
      apply();
      return;
    }
    const b = ev.target.closest?.('[data-density-set]');
    if (!b) return;
    saveView(key(getArea()), b.dataset.densitySet);
    for (const x of b.parentElement.querySelectorAll('[data-density-set]')) x.setAttribute('aria-pressed', String(x === b));
    apply();
  });
  return apply;
}

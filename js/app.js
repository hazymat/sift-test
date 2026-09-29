import * as store from './store.js';
import { slide, drawnAfter, nudge } from './slide.js';
import { installInlineEditing } from './inline.js';
import { installRefLinks } from './refs.js';
import { installHoldToOpen } from './holdopen.js';
import { installSheets } from './sheets.js';
import { installSearchClear } from './searchclear.js';
import { installFlash } from './flash.js';
import { mountSearch } from './search.js';
import { installViewCog } from './viewcog.js';
import { installShare } from './share.js';
import { installDropdowns, installMenuFlip } from './dropdown.js';
import { installFileDrop } from './attachments.js';
import { flushAll } from './autosave.js';
import { installBrowse } from './browse.js';
import { word, applyWords } from './words.js';

// Adding an area is one entry here plus a view module (spec §5.1). Names come
// from the Dictionary (words.js), so people can call them what they like.
export const AREAS = [
  { id: 'dump', get label() { return word('area_dump'); }, icon: 'i-dump', view: './views/dump.js' },
  { id: 'tasks', get label() { return word('area_tasks'); }, icon: 'i-tasks', view: './views/tasks.js' },
  { id: 'planner', get label() { return word('area_planner'); }, icon: 'i-planner', view: './views/planner.js' },
  { id: 'lists', get label() { return word('area_lists'); }, icon: 'i-lists', view: './views/lists.js' },
  // Internally "places" (saved nav order etc. use it); the address is #/find-things.
  { id: 'places', slug: 'find-things', get label() { return word('area_places'); }, icon: 'i-places', view: './views/places.js' },
  { id: 'contacts', get label() { return word('area_contacts'); }, icon: 'i-contacts', view: './views/contacts.js' },
  { id: 'scans', get label() { return word('area_scans'); }, icon: 'i-scans', view: './views/scans.js' },
  { id: 'contracts', get label() { return word('area_contracts'); }, icon: 'i-contracts', view: './views/contracts.js' },
  { id: 'recipes', get label() { return word('area_recipes'); }, icon: 'i-recipes', view: './views/recipes.js' },
  // Archive and Bin together; in the nav just before Settings unless moved.
  { id: 'bin', get label() { return word('area_bin'); }, icon: 'i-archive', view: './views/bin.js' },
  { id: 'settings', label: 'Settings', icon: 'i-settings', view: './views/settings.js', pinnable: false },
  // Not in the nav: reached from each area's ⋯ menu and from Settings.
  { id: 'history', label: 'History', icon: 'i-history', view: './views/history.js', pinnable: false, hidden: true },
  // Not in the nav either: the first time Sift is opened (firstVisit below).
  { id: 'welcome', label: 'Welcome', icon: 'i-dump', view: './views/welcome.js', pinnable: false, hidden: true },
];

export const MAX_PINNED = 4;
// The first one is where the app opens.
const DEFAULT_PINNED = ['dump', 'tasks', 'planner', 'lists'];
const OLD_DEFAULT = 'tasks,dump,places,scans'; // before 2026-09-24: moved to the new default

const $ = sel => document.querySelector(sel);
const area = id => AREAS.find(a => a.id === id || a.slug === id);
const path = a => a.slug || a.id; // what the address bar shows
const icon = (id, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

let pinned = DEFAULT_PINNED;
let current = null;
let currentView = null;
let applyDensity = () => {};

export function pinnedAreas() {
  return pinned;
}

export async function setPinned(ids) {
  pinned = ids.filter(id => area(id)?.pinnable !== false).slice(0, MAX_PINNED);
  await store.updateSettings({ pinned_areas: pinned });
  renderNav();
}

// ---------- theme ----------

// A theme is a look (colours: data-theme, one of blue / dark / light, or
// auto) plus fonts (data-fonts: plain, or fancy = handwriting for notes and
// lists too). Plain keeps the handwriting only for the Day Planner's day title
// and its labels (Day focus, Energy, Schedule, Tasks, Notes). More themes can
// be added here: `swatches` and `fonts` draw the preview in Settings.
// Custom starts from one of the others (its base) and adds the user's own
// fonts and colours (customtheme.js).
export const THEMES = [
  { id: 'glass', label: 'Glass – Default', look: 'blue', fonts: 'plain', swatches: ['#0f172a', '#2a4a8a', '#9cc4ff'] },
  { id: 'glass-fancy', label: 'Glass – Fancy', look: 'blue', fonts: 'fancy', swatches: ['#0f172a', '#2a4a8a', '#9cc4ff'] },
  { id: 'dark', label: 'Dark', look: 'dark', fonts: 'plain', swatches: ['#121316', '#26282d', '#9cc4ff'] },
  { id: 'light', label: 'Light', look: 'light', fonts: 'plain', swatches: ['#eef2f8', '#ffffff', '#1f5fd1'] },
  { id: 'auto', label: 'Auto', look: 'auto', fonts: 'plain', swatches: ['#eef2f8', '#0f172a', '#1f5fd1'], note: 'Light by day, Glass at night, following your device.' },
  { id: 'custom', label: 'Custom…', look: 'blue', fonts: 'plain', swatches: ['#f6e7a6', '#8fdcaa', '#ff8a8a'] },
];
// Saved before themes had fonts: "blue" was Glass.
const OLD = { blue: 'glass' };
const themeOf = id => THEMES.find(t => t.id === (OLD[id] || id)) || THEMES[0];
const THEME_COLOURS = { blue: '#0f172a', dark: '#121316', light: '#eef2f8' };
const prefersLight = matchMedia('(prefers-color-scheme: light)');
let theme = 'glass';
let custom = { base: 'glass', values: {} };
let customCss = null; // customtheme.js, loaded when first needed

export function customTheme() {
  return custom;
}

async function customStyle() {
  customCss ||= await import('./customtheme.js');
  let el = document.getElementById('custom-theme-css');
  if (!el) { el = document.createElement('style'); el.id = 'custom-theme-css'; document.head.append(el); }
  el.textContent = customCss.css(custom.values);
  return el.textContent;
}

function applyTheme() {
  const isCustom = theme === 'custom';
  const t = isCustom ? themeOf(custom.base) : themeOf(theme);
  const resolved = t.look === 'auto' ? (prefersLight.matches ? 'light' : 'blue') : t.look;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.fonts = t.fonts;
  if (isCustom) root.dataset.custom = ''; else delete root.dataset.custom;
  $('meta[name="theme-color"]').content = (isCustom && custom.values['app.bg']) || THEME_COLOURS[resolved];
  try { siftTestStorage.setItem('sift-theme', theme); } catch {} // read by index.html before first paint
  if (isCustom || document.getElementById('custom-theme-css')) customStyle().then(text => {
    try { siftTestStorage.setItem('sift-custom', JSON.stringify({ look: resolved, fonts: t.fonts, css: text })); } catch {}
  });
}

export function currentTheme() {
  return theme;
}

export async function setTheme(id) {
  theme = themeOf(id).id;
  applyTheme();
  await store.updateSettings({ theme });
}

// The Custom theme's own changes: { base } and/or { values: { key: value or null } }
// (values: null puts every one back).
export async function setCustomTheme(changes) {
  const values = changes.values === null ? {} : Object.assign({}, custom.values, changes.values || {});
  for (const k of Object.keys(values)) if (!values[k]) delete values[k];
  custom = { base: changes.base || custom.base, values };
  applyTheme();
  await store.updateSettings({ custom_theme: custom });
}

// Custom, started from the theme in use so nothing changes until something is picked.
export async function openCustomTheme() {
  if (theme !== 'custom') {
    const saved = (await store.getSettings()).custom_theme;
    const start = theme === 'auto' ? (prefersLight.matches ? 'light' : 'glass') : theme;
    custom = saved || { base: start, values: {} };
    await setTheme('custom');
    if (!saved) await store.updateSettings({ custom_theme: custom });
  }
  await customStyle();
  customCss.openEditor({ app: { THEMES, customTheme, setCustomTheme }, paper: (await (await import('./days.js')).daySettings()).paper_style });
}

// ---------- hints ----------
// The grey help text under lists and boxes ("Enter adds a task…") shows only
// when Settings → Appearance → Show hints is on (off at first). Settings' own
// explanations always show.
export function setHints(on) {
  document.documentElement.classList.toggle('show-hints', on);
}

// ---------- navigation ----------

function renderNav() {
  const more = AREAS.filter(a => !a.hidden && !pinned.includes(a.id));
  const activeInMore = more.some(a => a.id === current);

  // Bottom bar (phone): pinned areas + More.
  $('#tabbar').innerHTML = pinned.map(id => {
    const a = area(id);
    return `<a href="#/${path(a)}" class="tab" ${a.id === current ? 'aria-current="page"' : ''}>
      ${icon(a.icon)}<span>${a.label}</span></a>`;
  }).join('') + `<button type="button" class="tab" id="more-tab" ${activeInMore ? 'aria-current="page"' : ''}>
      ${icon(activeInMore ? area(current).icon : 'i-more')}<span>${activeInMore ? area(current).label : 'More'}</span></button>`;

  $('#more-list').innerHTML = more.map(a =>
    `<a href="#/${path(a)}" ${a.id === current ? 'aria-current="page"' : ''}>${icon(a.icon)}<span>${a.label}</span></a>`
  ).join('');

  // Top nav (laptop): everything, pinned first; overflow goes into a dropdown.
  const ordered = [...pinned.map(area), ...more];
  // The dropdown is refilled by fitTopNav; empty it first or old overflow
  // links get put back alongside the new ones (entries repeated).
  $('#topnav-more-menu').innerHTML = '';
  $('#topnav-links').innerHTML = ordered.map(a =>
    `<a href="#/${path(a)}" data-area="${a.id}" ${a.id === current ? 'aria-current="page"' : ''}>${icon(a.icon)}<span>${a.label}</span></a>`
  ).join('');
  fitTopNav();

  $('#more-tab').onclick = openMoreSheet;
}

// Move trailing links into the More dropdown until the top nav fits.
function fitTopNav() {
  const links = $('#topnav-links');
  const overflow = $('#topnav-overflow');
  const menu = $('#topnav-more-menu');
  links.append(...menu.children); // start from everything back in the bar
  overflow.hidden = true;
  if (!links.offsetParent) return; // top nav hidden (phone layout)
  while (links.scrollWidth > links.clientWidth && links.children.length > 1) {
    overflow.hidden = false;
    menu.prepend(links.lastElementChild);
  }
  const btn = $('#topnav-more');
  btn.toggleAttribute('aria-current', !!menu.querySelector('[aria-current]'));
}

function openMoreSheet() {
  const sheet = $('#more-sheet');
  if (!sheet.open) sheet.showModal();
}

// ---------- keyboard: tabs and areas ----------

// Is something being worked on (so arrows belong to it)? Typing anywhere, or a
// menu, pop-up, panel, sheet, dropdown or full-screen note open.
// With emptyOk, an empty box the page put the cursor in (e.g. Brain Dump's New
// note on arrival) doesn't count: nothing is being written there.
const busy = (emptyOk = false) => {
  const f = document.activeElement?.closest?.('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable]:not([contenteditable="false"])');
  if (f && !(emptyOk && !f.matches('select') && !(f.isContentEditable ? f.textContent : f.value).trim())) return true;
  return !!document.querySelector('dialog[open], details.tool-menu[open], details.dd-open, .dd-menu, .pill-menu, .ref-picker, .edit-pills, .task-details, .item-details, .thing-panel, .list-panel, .thought-pop, .rich.is-full');
};

// ← / → move between the area's own tabs (the Day Planner keeps them for its
// days); Ctrl+← / Ctrl+→ between areas, in the navigation's order (Settings
// last), stopping at the ends. Only on a page at rest (busy above). Alt+← / →
// are left to the browser (Back / Forward).
function installKeyNav() {
  installBrowse({ busy: () => busy(), area: () => current });
  addEventListener('keydown', ev => {
    if ((ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') || ev.altKey || ev.metaKey || ev.shiftKey || ev.defaultPrevented || busy(ev.ctrlKey)) return;
    const dir = ev.key === 'ArrowLeft' ? -1 : 1;
    if (ev.ctrlKey) {
      const order = [...pinned.map(area), ...AREAS.filter(a => !a.hidden && !pinned.includes(a.id))];
      const at = order.findIndex(a => a.id === current);
      const to = at < 0 ? null : order[at + dir];
      if (!to) return;
      ev.preventDefault();
      location.hash = `#/${path(to)}`;
      return;
    }
    // The page's tabs (role="tablist"), when they're showing: its main screen.
    const list = [...document.querySelectorAll('#main [role="tablist"]')].find(t => t.offsetParent);
    const tabs = list ? [...list.querySelectorAll('button')].filter(b => b.offsetParent && !b.disabled) : [];
    const at = tabs.findIndex(b => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true');
    const to = at < 0 ? null : tabs[at + dir];
    if (!to) return;
    ev.preventDefault();
    to.click();
  });
}

// ---------- phones: side swipes ----------

// A side swipe does what ← / → do on a keyboard: the page's tabs (Now, Next…),
// the Day Planner's days. Swipe left for the next one (Brain Dump just nudges).
// Not from inside something that scrolls sideways, a dialog, a full-screen
// note, a grab bar or a slider, while text is selected, or while writing in a
// field (an empty one the page put the cursor in doesn't count: it's left).
// In Safari, a swipe from the screen's edge would go back or forward a page:
// touches starting there (not on a button or a field) are kept for the app.
// (An app on the Home Screen has no such swipe, and Android's own back gesture
// can't be stopped.) overscroll-behavior-x in app.css stops the same in Chrome.
function installSwipe() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  const EDGE = 20;
  const safariTab = /iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone;
  let start = null;
  // Where a swipe doesn't change page: dragging, choosing text, the bar of areas (and below it), a menu or
  // full-screen note, anything that scrolls sideways itself.
  const notHere = s => {
    if (document.body.classList.contains('is-dragging') || getSelection()?.toString()) return true;
    const areasBar = $('#tabbar')?.getBoundingClientRect();
    if (areasBar?.height && s.y >= areasBar.top) return true;
    if (s.el.closest?.('dialog, .rich.is-full, .drag-handle, .kit-grip, .drag-grip, .resize-grip, input[type="range"], .dd-menu, .pill-menu')) return true;
    for (let n = s.el; n && n !== document.body; n = n.parentElement) {
      if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
    }
    return false;
  };
  addEventListener('touchstart', ev => {
    if (ev.touches.length !== 1) { start = null; return; }
    const t = ev.touches[0];
    start = { x: t.clientX, y: t.clientY, at: Date.now(), el: ev.target, sideways: false };
    const edge = t.clientX < EDGE || t.clientX > innerWidth - EDGE;
    if (safariTab && edge && !ev.target.closest?.('a, button, input, textarea, select, label, summary, [contenteditable="true"], [role="button"]')) ev.preventDefault();
  }, { passive: false });
  // Once a touch is plainly sideways it's the page's swipe: the page doesn't scroll up or down with it.
  addEventListener('touchmove', ev => {
    const s = start;
    if (!s || ev.touches.length !== 1) return;
    const t = ev.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (!s.sideways && !s.upDown) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { s.upDown = true; return; } // scrolling
      if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (ev.defaultPrevented || notHere(s) || s.el.closest?.('input:focus, textarea:focus, [contenteditable="true"]')) { s.upDown = true; return; } // a row's swipe, or not a page swipe
      s.sideways = true;
    }
    if (s.sideways && ev.cancelable) ev.preventDefault();
  }, { passive: false });
  addEventListener('touchcancel', () => { start = null; });
  addEventListener('touchend', ev => {
    const s = start;
    start = null;
    if (!s) return;
    const t = ev.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) / 2 || Date.now() - s.at > 700) return;
    if (notHere(s)) return;
    const field = document.activeElement?.closest?.('input:not([type="checkbox"]), textarea, [contenteditable="true"]');
    if (field) {
      if ((field.isContentEditable ? field.textContent : field.value).trim()) return;
      field.blur();
    }
    // The page slides the way the finger went (slide.js). Brain Dump's filters
    // don't change by swiping, but the page nudges, so the swipe was felt.
    const next = dx < 0, key = next ? 'ArrowRight' : 'ArrowLeft';
    if (current === 'dump') { nudge(next); return; }
    slide(next, () => drawnAfter(() => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))));
  }, { passive: true });
}

// ---------- routing ----------

// The very first time Sift is opened on this device, with nothing in it yet
// and no sync set up: a welcome (views/welcome.js) instead of the first area.
// Anyone already using Sift (from before the welcome existed) never sees it.
async function firstVisit() {
  const device = await store.getDeviceSettings();
  if (device.welcomed || device.server_url) return false;
  const used = (await Promise.all(['thoughts', 'tasks', 'day_items', 'lists'].map(c => store.list(c)))).some(list => list.length);
  if (used) { await store.updateDeviceSettings({ welcomed: true }); return false; }
  return !location.hash.replace(/^#\/?/, ''); // not when a link to somewhere in Sift was opened
}

async function route(force = false) {
  const [id, ...rest] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const next = area(id);
  if (!next) {
    location.replace(`#/${path(area(pinned[0]))}`);
    return;
  }
  flushAll(); // notes still waiting to save go in now, before the page changes
  const sheet = $('#more-sheet');
  if (sheet.open) sheet.close();
  $('#topnav-more-menu').parentElement.removeAttribute('open');
  if (next.id === current && force !== true) {
    currentView?.route?.(rest); // same area, deeper path (e.g. a box)
    return;
  }

  current = next.id;
  renderNav();
  document.title = `${next.label} · Sift test`;
  $('#page-title').textContent = next.label;

  currentView?.unmount?.();
  store.useSpace(null); // a new area starts on your own things (sharing.js)
  // A fresh #main for each page: the old one still carries the click handlers
  // of every page shown in it before, which would all fire again.
  const stale = $('#main');
  const main = stale.cloneNode(false);
  stale.replaceWith(main);
  main.dataset.area = next.id;
  applyDensity();
  const module = await import(next.view);
  if (current !== next.id) return; // navigated away while loading
  currentView = module.default;
  await currentView.mount(main, { store, app: appApi });
  if (rest.length) await currentView.route?.(rest);
  if (current === next.id) currentView.arrived?.(); // drawn: e.g. Tasks may put the cursor in New task
}

const appApi = { AREAS, MAX_PINNED, pinnedAreas, setPinned, THEMES, currentTheme, setTheme, openCustomTheme, setHints, checkForUpdate, applyUpdate };

// ---------- header status ----------

async function renderSyncStatus() {
  const { status } = await import('./sync.js');
  const pill = $('#sync-status');
  const text = { off: 'Local only', idle: 'Sync on', syncing: 'Syncing…', ok: 'In sync', offline: 'Offline', error: 'Sync problem' }[status.state] || 'Local only';
  pill.textContent = status.state === 'ok' && status.pending ? `${status.pending} to sync` : text;
  pill.dataset.state = status.state;
  pill.title = status.state === 'off' ? `${await store.outboxSize()} changes stored on this device only` : status.error || text;
}

// Where Esc goes back to from a record's own page (null: already at the start).
function stepUp(hash) {
  const [id, ...rest] = hash.replace(/^#\/?/, '').split('/');
  if (!rest.length) return null;
  if (id === 'recipes' && rest[1] === 'make') return rest.includes('list') ? '#/recipes' : `#/recipes/${rest[0]}`; // a batch opened from the batches list goes back to it
  if (['lists', 'scans', 'contracts', 'recipes'].includes(id)) return `#/${id}`;
  if (id === 'contacts') {
    if (rest[0] === 'c') return '#/contacts';
    if (['cases', 'directory'].includes(rest[0]) && rest.length > 1) return `#/contacts/${rest[0]}`;
  }
  return null;
}

// ---------- service worker ----------

// Look for a new version now: 'ready' when one is waiting (it goes in when
// applyUpdate() is called or the banner's Reload is pressed), 'latest' when
// this is the newest, 'offline' when the server can't be reached.
export async function checkForUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return 'latest';
  try { await reg.update(); } catch { return 'offline'; }
  if (reg.installing) await new Promise(ok => { const w = reg.installing; w.addEventListener('statechange', () => { if (w.state !== 'installing') ok(); }); });
  return reg.waiting ? 'ready' : 'latest';
}
export async function applyUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg?.waiting) reg.waiting.postMessage('skip-waiting'); else { await flushBeforeReload(); location.reload(); }
}

// A reload (an update taking over) shouldn't cut off typing that hasn't been
// saved yet. A full-screen note only saves when it's closed (fullnote.js), so
// close it first; then take the cursor out of anything else being edited and
// wait for that save to reach the database.
async function flushBeforeReload() {
  const { closeFull } = await import('./fullnote.js');
  closeFull({ animate: false });
  document.activeElement?.blur();
  await flushAll();
  await store.idle();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // An app left open (the iPhone Home Screen app, say) looks for a new version
  // whenever it comes back to the front, at most once a minute.
  let lastCheck = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 60000) return;
    lastCheck = Date.now();
    navigator.serviceWorker.getRegistration().then(r => r?.update()).catch(() => {});
  });
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const offer = () => {
      const banner = $('#update-banner');
      banner.hidden = false;
      // A version that has waited since an earlier visit may be several behind:
      // fetch the newest first so one press goes straight to it.
      banner.querySelector('button').onclick = async event => {
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = 'Updating…';
        await checkForUpdate();
        applyUpdate();
      };
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer();
      });
    });
  }).catch(err => console.warn('Offline support unavailable:', err.message));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    flushBeforeReload().then(() => location.reload());
  });
}

// ---------- boot ----------

async function boot() {
  await store.open();
  const settings = await store.getSettings();
  if (Array.isArray(settings.pinned_areas)) {
    pinned = settings.pinned_areas.filter(id => area(id)).slice(0, MAX_PINNED);
    if (pinned.join(',') === OLD_DEFAULT) pinned = DEFAULT_PINNED; // never changed by hand: take the new order
  }
  theme = themeOf(settings.theme).id;
  if (settings.custom_theme) custom = settings.custom_theme;
  setHints(!!settings.show_hints);
  applyTheme();
  prefersLight.addEventListener('change', applyTheme);

  // Ask once for persistent storage so the browser won't evict our data.
  if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
    navigator.storage.persist();
  }

  $('#more-sheet').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.close(); // backdrop tap
  });
  // Going into the background (another app, the phone locked): a phone may
  // close Sift there without warning, so anything waiting to save goes in now.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
  addEventListener('pagehide', () => flushAll());
  // Ctrl+Space ticks or unticks the item being edited or picked (tasks, list items, the planner).
  addEventListener('keydown', ev => {
    if (ev.key !== ' ' || !ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;
    const row = document.activeElement?.closest?.('li, .line') || document.querySelector('.kb-cur');
    const tick = row?.querySelector('input.tick:not(:disabled)');
    if (!tick) return;
    ev.preventDefault();
    tick.click();
  }, true);
  // Esc closes an open ⋯ / 👁 menu (or the top bar's More) before anything else.
  addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    const menu = document.querySelector('details.tool-menu[open], #topnav-overflow[open]');
    if (!menu) return;
    ev.preventDefault();
    ev.stopPropagation();
    menu.removeAttribute('open');
    if (menu.dataset.byKey) { delete menu.dataset.byKey; document.activeElement?.blur(); } else menu.querySelector('summary')?.focus();
  }, true);
  // Esc with nothing left to step out of (nothing being typed in, no menu,
  // panel or selection to close: anything that took the Esc says so with
  // preventDefault) goes back to the area's starting view from one of its
  // records: a list, a contact, a case, a scan, a contract.
  addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || ev.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
    setTimeout(() => {
      if (ev.defaultPrevented) return;
      const up = stepUp(location.hash);
      if (up) location.hash = up;
    });
  });
  installInlineEditing();
  installRefLinks();
  installHoldToOpen();
  installSheets();
  installSearchClear();
  installFlash();
  installDropdowns();
  installMenuFlip();
  installFileDrop();
  // Search everything: the laptop's top bar, and the top of the phone's More list.
  {
    const top = $('#top-search');
    const topBox = $('#top-results');
    const topSearch = mountSearch(top, topBox, { onOpen: () => { topBox.hidden = true; top.blur(); } });
    document.addEventListener('pointerdown', ev => { if (!ev.target.closest('.top-search')) topBox.hidden = true; });
    // Clicking away shrinks it back to the round button, empty.
    $('.top-search').addEventListener('focusout', ev => {
      if (ev.relatedTarget && ev.currentTarget.contains(ev.relatedTarget)) return;
      setTimeout(() => { if (!$('.top-search').contains(document.activeElement)) { top.value = ''; topBox.hidden = true; topBox.innerHTML = ''; } }, 150);
    });
    const more = $('#more-search');
    const moreBox = $('#more-results');
    mountSearch(more, moreBox, {
      onShow: () => { $('#more-list').hidden = true; },
      onClear: () => { $('#more-list').hidden = false; },
      onOpen: () => { $('#more-sheet').close(); },
    });
    $('#more-sheet').addEventListener('close', () => { more.value = ''; moreBox.hidden = true; moreBox.innerHTML = ''; $('#more-list').hidden = false; });
    // Ctrl+K (⌘K) anywhere, or / when not typing (Find Things keeps its own /).
    addEventListener('keydown', ev => {
      const typing = ev.target.closest?.('input, textarea, select, [contenteditable="true"]');
      const k = (ev.key === 'k' || ev.key === 'K') && (ev.ctrlKey || ev.metaKey);
      const slash = ev.key === '/' && !typing && !location.hash.startsWith('#/find-things');
      if (!k && !slash) return;
      ev.preventDefault();
      if (top.offsetParent) { top.focus(); top.select(); topSearch.show(); }
      else { openMoreSheet(); more.focus(); }
    });
  }
  applyDensity = installViewCog(() => current);
  installShare(() => current);
  installKeyNav();
  installSwipe();
  // A dropdown menu opens inside the screen: flipped to the other side if
  // it would run off the left or right edge.
  document.addEventListener('toggle', ev => {
    const d = ev.target;
    if (!(d instanceof HTMLDetailsElement) || !d.open) return;
    const m = d.querySelector(':scope > .menu');
    if (!m) return;
    m.style.left = '';
    m.style.right = '';
    const r = m.getBoundingClientRect();
    if (r.left < 8) { m.style.left = '0'; m.style.right = 'auto'; }
    else if (r.right > innerWidth - 8) { m.style.right = '0'; m.style.left = 'auto'; }
  }, true);
  // An open dropdown menu (<details class="tool-menu">, or the top bar's More) closes on a click elsewhere.
  document.addEventListener('pointerdown', ev => {
    for (const d of document.querySelectorAll('details.tool-menu[open], #topnav-overflow[open]')) if (!d.contains(ev.target)) d.removeAttribute('open');
  }, true);
  addEventListener('hashchange', route);
  addEventListener('resize', fitTopNav);
  // Fit the areas again whenever the bar's room changes (fonts arriving, the search box settling).
  new ResizeObserver(() => fitTopNav()).observe($('.topnav'));
  document.fonts?.ready.then(fitTopNav);
  store.subscribe(renderSyncStatus);

  // What each energy level means (Settings → Your words → Dictionary) feeds the hover text everywhere.
  const days = await import('./days.js');
  await days.applyEnergyMeanings();
  let wordsSig = JSON.stringify(await applyWords());
  import('./noteundo.js').then(m => m.pruneVersions()).catch(err => console.warn('Note history clean-up failed:', err)); // Settings → Notes → Keep note history for
  import('./repeat.js').then(m => m.installRepeats()); // ticking a recurring task makes the next one
  import('./link.js').then(m => m.installMirror()); // a task and its day items share title, note, energy, time, people, case
  // Words changed (Settings → Dictionary, or on another device): names and headings follow.
  store.subscribe(async change => {
    if (change?.collection !== 'settings') return;
    days.applyEnergyMeanings();
    const now = await store.getSettings(); // the theme changed on another device
    if (now.custom_theme && JSON.stringify(now.custom_theme) !== JSON.stringify(custom) || themeOf(now.theme).id !== theme) {
      theme = themeOf(now.theme).id;
      if (now.custom_theme) custom = now.custom_theme;
      applyTheme();
    }
    const sig = JSON.stringify(await applyWords());
    if (sig === wordsSig) return;
    wordsSig = sig;
    renderNav();
    // (not while you're typing: redrawing the page would take the cursor away)
    if (!location.hash.startsWith('#/settings') && !document.activeElement?.closest('input, textarea, [contenteditable]')) route(true);
  });
  // Another device's changes arrived: the page you're on is updated in place
  // (what's open stays open, the page stays where it was scrolled to). Pages
  // without a refresh() are drawn again.
  const refreshPage = async () => {
    const y = scrollY;
    if (currentView?.refresh) await currentView.refresh(); else await route(true);
    requestAnimationFrame(() => scrollTo(0, y));
  };

  // Ctrl+Z / Ctrl+Y outside anything being typed: undo / redo the last thing done (undo.js).
  import('./undo.js').then(m => m.installUndoKeys(refreshPage));
  if (await firstVisit()) location.replace('#/welcome');
  await route();
  renderSyncStatus();
  import('./install.js').then(m => m.showBanner());
  // Sync: runs in the background once signed in. When another device's
  // changes arrive, the page you're on is updated (unless you're typing).
  import('./sync.js').then(sync => {
    let was = null;
    let wasFiles = null;
    // Typing somewhere the page would redraw (a note being edited, a task's
    // title…): the update waits until you leave that box. Boxes the redraw
    // doesn't touch (the Brain Dump's new-note box, search, anything outside
    // the page) don't hold it up.
    const typing = () => {
      const a = document.activeElement?.closest('input, textarea, [contenteditable]');
      return !!a && !!a.closest('#main') && !a.closest('[data-sync-safe]');
    };
    let waiting = false;
    const update = () => {
      if (typing()) { waiting = true; return; }
      waiting = false;
      refreshPage().catch(err => console.warn('Refresh after sync failed:', err));
    };
    document.addEventListener('focusout', () => setTimeout(() => { if (waiting) update(); }, 50));
    let firstOk = false;
    sync.onStatus(st => {
      renderSyncStatus();
      // New records, or files that were "still arriving" now here: update the page.
      const records = was === 'syncing' && st.state === 'ok' && (st.changed || (!firstOk && location.hash.startsWith('#/recipes'))); // Batch Book's one time reset waits for the first sync
      if (st.state === 'ok') firstOk = true;
      const files = wasFiles === 'syncing' && st.files === 'idle' && st.filesArrived;
      if (records || files) update();
      was = st.state;
      wasFiles = st.files;
    });
    // Shared things changed (an invitation, someone accepted, a share ended): the page follows.
    let sharesSeen = false;
    sync.onShares(() => { if (sharesSeen) update(); sharesSeen = true; });
    import('./sharing.js').then(m => m.installSharing());
    sync.init();
  });
  import('./bin.js').then(bin => bin.autoEmpty()).catch(err => console.warn('Bin clean-up failed:', err));
  registerServiceWorker();
}

boot().catch(err => {
  console.error(err);
  $('#main').innerHTML = `<div class="empty"><h2>Sift couldn't start</h2><p></p></div>`;
  $('#main .empty p').textContent = err.message;
});

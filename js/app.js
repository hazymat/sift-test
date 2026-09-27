import * as store from './store.js';
import { installInlineEditing } from './inline.js';
import { installRefLinks } from './refs.js';
import { installHoldToOpen } from './holdopen.js';
import { installViewCog } from './viewcog.js';

// Adding an area is one entry here plus a view module (spec §5.1).
export const AREAS = [
  { id: 'tasks', label: 'Tasks', icon: 'i-tasks', view: './views/tasks.js' },
  { id: 'planner', label: 'Day Planner', icon: 'i-planner', view: './views/planner.js' },
  { id: 'dump', label: 'Brain Dump', icon: 'i-dump', view: './views/dump.js' },
  // Internally "places" (saved nav order etc. use it); the address is #/find-things.
  { id: 'places', slug: 'find-things', label: 'Find Things', icon: 'i-places', view: './views/places.js' },
  { id: 'lists', label: 'Lists', icon: 'i-lists', view: './views/lists.js' },
  { id: 'scans', label: 'Scans', icon: 'i-scans', view: './views/scans.js' },
  { id: 'contracts', label: 'Contracts', icon: 'i-contracts', view: './views/contracts.js' },
  { id: 'contacts', label: 'Contacts', icon: 'i-contacts', view: './views/contacts.js' },
  { id: 'recipes', label: 'Batch Book', icon: 'i-recipes', view: './views/recipes.js' },
  { id: 'settings', label: 'Settings', icon: 'i-settings', view: './views/settings.js', pinnable: false },
  // Not in the nav: reached from each area's ⋯ menu and from Settings.
  { id: 'bin', label: 'Archive & Bin', icon: 'i-archive', view: './views/bin.js', pinnable: false, hidden: true },
  { id: 'history', label: 'History', icon: 'i-history', view: './views/history.js', pinnable: false, hidden: true },
];

export const MAX_PINNED = 4;
const DEFAULT_PINNED = ['tasks', 'dump', 'places', 'scans'];

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

export const THEMES = [
  { id: 'blue', label: 'Blue' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'auto', label: 'Auto' },
];
const THEME_COLOURS = { blue: '#0f172a', dark: '#121316', light: '#eef2f8' };
const prefersLight = matchMedia('(prefers-color-scheme: light)');
let theme = 'blue';

function applyTheme() {
  const resolved = theme === 'auto' ? (prefersLight.matches ? 'light' : 'blue') : theme;
  document.documentElement.dataset.theme = resolved;
  $('meta[name="theme-color"]').content = THEME_COLOURS[resolved];
  try { siftTestStorage.setItem('sift-theme', theme); } catch {} // read by index.html before first paint
}

export function currentTheme() {
  return theme;
}

export async function setTheme(id) {
  theme = THEMES.some(t => t.id === id) ? id : 'blue';
  applyTheme();
  await store.updateSettings({ theme });
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

// ---------- routing ----------

async function route() {
  const [id, ...rest] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const next = area(id);
  if (!next) {
    location.replace(`#/${path(area(pinned[0]))}`);
    return;
  }
  const sheet = $('#more-sheet');
  if (sheet.open) sheet.close();
  $('#topnav-more-menu').parentElement.removeAttribute('open');
  if (next.id === current) {
    currentView?.route?.(rest); // same area, deeper path (e.g. a box)
    return;
  }

  current = next.id;
  renderNav();
  document.title = `${next.label} · Sift test`;
  $('#page-title').textContent = next.label;

  currentView?.unmount?.();
  const main = $('#main');
  main.innerHTML = '';
  main.dataset.area = next.id;
  applyDensity();
  const module = await import(next.view);
  if (current !== next.id) return; // navigated away while loading
  currentView = module.default;
  await currentView.mount(main, { store, app: appApi });
  if (rest.length) await currentView.route?.(rest);
}

const appApi = { AREAS, MAX_PINNED, pinnedAreas, setPinned, THEMES, currentTheme, setTheme };

// ---------- header status ----------

async function renderSyncStatus() {
  // Phase 1 has no sync: always local only. Pending count shown for later.
  $('#sync-status').textContent = 'Local only';
  $('#sync-status').title = `${await store.outboxSize()} changes stored on this device only`;
}

// ---------- service worker ----------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const offer = worker => {
      const banner = $('#update-banner');
      banner.hidden = false;
      banner.querySelector('button').onclick = () => worker.postMessage('skip-waiting');
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
  }).catch(err => console.warn('Offline support unavailable:', err.message));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

// ---------- boot ----------

async function boot() {
  await store.open();
  const settings = await store.getSettings();
  if (Array.isArray(settings.pinned_areas)) {
    pinned = settings.pinned_areas.filter(id => area(id)).slice(0, MAX_PINNED);
  }
  theme = THEMES.some(t => t.id === settings.theme) ? settings.theme : 'blue';
  applyTheme();
  prefersLight.addEventListener('change', applyTheme);

  // Ask once for persistent storage so the browser won't evict our data.
  if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
    navigator.storage.persist();
  }

  $('#more-sheet').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.close(); // backdrop tap
  });
  installInlineEditing();
  installRefLinks();
  installHoldToOpen();
  applyDensity = installViewCog(() => current);
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
  // An open dropdown menu (<details class="tool-menu">) closes on a click elsewhere.
  document.addEventListener('pointerdown', ev => {
    for (const d of document.querySelectorAll('details.tool-menu[open]')) if (!d.contains(ev.target)) d.removeAttribute('open');
  }, true);
  addEventListener('hashchange', route);
  addEventListener('resize', fitTopNav);
  store.subscribe(renderSyncStatus);

  await route();
  renderSyncStatus();
  import('./bin.js').then(bin => bin.autoEmpty()).catch(err => console.warn('Bin clean-up failed:', err));
  registerServiceWorker();
}

boot().catch(err => {
  console.error(err);
  $('#main').innerHTML = `<div class="empty"><h2>Sift couldn't start</h2><p></p></div>`;
  $('#main .empty p').textContent = err.message;
});

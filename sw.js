// App shell cache. VERSION is replaced with the commit id on deploy
// (see .github/workflows/pages.yml), so every release gets a fresh cache.
const VERSION = '84ee797';
const CACHE = `sifttest-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'js/teststorage.js',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/sortable.js',
  'js/listentry.js',
  'js/toast.js',
  'js/bin.js',
  'js/days.js',
  'js/tasks.js',
  'js/contacts.js',
  'js/backup.js',
  'js/history.js',
  'js/lists.js',
  'js/views/lists.js',
  'js/listkit.js',
  'js/inline.js',
  'js/views/history.js',
  'js/richtext.js',
  'js/refs.js',
  'js/drafts.js',
  'js/pillmenu.js',
  'js/summary.js',
  'js/exporttext.js',
  'js/holdopen.js',
  'js/viewcog.js',
  'js/linkpicker.js',
  'js/csv.js',
  'js/places.js',
  'js/views/placeholder.js',
  'js/views/tasks.js',
  'js/views/planner.js',
  'js/views/dump.js',
  'js/views/places.js',
  'js/views/contacts.js',
  'js/views/recipes.js',
  'js/views/contracts.js',
  'js/views/scans.js',
  'js/views/settings.js',
  'js/views/bin.js',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('sifttest-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

// Cache first for our own files; anything missing from the shell list is
// fetched and cached on first use. Other origins go straight to the network.
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  if (VERSION === 'dev' && location.hostname === 'localhost') return; // always fresh while developing

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (err) {
      if (request.mode === 'navigate') return cache.match('index.html');
      throw err;
    }
  })());
});

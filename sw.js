// App shell cache. VERSION is replaced with the commit id on deploy
// (see .github/workflows/pages.yml), so every release gets a fresh cache.
const VERSION = 'bcf9c47';
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
  'js/dropdown.js',
  'js/colours.js',
  'js/comments.js',
  'js/customtheme.js',
  'js/thememocks.js',
  'js/slide.js',
  'js/rowswipe.js',
  'js/keys.js',
  'js/hold.js',
  'js/undo.js',
  'js/gcal.js',
  'js/typesheet.js',
  'js/noteundo.js',
  'js/repeat.js',
  'js/taskpicker.js',
  'js/order.js',
  'js/listentry.js',
  'js/toast.js',
  'js/bin.js',
  'js/days.js',
  'js/tasks.js',
  'js/contacts.js',
  'js/backup.js',
  'js/history.js',
  'js/lists.js',
  'js/batchbook.js',
  'js/views/lists.js',
  'js/listkit.js',
  'js/inline.js',
  'js/views/history.js',
  'js/richtext.js',
  'js/fullnote.js',
  'js/autosave.js',
  'js/browse.js',
  'js/linemake.js',
  'js/ask.js',
  'js/sharing.js',
  'js/flash.js',
  'js/words.js',
  'js/search.js',
  'js/version.js',
  'js/refs.js',
  'js/drafts.js',
  'js/pillmenu.js',
  'js/summary.js',
  'js/exporttext.js',
  'js/holdopen.js',
  'js/attachments.js',
  'js/walk.js',
  'js/scans.js',
  'js/contracts.js',
  'js/install.js',
  'js/link.js',
  'js/sheets.js',
  'js/searchclear.js',
  'js/editpills.js',
  'js/viewcog.js',
  'js/crypto.js',
  'js/sync.js',
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
  'js/views/welcome.js',
  'js/tour.js',
  'icons/app-icon-32.png',
  'icons/app-icon-180.png',
  'icons/app-icon-192.png',
  'icons/app-icon-512.png',
];

self.addEventListener('install', event => {
  // Straight from the server, not the browser's own cache (GitHub Pages lets
  // browsers keep files for 10 minutes, so a new version could have been
  // stored with old files in it).
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))));
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

// IndexedDB wrapper. Every record carries what sync will need later
// (spec §4, §8.3), so enabling sync never requires a data migration:
//   id           UUIDv7
//   _field_clocks {field: hlc}   hybrid logical clock per field
//   _dirty_fields [field]        changed since last push
//   _server_seq   number         0 until the server has it
//   deleted_at                   soft delete; tombstones are kept
// Every write also queues the record id in `outbox`.

export const COLLECTIONS = [
  'projects', 'milestones', 'tasks',
  'days', 'day_items',
  'thoughts',
  'places', 'items',
  'contacts', 'contact_categories', 'contact_jobs', 'interactions', 'cases', 'case_notes',
  'lists', 'list_items',
  'scans',
  'attachments',
  'contracts',
  'comments',
  'note_versions',
  'recipes', 'recipe_makes', 'recipe_entries',
  'settings',
];

const DB_VERSION = 11; // bump when adding object stores; onupgradeneeded only adds what's missing
const LOCAL_DB = 'sifttest_local';
const SYSTEM_FIELDS = new Set(['id', '_field_clocks', '_dirty_fields', '_server_seq', '_share_seqs']);
const SETTINGS_ID = 'settings'; // fixed id so every device edits the same record

let deviceId = null;
let lastClock = { wall: 0, counter: 0 };
const listeners = new Set();
const channel = 'BroadcastChannel' in self ? new BroadcastChannel('sifttest-store') : null;

// ---------- ids and clocks ----------

export function uuidv7() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = Date.now();
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// HLC format: wall_ms-counter-device_id, zero padded so plain string
// comparison orders clocks correctly.
function formatHlc({ wall, counter }) {
  return `${String(wall).padStart(15, '0')}-${String(counter).padStart(5, '0')}-${deviceId}`;
}

export function parseHlc(hlc) {
  const [wall, counter, ...rest] = hlc.split('-');
  return { wall: Number(wall), counter: Number(counter), device: rest.join('-') };
}

export function compareHlc(a, b) {
  if (a === b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a < b ? -1 : 1;
}

function tick() {
  const now = Date.now();
  lastClock = now > lastClock.wall
    ? { wall: now, counter: 0 }
    : { wall: lastClock.wall, counter: lastClock.counter + 1 };
  return formatHlc(lastClock);
}

// Advance our clock past one seen from another device (used by sync).
export function observeHlc(hlc) {
  const seen = parseHlc(hlc);
  // Ignore clocks from the future (a device with a wrong date, a bad file):
  // adopting one would make every later edit here carry that time.
  if (!(seen.wall <= Date.now() + 86400000)) return;
  if (seen.wall > lastClock.wall || (seen.wall === lastClock.wall && seen.counter > lastClock.counter)) {
    lastClock = { wall: seen.wall, counter: seen.counter };
  }
}

// ---------- opening ----------

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export function getDeviceId() {
  return deviceId;
}

// ---------- change notifications ----------

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(change, fromOtherTab = false) {
  for (const fn of listeners) fn(change);
  if (!fromOtherTab && channel) channel.postMessage(change);
}

if (channel) channel.onmessage = e => emit(e.data, true);

// ---------- writes ----------

function assertCollection(collection) {
  if (!COLLECTIONS.includes(collection)) throw new Error(`Unknown collection: ${collection}`);
}

// A reload (an app update, say) shouldn't cut off a save that's still in
// flight: it should wait for it. `idle()` resolves once every write started
// so far has reached the database.
let inFlight = 0;
let idleWaiters = [];
function beginWrite() { inFlight++; }
function endWrite() { if (--inFlight <= 0) { inFlight = 0; idleWaiters.splice(0).forEach(r => r()); } }
export function idle() {
  return inFlight === 0 ? Promise.resolve() : new Promise(resolve => idleWaiters.push(resolve));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Apply field changes to a record (or a new one), stamping a clock on each
// field that actually changed. Returns null if nothing changed.
function stamp(existing, changes) {
  const record = existing
    ? structuredClone(existing)
    : { _field_clocks: {}, _dirty_fields: [], _server_seq: 0 };
  const changed = [];
  for (const [field, value] of Object.entries(changes)) {
    if (SYSTEM_FIELDS.has(field)) continue;
    if (existing && same(existing[field], value)) continue;
    record[field] = value;
    changed.push(field);
  }
  if (!changed.length) return null;
  if (!changed.includes('updated_at')) {
    record.updated_at = new Date().toISOString();
    changed.push('updated_at');
  }
  const clock = tick();
  const dirty = new Set(record._dirty_fields);
  for (const field of changed) {
    record._field_clocks[field] = clock;
    dirty.add(field);
  }
  record._dirty_fields = [...dirty];
  return record;
}

// Ticking and unticking are logged on tasks and day items (the task list,
// the Day Planner's tasks and its schedule): done_log keeps each change as
// { at, done }, oldest first (the last 50). done_at is always the latest tick,
// so ticking again after unticking just moves it.
const LOGS_DONE = new Set(['tasks', 'day_items']);
function withDoneLog(collection, existing, changes) {
  if (!LOGS_DONE.has(collection) || !existing || !('done_at' in changes)) return changes;
  const was = !!existing.done_at;
  const now = !!changes.done_at;
  if (was === now) return changes;
  return { ...changes, done_log: [...(existing.done_log || []), { at: changes.done_at || new Date().toISOString(), done: now }].slice(-50) };
}

// ---------- history ----------
// Every change made through this store is recorded (field-level before and
// after) so any change can be undone later, one at a time, in any order.
// Writes close together form one entry; the toast that follows an action
// names it (labelHistory). History lives on this device only.

const HISTORY_MAX = 1000;
const QUIET = new Set(['updated_at', 'looked_up_at', '_field_clocks', '_dirty_fields', '_server_seq', '_share_seqs']);
let pending = null;
let pendingTimer = null;
let lastEntry = null;

const pick = (obj, fields) => Object.fromEntries(fields.map(f => [f, obj?.[f] ?? null]));

function noteChange(collection, before, after) {
  const fields = Object.keys(after).filter(f => !QUIET.has(f) && !same(before?.[f] ?? null, after[f] ?? null));
  if (!fields.length) return;
  pending ??= { changes: [], at: new Date().toISOString() };
  const prev = pending.changes.find(c => c.collection === collection && c.id === after.id);
  if (prev) {
    for (const f of fields) {
      if (!prev.created && !(f in prev.after)) prev.before[f] = before?.[f] ?? null;
      prev.after[f] = after[f] ?? null;
    }
  } else {
    pending.changes.push({ collection, id: after.id, created: !before, before: before ? pick(before, fields) : null, after: pick(after, fields) });
  }
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(flushHistory, 1500);
}

// Name the action that just happened (called by the undo toast helper).
// Resolves to the entry's id (null if nothing was recorded).
export async function labelHistory(label, extra = {}) {
  if (pending) {
    Object.assign(pending, { label }, extra);
    await flushHistory();
    return lastEntry?.id ?? null;
  }
  // Already flushed moments ago without a name: name it now.
  if (lastEntry && !lastEntry.label && Date.now() - Date.parse(lastEntry.at) < 4000) {
    Object.assign(lastEntry, { label }, extra);
    await putHistory(lastEntry);
    return lastEntry.id;
  }
  return null;
}

async function putHistory(entry) {
  const db = await local.open();
  const tx = db.transaction('history', 'readwrite');
  tx.objectStore('history').put(entry);
  await done(tx);
  emit({ collection: 'history', id: entry.id });
}

async function flushHistory() {
  clearTimeout(pendingTimer);
  const entry = pending;
  pending = null;
  if (!entry?.changes.length) return;
  // Typing in one field saves every so often: fold those into one entry.
  const one = entry.changes.length === 1 && entry.changes[0];
  const last = lastEntry?.changes.length === 1 && lastEntry.changes[0];
  if (!entry.label && !lastEntry?.label && one && last && !one.created && !last.created
      && one.collection === last.collection && one.id === last.id
      && Object.keys(one.after).join() === Object.keys(last.after).join()
      && Date.now() - Date.parse(lastEntry.at) < 60000) {
    last.after = one.after;
    lastEntry.at = entry.at;
    return putHistory(lastEntry);
  }
  entry.id = uuidv7();
  lastEntry = entry;
  await putHistory(entry);
  // Keep the newest HISTORY_MAX entries (ids are time-ordered).
  const db = await local.open();
  const tx = db.transaction('history', 'readwrite');
  const keys = await promisify(tx.objectStore('history').getAllKeys());
  for (const k of keys.slice(0, Math.max(0, keys.length - HISTORY_MAX))) tx.objectStore('history').delete(k);
  await done(tx);
}

export async function historyList() {
  await flushHistory();
  const db = await local.open();
  const all = await promisify(db.transaction('history').objectStore('history').getAll());
  return all.reverse(); // newest first
}

// ---------- settings ----------

const DEFAULT_SETTINGS = {
  default_calendar_id: null,
  week_start: 1,
  theme: 'glass', // a theme id (app.js THEMES): glass | glass-fancy | dark | light | auto
  pinned_areas: null, // null = app default
  spot_details: true, // phone numbers / emails in notes become contacts
  phone_country: '44', // calling code for numbers written without one
};

export async function getSettings() {
  const record = await local.get('settings', SETTINGS_ID);
  return { ...DEFAULT_SETTINGS, ...(record || {}) };
}

export async function updateSettings(changes) {
  const existing = await local.get('settings', SETTINGS_ID, { includeDeleted: true });
  return existing
    ? local.update('settings', SETTINGS_ID, changes)
    : local.create('settings', { id: SETTINGS_ID, ...DEFAULT_SETTINGS, ...changes });
}

// device_settings are local only and never synced (spec §4.7).
export async function getDeviceSettings() {
  const db = await local.open();
  const value = await promisify(db.transaction('sync_meta').objectStore('sync_meta').get('device_settings'));
  return { server_url: null, device_name: null, keep_all_scans_on_device: true, ...(value || {}) };
}

export async function updateDeviceSettings(changes) {
  const current = await getDeviceSettings();
  const db = await local.open();
  const tx = db.transaction('sync_meta', 'readwrite');
  tx.objectStore('sync_meta').put({ ...current, ...changes }, 'device_settings');
  await done(tx);
}

// ---------- spaces ----------
// A space is one local database. `local` holds this account's own records;
// each person who shares things with this account gets a space of their own
// (see sync.js), so what they share never mixes with your own. The functions
// exported below work on the current space: your own, unless a page is
// showing someone else's things (useSpace).

function makeSpace(name) {
  const isLocal = name === LOCAL_DB;
  let db = null;
  async function open() {
    if (db) return db;
    if (!isLocal) await local.open(); // the device id and clock come from this device's own data
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const d = request.result;
      for (const c of COLLECTIONS) {
        if (!d.objectStoreNames.contains(c)) d.createObjectStore(c, { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'blob_id' });
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
      // key/value: device_id, clock, device_settings, last_seq ...
      if (!d.objectStoreNames.contains('sync_meta')) d.createObjectStore('sync_meta');
      // Change history for "undo anything" (this device only, never synced).
      if (!d.objectStoreNames.contains('history')) d.createObjectStore('history', { keyPath: 'id' });
    };
    db = await promisify(request);
    db.onversionchange = () => { db.close(); db = null; if (isLocal) location.reload(); };
    if (!isLocal) return db;

    const tx = db.transaction('sync_meta', 'readwrite');
    const meta = tx.objectStore('sync_meta');
    deviceId = await promisify(meta.get('device_id'));
    if (!deviceId) {
      deviceId = uuidv7().replace(/-/g, '').slice(-12);
      meta.put(deviceId, 'device_id');
    }
    lastClock = (await promisify(meta.get('clock'))) || lastClock;
    await done(tx);
    return db;
  }

  // Delete this space's database (other open tabs close theirs: versionchange).
  async function erase() {
    if (db) { db.close(); db = null; }
    await new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = () => resolve();
      r.onblocked = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }

  async function write(collection, id, changes, { mustExist }) {
    assertCollection(collection);
    await open();
    beginWrite();
    try {
      const tx = db.transaction([collection, 'outbox', 'sync_meta'], 'readwrite');
      const existing = await promisify(tx.objectStore(collection).get(id));
      if (mustExist && !existing) {
        tx.abort();
        throw new Error(`${collection}/${id} not found`);
      }
      const record = stamp(existing, existing ? withDoneLog(collection, existing, changes) : { ...changes, id });
      if (record) {
        record.id = id;
        tx.objectStore(collection).put(record);
        tx.objectStore('outbox').put({ id, collection, queued_at: Date.now() });
        tx.objectStore('sync_meta').put(lastClock, 'clock');
      }
      await done(tx);
      if (record) {
        if (isLocal) noteChange(collection, existing, record);
        emit({ collection, id, deleted: !!record.deleted_at, space: name });
      }
      return record || existing;
    } finally {
      endWrite();
    }
  }

  function create(collection, fields = {}) {
    const now = new Date().toISOString();
    const id = fields.id || uuidv7();
    return write(collection, id, {
      created_at: now,
      updated_at: now,
      deleted_at: null,
      tags: [],
      ...fields,
    }, { mustExist: false });
  }

  function update(collection, id, changes) {
    return write(collection, id, changes, { mustExist: true });
  }

  function remove(collection, id) {
    return write(collection, id, { deleted_at: new Date().toISOString() }, { mustExist: true });
  }

  function restore(collection, id) {
    return write(collection, id, { deleted_at: null }, { mustExist: true });
  }

  // Many updates in one transaction (reordering a long list, batch delete…).
  // `changes` is [[id, fields], …]; missing ids are skipped. Returns the
  // records that actually changed.
  async function updateMany(collection, changes) {
    assertCollection(collection);
    await open();
    const tx = db.transaction([collection, 'outbox', 'sync_meta'], 'readwrite');
    const records = tx.objectStore(collection);
    const changed = [];
    const befores = [];
    for (const [id, fields] of changes) {
      const existing = await promisify(records.get(id));
      const record = existing && stamp(existing, withDoneLog(collection, existing, fields));
      if (!record) continue;
      records.put(record);
      tx.objectStore('outbox').put({ id, collection, queued_at: Date.now() });
      changed.push(record);
      befores.push(existing);
    }
    if (changed.length) tx.objectStore('sync_meta').put(lastClock, 'clock');
    await done(tx);
    if (isLocal) changed.forEach((r, i) => noteChange(collection, befores[i], r));
    for (const r of changed) emit({ collection, id: r.id, deleted: !!r.deleted_at, space: name });
    return changed;
  }

  // "Delete forever": blank every content field but keep the record as a
  // tombstone (id, clocks, deleted_at, purged_at) so sync can't bring it back.
  async function purgeMany(collection, ids) {
    assertCollection(collection);
    await open();
    const keep = new Set(['created_at', 'updated_at', 'deleted_at']);
    const now = new Date().toISOString();
    const changes = [];
    for (const id of ids) {
      const r = await get(collection, id, { includeDeleted: true });
      if (!r || r.purged_at) continue;
      const blank = { purged_at: now, deleted_at: r.deleted_at || now };
      for (const k of Object.keys(r)) if (!SYSTEM_FIELDS.has(k) && !keep.has(k) && k !== 'purged_at') blank[k] = null;
      changes.push([id, blank]);
    }
    return updateMany(collection, changes);
  }

  // ---------- backup / restore ----------

  // Every record in every collection, tombstones included (for backups).
  async function exportAll() {
    await open();
    const out = {};
    for (const c of COLLECTIONS) out[c] = await promisify(db.transaction(c).objectStore(c).getAll());
    return out;
  }

  // Merge records from a backup (or, later, another device) field by field:
  // for each field the later clock wins, exactly like sync. Records we don't
  // have are added as they are. Clocks are kept, not re-stamped.
  async function mergeRecords(collection, incoming) {
    assertCollection(collection);
    await open();
    const tx = db.transaction([collection, 'sync_meta'], 'readwrite');
    const records = tx.objectStore(collection);
    let added = 0;
    let updated = 0;
    for (const r of incoming) {
      if (!r?.id) continue;
      for (const clock of Object.values(r._field_clocks || {})) observeHlc(clock);
      const local = await promisify(records.get(r.id));
      if (!local) { records.put(r); added++; continue; }
      const merged = { ...local, _field_clocks: { ...(local._field_clocks || {}) } };
      let changed = false;
      for (const [field, clock] of Object.entries(r._field_clocks || {})) {
        if (compareHlc(clock, merged._field_clocks[field]) > 0) {
          merged[field] = r[field];
          merged._field_clocks[field] = clock;
          changed = true;
        }
      }
      if (changed) { records.put(merged); updated++; }
    }
    tx.objectStore('sync_meta').put(lastClock, 'clock');
    await done(tx);
    if (added || updated) emit({ collection, id: null, space: name });
    return { added, updated };
  }

  // ---------- reads ----------

  async function get(collection, id, { includeDeleted = false } = {}) {
    assertCollection(collection);
    await open();
    const record = await promisify(db.transaction(collection).objectStore(collection).get(id));
    if (!record || (record.deleted_at && !includeDeleted)) return null;
    return record;
  }

  async function list(collection, { includeDeleted = false, filter } = {}) {
    assertCollection(collection);
    await open();
    const all = await promisify(db.transaction(collection).objectStore(collection).getAll());
    return all.filter(r => (includeDeleted || !r.deleted_at) && (!filter || filter(r)));
  }

  async function outboxSize() {
    await open();
    return promisify(db.transaction('outbox').objectStore('outbox').count());
  }

  // ---------- attachment files (this device; the record is what syncs) ----------

  async function putBlob(blobId, data, { uploaded = false } = {}) {
    await open();
    const tx = db.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').put({ blob_id: blobId, data, saved_at: new Date().toISOString(), uploaded_at: uploaded ? new Date().toISOString() : null });
    await done(tx);
  }

  async function getBlob(blobId) {
    await open();
    return (await promisify(db.transaction('blobs').objectStore('blobs').get(blobId)))?.data || null;
  }

  async function hasBlob(blobId) {
    await open();
    return !!(await promisify(db.transaction('blobs').objectStore('blobs').getKey(blobId)));
  }

  // Files made here that haven't gone to the server yet.
  async function blobsToUpload() {
    await open();
    return (await promisify(db.transaction('blobs').objectStore('blobs').getAll())).filter(r => !r.uploaded_at);
  }

  async function markBlobUploaded(blobId) {
    await open();
    const tx = db.transaction('blobs', 'readwrite');
    const os = tx.objectStore('blobs');
    const row = await promisify(os.get(blobId));
    if (row) os.put({ ...row, uploaded_at: new Date().toISOString() });
    await done(tx);
  }

  // ---------- sync support (js/sync.js) ----------

  async function metaGet(key) {
    await open();
    return promisify(db.transaction('sync_meta').objectStore('sync_meta').get(key));
  }

  async function metaSet(key, value) {
    await open();
    const tx = db.transaction('sync_meta', 'readwrite');
    if (value === undefined) tx.objectStore('sync_meta').delete(key);
    else tx.objectStore('sync_meta').put(value, key);
    await done(tx);
  }

  async function outboxAll() {
    await open();
    return promisify(db.transaction('outbox').objectStore('outbox').getAll());
  }

  // Queue every record (turning sync on for data that was never pushed, e.g.
  // restored from a backup, or moving to another server). Sequence numbers from
  // an earlier server mean nothing to the new one, so they are forgotten.
  async function queueAll() {
    await open();
    let n = 0;
    for (const c of COLLECTIONS) {
      const tx = db.transaction([c, 'outbox'], 'readwrite');
      const records = await promisify(tx.objectStore(c).getAll());
      for (const record of records) {
        if (record._server_seq || record._share_seqs) { record._server_seq = 0; delete record._share_seqs; tx.objectStore(c).put(record); }
        tx.objectStore('outbox').put({ id: record.id, collection: c, queued_at: Date.now() }); n++;
      }
      await done(tx);
    }
    return n;
  }

  // Queue records for some places only ('personal' or share ids), or every
  // place they belong (null): e.g. what was there before a list was shared
  // goes up to the new share. An entry already waiting for every place stays that way.
  async function queue(collection, ids, places) {
    assertCollection(collection);
    await open();
    const tx = db.transaction('outbox', 'readwrite');
    const outbox = tx.objectStore('outbox');
    for (const id of ids) {
      const entry = await promisify(outbox.get(id));
      if (entry && !entry.places) continue;
      outbox.put(places ? { id, collection, queued_at: Date.now(), places: [...new Set([...(entry?.places || []), ...places])] } : { id, collection, queued_at: Date.now() });
    }
    await done(tx);
  }

  // Remove records from this device only (nothing is synced): used when
  // someone stops sharing with this account.
  async function forget(collection, ids) {
    assertCollection(collection);
    await open();
    const tx = db.transaction([collection, 'outbox'], 'readwrite');
    for (const id of ids) { tx.objectStore(collection).delete(id); tx.objectStore('outbox').delete(id); }
    await done(tx);
    if (ids.length) emit({ collection, id: null, remote: true, space: name });
  }

  // Where a record was last seen on the server: its seq in the account's own
  // records ('personal') or in a share.
  const seqIn = (record, place) => (place === 'personal' ? record._server_seq : record._share_seqs?.[place]) || 0;
  function setSeq(record, place, seq) {
    if (place === 'personal') record._server_seq = seq;
    else record._share_seqs = { ...(record._share_seqs || {}), [place]: seq };
  }

  // The server accepted a record ({ place: seq } for each place it went to).
  // Its outbox entry goes only once every place has it (`finished`) and the
  // record wasn't changed again meanwhile (same queued_at).
  async function markPushed(collection, id, seqs, queuedAt, finished = true) {
    assertCollection(collection);
    await open();
    const tx = db.transaction([collection, 'outbox'], 'readwrite');
    const record = await promisify(tx.objectStore(collection).get(id));
    const entry = await promisify(tx.objectStore('outbox').get(id));
    const untouched = finished && entry && entry.queued_at === queuedAt;
    if (record) {
      for (const [place, seq] of Object.entries(seqs)) setSeq(record, place, seq);
      if (untouched) record._dirty_fields = [];
      tx.objectStore(collection).put(record);
    }
    if (untouched || (finished && !entry)) tx.objectStore('outbox').delete(id);
    await done(tx);
  }

  // A record from the server (another device, or someone it's shared with):
  // merged field by field, later clock wins, so unpushed local edits survive.
  // Remembers the seq for that place. `requeue`: if it changed anything, send
  // it on to those places too (a share's changes to your own records also go
  // to your own records on the server).
  async function applyRemote(collection, incoming, seq, place = 'personal', requeue = null) {
    assertCollection(collection);
    await open();
    const tx = db.transaction([collection, 'sync_meta', 'outbox'], 'readwrite');
    const store = tx.objectStore(collection);
    for (const clock of Object.values(incoming._field_clocks || {})) observeHlc(clock);
    const local = await promisify(store.get(incoming.id));
    let changed = true;
    if (!local) {
      const fresh = { ...incoming, _dirty_fields: [], _server_seq: 0 };
      setSeq(fresh, place, seq);
      store.put(fresh);
    } else {
      const merged = { ...local, _field_clocks: { ...(local._field_clocks || {}) } };
      setSeq(merged, place, seq);
      changed = false;
      for (const [field, clock] of Object.entries(incoming._field_clocks || {})) {
        if (compareHlc(clock, merged._field_clocks[field]) > 0) {
          merged[field] = incoming[field];
          merged._field_clocks[field] = clock;
          changed = true;
        }
      }
      store.put(merged);
    }
    if (changed && requeue) {
      const entry = await promisify(tx.objectStore('outbox').get(incoming.id));
      if (!entry || entry.places) tx.objectStore('outbox').put({ id: incoming.id, collection, queued_at: Date.now(), places: [...new Set([...(entry?.places || []), ...requeue])] });
    }
    tx.objectStore('sync_meta').put(lastClock, 'clock');
    await done(tx);
    if (changed) emit({ collection, id: incoming.id, deleted: !!incoming.deleted_at, remote: true, space: name });
    return changed;
  }

  return { name, isLocal, open, erase, write, create, update, remove, restore, updateMany, purgeMany, exportAll, mergeRecords, get, list, outboxSize, putBlob, getBlob, hasBlob, blobsToUpload, markBlobUploaded, metaGet, metaSet, outboxAll, queueAll, queue, forget, seqIn, markPushed, applyRemote };
}

export const local = makeSpace(LOCAL_DB);
let current = local;
export const space = () => current;
export function useSpace(which) { current = which || local; }
const others = new Map();
// The space for things shared by one other account (by its user id).
export function spaceOf(ownerId) {
  if (!others.has(ownerId)) others.set(ownerId, makeSpace(`${LOCAL_DB}_from_${ownerId}`));
  return others.get(ownerId);
}
// They stopped sharing with this account: everything of theirs goes from this device.
export async function dropSpace(ownerId) {
  const gone = spaceOf(ownerId);
  if (current === gone) current = local;
  others.delete(ownerId);
  await gone.erase();
}

export const open = () => local.open();
// Erase everything on this device (every space): other open tabs close theirs (versionchange) and reload.
export async function eraseAll() {
  for (const other of others.values()) await other.erase();
  if (indexedDB.databases) for (const d of await indexedDB.databases()) if (d.name?.startsWith(`${LOCAL_DB}_from_`)) await makeSpace(d.name).erase();
  await local.erase();
}
export function create(collection, fields) { return current.create(collection, fields); }
export function update(collection, id, changes) { return current.update(collection, id, changes); }
export function remove(collection, id) { return current.remove(collection, id); }
export function restore(collection, id) { return current.restore(collection, id); }
export function updateMany(collection, changes) { return current.updateMany(collection, changes); }
export function purgeMany(collection, ids) { return current.purgeMany(collection, ids); }
export function get(collection, id, opts) { return current.get(collection, id, opts); }
export function list(collection, opts) { return current.list(collection, opts); }
export function putBlob(blobId, data, opts) { return current.putBlob(blobId, data, opts); }
export function getBlob(blobId) { return current.getBlob(blobId); }
export function hasBlob(blobId) { return current.hasBlob(blobId); }
// Backups, sync and device matters are always about this account's own space.
export function exportAll() { return local.exportAll(); }
export function mergeRecords(collection, incoming) { return local.mergeRecords(collection, incoming); }
export function outboxSize() { return local.outboxSize(); }
export function blobsToUpload() { return local.blobsToUpload(); }
export function markBlobUploaded(blobId) { return local.markBlobUploaded(blobId); }
export function metaGet(key) { return local.metaGet(key); }
export function metaSet(key, value) { return local.metaSet(key, value); }
export function outboxAll() { return local.outboxAll(); }
export function queueAll() { return local.queueAll(); }

// Forget the undo history (the data itself stays).
export async function clearHistory() {
  const d = await local.open();
  const tx = d.transaction('history', 'readwrite');
  tx.objectStore('history').clear();
  await done(tx);
}


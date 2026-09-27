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
  'contracts',
  'settings',
];

const DB_VERSION = 7; // bump when adding object stores; onupgradeneeded only adds what's missing
const LOCAL_DB = 'sifttest_local';
const SYSTEM_FIELDS = new Set(['id', '_field_clocks', '_dirty_fields', '_server_seq']);
const SETTINGS_ID = 'settings'; // fixed id so every device edits the same record

let db = null;
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

export async function open(name = LOCAL_DB) {
  if (db) return db;
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
  db.onversionchange = () => { db.close(); location.reload(); };

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

// Erase everything on this device: close the database and delete it. Other
// open tabs close theirs (versionchange) and reload.
export async function eraseAll() {
  if (db) { db.close(); db = null; }
  await new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(LOCAL_DB);
    r.onsuccess = () => resolve();
    r.onblocked = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// Forget the undo history (the data itself stays).
export async function clearHistory() {
  const d = await open();
  const tx = d.transaction('history', 'readwrite');
  tx.objectStore('history').clear();
  await done(tx);
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

async function write(collection, id, changes, { mustExist }) {
  assertCollection(collection);
  await open();
  const tx = db.transaction([collection, 'outbox', 'sync_meta'], 'readwrite');
  const existing = await promisify(tx.objectStore(collection).get(id));
  if (mustExist && !existing) {
    tx.abort();
    throw new Error(`${collection}/${id} not found`);
  }
  const record = stamp(existing, existing ? changes : { ...changes, id });
  if (record) {
    record.id = id;
    tx.objectStore(collection).put(record);
    tx.objectStore('outbox').put({ id, collection, queued_at: Date.now() });
    tx.objectStore('sync_meta').put(lastClock, 'clock');
  }
  await done(tx);
  if (record) {
    noteChange(collection, existing, record);
    emit({ collection, id, deleted: !!record.deleted_at });
  }
  return record || existing;
}

export function create(collection, fields = {}) {
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

export function update(collection, id, changes) {
  return write(collection, id, changes, { mustExist: true });
}

export function remove(collection, id) {
  return write(collection, id, { deleted_at: new Date().toISOString() }, { mustExist: true });
}

export function restore(collection, id) {
  return write(collection, id, { deleted_at: null }, { mustExist: true });
}

// Many updates in one transaction (reordering a long list, batch delete…).
// `changes` is [[id, fields], …]; missing ids are skipped. Returns the
// records that actually changed.
export async function updateMany(collection, changes) {
  assertCollection(collection);
  await open();
  const tx = db.transaction([collection, 'outbox', 'sync_meta'], 'readwrite');
  const records = tx.objectStore(collection);
  const changed = [];
  const befores = [];
  for (const [id, fields] of changes) {
    const existing = await promisify(records.get(id));
    const record = existing && stamp(existing, fields);
    if (!record) continue;
    records.put(record);
    tx.objectStore('outbox').put({ id, collection, queued_at: Date.now() });
    changed.push(record);
    befores.push(existing);
  }
  if (changed.length) tx.objectStore('sync_meta').put(lastClock, 'clock');
  await done(tx);
  changed.forEach((r, i) => noteChange(collection, befores[i], r));
  for (const r of changed) emit({ collection, id: r.id, deleted: !!r.deleted_at });
  return changed;
}

// "Delete forever": blank every content field but keep the record as a
// tombstone (id, clocks, deleted_at, purged_at) so sync can't bring it back.
export async function purgeMany(collection, ids) {
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

// ---------- history ----------
// Every change made through this store is recorded (field-level before and
// after) so any change can be undone later, one at a time, in any order.
// Writes close together form one entry; the toast that follows an action
// names it (labelHistory). History lives on this device only.

const HISTORY_MAX = 1000;
const QUIET = new Set(['updated_at', 'looked_up_at', '_field_clocks', '_dirty_fields', '_server_seq']);
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
export function labelHistory(label, extra = {}) {
  if (pending) {
    Object.assign(pending, { label }, extra);
    return flushHistory();
  }
  // Already flushed moments ago without a name: name it now.
  if (lastEntry && !lastEntry.label && Date.now() - Date.parse(lastEntry.at) < 4000) {
    Object.assign(lastEntry, { label }, extra);
    return putHistory(lastEntry);
  }
  return Promise.resolve();
}

async function putHistory(entry) {
  await open();
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
  const tx = db.transaction('history', 'readwrite');
  const keys = await promisify(tx.objectStore('history').getAllKeys());
  for (const k of keys.slice(0, Math.max(0, keys.length - HISTORY_MAX))) tx.objectStore('history').delete(k);
  await done(tx);
}

export async function historyList() {
  await flushHistory();
  await open();
  const all = await promisify(db.transaction('history').objectStore('history').getAll());
  return all.reverse(); // newest first
}

// ---------- backup / restore ----------

// Every record in every collection, tombstones included (for backups).
export async function exportAll() {
  await open();
  const out = {};
  for (const c of COLLECTIONS) out[c] = await promisify(db.transaction(c).objectStore(c).getAll());
  return out;
}

// Merge records from a backup (or, later, another device) field by field:
// for each field the later clock wins, exactly like sync. Records we don't
// have are added as they are. Clocks are kept, not re-stamped.
export async function mergeRecords(collection, incoming) {
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
  if (added || updated) emit({ collection, id: null });
  return { added, updated };
}

// ---------- reads ----------

export async function get(collection, id, { includeDeleted = false } = {}) {
  assertCollection(collection);
  await open();
  const record = await promisify(db.transaction(collection).objectStore(collection).get(id));
  if (!record || (record.deleted_at && !includeDeleted)) return null;
  return record;
}

export async function list(collection, { includeDeleted = false, filter } = {}) {
  assertCollection(collection);
  await open();
  const all = await promisify(db.transaction(collection).objectStore(collection).getAll());
  return all.filter(r => (includeDeleted || !r.deleted_at) && (!filter || filter(r)));
}

export async function outboxSize() {
  await open();
  return promisify(db.transaction('outbox').objectStore('outbox').count());
}

// ---------- settings ----------

const DEFAULT_SETTINGS = {
  default_calendar_id: null,
  week_start: 1,
  theme: 'blue', // blue | dark | light | auto
  pinned_areas: null, // null = app default
  spot_details: true, // phone numbers / emails in notes become contacts
  phone_country: '44', // calling code for numbers written without one
};

export async function getSettings() {
  const record = await get('settings', SETTINGS_ID);
  return { ...DEFAULT_SETTINGS, ...(record || {}) };
}

export async function updateSettings(changes) {
  const existing = await get('settings', SETTINGS_ID, { includeDeleted: true });
  return existing
    ? update('settings', SETTINGS_ID, changes)
    : create('settings', { id: SETTINGS_ID, ...DEFAULT_SETTINGS, ...changes });
}

// device_settings are local only and never synced (spec §4.7).
export async function getDeviceSettings() {
  await open();
  const value = await promisify(db.transaction('sync_meta').objectStore('sync_meta').get('device_settings'));
  return { server_url: null, device_name: null, keep_all_scans_on_device: true, ...(value || {}) };
}

export async function updateDeviceSettings(changes) {
  const current = await getDeviceSettings();
  const tx = db.transaction('sync_meta', 'readwrite');
  tx.objectStore('sync_meta').put({ ...current, ...changes }, 'device_settings');
  await done(tx);
}

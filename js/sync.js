// Sync with sift-server (spec §8). Local data is always the source the app
// works from; sync just exchanges encrypted records in the background.
//
//   pull  everything since the last seq, merge field by field
//   push  the outbox; on a conflict merge the server's copy and push again
//
// Runs on start, on regaining network, a few seconds after local changes,
// every 5 minutes, and on "Sync now".

import * as store from './store.js';
import * as cx from './crypto.js';

let keys = null;       // { records, ids } CryptoKeys
let account = null;    // { server, email, user_id, token, device_id }
let running = null;
let timer = null;
const listeners = new Set();
// state: off | idle | syncing | ok | offline | error. last = when the records
// last finished syncing; tried = when a sync last started; reached = when the
// server last answered; received = records that came in last time; files =
// the separate file queue (idle | syncing | error) and how many are waiting.
export let status = { state: 'off', pending: 0, last: null, tried: null, reached: null, received: 0, files: 'idle', filesWaiting: 0, error: null };

function setStatus(next) {
  status = { ...status, ...next };
  for (const fn of listeners) fn(status);
}
export const onStatus = fn => { listeners.add(fn); fn(status); return () => listeners.delete(fn); };

// ---------- how the connection is doing ----------
// Every request is timed; the last few (from the past minute) say whether the
// connection is good, slow or failing. A request that takes longer than its
// limit is given up (and tried again soon), so a poor signal can't leave sync
// stuck on "Syncing…".
const samples = []; // { at, ms, ok }
function sample(ms, ok) {
  samples.push({ at: Date.now(), ms, ok });
  while (samples.length > 20 || (samples.length && Date.now() - samples[0].at > 60000)) samples.shift();
  setStatus({ link: linkQuality(), checked: new Date().toISOString(), ...(ok ? { reached: new Date().toISOString() } : {}) });
}
// good | slow | weak | down | unknown
export function linkQuality() {
  const recent = samples.filter(s => Date.now() - s.at < 60000);
  if (!recent.length) return 'unknown';
  const last = recent.at(-1);
  if (!last.ok && recent.slice(-3).every(s => !s.ok)) return 'down';
  if (recent.some(s => !s.ok)) return 'weak';
  const okMs = recent.filter(s => s.ok).map(s => s.ms);
  const avg = okMs.reduce((a, b) => a + b, 0) / okMs.length;
  return avg > 1500 ? 'slow' : 'good';
}
async function timedFetch(url, opts = {}, limit = 20000) {
  const ctl = new AbortController();
  const t0 = performance.now();
  const timer = setTimeout(() => ctl.abort(), limit);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    sample(performance.now() - t0, true);
    return res;
  } catch (e) {
    sample(performance.now() - t0, false);
    throw e.name === 'AbortError' ? new TypeError('The server took too long to answer') : e;
  } finally {
    clearTimeout(timer);
  }
}
// A quick "are you there?" (Settings asks every 10 s while it's open).
export async function checkLink() {
  if (!account) return;
  try { await timedFetch(`${account.server}/api/health`, {}, 8000); } catch { /* counted */ }
}

async function api(method, path, body, server = account?.server) {
  const res = await timedFetch(`${server}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(account?.token ? { Authorization: `Bearer ${account.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `Server said ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const deviceName = () => {
  const ua = navigator.userAgent;
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Device';
  const app = matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'app' : 'browser';
  return `${kind} (${app})`;
};

// ---------- account ----------

export async function serverInfo(server) {
  server = server.trim().replace(/\/+$/, '');
  const res = await fetch(`${server}/api/health`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Server said ${res.status}`);
  return res.json();
}

// Joining a server (new account, sign in, recovery): everything on this device
// is queued for upload straight away, so it goes up even if the page is left
// before "Start syncing".
async function keep(server, email, login, dataKeyRaw) {
  keys = await cx.workingKeys(dataKeyRaw);
  privateKey = null;
  for (const k of ['share_private', 'share_public']) await store.metaSet(k, undefined);
  account = { server, email, user_id: login.user_id, token: login.token, device_id: login.device_id };
  await store.queueAll();
  await store.metaSet('sync_last_seq', 0);
  await store.metaSet('sync_keys', keys);
  await store.metaSet('sync_account', account);
  await store.updateDeviceSettings({ server_url: server });
}

// New account: returns the recovery code to show once.
export async function register(server, email, password) {
  server = server.replace(/\/+$/, '');
  const kdf = cx.newKdf();
  const master = await cx.deriveMaster(password, kdf);
  const dataKeyRaw = cx.newDataKey();
  const login = await api('POST', '/api/register', {
    email, kdf,
    auth_hash: await cx.loginHash(master, password),
    wrapped_data_key: await cx.wrapDataKey(master, dataKeyRaw),
    recovery_hash: await cx.recoveryHash(dataKeyRaw),
    device_name: deviceName(),
  }, server);
  await keep(server, email, login, dataKeyRaw);
  await store.metaSet('new_account', true); // a brand new account: Batch Book's examples may be added (examples.js)
  return cx.recoveryCode(dataKeyRaw);
}

// A new password, and the data key wrapped by it, for recover / changePassword.
async function newPassword(password, dataKeyRaw) {
  const kdf = cx.newKdf();
  const master = await cx.deriveMaster(password, kdf);
  return { kdf, auth_hash: await cx.loginHash(master, password), wrapped_data_key: await cx.wrapDataKey(master, dataKeyRaw) };
}

// Forgot the password: the recovery code opens the data; every other device is
// signed out and this one signs in with the new password.
export async function recover(server, email, code, password) {
  server = server.replace(/\/+$/, '');
  const dataKeyRaw = cx.fromRecoveryCode(code);
  const login = await api('POST', '/api/recover', {
    email, recovery_hash: await cx.recoveryHash(dataKeyRaw), device_name: deviceName(), ...await newPassword(password, dataKeyRaw),
  }, server);
  await keep(server, email, login, dataKeyRaw);
}

// While signed in: the old password must be right; other devices are signed out.
export async function changePassword(oldPassword, password) {
  const me = await api('GET', '/api/me');
  const oldMaster = await cx.deriveMaster(oldPassword, me.kdf);
  let dataKeyRaw;
  try { dataKeyRaw = await cx.unwrapDataKey(oldMaster, me.wrapped_data_key); } catch { throw new Error('The current password is wrong'); }
  await api('POST', '/api/password', { old_auth_hash: await cx.loginHash(oldMaster, oldPassword), ...await newPassword(password, dataKeyRaw) });
}

export async function signIn(server, email, password) {
  server = server.replace(/\/+$/, '');
  const { kdf } = await api('POST', '/api/prelogin', { email }, server);
  const master = await cx.deriveMaster(password, kdf);
  const login = await api('POST', '/api/login', { email, auth_hash: await cx.loginHash(master, password), device_name: deviceName() }, server);
  await keep(server, email, login, await cx.unwrapDataKey(master, login.wrapped_data_key));
}

// Turning sync on (everything was queued on joining, see keep): the
// account's data is pulled and merged, then everything is pushed.
export async function start() {
  wire();
  setStatus({ state: 'idle', pending: await store.outboxSize(), error: null });
  schedule(0);
}

export async function signOut() {
  try { await api('POST', '/api/logout'); } catch { /* offline: forget locally anyway */ }
  keys = null;
  account = null;
  privateKey = null;
  for (const owner of new Set(shares.filter(sh => !sh.mine).map(sh => sh.owner_id))) await store.dropSpace(owner);
  await setShares([]);
  for (const k of ['share_private', 'share_public', 'share_keys', 'share_seqs']) await store.metaSet(k, undefined);
  await store.metaSet('sync_keys', undefined);
  await store.metaSet('sync_account', undefined);
  await store.metaSet('sync_last_seq', undefined);
  clearTimeout(timer);
  setStatus({ state: 'off', error: null });
}

export const signedIn = () => (account ? { ...account, token: undefined } : null);

export async function devices() { return (await api('GET', '/api/devices')).devices; }

// ---------- the sync itself ----------

const strip = r => { const { _dirty_fields, _server_seq, _share_seqs, ...rest } = r; return rest; };

async function pull() {
  let changed = 0;
  // Kinds of record this version knows that an older one skipped (e.g. Batch Book's): fetch everything once more.
  const kinds = store.COLLECTIONS.join(',');
  if ((await store.metaGet('sync_collections')) !== kinds) await store.metaSet('sync_last_seq', 0);
  let since = (await store.metaGet('sync_last_seq')) || 0;
  for (;;) {
    const page = await api('GET', `/api/sync/pull?since=${since}&limit=500`);
    for (const row of page.records) {
      const { c, r } = await cx.openJson(keys, row.ciphertext);
      if (store.COLLECTIONS.includes(c) && r?.id && await store.local.applyRemote(c, r, row.seq)) changed++;
    }
    since = page.last_seq;
    await store.metaSet('sync_last_seq', since);
    if (!page.more) break;
  }
  await store.metaSet('sync_collections', kinds);
  return changed;
}

// Everything changed in each share since last time. What comes from your own
// share (someone you shared with changed it) goes into your own records and
// on to your own records on the server; what others share goes into their
// space on this device.
async function pullShares() {
  let changed = 0;
  const seqs = (await store.metaGet('share_seqs')) || {};
  for (const sh of shares.filter(x => x.accepted)) {
    const space = sh.mine ? store.local : store.spaceOf(sh.owner_id);
    let since = seqs[sh.id] || 0;
    for (;;) {
      let page;
      try { page = await api('GET', `/api/shares/${sh.id}/pull?since=${since}&limit=500`); } catch (e) { if (e.status === 404) break; throw e; } // just ended: gone next time
      for (const row of page.records) {
        const { c, r } = await cx.openJson(sh.keys, row.ciphertext);
        if (!store.COLLECTIONS.includes(c) || !r?.id) continue;
        const onward = sh.mine ? routes(space, c, r).filter(id => id !== sh.id) : [];
        if (await space.applyRemote(c, r, row.seq, sh.id, onward.length ? onward : null)) changed++;
      }
      since = seqs[sh.id] = page.last_seq;
      await store.metaSet('share_seqs', seqs);
      if (!page.more) break;
    }
  }
  return changed;
}

// The shares a record belongs to (by id). A shared record is kept only in its
// share on the server, not in your own records as well: one copy, which
// everyone it's shared with works on.
const IN_SCOPE = {
  list: (info, c, r) => (c === 'lists' && r.id === info.id) || (c === 'list_items' && r.list_id === info.id),
  note: (info, c, r) => c === 'thoughts' && r.id === info.id,
  recipe: (info, c, r) => (c === 'recipes' && r.id === info.id) || ((c === 'recipe_makes' || c === 'recipe_entries') && r.recipe_id === info.id),
  days: (info, c, r) => (c === 'days' || c === 'day_items') && !!r.date && (!info.from || r.date >= info.from) && (!info.to || r.date <= info.to),
};
const SHAREABLE = ['lists', 'list_items', 'thoughts', 'days', 'day_items', 'recipes', 'recipe_makes', 'recipe_entries'];
export const inShare = (sh, c, r) => !!IN_SCOPE[sh.info?.kind]?.(sh.info, c, r);
function routes(space, c, r) {
  return shares.filter(sh => sh.accepted && (space.isLocal ? sh.mine : !sh.mine && space === store.spaceOf(sh.owner_id)) && inShare(sh, c, r)).map(sh => sh.id);
}

// Push every space's outbox: your own to your records, or to its shares if
// it's shared; others' to the shares they came from. A conflict is merged and pushed
// again next round.
async function push() {
  const spaces = [store.local, ...new Set(shares.filter(sh => sh.accepted && !sh.mine).map(sh => store.spaceOf(sh.owner_id)))];
  for (let round = 0; round < 5; round++) {
    let conflicts = 0;
    for (const space of spaces) conflicts += await pushSpace(space);
    if (!conflicts) return;
  }
}

async function pushSpace(space) {
  const entries = await space.outboxAll();
  let conflicts = 0;
  for (let i = 0; i < entries.length; i += 200) {
    const byPlace = new Map(); // place → [{ e, rec }]
    const results = new Map(); // entry id → { seqs, conflicted }
    for (const e of entries.slice(i, i + 200)) {
      const rec = await space.get(e.collection, e.id, { includeDeleted: true });
      if (!rec) { await space.markPushed(e.collection, e.id, {}, e.queued_at); continue; }
      const inShares = routes(space, e.collection, rec);
      const valid = space.isLocal && !inShares.length ? ['personal'] : inShares;
      const places = e.places ? e.places.filter(p => valid.includes(p)) : valid;
      results.set(e.id, { e, rec, places, seqs: {}, conflicted: false });
      for (const place of places) {
        if (!byPlace.has(place)) byPlace.set(place, []);
        byPlace.get(place).push({ e, rec });
      }
    }
    for (const [place, list] of byPlace) {
      const sh = place === 'personal' ? null : shares.find(x => x.id === place);
      const placeKeys = sh ? sh.keys : keys;
      const meta = new Map();
      const batch = [];
      for (const { e, rec } of list) {
        const rid = await cx.opaqueId(placeKeys, e.collection, e.id);
        meta.set(rid, e);
        batch.push({ record_id: rid, base_seq: space.seqIn(rec, place), ciphertext: await cx.sealJson(placeKeys, { c: e.collection, r: strip(rec) }) });
      }
      let res;
      try { res = await api('POST', sh ? `/api/shares/${sh.id}/push` : '/api/sync/push', { records: batch }); } catch (e) {
        if (!sh || e.status !== 404) throw e;
        for (const { e: entry } of list) results.get(entry.id).conflicted = true; // the share just ended: kept for the next round
        continue;
      }
      for (const a of res.accepted) results.get(meta.get(a.record_id).id).seqs[place] = a.seq;
      for (const c of res.conflicts) {
        const { c: coll, r } = await cx.openJson(placeKeys, c.ciphertext);
        await space.applyRemote(coll, r, c.seq, place); // merged; still queued, pushed again next round
        results.get(meta.get(c.record_id).id).conflicted = true;
        conflicts++;
      }
    }
    // Now in a share: the old copy in your own records goes (one copy only).
    const moved = [...results.values()].filter(x => space.isLocal && !x.conflicted && x.rec._server_seq && x.places.length && !x.places.includes('personal'));
    if (moved.length) {
      await api('POST', '/api/sync/forget', { record_ids: await Promise.all(moved.map(x => cx.opaqueId(keys, x.e.collection, x.e.id))) });
      for (const x of moved) x.seqs.personal = 0;
    }
    for (const { e, seqs, conflicted } of results.values()) await space.markPushed(e.collection, e.id, seqs, e.queued_at, !conflicted);
  }
  return conflicts;
}

// ---------- sharing ----------
// Shares this account is in (its own, and others' it accepted or is invited
// to), each with its key and what it holds (info: { kind: 'list' | 'note' |
// 'recipe' | 'days', id | from, to, name }). Kept on this device between syncs.

let shares = [];
let privateKey = null;
const shareListeners = new Set();
export const sharesNow = () => shares;
export const onShares = fn => { shareListeners.add(fn); fn(shares); return () => shareListeners.delete(fn); };
export const myUserId = () => account?.user_id;
// "anna.smith@example.com" → "Anna": what the app calls someone.
export const personName = email => { const first = String(email || '').split('@')[0].split(/[._+-]/)[0]; return first ? first[0].toUpperCase() + first.slice(1) : 'Someone'; };

// The account's key pair: made once by whichever device gets there first.
async function ensureKeyPair() {
  if (privateKey) return;
  privateKey = await store.metaGet('share_private');
  if (privateKey) return;
  let me = await api('GET', '/api/me');
  if (!me.public_key) me = await api('POST', '/api/keypair', await cx.newKeyPair(keys));
  privateKey = await cx.openPrivateKey(keys, me.wrapped_private_key);
  await store.metaSet('share_private', privateKey);
  await store.metaSet('share_public', me.public_key);
}

async function refreshShares() {
  await ensureKeyPair();
  const res = await api('GET', '/api/shares');
  const known = (await store.metaGet('share_keys')) || {};
  const next = [];
  for (const s of res.shares) {
    try {
      const shareKeys = known[s.id] || (known[s.id] = await cx.workingKeys(await cx.openShareKey(privateKey, s.wrapped_key)));
      next.push({ id: s.id, wrapped_key: s.wrapped_key, mine: s.mine, owner_id: s.owner_id, owner_email: s.owner_email, accepted: !!s.accepted_at, created_at: s.created_at, keys: shareKeys, info: await cx.openJson(shareKeys, s.info),
        members: s.members.map(m => ({ user_id: m.user_id, email: m.email, accepted: !!m.accepted_at })) });
    } catch (e) { console.warn('A share could not be opened:', e.message); }
  }
  // Gone (stopped, or you were taken out or left): what came from it goes from this device.
  for (const gone of shares.filter(old => !old.mine && old.accepted && !next.some(sh => sh.id === old.id && sh.accepted))) await forgetShare(gone, next);
  for (const id of Object.keys(known)) if (!next.some(sh => sh.id === id)) delete known[id];
  const seqs = (await store.metaGet('share_seqs')) || {};
  for (const id of Object.keys(seqs)) if (!next.some(sh => sh.id === id && sh.accepted)) delete seqs[id];
  await store.metaSet('share_seqs', seqs);
  await store.metaSet('share_keys', known);
  await setShares(next);
}

async function setShares(next) {
  const plain = next.map(({ keys: _, ...rest }) => rest);
  const same = JSON.stringify(plain) === JSON.stringify(shares.map(({ keys: _, ...rest }) => rest));
  shares = next;
  if (same) return;
  await store.metaSet('shares', plain);
  for (const fn of shareListeners) fn(shares);
}

async function forgetShare(gone, still) {
  const others = still.filter(sh => sh.accepted && !sh.mine && sh.owner_id === gone.owner_id);
  if (!others.length) return store.dropSpace(gone.owner_id);
  const space = store.spaceOf(gone.owner_id);
  for (const c of SHAREABLE) {
    const ids = (await space.list(c, { includeDeleted: true })).filter(r => inShare(gone, c, r) && !others.some(sh => inShare(sh, c, r))).map(r => r.id);
    await space.forget(c, ids);
  }
}

const sameScope = (a, b) => a.kind === b.kind && (a.kind === 'days' ? a.from === b.from && a.to === b.to : a.id === b.id);

// Share something with someone on this server (by their sign-in email).
// They get an invitation; it reaches them once they accept.
export async function shareWith(info, email) {
  if (!account) throw new Error('Sign in to sync first: sharing goes through your server');
  try { await refreshShares(); } catch (e) { throw e.status === 404 ? new Error('Your sync server needs updating before it can share') : e; }
  const person = await api('POST', '/api/people/find', { email: email.trim() });
  if (person.user_id === account.user_id) throw new Error("That's you");
  const sh = shares.find(x => x.mine && sameScope(x.info, info));
  let raw;
  let id = sh?.id;
  if (!sh) {
    raw = cx.newDataKey();
    id = store.uuidv7();
    const shareKeys = await cx.workingKeys(raw);
    await api('POST', '/api/shares', { id, wrapped_key: await cx.sealShareKey(await store.metaGet('share_public'), raw), info: await cx.sealJson(shareKeys, info) });
    // What is already there goes up to the share.
    for (const c of SHAREABLE) {
      const probe = { info };
      const ids = (await store.local.list(c, { includeDeleted: true })).filter(r => inShare(probe, c, r)).map(r => r.id);
      if (ids.length) await store.local.queue(c, ids, [id]);
    }
  } else {
    if (sh.members.some(m => m.user_id === person.user_id)) throw new Error(`Already shared with ${personName(person.email)}`);
    raw = await cx.openShareKey(privateKey, sh.wrapped_key);
  }
  await api('POST', `/api/shares/${id}/members`, { user_id: person.user_id, wrapped_key: await cx.sealShareKey(person.public_key, raw) });
  await refreshShares();
  syncNow();
  return personName(person.email);
}

export async function acceptShare(id) { await api('POST', `/api/shares/${id}/accept`); await refreshShares(); return syncNow(); }
// Decline an invitation, leave a share, or (the owner) take someone out.
export async function leaveShare(id, userId = account.user_id) { await api('DELETE', `/api/shares/${id}/members/${userId}`); await refreshShares(); }
// Stop sharing: it stays yours (back into your own records); everyone else loses it.
export async function stopSharing(id) {
  const sh = shares.find(x => x.id === id);
  for (const c of SHAREABLE) {
    const ids = (await store.local.list(c, { includeDeleted: true })).filter(r => sh && inShare(sh, c, r)).map(r => r.id);
    if (ids.length) await store.local.queue(c, ids, null);
  }
  await api('DELETE', `/api/shares/${id}`);
  await refreshShares();
  syncNow();
}
export async function loadShares() { if (account && keys) { try { await refreshShares(); } catch (e) { console.warn('Shares not checked:', e.message); } } }

// ---------- attachment files ----------
// The records (name, type, thumbnail) sync like everything else; the files
// travel separately, encrypted with the same key, under opaque ids.

const MAX_AUTO_DOWNLOAD = 5 * 1024 * 1024; // bigger files are fetched when you open them

async function fileRequest(method, id, body) {
  const res = await timedFetch(`${account.server}/api/blobs/${await cx.opaqueId(keys, 'blobs', id)}`, {
    method, headers: { Authorization: `Bearer ${account.token}` }, body,
  }, 5 * 60 * 1000); // files may be big: up to 5 minutes
  if (res.status === 401 || (!res.ok && res.status !== 404)) {
    const err = new Error(res.status === 507 ? 'Storage quota reached on the server' : `Server said ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function pushFiles() {
  for (const row of await store.blobsToUpload()) {
    const att = await store.get('attachments', row.blob_id, { includeDeleted: true });
    if (!att || att.deleted_at) continue; // removed again: nothing to send
    const sealed = await cx.sealBlob(keys, new Uint8Array(await row.data.arrayBuffer()));
    await fileRequest('PUT', row.blob_id, sealed);
    await store.markBlobUploaded(row.blob_id);
  }
}

// Fetch one attachment's file from the server (null if it isn't there yet).
export async function downloadFile(a) {
  if (!account || !keys) return null;
  const res = await fileRequest('GET', a.blob_id);
  if (res.status === 404) return null;
  const plain = await cx.openBlob(keys, new Uint8Array(await res.arrayBuffer()));
  const blob = new Blob([plain], { type: a.mime });
  await store.putBlob(a.blob_id, blob, { uploaded: true });
  return blob;
}

async function pullFiles() {
  let arrived = 0;
  for (const a of await store.list('attachments')) {
    if (a.size > MAX_AUTO_DOWNLOAD || await store.hasBlob(a.blob_id)) continue;
    await downloadFile(a);
    arrived++;
    setStatus({ filesWaiting: Math.max(0, status.filesWaiting - 1) });
  }
  return arrived;
}
// How many files are still to go up or come down to this device.
async function filesWaiting() {
  let n = (await store.blobsToUpload()).length;
  for (const a of await store.list('attachments')) if (a.size <= MAX_AUTO_DOWNLOAD && !await store.hasBlob(a.blob_id)) n++;
  return n;
}

// Files (photos, PDFs…) go in their own queue after the records, so a big or
// slow file never holds up the text: new tasks and notes show as soon as
// they arrive, and a file shows "still arriving" until it's here.
let filesRunning = null;
function syncFiles() {
  if (filesRunning) return filesRunning;
  filesRunning = (async () => {
    try {
      setStatus({ files: 'syncing', filesWaiting: await filesWaiting(), filesWaitingUp: (await store.blobsToUpload()).length });
      await pushFiles();
      const arrived = await pullFiles();
      setStatus({ files: 'idle', fileError: null, filesWaiting: await filesWaiting(), filesWaitingUp: (await store.blobsToUpload()).length, filesArrived: arrived });
    } catch (e) {
      console.warn('Files not synced:', e.message);
      setStatus({ files: 'error', fileError: e.message });
    } finally {
      filesRunning = null;
    }
  })();
  return filesRunning;
}

export async function syncNow() {
  if (!account || !keys) return;
  if (running) return running;
  running = (async () => {
    setStatus({ state: 'syncing', error: null, tried: new Date().toISOString() });
    try {
      // Sharing never holds up your own records (e.g. a server without it yet).
      try { await refreshShares(); } catch (e) { console.warn('Shares not checked:', e.message); }
      const changed = await pull() + await pullShares();
      await push();
      setStatus({ state: 'ok', last: new Date().toISOString(), pending: await store.outboxSize(), error: null, changed, received: changed });
      failures = 0;
      syncFiles(); // in the background: doesn't hold up the records
    } catch (e) {
      const offline = !navigator.onLine || e instanceof TypeError; // fetch failed: no network, or the server can't be reached
      setStatus({ state: offline ? 'offline' : 'error', error: offline ? null : e.message, pending: await store.outboxSize() });
      failures++;
      if (e.status === 401) { await store.metaSet('sync_account', undefined); account = null; setStatus({ state: 'off', error: `The server signed this device out (${e.message}). Sign in again.` }); }
    } finally {
      running = null;
      // Next try: every 30 s while the app is on screen (5 min when it isn't);
      // after a failure sooner: 10, 20, 40, then every 60 s.
      if (account) schedule(failures ? Math.min(60000, 10000 * 2 ** (failures - 1)) : document.visibilityState === 'visible' ? 30000 : 300000);
    }
  })();
  return running;
}
let failures = 0;

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

// Background triggers, set up once a device is signed in.
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  store.subscribe(ch => { if (!ch.remote && account) { setStatus({ pending: status.pending + 1 }); schedule(4000); } });
  addEventListener('online', () => schedule(500));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(500); });
  // (the next try is scheduled after each one: see syncNow)
}

// Called once from app.js. `ready` settles once the saved sign-in has been
// read, so pages don't show "Sign in" to a device that is signed in.
let markReady;
export const ready = new Promise(ok => { markReady = ok; });
export async function init() {
  try { await load(); } finally { markReady(); }
}
async function load() {
  account = await store.metaGet('sync_account');
  keys = await store.metaGet('sync_keys');
  const keyring = (await store.metaGet('share_keys')) || {};
  shares = ((await store.metaGet('shares')) || []).filter(sh => keyring[sh.id]).map(sh => ({ ...sh, keys: keyring[sh.id] }));
  if (shares.length) for (const fn of shareListeners) fn(shares); // pages drawn before this show them now
  if (!account || !keys) { setStatus({ state: 'off', pending: await store.outboxSize() }); return; }
  setStatus({ state: 'idle', pending: await store.outboxSize() });
  wire();
  schedule(300);
}

// ---------- is this device in step? ----------

// A short code for all the records on this device (every record's id and
// the time each of its fields last changed), shown as three words. Two devices
// with the same words hold the same data. Device settings and files aren't in
// it (they differ between devices on purpose).
const CODE_WORDS = [
  'apple', 'arrow', 'badge', 'baker', 'bamboo', 'banjo', 'beach', 'beacon', 'berry', 'bison', 'blaze', 'bloom',
  'bottle', 'bramble', 'breeze', 'brick', 'bridge', 'brook', 'bucket', 'butter', 'cabin', 'cactus', 'camel', 'candle',
  'canyon', 'carpet', 'castle', 'cedar', 'chalk', 'cherry', 'chimney', 'cinder', 'circus', 'citrus', 'clover', 'cobalt',
  'comet', 'copper', 'coral', 'cotton', 'cradle', 'crane', 'crater', 'cricket', 'crystal', 'cupboard', 'dagger', 'daisy',
  'dancer', 'delta', 'desert', 'diamond', 'dolphin', 'dragon', 'drum', 'eagle', 'ember', 'engine', 'falcon', 'feather',
  'fern', 'fiddle', 'flame', 'flute', 'forest', 'fossil', 'fountain', 'fox', 'galaxy', 'garden', 'garnet', 'ginger',
  'glacier', 'globe', 'goose', 'granite', 'grape', 'gravel', 'harbour', 'harvest', 'hazel', 'hedge', 'helmet', 'heron',
  'hollow', 'honey', 'horizon', 'island', 'ivory', 'jacket', 'jasmine', 'jelly', 'jungle', 'kettle', 'kite', 'ladder',
  'lagoon', 'lantern', 'lemon', 'lily', 'linen', 'lizard', 'lobster', 'magnet', 'mango', 'maple', 'marble', 'meadow',
  'melon', 'meteor', 'mint', 'mirror', 'monkey', 'moss', 'mountain', 'mushroom', 'needle', 'nest', 'nickel', 'oasis',
  'ocean', 'olive', 'onion', 'orchard', 'otter', 'oyster', 'paddle', 'palace', 'panda', 'paper', 'parrot', 'pebble',
  'pepper', 'pickle', 'pigeon', 'pillow', 'pine', 'planet', 'plum', 'pocket', 'pony', 'poppy', 'puddle', 'pumpkin',
  'quartz', 'quill', 'rabbit', 'radar', 'raven', 'reef', 'ribbon', 'river', 'robin', 'rocket', 'rose', 'ruby',
  'saddle', 'salmon', 'sandal', 'satin', 'scarf', 'shadow', 'shell', 'shovel', 'silver', 'sketch', 'sledge', 'slipper',
  'spark', 'sparrow', 'spider', 'spoon', 'spruce', 'squirrel', 'stable', 'star', 'stone', 'storm', 'sugar', 'summit',
  'sunset', 'swan', 'table', 'tangle', 'temple', 'thistle', 'thunder', 'tiger', 'timber', 'toast', 'topaz', 'torch',
  'tower', 'trumpet', 'tulip', 'tunnel', 'turtle', 'umbrella', 'valley', 'velvet', 'violet', 'volcano', 'wagon', 'walnut',
  'walrus', 'wand', 'whale', 'wheat', 'whistle', 'willow', 'window', 'winter', 'wizard', 'wolf', 'yacht', 'zebra',
  'acorn', 'anchor', 'atlas', 'basket', 'beetle', 'blossom', 'button', 'canoe', 'carrot', 'cello', 'cobweb', 'compass',
  'cookie', 'dune', 'easel', 'falafel', 'ferry', 'fig', 'goblet', 'hammock', 'igloo', 'jigsaw', 'kayak', 'koala',
  'lemur', 'locket', 'marsh', 'mitten', 'muffin', 'nutmeg', 'orbit', 'paprika', 'pelican', 'pixel', 'prism', 'quiver',
  'raisin', 'rhubarb', 'sapphire', 'scooter',
];
export async function dataCode() {
  const parts = [];
  for (const c of store.COLLECTIONS) {
    for (const r of await store.list(c, { includeDeleted: true })) {
      const clocks = r._field_clocks || {};
      parts.push(`${c}/${r.id}/${Object.keys(clocks).sort().map(k => `${k}=${clocks[k]}`).join(',')}`);
    }
  }
  parts.sort();
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\n'))));
  return { words: [hash[0], hash[1], hash[2]].map(b => CODE_WORDS[b]).join(' '), records: parts.length };
}

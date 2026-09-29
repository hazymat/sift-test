// Backup / restore (spec §10). A .sift file is JSON, gzipped, and optionally
// encrypted with a passphrase (PBKDF2-SHA256 → AES-GCM, all WebCrypto).
//   { format: 'sift-backup', version: 1, created_at, encrypted: false, data, files }
// `files` holds each attachment's file as base64, keyed by its id (a backup with lots of
// big attachments is big; it is all held in memory while it is made).
//   { format: 'sift-backup', version: 1, created_at, encrypted: true, salt, iv, iterations, ciphertext }
// Restore merges field by field (later edit wins), so it's a full restore on
// an empty device and a safe merge on one that already has data.

import * as store from './store.js';

const ITERATIONS = 600000;
const REMIND_DAYS = 14;

const b64 = buf => { let s = ''; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

async function gzip(text) {
  if (!('CompressionStream' in self)) return new TextEncoder().encode(text);
  return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
async function gunzip(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes); // not compressed
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

async function keyFrom(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// This device's own preferences (not synced): text size, notes toolbar,
// each page's spacing and look, the theme, Find Things' last life area, and the sync
// server's address. Not drafts, sign-ins or reminders.
const DEVICE_KEYS = /^(sift-text-size|sift-theme|sift-custom|sift-find-edition|sift:notes-toolbar|sift-density:.+|sift-shade:.+)$/;
function devicePrefs() {
  const local = {};
  try {
    for (let i = 0; i < siftTestStorage.length; i++) {
      const k = siftTestStorage.key(i);
      if (DEVICE_KEYS.test(k)) local[k] = siftTestStorage.getItem(k);
    }
  } catch { /* none */ }
  return local;
}

export async function makeBackup({ passphrase } = {}) {
  const data = await store.exportAll();
  const device = { local: devicePrefs(), server_url: (await store.getDeviceSettings()).server_url || null };
  const files = {};
  for (const a of data.attachments || []) {
    if (a.deleted_at) continue;
    const blob = await store.getBlob(a.blob_id);
    if (blob) files[a.blob_id] = { type: blob.type || a.mime, data: b64(await blob.arrayBuffer()) };
  }
  const created_at = new Date().toISOString();
  const inner = JSON.stringify({ format: 'sift-backup', version: 1, created_at, device_id: store.getDeviceId(), data, files, device });
  let file;
  if (passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFrom(passphrase, salt, ITERATIONS);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await gzip(inner));
    file = new Blob([JSON.stringify({ format: 'sift-backup', version: 1, created_at, encrypted: true, salt: b64(salt), iv: b64(iv), iterations: ITERATIONS, ciphertext: b64(ciphertext) })], { type: 'application/json' });
  } else {
    file = new Blob([await gzip(inner)], { type: 'application/gzip' });
  }
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]).filter(([, n]) => n));
  if (Object.keys(files).length) counts.files = Object.keys(files).length;
  return { blob: file, name: `sift-backup-${created_at.slice(0, 10)}.sift`, counts };
}

// Save via the share sheet where available (iPhone: Save to Files / iCloud
// Drive), otherwise download.
export async function saveBackupFile({ blob, name }) {
  const file = new File([blob], name, { type: 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; } catch (err) { if (err.name === 'AbortError') return 'cancelled'; }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return 'downloaded';
}

export class NeedsPassphrase extends Error {}

export async function readBackup(file, passphrase) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text;
  if (bytes[0] === 0x7b) { // "{": an encrypted wrapper (or plain JSON)
    const outer = JSON.parse(new TextDecoder().decode(bytes));
    if (outer.encrypted) {
      if (!passphrase) throw new NeedsPassphrase('This backup is locked with a passphrase.');
      const key = await keyFrom(passphrase, unb64(outer.salt), outer.iterations);
      let plain;
      try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(outer.iv) }, key, unb64(outer.ciphertext)); }
      catch { throw new Error('Wrong passphrase.'); }
      text = await gunzip(new Uint8Array(plain));
    } else {
      text = new TextDecoder().decode(bytes);
    }
  } else {
    text = await gunzip(bytes);
  }
  const backup = JSON.parse(text);
  if (backup.format !== 'sift-backup') throw new Error("That file isn't a Sift backup.");
  return backup;
}

export async function restoreBackup(backup) {
  let added = 0;
  let updated = 0;
  for (const [collection, records] of Object.entries(backup.data || {})) {
    if (!store.COLLECTIONS.includes(collection)) continue;
    const r = await store.mergeRecords(collection, records);
    added += r.added;
    updated += r.updated;
  }
  // Attachment files this device doesn't have yet (they upload on the next sync).
  let filesRestored = 0;
  for (const [id, f] of Object.entries(backup.files || {})) {
    if (await store.hasBlob(id)) continue;
    await store.putBlob(id, new Blob([unb64(f.data)], { type: f.type }));
    filesRestored++;
  }
  // This device's own preferences: only the ones it hasn't set itself, so a
  // restore never undoes choices made on this device.
  let prefs = 0;
  const dev = backup.device || {};
  for (const [k, v] of Object.entries(dev.local || {})) {
    try { if (DEVICE_KEYS.test(k) && siftTestStorage.getItem(k) === null) { siftTestStorage.setItem(k, v); prefs++; } } catch { /* fine */ }
  }
  if (dev.server_url && !(await store.getDeviceSettings()).server_url) { await store.updateDeviceSettings({ server_url: dev.server_url }); prefs++; }
  return { added, updated, files: filesRestored, prefs };
}

// ---------- reminders ----------

export async function lastBackup() {
  return (await store.getDeviceSettings()).last_backup_at || null;
}

export async function noteBackup() {
  await store.updateDeviceSettings({ last_backup_at: new Date().toISOString() });
}

export async function backupOverdue() {
  const last = await lastBackup();
  if (last) return Date.now() - Date.parse(last) > REMIND_DAYS * 86400000;
  // Never backed up: only nag once there's something worth keeping.
  const data = await store.exportAll();
  return Object.entries(data).some(([k, v]) => k !== 'settings' && v.length > 0);
}

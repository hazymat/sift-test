// End-to-end encryption for sync (spec §8.2). Everything here runs on the
// device; the server only ever sees the login hash, the wrapped data key and
// encrypted records.
//
//   password ──PBKDF2 (600k)──▶ master key ──PBKDF2 (1, salt=password)──▶ login hash (sent)
//                                    └──HKDF "wrap"──▶ wraps the data key
//   data key (random, 32 bytes) ──HKDF──▶ record key (AES-GCM) + id key (HMAC)
//
// The data key never changes; a new password just re-wraps it. The recovery
// code is the data key itself, shown once when the account is made; the
// server keeps only a one-way hash of it (recoveryHash) to check a code.

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = crypto.subtle;

export const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export function newKdf() {
  return { name: 'PBKDF2-SHA256', iterations: 600000, salt: b64(crypto.getRandomValues(new Uint8Array(16))) };
}

export async function deriveMaster(password, kdf) {
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(kdf.salt), iterations: kdf.iterations }, base, 256));
}

export async function loginHash(master, password) {
  const base = await subtle.importKey('raw', master, 'PBKDF2', false, ['deriveBits']);
  return b64(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(password), iterations: 1 }, base, 256));
}

async function hkdf(raw, info, algorithm, usages, extractable = false) {
  const base = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('sift'), info: enc.encode(info) }, base, algorithm, extractable, usages);
}

async function sealBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64(out);
}

async function openBytes(key, text) {
  const all = unb64(text);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12)));
}

// Attachment files: iv + ciphertext as raw bytes (no base64, so a 10 MB photo stays about 10 MB).
export async function sealBlob(keys, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, keys.records, bytes));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

export async function openBlob(keys, all) {
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, keys.records, all.slice(12)));
}

export async function wrapDataKey(master, dataKeyRaw) {
  return sealBytes(await hkdf(master, 'wrap', { name: 'AES-GCM', length: 256 }, ['encrypt']), dataKeyRaw);
}

export async function unwrapDataKey(master, wrapped) {
  return openBytes(await hkdf(master, 'wrap', { name: 'AES-GCM', length: 256 }, ['decrypt']), wrapped);
}

// What the server keeps to check a recovery code: a one-way value made from
// the data key, so the server can't use it to read anything.
export async function recoveryHash(dataKeyRaw) {
  const base = await subtle.importKey('raw', dataKeyRaw, 'HKDF', false, ['deriveBits']);
  return b64(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('sift'), info: enc.encode('recovery') }, base, 256));
}

export const newDataKey = () => crypto.getRandomValues(new Uint8Array(32));

// The keys sync works with; not extractable, so they can live in IndexedDB.
export async function workingKeys(dataKeyRaw) {
  return {
    records: await hkdf(dataKeyRaw, 'records', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
    ids: await hkdf(dataKeyRaw, 'ids', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
  };
}

export async function sealJson(keys, value) {
  return sealBytes(keys.records, enc.encode(JSON.stringify(value)));
}

export async function openJson(keys, text) {
  return JSON.parse(dec.decode(await openBytes(keys.records, text)));
}

// Record ids on the server: a keyed hash of collection + id, so the server
// can't tell what anything is or group records by kind.
export async function opaqueId(keys, collection, id) {
  const sig = new Uint8Array(await subtle.sign('HMAC', keys.ids, enc.encode(`${collection}/${id}`)));
  return [...sig.slice(0, 20)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Recovery code: the data key as 64 hex characters in groups of 4.
export const recoveryCode = raw => [...raw].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g).join('-');
export function fromRecoveryCode(code) {
  const hex = code.replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 64) throw new Error('A recovery code has 64 letters and numbers');
  return Uint8Array.from(hex.match(/../g), h => parseInt(h, 16));
}

// ---------- sharing ----------
// Each account has an ECDH key pair: the public key is stored on the server
// as it is, the private key sealed with the account's record key. Something
// shared has a key of its own (a data key, used just like the account's);
// it reaches each person sealed for their public key with a one-off key pair.

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

export async function newKeyPair(keys) {
  const pair = await subtle.generateKey(ECDH, true, ['deriveBits']);
  return {
    public_key: b64(await subtle.exportKey('spki', pair.publicKey)),
    wrapped_private_key: await sealBytes(keys.records, new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey))),
  };
}

// The private key, not extractable, so it can live in IndexedDB.
export async function openPrivateKey(keys, wrapped) {
  return subtle.importKey('pkcs8', await openBytes(keys.records, wrapped), ECDH, false, ['deriveBits']);
}

async function sharedKey(privateKey, publicB64) {
  const pub = await subtle.importKey('spki', unb64(publicB64), ECDH, false, []);
  return hkdf(new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: pub }, privateKey, 256)), 'share', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']);
}

export async function sealShareKey(publicB64, shareKeyRaw) {
  const once = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const sealed = await sealBytes(await sharedKey(once.privateKey, publicB64), shareKeyRaw);
  return JSON.stringify({ e: b64(await subtle.exportKey('spki', once.publicKey)), c: sealed });
}

export async function openShareKey(privateKey, wrapped) {
  const { e, c } = JSON.parse(wrapped);
  return openBytes(await sharedKey(privateKey, e), c);
}

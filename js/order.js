// The order of things in a list, in a way that merges cleanly across devices.
//
// Each record can carry a `rank`: a short text key, and lists are sorted by
// it. Moving an item gives only that item a new key, one that sorts between
// its new neighbours' keys, so two devices moving different items never
// overwrite each other (each move is one field on one record), the same item
// moved on two devices ends up where the later move put it, and two items
// dropped into the same gap end up next to each other in the same order on
// every device (ties are broken by creation time, then id). There is always
// room between two keys, so nothing is ever renumbered.
//
// Keys are "fractional indexes" (the scheme collaborative editors use): a
// whole-number part whose first character says how long it is, then an
// optional fraction. Adding at the top or bottom just counts the whole number
// down or up, so keys stay short however often that happens.
//
// Records made before this (or never moved) have no rank: their old order
// number (`sort_order`, or whatever a list uses) is turned into a key on the
// fly, the same way on every device, so nothing needs converting.
//
//   keyBetween(a, b)                    a key after a and before b (either may be null)
//   rankOf(rec, legacy?)                the key a record sorts by
//   byRank(legacy?)                     a sort comparator
//   reorderWrites(rows, keyOf, moved?)  after a move: [[row, key]] for just the rows that need a new key
//   firstKey(recs, legacy?) / lastKey(…)  for adding at the top / bottom

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'; // ascending in text order
const SMALLEST_INTEGER = `A${'0'.repeat(26)}`;

// A fraction strictly between a and b ('' and null mean no limit). Never ends in '0'.
function midpoint(a, b) {
  if (b !== null) {
    let n = 0;
    while ((a[n] || '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}

// The whole-number part: 'a'…'z' = 2…27 characters long (positive), 'Z'…'A' = 2…27 (negative).
function integerLength(head) {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  throw new Error(`Bad order key head: ${head}`);
}
const integerPart = key => key.slice(0, integerLength(key[0]));

function check(key) {
  if (key === SMALLEST_INTEGER) throw new Error('Bad order key');
  const i = integerPart(key);
  if (i.length > key.length || key.slice(i.length).endsWith('0')) throw new Error(`Bad order key: ${key}`);
}

function incrementInteger(x) {
  const [head, ...digs] = x.split('');
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1;
    if (d === DIGITS.length) digs[i] = '0';
    else { digs[i] = DIGITS[d]; carry = false; }
  }
  if (!carry) return head + digs.join('');
  if (head === 'Z') return 'a0';
  if (head === 'z') return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > 'a') digs.push('0'); else digs.pop();
  return h + digs.join('');
}

function decrementInteger(x) {
  const [head, ...digs] = x.split('');
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1;
    if (d === -1) digs[i] = DIGITS.at(-1);
    else { digs[i] = DIGITS[d]; borrow = false; }
  }
  if (!borrow) return head + digs.join('');
  if (head === 'a') return `Z${DIGITS.at(-1)}`;
  if (head === 'A') return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < 'Z') digs.push(DIGITS.at(-1)); else digs.pop();
  return h + digs.join('');
}

export function keyBetween(a, b) {
  a = a || null;
  b = b || null;
  if (a !== null) check(a);
  if (b !== null) check(b);
  if (a !== null && b !== null && a >= b) throw new Error(`keyBetween: ${a} is not before ${b}`);
  if (a === null) {
    if (b === null) return 'a0';
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new Error('Order key out of room');
    return res;
  }
  if (b === null) {
    const ia = integerPart(a);
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(a.slice(ia.length), null) : i;
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i === null) throw new Error('Order key out of room');
  if (i < b) return i;
  return ia + midpoint(fa, null);
}

// An old order number as a key: a whole number of fixed length ('i' + 9
// digits), so text order = number order.
function legacyKey(x) {
  let v = Math.round(((Number(x) || 0) + 2e9) * 1e3);
  if (v < 0) v = 0;
  let s = '';
  for (let i = 0; i < 9; i++) { s = DIGITS[v % 62] + s; v = Math.floor(v / 62); }
  return `i${s}`;
}

const oldOrder = rec => rec.sort_order ?? 0;
export const rankOf = (rec, legacy = oldOrder) => rec.rank || legacyKey(legacy(rec));

export const byRank = (legacy = oldOrder) => (a, b) => {
  const ka = rankOf(a, legacy);
  const kb = rankOf(b, legacy);
  return ka < kb ? -1 : ka > kb ? 1 : (a.created_at || '').localeCompare(b.created_at || '') || String(a.id).localeCompare(String(b.id));
};

export const firstKey = (recs, legacy = oldOrder) => keyBetween(null, recs.length ? recs.map(r => rankOf(r, legacy)).sort()[0] : null);
export const lastKey = (recs, legacy = oldOrder) => keyBetween(recs.length ? recs.map(r => rankOf(r, legacy)).sort().at(-1) : null, null);

// The rows in their new order → new keys for as few rows as possible. The rows
// that were moved (their ids in `moved`) always get new keys, between their new
// neighbours; of the rest, the longest run already in order keeps its keys.
export function reorderWrites(rows, keyOf, moved = []) {
  const movedSet = new Set(moved);
  const keys = rows.map(keyOf);
  const tails = [];
  const prev = new Array(keys.length).fill(-1);
  for (let i = 0; i < keys.length; i++) {
    if (movedSet.has(rows[i].id)) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (keys[tails[mid]] < keys[i]) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = prev[i]) keep.add(i);
  const writes = [];
  let lower = null;
  for (let i = 0; i < rows.length; i++) {
    if (keep.has(i)) { lower = keys[i]; continue; }
    let j = i + 1;
    while (j < rows.length && !keep.has(j)) j++;
    const key = keyBetween(lower, j < rows.length ? keys[j] : null);
    writes.push([rows[i], key]);
    lower = key;
  }
  return writes;
}

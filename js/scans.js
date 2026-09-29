// Scans: receipts, IDs, warranties and letters, photographed or scanned in two
// taps. A scan is a record in `scans`; its pages are attachments (parent
// collection "scans"), so they are kept, synced and backed up like any other
// attached file, and open in the same viewer.
//   scans: title, kind (receipt|id|warranty|letter|other), expiry_date?, letter_date?,
//          summary?, note?, linked { collection, id, title }?, reminder_task_id?
//
//   KINDS                       the kinds, with labels
//   newScan(files, fields)      saved at once with a default title ("Receipt 26 Sep 14:32")
//   addPages(scan, files)       more pages (photos shrunk to 2000px, PDFs as they are)
//   pagesByScan()               Map(scan id → its pages, oldest first)
//   expirySoon(scan)            'past' | 'soon' (within 60 days) | ''
//   binProvider                 for Archive & Bin

import * as store from './store.js';
import { addFiles } from './attachments.js';
import { toast } from './toast.js';

export const KINDS = [
  { id: 'receipt', label: 'Receipt', plural: 'Receipts' },
  { id: 'warranty', label: 'Warranty', plural: 'Warranties' },
  { id: 'letter', label: 'Letter', plural: 'Letters' },
  { id: 'id', label: 'ID', plural: 'IDs' },
  { id: 'other', label: 'Other', plural: 'Other' },
];
export const kindLabel = id => KINDS.find(k => k.id === id)?.label || 'Scan';

const MAX_EDGE = 2000;
const MAX_BYTES = 10 * 1024 * 1024;

// A photo bigger than it needs to be is redrawn at 2000px on its long edge
// (JPEG, 80%): a few hundred KB a page instead of several MB. The browser
// turns it the right way up from the photo's own orientation.
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) { bmp.close?.(); return file; }
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

export async function addPages(scan, files) {
  const ready = [];
  for (const f of files) {
    const s = await shrink(f);
    if (s.size > MAX_BYTES) { toast(`Not added: ${f.name} is over 10 MB`); continue; }
    ready.push(s);
  }
  return ready.length ? addFiles({ collection: 'scans', id: scan.id }, ready) : [];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const stamp = d => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.toTimeString().slice(0, 5)}`;

export async function newScan(files, fields = {}) {
  const kind = fields.kind || 'receipt';
  const scan = await store.create('scans', { title: `${kindLabel(kind)} ${stamp(new Date())}`, kind, expiry_date: null, letter_date: null, summary: '', note: '', linked: null, ...fields });
  const pages = files.length ? await addPages(scan, files) : [];
  if (files.length && !pages.length) { await store.remove('scans', scan.id); return null; }
  return scan;
}

export async function pagesByScan() {
  const map = new Map();
  for (const a of (await store.list('attachments', { filter: x => x.parent_collection === 'scans' })).sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    if (!map.has(a.parent_id)) map.set(a.parent_id, []);
    map.get(a.parent_id).push(a);
  }
  return map;
}

export function expirySoon(s, today = new Date().toISOString().slice(0, 10)) {
  if (!s.expiry_date) return '';
  if (s.expiry_date < today) return 'past';
  return (Date.parse(s.expiry_date) - Date.parse(today)) / 864e5 <= 60 ? 'soon' : '';
}

// ---------- archive & bin ----------

export const binProvider = {
  area: 'scans',
  label: 'Scans',
  async entries(kind) {
    const inState = r => !r.purged_at && (kind === 'bin' ? !!r.deleted_at : !r.deleted_at && !!r.archived_at);
    const at = r => (kind === 'bin' ? r.deleted_at : r.archived_at);
    return (await store.list('scans', { includeDeleted: true })).filter(inState)
      .map(s => ({ collection: 'scans', id: s.id, kind: kindLabel(s.kind), title: s.title, subtitle: s.summary || '', detail: s.expiry_date ? `expires ${s.expiry_date}` : '', at: at(s), children: [], search: `${s.title} ${s.summary || ''} ${s.note || ''}` }))
      .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  },
};

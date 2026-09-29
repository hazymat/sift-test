// Files attached to a note: photos, PDFs and text files. The file itself is
// kept on this device (the `blobs` store); an `attachments` record (name, type,
// size and, for photos, a small thumbnail) says which note it belongs to.
//
//   byParent()                         → Map(note id → attachments)
//   rowHtml(atts, { addButton, parent }) → thumbnails / file chips, plus a 📎 Attach button
//   redrawRows(root, parentId)          → redraw just that note's files rows; false if none
//   writingIn(root)                     → is a note under root being written in?
//   addFiles({ collection, id }, files) → the new records (other kinds of file are skipped)
//   enableDrop(root, selector, parentOf, done) → drop files onto matching elements
//   onClick(ev, parentOf, done)        → handles the row's buttons; true if it did
//   open(id) / view(atts, i)           → the viewer: pictures, and a card with Open for other files
//   pick(parent, done)                 → the file chooser, then attach
//
// Rows are plain HTML, so a view just re-renders in `done(parent)`; while a
// note is being written in (on a phone, full screen), it redraws only the files
// rows instead, so the note isn't redrawn away from under the cursor.

import * as store from './store.js';
import { toast, undoable } from './toast.js';

const MAX_BYTES = 25 * 1024 * 1024;
// What files can be attached to (a pasted screenshot in any other note is refused).
export const ATTACHABLE = ['thoughts', 'tasks', 'day_items', 'list_items', 'items', 'comments', 'scans', 'contracts', 'recipes', 'recipe_makes', 'recipe_entries'];
const THUMB = 240;
export const ACCEPT = 'image/*,application/pdf,text/plain,text/markdown,text/csv,.txt,.md,.csv,.pdf';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;

export function kindOf(mime, name = '') {
  if (/^image\//.test(mime)) return 'image';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (/^text\//.test(mime) || /\.(txt|md|csv)$/i.test(name)) return 'text';
  return null;
}

export const sizeLabel = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// A short name for a chip: keeps the extension, cuts the middle.
export function shortName(name, max = 22) {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : '';
  return `${name.slice(0, max - ext.length - 1)}…${ext}`;
}

async function thumbnail(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, THUMB / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return c.toDataURL('image/jpeg', 0.7);
  } catch { return null; }   // a format this browser can't draw: it shows as a file chip
}

export async function addFiles(parent, files) {
  const made = [];
  const skipped = [];
  for (const file of files) {
    const kind = kindOf(file.type, file.name);
    if (!kind) { skipped.push(`${file.name} (only photos, PDFs and text files)`); continue; }
    if (file.size > MAX_BYTES) { skipped.push(`${file.name} (over ${sizeLabel(MAX_BYTES)})`); continue; }
    const id = store.uuidv7();
    await store.putBlob(id, file);
    made.push(await store.create('attachments', {
      id, parent_collection: parent.collection, parent_id: parent.id, blob_id: id,
      name: file.name || 'file', mime: file.type || (kind === 'pdf' ? 'application/pdf' : 'text/plain'), kind, size: file.size,
      thumb: kind === 'image' ? await thumbnail(file) : null,
    }));
  }
  if (skipped.length) toast(`Not added: ${skipped.join(', ')}`);
  return made;
}

export async function byParent() {
  const map = new Map();
  for (const a of (await store.list('attachments')).sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    if (!map.has(a.parent_id)) map.set(a.parent_id, []);
    // Is the file itself on this device yet? (Its details arrive first; the
    // file follows through sync, and shows "still arriving" until then.)
    map.get(a.parent_id).push({ ...a, here: await store.hasBlob(a.blob_id) });
  }
  return map;
}

export function rowHtml(atts = [], { addButton = true, parent = atts[0]?.parent_id || '' } = {}) {
  const items = atts.map(a => {
    const arriving = a.here === false;
    const label = `${a.name} (${sizeLabel(a.size)})${arriving ? ' · still arriving on this device through sync' : ''}`;
    const asPhoto = a.kind === 'image' && a.thumb;
    const body = asPhoto
      ? `<img src="${a.thumb}" alt="" loading="lazy">`
      : `${icon('i-note')}<span class="att-name">${a.kind === 'pdf' ? 'PDF · ' : ''}${esc(shortName(a.name))}</span>`;
    return `<span class="att att-${asPhoto ? 'img' : 'file'}${arriving ? ' att-arriving' : ''}">${arriving ? `<span class="att-wait">still arriving · ${sizeLabel(a.size)}</span>` : ''}
      <button type="button" class="att-open" data-att-open="${a.id}" title="${esc(label)}" aria-label="Open ${esc(a.name)}">${body}</button>
      <button type="button" class="att-x" data-att-remove="${a.id}" title="Remove" aria-label="Remove ${esc(a.name)}">×</button>
    </span>`;
  }).join('');
  const add = addButton ? `<button type="button" class="att-add" data-att-add title="Attach photos, PDFs or text files (or drop them here)">${icon('i-clip')}<span>Attach</span></button>` : '';
  return `<div class="att-row" data-att-parent="${esc(parent)}">${items}${add}</div>`;
}

export async function redrawRows(root, parentId) {
  const rows = parentId ? [...root.querySelectorAll(`.att-row[data-att-parent="${CSS.escape(parentId)}"]`)] : [];
  if (!rows.length) return false;
  const list = (await byParent()).get(parentId) || [];
  for (const r of rows) r.outerHTML = rowHtml(list, { addButton: !!r.querySelector('[data-att-add]'), parent: parentId });
  return true;
}

export const writingIn = root => !!document.activeElement?.closest?.('.rich') && root.contains(document.activeElement);

// Tight view: just a count, which opens the viewer.
export const countChip = atts => (atts?.length ? `<button type="button" class="chip att-count" data-att-view="${atts[0].parent_id}" title="${atts.length} attached: press to look" aria-label="Open ${atts.length} attached ${atts.length === 1 ? 'file' : 'files'}">${icon('i-clip')} ${atts.length}</button>` : '');

// The file itself: on this device, or fetched from the sync server.
async function blobOf(a) {
  let blob = await store.getBlob(a.blob_id);
  if (!blob) {
    // Added on another device: fetch it from the sync server.
    try {
      const sync = await import('./sync.js');
      if (sync.signedIn()) blob = await sync.downloadFile(a);
    } catch { /* offline: falls through to null */ }
  }
  return blob ? (blob.type ? blob : new Blob([blob], { type: a.mime })) : null;
}

// A note's files, in the order they were added.
const siblingsOf = async a => (await store.list('attachments', { filter: x => x.parent_id === a.parent_id }))
  .sort((x, y) => x.created_at.localeCompare(y.created_at));

// Opens the viewer on one file, with the rest of its note's files either side.
export async function open(id) {
  const a = await store.get('attachments', id);
  if (!a) return;
  const all = await siblingsOf(a);
  view(all, Math.max(0, all.findIndex(x => x.id === a.id)));
}

// Opens the viewer on a note's first file (the 📎 count in Compact spacing).
export async function openFirst(parentId) {
  const all = await siblingsOf({ parent_id: parentId });
  if (all.length) view(all, 0);
}

const svg = d => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const DOC_ICON = '<svg class="av-doc-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M12 4h17l9 9v31H12z"/><path d="M29 4v9h9"/><path d="M18 22h14M18 28h14M18 34h9"/></svg>';

// The viewer: a picture full size to fit the screen, or for other files a
// document card with Open. ← / → (the side arrows, or a swipe) move through the
// note's files, stopping at the first and last; Esc, ✕ or a click on the dark
// background closes it.
export function view(atts, start = 0) {
  if (!atts?.length) return;
  const dlg = document.createElement('dialog');
  dlg.className = 'att-view';
  dlg.setAttribute('aria-label', 'Attached files');
  dlg.innerHTML = `<div class="av-stage"></div>
    <p class="av-name" aria-live="polite"></p>
    <button type="button" class="av-btn av-close" aria-label="Close" title="Close (Esc)">${svg('<path d="M6 6l12 12M18 6L6 18"/>')}</button>
    <button type="button" class="av-btn av-arrow av-prev" aria-label="Previous file" title="Previous (←)">${svg('<path d="M14.5 6l-6 6 6 6"/>')}</button>
    <button type="button" class="av-btn av-arrow av-next" aria-label="Next file" title="Next (→)">${svg('<path d="M9.5 6l6 6-6 6"/>')}</button>`;
  const stage = dlg.querySelector('.av-stage');
  const urls = new Map();
  let at = -1;
  const urlOf = a => {
    if (!urls.has(a.id)) urls.set(a.id, blobOf(a).then(b => (b ? URL.createObjectURL(b) : null)));
    return urls.get(a.id);
  };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  async function show(i, dir = 0) {
    if (i < 0 || i >= atts.length || i === at) return;
    at = i;
    const a = atts[i];
    dlg.querySelector('.av-prev').hidden = i === 0;
    dlg.querySelector('.av-next').hidden = i === atts.length - 1;
    dlg.querySelector('.av-name').textContent = `${a.name}${atts.length > 1 ? ` · ${i + 1} of ${atts.length}` : ''}`;
    const slide = document.createElement('div');
    slide.className = 'av-slide';
    if (a.kind === 'image') {
      slide.innerHTML = a.thumb ? `<img alt="" src="${a.thumb}">` : '<img alt="">';
      slide.querySelector('img').alt = a.name;
    } else {
      slide.innerHTML = `<div class="av-doc">${DOC_ICON}<div class="av-doc-name"></div><div class="av-doc-size">${a.kind === 'pdf' ? 'PDF' : 'Text file'} · ${sizeLabel(a.size)}</div><button type="button" class="av-open">Open</button></div>`;
      slide.querySelector('.av-doc-name').textContent = a.name;
    }
    const old = [...stage.children];
    stage.append(slide);
    if (dir && !still) {
      slide.animate([{ transform: `translateX(${dir * 60}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
      for (const o of old) o.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-dir * 60}px)`, opacity: 0 }], { duration: 180, easing: 'ease-in', fill: 'forwards' }).onfinish = () => o.remove();
    } else old.forEach(o => o.remove());
    const url = await urlOf(a);
    if (at !== i) return;
    if (!url) {
      slide.insertAdjacentHTML('beforeend', `<p class="av-missing">This file isn't on this device yet: open Sift where it was added and let it sync.</p>`);
      slide.querySelector('.av-open')?.setAttribute('disabled', '');
      return;
    }
    if (a.kind === 'image') slide.querySelector('img').src = url;
  }

  const close = () => dlg.close();
  dlg.addEventListener('close', () => {
    dlg.remove();
    // Give a file opened in a new page time to load before letting it go.
    setTimeout(() => { for (const p of urls.values()) p.then(u => u && URL.revokeObjectURL(u)); }, 5 * 60 * 1000);
  });
  dlg.addEventListener('click', async ev => {
    if (ev.target.closest('.av-close')) return close();
    if (ev.target.closest('.av-prev')) return show(at - 1, -1);
    if (ev.target.closest('.av-next')) return show(at + 1, 1);
    if (ev.target.closest('.av-open')) {
      // PDFs and text open in a new page; anything the browser can't show, it
      // downloads (or, on an iPhone, offers to open in another app).
      const url = await urlOf(atts[at]);
      if (url) window.open(url, '_blank', 'noopener');
      return;
    }
    // The dark background (anything but the picture, the card or a button) closes.
    if (!ev.target.closest('.av-slide img, .av-doc, .av-btn')) close();
  });
  dlg.addEventListener('keydown', ev => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return; // Alt+← / → stay the browser's Back / Forward
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); show(at - 1, -1); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); show(at + 1, 1); }
  });
  // A sideways swipe on a phone moves too.
  let x0 = null;
  stage.addEventListener('pointerdown', ev => { x0 = ev.clientX; });
  stage.addEventListener('pointerup', ev => {
    if (x0 === null) return;
    const dx = ev.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  });
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('.av-close').focus();
  show(start);
}

function afterAdd(made, done, parent) {
  done?.(parent);
  undoable(`Attached ${made.length === 1 ? made[0].name : `${made.length} files`}`, async () => {
    for (const m of made) await store.remove('attachments', m.id);
    done?.(parent);
  });
}

let picker = null;
export function pick(parent, done) {
  picker?.remove();
  picker = document.createElement('input');
  Object.assign(picker, { type: 'file', multiple: true, accept: ACCEPT, hidden: true });
  picker.onchange = async () => {
    const made = await addFiles(parent, [...picker.files]);
    picker.remove();
    picker = null;
    if (made.length) afterAdd(made, done, parent);
  };
  document.body.append(picker);
  picker.click();
}

// `parentOf(button)` says which note the row belongs to (for Attach).
export function onClick(ev, parentOf, done) {
  const b = ev.target.closest('[data-att-open], [data-att-remove], [data-att-add], [data-att-view]');
  if (!b) return false;
  ev.preventDefault();
  ev.stopPropagation();
  if (b.dataset.attAdd !== undefined) { const p = parentOf(b); if (p) pick(p, done); return true; }
  if (b.dataset.attView) { openFirst(b.dataset.attView); return true; }
  const id = b.dataset.attOpen || b.dataset.attRemove;
  if (b.dataset.attOpen) { open(id); return true; }
  store.get('attachments', id).then(async a => {
    if (!a) return;
    const parent = { collection: a.parent_collection, id: a.parent_id };
    await store.remove('attachments', a.id);
    done?.(parent);
    undoable(`Removed ${a.name}`, async () => { await store.restore('attachments', a.id); done?.(parent); });
  });
  return true;
}

// Dropping files on an element matching `selector` inside `root` attaches
// them to the note `parentOf(element)` names.
export function enableDrop(root, selector, parentOf, done) {
  // A note inside says it has attached a pasted file (richtext.js): redraw.
  root.addEventListener('attached', ev => done?.(ev.detail));
  // Pressing a file (to open or remove it) while writing in the note doesn't
  // take the cursor out of the note, so the note stays open.
  root.addEventListener('mousedown', ev => { if (ev.target.closest('.att-open, .att-x, .att-count, [data-att-open]')) ev.preventDefault(); });
  const hasFiles = ev => [...(ev.dataTransfer?.types || [])].includes('Files');
  let over = null;
  const clear = () => { over?.classList.remove('drop-over'); over = null; };
  root.addEventListener('dragover', ev => {
    if (!hasFiles(ev)) return;
    const t = ev.target.closest(selector);
    if (!t) return clear();
    ev.preventDefault();
    if (over !== t) { clear(); over = t; t.classList.add('drop-over'); }
  });
  root.addEventListener('dragleave', ev => { if (over && !over.contains(ev.relatedTarget)) clear(); });
  root.addEventListener('drop', async ev => {
    const t = hasFiles(ev) && ev.target.closest(selector);
    clear();
    if (!t) return;
    ev.preventDefault();
    const p = parentOf(t);
    if (!p) return;
    const made = await addFiles(p, [...ev.dataTransfer.files]);
    if (made.length) afterAdd(made, done, p);
  });
}

// Files dragged over the page anywhere else: a hint at the bottom says where
// they can go, and a drop that lands elsewhere says so (rather than the browser
// opening the file in place of Sift). Drop areas (enableDrop) handle their own
// drops first and mark the event as taken. A page whose drops do something else
// (Scans, Contracts) says what in data-drop-hint on an element around the pointer.
export function installFileDrop() {
  const pageHint = ev => ev.target.closest?.('[data-drop-hint]')?.dataset.dropHint;
  const hasFiles = ev => [...(ev.dataTransfer?.types || [])].includes('Files');
  let hint = null;
  let timer;
  const show = on => {
    if (on && !hint) {
      hint = document.createElement('div');
      hint.className = 'file-drop-hint';
      document.body.append(hint);
    }
    if (on) hint.textContent = on;
    hint?.classList.toggle('show', !!on);
  };
  addEventListener('dragover', ev => {
    if (!hasFiles(ev)) return;
    clearTimeout(timer);
    show(pageHint(ev) || 'Drop onto a note or item to attach it');
    if (!ev.defaultPrevented) ev.preventDefault(); // so a drop here reaches us (and doesn't open the file)
    timer = setTimeout(() => show(false), 300); // dragover repeats while over the page
  });
  addEventListener('drop', ev => {
    if (!hasFiles(ev)) return;
    show(false);
    if (ev.defaultPrevented) return;
    ev.preventDefault();
    toast(pageHint(ev) ? `Not added: ${pageHint(ev)}` : 'Not attached: drop it onto a note or item (or its open panel)');
  });
}

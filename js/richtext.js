// Notes editor used for free text across the app. Stored as a small
// markdown subset (**bold**, _italic_, ~~cross out~~, "- " lists, "## heading"), shown
// formatted while you type. A "Markdown" toggle shows the raw text; it
// always starts in formatted mode.
//
//   const editor = richText(container, { value, onChange(markdown), placeholder, origin, spot })
//   editor.setValue(markdown)
//
// `origin()` says what the note belongs to ({ collection, id, title, field })
// so links and new contacts can point back to it. `spot: false` turns off
// spotting phone numbers and emails (e.g. in a contact's own notes).
//
// Links to other things are chips: [label](sift:<collection>/<id>). Typing or
// picking 📞, 📝 or ⚠️ opens a search to link a contact, anything, or anything
// important (or just keep the emoji). A phone number or email typed in becomes
// a linked contact (a new transient one unless it's already known), with Undo.
// While you're in a note, the rest of the page dims.
//
// Typing "- " or "* " at the start of a line starts a bulleted list, and "1. " a numbered one; Enter on
// an empty bullet ends it, so you carry on writing underneath. The toolbar also
// inserts a few emoji.
//
// Two toolbars: compact (bold, italic, cross out, list, emoji) and full, which
// adds Smaller / Bigger text for the line you're on. "Aa" switches, and the
// choice is remembered on this device. Five sizes, kept in the note at the start
// of a line: "-# " smaller, (nothing) normal, "+# " a bit bigger, "# " big and
// "#+ " biggest. They are relative to the app's own
// Text size setting, which they don't change.

export const EMOJI = [
  ['📝', 'Note'],
  ['📞', 'Phone'],
  ['⏰', 'Alarm'],
  ['⚠️', 'Warning'],
];

// A note as plain lines for one-line previews: no markdown marks, bullets as "•".
export function plainLines(md) {
  return (md || '').split('\n')
    .map(l => l.replace(LINK_RE, '$1').replace(/^(?:#{1,6}|-#|\+#|#\+)\s+/, '').replace(/^\s*[-*]\s+/, '• ').replace(/\*\*|~~/g, '').replace(/(^|\s)_(\S.*?)_(?=$|[\s).,!?:;])/g, '$1$2').trim())
    .filter(Boolean);
}

import { openPicker } from './linkpicker.js';
import { openRef, findDetails, detailKey, loadDetailIndex, createDetailContact, spotSettings, attachContact, detachContact, unlinkInRecord } from './refs.js';
import * as store from './store.js';
import { toast } from './toast.js';
import { openFull, closeFull, isFull, setFullLabel, PHONE } from './fullnote.js';
import { titleFrom } from './summary.js';
import { word } from './words.js';
import { noteUndo, showVersions } from './noteundo.js';
import { flushAll } from './autosave.js';
import { keys } from './keys.js';

const LINK_RE = /\[([^\]]+)\]\(sift:([a-z_]+)\/([\w-]+)\)/g;

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Showing a note anywhere goes through these, so every place draws bold,
// italic, cross out, links and lists the same way (never esc() on a note's
// text, which would show it without its formatting):
//   toHtml(md)            the whole note as written
//   inlineAll(md)         every line run together on one line ("a · b · c")
//   previewLine(md)       the first line, and how many more there are
//   titleHtml(md, title)  a note's title (its first line, maybe shortened) with the formatting it has there
// plainLines() and summary.js cleanLine() are for plain text only (sharing,
// searching, working out titles), never for showing.

// A note's first line as HTML for one-line previews (links stay clickable),
// and how many more lines there are.
export function previewLine(md) {
  const lines = (md || '').split('\n').map(l => l.replace(/^(?:#{1,6}|-#|\+#|#\+)\s+/, '').replace(/^\s*[-*]\s+/, '• ').trim()).filter(Boolean);
  return { html: lines.length ? inline(lines[0]) : '', more: Math.max(0, lines.length - 1) };
}

// All of a note's lines run together on one line ("a · b · c"), as HTML.
export function inlineAll(md) {
  return (md || '').split('\n').map(l => l.replace(/^(?:#{1,6}|-#|\+#|#\+)\s+/, '').replace(/^\s*[-*]\s+/, '• ').trim()).filter(Boolean).map(inline).join(' <span class="sep">·</span> ');
}

// The title as it appears at the start of the note's first line, with that
// line's formatting; `title` may be shortened ("…"), in which case the
// formatting is cut at the same place (anything left open is closed).
export function titleHtml(md, title) {
  const first = (md || '').split('\n').find(l => l.trim()) || '';
  const line = first.replace(/^(?:#{1,6}|-#|\+#|#\+)\s+/, '').replace(/^\s*[-*]\s+/, '').trim();
  const plain = s => s.replace(LINK_RE, '$1').replace(/\*\*|~~/g, '').replace(/(^|\s)_(\S.*?)_(?=$|[\s).,!?:;])/g, '$1$2');
  const want = (title || '').replace(/…$/, '').trim();
  if (!want || plain(line).trim().toLowerCase() === want.toLowerCase()) return inline(line);
  if (!plain(line).toLowerCase().startsWith(want.toLowerCase())) return esc(title || '');
  // The shortest start of the line that reads as the title; then close what's open.
  let k = want.length;
  while (k < line.length && plain(line.slice(0, k)).length < want.length) k++;
  let cut = line.slice(0, k);
  for (const mark of ['~~', '**']) if ((cut.split(mark).length - 1) % 2) cut += mark;
  // A shortened title starts with a capital (summary.js): so does this.
  if (/^[A-Z]/.test(want)) cut = cut.replace(/[a-z]/, c => c.toUpperCase());
  return inline(cut) + (title.endsWith('…') ? '…' : '');
}

// The rest of the first line after the title (as markdown, formatting kept:
// a mark left open at the cut is opened again), or '' if the title is all of it.
export function afterTitle(md, title) {
  const first = (md || '').split('\n').find(l => l.trim()) || '';
  const line = first.replace(/^(?:#{1,6}|-#|\+#|#\+)\s+/, '').replace(/^\s*[-*]\s+/, '').trim();
  const plain = s => s.replace(LINK_RE, '$1').replace(/\*\*|~~/g, '').replace(/(^|\s)_(\S.*?)_(?=$|[\s).,!?:;])/g, '$1$2');
  const want = (title || '').replace(/…$/, '').trim();
  if (!want || !plain(line).toLowerCase().startsWith(want.toLowerCase())) return null; // not how the line starts
  let k = want.length;
  while (k < line.length && plain(line.slice(0, k)).length < want.length) k++;
  const head = line.slice(0, k);
  const open = ['~~', '**'].filter(mark => (head.split(mark).length - 1) % 2).join('');
  const rest = line.slice(k).replace(/^[\s.,:;!?\u2013\u2014-]+/, '');
  return rest.replace(/^(\*\*|~~)+$/, '') ? open + rest : '';
}

// A link chip carries its own icon (CSS: ☑️ task, 📞 contact, 📝 note …), so a
// 📞 or 📝 typed just before a link (to open the search) isn't shown twice.
const TRIGGER_BEFORE_LINK = /(?:📞|📝)[\s\u00a0]*(?=\[[^\]]+\]\(sift:)/gu;

function inline(text) {
  return esc(text)
    .replace(TRIGGER_BEFORE_LINK, '')
    .replace(LINK_RE, (m, label, c, id) => `<span class="ref" data-ref="${c}/${id}" contenteditable="false">${label}</span>`)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/(^|[\s(])_(.+?)_(?=$|[\s).,!?:;])/g, '$1<i>$2</i>');
}

// Bullet and numbered lines as nested lists. `items` are { d: depth, ordered, html };
// a line can only sit one level deeper than the one before it, and a list is
// numbered or bulleted by the line that opens it.
function listHtml(items) {
  let html = '';
  const open = []; // the list tags open now, one per depth
  for (const { d: want, ordered, html: text } of items) {
    const tag = ordered ? 'ol' : 'ul';
    const d = Math.max(0, Math.min(want, open.length));
    if (!open.length || d >= open.length) { html += `<${tag}>`; open.push(tag); }
    else {
      html += '</li>';
      while (open.length - 1 > d) html += `</${open.pop()}></li>`;
      // Bulleted after numbered (or the other way round) at the same level: a new list.
      if (open[d] !== tag) { html += `</${open.pop()}><${tag}>`; open.push(tag); }
    }
    html += `<li>${text}`;
  }
  html += '</li>';
  while (open.length > 1) html += `</${open.pop()}></li>`;
  return `${html}</${open.pop()}>`;
}

export function toHtml(md) {
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(listHtml(list)); list = null; } };
  for (const line of (md || '').split('\n')) {
    const big = line.match(/^#\s+(.*)$/);
    const sized = line.match(/^(-#|\+#|#\+)\s+(.*)$/);
    const label = line.match(/^#{2,6}\s+(.*)$/);
    if (big || sized || label) {
      flush();
      const text = inline(sized ? sized[2] : (big || label)[1]) || '<br>';
      out.push(big ? `<h3>${text}</h3>` : sized ? `<div data-sz="${{ '-#': 's', '+#': 'm', '#+': 'xl' }[sized[1]]}">${text}</div>` : `<h4>${text}</h4>`);
      continue;
    }
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    const numbered = !bullet && line.match(/^(\s*)\d{1,3}[.)]\s+(.*)$/);
    const item = bullet || numbered;
    if (item) {
      list ??= [];
      list.push({ d: Math.floor(item[1].replace(/\t/g, '  ').length / 2), ordered: !!numbered, html: inline(item[2]) || '<br>' });
      continue;
    }
    flush();
    out.push(`<div>${inline(line) || '<br>'}</div>`);
  }
  flush();
  return out.join('');
}

export function toMarkdown(root) {
  // A list's lines, two spaces of indent per level. (The browser nests a list either
  // inside an <li> or straight inside the <ul>; both come out the same.)
  const listLines = (ul, depth) => {
    let n = 0;
    return [...ul.children].flatMap(child => {
      if (child.tagName === 'UL' || child.tagName === 'OL') return listLines(child, depth + 1);
      if (child.tagName !== 'LI') return [];
      n++;
      const own = [...child.childNodes].filter(x => x.nodeName !== 'UL' && x.nodeName !== 'OL').map(walk).join('').replace(/\n+$/, '');
      const nested = [...child.children].filter(x => x.tagName === 'UL' || x.tagName === 'OL').flatMap(x => listLines(x, depth + 1));
      return [`${'  '.repeat(depth)}${ul.tagName === 'OL' ? `${n}.` : '-'} ${own}`, ...nested];
    });
  };
  const walk = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/ /g, ' ');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const inner = () => [...node.childNodes].map(walk).join('');
    if (node.dataset?.ref) return `[${node.textContent.replace(/[[\]\n]/g, ' ').trim()}](sift:${node.dataset.ref})`;
    const tag = node.tagName;
    const style = node.style || {};
    if (tag === 'BR') return '\n';
    if (tag === 'B' || tag === 'STRONG' || style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) return wrap(inner(), '**');
    if (tag === 'I' || tag === 'EM' || style.fontStyle === 'italic') return wrap(inner(), '_');
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || /line-through/.test(style.textDecoration || '')) return wrap(inner(), '~~');
    if (tag === 'H3') return `# ${inner().replace(/\n+$/, '')}\n`;
    if (/^H[1-6]$/.test(tag)) return `## ${inner().replace(/\n+$/, '')}\n`;
    const mark = { s: '-#', m: '+#', xl: '#+' }[node.dataset?.sz];
    if (mark) return `${mark} ${inner().replace(/\n+$/, '')}\n`;
    if (tag === 'UL' || tag === 'OL') return `${listLines(node, 0).join('\n')}\n`;
    if (tag === 'DIV' || tag === 'P') {
      const text = inner();
      return text.endsWith('\n') ? text : `${text}\n`;
    }
    return inner();
  };
  return [...root.childNodes].map(walk).join('').replace(/\n+$/, '');
}

// Keep markers outside surrounding spaces: "** word**" → " **word**".
function wrap(text, mark) {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text;
}

// A toolbar too wide for its space scrolls sideways; with a mouse it can be
// grabbed and dragged too (a drag doesn't press the button it started on).
let barDrag = null;
document.addEventListener('pointerdown', ev => {
  const bar = ev.target.closest?.('.md-bar');
  if (!bar || ev.pointerType !== 'mouse' || bar.scrollWidth <= bar.clientWidth) return;
  barDrag = { bar, x: ev.clientX, left: bar.scrollLeft, moved: false };
});
document.addEventListener('pointermove', ev => {
  if (!barDrag) return;
  const dx = ev.clientX - barDrag.x;
  if (!barDrag.moved && Math.abs(dx) < 5) return;
  barDrag.moved = true;
  barDrag.bar.classList.add('drag-scrolling');
  barDrag.bar.scrollLeft = barDrag.left - dx;
});
document.addEventListener('pointerup', () => {
  if (!barDrag) return;
  const { bar, moved } = barDrag;
  barDrag = null;
  bar.classList.remove('drag-scrolling');
  if (moved) {
    const stop = e => { e.stopPropagation(); e.preventDefault(); };
    bar.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => bar.removeEventListener('click', stop, { capture: true }), 50);
  }
});

// While a note is being typed in, the rest of the page dims: a layer over
// everything with a hole where the note (and any dropdown) is. Clicks go
// straight through it. It is placed in page coordinates, not fixed to the
// screen: when the iPhone keyboard opens, iOS scrolls the visible part of the
// page and a fixed layer ended up out of line with the note it should frame.
let beam = null;
let beamHost = null;
let beamFrame = 0;
function spotlight(host) {
  beamHost = host;
  if (!beam) {
    beam = document.createElement('div');
    beam.className = 'note-spotlight';
    beam.setAttribute('aria-hidden', 'true');
    document.body.append(beam);
  }
  cancelAnimationFrame(beamFrame);
  const follow = () => {
    if (!beamHost?.isConnected) return unspotlight(beamHost);
    const rects = [beamHost, ...beamHost.querySelectorAll('.ref-picker, .ref-menu')].map(e => e.getBoundingClientRect());
    const left = Math.min(...rects.map(r => r.left)) - 6;
    const top = Math.min(...rects.map(r => r.top)) - 6;
    const right = Math.max(...rects.map(r => r.right)) + 6;
    const bottom = Math.max(...rects.map(r => r.bottom)) + 6;
    Object.assign(beam.style, { left: `${left + scrollX}px`, top: `${top + scrollY}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    beamFrame = requestAnimationFrame(follow);
  };
  follow();
}
function unspotlight(host) {
  if (host && host !== beamHost) return;
  cancelAnimationFrame(beamFrame);
  beam?.remove();
  beam = null;
  beamHost = null;
}

// colour: { get() → colour id, set(id) } adds a colour button (the note's own
// colour, colours.js) at the start of the formatting buttons.
const SZ = { '-1': 's', 1: 'm', 3: 'xl' };
const SIZE_OF = b => (b.tagName === 'H3' ? 2 : { s: -1, m: 1, xl: 3 }[b.dataset?.sz] ?? 0);

// bare: no toolbar, no dimming and no full screen on a phone tap; the keys
// (Ctrl+B, Ctrl+I, "- " bullets, Alt+Enter full screen) still work.
export function richText(container, { value = '', onChange, placeholder = '', origin = null, spot = true, colour = null, bare = false } = {}) {
  container.classList.add('rich');
  container.classList.toggle('bare', bare);
  container.innerHTML = `
    <div class="md-bar" role="toolbar" aria-label="Formatting">
      <button type="button" class="md-full" title="Full screen: just this note" aria-label="Edit full screen">⤢</button>
      ${colour ? '<button type="button" class="md-colour" title="Note colour" aria-label="Note colour" aria-haspopup="menu"><span class="swatch"></span></button>' : ''}
      <button type="button" class="md-mode" aria-pressed="false" title="Full toolbar: text size">Aa</button>
      <button type="button" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
      <button type="button" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
      <button type="button" data-cmd="strikeThrough" title="Cross out"><s>S</s></button>
      <button type="button" data-cmd="insertUnorderedList" title="List (or type - at the start of a line)">• List</button>
      <button type="button" data-cmd="insertOrderedList" title="Numbered list (or type 1. at the start of a line)">1. List</button>
      <span class="md-sizes"><button type="button" data-size="-1" title="Smaller text (this line)" aria-label="Smaller text">A<small>−</small></button><button type="button" data-size="1" title="Bigger text (this line)" aria-label="Bigger text">A<sup>+</sup></button></span>
      <span class="md-sep" aria-hidden="true"></span>
      <button type="button" class="md-make" title="Make this line (or the selected lines) into tasks or a contact; the text stays here, linked" aria-haspopup="menu">↗ Make</button>
      <span class="md-sep" aria-hidden="true"></span>
      <span class="md-emoji">${EMOJI.map(([e, name]) => `<button type="button" data-emoji="${e}" title="${name}" aria-label="Insert ${name.toLowerCase()} emoji">${e}</button>`).join('')}</span>
      <span class="md-sep" aria-hidden="true"></span>
      <button type="button" class="md-versions" title="Earlier versions of this note" aria-label="Earlier versions">🕘</button>
      <button type="button" class="md-toggle" aria-pressed="false" title="Show the raw markdown">Markdown</button>
    </div>
    <div class="rich-edit hand" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="${esc(placeholder)}"></div>
    <textarea class="rich-raw hand" hidden spellcheck="true"></textarea>${bare ? `<button type="button" class="bare-full" tabindex="-1" title="Open this note full screen, with its toolbar (Alt+Enter)">⤢ Fullscreen note editor ${keys('Alt+Enter')}</button>` : ''}`;

  // Compact or full toolbar, remembered on this device.
  const FULL_KEY = 'sift:notes-toolbar';
  const setFull = (full, keep = true) => {
    container.classList.toggle('bar-full', full);
    container.querySelector('.md-mode').setAttribute('aria-pressed', full);
    if (keep) try { siftTestStorage.setItem(FULL_KEY, full ? 'full' : 'compact'); } catch { /* not kept */ }
  };
  try { setFull(siftTestStorage.getItem(FULL_KEY) === 'full', false); } catch { setFull(false, false); }

  const edit = container.querySelector('.rich-edit');
  const raw = container.querySelector('.rich-raw');
  const toggle = container.querySelector('.md-toggle');
  let md = value || '';
  let rawMode = false;

  const paint = () => {
    edit.innerHTML = toHtml(md);
    edit.classList.toggle('is-empty', !md.trim());
  };
  const changed = next => {
    if (next === md) return;
    md = next;
    edit.classList.toggle('is-empty', !md.trim());
    onChange?.(md);
  };

  edit.addEventListener('input', ev => {
    // Just after this input event: the browser ignores edits made during one.
    // (Any typed input, not just a space: phone keyboards don't always send the space on its own.)
    if (/^insert(Text|CompositionText|ReplacementText)$/.test(ev.inputType)) queueMicrotask(() => { if (autoList()) changed(toMarkdown(edit)); });
    const trigger = ev.inputType === 'insertText' && triggerFor(ev.data);
    if (trigger) queueMicrotask(() => pick(trigger));
    else if (ev.inputType === 'insertParagraph' || ev.inputType === 'insertText' && /^[\s\u00a0,;:!?)]$/.test(ev.data || '')) queueMicrotask(() => spotNow(false));
    changed(toMarkdown(edit));
  });

  // ---------- links: 📞 📝 ⚠️ open a search ----------
  const triggerFor = e => (!e ? null : e.startsWith('📞') ? 'contact' : e.startsWith('📝') ? 'note' : e.startsWith('⚠') ? 'important' : null);
  const from = () => (typeof origin === 'function' ? origin() : origin);
  // Undo is Sift's own (noteundo.js): this visit's steps, then earlier versions.
  const undoer = noteUndo(edit, {
    get: () => md,
    set: next => { md = next; paint(); onChange?.(md); },
    ref: () => { const o = from(); return o?.id ? { collection: o.collection, id: o.id, field: o.field || '' } : null; },
  });

  function caretRect(range) {
    const r = range.getClientRects()[0] || range.startContainer.parentElement?.getBoundingClientRect?.();
    return r || edit.getBoundingClientRect();
  }
  function restoreRange(range) {
    edit.focus();
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  // Put in by hand: the browser's own HTML insert moves chips off the line.
  function insertChips(list) {
    const sel = getSelection();
    const range = sel.getRangeAt(0);
    range.deleteContents();
    // The 📞 / 📝 that opened the search goes: the chip shows its own icon.
    const at = range.startContainer;
    if (at.nodeType === Node.TEXT_NODE) {
      const m = at.nodeValue.slice(0, range.startOffset).match(/(?:📞|📝)[\s\u00a0]*$/u);
      if (m) at.deleteData(range.startOffset - m[0].length, m[0].length);
    }
    const frag = document.createDocumentFragment();
    frag.append(' ');
    list.forEach((t, n) => {
      if (n) frag.append(', ');
      const chip = document.createElement('span');
      chip.className = 'ref';
      chip.contentEditable = 'false';
      chip.dataset.ref = `${t.collection}/${t.id}`;
      chip.textContent = t.title;
      frag.append(chip);
    });
    const tail = document.createTextNode(' ');
    frag.append(tail);
    range.insertNode(frag);
    sel.collapse(tail, 1);
    changed(toMarkdown(edit));
    for (const t of list) if (t.collection === 'contacts') attachContact(from(), t.id);
  }
  function pick(kind) {
    const sel = getSelection();
    if (rawMode || !sel.rangeCount || !edit.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0).cloneRange();
    openPicker({
      host: container, at: caretRect(range), kind,
      exclude: from()?.id ? `${from().collection}/${from().id}` : null,
      onPick: list => { restoreRange(range); insertChips(list); },
      onNewContact: async name => {
        const o = from();
        const { createContact, CAPTURED_HEADING } = await import('./contacts.js');
        const made = await createContact({ name, notes: o?.id ? `${CAPTURED_HEADING}\nFrom [${(o.title || 'a note').replace(/[[\]]/g, ' ')}](sift:${o.collection}/${o.id})` : '', source_ref: o?.id ? { collection: o.collection, id: o.id } : null });
        restoreRange(range);
        insertChips([{ collection: 'contacts', id: made.id, title: name }]);
        toast(`New contact: ${name}`, { action: 'Undo', onAction: () => store.remove('contacts', made.id) });
      },
      onClose: ({ restore }) => { if (restore) restoreRange(range); },
    });
  }

  // Chips while editing: click for Open / Unlink; Ctrl+click opens.
  edit.addEventListener('click', ev => {
    const chip = ev.target.closest('.ref[data-ref]');
    if (!chip) return;
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) return openChip(chip);
    container.querySelector('.ref-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'ref-menu';
    menu.innerHTML = '<button type="button" data-m="open">Open</button><button type="button" data-m="unlink">Unlink</button>';
    const hr = container.getBoundingClientRect();
    const cr = chip.getBoundingClientRect();
    menu.style.left = `${Math.max(0, cr.left - hr.left)}px`;
    menu.style.top = `${cr.bottom - hr.top + 4}px`;
    container.append(menu);
    const gone = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', gone, true); } };
    document.addEventListener('pointerdown', gone, true);
    menu.addEventListener('mousedown', e => e.preventDefault());
    menu.addEventListener('click', e => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (!m) return;
      menu.remove();
      document.removeEventListener('pointerdown', gone, true);
      if (m === 'open') openChip(chip);
      else { chip.replaceWith(document.createTextNode(chip.textContent)); changed(toMarkdown(edit)); }
    });
  });
  function openChip(chip) {
    const ref = chip.dataset.ref;
    document.activeElement?.blur(); // leaving the note saves it
    setTimeout(() => openRef(ref), 30);
  }

  // ---------- spotting numbers and emails ----------
  let spotCfg = null;
  let index = new Map();
  const ignored = new Set(); // ones you said no to (Undo)
  if (spot) spotSettings().then(async s => { spotCfg = s; if (s.spot_details) index = await loadDetailIndex(s.phone_country); });

  function spotNow(final) {
    if (!spot || !spotCfg?.spot_details || rawMode) return;
    const cc = spotCfg.phone_country;
    const sel = getSelection();
    const walker = document.createTreeWalker(edit, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement.closest('.ref') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let made = false;
    for (const node of nodes) {
      const here = sel.anchorNode === node;
      const found = findDetails(node.nodeValue, { caret: here ? sel.anchorOffset : -1, final: final || !here, cc }).filter(m => !ignored.has(m.raw));
      for (const m of found.reverse()) {
        const line = (node.parentElement.closest('li, p, div:not(.rich-edit)') || edit).textContent;
        const after = here && sel.anchorOffset >= m.end ? sel.anchorOffset - m.end : null;
        const key = detailKey(m.type, m.raw, cc);
        const known = index.get(key);
        const id = known?.id || store.uuidv7();
        const r = document.createRange();
        r.setStart(node, m.start);
        r.setEnd(node, m.end);
        r.deleteContents();
        const chip = document.createElement('span');
        chip.className = 'ref ref-new';
        chip.contentEditable = 'false';
        chip.dataset.ref = `contacts/${id}`;
        chip.textContent = m.raw;
        r.insertNode(chip);
        if (after != null && chip.nextSibling?.nodeType === Node.TEXT_NODE) sel.collapse(chip.nextSibling, Math.min(after, chip.nextSibling.length));
        made = true;
        linked({ ...m, id, known, key, chip, line });
      }
    }
    if (made) changed(toMarkdown(edit));
  }

  async function linked({ type, raw, id, known, key, chip, line }) {
    const o = from();
    if (!known) {
      index.set(key, { id, name: '' });
      await createDetailContact({ id, type, raw }, { origin: o, line });
    }
    const wasAttached = o?.id && (await store.get(o.collection, o.id))?.contact_ids?.includes(id);
    await attachContact(o, id);
    const icon = type === 'phone' ? '📞' : '✉️';
    toast(known ? `${icon} ${raw}: linked to ${known.name || 'a contact'}` : `${icon} ${raw}: new contact`, {
      action: 'Undo',
      onAction: async () => {
        ignored.add(raw);
        if (chip.isConnected) { chip.replaceWith(document.createTextNode(raw)); changed(toMarkdown(edit)); }
        else await unlinkInRecord(o, `contacts/${id}`, o?.field);
        if (!wasAttached) await detachContact(o, id);
        if (!known) { index.delete(key); await store.remove('contacts', id); }
      },
    });
  }

  // Leaving the note: anything finished gets spotted; the page un-dims.
  // On a phone the note opens full screen as soon as you tap into it
  // (fullnote.js); a full-screen note needs no dimming.
  container.addEventListener('focusin', () => {
    if (bare) return;
    if (PHONE.matches && !isFull(container)) openFull(container, { label: fullLabel() });
    if (!isFull(container)) spotlight(container);
  });
  container.addEventListener('focusout', ev => {
    if (container.contains(ev.relatedTarget)) return;
    flushAll(); // leaving a note saves it at once, not after the typing pause
    undoer.left();
    closeMakeMenu();
    spotNow(true);
    unspotlight(container);
  });
  // The name at the top of a full-screen note: a note's own title (worked out
  // from what is typed, so it changes as you write), or what the note belongs to.
  const fullLabel = () => {
    const o = from();
    if (o?.field === 'body') return titleFrom(md) || 'New note';
    return o?.title && o.title !== 'Brain dump' ? o.title : 'Note';
  };
  edit.addEventListener('input', () => { if (isFull(container)) setFullLabel(container, fullLabel()); });
  raw.addEventListener('input', () => { if (isFull(container)) setFullLabel(container, fullLabel()); });
  container.addEventListener('click', ev => {
    if (ev.target.closest('.note-full-done')) closeFull();
  });
  edit.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && isFull(container) && !document.querySelector('.ref-picker')) { ev.preventDefault(); ev.stopPropagation(); closeFull({ blur: false }); edit.focus(); }
    // Ctrl+Enter (⌘+Enter on a Mac or iPad keyboard) is the same as Done.
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && isFull(container) && !document.querySelector('.ref-picker')) { ev.preventDefault(); ev.stopPropagation(); closeFull(); }
  }, true);
  // Ctrl+Enter anywhere else in a note: finish writing (leaving the note saves
  // it, as clicking away does). A note that saves with Ctrl+Enter and carries
  // on (the Brain Dump's New note) says so with data-ctrl-enter="keep".
  const finishOnCtrlEnter = ev => {
    if (ev.key !== 'Enter' || !(ev.ctrlKey || ev.metaKey) || isFull(container) || document.querySelector('.ref-picker')) return;
    ev.preventDefault();
    if (container.dataset.ctrlEnter === 'keep') return;
    setTimeout(() => { if (container.contains(document.activeElement)) document.activeElement.blur(); }, 0);
  };
  edit.addEventListener('keydown', finishOnCtrlEnter);
  raw.addEventListener('keydown', finishOnCtrlEnter);
  // Alt+Enter goes in one level: writing in a note → the note full screen
  // (Esc comes back out). Already full screen: nothing more to go into.
  function goFull() {
    unspotlight(container);
    openFull(container, { label: fullLabel() });
    if (!container.contains(document.activeElement)) placeCaretAtEnd();
  }
  const altEnter = ev => {
    if (ev.key !== 'Enter' || !ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (!isFull(container)) goFull();
  };
  edit.addEventListener('keydown', altEnter);
  // bare: "Note editor" under the note opens it full screen. Pressing it keeps
  // the cursor in the note, so the note isn't left (and saved away) first.
  const bareFull = container.querySelector(':scope > .bare-full');
  bareFull?.addEventListener('pointerdown', ev => ev.preventDefault());
  bareFull?.addEventListener('click', () => { if (!isFull(container)) goFull(); });
  raw.addEventListener('keydown', altEnter);
  // Esc steps out one level at a time: a menu of the note's own first, then
  // the note itself (leaving it saves it, as clicking away does). Whatever
  // holds the note (a panel, say) waits for the next Esc. Full screen has its
  // own first step, above.
  const stepOut = ev => {
    if (ev.key !== 'Escape' || ev.defaultPrevented || isFull(container) || document.querySelector('.ref-picker, .pill-menu, .dd-menu, .thought-pop')) return;
    ev.preventDefault();
    ev.stopPropagation();
    const menu = container.querySelector('.md-make-menu, .ref-menu');
    if (menu) { closeMakeMenu(); menu.remove(); return; }
    document.activeElement?.blur();
  };
  edit.addEventListener('keydown', stepOut);
  raw.addEventListener('keydown', stepOut);

  // What has been typed on the caret's line so far (a line starts at the block's
  // start or after a line break).
  function lineBefore(node, offset) {
    let text = node.nodeValue.slice(0, offset);
    let n = node;
    while (n && n !== edit) {
      for (let prev = n.previousSibling; prev; prev = prev.previousSibling) {
        if (/^(BR|DIV|P|UL|OL|H[1-6])$/.test(prev.nodeName)) return text;
        text = prev.textContent + text;
      }
      n = n.parentNode;
      if (n === edit || /^(DIV|P)$/.test(n.nodeName)) break;
    }
    return text;
  }

  // In a list *inside this note*. (The note itself may sit in a list item on
  // the page, e.g. a Brain Dump card or a task's panel: that doesn't count.)
  const inList = node => { const li = node?.parentElement?.closest('li') || (node?.nodeType === 1 ? node.closest('li') : null); return !!li && edit.contains(li); };

  // "- " or "* " at the start of a line (not already in a list) → bullet, and
  // "1. " a numbered one. Usually that's just after the space, but the marker
  // may have arrived with more text in one go (fast typing, a phone keyboard's
  // suggestion, autocorrect), so any line that starts with one is converted,
  // keeping the cursor where it was in the text.
  function autoList() {
    const sel = getSelection();
    const node = sel.anchorNode;
    if (!sel.rangeCount || !sel.isCollapsed || node?.nodeType !== Node.TEXT_NODE || !edit.contains(node) || inList(node)) return;
    const typed = lineBefore(node, sel.anchorOffset);
    const m = /^(?:([-*])|\d{1,3}[.)])[ \u00a0]/.exec(typed);
    if (!m) return;
    const list = m[1] ? 'insertUnorderedList' : 'insertOrderedList';
    if (typed.length === m[0].length) {
      for (let k = 0; k < typed.length; k++) document.execCommand('delete');
      document.execCommand(list);
      return true;
    }
    // More was typed after the marker: only when the marker starts this bit of
    // text (otherwise it's left for leaving the box, below).
    if (!node.nodeValue.startsWith(m[0]) || typed.length > sel.anchorOffset) return;
    const keep = sel.anchorOffset - m[0].length;
    const r = document.createRange();
    r.setStart(node, 0);
    r.setEnd(node, m[0].length);
    sel.removeAllRanges();
    sel.addRange(r);
    document.execCommand('delete');
    document.execCommand(list);
    // The cursor is now at the start of the new bullet: back to where it was.
    const now = getSelection();
    if (node.isConnected && now.anchorNode === node) now.collapse(node, Math.min(keep, node.nodeValue.length));
    else for (let k = 0; k < keep; k++) now.modify('move', 'forward', 'character');
    return true;
  }

  // Leaving the box: a "- " line that never became a bullet (however it was
  // typed, and however deep the browser tucked the line inside others) does
  // now; so does any styling the browser slipped in (see unstyle).
  const markerLine = /^([-*]|\d{1,3}[.)])[ \u00a0]/;
  const lineBlocks = root => [...root.children].flatMap(c => (/^(UL|OL)$/.test(c.tagName) ? []
    : c.tagName === 'DIV' && [...c.children].some(k => /^(DIV|P|UL|OL)$/.test(k.tagName)) ? lineBlocks(c) : [c]));
  edit.addEventListener('blur', () => {
    if (lineBlocks(edit).some(c => markerLine.test(c.textContent)) || edit.querySelector('span[style], font')) { md = toMarkdown(edit); paint(); }
  });

  // The browser sometimes wraps text in its own styling when lines are joined
  // or moved (e.g. Backspace from a list or a big line into a plain one), which
  // shows as two text sizes in one note. Sizes are per line, so that styling is
  // never wanted: it's taken out as you type, keeping the cursor in place.
  function unstyle() {
    const odd = edit.querySelectorAll('span[style], font');
    if (!odd.length) return;
    const sel = getSelection();
    const at = sel.rangeCount && edit.contains(sel.anchorNode) ? [sel.anchorNode, sel.anchorOffset] : null;
    for (const s of odd) s.replaceWith(...s.childNodes);
    if (at && at[0].isConnected) sel.collapse(at[0], at[1]);
  }
  edit.addEventListener('input', () => queueMicrotask(unstyle));
  raw.addEventListener('input', () => changed(raw.value));

  // Paste as plain text so web pages don't bring their styling along. A pasted
  // picture (a screenshot) or file is attached to the note instead, like one
  // dropped on it (attachments.js); the page redraws its files on "attached".
  edit.addEventListener('paste', async ev => {
    ev.preventDefault();
    const files = [...(ev.clipboardData?.files || [])];
    if (files.length) {
      const o = from();
      const { addFiles, ATTACHABLE } = await import('./attachments.js');
      if (!o?.id || !ATTACHABLE.includes(o.collection)) { toast("Files can't be attached here"); return; }
      const made = await addFiles({ collection: o.collection, id: o.id }, files);
      if (!made.length) return;
      const detail = { collection: o.collection, id: o.id };
      container.dispatchEvent(new CustomEvent('attached', { bubbles: true, detail }));
      const { undoable } = await import('./toast.js');
      undoable(`Attached ${made.length === 1 ? made[0].name : `${made.length} files`} to the note`, async () => {
        for (const m of made) await store.remove('attachments', m.id);
        container.dispatchEvent(new CustomEvent('attached', { bubbles: true, detail }));
      });
      return;
    }
    undoer.mark(); // pasting is a step of its own
    document.execCommand('insertText', false, ev.clipboardData.getData('text/plain'));
  });

  // Bigger / Smaller for the lines the selection touches: -1 small, 0 normal,
  // 1 a bit bigger, 2 big, 3 biggest.
  function setSize(dir) {
    const sel = getSelection();
    if (!sel.rangeCount || !edit.contains(sel.anchorNode)) placeCaretAtEnd();
    const range = getSelection().getRangeAt(0);
    const blocks = [...edit.children].filter(b => range.intersectsNode(b) && b.tagName !== 'UL');
    if (!blocks.length) return;
    const levelOf = SIZE_OF;
    let touched = false;
    for (const b of blocks) {
      if (b.tagName === 'H4') continue; // a label line keeps its own look
      const level = levelOf(b);
      const next = Math.max(-1, Math.min(3, level + dir));
      if (next === level) continue;
      const nb = document.createElement(next === 2 ? 'h3' : 'div');
      if (SZ[next]) nb.dataset.sz = SZ[next];
      nb.append(...b.childNodes);
      if (!nb.childNodes.length) nb.innerHTML = '<br>';
      for (const edge of ['start', 'end']) if (range[`${edge}Container`] === b) range[edge === 'start' ? 'setStart' : 'setEnd'](nb, range[`${edge}Offset`]);
      b.replaceWith(nb);
      touched = true;
    }
    if (!touched) return;
    const after = getSelection();
    after.removeAllRanges();
    after.addRange(range);
    changed(toMarkdown(edit));
    showState();
  }

  // The toolbar shows what's on where the cursor is: Bold / Italic / Cross out
  // and the lists look pressed; Smaller / Bigger grey out at the ends.
  const bar = container.querySelector('.md-bar');
  function showState() {
    const sel = getSelection();
    const inside = !rawMode && sel.rangeCount && edit.contains(sel.anchorNode);
    const at = inside ? (sel.anchorNode.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode) : null;
    const inList = tag => { const l = at?.closest?.(tag); return !!l && edit.contains(l); };
    for (const b of bar.querySelectorAll('[data-cmd]')) {
      let on = false;
      if (inside) {
        if (b.dataset.cmd === 'insertUnorderedList') on = inList('ul');
        else if (b.dataset.cmd === 'insertOrderedList') on = inList('ol');
        else try { on = document.queryCommandState(b.dataset.cmd); } catch { on = false; }
      }
      b.setAttribute('aria-pressed', on);
    }
    const block = inside ? [...edit.children].find(c => c === at || c.contains(at)) : null;
    const level = block && !/^(UL|OL|H4)$/.test(block.tagName) ? SIZE_OF(block) : null;
    bar.querySelector('[data-size="-1"]').disabled = level === -1;
    bar.querySelector('[data-size="1"]').disabled = level === 3;
  }
  // One listener while the editor is on the page; it goes when the editor does
  // and comes back if the editor is used again.
  const onSelection = () => { if (container.isConnected) showState(); else document.removeEventListener('selectionchange', onSelection); };
  document.addEventListener('selectionchange', onSelection);
  edit.addEventListener('focus', () => document.addEventListener('selectionchange', onSelection));

  // Tab / Shift+Tab in a bullet indents / outdents it (elsewhere Tab moves on as usual).
  edit.addEventListener('keydown', ev => {
    if (ev.key !== 'Tab' || ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const sel = getSelection();
    const li = sel.anchorNode && (sel.anchorNode.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode).closest?.('li');
    if (!li || !edit.contains(li)) return;
    ev.preventDefault();
    if (ev.shiftKey) {
      if (inList(li.parentElement) || li.parentElement.parentElement?.tagName === 'UL') document.execCommand('outdent');
    } else if (li.previousElementSibling) {
      document.execCommand('indent');
    }
    for (const span of edit.querySelectorAll('span[style]')) span.replaceWith(...span.childNodes); // the browser adds these
    changed(toMarkdown(edit));
  });

  // Ctrl+. (⌘+. on a Mac) makes the line the cursor is on a bullet, or plain
  // text again if it is one: the same as "- " at its start, from anywhere in the line.
  const bulletKey = ev => ev.key === '.' && (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey;
  edit.addEventListener('keydown', ev => {
    if (!bulletKey(ev)) return;
    ev.preventDefault();
    undoer.mark();
    const sel = getSelection();
    const into = sel.anchorNode?.nodeType === Node.TEXT_NODE ? lineBefore(sel.anchorNode, sel.anchorOffset).length : 0;
    document.execCommand('insertUnorderedList');
    for (const span of edit.querySelectorAll('span[style]')) span.replaceWith(...span.childNodes);
    // The browser puts the cursor at the start of the line: back to where it was.
    getSelection().modify('move', 'backward', 'paragraphboundary');
    for (let k = 0; k < into; k++) getSelection().modify('move', 'forward', 'character');
    changed(toMarkdown(edit));
    showState();
  });
  raw.addEventListener('keydown', ev => {
    if (!bulletKey(ev)) return;
    ev.preventDefault();
    const start = raw.value.lastIndexOf('\n', raw.selectionStart - 1) + 1;
    const marker = /^(\s*)(?:[-*]|\d{1,3}[.)])[ \u00a0]/.exec(raw.value.slice(start));
    const caret = raw.selectionStart;
    const bullet = marker && /^[-*]/.test(marker[0].trim());
    // A bullet goes back to plain text; a numbered line or a plain one becomes a bullet.
    const now = bullet ? marker[1] : `${marker ? marker[1] : ''}- `;
    const was = marker ? marker[0].length : 0;
    raw.setRangeText(now, start, start + was, 'preserve');
    const at = Math.max(start, caret + now.length - was);
    raw.setSelectionRange(at, at);
    changed(raw.value);
  });

  container.querySelector('.md-bar').addEventListener('mousedown', ev => {
    if (ev.target.closest('[data-cmd], [data-emoji], [data-size], .md-full, .md-make, .md-colour, .md-versions')) ev.preventDefault(); // keep the selection in the editor
  });
  container.querySelector('.md-bar').addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (!rawMode && (b.dataset.cmd || b.dataset.size || b.dataset.emoji)) undoer.mark(); // formatting is a step of its own
    if (b.classList.contains('md-versions')) { const r = from(); showVersions(r?.id ? { collection: r.collection, id: r.id, field: r.field || '' } : null, md, picked => undoer.restore(picked)); return; }
    if (b.classList.contains('md-mode')) { setFull(!container.classList.contains('bar-full')); return; }
    if (b.classList.contains('md-make')) { toggleMakeMenu(b); return; }
    if (b.classList.contains('md-colour')) {
      import('./colours.js').then(({ colourMenu }) => colourMenu(b, colour.get(), id => { Promise.resolve(colour.set(id)).then(paintColour); }));
      return;
    }
    if (b.classList.contains('md-full')) {
      if (isFull(container)) { closeFull({ blur: false }); spotlight(container); edit.focus(); }
      else goFull();
      return;
    }
    if (b.dataset.size) { if (!rawMode) { edit.focus(); setSize(Number(b.dataset.size)); } return; }
    if (b === toggle) {
      rawMode = !rawMode;
      toggle.setAttribute('aria-pressed', rawMode);
      container.classList.toggle('raw', rawMode);
      if (rawMode) { raw.value = md; raw.hidden = false; edit.hidden = true; raw.focus(); }
      else { paint(); raw.hidden = true; edit.hidden = false; edit.focus(); }
      return;
    }
    if (b.dataset.emoji) {
      const e = b.dataset.emoji;
      if (rawMode) {
        raw.focus();
        raw.setRangeText(e, raw.selectionStart, raw.selectionEnd, 'end');
        changed(raw.value);
      } else {
        if (!edit.contains(getSelection().anchorNode)) placeCaretAtEnd();
        edit.focus();
        document.execCommand('insertText', false, e);
        changed(toMarkdown(edit));
      }
      return;
    }
    if (rawMode) return;
    edit.focus();
    document.execCommand(b.dataset.cmd);
    changed(toMarkdown(edit));
    showState();
  });

  // ↗ Make: the line the cursor is on (or the selected lines) becomes tasks in
  // the Inbox or a contact; the text stays, linked to them (linemake.js). The
  // menu sits inside the note so using it doesn't count as leaving the note.
  let makeRange = null;
  container.querySelector('.md-bar').addEventListener('pointerdown', ev => {
    if (!ev.target.closest('.md-make')) return;
    const s = getSelection();
    if (s.rangeCount && edit.contains(s.anchorNode)) makeRange = s.getRangeAt(0).cloneRange();
  });
  // It closes again when you leave the note or click anywhere outside it.
  const outsideMake = ev => { if (!container.contains(ev.target)) closeMakeMenu(); };
  function closeMakeMenu() {
    container.querySelector('.md-make-menu')?.remove();
    document.removeEventListener('pointerdown', outsideMake, true);
  }
  function toggleMakeMenu(btn) {
    if (container.querySelector('.md-make-menu')) { closeMakeMenu(); return; }
    document.addEventListener('pointerdown', outsideMake, true);
    const m = document.createElement('div');
    m.className = 'md-make-menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = '<span class="muted">This line (or the selected lines) →</span>'
      + `<button type="button" role="menuitem" data-make="tasks">☐ Tasks in ${esc(word('list_inbox'))}</button>`
      + '<button type="button" role="menuitem" data-make="contact">👤 A contact</button>';
    btn.closest('.md-bar').after(m);
  }
  container.addEventListener('mousedown', ev => { if (ev.target.closest('.md-make-menu')) ev.preventDefault(); });
  container.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-make]');
    if (!b) return;
    closeMakeMenu();
    if (rawMode) { toast('Switch off Markdown first'); return; }
    if (makeRange && edit.contains(makeRange.startContainer)) restoreRange(makeRange);
    const before = md;
    const { makeFromLines } = await import('./linemake.js');
    const res = await makeFromLines(edit, b.dataset.make, from());
    if (!res) { toast('Put the cursor on a line first, or select some lines'); return; }
    changed(toMarkdown(edit));
    toast(res.label, {
      action: 'Undo',
      onAction: async () => {
        for (const x of res.made) await store.remove(x.collection, x.id);
        md = before;
        paint();
        onChange?.(md);
      },
    });
  });

  function placeCaretAtEnd() {
    edit.focus();
    const r = document.createRange();
    r.selectNodeContents(edit);
    r.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // The colour button shows the note's colour.
  function paintColour() {
    const sw = container.querySelector('.md-colour .swatch');
    if (sw) import('./colours.js').then(({ TINTS }) => { sw.style.setProperty('--sw', TINTS.find(c => c.id === colour.get())?.hex || 'transparent'); });
  }
  if (colour) paintColour();

  paint();
  return {
    focus: placeCaretAtEnd,
    setValue(next) {
      md = next || '';
      if (rawMode) raw.value = md; else paint();
    },
    get value() { return md; },
  };
}

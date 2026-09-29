// Turn lines of a note into tasks (in the Inbox) or a contact, from the notes
// toolbar. It works on the line the cursor is on, or every line the selection
// touches. The note keeps its text: each line becomes a link to what was made
// (or, if the line already has links in it, gets a small link added at its
// end), and what was made links back to the note it came from.
//
//   makeFromLines(edit, 'tasks' | 'contact', origin) → { made: [{collection, id}], label } | null

import * as store from './store.js';
import { summarise } from './summary.js';
import { linkMd } from './refs.js';
import { word } from './words.js';

const BLOCK = 'li, div, p, h3, h4';

// Loose text straight inside the editor goes into its own <div> per line, so
// every line is an element (the Markdown it saves as is the same).
function tidyRoot(edit) {
  let line = null;
  for (const n of [...edit.childNodes]) {
    const block = n.nodeType === Node.ELEMENT_NODE && (n.matches(BLOCK) || /^(UL|OL)$/.test(n.tagName));
    if (block) { line = null; continue; }
    if (n.nodeName === 'BR') { n.remove(); line = null; continue; }
    if (!line) { line = document.createElement('div'); n.before(line); }
    line.append(n);
  }
}

// The line's own text and nodes (not its sub-list).
const ownNodes = block => [...block.childNodes].filter(n => !/^(UL|OL)$/.test(n.nodeName));
const ownText = block => ownNodes(block).map(n => n.textContent).join('').replace(/ /g, ' ').trim();

function selectedLines(edit) {
  const sel = getSelection();
  if (!sel.rangeCount || !edit.contains(sel.anchorNode)) return [];
  const range = sel.getRangeAt(0);
  const walker = document.createTreeWalker(edit, NodeFilter.SHOW_TEXT);
  const hit = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (range.intersectsNode(n)) hit.push(n);
  // The cursor on an empty line or right at a line's edge: the element it's in.
  if (!hit.length && sel.anchorNode) hit.push(sel.anchorNode.nodeType === Node.TEXT_NODE ? sel.anchorNode : sel.anchorNode.childNodes[sel.anchorOffset] || sel.anchorNode);
  tidyRoot(edit);
  const blocks = [];
  for (const n of hit) {
    const el = n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement;
    const b = el?.closest(BLOCK);
    if (b && edit.contains(b) && b !== edit && !blocks.includes(b) && ownText(b)) blocks.push(b);
  }
  return blocks;
}

function chip(ref, text) {
  const c = document.createElement('span');
  c.className = 'ref';
  c.contentEditable = 'false';
  c.dataset.ref = ref;
  c.textContent = text;
  return c;
}

// The line itself becomes the link; a line that already holds links keeps them
// and gets "→ task" / "→ contact" at its end.
function linkLine(block, ref, word) {
  const own = ownNodes(block);
  const sub = [...block.childNodes].find(n => /^(UL|OL)$/.test(n.nodeName));
  if (own.some(n => n.nodeType === Node.ELEMENT_NODE && (n.matches('.ref') || n.querySelector('.ref')))) {
    const tail = chip(ref, `→ ${word}`);
    if (sub) sub.before(' ', tail); else block.append(' ', tail);
    return;
  }
  const text = ownText(block);
  for (const n of own) n.remove();
  const c = chip(ref, text);
  if (sub) sub.before(c); else block.append(c);
}

export async function makeFromLines(edit, kind, origin) {
  const blocks = selectedLines(edit);
  if (!blocks.length) return null;
  const from = origin?.id && origin.collection ? origin : null;
  const back = from ? linkMd(from.title || 'a note', from.collection, from.id) : '';
  const made = [];

  if (kind === 'tasks') {
    const { addTaskFirst } = await import('./tasks.js');
    for (const b of blocks) {
      const text = ownText(b);
      const { title } = summarise(text);
      const notes = [title !== text ? text : '', back ? `From ${back}` : ''].filter(Boolean).join('\n\n');
      const task = await addTaskFirst({ title, notes, horizon: 'inbox', source_thought_id: from?.collection === 'thoughts' ? from.id : null });
      made.push({ collection: 'tasks', id: task.id });
      linkLine(b, `tasks/${task.id}`, 'task');
    }
    return { made, label: `${made.length} task${made.length === 1 ? '' : 's'} in ${word('list_inbox')}` };
  }

  // One contact from all the lines. If they already link a contact (a number
  // spotted as you typed), the text goes to that contact instead of a new one.
  const { contactFromText, splitContactText } = await import('./contacts.js');
  const text = blocks.map(ownText).join('\n');
  const linked = blocks.flatMap(b => [...b.querySelectorAll('.ref[data-ref^="contacts/"]')]).map(c => c.dataset.ref.split('/')[1])[0];
  let contact = linked && await store.get('contacts', linked);
  if (contact) {
    const about = contact.about || splitContactText(text).name;
    await store.update('contacts', contact.id, { about, body: [contact.body, text].filter(s => s?.trim()).join('\n') });
  } else {
    contact = await contactFromText(text, { source_thought_id: from?.collection === 'thoughts' ? from.id : null });
    if (back) await store.update('contacts', contact.id, { notes: `${contact.notes ? `${contact.notes}\n\n` : ''}From ${back}` });
    made.push({ collection: 'contacts', id: contact.id });
  }
  for (const b of blocks) if (!b.querySelector(`.ref[data-ref="contacts/${contact.id}"]`)) linkLine(b, `contacts/${contact.id}`, 'contact');
  return { made, label: linked ? `Added to the contact ${contact.name || ''}`.trim() : `Contact made${contact.name ? `: ${contact.name}` : ''}` };
}

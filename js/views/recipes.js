// Batch Book: recipes in your own books, and every batch made from them.
// #/recipes                         recipes (a tab per book, with tags and a search) or all batches;
//                                   cards are dragged like Brain Dump notes (onto another book's heading moves them there)
// #/recipes/<recipe id>             a recipe: Make this, details, ingredients, steps, result photos, its batches
// #/recipes/<recipe id>/make/<id>   one batch: its own copy of the recipe to change, each ingredient In stock or
//                                   Add to list, summary, readings (gravity and the book's other kinds), diary, tasting notes
// Pages are drawn on the same papers as the Day Planner (👁: paper, lined, margin).
// Data and units: js/batchbook.js. A book is stored as a recipe's `type` (settings.batch_sections).

import * as store from '../store.js';
import * as att from '../attachments.js';
import { sectionsOf, sectionOf, stepsOf, fixBareUnits, parseRecipes, IMPORT_EXAMPLE, UNITS, parseLine, parseQty, qtyText, amountText, ingredientText, stepHtml, renameRefs, abvOf, readingTypesOf, isGravity, nextBatchNo, loadBook, batchName, newBatchName, batchDay } from '../batchbook.js';
import { loadLists, nestItems, createList, addItems } from '../lists.js';
import { richText } from '../richtext.js';
import { atEdge, caretTo } from '../walk.js';
import { debounced } from '../autosave.js';
import { toast, undoable } from '../toast.js';
import { askText, askYes } from '../ask.js';
import { dateText, isoDate, PAPERS } from '../days.js';
import { cogHtml } from '../viewcog.js';
import { rankOf, byRank, reorderWrites } from '../order.js';
import { createListKit } from '../listkit.js';
import { shareSheet, sharedWithText, people, fromOthers, invitesHtml, theirsHtml } from '../sharing.js';
import { TINTS } from '../colours.js';
import { pillMenu } from '../pillmenu.js';
import { sortable } from '../sortable.js';
import { signedIn, status as syncStatus } from '../sync.js';
import { addExamples, addNewPhotos, isBrandNew, needsWipe, photosBehind, setUpBooks, wipeBook } from '../examples.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const today = () => isoDate(new Date());
const shortDate = iso => (iso ? dateText(new Date(`${iso.slice(0, 10)}T12:00`), { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const STATUSES = [['planned', 'Planned', '📝'], ['going', 'On the go', '🫧'], ['done', 'Done', '✅']];
const statusLabel = v => { const st = STATUSES.find(x => x[0] === (v || 'going')); return `${st[2]} ${st[1]}`; };
const GOALS = ['ABV goal', 'Sweetness goal', 'Final sweetness'];
const SCALES = [1 / 3, 0.5, 1, 2, 3];
const now = () => new Date().toISOString();
// Recipes never dragged sort by when they were made.
const madeAt = r => Date.parse(r.created_at) / 1e4 || 0;
const rankOfRecipe = r => rankOf(r, madeAt);
const byPlace = byRank(madeAt);
const camera = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

export default {
  async mount(el) {
    const state = this.state = { recipe: null, make: null, section: '', tag: '', q: '', batches: false, status: '', times: 1, edit: {}, owner: null };
    let data = { recipes: [], makes: [], entries: [] };
    let atts = new Map();
    let settings = {};
    let sections = [];
    let lists = [];
    let shared = []; // recipes others share with you: [{ r, owner_id, name }]
    let dirty = false; // something changed while a field was being written in: redraw once it's left
    let focusNext = null;
    const recipeOf = id => data.recipes.find(r => r.id === id);
    const makeOf = id => data.makes.find(m => m.id === id);
    const makesOf = id => data.makes.filter(m => m.recipe_id === id);
    const sectionFor = r => sectionOf(sections, r?.type);
    const entriesOf = (id, kind) => data.entries.filter(e => e.make_id === id && e.kind === kind).sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || a.created_at.localeCompare(b.created_at));
    const go = hash => { if (location.hash !== hash) location.hash = hash; else render(); };
    const photoOf = id => (atts.get(id) || []).find(a => a.kind === 'image' && a.thumb);
    const paper = () => settings.batch_paper || 'notebook';
    // A recipe's own colour (More, Colour), else its book's.
    const colourOf = r => TINTS.find(c => c.id === r?.colour)?.hex || sectionFor(r).colour;
    // Someone else's recipe (shared with you) is read and changed in their space (store.js): its pages end /from/<their id>.
    const ownerPath = (owner = state.owner) => (owner ? `/from/${owner}` : '');
    const theirName = () => shared.find(x => x.owner_id === state.owner)?.name || 'Someone';
    // Lists are always your own, even on someone else's batch.
    const inMine = async fn => { store.useSpace(null); try { return await fn(); } finally { store.useSpace(state.owner ? store.spaceOf(state.owner) : null); } };
    const batchListName = m => batchName(m, recipeOf(m.recipe_id)?.title); // the batch's own list is named after it
    const writing = () => !!document.activeElement?.closest?.('input:not([type="checkbox"]), textarea, select, [contenteditable="true"], [data-step-view]') && el.contains(document.activeElement);

    // ---------- the recipes ----------

    // The ★ Pinned tab: pinned recipes from every book (as Brain Dump's Pinned).
    const PINNED = '__pinned';
    const pinnedTab = () => state.section === PINNED;
    const inBook = r => !state.section || (pinnedTab() ? !!r.pinned : (r.type || '') === state.section);
    const matches = r => {
      if (!inBook(r)) return false;
      if (state.tag && !(r.tags || []).includes(state.tag)) return false;
      if (!state.q) return true;
      const text = [r.title, r.type, r.description, (r.tags || []).join(' ')].concat((r.ingredients || []).map(i => `${i.item} ${i.note}`), stepsOf(r).map(x => x.text)).join(' ').toLowerCase();
      return state.q.toLowerCase().split(/\s+/).every(w => text.includes(w));
    };
    const order = r => sections.findIndex(x => x.name === (r.type || ''));
    // By book; in each, pinned first, then the order they were dragged into.
    // The batches list's order (settings.batch_sort, synced): by date either way, by name, or Custom
    // (the order they were dragged into; dragging switches to it quietly).
    const SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['title', 'By name'], ['custom', 'Custom']];
    const batchSort = () => settings.batch_sort || 'new';
    const madeKey = m => -(Date.parse(m.date || m.created_at) / 1e4 || 0);
    const rankOfBatch = m => rankOf(m, madeKey);
    const byBatchPlace = byRank(madeKey);
    const sortBatches = list => list.slice().sort({
      new: (a, b) => (b.date || '').localeCompare(a.date || '') || (b.created_at || '').localeCompare(a.created_at || ''),
      old: (a, b) => (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || ''),
      title: (a, b) => batchName(a, recipeOf(a.recipe_id)?.title).localeCompare(batchName(b, recipeOf(b.recipe_id)?.title)),
      custom: byBatchPlace,
    }[batchSort()] || byBatchPlace);
    const shown = () => data.recipes.filter(matches).sort((a, b) => order(a) - order(b) || Number(!!b.pinned) - Number(!!a.pinned) || byPlace(a, b));

    // A card: its picture, name and how often it's been made; Make and ⋯ More under it.
    // from: a person sharing it with you ({ owner_id, name }); their cards don't drag.
    function card(r, from = null) {
      const sec = sectionFor(r);
      const made = from ? [] : makesOf(r.id);
      const photo = from ? null : photoOf(r.id);
      const withWho = from ? from.name : sharedWithText({ kind: 'recipe', id: r.id });
      return `<li class="bb-card-li" ${from ? `data-from="${from.owner_id}" data-rid="${r.id}"` : `data-id="${r.id}" data-depth="0"`} style="--bb:${colourOf(r)}">
        ${from ? '' : `<button type="button" class="drag-handle kit-grip" aria-label="Select">${icon('i-grip')}</button>`}
        <a class="bb-card" href="#/recipes/${r.id}${from ? `/from/${from.owner_id}` : ''}">
        <span class="bb-card-pic">${photo ? `<img src="${photo.thumb}" alt="" loading="lazy">` : `<span class="bb-card-emoji">${sec.emoji}</span>`}</span>
        <span class="bb-card-body">
          <span class="bb-card-title">${esc(r.title || 'Untitled')}</span>
          ${r.description ? `<span class="muted bb-card-desc">${esc(r.description)}</span>` : ''}
          ${(r.tags || []).length ? `<span class="bb-card-tags">${r.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</span>` : ''}
          ${withWho ? `<span class="muted bb-card-made">👥 ${from ? `Shared by ${esc(withWho)}` : `Shared with ${esc(withWho)}`}</span>` : ''}
          ${from ? '' : `<span class="muted bb-card-made">${made.length ? `Made ${made.length}× · last ${shortDate(made[0].date)}` : 'Not made yet'}</span>`}
        </span>
        </a>
        <div class="bb-card-acts">
          <button type="button" class="bb-card-make" data-card="make" title="Start a batch of this">🧪 Make</button>
          ${from ? '' : `<button type="button" class="pin bb-pin" data-card="pin" aria-pressed="${!!r.pinned}" title="${r.pinned ? 'Unpin' : 'Pin: first in its book, and under ★ Pinned'}">${r.pinned ? '★' : '☆'}</button>`}
          <details class="tool-menu bb-card-menu">
            <summary class="icon-btn" aria-label="More" title="More">${icon('i-more')}</summary>
            <div class="menu">
              <button type="button" data-card="copy">📋 Copy to clipboard</button>
              ${from ? '<button type="button" data-card="dup">⧉ Make a copy of my own</button>' : '<button type="button" data-card="share">👥 Share…</button><button type="button" data-card="dup">⧉ Duplicate</button>'}
              <button type="button" data-card="print">🖨️ Print</button>
              ${from ? `<button type="button" data-share-leave="${fromOthers(['recipe']).find(sh => sh.owner_id === from.owner_id && sh.info.id === r.id)?.id || ''}">Leave this shared recipe</button>` : `
              <button type="button" data-card="colour">🎨 Colour…</button>
              <span class="menu-label muted">Move to</span>
              ${sections.filter(x => x.name !== (r.type || '')).map(x => `<button type="button" data-card-book="${esc(x.name)}">${x.emoji} ${esc(x.name || 'No book')}</button>`).join('')}
              <hr>
              <button type="button" data-card="archive">Archive</button>
              <button type="button" class="danger" data-card="delete">Delete</button>`}
            </div>
          </details>
        </div>
      </li>`;
    }

    // In the batches list a row isn't a link (a hold on a link can't drag, hold.js): pressing it opens the batch.
    function batchRow(m, draggable = false) {
      const r = recipeOf(m.recipe_id);
      const sec = sectionFor(r);
      const abv = abvOf(entriesOf(m.id, 'reading'));
      const photo = photoOf(m.id);
      const href = `#/recipes/${m.recipe_id}/make/${m.id}${draggable ? '/list' : ''}${ownerPath()}`; // /list: Esc and ‹ go back to the batches list
      return `<${draggable ? `div role="link" tabindex="0" data-href="${href}"` : `a href="${href}"`} class="bb-batch-row" style="--bb:${colourOf(r)}">
        ${photo ? `<img class="bb-batch-pic" src="${photo.thumb}" alt="">` : `<span class="bb-batch-emoji">${sec.emoji}</span>`}
        <span class="bb-batch-no">${esc(batchName(m, r?.title))}</span>
        <span class="bb-batch-name">${m.name && !m.name.includes(r?.title || '') ? `<span class="muted">${esc(r?.title || 'Untitled')}</span>` : ''}${m.description && m.description !== r?.description ? ` <span class="muted">· ${esc(m.description)}</span>` : ''}</span>
        ${batchName(m, r?.title).includes(batchDay(m.date)) ? '' : `<span class="muted">${shortDate(m.date)}</span>`}
        ${abv ? `<span class="chip">${abv.abv.toFixed(2)}%</span>` : ''}
        ${draggable ? `<button type="button" class="chip bb-status-${m.status || 'going'}" data-batch-status="${m.id}" title="Change status">${statusLabel(m.status)} ▾</button>`
          : `<span class="chip bb-status-${m.status || 'going'}">${statusLabel(m.status)}</span>`}
      </${draggable ? 'div' : 'a'}>`;
    }

    function paperHtml() {
      return `<h4>Paper</h4><div class="view-opts bb-papers" role="group" aria-label="Paper">
        ${PAPERS.map(p => `<button type="button" class="paper-pill" data-look="${p.id}" data-bb-paper="${p.id}" aria-pressed="${paper() === p.id}">${p.label}</button>`).join('')}
      </div>`;
    }

    // A book's heading: stays at the top while its recipes scroll under it.
    const chapter = (name, n) => { const x = sectionOf(sections, name); return `<li class="bb-chapter-title" data-book="${esc(name)}" style="--bb:${x.colour}"><span>${x.emoji}</span> ${esc(name || 'No book')} <span class="muted">${n}</span></li>`; };

    function overview() {
      const inSection = data.recipes.filter(inBook);
      const tags = Array.from(new Set(inSection.flatMap(r => r.tags || []))).sort((a, b) => a.localeCompare(b));
      if (state.tag && !tags.includes(state.tag)) state.tag = '';
      const list = shown();
      const ids = new Set(list.map(r => r.id));
      const batches = sortBatches(data.makes.filter(m => ids.has(m.recipe_id) && (!state.status || (m.status || 'going') === state.status)));
      const groups = state.section && !pinnedTab() ? [state.section] : sections.map(x => x.name).filter(n => list.some(r => (r.type || '') === n));
      const theirs = shared.filter(x => matches(x.r));
      const invites = invitesHtml(['recipe']);
      return `
        <div class="bb-sticky-mark" aria-hidden="true"></div>
        <div class="bb-sticky">
          <div class="bb-head">
            <button type="button" class="primary" data-act="new">+ New recipe</button>
            <input type="search" class="bb-search" placeholder="Search recipes…" value="${esc(state.q)}" aria-label="Search recipes">
            ${cogHtml('recipes', paperHtml())}
            <details class="tool-menu page-more">
              <summary class="icon-btn" aria-label="More actions">${icon('i-more')}</summary>
              <div class="menu"><a href="#" data-act="sections">Edit books</a><a href="#" data-act="import">Import recipes</a><a href="#" data-act="examples">Add example recipes</a><a href="#/bin/archive/recipes">Show Archive</a><a href="#/bin/bin/recipes">Show Bin</a></div>
            </details>
          </div>
          <div class="bb-sections-bar">
            <div class="bb-sections" role="tablist" aria-label="Books">
              <button type="button" data-section="" aria-pressed="${!state.section}">All</button>
              ${sections.map(x => `<button type="button" data-section="${esc(x.name)}" aria-pressed="${state.section === x.name}" style="--bb:${x.colour}">${x.emoji} ${esc(x.name || 'No book')}</button>`).join('')}
              <button type="button" data-section="${PINNED}" aria-pressed="${pinnedTab()}">★ Pinned</button>
            </div>
            <div class="bb-mode" role="group" aria-label="Show"><button type="button" data-mode="recipes" aria-pressed="${!state.batches}">📖 Recipes</button><button type="button" data-mode="batches" aria-pressed="${state.batches}">🧪 Batches</button></div>
            <button type="button" class="bb-sections-edit filter-more" data-act="sections" title="Add, rename, reorder or remove books" aria-label="Edit books">⋯</button>
          </div>
          ${state.batches ? `<div class="bb-status-row"><div class="bb-status" role="group" aria-label="Status">${[['', 'All']].concat(STATUSES).map(([v, l, e]) => `<button type="button" data-status="${v}" aria-pressed="${state.status === v}">${e ? `${e} ` : ''}${l}</button>`).join('')}</div>
            <select class="bb-sort" data-batch-sort aria-label="Sort batches">${SORTS.map(([v, l]) => `<option value="${v}"${batchSort() === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`
            : tags.length ? `<div class="bb-tags">${tags.map(t => `<button type="button" class="chip" data-tag="${esc(t)}" aria-pressed="${state.tag === t}">${esc(t)}</button>`).join('')}</div>` : ''}
        </div>
        <div class="bb-body">
        ${!data.recipes.length && !shared.length && !invites ? `<div class="empty"><h2>No recipes yet.</h2><p class="muted">Add a recipe: ingredients, steps and photos. Each time you make it, start a batch: its own copy to change, what you have in and what to buy, readings, a diary and tasting notes.</p><button type="button" data-act="examples">Add some example recipes</button></div>`
        : state.batches ? (batches.length ? `<ul class="bb-batches bb-batch-list">${batches.map(m => `<li data-id="${m.id}" data-depth="0"><button type="button" class="drag-handle kit-grip" aria-label="Select">${icon('i-grip')}</button>${batchRow(m, true)}</li>`).join('')}</ul>` : `<div class="empty"><h2>No ${state.status ? `${STATUSES.find(s => s[0] === state.status)[1].toLowerCase()} ` : ''}batches here.</h2><p class="muted">Open a recipe and press Make this.</p></div>`)
        : `${list.length ? `<ul class="bb-grid bb-cards">${groups.map(name => { const mine = list.filter(r => (r.type || '') === name); return chapter(name, mine.length) + mine.map(r => card(r)).join(''); }).join('')}</ul>`
          : `<div class="empty"><h2>Nothing here yet.</h2>${pinnedTab() ? '<p class="muted">Press ☆ on a recipe to pin it here.</p>' : state.section && !state.q ? '<p class="muted">Press + New recipe to add one to this book.</p>' : ''}</div>`}
          ${theirs.length || invites ? `<h3 class="bb-chapter-title bb-shared-title" style="--bb:#7a6a55"><span>👥</span> Shared with me</h3>${invites}<ul class="bb-grid bb-shared">${theirs.map(x => card(x.r, x)).join('')}</ul>` : ''}`}
        </div>`;
    }

    // ---------- pieces used on both pages ----------

    const line = (margin, content, tools = '', attrs = '') => `<div class="bb-line" ${attrs}><span class="bb-margin">${margin}</span><span class="bb-content">${content}</span>${tools ? `<span class="bb-tools">${tools}</span>` : ''}</div>`;

    // Its photos: small across the top, just to look at (none, nothing there), and added or removed in Photos at the bottom.
    // The first is its picture on the cards.
    const photoStrip = id => ((atts.get(id) || []).some(a => a.kind === 'image') ? `<div class="bb-photos">${att.rowHtml((atts.get(id) || []).filter(a => a.kind === 'image'), { parent: id, addButton: false })}</div>` : '');
    const photosHtml = (id, whose) => `<h2 class="bb-h"><span>📸 Photos</span><span class="muted bb-h-note">the first is ${whose} picture</span></h2>
          ${att.rowHtml(atts.get(id), { parent: id, addButton: 'Add photos' })}`;

    // Ingredients and steps share one margin, as wide as the longest amount needs (CSS caps it).
    const workMargin = (rec, times) => `--bb-chars:${Math.max(0, ...(rec.ingredients || []).map(i => amountText(i, times).length))}`;

    // o = { collection, id }: the recipe or the batch whose ingredients these are.
    // On a batch (stock: true) each ingredient is In stock or Add to list (the batch's list: see listLine).
    function ingredientsHtml(rec, o, { stock = false } = {}) {
      const ings = rec.ingredients || [];
      const isRecipe = o.collection === 'recipes';
      const hasQty = ings.some(i => i.qty != null);
      const scale = hasQty ? (isRecipe
        ? `<span class="segmented bb-scale" aria-label="Scale">${SCALES.map(s => `<button type="button" data-scale="${s}" aria-pressed="${state.times === s}">×${qtyText(s)}</button>`).join('')}</span>`
        : `<span class="segmented bb-scale" aria-label="Scale this batch"><button type="button" data-rescale="${1 / 3}" title="A third of every amount">×⅓</button><button type="button" data-rescale="0.5" title="Halve every amount">×½</button><button type="button" data-rescale="2" title="Double every amount">×2</button><button type="button" data-rescale="ask" title="Scale every amount">×…</button></span>`) : '';
      const head = `<h2 class="bb-h"><span>🧺 Ingredients</span>${scale}</h2>`;
      // Written straight on the lines: the amount in the margin, the ingredient (", note") beside it.
      const times = isRecipe ? state.times : 1;
      const got = rec.stock || {};
      const addLine = line('+', `<input class="bb-ing-add no-inline" placeholder="${ings.length ? 'Another ingredient' : 'An ingredient, like 250g butter, unsalted'}" aria-label="Add an ingredient">`);
      return `${head}${stock && ings.length ? listLine(rec) : ''}<div class="bb-lines bb-ings${stock ? ' bb-stocked' : ''}" data-owner="${o.collection}:${o.id}">${ings.map(i => line(`<input class="bb-ing-amt" data-ing-line="amount" value="${esc(amountText(i, times))}" placeholder="…" aria-label="Amount">`,
        `<input class="bb-ing-text" data-ing-line="text" value="${esc(i.item + (i.note ? `, ${i.note}` : ''))}" placeholder="Ingredient" aria-label="Ingredient">`,
        stock && i.item ? `<button type="button" class="bb-stock-btn" data-stock="have" aria-pressed="${got[i.id] === 'have'}" title="In stock">✓<span class="bb-stock-word"> In stock</span></button><button type="button" class="bb-stock-btn" data-stock="need" aria-pressed="${got[i.id] === 'need'}" title="Add to list">🛒<span class="bb-stock-word"> ${got[i.id] === 'need' ? 'On the list' : 'Add to list'}</span></button>` : '',
        `data-ing="${i.id}"${stock ? ` data-got="${got[i.id] || ''}"` : ''}`)).join('')}${addLine}</div>`;
    }

    // Which list Add to list puts things on: a new one for this batch (made on the first add), or one you have.
    function listLine(m) {
      const list = m.list_id && lists.find(l => l.id === m.list_id);
      const own = lists.filter(l => l.kind !== 'template');
      return `<div class="bb-listline"><span class="muted">Add to list puts things on</span>
        <select data-batch-list aria-label="Shopping list"><option value="">${list ? 'A new list for this batch' : `A new list: ${esc(batchListName(m))}`}</option>${own.map(l => `<option value="${l.id}"${l.id === list?.id ? ' selected' : ''}>${esc(l.name || 'Untitled')}</option>`).join('')}</select>
        ${list ? `<a href="#/lists/${list.id}">Open the shopping list</a><button type="button" class="link-btn" data-act="share-list">Share</button>` : ''}</div>`;
    }

    // Steps are written straight on the lines: press one to change it; Enter starts the next.
    function stepsHtml(rec, o) {
      const steps = stepsOf(rec);
      const times = o.collection === 'recipes' ? state.times : 1;
      const ings = rec.ingredients || [];
      return `<div class="bb-method" data-owner="${o.collection}:${o.id}">
        <h2 class="bb-h"><span>🥄 Steps</span></h2>
        ${ings.length ? `<div class="bb-ref-picks"><span class="muted">Put in:</span>${ings.map(i => `<button type="button" class="chip" data-ref="${esc(i.item)}">${esc(i.item)}</button>`).join('')}</div>` : ''}
        <div class="bb-lines bb-steps">
          ${steps.map((x, n) => line(`${n + 1}`, `
            <div class="bb-step-view" data-step-view tabindex="0" role="button" title="Press to change">${stepHtml(x.text, ings, times, esc) || '<span class="muted">Empty step</span>'}</div>
            <textarea class="bb-step-edit no-inline" data-step-text rows="1" hidden aria-label="Step ${n + 1}">${esc(x.text)}</textarea>
            ${(atts.get(x.id) || []).length ? att.rowHtml(atts.get(x.id), { parent: x.id, addButton: false }) : ''}`,
            `<button type="button" class="icon-btn" data-step-photo title="Add a photo to this step" aria-label="Add a photo">${camera}</button>`, `data-step="${x.id}"`)).join('')}
          ${line('+', `<textarea class="bb-step-new no-inline" rows="1" placeholder="${steps.length ? 'Next step' : 'First step'}" aria-label="New step"></textarea>`)}
        </div>
        <p class="muted hint bb-ref-hint">{salt} shows the salt with its amount. {1/2 salt} or {25% salt} shows part of it; {stock|hot stock} shows the amount with your own words ("200ml hot stock"), and {salt|a pinch} shows just your words. Enter starts the next step.</p>
      </div>`;
    }

    // The details: each field a line, label in the margin. With gravity readings, goals and actual sit together.
    function fieldsHtml(rec, { goals = false } = {}) {
      const fields = rec.fields || {};
      return Object.keys(fields).filter(k => !(goals && GOALS.includes(k))).map(k => line(esc(k),
        `<input data-field-key="${esc(k)}" value="${esc(fields[k] || '')}" aria-label="${esc(k)}">`,
        `<button type="button" class="icon-btn bb-x" data-field-remove="${esc(k)}" aria-label="Remove ${esc(k)}">×</button>`)).join('');
    }

    const top = (act, label, extra = '') => `<div class="bb-top"><button type="button" class="back" data-act="${act}">‹ ${esc(label)}</button><span class="spacer"></span>${extra}${cogHtml('recipes', paperHtml())}</div>`;

    // ---------- a recipe ----------

    function recipePage() {
      const r = recipeOf(state.recipe);
      if (!r) return '<div class="empty"><h2>That recipe has gone.</h2></div>';
      const sec = sectionFor(r);
      const made = makesOf(r.id);
      return `${top('home', 'Recipes', `<button type="button" class="primary bb-make-btn" data-act="make" title="Start a batch: its own copy of this recipe">🧪 Make this${state.times !== 1 ? ` ×${qtyText(state.times)}` : ''}</button>`)}
        ${state.owner ? theirsHtml(`${theirName()}'s recipe, shared with you`, '<button type="button" data-act="home">Back to my recipes</button>') : ''}
        <article class="bb-paper" data-paper="${paper()}" style="--bb:${colourOf(r)};${workMargin(r, state.times)}">
          ${photoStrip(r.id)}
          <header class="bb-title-row">
            <span class="bb-emoji">${sec.emoji}</span>
            <textarea class="bb-title one-line" rows="1" data-rec="title" placeholder="Recipe name" aria-label="Recipe name">${esc(r.title)}</textarea>
          </header>
          <div class="bb-rule"></div>
          <textarea class="bb-desc one-line" rows="1" data-rec="description" placeholder="What it is, in a line" aria-label="Description">${esc(r.description || '')}</textarea>
          <div class="bb-lines bb-details">
            ${line('Book', `<select data-rec-section aria-label="Book">${sections.map(x => `<option value="${esc(x.name)}"${x.name === (r.type || '') ? ' selected' : ''}>${x.emoji} ${esc(x.name || 'No book')}</option>`).join('')}<option value="__edit">Edit books…</option></select>`)}
            ${line('Tags', `<input data-rec="tags" value="${esc((r.tags || []).join(', '))}" placeholder="Words to find it by, with commas between" aria-label="Tags">`)}
            ${fieldsHtml(r)}
          </div>
          <button type="button" class="bb-add-field" data-act="add-field">+ Add a detail</button>
          ${ingredientsHtml(r, { collection: 'recipes', id: r.id })}
          ${stepsHtml(r, { collection: 'recipes', id: r.id })}
          ${r.tasting?.trim() ? `<h2 class="bb-h"><span>🥂 Tasting notes</span><span class="muted bb-h-note">these move to the first batch you make</span></h2>
          <div class="bb-tasting bb-note"></div>` : ''}
          ${photosHtml(r.id, 'the recipe\'s')}
          <h2 class="bb-h"><span>🧪 Batches</span></h2>
          ${made.length ? `<div class="bb-batches">${made.map(batchRow).join('')}</div>` : '<p class="muted bb-none">Not made yet. Make this (at the top) starts a batch with its own copy of the recipe, to change as you like, and to tick off what you have in.</p>'}
        </article>
        <div class="detail-actions bb-foot">
          <span class="spacer"></span>
          <button type="button" data-act="archive-recipe">Archive recipe</button>
          <button type="button" class="danger" data-act="delete-recipe">Delete recipe</button>
        </div>`;
    }

    // ---------- a batch ----------

    function chart(readings) {
      const pts = readings.filter(x => x.gravity && x.date).map(x => ({ d: Date.parse(x.date), g: x.gravity }));
      if (pts.length < 2) return '';
      const W = 600, H = 140, P = 24;
      const d0 = Math.min.apply(null, pts.map(p => p.d)), d1 = Math.max.apply(null, pts.map(p => p.d)) || d0 + 1;
      const g0 = Math.min.apply(null, pts.map(p => p.g)), g1 = Math.max.apply(null, pts.map(p => p.g));
      const x = d => P + ((d - d0) / Math.max(1, d1 - d0)) * (W - 2 * P);
      const y = g => P + (g1 === g0 ? (H - 2 * P) / 2 : ((g1 - g) / (g1 - g0)) * (H - 2 * P));
      return `<svg class="bb-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gravity over time">
        <polyline points="${pts.map(p => `${x(p.d).toFixed(1)},${y(p.g).toFixed(1)}`).join(' ')}"/>
        ${pts.map(p => `<circle cx="${x(p.d).toFixed(1)}" cy="${y(p.g).toFixed(1)}" r="4"/><text x="${x(p.d).toFixed(1)}" y="${(y(p.g) - 8).toFixed(1)}">${p.g.toFixed(3)}</text>`).join('')}
      </svg>`;
    }

    function entriesHtml(m, kind, title) {
      return `<h2 class="bb-h"><span>${title}</span></h2>
        <div class="bb-lines bb-diary">${entriesOf(m.id, kind).map(e => line(
          `<input type="date" data-entry-field="date" value="${esc(e.date || '')}" aria-label="Date">`,
          `<textarea class="bb-entry-text no-inline" data-entry-field="text" rows="1" placeholder="${kind === 'tasting' ? 'How it tasted' : 'What happened'}" aria-label="Notes">${esc(e.text || '')}</textarea>${(atts.get(e.id) || []).length ? att.rowHtml(atts.get(e.id), { parent: e.id, addButton: false }) : ''}`,
          `<button type="button" class="icon-btn" data-entry-photo title="Add a photo" aria-label="Add a photo">${camera}</button><button type="button" class="icon-btn bb-x" data-entry-remove aria-label="Remove">×</button>`,
          `data-entry="${e.id}"`)).join('')}
          ${line('', `<button type="button" class="bb-add-field" data-add-entry="${kind}">+ Add ${kind === 'tasting' ? 'a tasting' : 'an entry'}</button>`)}
        </div>`;
    }

    function makePage() {
      const m = makeOf(state.make);
      if (!m) return '<div class="empty"><h2>That batch has gone.</h2></div>';
      const r = recipeOf(m.recipe_id);
      const sec = sectionFor(r);
      const readings = entriesOf(m.id, 'reading');
      const abv = abvOf(readings);
      const types = readingTypesOf(sec).slice();
      for (const e of readings) if (!types.some(x => x.toLowerCase() === (e.type || 'Gravity').toLowerCase())) types.push(e.type || 'Gravity');
      const gravity = types.some(isGravity);
      const f = m.fields || {};
      const goal = k => `<label><span>${k}</span><input data-field-key="${k}" value="${esc(f[k] || '')}" aria-label="${k}" placeholder="…"></label>`;
      return `${state.fromList ? top('home', 'Batches') : top('to-recipe', r?.title || 'Recipe')}
        ${state.owner ? theirsHtml(`A batch of ${theirName()}'s recipe, shared with you`, '<button type="button" data-act="home">Back to my recipes</button>') : ''}
        <article class="bb-paper bb-make" data-paper="${paper()}" style="--bb:${colourOf(r)};${workMargin(m, 1)}">
          ${photoStrip(m.id)}
          <header class="bb-title-row">
            <span class="bb-emoji">${sec.emoji}</span>
            <textarea class="bb-title one-line" rows="1" data-make="name" placeholder="Batch name" aria-label="Batch name">${esc(batchName(m, r?.title))}</textarea>
          </header>
          <div class="bb-rule"></div>
          <p class="bb-of">${esc(r?.type ? `${r.type}: ` : '')}<a href="#/recipes/${m.recipe_id}${ownerPath()}">${esc(r?.title || 'Untitled')}</a></p>
          <h2 class="bb-h bb-h-big"><span>🍯 Recipe</span></h2>
          ${ingredientsHtml(m, { collection: 'recipe_makes', id: m.id }, { stock: true })}
          ${stepsHtml(m, { collection: 'recipe_makes', id: m.id })}
          <h2 class="bb-h"><span>📋 Batch summary</span></h2>
          <div class="bb-lines bb-details">
            ${line('Date', `<input type="date" data-make="date" value="${esc(m.date || '')}" aria-label="Date">`)}
            ${line('Description', `<input data-make="description" value="${esc(m.description || '')}" aria-label="Description" placeholder="What makes this batch different">`)}
            ${line('Status', `<select data-make="status" aria-label="Status">${STATUSES.map(([v, l, e]) => `<option value="${v}"${(m.status || 'going') === v ? ' selected' : ''}>${e} ${l}</option>`).join('')}</select>`)}
            ${fieldsHtml(m, { goals: gravity })}
            ${gravity ? line('Goals vs actual', `<div class="bb-goals">${goal('Sweetness goal')}${goal('ABV goal')}${goal('Final sweetness')}<label class="bb-abv"><span>${abv?.final ? 'Final ABV' : 'ABV so far'}</span><b>${abv ? `${abv.abv.toFixed(2)}%` : '–'}</b></label></div>`)
              + line('Back-sweetened?', `<input type="checkbox" data-make="back_sweetened" ${m.back_sweetened ? 'checked' : ''} aria-label="Back-sweetened">`) : ''}
            ${line('Current state', `<input data-make="state" value="${esc(m.state || '')}" aria-label="Current state" placeholder="Where it's up to">`)}
          </div>
          <button type="button" class="bb-add-field" data-act="add-field">+ Add a detail</button>
          ${types.length ? `<h2 class="bb-h"><span>🌡️ Readings</span><span class="bb-reading-adds">${types.map(x => `<button type="button" data-act="reading" data-type="${esc(x)}">+ ${esc(x)}</button>`).join('')}</span></h2>
            ${gravity ? chart(readings.filter(e => isGravity(e.type))) : ''}
            <div class="bb-readings">${readings.map(e => `<div class="bb-reading" data-entry="${e.id}">
              ${isGravity(e.type) ? `<select data-entry-field="label" aria-label="Kind of reading">${['OG', 'SG', 'FG'].map(l => `<option${(e.label || 'SG') === l ? ' selected' : ''}>${l}</option>`).join('')}</select>
              <input class="bb-gravity" data-entry-field="gravity" value="${e.gravity ? e.gravity.toFixed(3) : ''}" inputmode="decimal" placeholder="1.050" aria-label="Gravity">`
              : `<span class="bb-reading-type">${esc(e.type)}</span><input class="bb-reading-value" data-entry-field="value" value="${esc(e.value || '')}" placeholder="21°C" aria-label="${esc(e.type)}">`}
              <input type="date" data-entry-field="date" value="${esc(e.date || '')}" aria-label="Date">
              <textarea class="bb-entry-text no-inline" data-entry-field="text" rows="1" placeholder="Note" aria-label="Note">${esc(e.text || '')}</textarea>
              <button type="button" class="icon-btn bb-reading-x" data-entry-remove aria-label="Remove reading">×</button>
            </div>`).join('') || '<p class="muted bb-none">No readings yet.</p>'}</div>` : ''}
          ${entriesHtml(m, 'diary', '📔 Diary')}
          <h2 class="bb-h"><span>🥂 Tasting notes</span></h2>
          <div class="bb-tasting bb-note"></div>
          ${photosHtml(m.id, 'this batch\'s')}
        </article>
        <div class="detail-actions bb-foot">
          <span class="spacer"></span>
          <button type="button" class="danger" data-act="delete-make">Delete batch</button>
        </div>`;
    }

    // ---------- drawing ----------

    let tasting = null;
    let adding = null; // a step still being saved: drawn once it's in
    // Tasting notes live on batches: one note each (field tasting), written like the Day Planner's notes.
    // A recipe's old notes move to its latest batch, and the dated tastings of before (entries) join their batch's note,
    // their photos going to the batch's photos. Returns true when anything changed, so the book is loaded again.
    const addToNote = (md, more) => (md?.trim() ? `${md.trim()}\n\n${more}` : more);
    async function moveTastings() {
      let moved = false;
      for (const r of data.recipes.filter(x => x.tasting?.trim())) {
        const latest = data.makes.filter(m => m.recipe_id === r.id).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created_at || '').localeCompare(a.created_at || ''))[0];
        if (!latest) continue;
        await store.update('recipe_makes', latest.id, { tasting: addToNote(latest.tasting, r.tasting.trim()) });
        await store.update('recipes', r.id, { tasting: '' });
        moved = true;
      }
      for (const m of data.makes) {
        const old = data.entries.filter(e => e.make_id === m.id && e.kind === 'tasting').sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || ''));
        if (!old.length) continue;
        const text = old.filter(e => e.text?.trim()).map(e => `${e.date ? `**${batchDay(e.date)}**  \n` : ''}${e.text.trim()}`).join('\n\n');
        if (text) await store.update('recipe_makes', m.id, { tasting: addToNote(m.tasting, text) });
        for (const e of old) {
          for (const a of (await store.list('attachments', { filter: x => x.parent_id === e.id }))) await store.update('attachments', a.id, { parent_id: m.id, parent_collection: 'recipe_makes' });
          await store.remove('recipe_entries', e.id);
        }
        moved = true;
      }
      // Batches named in 1.42 ("Mead 28 Sep 2026") get the dash ("Mead - 28 Sep 2026").
      for (const m of data.makes) {
        const title = recipeOf(m.recipe_id)?.title || 'Untitled';
        if (m.name && m.name === `${title} ${batchDay(m.date)}`) { await store.update('recipe_makes', m.id, { name: newBatchName(title, m.date) }); moved = true; }
      }
      return moved;
    }
    const render = this.render = async () => {
      await adding;
      store.useSpace(state.owner ? store.spaceOf(state.owner) : null);
      shared = await loadShared();
      if (state.owner && !shared.some(x => x.owner_id === state.owner && x.r.id === state.recipe)) { state.owner = null; store.useSpace(null); if (state.recipe) return go('#/recipes'); }
      data = await loadBook();
      if (!state.owner && await moveTastings()) data = await loadBook();
      settings = await store.getSettings();
      if (!state.owner && await isBrandNew(settings, !!signedIn())) { await setUpBooks(); data = await loadBook(); settings = await store.getSettings(); }
      // The one time wipe and the photo catch-up (examples.js), once this device has what the account already has.
      else if (!state.owner && needsWipe(settings) && (!signedIn() || syncStatus.last)) { await wipeBook(); data = await loadBook(); settings = await store.getSettings(); }
      else if (!state.owner && photosBehind(settings) && (!signedIn() || syncStatus.last)) { await addNewPhotos(); data = await loadBook(); settings = await store.getSettings(); }
      if (!state.owner && !settings.batch_units_fix) { await fixBareUnits(); data = await loadBook(); settings = await store.getSettings(); }
      atts = await att.byParent();
      sections = sectionsOf(settings, data.recipes);
      if (state.section && !pinnedTab() && !sections.some(x => x.name === state.section)) state.section = '';
      if (state.make) lists = await inMine(async () => (await loadLists()).lists);
      tasting?.flush();
      tasting = null;
      dirty = false;
      el.innerHTML = `<div class="bb">${state.make ? makePage() : state.recipe ? recipePage() : overview()}</div>`;
      if (printAfter && state.recipe && !state.make) { printAfter = false; setTimeout(() => print(), 300); }
      kitFor().attach(el.querySelector('.bb-cards'));
      batchKit.attach(el.querySelector('.bb-batch-list'));
      watchSticky();
      // Tasting notes: a batch's (or a recipe's older ones, until they move to a batch).
      const box = el.querySelector('.bb-tasting');
      const owner = state.make ? { collection: 'recipe_makes', rec: makeOf(state.make) } : state.recipe ? { collection: 'recipes', rec: recipeOf(state.recipe) } : null;
      if (box && owner?.rec) {
        const r = owner.rec;
        let pending = null;
        tasting = debounced(async () => { if (pending != null) { const md = pending; pending = null; await store.update(owner.collection, r.id, { tasting: md }); } }, 600);
        richText(box, { value: r.tasting || '', placeholder: 'How it tasted, how it turned out, what to change next time', origin: () => ({ collection: owner.collection, id: r.id, title: owner.collection === 'recipes' ? r.title : batchName(r, recipeOf(r.recipe_id)?.title), field: 'tasting' }), onChange: md => { pending = md; tasting.trigger(); } });
      }
      if (focusNext) { const f = el.querySelector(focusNext); focusNext = null; if (f) { f.focus(); f.select?.(); } }
      if (walkNext) { const w = walkNext; walkNext = null; const f = el.querySelector(w.key); if (f && !el.contains(document.activeElement)) arrive(f, w.at); }
    };
    // After a sync: redraw unless something is being written in (then when it's left).
    this.refresh = async () => { if (writing()) { dirty = true; return; } await render(); };
    el.addEventListener('focusout', () => setTimeout(() => { if (dirty && !writing()) render(); }, 0));
    const later = async () => { data = await loadBook(); if (writing()) dirty = true; else await render(); };

    // ---------- saving ----------

    const ownerOf = node => { const [collection, id] = (node.closest('[data-owner]')?.dataset.owner || '').split(':'); return { collection, id }; };
    const recOf = o => (o.collection === 'recipes' ? recipeOf(o.id) : makeOf(o.id));
    const pageRec = () => (state.make ? { collection: 'recipe_makes', id: state.make } : { collection: 'recipes', id: state.recipe });

    async function saveIngredients(o, next, label) {
      const old = recOf(o).ingredients || [];
      await store.update(o.collection, o.id, { ingredients: next });
      await later();
      if (label) undoable(label, async () => { await store.update(o.collection, o.id, { ingredients: old }); render(); });
    }
    async function saveSteps(o, next, label) {
      const rec = recOf(o);
      const old = rec.steps || null;
      await store.update(o.collection, o.id, rec.method ? { steps: next, method: '' } : { steps: next });
      data = await loadBook();
      if (label) undoable(label, async () => { await store.update(o.collection, o.id, { steps: old }); render(); });
    }

    // Diary text as it's typed: saved after a pause, and when it's left.
    const pendingText = new Map();
    const textSave = debounced(async () => {
      const all = Array.from(pendingText.values());
      pendingText.clear();
      for (const p of all) await store.update(p.collection, p.id, { [p.field]: p.value });
    }, 700);
    const queueText = (collection, id, field, value) => { pendingText.set(`${collection}:${id}:${field}`, { collection, id, field, value }); textSave.trigger(); };

    // ---------- steps ----------

    function openStep(view) {
      const ta = view.parentElement.querySelector('[data-step-text]');
      view.hidden = true;
      ta.hidden = false;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    // A step left: saved, and shown with its amounts again. An emptied step goes.
    async function closeStep(ta) {
      const row = ta.closest('[data-step]');
      if (!row || ta.hidden) return;
      const o = ownerOf(ta);
      const steps = stepsOf(recOf(o));
      const text = ta.value.trim();
      const at = steps.findIndex(x => x.id === row.dataset.step);
      if (at < 0) return;
      ta.hidden = true;
      const view = row.querySelector('[data-step-view]');
      view.hidden = false;
      if (!text && !(atts.get(steps[at].id) || []).length) { await saveSteps(o, steps.filter((x, n) => n !== at), steps[at].text ? 'Step removed' : null); return render(); } // (a new step left empty too; one with photos stays)
      if (text === steps[at].text) return;
      await saveSteps(o, steps.map((x, n) => (n === at ? Object.assign({}, x, { text }) : x)));
      view.innerHTML = stepHtml(text, recOf(o).ingredients || [], o.collection === 'recipes' ? state.times : 1, esc);
    }
    async function addStep(o, text, after = null) {
      const steps = stepsOf(recOf(o)).slice();
      const made = { id: store.uuidv7(), text };
      steps.splice(after ? steps.findIndex(x => x.id === after) + 1 : steps.length, 0, made);
      await saveSteps(o, steps);
      return made;
    }

    el.addEventListener('focusout', ev => {
      const t = ev.target;
      if (t.matches?.('[data-step-text]')) closeStep(t);
      // Something written in "Next step" and left: it's a step.
      if (t.matches?.('.bb-step-new') && t.value.trim()) { const text = t.value.trim(); t.value = ''; dirty = true; adding = addStep(ownerOf(t), text); }
      if (t.matches?.('.bb-ing-add') && t.value.trim()) { const text = t.value; t.value = ''; addIngredientLines(ownerOf(t), text, false); }
      if (t.dataset?.entryField === 'text') textSave.flush();
    });

    // A pasted list on the last ingredient line: every line becomes an ingredient.
    el.addEventListener('paste', ev => {
      const t = ev.target, text = ev.clipboardData?.getData('text') || '';
      if (!t.matches?.('.bb-ing-add') || !/\n/.test(text.trim())) return;
      ev.preventDefault();
      addIngredientLines(ownerOf(t), text);
    });

    el.addEventListener('input', ev => {
      const t = ev.target;
      if (t.matches('.bb-search')) { state.q = t.value; const at = t.selectionStart; render().then(() => { const s = el.querySelector('.bb-search'); s?.focus(); s?.setSelectionRange(at, at); }); return; }
      if (t.dataset.entryField === 'text') return queueText('recipe_entries', t.closest('[data-entry]').dataset.entry, 'text', t.value);
    });

    el.addEventListener('keydown', async ev => {
      const t = ev.target;
      if (ev.isComposing) return;
      if (t.matches?.('[data-step-view]') && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); return openStep(t); }
      if (t.matches?.('.bb-ing-add') && ev.key === 'Enter') { ev.preventDefault(); const text = t.value; t.value = ''; return addIngredientLines(ownerOf(t), text, '.bb-ing-add'); }
      if (t.matches?.('.bb-ing-add') && ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); t.value = ''; t.blur(); return; }
      if (t.matches?.('.bb-step-new') && ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        const text = t.value.trim();
        if (!text) return;
        t.value = '';
        await addStep(ownerOf(t), text);
        focusNext = '.bb-step-new';
        return render();
      }
      if (!t.matches?.('[data-step-text]')) return;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); t.blur(); return; }
      // Backspace in an empty step: it goes, and the one above opens at its end.
      if (ev.key === 'Backspace' && !t.value) {
        ev.preventDefault();
        const above = t.closest('[data-step]').previousElementSibling?.dataset.step;
        await closeStep(t);
        const view = above && el.querySelector(`[data-step="${above}"] [data-step-view]`);
        if (view) openStep(view); else el.querySelector('.bb-step-new')?.focus();
        return;
      }
      // Enter: this step is done, and the next one starts under it.
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        const o = ownerOf(t), id = t.closest('[data-step]').dataset.step;
        await closeStep(t);
        if (!stepsOf(recOf(o)).some(x => x.id === id)) return;
        const made = await addStep(o, '', id);
        await render();
        const view = el.querySelector(`[data-step="${made.id}"] [data-step-view]`);
        if (view) openStep(view);
      }
    });

    // ---------- moving between lines (as in Tasks and the Day Planner) ----------
    // ↑ / ↓ on a field's first / last line go to the line above / below: title, description, details, ingredients,
    // steps, readings, diary. Enter moves on too (amount → ingredient → the next line); Backspace in an empty
    // last line goes up. A line that saves and redraws as it's left is found again by its key (walkNext).
    let walkNext = null;
    const FIELDS = 'input:not([type="checkbox"], [type="date"], [type="file"], [type="color"]), textarea:not([hidden]), [data-step-view]:not([hidden])';
    const walkRows = () => Array.from(el.querySelectorAll('.bb-paper :is(.bb-title-row, .bb-desc, .bb-line)')).map(r => ({ row: r, fields: r.matches('textarea') ? [r] : Array.from(r.querySelectorAll(FIELDS)).filter(f => f.offsetParent) })).filter(r => r.fields.length);
    const keyOf = f => {
      const own = ['data-rec', 'data-make', 'data-ing-line', 'data-entry-field', 'data-field-key'].find(a => f.hasAttribute(a));
      const sel = own ? `[${own}="${CSS.escape(f.getAttribute(own))}"]` : f.matches('[data-step-text]') ? '[data-step-view]' : f.matches('[data-step-view]') ? '[data-step-view]' : ['bb-ing-add', 'bb-step-new', 'bb-gravity', 'bb-reading-value'].map(c => `.${c}`).find(c => f.matches(c));
      if (!sel) return null;
      const box = f.closest('[data-ing], [data-step], [data-entry]');
      return box ? `[${box.hasAttribute('data-ing') ? 'data-ing' : box.hasAttribute('data-step') ? 'data-step' : 'data-entry'}="${CSS.escape(box.dataset.ing || box.dataset.step || box.dataset.entry)}"] ${sel}` : sel;
    };
    function arrive(f, at) {
      if (f.matches('[data-step-view]')) { openStep(f); f = f.parentElement.querySelector('[data-step-text]'); }
      f.focus();
      caretTo(f, at);
    }
    function walk(from, dir) {
      const rows = walkRows();
      const i = rows.findIndex(r => r.fields.includes(from) || (from.matches('[data-step-text]') && r.row.contains(from)));
      const to = rows[i + (dir === 'up' ? -1 : 1)];
      if (i < 0 || !to) return false;
      const col = rows[i].fields.indexOf(from), last = col === rows[i].fields.length - 1 || col < 0;
      const f = last ? to.fields[to.fields.length - 1] : to.fields[Math.min(col, to.fields.length - 1)];
      const at = dir === 'up' ? 'end' : 'start';
      walkNext = { key: keyOf(f), at };
      arrive(f, at);
      if (el.contains(document.activeElement)) setTimeout(() => { walkNext = null; }, 1500); // not redrawn: nothing to find again
      return true;
    }
    el.addEventListener('pointerdown', () => { walkNext = null; }, true);
    el.addEventListener('keydown', ev => {
      const t = ev.target;
      if (ev.defaultPrevented || ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing || !t.closest?.('.bb-paper') || t.closest('.bb-note, .is-full')) return;
      if (document.querySelector('.ref-picker, .pill-menu, .ref-menu')) return;
      const field = t.matches(FIELDS) || t.matches('[data-step-text]');
      if (!field || t.matches('select')) return;
      if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && !ev.shiftKey) {
        const dir = ev.key === 'ArrowUp' ? 'up' : 'down';
        if (!t.matches('[data-step-view]') && !atEdge(t, dir)) return;
        if (walk(t, dir)) ev.preventDefault();
        return;
      }
      // Enter: an amount goes on to its ingredient, anything else one-line to the line below.
      if (ev.key === 'Enter' && !ev.shiftKey && t.matches('input') && !t.matches('.bb-ing-add')) {
        ev.preventDefault();
        if (t.dataset.ingLine === 'amount') { const x = t.closest('.bb-line').querySelector('[data-ing-line="text"]'); walkNext = { key: keyOf(x), at: 'end' }; arrive(x, 'end'); }
        else walk(t, 'down');
        return;
      }
      if (ev.key === 'Backspace' && !t.value && t.matches('.bb-ing-add, .bb-step-new') && walk(t, 'up')) ev.preventDefault();
      if (ev.key === 'Escape' && !t.matches('[data-step-text], .bb-ing-add')) { ev.preventDefault(); ev.stopPropagation(); t.blur(); }
    }, true);

    el.addEventListener('change', async ev => {
      const t = ev.target;
      const page = pageRec();
      if (t.dataset.rec) {
        const r = recipeOf(state.recipe);
        const field = t.dataset.rec;
        const value = field === 'tags' ? t.value.split(',').map(x => x.trim()).filter(Boolean) : t.value.trim();
        if (field === 'title' && !value) { t.value = r.title; toast('A recipe needs a name, so it was put back'); return; }
        const old = r[field] ?? (field === 'tags' ? [] : '');
        if (JSON.stringify(value) === JSON.stringify(old)) return;
        await store.update('recipes', r.id, { [field]: value });
        await later();
        undoable('Saved', async () => { await store.update('recipes', r.id, { [field]: old }); render(); });
        return;
      }
      if (t.matches('[data-rec-section]')) {
        const r = recipeOf(state.recipe);
        if (t.value === '__edit') { t.value = r.type || ''; return editSections(); }
        const fields = Object.assign({}, r.fields);
        for (const k of sectionOf(sections, t.value).fields) if (!(k in fields)) fields[k] = '';
        await store.update('recipes', r.id, { type: t.value, fields });
        return render();
      }
      if (t.dataset.fieldKey) {
        const rec = recOf(page);
        await store.update(page.collection, page.id, { fields: Object.assign({}, rec.fields, { [t.dataset.fieldKey]: t.value.trim() }) });
        return later();
      }
      if (t.matches('[data-batch-list]')) return moveToList(t.value || null);
      if (t.matches('[data-batch-sort]')) { settings.batch_sort = t.value; await store.updateSettings({ batch_sort: t.value }); return render(); }
      if (t.dataset.make) {
        await store.update('recipe_makes', state.make, { [t.dataset.make]: t.type === 'checkbox' ? t.checked : t.value.trim() });
        return later();
      }
      if (t.dataset.ingLine) return saveIngLine(t);
      if (t.dataset.entryField) {
        const id = t.closest('[data-entry]').dataset.entry;
        const f = t.dataset.entryField;
        if (f === 'text') { await textSave.flush(); return; }
        let value = t.value.trim();
        if (f === 'gravity') {
          value = parseQty(value);
          if (value != null && value > 100) value /= 1000; // typed as 1050
          if (value == null && t.value.trim()) { toast('A gravity is a number like 1.050'); return render(); }
        }
        await store.update('recipe_entries', id, { [f]: value });
        return later();
      }
    });

    // ---------- pressing things ----------

    // Press and hold a recipe card: it's selected (as a tap on its ⠿ does) and the bar comes up; while
    // anything is selected, a single press on another card adds it or takes it out. Esc clears (listkit).
    let hold = null, held = false;
    const cardAt = t => (t.closest?.('.bb-card-acts, .kit-grip') ? null : t.closest?.('.bb-cards > li[data-id]'));
    el.addEventListener('pointerdown', ev => {
      const li = cardAt(ev.target);
      if (!li || ev.button > 0) return;
      held = false;
      const from = { x: ev.clientX, y: ev.clientY };
      clearTimeout(hold?.timer);
      hold = { li, from, timer: setTimeout(() => { held = true; kit.toggle(li.dataset.id); navigator.vibrate?.(15); }, 450) };
    });
    const letGo = () => { clearTimeout(hold?.timer); hold = null; };
    el.addEventListener('pointermove', ev => { if (hold && Math.hypot(ev.clientX - hold.from.x, ev.clientY - hold.from.y) > 8) letGo(); });
    el.addEventListener('pointerup', letGo);
    el.addEventListener('pointercancel', letGo);
    el.addEventListener('contextmenu', ev => { if (cardAt(ev.target)) ev.preventDefault(); });
    el.addEventListener('click', ev => {
      const li = cardAt(ev.target);
      if (!li || !(held || kit?.size)) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (held) { held = false; return; } // the hold already chose it
      kit.toggle(li.dataset.id, ev.shiftKey); // Shift: every card from the last one picked to this one
    }, true);

    // Pressing an ingredient chip keeps the cursor in the step being written.
    el.addEventListener('mousedown', ev => { if (ev.target.closest('[data-ref]')) ev.preventDefault(); });

    const attParent = b => {
      const e = b.closest('[data-entry]');
      if (e) return { collection: 'recipe_entries', id: e.dataset.entry };
      const s = b.closest('[data-step]');
      if (s) return { collection: ownerOf(s).collection, id: s.dataset.step };
      return pageRec();
    };

    // While batches are selected, pressing a row adds it or takes it out (Shift: every row from the last one picked).
    const openRow = (row, ev) => { const li = row.closest('li[data-id]'); if (!batchKit.size) go(row.dataset.href); else if (li) batchKit.toggle(li.dataset.id, !!ev?.shiftKey); };
    el.addEventListener('keydown', ev => { const row = ev.target.closest?.('.bb-batch-row[data-href]'); if (row && ev.key === 'Enter') openRow(row); });
    el.addEventListener('click', async ev => {
      // A batch's status pill: Planned / On the go / Done, changed in place.
      const pill = ev.target.closest('[data-batch-status]');
      if (pill) {
        const m = makeOf(pill.dataset.batchStatus);
        return pillMenu(pill, STATUSES.map(([v, l]) => ({ value: v, label: statusLabel(v), current: v === (m.status || 'going') })), v => changeBatches([m.id], { status: v }, `Marked ${STATUSES.find(x => x[0] === v)[1].toLowerCase()}`), { className: 'word-menu' });
      }
      const row = ev.target.closest('.bb-batch-row[data-href]');
      if (row) return openRow(row, ev);
      if (att.onClick(ev, attParent, () => render())) return;
      const view = ev.target.closest('[data-step-view]');
      if (view && !ev.target.closest('a')) return openStep(view);
      const b = ev.target.closest('button, [data-act]');
      if (!b) return;
      if (b.dataset.bbPaper) {
        settings.batch_paper = b.dataset.bbPaper;
        for (const p of el.querySelectorAll('.bb-paper')) p.dataset.paper = b.dataset.bbPaper;
        for (const x of el.querySelectorAll('[data-bb-paper]')) x.setAttribute('aria-pressed', String(x.dataset.bbPaper === b.dataset.bbPaper));
        await store.updateSettings({ batch_paper: b.dataset.bbPaper });
        return;
      }
      if (b.closest('.view-settings')) return;
      if (b.matches('a[href="#"]')) ev.preventDefault();
      b.closest('details')?.removeAttribute('open');
      const page = pageRec();
      if (b.dataset.section !== undefined) { state.section = b.dataset.section; state.tag = ''; return render(); }
      if (b.dataset.status !== undefined) { state.status = b.dataset.status; return render(); }
      if (b.dataset.card || b.dataset.cardBook !== undefined) return cardAction(b);
      if (b.dataset.tag !== undefined) { state.tag = state.tag === b.dataset.tag ? '' : b.dataset.tag; return render(); }
      if (b.dataset.mode) { state.batches = b.dataset.mode === 'batches'; return render(); }
      if (b.dataset.scale) { state.times = +b.dataset.scale; return render(); }
      if (b.dataset.rescale) return rescale(b.dataset.rescale);
      if (b.dataset.ref) {
        const ta = document.activeElement?.closest?.('.bb-steps textarea') ? document.activeElement : el.querySelector('.bb-step-new');
        if (!ta) return;
        const at = ta.selectionStart ?? ta.value.length;
        ta.setRangeText(`{${b.dataset.ref}}`, at, ta.selectionEnd ?? at, 'end');
        ta.focus();
        return;
      }
      if (b.dataset.stock) return setStock(b.closest('[data-ing]').dataset.ing, b.dataset.stock);
      if (b.dataset.stepPhoto !== undefined) return att.pick(attParent(b), () => render());
      if (b.dataset.fieldRemove) {
        const rec = recOf(page);
        const fields = Object.assign({}, rec.fields);
        delete fields[b.dataset.fieldRemove];
        const old = rec.fields;
        await store.update(page.collection, page.id, { fields });
        await render();
        undoable(`Removed ${b.dataset.fieldRemove}`, async () => { await store.update(page.collection, page.id, { fields: old }); render(); });
        return;
      }
      if (b.dataset.addEntry) {
        const made = await store.create('recipe_entries', { make_id: state.make, recipe_id: makeOf(state.make)?.recipe_id, kind: b.dataset.addEntry, date: today(), text: '' });
        focusNext = `[data-entry="${made.id}"] textarea`;
        return render();
      }
      if (b.dataset.entryPhoto !== undefined) return att.pick(attParent(b), () => render());
      if (b.dataset.entryRemove !== undefined) {
        const id = b.closest('[data-entry]').dataset.entry;
        await store.remove('recipe_entries', id);
        await render();
        undoable('Removed', async () => { await store.restore('recipe_entries', id); render(); });
        return;
      }
      const act = b.dataset.act;
      if (act === 'home') return go('#/recipes');
      if (act === 'share-list') { const list = lists.find(l => l.id === makeOf(state.make)?.list_id); if (list) shareSheet({ kind: 'list', id: list.id, name: list.name || 'Untitled' }, `"${list.name || 'Untitled'}"`); return; }
      if (act === 'new') return newRecipe();

      if (act === 'sections') return editSections();
      if (act === 'import') return importRecipes();
      if (act === 'to-recipe') return go(`#/recipes/${makeOf(state.make)?.recipe_id || ''}${ownerPath()}`);
      if (act === 'add-field') {
        const name = (await askText('Add a detail', { placeholder: 'e.g. Oven temperature, Yeast, Serves', ok: 'Add' }))?.trim();
        if (!name) return;
        const rec = recOf(page);
        await store.update(page.collection, page.id, { fields: Object.assign({}, rec.fields, { [name]: (rec.fields || {})[name] || '' }) });
        focusNext = `[data-field-key="${CSS.escape(name)}"]`;
        return render();
      }
      if (act === 'examples') { b.disabled = true; await addExamples(); toast('Added example recipes: change or delete them as you like'); return render(); }
      if (act === 'make') return makeThis(recipeOf(state.recipe));
      if (act === 'reading') {
        const type = b.dataset.type || 'Gravity', grav = isGravity(type);
        const made = await store.create('recipe_entries', Object.assign({ make_id: state.make, recipe_id: makeOf(state.make)?.recipe_id, kind: 'reading', type, date: today(), text: '' },
          grav ? { label: entriesOf(state.make, 'reading').some(e => isGravity(e.type)) ? 'SG' : 'OG', gravity: null } : { value: '' }));
        focusNext = `[data-entry="${made.id}"] ${grav ? '.bb-gravity' : '.bb-reading-value'}`;
        return render();
      }
      if (act === 'archive-recipe' || act === 'delete-recipe') return retire(recipeOf(state.recipe), act === 'delete-recipe' ? 'deleted_at' : 'archived_at');
      if (act === 'delete-make') {
        const m = makeOf(state.make);
        await store.remove('recipe_makes', m.id);
        go(`#/recipes/${m.recipe_id}${ownerPath()}`);
        undoable(`Deleted ${batchName(m, recipeOf(m.recipe_id)?.title)}`, async () => { await store.restore('recipe_makes', m.id); render(); });
      }
    });

    async function addIngredientLines(o, text, focus = '.bb-ing-add') {
      const made = text.split('\n').map(parseLine).filter(Boolean);
      if (!made.length) return;
      if (focus) focusNext = focus;
      await saveIngredients(o, (recOf(o).ingredients || []).concat(made), `Added ${made.length} ingredient${made.length === 1 ? '' : 's'}`);
      await render();
    }

    // One ingredient changed on the lines: "250g", "2 tsp", "pinch" in the margin; "butter, unsalted" beside it.
    // A recipe shown ×2 stores what was typed ÷ 2. Emptying the ingredient removes it.
    async function saveIngLine(t) {
      const o = ownerOf(t), rec = recOf(o), id = t.closest('[data-ing]').dataset.ing;
      const ing = rec.ingredients.find(i => i.id === id), value = t.value.trim();
      const times = o.collection === 'recipes' ? state.times : 1;
      if (t.dataset.ingLine === 'amount') {
        const low = value.toLowerCase();
        const unitOnly = UNITS.find(u => u[0] && (u[0] === low || u[1].toLowerCase() === low || (u[4] || []).includes(low)));
        const got = !value ? { qty: null, unit: '' } : unitOnly ? { qty: null, unit: unitOnly[0] } : parseLine(`${value} ~`);
        if (value && !unitOnly && (got.qty == null || got.item !== '~')) { toast('That amount wasn\'t understood: try 250g, 2 tsp or ½'); t.value = amountText(ing, times); return; }
        return saveIngredients(o, rec.ingredients.map(i => (i.id === id ? Object.assign({}, i, { qty: got.qty == null ? null : got.qty / times, unit: got.unit }) : i)));
      }
      if (!value) return saveIngredients(o, rec.ingredients.filter(i => i.id !== id), `Removed ${ing.item || 'an ingredient'}`);
      const comma = value.indexOf(',');
      const item = (comma < 0 ? value : value.slice(0, comma)).trim(), note = comma < 0 ? '' : value.slice(comma + 1).trim();
      // Renamed: the steps that mention it follow.
      if (ing.item && item && item !== ing.item) {
        const steps = stepsOf(rec);
        const renamed = steps.map(x => Object.assign({}, x, { text: renameRefs(x.text, ing.item, item) }));
        if (renamed.some((x, n) => x.text !== steps[n].text)) await saveSteps(o, renamed);
      }
      return saveIngredients(o, rec.ingredients.map(i => (i.id === id ? Object.assign({}, i, { item, note }) : i)));
    }

    // Every amount in this batch times a number (the recipe itself stays as it is).
    async function rescale(how) {
      const m = makeOf(state.make);
      let times = +how;
      if (how === 'ask') {
        const got = await askText('Scale every amount', { placeholder: 'e.g. 1.5 or 3/4', ok: 'Scale', text: 'Every ingredient\'s amount in this batch is multiplied by this.' });
        times = parseQty(got);
        if (!times || times <= 0) { if (got) toast('That wasn\'t a number'); return; }
      }
      await saveIngredients({ collection: 'recipe_makes', id: m.id }, m.ingredients.map(i => Object.assign({}, i, { qty: i.qty == null ? null : i.qty * times })), `Scaled ×${qtyText(times)}`);
      await render();
    }

    async function newRecipe() {
      const section = (!pinnedTab() && state.section) || sections[0]?.name || '';
      const fields = Object.fromEntries(sectionOf(sections, section).fields.map(k => [k, '']));
      const r = await store.create('recipes', { title: 'New recipe', type: section, tags: [], description: '', ingredients: [], steps: [], fields });
      focusNext = '.bb-title';
      go(`#/recipes/${r.id}`);
      undoable('New recipe', async () => { await store.remove('recipes', r.id); go('#/recipes'); });
    }

    // A batch starts as a copy of the recipe (at the scale shown), with its step photos, to change freely.
    async function makeThis(r, owner = state.owner, times = state.times) {
      store.useSpace(owner ? store.spaceOf(owner) : null);
      const steps = stepsOf(r).map(x => ({ id: store.uuidv7(), text: x.text, from: x.id }));
      const m = await store.create('recipe_makes', {
        recipe_id: r.id, name: newBatchName(r.title, today()), batch_no: nextBatchNo(data.makes, data.recipes, r.type), date: today(), status: 'going',
        description: r.description || '', state: '', back_sweetened: false, fields: Object.assign({}, r.fields),
        ingredients: (r.ingredients || []).map(i => Object.assign({}, i, { qty: i.qty == null ? null : i.qty * times })), steps, stock: {}, list_id: null,
      });
      // The same files, not copies: a second record points at each one.
      for (const x of steps) {
        for (const a of atts.get(x.from) || []) await store.create('attachments', { parent_collection: 'recipe_makes', parent_id: x.id, blob_id: a.blob_id, name: a.name, mime: a.mime, kind: a.kind, size: a.size, thumb: a.thumb });
      }
      go(`#/recipes/${r.id}/make/${m.id}${ownerPath(owner)}`);
      undoable(`Started ${m.name}`, async () => { store.useSpace(owner ? store.spaceOf(owner) : null); await store.remove('recipe_makes', m.id); go(`#/recipes/${r.id}${ownerPath(owner)}`); });
    }

    // ---------- importing ----------
    // Recipes as text, pasted or from a file (format in batchbook.js). The AI prompt lets anyone turn notes, photos
    // of cards or web pages into that text with any AI chat. Books not set up yet are added.
    const AI_PROMPT = `Turn the recipes I give you into plain text in exactly this format, one after another, keeping every recipe and all its details. Put each ingredient on its own line, amount and unit first, and make sure every ingredient the method uses is in the list. In the method, write each ingredient as its name from the list in curly brackets, without its amount: {flour} for all of it, {1/2 flour} for half (any fraction or percentage), or {flour|sifted flour} for your own words (the app puts the amount in front; own words that already say how much, like {flour|a little flour}, show as written); the app shows the amount and scales it. Put each recipe in a sensible book (for example Cooking, Soups, Baking or Cocktails). Reply with just the recipes.\n\n${IMPORT_EXAMPLE}`;
    async function importRecipes() {
      const dlg = document.createElement('dialog');
      dlg.className = 'sheet bb-import-sheet';
      dlg.innerHTML = `<div class="sheet-handle"></div>
        <h2>Import recipes</h2>
        <p class="muted">Paste recipes below or choose a text file. Each starts with <b># and its name</b>, then its ingredients and method. Recipes somewhere else, in notes, photos or on websites? Copy the instructions, paste them into any AI chat with your recipes, then paste its answer here.</p>
        <div class="sheet-actions"><button type="button" data-imp="prompt">📋 Copy instructions for an AI chat</button><label class="file-btn">Choose a file…<input type="file" accept=".md,.txt,text/plain,text/markdown" hidden></label></div>
        <textarea class="bb-import-text no-inline" rows="10" placeholder="${esc(IMPORT_EXAMPLE.split('\n').slice(0, 9).join('\n'))}\n…" aria-label="Recipes to import"></textarea>
        <p class="muted bb-import-found"></p>
        <div class="sheet-actions"><button type="button" data-imp="cancel">Cancel</button><span class="spacer"></span><button type="button" class="primary" data-imp="go" disabled>Import</button></div>`;
      document.body.append(dlg);
      const box = dlg.querySelector('textarea'), found = dlg.querySelector('.bb-import-found'), go = dlg.querySelector('[data-imp="go"]');
      let got = [];
      const read = () => {
        got = parseRecipes(box.value);
        const books = Array.from(new Set(got.map(r => r.type || 'No book')));
        found.textContent = got.length ? `${got.length} recipe${got.length === 1 ? '' : 's'} found, in ${books.join(', ')}` : box.value.trim() ? 'No recipes found: each needs a line starting with # and its name.' : '';
        go.disabled = !got.length;
      };
      box.addEventListener('input', read);
      dlg.querySelector('input[type=file]').addEventListener('change', async ev => { const f = ev.target.files[0]; if (f) { box.value = await f.text(); read(); } });
      dlg.addEventListener('click', async ev => {
        const b = ev.target.closest('[data-imp]');
        if (!b) return;
        if (b.dataset.imp === 'cancel') return dlg.close();
        if (b.dataset.imp === 'prompt') { try { await navigator.clipboard.writeText(AI_PROMPT); toast('Copied: paste it into an AI chat with your recipes'); } catch { toast('Couldn\'t copy here'); } return; }
        go.disabled = true;
        const known = settings.batch_sections || sections.filter(x => !x.auto).map(x => ({ name: x.name, emoji: x.emoji, colour: x.colour, fields: x.fields, readings: !!x.readings, reading_types: x.reading_types || [] }));
        const added = Array.from(new Set(got.map(r => r.type).filter(t => t && !known.some(x => x.name === t)))).map(name => { const x = sectionOf(sections, name); return { name, emoji: x.emoji, colour: x.colour, fields: [], readings: x.readings }; });
        if (added.length) await store.updateSettings({ batch_sections: known.concat(added) });
        const made = [];
        const have = new Set(data.recipes.map(r => r.title.toLowerCase()));
        for (const r of got) if (!have.has(r.title.toLowerCase())) made.push(await store.create('recipes', Object.assign(r, { fields: Object.assign(Object.fromEntries(sectionOf(sections, r.type).fields.map(k => [k, ''])), r.fields) })));
        dlg.close();
        undoable(`Imported ${made.length} recipe${made.length === 1 ? '' : 's'}${got.length > made.length ? ` (${got.length - made.length} already here, left as they were)` : ''}`, async () => { for (const r of made) await store.remove('recipes', r.id); if (added.length) await store.updateSettings({ batch_sections: known }); render(); });
      });
      dlg.addEventListener('close', () => { dlg.remove(); render(); });
      dlg.showModal();
      box.focus();
    }

    // ---------- books ----------
    // Your own books: a name, an emoji, a colour, the details its new recipes start with, and
    // whether its batches have gravity readings. A renamed book takes its recipes with it.
    async function editSections() {
      let own = sections.filter(x => !x.auto).map(x => ({ was: x.name, name: x.name, emoji: x.emoji, colour: x.colour, fields: x.fields.slice(), readings: !!x.readings, reading_types: (x.reading_types || []).slice() }));
      const dlg = document.createElement('dialog');
      dlg.className = 'sheet bb-sections-sheet';
      document.body.append(dlg);
      const row = (x, n) => `<li class="bb-sec-row" data-i="${n}">
        <button type="button" class="drag-handle bb-sec-grip" aria-label="Move ${esc(x.name || 'book')} up or down" title="Drag to move">${icon('i-grip')}</button>
        <input class="bb-sec-emoji" data-k="emoji" value="${esc(x.emoji)}" aria-label="Emoji" maxlength="8">
        <input class="bb-sec-name" data-k="name" value="${esc(x.name)}" placeholder="Name, e.g. Baking" aria-label="Book name">
        <input type="color" data-k="colour" value="${esc(x.colour)}" aria-label="Colour">
        <button type="button" class="icon-btn bb-x" data-sec-remove="${n}" aria-label="Remove book">×</button>
        <input class="bb-sec-fields" data-k="fields" value="${esc(x.fields.join(', '))}" placeholder="Details its recipes have, e.g. Serves, Oven temperature" aria-label="Details">
        <label class="bb-sec-readings"><input type="checkbox" data-k="readings" ${x.readings ? 'checked' : ''}> Batches have readings</label>
        <input class="bb-sec-types" data-k="reading_types" value="${esc((x.reading_types.length ? x.reading_types : ['Gravity']).join(', '))}" placeholder="Kinds of reading, e.g. Gravity, Temperature" aria-label="Kinds of reading" ${x.readings ? '' : 'hidden'}>
      </li>`;
      const draw = () => {
        dlg.innerHTML = `<div class="sheet-handle"></div>
          <h2>Books</h2>
          <p class="muted">Each recipe goes in one book. Sort them however suits you: by what they are, where they're from, or when you make them. Tags on a recipe sort them further. Drag a book by ⠿ to change the order.</p>
          <ul class="bb-sec-list">${own.map(row).join('')}</ul>
          <button type="button" data-sec-add>+ Add a book</button>
          <div class="sheet-actions"><button type="button" data-sec-cancel>Cancel</button><span class="spacer"></span><button type="button" class="primary" data-sec-save>Save</button></div>`;
        // Drag a book by its grip to change the order (the books bar follows once saved).
        sortable(dlg.querySelector('.bb-sec-list'), { onEnd() { read(); own = Array.from(dlg.querySelectorAll('.bb-sec-row')).map(r => own[+r.dataset.i]); draw(); } });
      };
      const read = () => {
        for (const r of dlg.querySelectorAll('.bb-sec-row')) {
          const x = own[+r.dataset.i];
          x.emoji = r.querySelector('[data-k="emoji"]').value.trim() || '📖';
          x.name = r.querySelector('[data-k="name"]').value.trim();
          x.colour = r.querySelector('[data-k="colour"]').value;
          x.fields = r.querySelector('[data-k="fields"]').value.split(',').map(s => s.trim()).filter(Boolean);
          x.readings = r.querySelector('[data-k="readings"]').checked;
          x.reading_types = r.querySelector('[data-k="reading_types"]').value.split(',').map(s => s.trim()).filter(Boolean);
        }
      };
      dlg.addEventListener('change', ev => { if (ev.target.dataset.k === 'readings') ev.target.closest('.bb-sec-row').querySelector('[data-k="reading_types"]').hidden = !ev.target.checked; });
      dlg.addEventListener('click', async ev => {
        const b = ev.target.closest('button');
        if (!b) return;
        if (b.dataset.secAdd !== undefined) { read(); own.push({ was: null, name: '', emoji: '📖', colour: '#7a6a55', fields: [], readings: false, reading_types: [] }); draw(); dlg.querySelector('.bb-sec-row:last-child .bb-sec-name').focus(); return; }
        if (b.dataset.secRemove) { read(); own.splice(+b.dataset.secRemove, 1); draw(); return; }
        if (b.dataset.secCancel !== undefined) return dlg.close();
        if (b.dataset.secSave !== undefined) {
          read();
          const keep = own.filter(x => x.name);
          if (new Set(keep.map(x => x.name)).size !== keep.length) { toast('Two books have the same name'); return; }
          const moved = keep.filter(x => x.was && x.was !== x.name);
          for (const x of moved) await store.updateMany('recipes', data.recipes.filter(r => (r.type || '') === x.was).map(r => [r.id, { type: x.name }]));
          await store.updateSettings({ batch_sections: keep.map(x => ({ name: x.name, emoji: x.emoji, colour: x.colour, fields: x.fields, readings: x.readings && x.reading_types.length > 0, reading_types: x.reading_types })) });
          const followed = moved.find(x => x.was === state.section);
          if (followed) state.section = followed.name;
          dlg.close();
          toast('Books saved');
        }
      });
      dlg.addEventListener('close', () => { dlg.remove(); render(); });
      draw();
      dlg.showModal();
    }

    // ---------- a card's Make and More ----------

    // Recipes others share with you, from each person's space (store.js).
    async function loadShared() {
      const out = [];
      for (const p of people(['recipe'])) {
        const ids = new Set(p.shares.map(sh => sh.info.id));
        for (const r of await store.spaceOf(p.owner_id).list('recipes', { filter: x => ids.has(x.id) && !x.archived_at })) out.push({ r, owner_id: p.owner_id, name: p.name });
      }
      return out;
    }

    // The recipe as plain text: name, ingredients, numbered steps (amounts filled in).
    function recipeText(r) {
      const div = document.createElement('div');
      const ings = r.ingredients || [];
      const steps = stepsOf(r).map((x, n) => { div.innerHTML = stepHtml(x.text, ings, 1, esc); return `${n + 1}. ${div.textContent.trim()}`; });
      return [r.title || 'Untitled', r.description || '', '', ings.length ? 'Ingredients' : '', ...ings.map(i => `- ${ingredientText(i)}${i.note ? ` (${i.note})` : ''}`), '', steps.length ? 'Steps' : '', ...steps].filter((x, n, all) => x || (all[n - 1] && n < all.length - 1)).join('\n').trim();
    }

    async function cardAction(b) {
      const li = b.closest('.bb-card-li');
      const owner = li.dataset.from || null;
      const id = li.dataset.id || li.dataset.rid;
      const r = owner ? shared.find(x => x.owner_id === owner && x.r.id === id)?.r : recipeOf(id);
      if (!r) return;
      const act = b.dataset.card;
      if (b.dataset.cardBook !== undefined) return moveRecipes([id], { type: b.dataset.cardBook }, `Moved to ${b.dataset.cardBook || 'No book'}`);
      if (act === 'make') return makeThis(r, owner, 1);
      if (act === 'pin') return moveRecipes([id], { pinned: !r.pinned }, r.pinned ? 'Unpinned' : 'Pinned');
      if (act === 'copy') {
        try { await navigator.clipboard.writeText(recipeText(r)); toast('Copied the recipe'); } catch { toast('Couldn\'t copy here'); }
        return;
      }
      if (act === 'share') {
        // Its diary and readings go with it: each needs to say which recipe it's from.
        const kids = new Set(makesOf(id).map(m => m.id));
        const loose = data.entries.filter(e => kids.has(e.make_id) && e.recipe_id !== id);
        if (loose.length) await store.updateMany('recipe_entries', loose.map(e => [e.id, { recipe_id: id }]));
        return shareSheet({ kind: 'recipe', id, name: r.title }, `"${r.title || 'Untitled'}"`);
      }
      if (act === 'dup') {
        const copy = { title: `${r.title || 'Untitled'}${owner ? '' : ' (copy)'}`, type: r.type || '', tags: (r.tags || []).slice(), description: r.description || '', ingredients: (r.ingredients || []).map(i => Object.assign({}, i)), steps: stepsOf(r).map(x => ({ id: store.uuidv7(), text: x.text })), tasting: r.tasting || '', fields: Object.assign({}, r.fields), colour: r.colour || null };
        const made = await inMine(() => store.create('recipes', copy));
        if (!owner) await placeAfter(made, r);
        toast(owner ? `"${copy.title}" is now in your own recipes too` : 'Duplicated', { action: 'Open', onAction: () => go(`#/recipes/${made.id}`) });
        return render();
      }
      if (act === 'print') { printAfter = true; return go(`#/recipes/${id}${ownerPath(owner)}`); }
      if (act === 'colour') {
        const book = sectionFor(r).colour;
        return pillMenu(li.querySelector('.bb-card-menu summary'), [{ value: '', label: `<span class="swatch" style="--sw:${book}"></span>`, title: 'The book\'s colour', current: !r.colour }].concat(TINTS.map(c => ({ value: c.id, label: `<span class="swatch" style="--sw:${c.hex}"></span>`, title: c.label, current: c.id === r.colour }))),
          v => moveRecipes([id], { colour: v || null }, 'Colour changed'), { className: 'colour-menu' });
      }
      if (act === 'archive' || act === 'delete') return retire(r, act === 'delete' ? 'deleted_at' : 'archived_at');
    }
    // Archive or delete a recipe, and its batches with it.
    async function retire(r, field) {
      const stamp = now();
      const kids = makesOf(r.id).map(m => m.id);
      if (field === 'deleted_at' && kids.length && !(await askYes(`Delete "${r.title}" and its ${kids.length} batch${kids.length === 1 ? '' : 'es'}?`, { ok: 'Delete', danger: true, text: 'They go to the Bin for 30 days.' }))) return;
      await store.updateMany('recipe_makes', kids.map(id => [id, { [field]: stamp }]));
      await store.update('recipes', r.id, { [field]: stamp });
      if (state.recipe) go('#/recipes'); else await render();
      undoable(`${field === 'deleted_at' ? 'Deleted' : 'Archived'} "${r.title}"`, async () => {
        await store.update('recipes', r.id, { [field]: null });
        await store.updateMany('recipe_makes', kids.map(id => [id, { [field]: null }]));
        render();
      });
    }
    // A duplicate sits just after the recipe it came from.
    async function placeAfter(made, r) {
      const rows = shown().filter(x => (x.type || '') === (r.type || '') && x.id !== made.id);
      rows.splice(rows.findIndex(x => x.id === r.id) + 1, 0, made);
      const writes = reorderWrites(rows, rankOfRecipe, [made.id]);
      if (writes.length) await store.updateMany('recipes', writes.map(([x, k]) => [x.id, { rank: k }]));
    }
    let printAfter = false;

    // The bar at the top stays while the recipes scroll; with a glass background once it's stuck.
    // Each book's heading sticks just under it (--bb-stick: how far down that is).
    function watchSticky() {
      this.stickWatch?.disconnect();
      const bar = el.querySelector('.bb-sticky');
      if (!bar) return;
      const mark = el.querySelector('.bb-sticky-mark');
      const place = () => el.style.setProperty('--bb-stick', `${(parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight}px`);
      const seen = new IntersectionObserver(([e]) => { bar.classList.toggle('stuck', !e.isIntersecting && e.boundingClientRect.top < 200); place(); }, { rootMargin: `-${parseFloat(getComputedStyle(bar).top) || 0}px 0px 0px 0px` });
      seen.observe(mark);
      const size = new ResizeObserver(place);
      size.observe(bar);
      // The next book's heading pushes the stuck one up and out (not over it); a heading gets its glass only while stuck.
      const heads = Array.from(el.querySelectorAll('.bb-cards > .bb-chapter-title'));
      let queued = 0;
      const push = () => {
        queued = 0;
        const top = parseFloat(el.style.getPropertyValue('--bb-stick')) || 0;
        bar.classList.toggle('joined', heads.some(h => h.getBoundingClientRect().top <= top + 0.5 && scrollY > 0));
        heads.forEach((h, n) => {
          h.style.transform = ''; h.style.opacity = '';
          const box = h.getBoundingClientRect(), next = heads[n + 1]?.getBoundingClientRect();
          const stuck = box.top <= top + 0.5 && scrollY > 0;
          h.classList.toggle('stuck', stuck);
          // (fading as it goes, so it doesn't show through the glass bar above)
          if (stuck && next && next.top < box.bottom) { h.style.transform = `translateY(${next.top - box.bottom}px)`; h.style.opacity = String(Math.max(0, 1 - (box.bottom - next.top) / box.height)); }
        });
      };
      const onScroll = () => { if (!queued) queued = requestAnimationFrame(push); };
      addEventListener('scroll', onScroll, { passive: true });
      this.stickWatch = { disconnect: () => { seen.disconnect(); size.disconnect(); removeEventListener('scroll', onScroll); } };
      place();
      push();
    }
    watchSticky = watchSticky.bind(this);

    // ---------- what's in stock ----------
    // Each ingredient of a batch: In stock, or Add to list (onto the batch's list; the first one
    // makes a new list, unless you picked one you have). Pressing either again takes it back off.
    const itemText = i => ingredientText(i) + (i.note ? ` (${i.note})` : '');
    async function addToList(listId, ings) {
      const have = (await store.list('list_items', { filter: x => x.list_id === listId && !x.archived_at })).sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0));
      return addItems(listId, ings.map(i => ({ text: itemText(i), sub: false })), nestItems(have));
    }
    async function setStock(ingId, how) {
      const m = await store.get('recipe_makes', state.make);
      const stock = Object.assign({}, m.stock), items = Object.assign({}, m.stock_items);
      const was = stock[ingId];
      const patch = {};
      if (items[ingId]) { await inMine(() => store.remove('list_items', items[ingId])); delete items[ingId]; }
      if (was === how) delete stock[ingId]; else stock[ingId] = how;
      if (stock[ingId] === 'need') {
        let list = m.list_id && lists.find(l => l.id === m.list_id);
        if (!list) { list = await inMine(() => createList({ name: batchListName(m), kind: 'list' })); patch.list_id = list.id; }
        const made = await inMine(() => addToList(list.id, [m.ingredients.find(i => i.id === ingId)]));
        items[ingId] = made[0].id;
        if (patch.list_id) toast(`Created the shopping list "${list.name}" in Lists`, { action: 'Open it', onAction: () => { location.hash = `#/lists/${list.id}`; } });
      }
      await store.update('recipe_makes', m.id, Object.assign(patch, { stock, stock_items: items }));
      if (patch.list_id) lists = await inMine(async () => (await loadLists()).lists);
      await later();
    }
    // Another list chosen: what's already been added moves over to it.
    async function moveToList(listId) {
      const m = await store.get('recipe_makes', state.make);
      const items = Object.assign({}, m.stock_items);
      const ings = (m.ingredients || []).filter(i => items[i.id] && (m.stock || {})[i.id] === 'need');
      await inMine(async () => { for (const i of ings) await store.remove('list_items', items[i.id]); });
      let target = listId;
      if (!target && ings.length) target = (await inMine(() => createList({ name: batchListName(m), kind: 'list' }))).id;
      if (target && ings.length) { const made = await inMine(() => addToList(target, ings)); ings.forEach((i, n) => { items[i.id] = made[n].id; }); }
      await store.update('recipe_makes', m.id, { list_id: target || null, stock_items: items });
      lists = await inMine(async () => (await loadLists()).lists);
      await render();
    }

    // ---------- dragging cards ----------
    // Like Brain Dump: hold ⠿ and move. Only moved recipes get a new place (order.js). Dropped under
    // another book's heading (on All), a recipe moves to that book. The bar's Move to lists the books.
    let kit = null, kitBooks = '';
    const kitFor = () => {
      const names = sections.map(x => x.name).join('\n');
      if (kit && kitBooks === names) return kit;
      kit?.destroy();
      kitBooks = names;
      kit = this.kit = createListKit({
        reorder: true, grid: true, noun: 'recipe', onReorder: persistOrder,
        actions: sections.map((x, n) => ({ id: `book${n}`, label: `${x.emoji} ${x.name || 'No book'}`, group: 'Move to', run: ids => moveRecipes(ids, { type: x.name }, `Moved to ${x.name || 'No book'}`) }))
          .concat([
            { id: 'pin', label: 'Pin', run: ids => moveRecipes(ids, { pinned: true }, 'Pinned') },
            { id: 'unpin', label: 'Unpin', run: ids => moveRecipes(ids, { pinned: false }, 'Unpinned') },
            { id: 'archive', label: 'Archive', key: 'A', run: ids => moveRecipes(ids, { archived_at: now() }, 'Archived') },
            { id: 'delete', label: 'Delete', danger: true, run: ids => moveRecipes(ids, { deleted_at: now() }, 'Deleted') },
          ]),
      });
      return kit;
    };
    // The batches list drags like Tasks: the order you leave becomes Custom (quietly).
    async function batchOrder(rows, label, ul, moved) {
      const was = batchSort();
      const writes = reorderWrites(rows, r => rankOfBatch(makeOf(r.id)), was === 'custom' ? moved : rows.map(r => r.id));
      const before = writes.map(([r]) => [r.id, { rank: makeOf(r.id)?.rank ?? null }]);
      if (writes.length) await store.updateMany('recipe_makes', writes.map(([r, k]) => [r.id, { rank: k }]));
      if (was !== 'custom') { settings.batch_sort = 'custom'; await store.updateSettings({ batch_sort: 'custom' }); }
      await render();
      undoable(was === 'custom' ? 'Moved a batch' : 'Moved a batch (sorted by Custom now)', async () => {
        await store.updateMany('recipe_makes', before);
        if (was !== 'custom') { settings.batch_sort = was; await store.updateSettings({ batch_sort: was }); }
        await render();
      });
    }
    async function changeBatches(ids, patch, label) {
      const before = ids.map(id => [id, Object.fromEntries(Object.keys(patch).map(k => [k, makeOf(id)?.[k] ?? null]))]);
      await store.updateMany('recipe_makes', ids.map(id => [id, patch]));
      await render();
      undoable(label, async () => { await store.updateMany('recipe_makes', before); await render(); });
    }
    const batchKit = this.batchKit = createListKit({
      reorder: true, holdAnywhere: true, noun: 'batch', onReorder: batchOrder, // press and hold anywhere on a row drags it, as in Tasks
      actions: STATUSES.map(([v, l, e]) => ({ id: `status-${v}`, label: `${e} ${l}`, group: 'Status', run: ids => changeBatches(ids, { status: v }, `Marked ${l.toLowerCase()}`) }))
        .concat([{ id: 'delete', label: 'Delete', danger: true, run: ids => changeBatches(ids, { deleted_at: now() }, `Deleted ${ids.length} batch${ids.length === 1 ? '' : 'es'}`) }]),
    });

    async function moveRecipes(ids, patch, label) {
      const before = ids.map(id => [id, Object.fromEntries(Object.keys(patch).map(k => [k, recipeOf(id)?.[k] ?? (k === 'type' ? '' : null)]))]);
      await store.updateMany('recipes', ids.map(id => [id, patch]));
      await render();
      undoable(label, async () => { await store.updateMany('recipes', before); await render(); });
    }
    async function persistOrder(rows, label, ul, moved) {
      const bookAt = id => { for (let p = ul.querySelector(`li[data-id="${CSS.escape(id)}"]`)?.previousElementSibling; p; p = p.previousElementSibling) if (p.dataset.book !== undefined) return p.dataset.book; return null; };
      const book = new Map(rows.map(r => [r.id, recipeOf(r.id)?.type || '']));
      if (!state.section || pinnedTab()) for (const id of moved) { const b = bookAt(id); if (b !== null) book.set(id, b); }
      const patch = new Map();
      // Each book's pinned and unpinned recipes are placed separately (pinned always come first).
      for (const name of new Set(book.values())) {
        for (const pinned of [true, false]) {
          for (const [r, k] of reorderWrites(rows.filter(r => book.get(r.id) === name && !!recipeOf(r.id)?.pinned === pinned), r => rankOfRecipe(recipeOf(r.id)), moved)) patch.set(r.id, { rank: k });
        }
      }
      for (const [id, b] of book) if (b !== (recipeOf(id)?.type || '')) patch.set(id, Object.assign(patch.get(id) || { rank: rankOfRecipe(recipeOf(id)) }, { type: b }));
      if (!patch.size) return;
      const before = Array.from(patch.keys()).map(id => [id, { rank: recipeOf(id)?.rank ?? null, type: recipeOf(id)?.type || '' }]);
      await store.updateMany('recipes', Array.from(patch.entries()));
      await render();
      const into = Array.from(patch.values()).find(x => x.type !== undefined);
      undoable(into ? `Moved to ${into.type || 'No book'}` : 'Moved a recipe', async () => { await store.updateMany('recipes', before); await render(); });
    }

    // Esc with recipes chosen: the choosing ends first (before keyboard browsing's own Esc).
    this.onEsc = ev => {
      if (ev.key === 'Escape' && (kit?.size || batchKit.size) && !document.querySelector('dialog[open]') && !writing()) { ev.preventDefault(); ev.stopPropagation(); kit?.escape(); batchKit.escape(); }
    };
    addEventListener('keydown', this.onEsc, true);
    this.onKey = ev => {
      if (ev.key === 'Escape' && !ev.defaultPrevented && !document.querySelector('dialog[open]') && !writing()) {
        if (kit?.escape()) ev.preventDefault();
        else if (Object.keys(state.edit).some(k => state.edit[k])) { ev.preventDefault(); state.edit = {}; render(); }
      }
    };
    addEventListener('keydown', this.onKey);
    await render();
  },

  route(parts) {
    // …/from/<owner id>: someone else's recipe, shared with you
    const at = parts.indexOf('from');
    this.state.owner = at >= 0 ? parts[at + 1] || null : null;
    const [id, sub, makeId] = at >= 0 ? parts.slice(0, at) : parts;
    const recipe = id || null;
    if (recipe !== this.state.recipe) { this.state.times = 1; this.state.edit = {}; }
    this.state.recipe = recipe;
    this.state.make = sub === 'make' ? makeId || null : null;
    this.state.fromList = (at >= 0 ? parts.slice(0, at) : parts)[3] === 'list';
    scrollTo(0, 0);
    return this.render();
  },

  unmount() {
    removeEventListener('keydown', this.onKey);
    removeEventListener('keydown', this.onEsc, true);
    this.kit?.destroy();
    this.batchKit?.destroy();
    this.stickWatch?.disconnect();
    store.useSpace(null);
  },

  quickAdd() {
    document.querySelector('[data-act="new"]')?.click();
  },
};

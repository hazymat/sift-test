// Batch Book: a recipe book that also keeps every batch made from it.
// #/recipes                         the book (by type, like chapters) or all batches
// #/recipes/<recipe id>             a recipe: details, ingredients, method, tasting notes, its batches
// #/recipes/<recipe id>/make/<id>   one batch: summary, gravity log, recipe as made, diary, tasting diary
// Data and units: js/batchbook.js. The stock check: stockCheck() below.

import * as store from '../store.js';
import * as att from '../attachments.js';
import { TYPES, typeOf, UNITS, UNIT_GROUPS, parseLine, parseQty, qtyText, amountText, ingredientText, methodHtml, renameRefs, abvOf, nextBatchNo, loadBook } from '../batchbook.js';
import { loadLists, nestItems, createList, addItems } from '../lists.js';
import { richText } from '../richtext.js';
import { debounced } from '../autosave.js';
import { toast, undoable } from '../toast.js';
import { askText, askYes } from '../ask.js';
import { dateText, isoDate } from '../days.js';
import { word } from '../words.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const today = () => isoDate(new Date());
const shortDate = iso => (iso ? dateText(new Date(`${iso.slice(0, 10)}T12:00`), { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const dayMonth = iso => (iso ? dateText(new Date(`${iso.slice(0, 10)}T12:00`), { day: 'numeric', month: 'short' }) : '');
const STATUSES = [['planned', 'Planned'], ['going', 'On the go'], ['done', 'Done']];
const GOALS = ['ABV goal', 'Sweetness goal', 'Final sweetness'];
const SCALES = [0.5, 1, 2, 3];
const now = () => new Date().toISOString();

export default {
  async mount(el) {
    const state = this.state = { recipe: null, make: null, tab: 'book', type: '', q: '', times: 1, edit: {} };
    let data = { recipes: [], makes: [], entries: [] };
    let atts = new Map();
    let dirty = false; // something changed while a field was being written in: redraw once it's left
    const recipeOf = id => data.recipes.find(r => r.id === id);
    const makeOf = id => data.makes.find(m => m.id === id);
    const makesOf = id => data.makes.filter(m => m.recipe_id === id);
    const entriesOf = (id, kind) => data.entries.filter(e => e.make_id === id && e.kind === kind).sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || a.created_at.localeCompare(b.created_at));
    const go = hash => { if (location.hash !== hash) location.hash = hash; else render(); };
    const photoOf = id => (atts.get(id) || []).find(a => a.kind === 'image' && a.thumb);
    const writing = () => !!document.activeElement?.closest?.('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]') && el.contains(document.activeElement);

    // ---------- the book ----------

    const typesInUse = () => {
      const ids = Array.from(new Set(data.recipes.map(r => r.type || '')));
      return ids.sort((a, b) => ((TYPES.findIndex(t => t.id === a) + 1 || 99) - (TYPES.findIndex(t => t.id === b) + 1 || 99)) || a.localeCompare(b));
    };
    const matches = r => {
      if (state.type && (r.type || '') !== state.type) return false;
      if (!state.q) return true;
      const text = [r.title, r.type, r.description, r.method].concat((r.ingredients || []).map(i => `${i.item} ${i.note}`)).join(' ').toLowerCase();
      return state.q.toLowerCase().split(/\s+/).every(w => text.includes(w));
    };
    const shown = () => data.recipes.filter(matches).sort((a, b) => ((TYPES.findIndex(t => t.id === a.type) + 1 || 99) - (TYPES.findIndex(t => t.id === b.type) + 1 || 99)) || (a.type || '').localeCompare(b.type || '') || (a.title || '').localeCompare(b.title || ''));

    function card(r) {
      const t = typeOf(r.type);
      const made = makesOf(r.id);
      const photo = photoOf(r.id);
      return `<a class="bb-card" href="#/recipes/${r.id}" style="--bb:${t.colour}">
        <span class="bb-card-pic">${photo ? `<img src="${photo.thumb}" alt="" loading="lazy">` : `<span class="bb-card-emoji">${t.emoji}</span>`}</span>
        <span class="bb-card-body">
          <span class="bb-card-title">${esc(r.title || 'Untitled')}</span>
          ${r.description ? `<span class="muted bb-card-desc">${esc(r.description)}</span>` : ''}
          <span class="muted bb-card-made">${made.length ? `Made ${made.length}× · last ${shortDate(made[0].date)}` : 'Not made yet'}</span>
        </span>
      </a>`;
    }

    function batchRow(m) {
      const r = recipeOf(m.recipe_id);
      const t = typeOf(r?.type);
      const abv = abvOf(entriesOf(m.id, 'reading'));
      return `<a class="bb-batch-row" href="#/recipes/${m.recipe_id}/make/${m.id}" style="--bb:${t.colour}">
        <span class="bb-batch-emoji">${t.emoji}</span>
        <span class="bb-batch-no">Batch #${esc(m.batch_no || '?')}</span>
        <span class="bb-batch-name">${esc(r?.title || 'Untitled')}${m.description && m.description !== r?.description ? ` <span class="muted">· ${esc(m.description)}</span>` : ''}</span>
        <span class="muted">${shortDate(m.date)}</span>
        ${abv ? `<span class="chip">${abv.abv.toFixed(2)}%</span>` : ''}
        <span class="chip bb-status-${m.status || 'going'}">${STATUSES.find(s => s[0] === (m.status || 'going'))[1]}</span>
      </a>`;
    }

    function overview() {
      const types = typesInUse();
      const list = shown();
      const ids = new Set(list.map(r => r.id));
      const batches = data.makes.filter(m => ids.has(m.recipe_id));
      const chapters = Array.from(new Set(list.map(r => r.type || '')));
      return `
        <div class="bb-head">
          <button type="button" class="primary" data-act="new">+ New recipe</button>
          <input type="search" class="bb-search" placeholder="Search the book…" value="${esc(state.q)}" aria-label="Search the book">
          <details class="tool-menu page-more">
            <summary class="icon-btn" aria-label="More actions">${icon('i-more')}</summary>
            <div class="menu"><a href="#/bin/archive/recipes">Show Archive</a><a href="#/bin/bin/recipes">Show Bin</a></div>
          </details>
        </div>
        <div class="segmented bb-tabs" role="tablist" aria-label="Recipes or batches">
          <button type="button" data-tab="book" aria-pressed="${state.tab === 'book'}">📖 Recipes</button>
          <button type="button" data-tab="batches" aria-pressed="${state.tab === 'batches'}">🧪 Batches</button>
        </div>
        ${types.length > 1 ? `<div class="bb-types">
          <button type="button" class="chip" data-type="" aria-pressed="${!state.type}">All</button>
          ${types.map(id => `<button type="button" class="chip" data-type="${esc(id)}" aria-pressed="${state.type === id}" style="--bb:${typeOf(id).colour}">${typeOf(id).emoji} ${esc(id || 'No type')}</button>`).join('')}
        </div>` : ''}
        ${!data.recipes.length ? `<div class="empty"><h2>Your Batch Book is empty.</h2><p class="muted">Add a recipe: ingredients, method, photos and tasting notes. Each time you make it, record the batch: readings, a diary and how it tasted.</p></div>`
        : state.tab === 'batches' ? (batches.length ? `<div class="bb-batches">${batches.map(batchRow).join('')}</div>` : '<div class="empty"><h2>No batches yet.</h2><p class="muted">Open a recipe and press Make this.</p></div>')
        : list.length ? chapters.map(c => `
          <section class="bb-chapter" style="--bb:${typeOf(c).colour}">
            <h3 class="bb-chapter-title"><span>${typeOf(c).emoji}</span> ${esc(c || 'Other recipes')} <span class="muted">${list.filter(r => (r.type || '') === c).length}</span></h3>
            <div class="bb-grid">${list.filter(r => (r.type || '') === c).map(card).join('')}</div>
          </section>`).join('') : '<div class="empty"><h2>Nothing here.</h2></div>'}`;
    }

    // ---------- pieces used on both pages ----------

    const unitSelect = (value, attrs) => `<select ${attrs} aria-label="Unit">${UNIT_GROUPS.map(g => `<optgroup label="${g}">${UNITS.filter(u => u[2] === g).map(u => `<option value="${u[0]}"${u[0] === (value || '') ? ' selected' : ''}>${u[0] ? esc(u[1]) : 'each'}</option>`).join('')}</optgroup>`).join('')}</select>`;

    // owner = { collection, id }; the record carries ingredients[] and method.
    function ingredientsHtml(rec, owner, { times = 1, stock = null } = {}) {
      const ings = rec.ingredients || [];
      const editing = state.edit[`ings:${rec.id}`];
      const scale = owner.collection === 'recipes' && ings.some(i => i.qty != null) ? `<span class="segmented bb-scale" aria-label="Scale">${SCALES.map(s => `<button type="button" data-scale="${s}" aria-pressed="${state.times === s}">×${qtyText(s)}</button>`).join('')}</span>` : '';
      const head = `<h2 class="bb-h"><span>🧺 Ingredients</span>${editing ? '' : scale}<button type="button" class="bb-edit" data-edit="ings:${rec.id}">${editing ? 'Done' : ings.length ? 'Edit' : '+ Add'}</button></h2>`;
      if (editing) return `${head}
        <div class="bb-ing-edit" data-owner="${owner.collection}:${owner.id}">
          ${ings.map((i, n) => `<div class="bb-ing-row" data-ing="${i.id}">
            <input class="bb-ing-item" data-ing-field="item" value="${esc(i.item)}" placeholder="Ingredient" aria-label="Ingredient">
            <input class="bb-ing-qty" data-ing-field="qty" value="${esc(i.qty == null ? '' : qtyText(i.qty, i.unit))}" placeholder="Amount" inputmode="decimal" aria-label="Amount">
            ${unitSelect(i.unit, 'data-ing-field="unit" class="bb-ing-unit"')}
            <input class="bb-ing-note" data-ing-field="note" value="${esc(i.note || '')}" placeholder="Type or note" aria-label="Type or note">
            <span class="bb-ing-moves"><button type="button" class="icon-btn" data-ing-move="-1" ${n ? '' : 'disabled'} aria-label="Move up">↑</button><button type="button" class="icon-btn" data-ing-remove aria-label="Remove">×</button></span>
          </div>`).join('')}
          <textarea class="bb-ing-new no-inline" rows="3" placeholder="Add ingredients, one per line: 3268g honey, Asda Orange Blossom · ½ onion · 2 tsp salt · 5 UK gallon water"></textarea>
          <div class="detail-actions"><button type="button" data-act="add-ings">Add these</button></div>
        </div>`;
      if (!ings.length) return `${head}<p class="muted bb-none">No ingredients yet.</p>`;
      const t = owner.collection === 'recipes' ? state.times : 1;
      return `${head}
        <table class="bb-table bb-ings">
          <thead><tr><th>Ingredient</th><th>Amount</th><th>Type</th>${stock ? '<th>Stock</th>' : ''}</tr></thead>
          <tbody>${ings.map(i => `<tr><td>${esc(i.item)}</td><td>${esc(amountText(i, t * times))}</td><td>${esc(i.note || '')}</td>${stock ? `<td class="bb-stock-cell">${stock[i.id] === 'have' ? '<span title="In stock">✓</span>' : stock[i.id] === 'need' ? '<span title="On the shopping list">🛒</span>' : ''}</td>` : ''}</tr>`).join('')}</tbody>
        </table>`;
    }

    function methodSection(rec) {
      const editing = state.edit[`method:${rec.id}`];
      const t = rec.recipe_id ? 1 : state.times;
      const head = `<h2 class="bb-h"><span>🥄 Method</span><button type="button" class="bb-edit" data-edit="method:${rec.id}">${editing ? 'Done' : rec.method ? 'Edit' : '+ Add'}</button></h2>`;
      if (editing) return `${head}
        ${(rec.ingredients || []).length ? `<div class="bb-ref-picks"><span class="muted">Put in:</span>${rec.ingredients.map(i => `<button type="button" class="chip" data-ref="${esc(i.item)}">${esc(i.item)}</button>`).join('')}</div>` : ''}
        <textarea class="bb-method-edit no-inline" data-method="${rec.id}" rows="8" placeholder="How it's made. Press an ingredient above to put it in with its amount.">${esc(rec.method || '')}</textarea>
        <p class="muted hint">{salt} shows the salt with its amount. {1/2 salt} or {25% salt} shows part of it; {salt|a pinch of salt} shows your own words.</p>`;
      return `${head}${rec.method ? `<div class="bb-method">${methodHtml(rec.method, rec.ingredients || [], t, esc)}</div>` : '<p class="muted bb-none">No method yet.</p>'}`;
    }

    // A details table: each field a row; for batches with readings, goals and actual sit together.
    function fieldsHtml(rec, collection, { goals = false } = {}) {
      const fields = rec.fields || {};
      const rows = Object.keys(fields).filter(k => !(goals && GOALS.includes(k)));
      return rows.map(k => `<tr><th>${esc(k)}</th><td><input data-field-key="${esc(k)}" data-coll="${collection}" value="${esc(fields[k] || '')}" aria-label="${esc(k)}"></td><td class="bb-x"><button type="button" class="icon-btn" data-field-remove="${esc(k)}" aria-label="Remove ${esc(k)}">×</button></td></tr>`).join('');
    }

    function turner(list, at, href, label) {
      if (list.length < 2) return '';
      const prev = list[at - 1], next = list[at + 1];
      return `<div class="segmented bb-turn" role="tablist" aria-label="Turn the page">
        <button type="button" data-go="${prev ? href(prev) : ''}" ${prev ? '' : 'disabled'} title="${prev ? esc(label(prev)) : ''}" aria-label="Previous">‹</button>
        <button type="button" aria-pressed="true" tabindex="-1" class="bb-turn-at">${at + 1} of ${list.length}</button>
        <button type="button" data-go="${next ? href(next) : ''}" ${next ? '' : 'disabled'} title="${next ? esc(label(next)) : ''}" aria-label="Next">›</button>
      </div>`;
    }

    // ---------- a recipe ----------

    function recipePage() {
      const r = recipeOf(state.recipe);
      if (!r) return '<div class="empty"><h2>That recipe has gone.</h2></div>';
      const t = typeOf(r.type);
      const list = shown().some(x => x.id === r.id) ? shown() : data.recipes;
      const at = list.findIndex(x => x.id === r.id);
      const made = makesOf(r.id);
      const types = Array.from(new Set(TYPES.map(x => x.id).concat(typesInUse()))).filter(Boolean);
      return `
        <div class="bb-top">
          <button type="button" class="back" data-act="home">‹ ${esc(word('area_recipes'))}</button>
          ${turner(list, at, x => `#/recipes/${x.id}`, x => x.title || 'Untitled')}
        </div>
        <article class="bb-paper" style="--bb:${t.colour}">
          <header class="bb-title-row">
            <span class="bb-emoji">${t.emoji}</span>
            <textarea class="bb-title one-line" rows="1" data-rec="title" placeholder="Recipe name" aria-label="Recipe name">${esc(r.title)}</textarea>
          </header>
          <div class="bb-rule"></div>
          <textarea class="bb-desc one-line" rows="1" data-rec="description" placeholder="What it is, in a line" aria-label="Description">${esc(r.description || '')}</textarea>
          ${att.rowHtml(atts.get(r.id), { parent: r.id })}
          <h2 class="bb-h"><span>📋 Details</span></h2>
          <table class="bb-table bb-summary">
            <tr><th>Type</th><td><select data-rec-type aria-label="Type"><option value="">None</option>${types.map(x => `<option${x === r.type ? ' selected' : ''}>${esc(x)}</option>`).join('')}<option value="__new">Another type…</option></select></td><td class="bb-x"></td></tr>
            ${fieldsHtml(r, 'recipes')}
          </table>
          <button type="button" class="bb-add-field" data-act="add-field">+ Add a detail</button>
          ${ingredientsHtml(r, { collection: 'recipes', id: r.id })}
          ${methodSection(r)}
          <h2 class="bb-h"><span>🥂 Tasting notes</span></h2>
          <div class="bb-tasting"></div>
          <h2 class="bb-h"><span>🧪 Batches</span><button type="button" class="primary" data-act="make">Make this${state.times !== 1 ? ` ×${qtyText(state.times)}` : ''}</button></h2>
          ${made.length ? `<div class="bb-batches">${made.map(batchRow).join('')}</div>` : '<p class="muted bb-none">Not made yet. Make this starts a batch and checks what you have in stock.</p>'}
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
      const list = entriesOf(m.id, kind);
      return `<h2 class="bb-h"><span>${title}</span></h2>
        <table class="bb-table bb-diary">
          <thead><tr><th>Date</th><th>Notes</th><th></th></tr></thead>
          <tbody>${list.map(e => `<tr data-entry="${e.id}">
            <td><input type="date" data-entry-field="date" value="${esc(e.date || '')}" aria-label="Date"></td>
            <td><textarea class="bb-entry-text no-inline" data-entry-field="text" rows="1" placeholder="What happened" aria-label="Notes">${esc(e.text || '')}</textarea>${(atts.get(e.id) || []).length ? att.rowHtml(atts.get(e.id), { parent: e.id, addButton: false }) : ''}</td>
            <td class="bb-x"><button type="button" class="icon-btn" data-entry-photo title="Add a photo" aria-label="Add a photo">${icon('i-clip')}</button><button type="button" class="icon-btn" data-entry-remove aria-label="Remove">×</button></td>
          </tr>`).join('')}</tbody>
        </table>
        <button type="button" class="bb-add-field" data-add-entry="${kind}">+ Add ${kind === 'tasting' ? 'a tasting' : 'an entry'}</button>`;
    }

    function makePage() {
      const m = makeOf(state.make);
      const r = m && recipeOf(m.recipe_id);
      if (!m) return '<div class="empty"><h2>That batch has gone.</h2></div>';
      const t = typeOf(r?.type);
      const readings = entriesOf(m.id, 'reading');
      const abv = abvOf(readings);
      const gravity = t.readings || readings.length;
      const f = m.fields || {};
      const sameType = data.makes.filter(x => (recipeOf(x.recipe_id)?.type || '') === (r?.type || '')).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (parseInt(a.batch_no, 10) || 0) - (parseInt(b.batch_no, 10) || 0));
      const at = sameType.findIndex(x => x.id === m.id);
      const stock = m.stock || {};
      const have = Object.values(stock).filter(v => v === 'have').length, need = Object.values(stock).filter(v => v === 'need').length;
      const list = m.list_id && lists.find(l => l.id === m.list_id);
      const goal = k => `<input data-field-key="${k}" data-coll="recipe_makes" value="${esc(f[k] || '')}" aria-label="${k}" placeholder="…">`;
      return `
        <div class="bb-top">
          <button type="button" class="back" data-act="to-recipe">‹ ${esc(r?.title || 'Recipe')}</button>
          ${turner(sameType, at, x => `#/recipes/${x.recipe_id}/make/${x.id}`, x => `Batch #${x.batch_no || '?'}`)}
        </div>
        <article class="bb-paper bb-make" style="--bb:${t.colour}">
          <header class="bb-title-row">
            <span class="bb-emoji">${t.emoji}</span>
            <span class="bb-title bb-batch-title">Batch #<input class="bb-batch-input" data-make="batch_no" value="${esc(m.batch_no || '')}" aria-label="Batch number" size="4"></span>
          </header>
          <div class="bb-rule"></div>
          <p class="bb-of">${esc(r?.type ? `${r.type}: ` : '')}<a href="#/recipes/${m.recipe_id}">${esc(r?.title || 'Untitled')}</a></p>
          <h2 class="bb-h"><span>Batch summary</span></h2>
          <table class="bb-table bb-summary">
            <tr><th>Date</th><td><input type="date" data-make="date" value="${esc(m.date || '')}" aria-label="Date"></td><td class="bb-x"></td></tr>
            <tr><th>Description</th><td><input data-make="description" value="${esc(m.description || '')}" aria-label="Description" placeholder="e.g. Session mead, 5 gallon bucket brew"></td><td class="bb-x"></td></tr>
            <tr><th>Status</th><td><select data-make="status" aria-label="Status">${STATUSES.map(([v, l]) => `<option value="${v}"${(m.status || 'going') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></td><td class="bb-x"></td></tr>
            ${fieldsHtml(m, 'recipe_makes', { goals: gravity })}
            ${gravity ? `<tr><th>Goals vs actual</th><td colspan="2"><div class="bb-goals">
              <label><span>Sweetness goal</span>${goal('Sweetness goal')}</label><label><span>ABV goal</span>${goal('ABV goal')}</label>
              <label><span>Final sweetness</span>${goal('Final sweetness')}</label><label class="bb-abv"><span>${abv?.final ? 'Final ABV' : 'ABV so far'}</span><b>${abv ? `${abv.abv.toFixed(2)}%` : '–'}</b></label>
            </div></td></tr>
            <tr><th>Back-sweetened?</th><td><input type="checkbox" data-make="back_sweetened" ${m.back_sweetened ? 'checked' : ''} aria-label="Back-sweetened"></td><td class="bb-x"></td></tr>` : ''}
            <tr><th>Current state</th><td><input data-make="state" value="${esc(m.state || '')}" aria-label="Current state" placeholder="e.g. Fermenting, bottled, all gone"></td><td class="bb-x"></td></tr>
          </table>
          <button type="button" class="bb-add-field" data-act="add-field">+ Add a detail</button>
          <div class="bb-stockline">
            <span>${have || need ? `${have ? `✓ ${have} in stock` : ''}${have && need ? ' · ' : ''}${need ? `🛒 ${need} to buy${list ? ` on <a href="#/lists/${list.id}">${esc(list.name)}</a>` : ''}` : ''}` : 'Stock not checked yet.'}</span>
            <button type="button" data-act="stock">${have || need ? 'Check again' : 'Check stock'}</button>
          </div>
          ${att.rowHtml(atts.get(m.id), { parent: m.id })}
          ${gravity ? `<h2 class="bb-h"><span>🌡️ Gravity log</span><button type="button" data-act="reading">+ Log reading</button></h2>
            ${chart(readings)}
            <div class="bb-readings">${readings.map(e => `<div class="bb-reading" data-entry="${e.id}">
              <select data-entry-field="label" aria-label="Kind of reading">${['OG', 'SG', 'FG'].map(l => `<option${(e.label || 'SG') === l ? ' selected' : ''}>${l}</option>`).join('')}</select>
              <input class="bb-gravity" data-entry-field="gravity" value="${e.gravity ? e.gravity.toFixed(3) : ''}" inputmode="decimal" placeholder="1.050" aria-label="Gravity">
              <input type="date" data-entry-field="date" value="${esc(e.date || '')}" aria-label="Date">
              <textarea class="bb-entry-text no-inline" data-entry-field="text" rows="1" placeholder="Note" aria-label="Note">${esc(e.text || '')}</textarea>
              <button type="button" class="icon-btn bb-reading-x" data-entry-remove aria-label="Remove reading">×</button>
            </div>`).join('') || '<p class="muted bb-none">No readings yet.</p>'}</div>` : ''}
          <h2 class="bb-h bb-h-big"><span>🍯 Recipe</span><span class="muted bb-h-note">as made in this batch</span></h2>
          ${ingredientsHtml(m, { collection: 'recipe_makes', id: m.id }, { stock: have || need ? stock : null })}
          ${methodSection(m)}
          ${entriesHtml(m, 'diary', '📔 Diary')}
          ${entriesHtml(m, 'tasting', '🥂 Tasting diary')}
        </article>
        <div class="detail-actions bb-foot">
          <span class="spacer"></span>
          <button type="button" class="danger" data-act="delete-make">Delete batch</button>
        </div>`;
    }

    // ---------- drawing ----------

    let lists = [];
    let tasting = null;
    const render = this.render = async () => {
      data = await loadBook();
      atts = await att.byParent();
      if (state.make) lists = (await loadLists()).lists;
      tasting?.flush();
      tasting = null;
      dirty = false;
      el.innerHTML = `<div class="bb">${state.make ? makePage() : state.recipe ? recipePage() : overview()}</div>`;
      const box = el.querySelector('.bb-tasting');
      const r = state.recipe && !state.make && recipeOf(state.recipe);
      if (box && r) {
        let pending = null;
        tasting = debounced(async () => { if (pending != null) { const md = pending; pending = null; await store.update('recipes', r.id, { tasting: md }); } }, 600);
        richText(box, { value: r.tasting || '', placeholder: 'How it tasted, what to change next time', origin: () => ({ collection: 'recipes', id: r.id, title: r.title, field: 'tasting' }), onChange: md => { pending = md; tasting.trigger(); } });
      }
      if (focusNext) { const f = el.querySelector(focusNext); focusNext = null; if (f) { f.focus(); f.select?.(); } }
    };
    // After a sync: redraw unless something is being written in (then when it's left).
    this.refresh = async () => { if (writing()) { dirty = true; return; } await render(); };
    el.addEventListener('focusout', () => setTimeout(() => { if (dirty && !writing()) render(); }, 0));
    let focusNext = null;
    const later = async () => { data = await loadBook(); if (writing()) dirty = true; else await render(); };

    // ---------- saving ----------

    const ownerOf = node => { const [collection, id] = (node.closest('[data-owner]')?.dataset.owner || '').split(':'); return { collection, id }; };
    const recOf = o => (o.collection === 'recipes' ? recipeOf(o.id) : makeOf(o.id));
    const pageRec = () => (state.make ? { collection: 'recipe_makes', id: state.make } : { collection: 'recipes', id: state.recipe });

    async function saveIngredients(o, next, label) {
      const rec = recOf(o);
      const old = rec.ingredients || [];
      await store.update(o.collection, o.id, { ingredients: next });
      await later();
      if (label) undoable(label, async () => { await store.update(o.collection, o.id, { ingredients: old }); render(); });
    }

    // Text as it's typed: saved after a pause, and when it's left.
    const pendingText = new Map();
    const textSave = debounced(async () => {
      const all = Array.from(pendingText.values());
      pendingText.clear();
      for (const p of all) await store.update(p.collection, p.id, { [p.field]: p.value });
    }, 700);
    const queueText = (collection, id, field, value) => { pendingText.set(`${collection}:${id}:${field}`, { collection, id, field, value }); textSave.trigger(); };

    el.addEventListener('input', ev => {
      const t = ev.target;
      if (t.matches('.bb-search')) { state.q = t.value; const at = t.selectionStart; render().then(() => { const s = el.querySelector('.bb-search'); s?.focus(); s?.setSelectionRange(at, at); }); return; }
      if (t.dataset.method) return queueText(pageRec().collection, t.dataset.method, 'method', t.value);
      if (t.dataset.entryField === 'text') return queueText('recipe_entries', t.closest('[data-entry]').dataset.entry, 'text', t.value);
    });

    el.addEventListener('change', async ev => {
      const t = ev.target;
      const page = pageRec();
      if (t.dataset.rec) {
        const r = recipeOf(state.recipe);
        const value = t.value.trim();
        if (t.dataset.rec === 'title' && !value) { t.value = r.title; toast('A recipe needs a name, so it was put back'); return; }
        const old = r[t.dataset.rec] || '';
        if (value === old) return;
        await store.update('recipes', r.id, { [t.dataset.rec]: value });
        await later();
        undoable('Saved', async () => { await store.update('recipes', r.id, { [t.dataset.rec]: old }); render(); });
        return;
      }
      if (t.matches('[data-rec-type]')) {
        const r = recipeOf(state.recipe);
        let type = t.value;
        if (type === '__new') {
          type = (await askText('A new type', { placeholder: 'e.g. Kombucha', ok: 'Add' }))?.trim();
          if (!type) { t.value = r.type || ''; return; }
        }
        const fields = Object.assign({}, r.fields);
        for (const k of typeOf(type).fields) if (!(k in fields)) fields[k] = '';
        await store.update('recipes', r.id, { type, fields });
        return render();
      }
      if (t.dataset.fieldKey) {
        const rec = recOf(page);
        await store.update(page.collection, page.id, { fields: Object.assign({}, rec.fields, { [t.dataset.fieldKey]: t.value.trim() }) });
        return later();
      }
      if (t.dataset.make) {
        const field = t.dataset.make;
        const value = t.type === 'checkbox' ? t.checked : t.value.trim();
        await store.update('recipe_makes', state.make, { [field]: value });
        return later();
      }
      if (t.dataset.ingField) {
        const o = ownerOf(t);
        const rec = recOf(o);
        const id = t.closest('[data-ing]').dataset.ing;
        const ing = rec.ingredients.find(i => i.id === id);
        let value = t.value.trim();
        if (t.dataset.ingField === 'qty') { value = value === '' ? null : parseQty(value); if (value == null && t.value.trim()) { toast('That amount wasn\'t a number'); t.value = ing.qty ?? ''; return; } }
        const next = rec.ingredients.map(i => (i.id === id ? Object.assign({}, i, { [t.dataset.ingField]: value }) : i));
        if (t.dataset.ingField === 'item' && ing.item && value && rec.method) await store.update(o.collection, o.id, { method: renameRefs(rec.method, ing.item, value) });
        return saveIngredients(o, next);
      }
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
    el.addEventListener('focusout', ev => { if (ev.target.dataset?.method || ev.target.dataset?.entryField === 'text') textSave.flush(); });

    // ---------- pressing things ----------

    el.addEventListener('click', async ev => {
      if (att.onClick(ev, b => { const e = b.closest('[data-entry]'); return e ? { collection: 'recipe_entries', id: e.dataset.entry } : pageRec(); }, () => render())) return;
      const b = ev.target.closest('button, [data-act]');
      if (!b) return;
      b.closest('details')?.removeAttribute('open');
      const page = pageRec();
      if (b.dataset.tab) { state.tab = b.dataset.tab; return render(); }
      if (b.dataset.type !== undefined) { state.type = b.dataset.type; return render(); }
      if (b.dataset.go) return go(b.dataset.go);
      if (b.dataset.scale) { state.times = +b.dataset.scale; return render(); }
      if (b.dataset.edit) {
        await textSave.flush();
        state.edit[b.dataset.edit] = !state.edit[b.dataset.edit];
        if (state.edit[b.dataset.edit]) focusNext = b.dataset.edit.startsWith('ings') ? ((recOf(page).ingredients || []).length ? null : '.bb-ing-new') : '.bb-method-edit';
        return render();
      }
      if (b.dataset.ref) {
        const ta = el.querySelector('.bb-method-edit');
        const insert = `{${b.dataset.ref}}`;
        const at = ta.selectionStart ?? ta.value.length;
        ta.setRangeText(insert, at, ta.selectionEnd ?? at, 'end');
        ta.focus();
        queueText(page.collection, ta.dataset.method, 'method', ta.value);
        return;
      }
      if (b.dataset.ingRemove !== undefined || b.dataset.ingMove) {
        const o = ownerOf(b);
        const rec = recOf(o);
        const id = b.closest('[data-ing]').dataset.ing;
        const next = rec.ingredients.slice();
        const at = next.findIndex(i => i.id === id);
        if (b.dataset.ingMove) { const [moved] = next.splice(at, 1); next.splice(at - 1, 0, moved); await saveIngredients(o, next); return render(); }
        const gone = next.splice(at, 1)[0];
        await saveIngredients(o, next, `Removed ${gone.item || 'ingredient'}`);
        return render();
      }
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
        const made = await store.create('recipe_entries', { make_id: state.make, kind: b.dataset.addEntry, date: today(), text: '' });
        focusNext = `[data-entry="${made.id}"] textarea`;
        return render();
      }
      if (b.dataset.entryPhoto !== undefined) return att.pick({ collection: 'recipe_entries', id: b.closest('[data-entry]').dataset.entry }, () => render());
      if (b.dataset.entryRemove !== undefined) {
        const id = b.closest('[data-entry]').dataset.entry;
        await store.remove('recipe_entries', id);
        await render();
        undoable('Removed', async () => { await store.restore('recipe_entries', id); render(); });
        return;
      }
      const act = b.dataset.act;
      if (act === 'home') return go('#/recipes');
      if (act === 'new') return newRecipe();
      if (act === 'to-recipe') return go(`#/recipes/${makeOf(state.make)?.recipe_id || ''}`);
      if (act === 'add-ings') {
        const ta = b.closest('.bb-ing-edit').querySelector('.bb-ing-new');
        return addIngredientLines(ownerOf(ta), ta.value);
      }
      if (act === 'add-field') {
        const name = (await askText('Add a detail', { placeholder: 'e.g. Batch volume, Yeast, Oven temperature', ok: 'Add' }))?.trim();
        if (!name) return;
        const rec = recOf(page);
        await store.update(page.collection, page.id, { fields: Object.assign({}, rec.fields, { [name]: (rec.fields || {})[name] || '' }) });
        focusNext = `[data-field-key="${CSS.escape(name)}"]`;
        return render();
      }
      if (act === 'make') return makeThis(recipeOf(state.recipe));
      if (act === 'stock') return stockCheck(makeOf(state.make));
      if (act === 'reading') {
        const had = entriesOf(state.make, 'reading');
        const made = await store.create('recipe_entries', { make_id: state.make, kind: 'reading', label: had.length ? 'SG' : 'OG', gravity: null, date: today(), text: '' });
        focusNext = `[data-entry="${made.id}"] .bb-gravity`;
        return render();
      }
      if (act === 'archive-recipe' || act === 'delete-recipe') {
        const r = recipeOf(state.recipe);
        const field = act === 'delete-recipe' ? 'deleted_at' : 'archived_at';
        const stamp = now();
        const kids = makesOf(r.id).map(m => m.id);
        if (field === 'deleted_at' && kids.length && !(await askYes(`Delete "${r.title}" and its ${kids.length} batch${kids.length === 1 ? '' : 'es'}?`, { ok: 'Delete', danger: true, text: 'They go to the Bin for 30 days.' }))) return;
        await store.updateMany('recipe_makes', kids.map(id => [id, { [field]: stamp }]));
        await store.update('recipes', r.id, { [field]: stamp });
        go('#/recipes');
        undoable(`${field === 'deleted_at' ? 'Deleted' : 'Archived'} "${r.title}"`, async () => {
          await store.update('recipes', r.id, { [field]: null });
          await store.updateMany('recipe_makes', kids.map(id => [id, { [field]: null }]));
          render();
        });
        return;
      }
      if (act === 'delete-make') {
        const m = makeOf(state.make);
        await store.remove('recipe_makes', m.id);
        go(`#/recipes/${m.recipe_id}`);
        undoable(`Deleted Batch #${m.batch_no}`, async () => { await store.restore('recipe_makes', m.id); render(); });
      }
    });

    // Enter in "Add ingredients" adds them (Shift+Enter for another line).
    el.addEventListener('keydown', ev => {
      const t = ev.target;
      if (t.matches?.('.bb-ing-new') && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); addIngredientLines(ownerOf(t), t.value); }
    });

    async function addIngredientLines(o, text) {
      const made = text.split('\n').map(parseLine).filter(Boolean);
      if (!made.length) return;
      focusNext = '.bb-ing-new';
      await saveIngredients(o, (recOf(o).ingredients || []).concat(made), `Added ${made.length} ingredient${made.length === 1 ? '' : 's'}`);
      await render();
    }

    async function newRecipe() {
      const type = state.type || '';
      const fields = Object.fromEntries(typeOf(type).fields.map(k => [k, '']));
      const r = await store.create('recipes', { title: 'New recipe', type, description: '', ingredients: [], method: '', tasting: '', fields });
      focusNext = '.bb-title';
      go(`#/recipes/${r.id}`);
      undoable('New recipe', async () => { await store.remove('recipes', r.id); go('#/recipes'); });
    }

    // A batch starts from the recipe as it is now (at the scale shown), then checks the stock.
    async function makeThis(r) {
      const times = state.times;
      const m = await store.create('recipe_makes', {
        recipe_id: r.id, batch_no: nextBatchNo(data.makes, data.recipes, r.type), date: today(), status: 'going',
        description: r.description || '', state: '', back_sweetened: false, fields: Object.assign({}, r.fields),
        ingredients: (r.ingredients || []).map(i => Object.assign({}, i, { qty: i.qty == null ? null : i.qty * times })), method: r.method || '', stock: {}, list_id: null,
      });
      go(`#/recipes/${r.id}/make/${m.id}`);
      undoable(`Started Batch #${m.batch_no}`, async () => { await store.remove('recipe_makes', m.id); go(`#/recipes/${r.id}`); });
      if ((r.ingredients || []).length) setTimeout(() => stockCheck(m), 300);
    }

    // ---------- the stock check ----------
    // One ingredient at a time: got it, or need to buy. Then what's needed goes on a list:
    // a new one for this batch, or one you already have (the last one used is offered first).
    async function stockCheck(m) {
      m = await store.get('recipe_makes', m.id);
      const r = recipeOf(m.recipe_id);
      const ings = (m.ingredients || []).filter(i => i.item);
      if (!ings.length) { toast('This batch has no ingredients to check'); return; }
      const answers = Object.assign({}, m.stock);
      let at = 0;
      const all = (await loadLists()).lists.filter(l => l.kind !== 'template');
      const settings = await store.getSettings();
      const dlg = document.createElement('dialog');
      dlg.className = 'sheet bb-stock';
      document.body.append(dlg);
      const draw = () => {
        if (at < ings.length) {
          const i = ings[at];
          dlg.innerHTML = `<div class="sheet-handle"></div>
            <h2>Stock check <span class="muted">${at + 1} of ${ings.length}</span></h2>
            <div class="bb-stock-dots">${ings.map((x, n) => `<span class="${answers[x.id] || ''}${n === at ? ' at' : ''}"></span>`).join('')}</div>
            <div class="bb-stock-card"><span class="bb-stock-name">${esc(i.item)}</span><span class="bb-stock-amount">${esc(amountText(i))}</span>${i.note ? `<span class="muted">${esc(i.note)}</span>` : ''}</div>
            <div class="bb-stock-buttons">
              <button type="button" class="primary" data-s="have">✓ Got it <kbd>Y</kbd></button>
              <button type="button" data-s="need">🛒 Need to buy <kbd>N</kbd></button>
            </div>
            <div class="sheet-actions"><button type="button" data-s="back" ${at ? '' : 'disabled'}>‹ Back</button><span class="spacer"></span><button type="button" data-s="end">Stop here</button></div>`;
          dlg.querySelector('[data-s="have"]').focus();
          return;
        }
        const needed = ings.filter(i => answers[i.id] === 'need');
        const def = all.find(l => l.id === settings.batch_list_id);
        const name = `${r?.title || 'Batch'} – ${dayMonth(today())}`;
        dlg.innerHTML = `<div class="sheet-handle"></div>
          <h2>${needed.length ? `${needed.length} to buy` : 'Everything\'s in stock'}</h2>
          ${needed.length ? `<ul class="bb-stock-list">${needed.map(i => `<li><label><input type="checkbox" data-need="${i.id}" checked> ${esc(ingredientText(i))}</label></li>`).join('')}</ul>
          <p class="muted">Put them on</p>
          <label class="bb-stock-opt"><input type="radio" name="bb-list" value="new" ${def ? '' : 'checked'}> A new list: <input class="bb-stock-name-in" value="${esc(name)}" aria-label="New list name"></label>
          ${all.length ? `<label class="bb-stock-opt"><input type="radio" name="bb-list" value="old" ${def ? 'checked' : ''}> A list I have: <select class="bb-stock-pick">${all.map(l => `<option value="${l.id}"${l.id === def?.id ? ' selected' : ''}>${esc(l.name || 'Untitled')}</option>`).join('')}</select></label>` : ''}` : '<p class="muted">Nothing to add to a list.</p>'}
          <div class="sheet-actions"><button type="button" data-s="back">‹ Back</button><span class="spacer"></span>${needed.length ? '<button type="button" data-s="skip">Don\'t add</button><button type="button" class="primary" data-s="add">Add to the list</button>' : '<button type="button" class="primary" data-s="skip">Done</button>'}</div>`;
        dlg.querySelector('.primary').focus();
      };
      const save = async (listId = m.list_id || null) => store.update('recipe_makes', m.id, { stock: answers, list_id: listId });
      const answer = s => { answers[ings[at].id] = s; at++; draw(); };
      dlg.addEventListener('keydown', ev => {
        if (ev.target.matches('input:not([type="radio"]):not([type="checkbox"]), select') || at >= ings.length) return;
        const k = ev.key.toLowerCase();
        if (k === 'y') { ev.preventDefault(); answer('have'); } else if (k === 'n') { ev.preventDefault(); answer('need'); } else if (ev.key === 'Backspace' && at) { ev.preventDefault(); at--; draw(); }
      });
      dlg.addEventListener('click', async ev => {
        const s = ev.target.closest('[data-s]')?.dataset.s;
        if (ev.target.closest('.bb-stock-opt select, .bb-stock-name-in')) dlg.querySelector(`[name="bb-list"][value="${ev.target.closest('select') ? 'old' : 'new'}"]`).checked = true;
        if (!s) return;
        if (s === 'have' || s === 'need') return answer(s);
        if (s === 'back') { at = Math.max(0, Math.min(at, ings.length) - 1); return draw(); }
        if (s === 'end') { at = ings.length; return draw(); }
        if (s === 'skip') { await save(); dlg.close(); return; }
        if (s === 'add') {
          const picked = ings.filter(i => dlg.querySelector(`[data-need="${i.id}"]`)?.checked);
          const useOld = dlg.querySelector('[name="bb-list"]:checked')?.value === 'old';
          let list;
          if (useOld) list = all.find(l => l.id === dlg.querySelector('.bb-stock-pick').value);
          else list = await createList({ name: dlg.querySelector('.bb-stock-name-in').value.trim() || 'Shopping', kind: 'list' });
          const have = (await store.list('list_items', { filter: x => x.list_id === list.id && !x.archived_at }));
          const made = await addItems(list.id, picked.map(i => ({ text: ingredientText(i) + (i.note ? ` (${i.note})` : ''), sub: false })), nestItems(have));
          await store.updateSettings({ batch_list_id: list.id });
          await save(list.id);
          dlg.close();
          toast(`Added ${made.length} to ${list.name}`, { action: 'Open list', onAction: () => { location.hash = `#/lists/${list.id}`; } });
        }
      });
      dlg.addEventListener('close', async () => { dlg.remove(); if (Object.keys(answers).length) { const saved = await store.get('recipe_makes', m.id); if (JSON.stringify(saved.stock || {}) !== JSON.stringify(answers)) await save(); } render(); });
      draw();
      dlg.showModal();
    }

    this.onKey = ev => {
      if (ev.key === 'Escape' && !ev.defaultPrevented && !document.querySelector('dialog[open]') && !writing()) {
        const open = Object.keys(state.edit).find(k => state.edit[k]);
        if (open) { ev.preventDefault(); state.edit = {}; render(); }
      }
    };
    addEventListener('keydown', this.onKey);
    await render();
  },

  route([id, sub, makeId]) {
    const recipe = id || null;
    if (recipe !== this.state.recipe) { this.state.times = 1; this.state.edit = {}; }
    this.state.recipe = recipe;
    this.state.make = sub === 'make' ? makeId || null : null;
    scrollTo(0, 0);
    return this.render();
  },

  unmount() {
    removeEventListener('keydown', this.onKey);
  },

  quickAdd() {
    document.querySelector('[data-act="new"]')?.click();
  },
};

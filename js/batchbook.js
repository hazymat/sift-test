// Batch Book: recipes and every batch made from them (views/recipes.js).
//   recipes:        title, type (its section's name), tags[], description, ingredients[] ({ id, qty, unit, item, note }),
//                   steps[] ({ id, text with {references} }), tasting (older notes, moved to the latest batch's tasting notes), fields ({ label: value }, e.g. Batch volume)
//   recipe_makes:   recipe_id, name, batch_no (older batches' only name), date (YYYY-MM-DD), status (planned|going|done), description, state,
//                   fields, back_sweetened, ingredients[] and steps[] (copied from the recipe, then its own to change),
//                   stock ({ ingredient id: have|need }), stock_items ({ ingredient id: list item id }), list_id, tasting (its tasting notes, markdown)
//   recipe_entries: make_id, kind (diary|reading; tasting before 1.51: now the batch's tasting note), date, text; readings also: type (a book's reading kind, none = Gravity),
//                   and for gravity label (OG|SG|FG) and gravity, for any other kind value (as typed, e.g. 21°C)
// Photos are attachments: on a recipe or batch (its result photos, the first is its picture), on a step (by the
// step's id) or on a diary entry. Sections are the user's own, kept in settings (batch_sections).
//
// In a step, {salt} shows the ingredient with its amount ("2 tsp salt"), {1/2 salt} or {50% salt} part of it,
// and {salt|a pinch of salt} your own words (still marked as the ingredient).

import * as store from './store.js';
import { dateText } from './days.js';

// The sections a new Batch Book starts with. A section decides the details its new recipes start
// with, and whether batches have gravity readings.
export const STARTER_SECTIONS = [
  { name: 'Brewing', emoji: '🍷', colour: '#9b2f52', readings: true, fields: ['Batch volume', 'ABV goal', 'Sweetness goal'] },
  { name: 'Cooking', emoji: '🍲', colour: '#3f8a5c', readings: false, fields: ['Serves', 'Time'] },
];
// Looks for sections used by recipes but not set up (e.g. from the first version, which had fixed types).
const KNOWN = { Mead: ['🐝', '#c8961e', true], Winemaking: ['🍷', '#9b2f52', true], Cider: ['🍏', '#6e9a2c', true], Brewing: ['🍺', '#c07a16', true], Breadmaking: ['🍞', '#a8733a', false], Cooking: ['🍲', '#3f8a5c', false], Baking: ['🧁', '#b0663f', false], Drinks: ['🍹', '#2f7f9b', false], Cocktails: ['🍸', '#2f7f9b', false], Soups: ['🥣', '#b5452e', false], Fermentations: ['🍷', '#9b2f52', true], Household: ['🧴', '#6b7a8f', false] };
const plain = name => { const k = KNOWN[name]; return { name, emoji: k ? k[0] : '📖', colour: k ? k[1] : '#7a6a55', readings: k ? k[2] : false, fields: [], auto: true }; };
// The sections set up, then any a recipe is in that aren't (so nothing is ever hidden).
export function sectionsOf(settings, recipes) {
  const own = (settings.batch_sections || STARTER_SECTIONS).map(x => Object.assign({ fields: [] }, x));
  for (const r of recipes) if (!own.some(x => x.name === (r.type || ''))) own.push(plain(r.type || ''));
  return own;
}
export const sectionOf = (sections, name) => sections.find(x => x.name === (name || '')) || plain(name || '');

// A recipe from the first version had its method as one text: each line becomes a step (ids fixed, so a
// photo added before the steps are first saved stays on its step).
export const stepsOf = rec => rec.steps || (rec.method ? rec.method.split(/\n+/).filter(t => t.trim()).map((text, n) => ({ id: `${rec.id}-s${n}`, text })) : []);

// Units: [id, label, category, size in the category's base (g or ml), other ways of writing it]
export const UNITS = [
  ['', '', 'Count', 1, ['x', 'each', 'whole']],
  ['pinch', 'pinch', 'Count', 1, ['pinches']], ['clove', 'clove', 'Count', 1, ['cloves']], ['pack', 'pack', 'Count', 1, ['packs', 'packet', 'packets', 'sachet', 'sachets']],
  ['tin', 'tin', 'Count', 1, ['tins', 'can', 'cans']], ['bunch', 'bunch', 'Count', 1, ['bunches']], ['slice', 'slice', 'Count', 1, ['slices']], ['drop', 'drop', 'Count', 1, ['drops']],
  ['mg', 'mg', 'Weight', 0.001, []], ['g', 'g', 'Weight', 1, ['gram', 'grams', 'gr']], ['kg', 'kg', 'Weight', 1000, ['kilo', 'kilos', 'kilogram', 'kilograms']],
  ['oz', 'oz', 'Weight', 28.3495, ['ounce', 'ounces']], ['lb', 'lb', 'Weight', 453.592, ['lbs', 'pound', 'pounds']],
  ['ml', 'ml', 'Volume', 1, ['millilitre', 'millilitres', 'milliliter', 'milliliters']], ['l', 'L', 'Volume', 1000, ['litre', 'litres', 'liter', 'liters', 'ltr']],
  ['tsp', 'tsp', 'Volume', 5, ['teaspoon', 'teaspoons']], ['tbsp', 'tbsp', 'Volume', 15, ['tablespoon', 'tablespoons']],
  ['cup', 'cup', 'Volume', 250, ['cups', 'metric cup']], ['cup_uk', 'UK cup', 'Volume', 284.131, ['uk cups']], ['cup_us', 'US cup', 'Volume', 236.588, ['us cups']],
  ['floz_uk', 'UK fl oz', 'Volume', 28.4131, ['fl oz', 'floz']], ['floz_us', 'US fl oz', 'Volume', 29.5735, []],
  ['pint_uk', 'UK pint', 'Volume', 568.261, ['pint', 'pints', 'uk pints']], ['pint_us', 'US pint', 'Volume', 473.176, ['us pints']],
  ['quart_uk', 'UK quart', 'Volume', 1136.52, ['quart', 'quarts']], ['quart_us', 'US quart', 'Volume', 946.353, ['us quarts']],
  ['gal_uk', 'UK gallon', 'Volume', 4546.09, ['gallon', 'gallons', 'uk gallons', 'uk gal', 'gal']], ['gal_us', 'US gallon', 'Volume', 3785.41, ['us gallons', 'us gal']],
  ['c', '°C', 'Temperature', 1, ['°c', 'degrees']],
];
export const UNIT_GROUPS = ['Count', 'Weight', 'Volume', 'Temperature'];
const unitOf = id => UNITS.find(u => u[0] === id) || ['', id || '', 'Count', 1, []];
export const unitLabel = id => unitOf(id)[1];
export const unitGroup = id => unitOf(id)[2];
// Everything a unit can be typed as, longest first so "UK gallon" wins over "gallon".
const UNIT_WORDS = UNITS.flatMap(u => (u[0] ? [u[0], u[1]].concat(u[4]) : u[4]).map(w => [w.toLowerCase(), u[0]])).sort((a, b) => b[0].length - a[0].length);

const FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const NICE = [[0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.375, '⅜'], [0.5, '½'], [0.625, '⅝'], [2 / 3, '⅔'], [0.75, '¾'], [0.875, '⅞']];
const QTY = '(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d*[.,]?\\d+\\s*[½⅓⅔¼¾⅛⅜⅝⅞]?|[½⅓⅔¼¾⅛⅜⅝⅞])';

// "1 1/2", "3/4", "0,5", "2½", "½" → number
export function parseQty(text) {
  const clean = String(text ?? '').trim().replace(',', '.');
  if (!clean) return null;
  const mixed = clean.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return +mixed[1] + mixed[2] / mixed[3];
  const frac = clean.match(/^(\d+)\/(\d+)$/);
  if (frac) return frac[1] / frac[2];
  const uni = clean.match(/^(\d*\.?\d*)\s*([½⅓⅔¼¾⅛⅜⅝⅞])$/);
  if (uni) return (+uni[1] || 0) + FRACTIONS[uni[2]];
  const plain = Number(clean);
  return Number.isFinite(plain) ? plain : null;
}

// Counted things show as fractions (½ onion), measured ones as decimals (1.25 L, 3268 g).
export function qtyText(qty, unit = '') {
  if (qty == null || qty === '') return '';
  if (unitGroup(unit) === 'Count' || /^(tsp|tbsp|cup)/.test(unit)) {
    const whole = Math.floor(qty + 1e-9);
    const rest = qty - whole;
    if (rest < 0.02) return String(whole);
    const near = NICE.find(([v]) => Math.abs(v - rest) < 0.02);
    if (near) return `${whole || ''}${near[1]}`;
  }
  const digits = qty >= 1000 ? 0 : qty >= 100 ? 1 : 2;
  return String(+qty.toFixed(digits));
}

// "3268 g", "5 UK gallon", "½" (a counted thing needs no unit)
export function amountText(ing, times = 1) {
  const qty = ing.qty == null ? null : ing.qty * times;
  const unit = unitOf(ing.unit);
  const label = unit[2] === 'Count' && unit[0] && qty > 1 && unit[4][0] ? unit[4][0] : unit[1];   // 3 cloves, 2 tins
  const num = qtyText(qty, ing.unit);
  if (!num) return label;
  return label ? `${num}${/^(g|kg|mg|ml|L)$/.test(label) ? '' : ' '}${label}` : num;
}
export const ingredientText = (ing, times = 1) => [amountText(ing, times), ing.item].filter(Boolean).join(' ');

// One typed line → an ingredient: "3268g honey, Asda Orange Blossom", "½ onion", "Honey 3268 g", "2 UK cup flour (strong)"
// Once (1.49.12, Mat: "3 cloves" had become 3 of the unit clove with no ingredient): an ingredient with a count unit
// and no name gets the unit's word as its name, and a nameless copy added for a step's {cloves} goes.
export async function fixBareUnits() {
  for (const c of ['recipes', 'recipe_makes']) for (const r of await store.list(c)) {
    const bare = (r.ingredients || []).filter(i => !String(i.item || '').trim() && i.unit && unitGroup(i.unit) === 'Count');
    if (!bare.length) continue;
    const words = bare.map(i => (UNITS.find(u => u[0] === i.unit)[4][0] || i.unit));
    const ingredients = r.ingredients.filter(i => !(i.qty == null && !i.unit && words.includes(String(i.item).toLowerCase()) && !i.note)).map(i => (bare.includes(i) ? Object.assign({}, i, { unit: '', item: words[bare.indexOf(i)] }) : i));
    await store.update(c, r.id, { ingredients });
  }
  await store.updateSettings({ batch_units_fix: 1 });
}

export function parseLine(line) {
  let text = line.replace(/^\s*[-*•]\s*/, '').trim();
  if (!text) return null;
  let note = '';
  const paren = text.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (paren) { text = paren[1]; note = paren[2]; } else {
    const comma = text.match(/^(.*?)\s*(?:,\s+|\s-\s)\s*(.+)$/);
    if (comma) { text = comma[1]; note = comma[2]; }
  }
  const unitAt = rest => {
    const low = rest.toLowerCase();
    for (const [w, id] of UNIT_WORDS) if (low === w || low.startsWith(`${w} `) || (low.startsWith(w) && /^[^a-z]/i.test(low.slice(w.length)) && low.length > w.length)) return [id, rest.slice(w.length).replace(/^\s*(of\s+)?/i, '')];
    return null;
  };
  const front = text.match(new RegExp(`^${QTY}\\s*(.*)$`));
  if (front) {
    const qty = parseQty(front[1]);
    let got = unitAt(front[2]);
    if (got && !got[1].trim() && unitGroup(got[0]) === 'Count') got = null;   // "3 cloves" alone: 3 of the spice, not 3 cloves of nothing
    return { id: store.uuidv7(), qty, unit: got ? got[0] : '', item: (got ? got[1] : front[2]).trim(), note };
  }
  // The amount at the end: "Honey 3268g", "Water 20.42 L"
  const back = text.match(new RegExp(`^(.*?)\\s+${QTY}\\s*([^\\d]*)$`));
  if (back) {
    const got = back[3] ? unitAt(back[3]) : null;
    if (!back[3] || (got && !got[1])) return { id: store.uuidv7(), qty: parseQty(back[2]), unit: got ? got[0] : '', item: back[1].trim(), note };
  }
  return { id: store.uuidv7(), qty: null, unit: '', item: text, note };
}

// ---------- references in a step ----------

const REF = /\{([^{}|]+?)(?:\|([^{}]*))?\}/g;
// "1/2 salt" → [0.5, "salt"]; "25% honey" → [0.25, "honey"]; "salt" → [1, "salt"]
function refParts(body) {
  const pct = body.match(/^\s*(\d+(?:\.\d+)?)\s*%\s+(.+)$/);
  if (pct) return [pct[1] / 100, pct[2].trim()];
  const part = body.match(new RegExp(`^\\s*${QTY}\\s+(.+)$`));
  if (part && parseQty(part[1]) != null) return [parseQty(part[1]), part[2].trim()];
  const half = body.match(/^\s*(half|a third|a quarter)\s+(?:of\s+)?(?:the\s+)?(.+)$/i);
  if (half) return [{ half: 0.5, 'a third': 1 / 3, 'a quarter': 0.25 }[half[1].toLowerCase()], half[2].trim()];
  return [1, body.trim()];
}
export function findIngredient(ingredients, name) {
  const low = name.toLowerCase();
  return ingredients.find(i => i.item.toLowerCase() === low)
    || ingredients.find(i => i.item.toLowerCase().startsWith(low))
    || ingredients.find(i => i.item.toLowerCase().includes(low));
}
const OWN_AMOUNT = /[\d½¼¾⅓⅔⅛]|^\s*(?:the|a|an|some|half|more|loads?|lots?|bit|knob|handful|drizzle|glug|splash|few|and|all|rest|remaining|whole|plenty|season)\b/i;
// A step as HTML: references become marked amounts; a reference to nothing stays as typed, marked as missing.
export function stepHtml(text, ingredients, times, esc) {
  return esc(text || '').replace(/\{([^{}|]+?)(?:\|([^{}]*))?\}/g, (whole, body, own) => {
    const [part, name] = refParts(body.replace(/&amp;/g, '&'));
    const ing = findIngredient(ingredients, name);
    if (!ing) return `<span class="bb-ref bb-ref-missing" title="No ingredient called that">${whole}</span>`;
    const full = ingredientText(ing, times);
    const amount = amountText(ing, times * part);
    // own words get the amount too ("the stock" → "the 200ml stock"), unless they already say how much ("3 cloves", "a bit of salt", "the rest")
    const [, the = '', words = own] = (own || '').match(/^(\s*the\s+)(.*)$/is) || [];
    const shown = own == null ? esc(ingredientText(ing, times * part)) : amount && !OWN_AMOUNT.test(words) ? `${the}${esc(amount)} ${words}` : own;
    return `<span class="bb-ref" title="${esc(part === 1 ? full : `${qtyText(part)} of ${full}`)}">${shown}</span>`;
  }).replace(/\n/g, '<br>');
}
// An ingredient renamed: its references follow.
export function renameRefs(text, from, to) {
  if (!from || !to || from === to) return text;
  return (text || '').replace(REF, (whole, body, own) => {
    const [, name] = refParts(body);
    if (name.toLowerCase() !== from.toLowerCase()) return whole;
    return `{${body.slice(0, body.toLowerCase().lastIndexOf(name.toLowerCase()))}${to}${own != null ? `|${own}` : ''}}`;
  });
}

// ---------- importing recipes as text ----------

// Recipes typed or pasted as plain text (Markdown works), any number in one go:
//   # Title                      starts a recipe
//   Book: Cooking / Tags: a, b   lines straight under the title; any other "Name: value" is a detail (Serves: 4)
//   other text                   the description
//   ## Ingredients               one per line; a "### For the sauce" line notes the group on the lines under it
//   ## Method                    numbered or bulleted steps; indented lines stay in their step, a ### line heads the next step;
//                                {flour}, {1/2 flour} or {flour|a little flour} in a step is the ingredient with its amount
//                                (as Put in makes); one not in the list is added to it, with no amount
//   ## Notes                     the tasting notes
export const IMPORT_EXAMPLE = `# Quick flatbreads
Book: Cooking
Tags: bread, quick
Serves: 4

Soft flatbreads in 20 minutes.

## Ingredients
- 250 g self-raising flour
- 250 g Greek yoghurt
- 1 pinch salt
### To serve
- 2 tbsp butter, melted

## Method
1. Mix the {self-raising flour}, {Greek yoghurt} and {salt} into a soft dough.
2. Split into 4 and roll out thin.
3. Dry fry 2 mins each side, then brush with {1/2 butter}.
   - Keep them warm in a tea towel.

## Notes
Good with anything saucy.`;
export function parseRecipes(text) {
  const recipes = [];
  let rec = null, part = 'head', group = '', head = '', step = null;
  const add = t => { step = { id: store.uuidv7(), text: head ? `${head}\n${t}` : t }; head = ''; rec.steps.push(step); };
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\t/g, '  ').trimEnd(), trim = line.trim();
    const h = trim.match(/^(#{1,3})\s+(.+)$/);
    if (h && h[1] === '#') { rec = { title: h[2].trim(), type: '', tags: [], description: '', ingredients: [], steps: [], tasting: '', fields: {} }; recipes.push(rec); part = 'head'; group = head = ''; step = null; continue; }
    if (!rec) continue;
    if (h && h[1] === '##') { const name = h[2].toLowerCase(); part = /ingredient|need/.test(name) ? 'ing' : /method|step|direction|instruction/.test(name) ? 'method' : /note|tasting/.test(name) ? 'notes' : 'desc'; group = head = ''; step = null; continue; }
    if (h) { if (part === 'ing') group = h[2].trim(); else if (part === 'method') head = h[2].trim(), step = null; continue; }
    if (!trim) { if (part === 'head') part = 'desc'; if (part === 'desc' && rec.description) rec.description += '\n'; if (part === 'notes' && rec.tasting) rec.tasting += '\n'; continue; }
    if (part === 'head') {
      const kv = trim.match(/^([A-Za-z][\w ]{0,30}):\s*(.+)$/);
      if (kv) { const key = kv[1].trim(), low = key.toLowerCase();
        if (low === 'book') rec.type = kv[2].trim(); else if (low === 'tags') rec.tags = kv[2].split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean); else rec.fields[key] = kv[2].trim();
        continue; }
      part = 'desc';
    }
    if (part === 'desc') { rec.description += `${rec.description && !rec.description.endsWith('\n') ? '\n' : ''}${trim}`; continue; }
    if (part === 'notes') { rec.tasting += `${rec.tasting && !rec.tasting.endsWith('\n') ? '\n' : ''}${line}`; continue; }
    if (part === 'ing') { const ing = parseLine(trim); if (ing && group) { const g = group[0].toLowerCase() + group.slice(1); ing.note = ing.note ? `${g}; ${ing.note}` : g; } if (ing) rec.ingredients.push(ing); continue; }
    const bullet = trim.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (step && /^\s/.test(line)) step.text += `\n${bullet ? `- ${bullet[1]}` : trim}`;
    else add(bullet ? bullet[1] : trim);
  }
  for (const r of recipes) {
    r.description = r.description.trim(); r.tasting = r.tasting.trim();
    for (const st of r.steps) for (const [, body] of st.text.matchAll(REF)) { const name = refParts(body)[1]; if (name && !findIngredient(r.ingredients, name)) r.ingredients.push({ id: store.uuidv7(), qty: null, unit: '', item: name, note: '' }); }
  }
  return recipes.filter(r => r.title);
}

// ---------- batches ----------

// The kinds of reading a book's batches have (e.g. Gravity, Temperature); books from before kinds could be named have Gravity.
export const readingTypesOf = sec => (!sec.readings ? [] : sec.reading_types?.length ? sec.reading_types : ['Gravity']);
export const isGravity = type => /^gravity$/i.test(type || 'Gravity');

// ABV from the first and last gravity readings: (OG − FG) × 131.25
export function abvOf(readings) {
  const sorted = readings.filter(r => r.gravity && isGravity(r.type)).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.created_at.localeCompare(b.created_at));
  const og = sorted.find(r => r.label === 'OG') || sorted[0];
  const fg = sorted.findLast(r => r.label === 'FG') || sorted.at(-1);
  if (!og || !fg || og === fg) return null;
  return { og: og.gravity, fg: fg.gravity, abv: (og.gravity - fg.gravity) * 131.25, final: fg.label === 'FG' };
}

// Next batch number in a section: one more than the highest so far.
export function nextBatchNo(makes, recipes, type) {
  const ids = new Set(recipes.filter(r => (r.type || '') === (type || '')).map(r => r.id));
  const nums = makes.filter(m => ids.has(m.recipe_id)).map(m => parseInt(m.batch_no, 10)).filter(Number.isFinite);
  return String(nums.length ? Math.max.apply(null, nums) + 1 : 1);
}

export async function loadBook() {
  const [recipes, makes, entries] = await Promise.all([
    store.list('recipes', { filter: r => !r.archived_at }),
    store.list('recipe_makes', { filter: m => !m.archived_at }),
    store.list('recipe_entries'),
  ]);
  return { recipes: recipes.sort((a, b) => (a.title || '').localeCompare(b.title || '')), makes: makes.sort((a, b) => (b.date || '').localeCompare(a.date || '')), entries };
}

// ---------- archive & bin ----------

export const binProvider = {
  area: 'recipes',
  get label() { return 'Batch Book'; },
  async entries(kind) {
    const inState = r => !r.purged_at && (kind === 'bin' ? !!r.deleted_at : !r.deleted_at && !!r.archived_at);
    const at = r => (kind === 'bin' ? r.deleted_at : r.archived_at);
    const recipes = await store.list('recipes', { includeDeleted: true });
    const makes = await store.list('recipe_makes', { includeDeleted: true });
    const out = [];
    const claimed = new Set();
    const together = (a, b) => a.deleted_at && b.deleted_at && Math.abs(Date.parse(a.deleted_at) - Date.parse(b.deleted_at)) < 5000;
    for (const r of recipes.filter(inState)) {
      const kids = kind === 'bin' ? makes.filter(m => m.recipe_id === r.id && together(m, r)) : [];
      kids.forEach(k => claimed.add(k.id));
      out.push({ collection: 'recipes', id: r.id, kind: 'Recipe', title: r.title || 'Untitled', subtitle: r.type || '', detail: kids.length ? `${kids.length} batches` : '', at: at(r), children: kids.map(k => ({ collection: 'recipe_makes', id: k.id })), search: `${r.title} ${r.type}` });
    }
    const title = new Map(recipes.map(r => [r.id, r.title]));
    for (const m of makes.filter(inState)) {
      if (claimed.has(m.id)) continue;
      out.push({ collection: 'recipe_makes', id: m.id, kind: 'Batch', title: batchName(m, title.get(m.recipe_id)), subtitle: title.get(m.recipe_id) || '', detail: m.date || '', at: at(m), children: [], search: `${batchName(m, title.get(m.recipe_id))} ${title.get(m.recipe_id) || ''}` });
    }
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  },
};

// A batch's name: its own, else (older batches) its recipe's name and the day it was started.
export const batchDay = iso => (iso ? dateText(new Date(`${iso.slice(0, 10)}T12:00`), { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const newBatchName = (recipeTitle, iso) => `${recipeTitle || 'Untitled'} - ${batchDay(iso)}`;
export const batchName = (m, recipeTitle) => m.name || newBatchName(recipeTitle, m.date);

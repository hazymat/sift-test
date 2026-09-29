// Batch Book: recipes and every batch made from them (views/recipes.js).
//   recipes:        title, type, description, ingredients[] ({ id, qty, unit, item, note }), method (text with {references}),
//                   tasting (notes), fields ({ label: value }, e.g. Batch volume), sort_order
//   recipe_makes:   recipe_id, batch_no, date (YYYY-MM-DD), status (planned|going|done), description, state,
//                   fields, back_sweetened, ingredients[] and method (copied from the recipe, so later changes to it
//                   don't rewrite what was made), stock ({ ingredient id: have|need }), list_id
//   recipe_entries: make_id, kind (diary|tasting|reading), date, text; readings also: label (OG|SG|FG), gravity
// Photos are attachments on any of the three.
//
// In a method, {salt} shows the ingredient with its amount ("2 tsp salt"), {1/2 salt} or {50% salt} part of it,
// and {salt|a pinch of salt} your own words (still marked as the ingredient).

import * as store from './store.js';

// Each type decides the extra fields a recipe starts with, and whether batches have gravity readings.
export const TYPES = [
  { id: 'Mead', emoji: '🐝', colour: '#c8961e', readings: true, fields: ['Batch volume', 'ABV goal', 'Sweetness goal'] },
  { id: 'Winemaking', emoji: '🍷', colour: '#9b2f52', readings: true, fields: ['Batch volume', 'ABV goal', 'Sweetness goal'] },
  { id: 'Cider', emoji: '🍏', colour: '#6e9a2c', readings: true, fields: ['Batch volume', 'ABV goal', 'Sweetness goal'] },
  { id: 'Brewing', emoji: '🍺', colour: '#c07a16', readings: true, fields: ['Batch volume', 'ABV goal'] },
  { id: 'Breadmaking', emoji: '🍞', colour: '#a8733a', readings: false, fields: ['Makes', 'Hydration'] },
  { id: 'Cooking', emoji: '🍲', colour: '#3f8a5c', readings: false, fields: ['Serves', 'Time'] },
  { id: 'Preserves', emoji: '🫙', colour: '#c0502e', readings: false, fields: ['Makes'] },
];
const OTHER = { emoji: '📖', colour: '#7a6a55', readings: false, fields: [] };
export const typeOf = id => TYPES.find(t => t.id === id) || Object.assign({}, OTHER, { id: id || '' });

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
  const label = unitLabel(ing.unit);
  const num = qtyText(qty, ing.unit);
  if (!num) return label;
  return label ? `${num}${/^(g|kg|mg|ml|L)$/.test(label) ? '' : ' '}${label}` : num;
}
export const ingredientText = (ing, times = 1) => [amountText(ing, times), ing.item].filter(Boolean).join(' ');

// One typed line → an ingredient: "3268g honey, Asda Orange Blossom", "½ onion", "Honey 3268 g", "2 UK cup flour (strong)"
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
    const got = unitAt(front[2]);
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

// ---------- references in a method ----------

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
// The method as HTML: references become marked amounts; a reference to nothing stays as typed, marked as missing.
export function methodHtml(text, ingredients, times, esc) {
  return esc(text || '').replace(/\{([^{}|]+?)(?:\|([^{}]*))?\}/g, (whole, body, own) => {
    const [part, name] = refParts(body.replace(/&amp;/g, '&'));
    const ing = findIngredient(ingredients, name);
    if (!ing) return `<span class="bb-ref bb-ref-missing" title="No ingredient called that">${whole}</span>`;
    const full = ingredientText(ing, times);
    const shown = own != null ? own : ingredientText(ing, times * part);
    return `<span class="bb-ref" title="${esc(part === 1 ? full : `${qtyText(part)} of ${full}`)}">${own != null ? shown : esc(shown)}</span>`;
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

// ---------- batches ----------

// ABV from the first and last gravity readings: (OG − FG) × 131.25
export function abvOf(readings) {
  const sorted = readings.filter(r => r.gravity).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.created_at.localeCompare(b.created_at));
  const og = sorted.find(r => r.label === 'OG') || sorted[0];
  const fg = sorted.findLast(r => r.label === 'FG') || sorted.at(-1);
  if (!og || !fg || og === fg) return null;
  return { og: og.gravity, fg: fg.gravity, abv: (og.gravity - fg.gravity) * 131.25, final: fg.label === 'FG' };
}

// Next batch number for a type: one more than the highest so far.
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
      out.push({ collection: 'recipe_makes', id: m.id, kind: 'Batch', title: `Batch #${m.batch_no || '?'}`, subtitle: title.get(m.recipe_id) || '', detail: m.date || '', at: at(m), children: [], search: `${m.batch_no} ${title.get(m.recipe_id) || ''}` });
    }
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  },
};

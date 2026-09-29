// The Custom theme (Settings → Appearance → Custom…): a starting theme plus
// the fonts and colours the user picked, section by section. Only what was
// picked changes; everything else stays as the starting theme draws it.
// Saved in settings.custom_theme { base, values: { 'section.field': value } }
// and turned into one <style> (see css()); index.html puts the last one back
// before first paint from siftTestStorage 'sift-custom'. The editor shows each
// section as a mockup (thememocks.js): press a thing to change it.
import { askYes } from './ask.js';
import { MOCKS } from './thememocks.js';

export const HAND = '"Segoe Print", "Bradley Hand", "Noteworthy", "Chalkboard SE", "Comic Sans MS", cursive';
// Only fonts already on phones and computers (nothing is downloaded).
export const FONTS = [
  ['system', 'Plain', 'system-ui, -apple-system, "Segoe UI", sans-serif'],
  ['hand', 'Handwriting', HAND], // the Schedule times' font on the Sift test site
  ['marker', 'Marker', '"Marker Felt", "Segoe Script", "Bradley Hand", cursive'],
  ['rounded', 'Rounded', 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif'],
  ['serif', 'Serif', 'Georgia, "Times New Roman", serif'],
  ['book', 'Book', '"Palatino Linotype", Palatino, "Book Antiqua", serif'],
  ['typewriter', 'Typewriter', '"American Typewriter", "Courier New", Courier, monospace'],
  ['mono', 'Code', 'ui-monospace, "Cascadia Code", "SF Mono", Consolas, Menlo, monospace'],
  ['narrow', 'Narrow', '"Avenir Next Condensed", "Arial Narrow", sans-serif-condensed, sans-serif'],
];
const fontStack = id => FONTS.find(f => f[0] === id)?.[2];
export const BASES = ['glass', 'glass-fancy', 'dark', 'light'];

// A field: [key, label, what it sets]. What it sets is either a CSS variable
// for the section's scope ('--text') or [selector inside the scope, property].
// A key ending in "font" takes a font, "blur" how frosted panels are, anything
// else a colour (#rrggbb, or #rrggbbaa when see-through). Scopes match the page
// (#main) and the editor's mockup (.ct-mock) with the same weight.
const everyArea = [['text', 'Text', '--text'], ['muted', 'Faint text', '--muted'], ['accent', 'Links and highlights', '--accent'], ['panel', 'Panels', '--glass'], ['font', 'Font', '--font'], ['handfont', 'Headings font', '--hand-keep']];
const scopeOf = id => `:is(#main, .ct-mock)[data-area="${id}"]`;
const area = (id, label, extra = []) => ({ id, label, scope: scopeOf(id), fields: everyArea.concat(extra) });
export const SECTIONS = [
  { id: 'app', label: 'Whole app', scope: '', fields: [
    ['bg', 'Background', '--bg'], ['text', 'Text', '--text'], ['muted', 'Faint text', '--muted'], ['accent', 'Links and highlights', '--accent'],
    ['panel', 'Panels', '--glass'], ['edge', 'Panel edges', '--glass-border'], ['sheet', 'Sheets and pop-ups', '--glass-strong'], ['menu', 'Menus', '--menu-bg'],
    ['font', 'Font', '--font'], ['notesfont', 'Notes and lists font', '--hand'], ['handfont', 'Headings font', '--hand-keep'], ['blur', 'Frosted glass', '--blur'],
  ] },
  { id: 'bars', label: 'Top and bottom bars', scope: '', fields: [['bg', 'Background', ['.appbar, .tabbar', 'background']], ['text', 'Text', ['.appbar, .tab, .tab[aria-current]', 'color']], ['font', 'Font', ['.appbar, .tabbar', 'font-family']]] },
  area('dump', 'Brain Dump', [['note', 'Notes', ['.thought-body', 'color']], ['notefont', 'Notes font', ['.thought-body, .thought-edit', 'font-family']]]),
  area('tasks', 'Tasks', [['title', 'Task names', ['.task-title', 'color']], ['titlefont', 'Task names font', ['.task-title', 'font-family']], ['note', 'Task notes', ['.item-note, .task-notes .rich-edit', 'color']], ['notefont', 'Task notes font', ['.item-note, .task-notes .rich-edit', 'font-family']]]),
  { id: 'planner', label: 'Day Planner', scope: `${scopeOf('planner')} .planner`, fields: [
    ['text', 'Text', '--text'], ['muted', 'Faint text', '--muted'], ['ink', 'Ink', '--ink'],
    ['day', 'Day title', ['.day-title .weekday, .day-title .date', 'color']], ['dayfont', 'Day title font', ['.day-title .weekday, .day-title .date', 'font-family']],
    ['heads', 'Schedule, Tasks and Notes titles', ['.schedule-title, .pile h2, .day-tasks h2, .day-notes h2', 'color']], ['headsfont', 'Schedule, Tasks and Notes titles font', ['.schedule-title, .pile h2, .day-tasks h2, .day-notes h2', 'font-family']],
    ['labels', 'Day focus and Energy', ['.focus > span, .hand-label', 'color']], ['labelsfont', 'Day focus and Energy font', ['.focus > span, .hand-label', 'font-family']],
    ['times', 'Schedule times', ['.line .margin', 'color']], ['timesfont', 'Schedule times font', ['.line .margin, .line.section-label .content', 'font-family']],
    ['items', 'Schedule and Tasks lines', ['.line .item-title, .day-task-list .task-link', 'color']], ['itemsfont', 'Schedule and Tasks lines font', ['.line .item-title, .day-task-list .task-link', 'font-family']],
    ['notesfont', 'Notes font', ['.day-notes .rich-edit', 'font-family']],
    ['rule', 'Ruled lines', '--rule'], ['margin', 'Margin line', '--margin-rule'], ['focusink', 'Day focus ink', '--focus-ink'], ['energyink', 'Energy ink', '--energy-ink'],
  ] },
  area('lists', 'Lists', [['title', 'List items', ['.task-title', 'color']], ['titlefont', 'List items font', ['.task-title', 'font-family']]]),
  area('places', 'Find Things'), area('contacts', 'Contacts'), area('scans', 'Scans'), area('contracts', 'Contracts'), area('recipes', 'Recipes'), area('bin', 'Archive and Bin'), area('settings', 'Settings'),
];
export const isFont = key => key.endsWith('font');
const isBlur = key => key.endsWith('blur');
const COLOUR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

// The CSS for the picked values. html:root[data-custom] outweighs every theme
// and paper rule it replaces, and #main (or the planner) the area's own rules.
export function css(values = {}) {
  const out = [];
  for (const sec of SECTIONS) {
    const vars = [];
    for (const [key, , sets] of sec.fields) {
      const raw = values[`${sec.id}.${key}`];
      const value = isFont(key) ? fontStack(raw) : isBlur(key) ? (/^\d{1,2}$/.test(raw || '') ? `blur(${raw}px)` : null) : COLOUR.test(raw || '') ? raw : null;
      if (!value) continue;
      const scope = `html:root[data-custom] ${sec.scope}`.trim();
      if (typeof sets === 'string') {
        vars.push(`${sets}: ${value};`);
        if (sets === '--bg') vars.push('--bg-image: none;');
        if (sets === '--blur') vars.push(`--blur-strong: blur(${Math.round(raw * 1.5)}px);`);
      } else out.push(`${sets[0].split(', ').map(s => `${scope} ${s}`).join(', ')} { ${sets[1]}: ${value} !important; }`);
    }
    if (vars.length) out.unshift(`${`html:root[data-custom] ${sec.scope}`.trim()} { ${vars.join(' ')} }`);
  }
  return out.join('\n');
}


const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fieldOf = id => { const [secId, key] = id.split('.'); const sec = SECTIONS.find(x => x.id === secId); const f = sec?.fields.find(x => x[0] === key); return f && { sec, key, label: f[1], sets: f[2] }; };

// ---------- colours: reading, contrast ----------

// Any CSS colour as { r, g, b, a } (0-255, alpha 0-1), resolved by the browser.
let probeEl = null;
function rgba(colour) {
  if (!probeEl) { probeEl = document.createElement('i'); probeEl.hidden = true; document.body.append(probeEl); }
  probeEl.style.color = '';
  probeEl.style.color = colour || 'transparent';
  return parse(getComputedStyle(probeEl).color);
}
// Computed colours come as rgb()/rgba(), or color(srgb r g b / a) from color-mix().
function parse(text) {
  let m = String(text).match(/rgba?\(([\d.]+),?\s*([\d.]+),?\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4] };
  m = String(text).match(/color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?/);
  if (m) return { r: m[1] * 255, g: m[2] * 255, b: m[3] * 255, a: m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4] };
  return { r: 0, g: 0, b: 0, a: 0 };
}
const two = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const toHex = c => `#${two(c.r)}${two(c.g)}${two(c.b)}${c.a < 1 ? two(c.a * 255) : ''}`;
// "#1f2d3d" or "#1f2d3d, 30% see-through", for messages.
const describe = c => `${toHex(Object.assign({}, c, { a: 1 }))}${c.a < 1 ? `, ${Math.round((1 - c.a) * 100)}% see-through` : ''}`;
const SOLID = new Set(['app.bg']); // nothing behind the page's background to see through to
const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + .05) / (lo + .05); };

// What's behind an element: its own and its parents' backgrounds, stacked up
// to the first solid one (pictures and gradients are left out).
function behind(el) {
  const layers = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const c = parse(getComputedStyle(n).backgroundColor);
    if (c.a > 0) layers.push(c);
    if (c.a >= 1 || n.classList.contains('ct-mock')) break;
  }
  let base = rgba(getComputedStyle(document.documentElement).getPropertyValue('--bg')); base.a = 1;
  for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
  return base;
}
// Every bit of writing in the mockup, and how well it stands out from what's behind it.
const MIN_CONTRAST = 3;
function readability(root) {
  const out = new Map();
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('svg, [aria-hidden="true"]') || !el.getClientRects().length) continue;
    const text = (el.matches('input, textarea') ? el.value : Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('')).trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const bg = behind(el);
    out.set(el, { ratio: ratio(over(parse(cs.color), bg), bg), text });
  }
  return out;
}

// ---------- the #main rules, for the mockups ----------

// Much of the app's look hangs off #main (spacing, shading, areas). The
// mockups aren't #main, so those rules are copied for .ct-mock while the
// editor is open. Rules that reach outside #main (body:has(...)) are left out.
function splitTop(list) {
  const out = []; let depth = 0, from = 0;
  for (let n = 0; n < list.length; n++) {
    if (list[n] === '(') depth++; else if (list[n] === ')') depth--;
    else if (list[n] === ',' && !depth) { out.push(list.slice(from, n)); from = n + 1; }
  }
  return out.concat(list.slice(from)).map(s => s.trim());
}
function mirror(rules) {
  let text = '';
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      const sels = splitTop(rule.selectorText).filter(s => s.startsWith('#main')).map(s => s.replace(/^#main/, '.ct-mock'));
      if (sels.length) text += `${sels.join(', ')} { ${rule.style.cssText} }\n`;
    } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
      const inner = mirror(rule.cssRules);
      if (inner) text += `@${rule instanceof CSSMediaRule ? 'media' : 'supports'} ${rule.conditionText} {\n${inner}}\n`;
    }
  }
  return text;
}
function mirrorMain() {
  if (document.getElementById('ct-mirror')) return;
  let text = '';
  for (const sheet of document.styleSheets) { try { text += mirror(sheet.cssRules); } catch {} }
  const st = Object.assign(document.createElement('style'), { id: 'ct-mirror', textContent: text });
  document.getElementById('custom-theme-css')?.before(st) || document.head.append(st);
}

// ---------- the editor ----------

// What a field shows now, read off the mockup (or the page, for the whole app).
function shownNow(mock, sec, sets) {
  if (typeof sets === 'string') {
    const from = sec.id === 'app' || sec.id === 'bars' ? document.documentElement : sec.id === 'planner' ? mock.querySelector('.planner') || mock : mock;
    return getComputedStyle(from).getPropertyValue(sets).trim();
  }
  const el = mock.querySelector(sets[0]);
  return el ? getComputedStyle(el).getPropertyValue(sets[1]) : '';
}

// One field's controls. Colours: the colour and how see-through it is.
// Fonts: a dropdown drawn in each font. Frosted glass: how much blur.
function control(id, picked, now) {
  const { key, label } = fieldOf(id);
  if (isFont(key)) {
    const stack = fontStack(picked);
    return `<select data-field="${id}" aria-label="${esc(label)}"${stack ? ` style="font-family:${esc(stack)}"` : ''}><option value="">As the theme</option>${FONTS.map(([f, name, s]) => `<option value="${f}" style="font-family:${esc(s)}"${picked === f ? ' selected' : ''}>${name}</option>`).join('')}</select>`;
  }
  if (isBlur(key)) {
    const px = picked ?? (Number((now.match(/[\d.]+/) || [20])[0]) || 0);
    return `<span class="ct-slide"><input type="range" min="0" max="40" value="${px}" data-field="${id}" aria-label="${esc(label)}"><span class="ct-num">${px}px</span></span>`;
  }
  const c = rgba(picked || now);
  const clear = Math.round((1 - c.a) * 100);
  return `<span class="ct-colour"><input type="color" data-field="${id}" data-part="rgb" value="${toHex(Object.assign({}, c, { a: 1 }))}" aria-label="${esc(label)}">`
    + (SOLID.has(id) ? '</span>' : `<span class="ct-slide" title="See-through: 0% is solid"><span class="ct-num-label">See-through</span><input type="range" min="0" max="100" value="${clear}" data-field="${id}" data-part="clear" aria-label="${esc(label)}: see-through"><span class="ct-num">${clear}%</span></span></span>`);
}

export function openEditor({ app, paper }) {
  let dlg = document.getElementById('custom-theme');
  if (dlg) { dlg.showModal(); dlg.dispatchEvent(new Event('ct-open')); return; }
  mirrorMain();
  dlg = document.createElement('dialog');
  dlg.id = 'custom-theme';
  dlg.className = 'custom-theme';
  dlg.setAttribute('aria-label', 'Custom theme');
  document.body.append(dlg);
  let secId = document.getElementById('main')?.dataset.area;
  if (!SECTIONS.some(s => s.id === secId)) secId = 'app';
  const values = () => app.customTheme().values;
  const sec = () => SECTIONS.find(s => s.id === secId);
  const mock = () => dlg.querySelector('.ct-mock');
  const setCss = vals => { document.getElementById('custom-theme-css').textContent = css(vals); };

  const row = id => {
    const f = fieldOf(id);
    const picked = values()[id];
    return `<div class="ct-row${picked ? ' is-set' : ''}" data-row="${id}"><span class="ct-label">${f.label}</span>${control(id, picked, shownNow(mock(), f.sec, f.sets))}<button type="button" class="ct-reset" data-reset="${id}" aria-label="Back to the theme's ${esc(f.label.toLowerCase())}" title="Back to the theme's"${picked ? '' : ' hidden'}>↺</button></div>`;
  };
  const drawList = () => { dlg.querySelector('.ct-all-rows').innerHTML = sec().fields.map(f => row(`${secId}.${f[0]}`)).join(''); };
  const redrawRows = () => {
    for (const r of dlg.querySelectorAll('[data-row]')) r.outerHTML = row(r.dataset.row);
  };
  const draw = () => {
    const { base } = app.customTheme();
    dlg.innerHTML = `
      <div class="ct-head">
        <h2>Custom theme</h2>
        <label class="ct-base"><span>Start from</span><select data-base>${BASES.map(b => `<option value="${b}"${b === base ? ' selected' : ''}>${esc(app.THEMES.find(t => t.id === b).label)}</option>`).join('')}</select></label>
        <button type="button" class="primary" data-act="done">Done</button>
      </div>
      <nav class="ct-tabs" role="tablist">${SECTIONS.map(s => `<button type="button" role="tab" data-sec="${s.id}" aria-selected="${s.id === secId}">${s.label}</button>`).join('')}</nav>
      <div class="ct-body">
        <p class="ct-intro muted">Point at anything below and press it to change its colour or font. Changes show straight away and are kept. ↺ puts one back.</p>
        <div class="ct-mock" data-area="${secId}" data-density="medium" data-shade="plain" data-layout-focus data-layout-energy data-layout-day-rel>${MOCKS[secId]({ paper })}</div>
        <details class="ct-all"><summary>Everything in ${esc(sec().label)}</summary><div class="ct-all-rows"></div></details>
        <p><button type="button" class="danger" data-act="reset-all">Put everything back</button></p>
      </div>
      <div class="ct-pop" hidden></div>
      <div class="ct-msg" role="status" aria-live="polite" hidden></div>`;
    for (const el of mock().querySelectorAll('[data-edit]')) { el.tabIndex = 0; el.setAttribute('role', 'button'); }
    for (const el of mock().querySelectorAll('input, select, textarea, a, button:not([data-edit])')) el.tabIndex = -1;
    const planner = mock().querySelector('.planner');
    planner?.classList.toggle('docked', planner.offsetWidth > 1000); // as the Day Planner itself: side column only when wide
    dlg.querySelector('.ct-tabs [aria-selected="true"]').scrollIntoView({ block: 'nearest', inline: 'nearest' });
    drawList();
  };

  // ---------- pressing a thing in the mockup ----------
  const pop = () => dlg.querySelector('.ct-pop');
  let hot = null;
  const setHot = el => { hot?.classList.remove('ct-hot'); hot = el; hot?.classList.add('ct-hot'); };
  const closePop = () => { pop().hidden = true; setHot(null); };
  function openPop(target) {
    const ids = target.dataset.edit.split(' ').filter(fieldOf);
    const p = pop();
    p.innerHTML = `<div class="ct-pop-head"><span>${esc(sec().label)}</span><button type="button" class="ct-pop-x" data-act="pop-close" aria-label="Close">✕</button></div>${ids.map(row).join('')}`;
    p.hidden = false;
    setHot(target);
    // Under the thing pressed, or over it when there's no room below.
    const box = dlg.getBoundingClientRect(), r = target.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left - box.left, box.width - p.offsetWidth - 8));
    const below = r.bottom - box.top + 8;
    p.style.left = `${left}px`;
    p.style.top = `${below + p.offsetHeight < box.height - 8 ? below : Math.max(8, r.top - box.top - p.offsetHeight - 8)}px`;
    p.querySelector('input, select')?.focus();
  }
  dlg.addEventListener('pointerover', e => { if (!pop().hidden) return; const t = e.target.closest?.('.ct-mock [data-edit]'); if (t !== hot) setHot(t); });
  dlg.addEventListener('pointerleave', () => { if (pop().hidden) setHot(null); });
  // Nothing in the mockup does what it does in the app: it only picks.
  dlg.addEventListener('mousedown', e => { if (e.target.closest('.ct-mock')) e.preventDefault(); });
  dlg.addEventListener('keydown', e => {
    const t = e.target.closest?.('.ct-mock [data-edit]');
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPop(t); }
  });
  // Esc closes the pop-up first, then the editor.
  dlg.addEventListener('cancel', e => { if (!pop().hidden) { e.preventDefault(); const back = hot; closePop(); back?.focus(); } });

  // ---------- changes ----------
  let msgTimer = 0;
  const say = html => { const m = dlg.querySelector('.ct-msg'); m.innerHTML = html; m.hidden = false; clearTimeout(msgTimer); msgTimer = setTimeout(() => { m.hidden = true; }, 6000); };
  // A field's value from its row's controls (a colour joins its colour and see-through).
  const valueOf = at => {
    const { key } = fieldOf(at.dataset.row);
    if (isFont(key)) return at.querySelector('select').value || null;
    if (isBlur(key)) return at.querySelector('input').value;
    const c = rgba(at.querySelector('[data-part="rgb"]').value);
    c.a = 1 - Number(at.querySelector('[data-part="clear"]')?.value || 0) / 100;
    return toHex(c);
  };
  // Saves a change, unless it would make some writing hard to read: then it's put back, with a message.
  async function commit(id, value) {
    const old = values()[id] ?? null;
    const { key, label } = fieldOf(id);
    if (!isFont(key) && !isBlur(key) && value) {
      setCss(Object.assign({}, values(), { [id]: old }));
      const before = readability(mock());
      setCss(Object.assign({}, values(), { [id]: value }));
      const worse = Array.from(readability(mock())).find(([el, r]) => r.ratio < MIN_CONTRAST && r.ratio < (before.get(el)?.ratio ?? Infinity) - .05);
      if (worse) {
        setCss(values());
        const back = rgba(old || shownNow(mock(), fieldOf(id).sec, fieldOf(id).sets));
        say(`<strong>Not enough contrast</strong>: “${esc(worse[1].text.slice(0, 40))}” would be hard to read. ${esc(label)} put back to <span class="swatch" style="--sw:${esc(toHex(back))}"></span> ${esc(describe(back))}${old ? '' : " (the theme's)"}.`);
        redrawRows();
        return;
      }
    }
    await app.setCustomTheme({ values: { [id]: value } });
    redrawRows();
  }
  dlg.addEventListener('input', e => {
    const id = e.target.dataset.field;
    if (!id) return;
    const num = e.target.parentElement.querySelector('.ct-num');
    if (num) num.textContent = `${e.target.value}${isBlur(fieldOf(id).key) ? 'px' : '%'}`;
    if (!isFont(fieldOf(id).key)) setCss(Object.assign({}, values(), { [id]: valueOf(e.target.closest('[data-row]')) })); // live while dragging; checked and saved on letting go
  });
  dlg.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('[data-base]')) { await app.setCustomTheme({ base: t.value }); draw(); return; }
    const id = t.dataset.field;
    if (id) await commit(id, valueOf(t.closest('[data-row]')));
  });
  dlg.addEventListener('click', async e => {
    const inMock = e.target.closest('.ct-mock');
    if (inMock) {
      e.preventDefault();
      const t = e.target.closest('[data-edit]');
      if (t) openPop(t); else closePop();
      return;
    }
    if (!pop().hidden && !e.target.closest('.ct-pop, .dd-menu')) closePop();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sec) { secId = b.dataset.sec; closePop(); draw(); }
    else if (b.dataset.reset) { await app.setCustomTheme({ values: { [b.dataset.reset]: null } }); redrawRows(); }
    else if (b.dataset.act === 'pop-close') closePop();
    else if (b.dataset.act === 'done') dlg.close();
    else if (b.dataset.act === 'reset-all' && await askYes('Put every font and colour back to the starting theme?', { ok: 'Put back', danger: true })) { await app.setCustomTheme({ values: null }); draw(); }
  });
  dlg.addEventListener('close', () => { closePop(); document.getElementById('ct-mirror')?.remove(); });
  dlg.addEventListener('ct-open', () => { mirrorMain(); draw(); });
  dlg.showModal(); // first, so the mockup is drawn at its real width
  draw();
}

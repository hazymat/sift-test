// Share (the pill left of 👁 and ⋯, like the Day Planner's): copies what the
// page shows, as plain text, rich text or for WhatsApp. The Day Planner
// shares its own day; every other area reads its rows off the page.
import { toast } from './toast.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const shareHtml = () => `<details class="tool-menu share-menu page-share">
  <summary class="share-btn" role="button" title="Share (S)"><svg class="icon" aria-hidden="true"><use href="#i-share"/></svg> Share</summary>
  <div class="menu">
    <button type="button" data-page-share="plain">Copy to clipboard – plain text</button>
    <button type="button" data-page-share="rich">Copy to clipboard – rich text</button>
    <button type="button" data-page-share="whatsapp">Copy to clipboard – WhatsApp</button>
  </div>
</details>`;

// Per area: the rows on the page, and the words of one.
const valueOf = (row, sel) => row.querySelector(sel)?.value?.trim() || '';
const firstLine = el => (el?.innerText || '').trim().split('\n')[0].trim();
const ROWS = {
  tasks: { rows: '#main .task-list li[data-task][data-id]', text: row => valueOf(row, ':scope > .task-title') },
  dump: { rows: '#thoughts > li[data-id]', text: row => (row.querySelector('.thought-flat')?.textContent || '').trim() },
  lists: { rows: '#main li[data-id]:has(> input[name="text"]), #main .project-grid .list-card', text: row => valueOf(row, ':scope > input[name="text"]') || firstLine(row) },
  places: { rows: '#main .box-card, #main li[data-item]:not(.thing-panel)', text: row => valueOf(row, 'input[name="name"]') || firstLine(row) },
  contacts: { rows: '#main .c-card', text: row => firstLine(row.querySelector('a.c-main') || row) },
  scans: { rows: '#main .scan-card', text: firstLine },
  contracts: { rows: '#main tr[data-id], #main .contract-card', text: row => (row.matches('tr') ? [...row.cells].map(cell => cell.innerText.trim()).filter(Boolean).join(' · ') : firstLine(row)) },
};

function pageRows(area) {
  const how = ROWS[area];
  if (!how) return [];
  return [...document.querySelectorAll(how.rows)].filter(row => row.offsetParent && !row.closest('[hidden]'))
    .map(row => ({ text: how.text(row), depth: +row.dataset.depth || 0, done: row.classList.contains('done') })).filter(row => row.text);
}

function pageText(area, title, kind) {
  const whatsapp = kind === 'whatsapp';
  const mark = row => (!['tasks', 'lists'].includes(area) ? '•' : row.done ? (whatsapp ? '✅' : '[x]') : (whatsapp ? '⬜' : '[ ]'));
  return [whatsapp ? `*${title}*` : title, '', ...pageRows(area).map(row => `${'    '.repeat(row.depth)}${mark(row)} ${row.text}`)].join('\n');
}

function pageHtml(area, title) {
  const ticks = ['tasks', 'lists'].includes(area);
  const items = pageRows(area).map(row => `<li style="margin-left:${row.depth * 1.5}em">${ticks ? (row.done ? '☑ ' : '☐ ') : ''}${esc(row.text)}</li>`).join('');
  return `<h3>${esc(title)}</h3><ul style="list-style:${ticks ? 'none;padding-left:0' : 'disc'}">${items}</ul>`;
}

export function installShare(getArea) {
  document.addEventListener('click', async ev => {
    const btn = ev.target.closest('[data-page-share]');
    if (!btn) return;
    btn.closest('details')?.removeAttribute('open');
    const area = getArea();
    const kind = btn.dataset.pageShare;
    const tab = [...document.querySelectorAll('#main [role="tablist"] [aria-pressed="true"], #main [role="tablist"] [aria-selected="true"]')].find(btn => btn.offsetParent);
    const title = document.title.replace(/ · Sift$/, '') + (tab ? ` – ${tab.textContent.trim()}` : '');
    if (!pageRows(area).length) return toast('Nothing on this page to share');
    try {
      if (kind === 'rich' && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([pageHtml(area, title)], { type: 'text/html' }),
          'text/plain': new Blob([pageText(area, title, 'plain')], { type: 'text/plain' }),
        })]);
      } else await navigator.clipboard.writeText(pageText(area, title, kind));
      toast({ plain: 'Copied as plain text', rich: 'Copied as rich text', whatsapp: 'Copied for WhatsApp' }[kind]);
    } catch {
      toast("Couldn't copy: the browser blocked the clipboard");
    }
  });
  // At the top level (nothing picked, not typing): V opens 👁, S Share, . the page's ⋯.
  const MENUS = { v: 'details.view-menu', s: 'details.share-menu', '.': 'details.page-more' };
  addEventListener('keydown', ev => {
    if (ev.altKey || ev.metaKey || ev.ctrlKey || ev.isComposing || ev.defaultPrevented) return;
    const sel = MENUS[ev.key.toLowerCase()];
    if (!sel) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused !== document.documentElement) return;
    if (document.querySelector('dialog[open], details.tool-menu[open], .kb-cur')) return;
    const menu = [...document.querySelectorAll(`#main ${sel}`)].find(details => details.offsetParent);
    if (!menu) return;
    ev.preventDefault();
    menu.open = true;
    menu.dataset.byKey = '1'; // Esc then leaves it with nothing picked
    menu.querySelector(':scope > summary').focus();
  });
}

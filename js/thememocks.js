import { keys } from './keys.js';
// Mockups for the Custom theme editor (customtheme.js): each section drawn
// with the app's own markup and classes, so the real CSS (and the user's
// picks) draw it exactly as the app does. data-edit on an element lists the
// fields ('section.key') that change it: hovering outlines it, pressing it
// opens those fields. Nothing here does anything else.

const E = (...keys) => ` data-edit="${keys.join(' ')}"`;
const GRIP = '<svg class="icon" aria-hidden="true"><use href="#i-grip"/></svg>';

// The same for every area not drawn on its own: a heading, a panel with
// text, faint text and a link, and a panel with a list.
const generic = (id, title, lines) => `
  <h2 class="section-title"${E(`${id}.handfont`, `${id}.text`)}>${title}</h2>
  <section class="card"${E(`${id}.panel`)}>
    <h3${E(`${id}.text`, `${id}.font`)}>${lines[0]}</h3>
    <p${E(`${id}.text`, `${id}.font`)}>${lines[1]}</p>
    <p class="muted"${E(`${id}.muted`)}>${lines[2]}</p>
    <p><a href="#"${E(`${id}.accent`)}>${lines[3]}</a></p>
  </section>
  <section class="card"${E(`${id}.panel`)}>
    <ul class="item-list">${lines.slice(4).map(l => `<li${E(`${id}.text`, `${id}.font`)}>${l}</li>`).join('')}</ul>
  </section>`;

export const MOCKS = {
  app: () => `
    <p class="ct-mock-note muted">What every area starts from. Each area can change its own below.</p>
    <section class="card"${E('app.panel', 'app.edge')}>
      <h3${E('app.handfont', 'app.text')}>Headings look like this</h3>
      <p${E('app.text', 'app.font')}>Everyday text: buttons, labels and anything written by the app.</p>
      <div class="rich"><div class="rich-edit hand"${E('app.notesfont', 'app.text')}><div>Notes and lists: <b>what you write</b> yourself.</div><ul><li>a bullet</li><li>another</li></ul></div></div>
      <p class="muted"${E('app.muted')}>Faint text: dates, hints, “just now”.</p>
      <p><a href="#"${E('app.accent')}>A link</a> <button type="button" class="primary"${E('app.accent')}>A main button</button> <button type="button">A button</button></p>
    </section>
    <div class="ct-mock-row">
      <div class="menu ct-mock-menu"${E('app.menu', 'app.text')}><button type="button">Copy to clipboard</button><button type="button">Share with someone…</button><hr><button type="button" class="danger">Delete</button></div>
      <div class="sheet ct-mock-sheet"${E('app.sheet', 'app.edge')}><h3${E('app.text')}>A sheet or pop-up</h3><p class="muted"${E('app.muted')}>Opened over the page.</p></div>
    </div>
    <p class="ct-mock-bg muted"${E('app.bg', 'app.blur')}>Press the background to change it, or how frosted the panels look.</p>`,

  bars: () => `
    <header class="appbar ct-mock-bar"${E('bars.bg', 'bars.text', 'bars.font')}>
      <h1 class="page-title"${E('bars.text', 'bars.font')}>Tasks</h1>
      <nav class="topnav"><span class="ct-topnav-links"><a href="#">Brain Dump</a><a href="#" aria-current="page">Tasks</a><a href="#">Day Planner</a></span></nav>
    </header>
    <div class="ct-mock-gap"></div>
    <nav class="tabbar ct-mock-bar"${E('bars.bg', 'bars.text', 'bars.font')}>
      <a class="tab" href="#"><svg class="icon" aria-hidden="true"><use href="#i-dump"/></svg><span>Brain Dump</span></a>
      <a class="tab" href="#" aria-current="page"><svg class="icon" aria-hidden="true"><use href="#i-tasks"/></svg><span>Tasks</span></a>
      <a class="tab" href="#"><svg class="icon" aria-hidden="true"><use href="#i-planner"/></svg><span>Day Planner</span></a>
    </nav>`,

  dump: () => `
    <section class="dump-capture card"${E('dump.panel', 'dump.text', 'dump.font')}>
      <div class="dump-h-row"><h2 class="dump-h"${E('dump.handfont', 'dump.text')}>New note</h2></div>
      <div class="rich"><div class="rich-edit hand"${E('dump.note', 'dump.notefont')}><div>Ring the garage about the <b>MOT</b></div></div></div>
      <div class="dump-kinds-row"><span class="dump-caption"${E('dump.muted')}>This is a:</span>
        <div class="dump-kinds"><button type="button" aria-pressed="true"${E('dump.accent')}>Thought</button><button type="button" aria-pressed="false">Idea</button><button type="button" aria-pressed="false">Task</button></div></div>
      <div class="dump-foot"><span class="spacer"></span><button type="button" class="primary"${E('dump.accent')}>Save ${keys('Ctrl+Enter')}</button></div>
    </section>
    <section class="dump-find"><div class="dump-h-row"><h2 class="dump-h"${E('dump.handfont', 'dump.text')}>Your notes</h2></div></section>
    <ul class="thought-list">
      <li class="thought size-m" style="--tint:#e3c9a8"${E('dump.panel')}>
        <div class="thought-head"><button type="button" class="drag-handle kit-grip">${GRIP}</button><button type="button" class="note-dot"><span class="swatch" style="--sw:#e3c9a8"></span></button><span class="muted"${E('dump.muted')}>just now</span><span class="spacer"></span><button type="button" class="pin">☆</button></div>
        <div class="thought-body hand"${E('dump.note', 'dump.notefont')}><div class="thought-title">Call the plumber</div><div>About the <b>boiler</b> noise.</div><ul><li>ask about Tuesday</li><li>get a quote first</li></ul></div>
        <div class="thought-actions"><button type="button"${E('dump.text', 'dump.font')}>→ Task</button><button type="button">Plan it</button><span class="spacer"></span><span class="note-end"><button type="button" class="archive-pill">Archive</button></span></div>
      </li>
      <li class="thought size-m" style="--tint:#a8d0e3"${E('dump.panel')}>
        <div class="thought-head"><button type="button" class="drag-handle kit-grip">${GRIP}</button><button type="button" class="note-dot"><span class="swatch" style="--sw:#a8d0e3"></span></button><span class="muted"${E('dump.muted')}>yesterday</span><span class="spacer"></span><button type="button" class="pin" aria-pressed="true">★</button></div>
        <div class="thought-body hand"${E('dump.note', 'dump.notefont')}><div class="thought-title">Holiday ideas</div><div>Cornwall in May? <a href="#"${E('dump.accent')}>the cottage</a></div></div>
      </li>
    </ul>`,

  tasks: () => `
    <div class="tasks-head"><div class="segmented" role="tablist"><button type="button" aria-pressed="false">Task Dump</button><button type="button" aria-pressed="true"${E('tasks.accent', 'tasks.text')}>Now</button><button type="button" aria-pressed="false">Next</button><button type="button" aria-pressed="false">Later</button></div></div>
    <div id="ct-task-body" class="ct-task-body" style="--title-x: 70px; --entry-x: 15px; --task-row-h: 52px;">
      <div class="task-entry open" data-depth="0" style="--ind: 0px;"${E('tasks.panel')}>
        <div class="task-add-line"><span class="add-mark" aria-hidden="true"></span><input class="new-task-line" value="New task: pay the window cleaner" readonly tabindex="-1"${E('tasks.title', 'tasks.titlefont')}><button type="button" class="entry-add">Add <kbd>Enter</kbd></button></div>
        <div class="entry-actions"><span class="entry-chip"${E('tasks.text', 'tasks.font')}><span class="chip-glyph">⚡</span> Energy</span><span class="entry-chip">📅 Plan for day</span><span class="entry-chip">⏱ Estimated time</span></div>
      </div>
      <ul class="task-list">
        <li data-task="" data-depth="0"${E('tasks.panel')}><button type="button" class="drag-handle">${GRIP}</button><input type="checkbox" class="tick" tabindex="-1"><input class="task-title" value="Book the car in for its MOT" readonly tabindex="-1"${E('tasks.title', 'tasks.titlefont')}><button type="button" class="more">⋯</button>
          <div class="item-sub"><span class="item-note task-note"${E('tasks.note', 'tasks.notefont')}><span class="note-icon">📝</span><span class="note-medium">Garage on the high street; ask for a courtesy car</span><span class="note-loose">Garage on the high street; ask for a courtesy car</span></span></div></li>
        <li data-task="" data-depth="0"${E('tasks.panel')}><button type="button" class="drag-handle">${GRIP}</button><input type="checkbox" class="tick" tabindex="-1"><input class="task-title" value="Renew passport" readonly tabindex="-1"${E('tasks.title', 'tasks.titlefont')}><button type="button" class="more" aria-expanded="true">⋯</button></li>
        <li class="task-details"${E('tasks.panel', 'tasks.text', 'tasks.font')}>
          <div class="task-notes"><div class="rich"><div class="rich-edit hand"${E('tasks.note', 'tasks.notefont')}><div>Photos from the booth on the corner.</div></div></div></div>
          <div class="panel-sec detail-sec"><span class="panel-h"${E('tasks.muted')}>Details</span>
            <div class="detail-grid"><label${E('tasks.text', 'tasks.font')}>List<select tabindex="-1"><option>Now</option></select></label><label${E('tasks.text', 'tasks.font')}>Estimated time<select tabindex="-1"><option>30 min</option></select></label></div></div>
          <div class="detail-actions"><button type="button" class="close-details">Close</button><span class="spacer"></span><button type="button">Archive</button><button type="button" class="danger">Delete</button></div>
        </li>
        <li class="done" data-task="" data-depth="0"${E('tasks.panel')}><button type="button" class="drag-handle">${GRIP}</button><input type="checkbox" class="tick" checked tabindex="-1"><input class="task-title" value="Return library books" readonly tabindex="-1"${E('tasks.muted', 'tasks.titlefont')}><button type="button" class="more">⋯</button></li>
      </ul>
    </div>`,

  planner: ({ paper }) => `
    <div class="planner" data-paper="${paper || 'glass'}">
      <header class="day-head">
        <h1 class="day-title"${E('planner.day', 'planner.dayfont')}><span class="weekday">Monday</span> <span class="date">March 3</span></h1>
        <p class="day-rel muted"${E('planner.muted')}>Tomorrow</p>
        <div class="focus-row">
          <label class="focus"${E('planner.labels', 'planner.labelsfont', 'planner.focusink')}><span class="hand-label">Day focus</span><input class="" value="Finish the report" readonly tabindex="-1"${E('planner.text')}></label>
          <div class="energy"${E('planner.labels', 'planner.labelsfont', 'planner.energyink')}><span class="hand-label energy-label">Energy</span><input class="" value="Good, after a walk" readonly tabindex="-1"${E('planner.text')}></div>
        </div>
      </header>
      <h2 class="schedule-title section-title"${E('planner.heads', 'planner.headsfont')}>Schedule</h2>
      <section class="paper"${E('planner.rule', 'planner.margin')}><div class="ct-lines">
        <div class="line blank"><span class="margin"${E('planner.times', 'planner.timesfont')}>8.00</span><span class="content"></span></div>
        <div class="line has-item"><span class="margin"${E('planner.times', 'planner.timesfont')}>9.00</span><span class="content"><input type="checkbox" class="tick" tabindex="-1"><textarea class="item-title hand one-line" rows="1" readonly tabindex="-1"${E('planner.items', 'planner.itemsfont', 'planner.ink')}>Walk the dog</textarea><span class="span-tag"${E('planner.muted')}>9.00–10.00</span></span></div>
        <div class="line blank"><span class="margin"${E('planner.times', 'planner.timesfont')}>10.00</span><span class="content"></span></div>
        <div class="line has-item"><span class="margin"${E('planner.times', 'planner.timesfont')}>11.00</span><span class="content"><input type="checkbox" class="tick" tabindex="-1"><textarea class="item-title hand one-line" rows="1" readonly tabindex="-1"${E('planner.items', 'planner.itemsfont', 'planner.ink')}>Dentist</textarea></span></div>
        <div class="line blank"><span class="margin"${E('planner.times', 'planner.timesfont')}>12.00</span><span class="content"></span></div>
      </div></section>
      <div class="day-bottom">
        <section class="pile"><h2${E('planner.heads', 'planner.headsfont')}>Tasks</h2>
          <div class="pile-paper"><ul class="pile-list"><li><div class="line has-item"><span class="margin"></span><span class="content"><input type="checkbox" class="tick" tabindex="-1"><textarea class="item-title hand one-line" rows="1" readonly tabindex="-1"${E('planner.items', 'planner.itemsfont')}>Write the report</textarea></span></div></li></ul>
          <div class="line pile-new"><span class="margin"></span><span class="content"><input class="new-task hand" placeholder="New task" readonly tabindex="-1"${E('planner.muted')}></span></div></div>
        </section>
        <section class="day-notes"><h2${E('planner.heads', 'planner.headsfont')}>Notes</h2>
          <div class="rich"><div class="rich-edit hand"${E('planner.text', 'planner.notesfont')}><div>Pick up milk on the way back.</div></div></div>
        </section>
      </div>
    </div>`,

  lists: () => `
    <h2 class="section-title"${E('lists.handfont', 'lists.text')}>Weekend shop</h2>
    <section class="card"${E('lists.panel')}>
      <ul class="task-list">
        <li data-task="" data-depth="0"><input type="checkbox" class="tick" tabindex="-1"><input class="task-title" value="Bread" readonly tabindex="-1"${E('lists.title', 'lists.titlefont')}></li>
        <li data-task="" data-depth="0"><input type="checkbox" class="tick" tabindex="-1"><input class="task-title" value="Tomatoes" readonly tabindex="-1"${E('lists.title', 'lists.titlefont')}></li>
        <li data-task="" data-depth="0" class="done"><input type="checkbox" class="tick" checked tabindex="-1"><input class="task-title" value="Coffee" readonly tabindex="-1"${E('lists.muted', 'lists.titlefont')}></li>
      </ul>
      <p class="muted"${E('lists.muted')}>3 items, 1 ticked</p>
      <p><a href="#"${E('lists.accent')}>Make a template from this list</a></p>
    </section>`,

  places: () => generic('places', 'Find Things', ['Loft', 'Christmas decorations and the camping gear.', 'Box 4 · 12 things', 'Show everything in the loft', 'Tent', 'Fairy lights', 'Sleeping bags']),
  contacts: () => generic('contacts', 'Contacts', ['Sam Carter', 'Plumber, recommended by next door.', 'Last called 3 days ago', '07700 900123', 'Called about the boiler', 'Quote by email', 'Coming Tuesday']),
  scans: () => generic('scans', 'Scans', ['Council tax bill', 'Scanned from the post.', 'March · 2 pages', 'Open the scan', 'Page 1', 'Page 2']),
  contracts: () => generic('contracts', 'Contracts', ['Phone contract', 'Ends in June; cancel or switch before.', '£18 a month', 'Set a reminder', 'Started June 2024', 'Notice: 30 days']),
  recipes: () => generic('recipes', 'Recipes', ['Tomato soup', 'Quick, for four.', '25 minutes', 'Add to the shopping list', '6 tomatoes', '1 onion', 'Stock']),
  bin: () => generic('bin', 'Archive and Bin', ['Old shopping list', 'Archived last week.', 'Brain Dump · 7 days ago', 'Put it back', 'Called the bank', 'Holiday packing']),
  settings: () => generic('settings', 'Settings', ['Appearance', 'Theme, text size and spacing.', 'Changes show straight away.', 'Change fonts and colours', 'Theme', 'Text size', 'Show hints']),
};

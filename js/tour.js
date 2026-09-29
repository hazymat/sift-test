// The tour: a walk round Sift that has you try things for real. Each step
// dims the page around one thing (or shows a card in the middle), says what
// it's for and, where it can, asks you to try it: the step moves on by itself
// once you have. Keyboard steps show on laptops, tap steps on phones.
// Where it got to is kept on this device, so it carries on from there; ending
// it early leaves the "Take the tour" task (with its ▶ pill) to come back to.
// Started from the welcome page (views/welcome.js) or the task's pill.
// There can be several tours (TOURS below): each has its own steps, its own
// place kept, and its own task.
import * as store from './store.js';
import { addTaskFirst, doneFields } from './tasks.js';
import { word } from './words.js';
import { toast, undoable } from './toast.js';
import { closeFull } from './fullnote.js';
import { flash } from './flash.js';

const KEYS = matchMedia('(hover: hover) and (pointer: fine)').matches; // a mouse, so almost always a keyboard too
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const CTRL = MAC ? '⌘' : 'Ctrl';
// Keys drawn one box each: key('Ctrl', '→') is [Ctrl] + [→]. Arrows are drawn larger.
const key = (...keys) => keys.map(k => `<kbd${/^[←→↑↓]$/.test(k) ? ' class="tour-arrow"' : ''}>${k}</kbd>`).join('<span class="tour-plus">+</span>');

// While the tour shows Google Calendar: a made-up day of it (unless this device
// shows the real one), put back as it was when the step is left. The buttons do nothing.
function sampleCalendar() {
  const box = document.querySelector('.planner .gcal');
  if (!box) return null;
  if (!box.hidden && !box.querySelector('[data-gcal="connect"]')) return () => {}; // the real one's showing
  const was = { hidden: box.hidden, html: box.innerHTML };
  const add = '<button type="button" class="gcal-add" tabindex="-1">+ Add to plan</button>';
  box.hidden = false;
  box.classList.add('gcal-sample');
  box.innerHTML = `<div class="gcal-head"><h3>Google Calendar</h3><span class="muted gcal-status">Updated just now (an example)</span><button type="button" class="gcal-btn" tabindex="-1">↻ Refresh</button></div>
    <ul class="gcal-list">
      <li class="gcal-event all-day"><span class="gcal-when">All day</span> <span class="gcal-title">School inset day</span>${add}</li>
      <li class="gcal-event"><span class="gcal-when">9.00–9.30</span> <span class="gcal-title">Dentist</span> <span class="muted gcal-where">· High Street</span>${add}</li>
      <li class="gcal-event"><span class="gcal-when">14.00–15.00</span> <span class="gcal-title">Team call</span><span class="muted gcal-added">✓ In your plan</span></li>
    </ul>`;
  return () => { box.classList.remove('gcal-sample'); box.hidden = was.hidden; box.innerHTML = was.html; };
}

// A step: { id (where the tour carries on from), hash (go there first), at (what
// to point at: the first selector in the list with something showing; none: a
// card in the middle), also (a second thing to outline, e.g. its place in the
// navigation), open (a menu to open while the step shows), title, body, only
// ('keys' or 'touch'), enter (set something up while the step shows; returns
// what undoes it), focus (put the cursor there), done (how trying it is
// noticed: { made: [collections] } something new saved, or { hash } arriving there) }.
// Built when the tour starts, so areas are called what the user calls them.
function newUserSteps() {
  const w = k => `<b>${word(k)}</b>`;
  const tap = KEYS ? 'click' : 'tap';
  const nav = area => `#topnav-links a[href="#/${area}"], #tabbar a[href="#/${area}"]`;
  return [
    { id: 'welcome', title: 'Welcome to Sift', body: `<p>There's a <b>lot</b> in Sift, and this tour shows most of it. It's fine to ignore plenty of it for now and come back to it when you need it.</p>
      <p>Honestly, the best part is just the notes. Sift keeps every change to a note as you type it, so a note is never lost, and any earlier version can come back, whichever device you wrote it on. And a note can turn into something you do. We hope you'll agree it's better than any notes app you've used before, even your phone's own. Seriously!</p>
      <p>Okay, I lied. The ${w('area_tasks')} app and the ${w('area_planner')} are the best part of this. They're better than other tasks apps you've seen, or your money back. What's that you say? The app is free? Okay: I'll buy you an ice cream 🍦 if you find a better tasks app! Anyway, I'll show you the features now.</p>` },

    // ---------- Brain Dump ----------
    { id: 'dump', hash: '#/dump', at: '.dump-capture', focus: '#dump-body .rich-edit', title: `${word('area_dump')}: empty your head`, done: { made: ['thoughts'] },
      body: `<p>Anything goes here: a worry, an idea, a phone number, "ring the dentist". No title, no folder, nothing to decide first.</p>
        <p class="tour-try">Try it: ${KEYS ? `write something, then press ${key(CTRL, 'Enter')} or Save` : 'tap the box and write something, then Done, then Save'}.</p>` },
    { id: 'becomes', hash: '#/dump', at: '#thoughts > li.thought', title: 'Your note, ready for action', done: { made: ['tasks', 'day_items'] },
      body: `<p>Your note is stored. Its action buttons turn it into a <b>task</b>, or put it on the <b>${word('area_planner')}</b>, which you'll soon see is a really powerful feature.</p>
        <p>The note isn't moved or thrown away: it stays here, linked to what it became.</p>
        <p class="tour-try">Try it: ${tap} <b>→ Task</b>.</p>` },
    { id: 'rich', hash: '#/dump', at: '#dump-body', focus: '#dump-body .rich-edit', title: 'Notes that do things', body: `<p>Notes everywhere in the app can be formatted: with Markdown, with the toolbar, or with keyboard shortcuts${KEYS ? ` (${key(CTRL, 'B')} for bold)` : ''}. Or keep them as plain text, if you prefer.</p>
        <p>Type a phone number or an email address and it's picked out as a real contact, with a record of every call. Paste a screenshot or a PDF and it's attached to the note.</p>` },
    { id: 'undo', hash: '#/dump', at: '#dump-body', only: 'keys', title: 'Undo that remembers yesterday', body: `<p><b>This is honestly one of the great features, which I think you'll be impressed with.</b></p>
        <p>${key(CTRL, 'Z')} in a note steps back through what you just typed, then keeps going: yesterday's version, last week's, even changes made on your other devices. ${key(CTRL, 'Y')} goes forward again.</p>
        <p>Anything else you do shows a message at the bottom with <b>Undo</b>, and ${key(CTRL, 'Z')} does the same while it shows.</p>` },
    { id: 'undo', hash: '#/dump', at: '#dump-body', only: 'touch', title: 'Undo that remembers yesterday', body: `<p><b>This is honestly one of the great features, which I think you'll be impressed with.</b></p>
        <p>Every note keeps its earlier versions: yesterday's, last week's, even changes made on your other devices. <b>Aa</b> in a note's toolbar, then 🕘, lists them to go back to.</p>
        <p>Anything else you do shows a message at the bottom with <b>Undo</b>.</p>` },

    { id: 'safe', hash: '#/dump', at: '.dump-capture', title: 'Never lose a note', body: `<p><i>Sift'll be there for you, when the rain starts to pour</i>… or when your battery dies before you've saved your note.</p>
        <p>Everything you type is kept as you type it. If your browser closes for an update halfway through a sentence, it's all still there when you come back, even a note you hadn't saved yet.</p>` },
    { id: 'tasks', hash: '#/tasks/now', at: '#task-entry, #task-body', also: nav('tasks'), focus: '#task-new', title: `${word('area_tasks')}: ${word('list_now')}, ${word('list_next')}, ${word('list_later')}`, done: { made: ['tasks'] },
      body: `<p>Three lists instead of deadlines: what you're doing now, what's next, and one day. ${w('list_inbox')} holds anything not sorted yet, like a task made from a note.</p>
        <p class="tour-try">Try it: type a task and ${KEYS ? `press ${key('Enter')}` : 'tap Add'}.</p>
        ${KEYS ? `<p>${key('Shift', 'Enter')} opens <b>More</b> (energy, a day, how long it takes) and goes on into the task's note.</p>` : ''}` },
    { id: 'task', hash: '#/tasks/now', at: '.task-list > li[data-task]', title: 'Everything about a task', body: `<p>${KEYS ? 'Point at a task and look for <b>⋯</b> on the right' : 'Tap <b>⋯</b> on the right of a task'}: it opens the task, with its note, the energy it needs, how long it takes and which day to do it.</p>
        <p><b>Repeats</b>: "put the bins out, every Tuesday". Ticking it makes the next one, on the right day, with its checklist ready again. Missed ones never pile up.</p>
        <p><b>Comments</b> keep a record of what actually happened: "rang them, need their reference number", "done, cost £40".</p>` },
    { id: 'select', hash: '#/tasks/now', at: '.task-list, #task-body', title: 'Moving and choosing several', body: `<p><b>⠿</b> on the left of each task is its grab bar.</p>
        <ul><li><b>To reorder</b>: hold ⠿ for a second, then move it. Move it sideways to make it a sub-task.</li>
        <li><b>To choose tasks</b>: ${tap} ⠿, or drag down over several ⠿.${KEYS ? ` ${key('Shift')} chooses everything in between, ${key(CTRL)} adds one more.` : ''}</li></ul>
        <p>While anything is chosen, the <b>actions bar</b> appears at the bottom: it does one thing to all of them at once, such as Done, ${word('list_now')}, ${word('list_next')}, ${word('list_later')}, Archive or Delete.${KEYS ? ` ${key('Esc')} lets them go.` : ''} Lists, notes and Find Things work the same way.</p>` },
    { id: 'subtasks', hash: '#/tasks/now', at: '.task-list, #task-body', title: 'Sub-tasks and projects? We\'ve got you covered', body: `<ul><li>Drag a task onto another task and it becomes its sub-task.</li>
        <li>Or, if you prefer, start a new task with ${key('-')} and a space and it becomes a sub-task of the one above. Do it again for a sub-sub-task, if you're feeling wild!${KEYS ? ` (${key('Tab')} and ${key('Shift', 'Tab')} do the same.)` : ''}</li>
        <li><b>Projects</b>: ⋯ at the top, then <b>New project</b>. Give a task its project under <b>More</b> in the task's ⋯, and <b>Projects</b> shows each one with how far along it is.</li></ul>` },
    { id: 'energy', hash: '#/tasks/now', at: '.task-list > li[data-task], #task-body', title: 'Energy: doing what you can manage', body: `<p>Tasks can say how much energy they need: <b>⚡</b> low (desk work, small tasks, admin), <b>⚡⚡</b> medium (meetings, some project work), <b>⚡⚡⚡</b> high (physically active work, starting new things).</p>
        <p>Tell the ${w('area_planner')} how you feel today and it suggests tasks that fit, so a flat day gets gentle things and a good day gets the big ones. What each level means is yours to change in Settings → Your words.</p>` },

    // ---------- getting around ----------
    { id: 'keys', only: 'keys', title: 'Your hands can stay on the keyboard', done: { hash: '#/planner' }, body: `<table class="tour-keys">
        <tr><td>${key(CTRL, '←')}<br><span class="tour-or">or</span> ${key(CTRL, '→')}</td><td>the area before or after this one</td></tr>
        <tr><td>${key('←')} <span class="tour-or">or</span> ${key('→')}</td><td>the page's tabs (${word('list_now')}, ${word('list_next')}…), or the ${word('area_planner')}'s days</td></tr>
        <tr><td>${key('↓')} then ${key('Enter')}</td><td>go down the page, and open what you're on</td></tr>
        <tr><td>${key('Esc')}</td><td>step back out, keeping what you wrote</td></tr>
        <tr><td>${key(CTRL, 'Enter')}</td><td>save and finish</td></tr>
        <tr><td>${key('Alt', 'Enter')}</td><td>a note full screen</td></tr>
        <tr><td>${key(CTRL, 'K')} <span class="tour-or">or</span> ${key('/')}</td><td>search everything</td></tr>
      </table>
      <p>Point at a button to see its key, if it has one.</p>
      <p class="tour-try">Try it: press ${key(CTRL, '→')} to go to the ${word('area_planner')}. (If nothing happens, ${key('Esc')} first closes what's open.)</p>` },
    { id: 'keys', only: 'touch', at: '#tabbar, #topnav-links', also: nav('planner'), title: 'Getting around', done: { hash: '#/planner' }, body: `<p>The areas are along here; <b>More</b> has the rest, and a search box that finds anything you've written.</p>
        <p class="tour-try">Try it: tap ${w('area_planner')}.</p>` },

    // ---------- Day Planner ----------
    { id: 'paper', hash: '#/planner', at: '.planner .paper', also: nav('planner'), title: 'Your day on paper', body: `<p>Write on a time to plan it. Anything unfinished is offered again the next day, or you can let it go.</p>
        <p>Give a task a day in ${w('area_tasks')} and it's here on that day by itself; change the day and it moves.</p>` },
    { id: 'drag', hash: '#/planner', at: '.planner .pile', title: 'From tasks to a time', body: `<p>The day's tasks wait here. Drag a task's <b>⠿</b> onto a time in the plan to give it that time, then drag the bottom of it down to say how long it takes.</p>${KEYS ? '' : `
        <p>On a phone, tap an item once to get it ready: then drag it by any part of it to another time, or drag the bar at its bottom down to make it longer. Tap it again to change its words.</p>`}
        <p><b>↓ Bring in from tasks</b> brings in what's planned for today, and ideas that suit today's energy.</p>` },
    { id: 'twoways', hash: '#/planner', at: '.planner .pile', also: nav('tasks'), title: "Today's own task list", body: `<p>These are this day's tasks. Use them however suits you:</p>
      <ul><li><b>From your main list.</b> Your big "life" list lives in ${w('area_tasks')}, a separate area (${KEYS ? 'in the bar at the top' : 'in the bar at the bottom'}). <b>↓ Bring in from tasks</b> brings today's share of it here.</li>
      <li><b>Or just for today.</b> Add small things straight here, without cluttering your main list.</li></ul>
      <p>Mix both. Either way they stay on this day, as a simple to-do or in a time slot. Change your mind whenever: <b>→ Tasks</b> in a task's details moves it onto your main list in one ${tap}.</p>
      <p>You could even skip ${w('area_tasks')} altogether and work from here alone.</p>` },
    { id: 'focus', hash: '#/planner', at: '.planner .focus-row', title: 'Plan around how you feel', body: `<p><b>Day focus</b>: the one thing that matters today. <b>Energy</b>: how you feel, so the planner can suggest tasks that fit.</p>
        <p>Days you'd rather rest (Settings → ${word('area_planner')}) get a gentle reminder to do less.</p>` },
    { id: 'gcal', hash: '#/planner', at: '.planner .gcal', also: '.planner .view-menu > summary', enter: sampleCalendar, title: 'Your Google Calendar, on your day', body: `<p>See what's on in your Google Calendar above your plan. Here are some examples. <b>+ Add to plan</b> puts an event in your plan at its time, with its details as the note, to move like anything else.</p>
        <p>It only reads your calendar, a week at a time (further ahead when you ask), and keeps it on this device. Turn it on or off in <b>👁 → Show Google Calendar</b>.</p>` },
    { id: 'daynotes', hash: '#/planner', at: '.planner .day-notes', title: "The day's notes", body: `<p>Notes for this day only: what happened, who rang, what to remember tomorrow. Written as you go, they become a diary without you ever sitting down to keep one.</p>
        <p>They're like any note: search finds them, and 📝 links them to a task, a contact or anything else.</p>` },
    { id: 'view', hash: '#/planner', at: '.planner .view-menu .menu, .planner .view-menu', open: '.planner .view-menu', title: '👁 Lay the page out your way', body: `<p>👁 is full of ways to lay this page out. Have a play: nothing here can break anything.</p>
        <ul><li>the <b>paper</b>: Glass, Notebook, Dot journal, Techie or Minimal;</li><li><b>timeslots</b> of a quarter, half or whole hour;</li><li>the plan first, or tasks and notes first;</li><li>which parts show, alternate shading, and spacing;</li><li><b>nudges</b>: ▶ at the current time, an evening section, a word when the plan is longer than the day.</li></ul>
        <p>Every page has its own 👁.</p>` },
    { id: 'share', hash: '#/planner', at: '.planner .share-menu', title: 'Share your day', body: `<p>The easiest way: <b>Share → Copy to clipboard</b> puts the whole day in one message, ready to paste into WhatsApp for whoever's doing the school run.</p>
        <p>The more complete way: share <i>your day, your week, your month, or even your year</i> with family or colleagues who use Sift. It literally lets you see their ${word('area_planner')}, and change it too: <b>Show</b> <i>their name</i><b>'s day</b> switches to theirs, and <b>Show my day</b> switches back. Easier than getting a sofa up the stairs: no shouting "Pivot!" needed.</p>` },
    { id: 'lists', hash: '#/lists', at: '.lists-head', title: `${word('area_lists')}, shared with the people who need them`, body: `<p>Shopping, packing, the kids' swimming bag. Make a <b>template</b> once and start a fresh list from it every time.</p>
        <p><b>👥 Share</b> a list and everyone ticks off the same one: two of you in the supermarket, and the milk is only bought once. (Joey doesn't share food, but anyone can share a shopping list.) Notes in ${w('area_dump')} share the same way, so a family plan or a meeting's notes live in one place instead of a chat.</p>` },
    { id: 'places', hash: '#/find-things', at: '#find-grid .find-bar, #main', title: word('area_places'), body: `<p>Where things are kept: the loft, box 4, the drawer in the hall. Photos of what's inside, and search inside every box: "where did we put the passports?" Already have a spreadsheet of your boxes? Import it.</p>` },
    { id: 'contacts', hash: '#/contacts', at: '.c-capture, #c-tabs, #main', title: `${word('area_contacts')}: kept, or just for now`, body: `<p>Two kinds of contact:</p>
        <ul><li><b>Transient</b>: a number you need for a few days, the parking line, the man about the van. Paste it here with a few words, "window cleaner 07700 900123", and it's in <b>Recent</b>. It's never deleted, it just sinks as it gets older; one with no name asks "What was this?".</li>
        <li><b>Stored</b>: the people worth keeping, in your <b>Directory</b>, under categories you make up (Plumber, Carers, Mum's care…).</li></ul>
        <p>A phone number typed in any note becomes a transient contact by itself. ${KEYS ? 'On a phone, tapping' : 'Tapping'} a contact's number rings it, and the call goes in the contact's record.</p>` },
    { id: 'cases', hash: '#/contacts', at: '#c-tabs, #main', title: 'Cases', body: `<p>A <b>case</b> keeps a whole saga in one timeline: a complaint, an insurance claim, a repair. Every call, letter and task about it, in order, so you can say exactly what happened and when.</p>` },
    { id: 'search', at: KEYS ? '.top-search, #more-tab' : '#more-tab, .top-search', title: 'Search everything', body: `<p>${KEYS ? `${key(CTRL, 'K')} or ${key('/')}, or 🔍 at the top` : 'The box at the top of <b>More</b>'}: one search over every note, task, comment, contact, list and box. Archived things are found too.</p>` },
    { id: 'tidied', hash: '#/bin', at: '#bin-tabs, #main', title: 'Nothing is lost by tidying up', body: `<p><b>Archive</b> anything you've finished with: it's out of the way here, in ${w('area_bin')}, and still found by search. Deleted things wait here for 30 days.</p>
        <p><b>History</b> (in ⋯ on any page) lists every change, and any of them can be undone, in any order.</p>` },

    // ---------- making it yours ----------
    { id: 'themes', hash: '#/settings', at: '#theme, #appearance-card', title: 'Themes', body: `<p>A theme changes the whole app: <b>Glass</b>, <b>Glass – Fancy</b> (with handwriting), <b>Dark</b>, <b>Light</b>, or <b>Auto</b> (light by day, Glass at night, following your device).</p>
        <p>Or <b>Custom</b>: every section shown as a sample page; press anything on it to change its colour, its font, or how see-through it is.</p>` },
    { id: 'yours', hash: '#/settings', at: '#words-card, #appearance-card', title: 'Make it yours', body: `<p><b>Your words</b> renames anything: call ${w('area_dump')} "Inbox", or ${w('area_tasks')} "Jobs", and say what each energy level means to you.</p>
        <p><b>Sync</b> keeps your phone and laptop in step. Everything is encrypted on your device first, so only your devices can read it. It works offline, on Windows, Mac, iPhone and Android alike.</p>` },
    { id: 'end', title: 'Why not just use Apple Notes?', body: `<p>Notes apps are good at keeping notes. Sift is for what happens after you've written one:</p>
        <ul><li>a line becomes a task or a contact, and stays in the note, linked;</li><li>undo goes back past yesterday, across your devices;</li><li>your day on paper, planned around your energy;</li><li>tasks that repeat, carry over and keep a record of what happened;</li><li>lists and days shared with the people in them;</li><li>on every device you own, and nobody else can read your data.</li></ul>
        <p>That's the tour. Now empty your head.</p>` },
  ];
}
// Each tour: the name of its task, and its steps. More go here (an advanced tour, say).
const TOURS = {
  new: { title: 'Take the tour of Sift', steps: newUserSteps },
};
const forThisDevice = which => TOURS[which].steps().filter(s => !s.only || (s.only === 'keys') === KEYS);
// Which tour a task starts (tasks made before there were several say true: the new user tour).
export const tourOf = task => (task?.tour === true ? 'new' : task?.tour) || null;

// Where each tour got to on this device: { tour: step id }.
const placeKept = async which => (await store.getDeviceSettings()).tour_at?.[which] || null;
async function keepPlace(which, id) {
  const at = Object.assign({}, (await store.getDeviceSettings()).tour_at, { [which]: id });
  await store.updateDeviceSettings({ tour_at: at });
}

// What a step points at: the first selector in its list with something showing.
function find(list) {
  for (const sel of list.split(',')) {
    const el = Array.from(document.querySelectorAll(sel)).find(e => e.getClientRects().length);
    if (el) return el;
  }
  return null;
}

// Where a tour got to on this device: { n, total }, or null (not started, or finished).
export async function progress(which = 'new') {
  const all = forThisDevice(which);
  const kept = await placeKept(which);
  const n = all.findIndex(s => s.id === kept);
  return n > 0 ? { n, total: all.length } : null;
}
export const resetTour = (which = 'new') => keepPlace(which, null);

// The "Take the tour" task (made if there isn't one, put back on the list if it
// was ticked or moved), shown on Tasks → Now with its outline pulsing so it can be found.
export async function showTourTask(which = 'new') {
  let task = (await store.list('tasks')).find(t => tourOf(t) === which);
  if (!task) task = await addTaskFirst({ title: TOURS[which].title, notes: '▶ Start the tour whenever you like; it carries on where you left it.', horizon: 'now', tour: which });
  else if (task.done_at || task.horizon !== 'now' || task.archived_at) await store.update('tasks', task.id, Object.assign(doneFields(false), { horizon: 'now', archived_at: null }));
  location.hash = '#/tasks/now';
  for (let tries = 0; tries < 40; tries++) {
    const el = document.querySelector(`#main li[data-task="${task.id}"]`);
    if (el) { flash(el); break; }
    await new Promise(ok => setTimeout(ok, 100));
  }
  toast(`The tour waits on your ${word('list_now')} list: ▶ Start the tour carries on where you left it`, { ms: 6000 });
}

let tour = null; // the tour running: { n, end }

export async function startTour({ which = 'new', fromStart = false } = {}) {
  tour?.end();
  const all = forThisDevice(which);
  const kept = fromStart ? null : await placeKept(which);
  const saved = all.findIndex(s => s.id === kept);
  const ring = Object.assign(document.createElement('div'), { className: 'tour-ring' });
  const also = Object.assign(document.createElement('div'), { className: 'tour-ring tour-also' });
  const card = Object.assign(document.createElement('div'), { className: 'tour-card' });
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Tour of Sift');
  document.body.append(ring, also, card);
  document.documentElement.classList.add('touring');
  let target = null, extra = null, step = null, opened = null, raf = 0, stopWaiting = () => {};
  const t = tour = { n: 0 };
  const current = n => t === tour && t.n === n;
  // Scrolling to what a step points at leaves it clear of the top bar (and a phone's bottom bar).
  const bar = sel => { const b = document.querySelector(sel); return b?.getClientRects().length ? b.getBoundingClientRect() : null; };
  const topEdge = bar('.appbar')?.bottom || 0;
  const bottomEdge = Math.min(innerHeight, bar('#tabbar')?.top ?? innerHeight);
  const root = document.documentElement.style;
  root.scrollPaddingTop = `${topEdge + 12}px`;
  root.scrollPaddingBottom = `${innerHeight - bottomEdge + 12}px`;
  const shown = el => (el?.isConnected && el.getClientRects().length ? el.getBoundingClientRect() : null);
  const fit = (el, r) => Object.assign(el.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });

  // The ring follows what it points at (pages scroll, panels open, a page drawn
  // again finds it afresh); with nothing to point at the whole page dims.
  const place = () => {
    raf = requestAnimationFrame(place);
    if (step?.at && !target?.isConnected) target = find(step.at);
    if (step?.also && !extra?.isConnected) extra = find(step.also);
    const r = shown(target), x = shown(extra);
    ring.classList.toggle('whole', !r);
    fit(ring, r || { left: 6, top: 6, width: innerWidth - 12, height: innerHeight - 12 });
    also.hidden = !x;
    if (x) fit(also, x);
    // The card: under what it points at, or over it, or beside it; when none of
    // those fits, in the bottom corner, away from the top of it (where its heading usually is).
    const ch = card.offsetHeight, cw = card.offsetWidth, gap = 14;
    let top, left = r ? Math.min(Math.max(12, r.left), innerWidth - cw - 12) : (innerWidth - cw) / 2;
    const beside = r && Math.min(Math.max(12, r.top), innerHeight - ch - 12);
    if (!r) top = (innerHeight - ch) / 2;
    else if (r.bottom + gap + ch < innerHeight - 8) top = r.bottom + gap;
    else if (r.top - gap - ch > 8) top = r.top - gap - ch;
    else if (r.left - gap - cw > 8) { top = beside; left = r.left - gap - cw; }
    else if (r.right + gap + cw < innerWidth - 8) { top = beside; left = r.right + gap; }
    else { top = innerHeight - ch - 12; left = innerWidth - cw - 12; }
    card.style.top = `${Math.round(Math.max(12, top))}px`;
    card.style.left = `${Math.round(Math.max(12, left))}px`;
  };

  let undoEnter = null; // what the step's enter() set up, undone when it's left
  const shut = () => { if (opened) { opened.open = false; opened = null; } undoEnter?.(); undoEnter = null; };
  async function show(n) {
    stopWaiting();
    shut();
    t.n = n;
    step = all[n];
    keepPlace(which, step.id); // carried on from here next time
    const last = n === all.length - 1;
    if (step.hash && !location.hash.startsWith(step.hash)) location.hash = step.hash;
    target = extra = null;
    if (step.enter) { for (let tries = 0; tries < 40 && current(n) && !(undoEnter = step.enter()); tries++) await new Promise(ok => setTimeout(ok, 75)); } // (once the page is drawn)
    const k = letter => (KEYS ? ` <kbd>${letter}</kbd>` : '');
    card.innerHTML = `<div class="tour-head"><span class="tour-count">${n + 1} of ${all.length}</span><button type="button" class="tour-x" data-tour="later" aria-label="End the tour early" title="End the tour early: it waits on your task list">✕</button></div>
      <h3>${step.title}</h3><div class="tour-body">${step.body}</div>
      <div class="tour-foot">${n ? `<button type="button" data-tour="back">Back${k('B')}</button>` : ''}
        <button type="button" data-tour="later" class="tour-later">End tour early</button><span class="spacer"></span>
        ${step.done ? `<button type="button" data-tour="next">Skip${k('N')}</button>` : `<button type="button" class="primary" data-tour="next">${last ? 'Finish' : 'Next'}${k('N')}</button>`}</div>`;
    // What it points at may take a moment to be drawn (the page changing, a toolbar showing once the note is in use).
    for (let tries = 0; tries < 40 && current(n); tries++) {
      // (Not on a phone: the cursor in a note opens it full screen, with the keyboard. That's left to a tap.)
      if (step.focus && KEYS) { const f = document.querySelector(step.focus); if (f && document.activeElement !== f) f.focus(); }
      if (step.open && !opened) { opened = find(step.open); if (opened) opened.open = true; }
      target = step.at ? find(step.at) : null;
      if (!step.at || target) break;
      await new Promise(ok => setTimeout(ok, 75));
    }
    if (!current(n)) return;
    if (target) {
      // In view, with room for the card beside it: to the top when both fit on the screen, otherwise just into view.
      const r = target.getBoundingClientRect(), room = card.offsetHeight + 40;
      const clear = r.top >= topEdge && r.bottom <= bottomEdge;
      const cardFits = bottomEdge - r.bottom > room || r.top - topEdge > room;
      if (!clear || !cardFits) target.scrollIntoView({ block: r.height + room < bottomEdge - topEdge ? 'start' : 'nearest', behavior: 'smooth' });
    }
    if (!step.focus || !KEYS) card.querySelector('[data-tour="next"]').focus({ preventScroll: true });
    if (!step.done) return;
    const stop = await waitFor(step.done, () => { if (current(n)) tried(n); });
    if (current(n)) stopWaiting = stop; else stop(); // moved on while it was being set up
  }
  // Tried it: a tick, then on to the next step. (On a phone, saving a note puts
  // the cursor back in an empty New note, full screen: that's closed, so the tour shows again.)
  function tried(n) {
    stopWaiting();
    card.querySelector('.tour-foot').innerHTML = '<span class="tour-nice">✓ That\'s it</span>';
    setTimeout(() => {
      if (!current(n)) return;
      const full = document.querySelector('.rich.is-full .rich-edit');
      if (full && !full.textContent.trim()) closeFull();
      show(n + 1);
    }, 1100);
  }
  const act = what => {
    if (what === 'back' && t.n > 0) show(t.n - 1);
    else if (what === 'next') t.n === all.length - 1 ? finish() : show(t.n + 1);
    else if (what === 'later') { t.end(); showTourTask(which); }
  };
  card.addEventListener('click', e => act(e.target.closest('[data-tour]')?.dataset.tour));
  // N for Next and B for Back (not while typing); Esc on the card ends the tour early.
  const onKey = e => {
    if (e.key === 'Escape' && card.contains(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); act('later'); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const what = { n: 'next', b: 'back' }[e.key.toLowerCase()];
    if (!what || card.querySelector('.tour-nice')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    act(what);
  };
  addEventListener('keydown', onKey, true);

  t.end = () => {
    stopWaiting();
    shut();
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey, true);
    ring.remove();
    also.remove();
    card.remove();
    document.documentElement.classList.remove('touring');
    root.scrollPaddingTop = root.scrollPaddingBottom = '';
    if (tour === t) tour = null;
  };
  // Finished: back to the start, next time from the beginning, and the "Take the tour" task ticked off.
  async function finish() {
    t.end();
    await resetTour(which);
    location.hash = '#/dump';
    const open = (await store.list('tasks')).filter(task => tourOf(task) === which && !task.done_at);
    if (!open.length) return;
    for (const task of open) await store.update('tasks', task.id, doneFields(true));
    undoable(`Ticked off: ${TOURS[which].title}`, async () => { for (const task of open) await store.update('tasks', task.id, doneFields(false)); });
  }
  raf = requestAnimationFrame(place);
  show(Math.max(0, saved));
}

// Watches for a step being tried; returns how to stop watching.
async function waitFor(done, then) {
  if (done.made) {
    const had = new Set();
    for (const c of done.made) for (const r of await store.list(c)) had.add(r.id);
    return store.subscribe(change => { if (done.made.includes(change?.collection) && !change.deleted && !had.has(change.id)) then(); });
  }
  const check = () => { if (location.hash.startsWith(done.hash)) then(); };
  addEventListener('hashchange', check);
  return () => removeEventListener('hashchange', check);
}

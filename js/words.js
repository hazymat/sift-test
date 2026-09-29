// Your own words for the things Sift shows (Settings → Dictionary), and your
// Brain Dump types (Settings → Brain Dump types). Each word has a default; a
// word you've changed is kept in the synced settings under its key (empty =
// the default), so it follows you to your other devices.
//
//   word('list_inbox')  → "Task Dump", or what you called it
//   dumpTypes()         → [{ id, label }] in your order
//   applyWords()        → reload both from the settings (start-up, and when they change)

import * as store from './store.js';

export const WORDS = [
  { group: 'Areas', key: 'area_dump', default: 'Brain Dump', hint: 'Where you jot anything down. Some people like "Notes", "Inbox" or "Scratchpad".' },
  { group: 'Areas', key: 'area_tasks', default: 'Tasks', hint: 'Things to do: "To do", "Jobs"…' },
  { group: 'Areas', key: 'area_planner', default: 'Day Planner', hint: 'The page for one day: "Today", "My day"…' },
  { group: 'Areas', key: 'area_lists', default: 'Lists', hint: 'Packing lists, the weekly shop, checklists.' },
  { group: 'Areas', key: 'area_places', default: 'Find Things', hint: 'Where things are kept: "Storage", "Boxes", "Shelves", "Where things are"' },
  { group: 'Areas', key: 'area_contacts', default: 'Contacts', hint: 'People, numbers and cases: "People", "Numbers"…' },
  { group: 'Areas', key: 'area_scans', default: 'Scans', hint: 'Photos of letters, receipts and documents.' },
  { group: 'Areas', key: 'area_contracts', default: 'Contracts', hint: 'Insurance, utilities, subscriptions: "Bills", "Policies"…' },
  { group: 'Areas', key: 'area_recipes', default: 'Batch Book', hint: 'Recipes and batches: "Recipes", "Brewing"…' },
  { group: 'Areas', key: 'area_bin', default: 'Tidied', hint: 'Archived and deleted things, together: "Put away", "Archive", "Stowed"…' },

  { group: 'Task lists', key: 'list_inbox', default: 'Task Dump', hint: "Where new tasks land before you've decided when to do them: \"Inbox\", \"To sort\"…" },
  { group: 'Task lists', key: 'list_now', default: 'Now', hint: 'What you are working on these days: "This week", "Doing"…' },
  { group: 'Task lists', key: 'list_next', default: 'Next', hint: 'What comes after: "Soon", "Next week"…' },
  { group: 'Task lists', key: 'list_later', default: 'Later', hint: 'One day: "Someday", "Maybe"…' },

  { group: 'Energy levels', key: 'energy_low', default: 'Desk work, small tasks, admin', hint: 'What a ⚡ low-energy day, or a task that needs little energy, means for you. Shown when you hover over or hold the ⚡.' },
  { group: 'Energy levels', key: 'energy_medium', default: 'Meetings, some project work', hint: 'What ⚡⚡ medium energy means for you.' },
  { group: 'Energy levels', key: 'energy_high', default: 'Physically active work, starting new projects', hint: 'What ⚡⚡⚡ high energy means for you.' },

  { group: 'Day Planner', key: 'day_focus', default: 'Day focus', hint: 'The line at the top of each day for what matters most: "Main thing", "Intention"…' },
  { group: 'Day Planner', key: 'day_energy', default: 'Energy', hint: 'The word before the ⚡ buttons for how much energy you have today.' },
  { group: 'Day Planner', key: 'day_energy_prompt', default: 'How do you feel?', hint: 'The grey prompt in the Energy line before you pick a level or type.' },
  { group: 'Day Planner', key: 'day_focus_prompt', default: 'What matters today?', hint: 'The grey prompt in that line before you type.' },
  { group: 'Day Planner', key: 'day_schedule', default: 'Schedule', hint: 'The heading over the timed plan: "Plan", "Timeline"…' },
  { group: 'Day Planner', key: 'day_tasks', default: 'Tasks', hint: 'The heading over the day\'s own tasks: "To do today"…' },
  { group: 'Day Planner', key: 'day_notes', default: 'Notes', hint: 'The heading over the day\'s notes: "Journal", "Log"…' },

  { group: 'Brain Dump', key: 'dump_new', default: 'New note', hint: 'The heading over the box where you write something new.' },
  { group: 'Brain Dump', key: 'dump_mine', default: 'Your notes', hint: 'The heading over everything you have written.' },
  { group: 'Brain Dump', key: 'dump_kind', default: 'This is a:', hint: 'The words before the types (Thought, Idea…) when you write a new note.' },

  // Hints, prompts and explanations (the grey text), so they can be your words too.
  { group: "Phrases: Brain Dump", key: 'ph_dump_new', default: "What's on your mind?", hint: "The grey prompt in the New note box." },
  { group: "Phrases: Brain Dump", key: 'ph_dump_search', default: "Search your notes…", hint: "The grey prompt in the search box." },
  { group: "Phrases: Brain Dump", key: 'ph_dump_select', default: "Select any text in a note to make it a contact.", hint: "The hint under the filters." },
  { group: "Phrases: Tasks", key: 'ph_tasks_entry', default: "Enter adds it. Start a line with \"- \" for a sub-task.", hint: "The hint under a new task while you type it." },
  { group: "Phrases: Tasks", key: 'ph_tasks_projects', default: "A project is just a group of tasks. Give it milestones to see progress in stages.", hint: "The hint on the Projects page." },
  { group: "Phrases: Notes", key: 'ph_notes', default: "Notes…", hint: "The grey prompt in an empty note (tasks and list items)." },
  { group: "Phrases: Tasks", key: 'ph_milestone', default: "e.g. First draft done", hint: "The example in the New milestone box." },
  { group: "Phrases: Day Planner", key: 'ph_day_tasks', default: "Enter adds a task. Start with a time (12.45) to put it straight on the plan. Drag ⠿ to reorder, or onto a time.", hint: "The hint under the day's tasks." },
  { group: "Phrases: Day Planner", key: 'ph_day_view', default: "Paper, timeslots and layout for a single day are in the view menu (the eye) by the energy level; the defaults are in Settings.", hint: "The hint at the bottom of the day." },
  { group: "Phrases: Day Planner", key: 'ph_day_notes', default: "Anything about today…", hint: "The grey prompt in the day's notes." },
  { group: "Phrases: Day Planner", key: 'ph_day_bring_empty', default: "No open tasks. Add some in Tasks.", hint: "In \"Bring in from tasks\" when there are none." },
  { group: "Phrases: Day Planner", key: 'ph_day_review', default: "For each one: did you do it, do you still want to, or can it go? Letting go is fine; some things just stop mattering. Let-go items wait in the Archive in case you want them back; Delete gets rid of them.", hint: "The hint in \"Unfinished from earlier days\"." },
  { group: "Phrases: Lists", key: 'ph_lists_templates', default: "A template is the list you reuse (holiday packing, the weekly shop). Open one and \"Use this template\" to get a fresh copy to tick off.", hint: "The hint over the templates." },
  { group: "Phrases: Lists", key: 'ph_lists_no_templates', default: "No templates yet.", hint: "When there are no templates." },
  { group: "Phrases: Lists", key: 'ph_lists_none', default: "No lists yet.", hint: "When there are no lists." },
  { group: "Phrases: Lists", key: 'ph_list_name', default: "List name", hint: "The grey prompt for a new list's name." },
  { group: "Phrases: Lists", key: 'ph_add_items', default: "Add items", hint: "The grey prompt where you add items (Lists and Find Things boxes)." },
  { group: "Phrases: Find Things", key: 'ph_find_search', default: "Find anything… (press /)", hint: "The grey prompt in the search box." },
  { group: "Phrases: Find Things", key: 'ph_find_box_search', default: "Search in this box…", hint: "The search box inside a box." },
  { group: "Phrases: Find Things", key: 'ph_find_nothing', default: "Try fewer or different words.", hint: "When a search finds nothing." },
  { group: "Phrases: Find Things", key: 'ph_find_empty', default: "Import a CSV of your boxes, or start adding them.", hint: "When there are no boxes yet." },
  { group: "Phrases: Find Things", key: 'ph_find_area_empty', default: "No boxes in this life area yet.", hint: "A life area with no boxes." },
  { group: "Phrases: Find Things", key: 'ph_box_where', default: "e.g. Top shelf, garage", hint: "The example in a box's \"Where it lives\"." },
  { group: "Phrases: Find Things", key: 'ph_box_notes', default: "e.g. Clear 10-litre box", hint: "The example in a box's Notes." },
  { group: "Phrases: Find Things", key: 'ph_new_area', default: "e.g. Home, Garage, Allotment", hint: "The example in the New life area box." },
  { group: "Phrases: Find Things", key: 'ph_new_group', default: "e.g. Wardrobe, Shed shelves", hint: "The example in the New group box." },
  { group: "Phrases: Contacts", key: 'ph_contact_capture', default: "A number and a few words about it, e.g. Window cleaner 07700 900123", hint: "The grey prompt in the quick-capture box on Recent." },
  { group: "Phrases: Contacts", key: 'ph_contact_search', default: "Search contacts…", hint: "The grey prompt in the search box." },
  { group: "Phrases: Contacts", key: 'ph_contact_none', default: "Nobody here yet.", hint: "An empty category." },
  { group: "Phrases: Contacts", key: 'ph_categories', default: "Categories are anything you like: Plumbers, Painters, Pub mates, Call centres…", hint: "The hint in the Directory." },
  { group: "Phrases: Contacts", key: 'ph_log_what', default: "What happened? (optional)", hint: "The grey prompt when you log a call or visit." },
  { group: "Phrases: Contacts", key: 'ph_contact_name', default: "Name, or what this number is for", hint: "The grey prompt in a contact's name." },
  { group: "Phrases: Contacts", key: 'ph_contact_about', default: "e.g. The plumber a friend recommended", hint: "The example in \"What was this? / who are they\"." },
  { group: "Phrases: Contacts", key: 'ph_cases', default: "A case is an ongoing saga (e.g. a complaint or an insurance claim): references, people, calls, letters, tasks and notes in one timeline.", hint: "The hint on the Cases page." },
  { group: "Phrases: Contacts", key: 'ph_case_summary', default: "What is this about?", hint: "The grey prompt in a case's summary." },
  { group: "Phrases: Contacts", key: 'ph_case_note', default: "Add a note (e.g. letter received: they want more details)", hint: "The grey prompt for a note on a case." },
  { group: "Phrases: Contacts", key: 'ph_case_letters', default: "Letters: scans linked to this case will show here once Scans is built.", hint: "On a case, about letters." },
  { group: "Phrases: Contacts", key: 'ph_contact_notes', default: "Record contact notes here", hint: "The grey prompt in a contact's notes." },
  { group: "Phrases: Contacts", key: 'ph_new_category', default: "e.g. Plumbers, Painters, Pub mates, Call centres", hint: "The example in the New category box." },
  { group: "Phrases: Contacts", key: 'ph_new_case', default: "e.g. Broadband complaint, Insurance claim", hint: "The example in the New case box." },
  { group: "Phrases: Contacts", key: 'ph_new_task', default: "What needs doing?", hint: "The grey prompt when adding a task from a case." },
  { group: "Phrases: Settings", key: 'ph_history', default: "Every change on this device. Undo any of them, in any order; undoing is itself a change you can undo. Tap ⠿ to select several, then Undo in the bar.", hint: "The hint on the History page." },
  { group: "Phrases: Settings", key: 'ph_history_search', default: "Search history…", hint: "The search box on the History page." },
  { group: "Phrases: Settings", key: 'ph_set_size', default: "For this device only. Smaller fits more on the page.", hint: "Under Text size." },
  { group: "Phrases: Settings", key: 'ph_set_down', default: "Days to go easy. The planner nudges you to do less.", hint: "Under Down days." },
  { group: "Phrases: Settings", key: 'ph_set_evening', default: "Evening plans", hint: "The default name of the section after the day ends." },
  { group: "Phrases: Settings", key: 'ph_set_words', default: "Call things what you call them: the names of the areas, the task lists and headings, and what each energy level means for you. (Energy helps you fit the day to how you feel: pick a level for the day, mark tasks with the level they need, and Sift can suggest tasks that match. The meanings show when you hover over or hold the ⚡.)", hint: "The text on the Your words card." },
  { group: "Phrases: Settings", key: 'ph_set_notes', default: "In any note, 📞 links a contact, 📝 links anything, ⚠️ links something important. Or just keep the emoji.", hint: "The text on the Notes card." },
  { group: "Phrases: Settings", key: 'ph_set_backup', default: "Backups are a single .sift file. On iPhone, save it to Files or iCloud Drive. Restoring merges: nothing on this device is lost, and the newest edit of each field wins.", hint: "The hint on the Backup card." },
  { group: "Phrases: Settings", key: 'ph_set_history', default: "Every change on this device, newest first. Undo any of them individually, in any order.", hint: "The text on the History card." },
  { group: "Phrases: Settings", key: 'ph_set_exchange', default: "Days from the Day Planner as plain text: each day's tasks (done and not done) with their notes, and the day's notes.", hint: "The text on the Data exchange card." },
  { group: "Phrases: Settings", key: 'ph_set_clear', default: "These can't be undone. Back up first if you might want anything back.", hint: "The text on the Clear and erase card." },
  { group: "Phrases: Settings", key: 'ph_set_erase', default: "Erasing removes every task, plan, note, contact, box and setting stored here. The app itself stays installed.", hint: "Under \"Erase all data on this device\"." },
  { group: "Phrases: Sync", key: 'ph_sync_pw', default: "Your other devices are signed out and sign in again with the new password. Your data doesn't change.", hint: "Under Change password." },
  { group: "Phrases: Sync", key: 'ph_sync_signed_in', default: "Your data is encrypted on this device before it's sent; the server can't read it. Signing out keeps everything on this device.", hint: "At the bottom of Sync when signed in." },
  { group: "Phrases: Sync", key: 'ph_sync_intro', default: "Sync keeps your phone and laptop in step through your own server. Everything is encrypted here first; the server only stores scrambled copies.", hint: "At the top of Sync when signed out." },
  { group: "Phrases: Sync", key: 'ph_sync_cert', default: "A server at home makes its own security certificate, and each device has to trust it once. (A server with a proper web address doesn't need this.)", hint: "Over the Get the certificate button." },
  { group: "Phrases: Sync", key: 'ph_sync_cert_then', default: "Then reload this page and check the address again.", hint: "After the steps for trusting the certificate." },
  { group: "Phrases: Sync", key: 'ph_sync_recover', default: "Enter your email above, the recovery code you saved when you made the account, and a new password. Your other devices are signed out.", hint: "Under Forgot password." },
  { group: "Phrases: Settings", key: 'ph_set_dictionary', default: "Customise the app's wording here. Click into the word or phrase to change it.", hint: "At the top of this Dictionary." },
  { group: "Phrases: Settings", key: 'ph_set_types', default: "What a note can be marked as, to filter by later. They are just labels: none of them changes what Sift does. Removing one keeps its notes; they show the old name until you pick another.", hint: "At the top of Brain Dump types." },
  { group: "Phrases: Settings", key: 'ph_set_new_type', default: "A new type, e.g. Recipe", hint: "The grey prompt for a new Brain Dump type." },
];

export const DEFAULT_TYPES = [
  { id: 'thought', label: 'Thought' },
  { id: 'idea', label: 'Idea' },
  { id: 'task', label: 'Task' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'journal', label: 'Journal' },
  { id: 'place_item', label: 'Thing to store' },
];

const defaults = Object.fromEntries(WORDS.map(w => [w.key, w.default]));
let custom = {};
let types = DEFAULT_TYPES;

export const word = key => custom[key] || defaults[key] || key;
export const isCustom = key => !!custom[key];
export const dumpTypes = () => types;

export async function applyWords() {
  const s = await store.getSettings();
  custom = {};
  for (const w of WORDS) {
    const v = String(s[w.key] ?? '').trim();
    if (v && v !== w.default) custom[w.key] = v;
  }
  types = Array.isArray(s.dump_types) && s.dump_types.length ? s.dump_types.filter(t => t?.id && t.label) : DEFAULT_TYPES;
  return { custom, types };
}

// Save one word (empty or the default = back to the default).
export async function setWord(key, text) {
  const v = String(text ?? '').trim();
  await store.updateSettings({ [key]: !v || v === defaults[key] ? null : v });
  await applyWords();
}

export async function setDumpTypes(list) {
  const same = JSON.stringify(list) === JSON.stringify(DEFAULT_TYPES);
  await store.updateSettings({ dump_types: same ? null : list });
  await applyWords();
}

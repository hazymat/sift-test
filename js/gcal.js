// Google Calendar, read only, for the Day Planner (👁 Show Google Calendar).
// Signing in happens in the browser (Google's own sign-in, in a popup): no
// server, and nothing goes through Sift's sync. Google's permission lasts an
// hour; after that, a tap on Refresh (or Load, or Connect) asks again, which is
// usually just a quick popup that closes itself.
// What's fetched stays small: your main calendar, a range of days at a time,
// only each event's name, times, place, description and link. Each day fetched is kept on
// this device (sync_meta, not synced) until it's fetched again: today and the
// next 7 days load by themselves; further days when you press Load; Refresh
// fetches again the days already loaded, from today on. Past days are never
// fetched again.
//
//   connected()            has this device connected (and not disconnected)?
//   ready()                 is there a live permission (no popup needed)?
//   connect()               sign in (needs a tap: it opens Google's popup)
//   disconnect()
//   dayEvents(date)         { at, events } for a day fetched, or null
//   load(from, to)          fetch the days from … to (ISO dates, inclusive) and keep them
//   refreshDays(date)       the days a Refresh fetches: today + 7, those loaded since, and this one
//   AHEAD                   days after today that load by themselves (7)

import * as store from './store.js';

const CLIENT_ID = '608204699309-s1aumq1dur7r79pu1al0t8gmggheeml5.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const API = 'https://www.googleapis.com/calendar/v3';
const CONNECTED = 'sift-gcal';
const TOKEN = 'sift-gcal-token';
export const AHEAD = 7;

let token = null;
let expires = 0;
try { const t = JSON.parse(sessionStorage.getItem(TOKEN) || 'null'); if (t && t.exp > Date.now()) { token = t.token; expires = t.exp; } } catch { /* none */ }

export const connected = () => { try { return siftTestStorage.getItem(CONNECTED) === '1'; } catch { return false; } };
export const ready = () => !!token && Date.now() < expires - 60000;

// Google's sign-in script, fetched the first time it's needed.
let gis = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gis ??= new Promise((ok, fail) => {
    const s = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', async: true });
    s.onload = () => ok();
    s.onerror = () => { gis = null; fail(new Error("Couldn't reach Google")); };
    document.head.append(s);
  });
  return gis;
}

export async function connect() {
  await loadGis();
  await new Promise((ok, fail) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: r => {
        if (r.error || !r.access_token) return fail(new Error(r.error_description || r.error || 'Not connected'));
        token = r.access_token;
        expires = Date.now() + (Number(r.expires_in) || 3600) * 1000;
        try { sessionStorage.setItem(TOKEN, JSON.stringify({ token, exp: expires })); siftTestStorage.setItem(CONNECTED, '1'); } catch { /* kept for now only */ }
        ok();
      },
      error_callback: e => fail(new Error(e?.type === 'popup_closed' ? 'Closed before connecting' : e?.message || 'Not connected')),
    });
    client.requestAccessToken({ prompt: connected() ? '' : 'consent' });
  });
}

export async function disconnect() {
  const t = token;
  token = null;
  expires = 0;
  try { sessionStorage.removeItem(TOKEN); siftTestStorage.removeItem(CONNECTED); } catch { /* fine */ }
  const days = (await store.metaGet('gcal:days')) || [];
  for (const d of days) await store.metaSet(`gcal:${d}`, undefined);
  await store.metaSet('gcal:days', undefined);
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {});
}

// ---------- dates (the device's own time zone) ----------
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const today = () => iso(new Date());

export async function dayEvents(date) {
  return (await store.metaGet(`gcal:${date}`)) || null;
}

export async function refreshDays(date) {
  const t = today();
  const days = new Set(((await store.metaGet('gcal:days')) || []).filter(d => d >= t));
  for (let n = 0; n <= AHEAD; n++) days.add(addDays(t, n));
  if (date) days.add(date);
  return [...days].sort();
}

// An event's description as plain text (Google keeps it as simple HTML).
function plain(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
  return div.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

async function api(path, params) {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { token = null; expires = 0; try { sessionStorage.removeItem(TOKEN); } catch { /* fine */ } throw Object.assign(new Error('Google needs you to connect again'), { auth: true }); }
  if (!res.ok) throw new Error(`Google Calendar said ${res.status}`);
  return res.json();
}

// Fetch the days from … to (inclusive; ISO dates) in one go, and keep each one
// (also the days with nothing on, so they show as loaded). `only`: keep just these days.
export async function load(from, to, only = null) {
  if (!ready()) throw Object.assign(new Error('Not connected'), { auth: true });
  const items = [];
  let pageToken;
  do {
    const r = await api('calendars/primary/events', {
      timeMin: parse(from).toISOString(),
      timeMax: parse(addDays(to, 1)).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      fields: 'items(id,summary,description,start,end,location,status,htmlLink),nextPageToken',
      ...(pageToken ? { pageToken } : {}),
    });
    items.push(...(r.items || []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  const at = Date.now();
  const byDay = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) if (!only || only.includes(d)) byDay.set(d, []);
  for (const e of items) {
    if (e.status === 'cancelled') continue;
    const allDay = !!e.start?.date;
    const start = allDay ? e.start.date : iso(new Date(e.start.dateTime));
    // The last day it's on: an all-day event's end date is the day after; a timed one ending at midnight ends the day before.
    const endAt = allDay ? addDays(e.end.date, -1) : iso(new Date(new Date(e.end.dateTime).getTime() - 1));
    const event = { id: e.id, title: e.summary || '(No title)', allDay, start: allDay ? null : e.start.dateTime, end: allDay ? null : e.end.dateTime, location: e.location || '', link: e.htmlLink || '', note: plain(e.description) };
    for (let d = start; d <= endAt; d = addDays(d, 1)) if (byDay.has(d)) byDay.get(d).push(event);
  }
  for (const [d, events] of byDay) await store.metaSet(`gcal:${d}`, { at, events });
  const days = new Set((await store.metaGet('gcal:days')) || []);
  for (const d of byDay.keys()) days.add(d);
  await store.metaSet('gcal:days', [...days].sort());
}

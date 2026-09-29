// Sharing with other people on your server (sync.js does the work): the sheet
// that shares something and shows who has it, invitations, and the note that
// says when someone else's things are on screen.
//
// What others share lives in a space of its own on this device (store.js), so
// it never mixes with your own: each area shows it apart ("Shared with me").

import * as sync from './sync.js';
import * as store from './store.js';
import { toast } from './toast.js';
import { askYes } from './ask.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const personName = sync.personName;
const KIND_WORDS = { list: 'a list', note: 'a note', days: 'their diary' };
const sameScope = (a, b) => a.kind === b.kind && (a.kind === 'days' ? a.from === b.from && a.to === b.to : a.id === b.id);
const fmtDate = d => new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

// What a share holds, in words: "Shopping List", "Sat 28 Sep", "28 Sep to 4 Oct", "all days".
export function scopeText(info) {
  if (info.kind !== 'days') return `"${info.name || 'Untitled'}"`;
  if (!info.from && !info.to) return 'all days';
  return info.from === info.to ? fmtDate(info.from) : `${fmtDate(info.from)} to ${fmtDate(info.to)}`;
}

// Your own share of this thing (null if it isn't shared).
export const myShare = info => sync.sharesNow().find(sh => sh.mine && sameScope(sh.info, info)) || null;
// Who else has it: "Anna", "Anna and Bob".
export function sharedWithText(info) {
  const names = (myShare(info)?.members || []).filter(m => m.user_id !== sync.myUserId()).map(m => personName(m.email));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '';
}
// Shares from other people that you accepted, of these kinds.
export const fromOthers = kinds => sync.sharesNow().filter(sh => !sh.mine && sh.accepted && kinds.includes(sh.info?.kind));
// People sharing these kinds with you: [{ owner_id, name, shares }].
export function people(kinds) {
  const out = new Map();
  for (const sh of fromOthers(kinds)) {
    if (!out.has(sh.owner_id)) out.set(sh.owner_id, { owner_id: sh.owner_id, name: personName(sh.owner_email), shares: [] });
    out.get(sh.owner_id).shares.push(sh);
  }
  return [...out.values()];
}

// Invitations waiting for you, of these kinds: Accept or Decline.
export function invitesHtml(kinds) {
  const waiting = sync.sharesNow().filter(sh => !sh.mine && !sh.accepted && kinds.includes(sh.info?.kind));
  return waiting.map(sh => `<div class="share-invite">
    <span><b>${esc(personName(sh.owner_email))}</b> wants to share ${sh.info.kind === 'days' ? `their day plan (${esc(scopeText(sh.info))})` : `${KIND_WORDS[sh.info.kind]}, ${esc(scopeText(sh.info))},`} with you.</span>
    <span class="spacer"></span>
    <button type="button" class="primary" data-share-accept="${sh.id}">Accept</button>
    <button type="button" data-share-decline="${sh.id}">Decline</button>
  </div>`).join('');
}

// The note over someone else's things: whose they are, and the way back.
export const theirsHtml = (text, back) => `<div class="theirs-note" role="status"><span>👥 ${esc(text)}</span><span class="spacer"></span>${back}</div>`;

// Share something: who has it, add someone by their sign-in email, take
// someone out, or stop sharing. `info` is { kind, id, name } or { kind: 'days', from, to }.
export function shareSheet(info, what) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet ask-sheet share-sheet';
  document.body.append(dlg);
  let error = '';
  const draw = () => {
    const sh = myShare(info);
    const others = (sh?.members || []).filter(m => m.user_id !== sync.myUserId());
    const on = !!sync.signedIn();
    dlg.innerHTML = `
      <div class="sheet-handle"></div>
      <form method="dialog">
        <h2>Share ${esc(what)}</h2>
        ${on ? `<p class="muted">With someone who has an account on your sync server. They get an invitation; once they accept, you both see and change the same ${info.kind === 'days' ? 'days' : info.kind}.</p>`
          : '<p class="muted">Sharing goes through your sync server: sign in under Settings → Sync first.</p>'}
        ${others.length ? `<ul class="share-people">${others.map(m => `<li><span><b>${esc(personName(m.email))}</b> <span class="muted">${esc(m.email)} · ${m.accepted ? 'sharing' : 'invited'}</span></span><button type="button" data-remove="${esc(m.user_id)}">Remove</button></li>`).join('')}</ul>` : ''}
        ${on ? `<label class="ask-field"><span>Their sign-in email</span><input name="email" type="email" autocomplete="off" autocapitalize="off" placeholder="name@example.com"></label>` : ''}
        ${error ? `<p class="share-error">${esc(error)}</p>` : ''}
        <div class="sheet-actions">
          ${sh ? '<button type="button" class="danger" data-stop>Stop sharing</button>' : ''}
          <span class="spacer"></span>
          <button type="button" data-close>Done</button>
          ${on ? '<button type="submit" class="primary">Share</button>' : ''}
        </div>
      </form>`;
  };
  draw();
  const off = sync.onShares(() => { if (dlg.open) draw(); });
  const busy = async (fn) => {
    error = '';
    try { await fn(); } catch (e) { error = e.message; }
    draw();
    dlg.querySelector('input[name="email"]')?.focus();
  };
  dlg.addEventListener('submit', ev => {
    ev.preventDefault();
    const email = dlg.querySelector('input[name="email"]').value.trim();
    if (!email) return;
    busy(async () => toast(`Invitation sent to ${await sync.shareWith(info, email)}`));
  });
  dlg.addEventListener('click', async ev => {
    if (ev.target === dlg) return dlg.close();
    if (ev.target.closest('[data-close]')) return dlg.close();
    const rm = ev.target.closest('[data-remove]');
    if (rm) return busy(() => sync.leaveShare(myShare(info).id, rm.dataset.remove));
    if (ev.target.closest('[data-stop]')) {
      if (!await askYes(`Stop sharing ${what}?`, { text: 'It stays yours. Everyone you shared it with loses it.', ok: 'Stop sharing', danger: true })) return;
      busy(async () => { await sync.stopSharing(myShare(info).id); toast('Not shared any more'); });
    }
  });
  dlg.addEventListener('close', () => { off(); dlg.remove(); });
  dlg.showModal();
  dlg.querySelector('input[name="email"]')?.focus();
}

// Accept / Decline / Leave anywhere in the app; a toast when a new invitation arrives.
let seen = null;
export function installSharing() {
  document.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-share-accept], [data-share-decline], [data-share-leave]');
    if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.shareAccept) { await sync.acceptShare(b.dataset.shareAccept); toast('Accepted: it will appear under Shared with me'); }
      if (b.dataset.shareDecline) { await sync.leaveShare(b.dataset.shareDecline); toast('Declined'); }
      if (b.dataset.shareLeave) {
        const sh = sync.sharesNow().find(x => x.id === b.dataset.shareLeave);
        if (!await askYes(`Leave ${sh ? `${personName(sh.owner_email)}'s ${sh.info.kind === 'days' ? 'day plan' : sh.info.kind}` : 'this'}?`, { text: 'It goes from your devices. They can share it with you again.', ok: 'Leave', danger: true })) { b.disabled = false; return; }
        store.useSpace(null);
        await sync.leaveShare(b.dataset.shareLeave);
        toast('Left');
      }
    } catch (e) { toast(e.message); b.disabled = false; }
  });
  sync.onShares(list => {
    const waiting = list.filter(sh => !sh.mine && !sh.accepted);
    if (seen) for (const sh of waiting.filter(x => !seen.has(x.id))) toast(`${personName(sh.owner_email)} wants to share ${sh.info.kind === 'days' ? 'their day plan' : KIND_WORDS[sh.info.kind]} with you: see ${sh.info.kind === 'list' ? 'Lists' : sh.info.kind === 'note' ? 'Brain Dump' : 'the Day Planner'}`);
    seen = new Set(waiting.map(sh => sh.id));
  });
}

import { sortable } from '../sortable.js';
import { toast } from '../toast.js';
import { ask, askText, askYes } from '../ask.js';
import { word } from '../words.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A theme's row in the Appearance dropdown: its name, colour swatches, and a
// line of text in its fonts (notes, and the Day Planner's title).
const themePreview = t => `<span class="theme-row" data-fonts="${t.fonts}">`
  + `<span class="theme-swatches">${t.swatches.map(c => `<span style="background:${c}"></span>`).join('')}</span>`
  + `<span class="theme-name">${t.label}</span>`
  + `<span class="theme-sample"><span class="theme-title">Monday</span> <span class="theme-note-font">Notes look like this</span></span></span>`;
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;

function formatBytes(n) {
  if (n == null) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export default {
  async mount(el, { store, app }) {
    const { versionText } = await import('../version.js');
    el.innerHTML = `
      <section class="card" id="install-card">
        <p class="muted app-version">Sift ${versionText()} <button type="button" class="link-btn" data-act="check-update">Check for updates</button> · <button type="button" class="link-btn" data-act="tour">Take the tour</button> · <button type="button" class="link-btn" data-act="tour-reset" title="Next time, the tour starts from the beginning">Reset the tour</button></p>
        <p class="muted sync-top" id="sync-top" hidden></p>
        <h2>Home Screen and your data</h2>
        <div id="install-body"></div>
      </section>

      <section class="card" id="appearance-card">
        <h2>Appearance</h2>
        <details class="tool-menu theme-menu" id="theme">
          <summary class="theme-now" aria-label="Theme"></summary>
          <div class="menu theme-list" role="listbox" aria-label="Themes">
            ${app.THEMES.map(t => `<button type="button" role="option" data-value="${t.id}" aria-selected="${t.id === app.currentTheme()}">${themePreview(t)}</button>`).join('')}
          </div>
        </details>
        <p class="muted" id="theme-note"></p>
        <h3>Text size</h3>
        <div class="segmented" id="text-size" role="group" aria-label="Text size">
          ${[[87.5, 'Smaller'], [100, 'Normal'], [112.5, 'Larger'], [125, 'Largest']].map(([v, l]) => `<button type="button" data-size="${v}" style="font-size:${v / 100}em">${l}</button>`).join('')}
        </div>
        <p class="muted">${esc(word('ph_set_size'))}</p>
        <label class="check-row"><input type="checkbox" id="show-hints"> Show hints <span class="muted">(the grey help text under lists and boxes, e.g. "Enter adds a task…")</span></label>
      </section>

      <section class="card" id="nav-card">
        <h2>Navigation</h2>
        <p class="muted">Drag to reorder. The top ${app.MAX_PINNED} go in the bottom bar on your phone; the rest live under More.</p>
        <ul class="pin-list" id="nav-order"></ul>
      </section>

      <section class="card" id="planner-settings">
        <h2>Day Planner</h2>
        <div class="settings-grid">
          <label>Paper<select name="paper_style"></select></label>
          <label>Day starts<input type="time" name="day_start"></label>
          <label>Day ends<input type="time" name="day_end"></label>
          <label>Each line<select name="slot_min">${[15, 20, 30, 45, 60].map(m => `<option value="${m}">${m} min</option>`).join('')}</select></label>
          <label>Longest estimate<select name="duration_max_min">${[120, 180, 240, 300, 360, 480].map(m => `<option value="${m}">${m / 60} hours</option>`).join('')}</select></label>
        </div>
        <h3>Down days</h3>
        <p class="muted">${esc(word('ph_set_down'))}</p>
        <div class="segmented" id="down-days">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, n) => `<button type="button" data-dow="${(n + 1) % 7}">${d}</button>`).join('')}</div>
        <p class="muted">Nudges (the ▶ at the current time, the evening section, reminders) are in the Day Planner's 👁 menu.</p>
      </section>

      <section class="card" id="words-card">
        <h2>Your words</h2>
        <p class="muted">${esc(word('ph_set_words'))}</p>
        <div class="backup-row">
          <button type="button" data-words="dict">Dictionary…</button>
          <button type="button" data-words="types">Brain Dump types…</button>
        </div>
      </section>

      <section class="card" id="notes-settings">
        <h2>Notes</h2>
        <p class="muted">${esc(word('ph_set_notes'))}</p>
        <label class="check-row"><input type="checkbox" name="spot_details"> Turn phone numbers and emails typed into notes into contacts (with Undo)</label>
        <div class="settings-grid">
          <label>Phone numbers without a country code are from<select name="phone_country"></select></label>
          <label>Keep note history for<select name="note_history_days"><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="0">Forever</option></select></label>
        </div>
        <p class="muted">Every note keeps its earlier versions for this long: Ctrl+Z steps back through them once this visit's changes run out, and 🕘 in a note's full toolbar (Aa) lists them.</p>
      </section>

      <section class="card" id="batch-settings">
        <h2>Batch Book</h2>
        <p class="muted">Example recipes with photos, to try Batch Book out. Any you already have are left as they are; ones you deleted come back.</p>
        <button type="button" data-act="batch-examples">Add example recipes</button>
      </section>

      <section class="card" id="backup-card">
        <h2>Backup</h2>
        <p class="muted" id="backup-status">Until sync is set up, this device holds the only copy of your data.</p>
        <div class="backup-row">
          <button type="button" class="primary" data-act="backup">Back up now</button>
          <label class="check-row"><input type="checkbox" id="backup-lock"> Lock with a passphrase</label>
        </div>
        <div class="backup-row">
          <label class="file-btn">Restore from a backup…<input type="file" id="restore-file" accept=".sift,application/json,application/gzip,application/octet-stream" hidden></label>
        </div>
        <p class="muted hint">${esc(word('ph_set_backup'))}</p>
      </section>

      <section class="card">
        <h2>History</h2>
        <p class="muted">${esc(word('ph_set_history'))}</p>
        <a class="seg-link" href="#/history">Open history</a>
      </section>

      <section class="card">
        <h2>Storage</h2>
        <dl class="facts" id="storage"></dl>
      </section>

      <section class="card" id="sync-card">
        <h2>Sync</h2>
        <div id="sync-body"></div>
      </section>

      <section class="card" id="exchange-card">
        <h2>Data exchange</h2>
        <p class="muted">${esc(word('ph_set_exchange'))}</p>
        <div class="settings-grid">
          <label>From<input type="date" name="ex_from"></label>
          <label>To<input type="date" name="ex_to"></label>
        </div>
        <label class="check-row"><input type="checkbox" name="ex_links" checked> Include linked items (contacts, tasks…) as a numbered list at the end</label>
        <div class="backup-row">
          <button type="button" data-ex="copy">Copy to clipboard</button>
          <button type="button" data-ex="download">Download .txt</button>
        </div>
        <pre class="ex-preview" hidden></pre>
      </section>

      <section class="card">
        <h2>This device</h2>
        <dl class="facts">
          <dt>Device id</dt><dd><code>${store.getDeviceId()}</code></dd>
          <dt>Installed</dt><dd>${matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'Yes' : 'No, running in the browser'}</dd>
        </dl>
      </section>

      <section class="card danger-zone" id="erase-card">
        <h2>Clear and erase</h2>
        <p class="muted">${esc(word('ph_set_clear'))}</p>
        <div class="backup-row">
          <button type="button" data-erase="drafts">Clear unsaved drafts</button>
          <button type="button" data-erase="history">Clear the undo history</button>
        </div>
        <div class="backup-row">
          <button type="button" class="danger" data-erase="all">Erase all data on this device…</button>
        </div>
        <p class="muted hint">${esc(word('ph_set_erase'))}</p>
      </section>
    `;

    // Home Screen: on an iPhone, an app not on the Home Screen can lose its data after 7 days.
    {
      const install = await import('../install.js');
      const box = el.querySelector('#install-body');
      const draw = async () => { box.innerHTML = await install.cardHtml(); };
      box.addEventListener('click', async ev => {
        const b = ev.target.closest('[data-install]');
        if (!b) return;
        if (b.dataset.install === 'how') box.querySelector('.install-steps').hidden = !box.querySelector('.install-steps').hidden;
        if (b.dataset.install === 'prompt') { await install.promptInstall(); draw(); }
      });
      await draw();
    }

    // Sync: sign in (or create the account on a fresh server), then it runs
    // by itself. Everything is encrypted on this device before it leaves.
    {
      const sync = await import('../sync.js');
      const box = el.querySelector('#sync-body');
      const ago = iso => {
        if (!iso) return 'not yet';
        const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
        return s < 5 ? 'just now' : s < 60 ? `${s} seconds ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(iso).toLocaleString();
      };
      // In plain words: is this device in step, and can it reach the server?
      const stateText = st => ({
        syncing: 'Syncing…',
        ok: st.pending ? `Waiting to send ${st.pending} change${st.pending === 1 ? '' : 's'}` : 'In step, as far as this device knows',
        offline: "Can't reach the server (no signal, or it's down). Changes wait here and go when it can be reached.",
        error: `Couldn't sync: ${st.error}`,
        idle: 'Waiting to sync…',
      }[st.state] || '');
      const LINK = { good: 'Connected', slow: 'Connected, slow', weak: 'Weak connection: some requests failing, retrying', down: "Can't reach the server: retrying", unknown: 'Checking…' };
      const reachText = st => `<span class="sync-pulse" data-at="${st.checked || ''}"></span>${LINK[st.link || 'unknown']}${st.reached ? ` · last answered ${ago(st.reached)}` : ''}`;
      // Everything made on this device is on the server.
      const allUp = st => st.state === 'ok' && !st.pending && !st.filesWaitingUp;
      const filesText = st => (st.files === 'error' ? `couldn't sync files: ${st.fileError}`
        : st.filesWaiting ? `${st.filesWaiting} still to arrive or send${st.files === 'syncing' ? ' (sending now)' : ''}` : 'all here');
      const factsHtml = st => `
              <dt>Now</dt><dd>${stateText(st)}</dd>
              <dt>Waiting to send</dt><dd>${st.pending ? `${st.pending} change${st.pending === 1 ? '' : 's'}` : allUp(st) ? '<span class="sync-tick">✓</span> nothing: everything on this device is on the server' : 'nothing'}</dd>
              <dt>Last tried</dt><dd>${ago(st.tried)}</dd>
              <dt>Last finished</dt><dd>${ago(st.last)}${st.last ? ` (${st.received || 0} change${st.received === 1 ? '' : 's'} came in)` : ''}</dd>
              <dt>Server</dt><dd>${reachText(st)}</dd>
              <dt>Files</dt><dd>${filesText(st)}</dd>
              <dt>Data code</dt><dd id="sync-code">${code ? `<b>${code.words}</b> <span class="muted">(${code.records} records)</span>` : '…'}</dd>`;
      // Only the facts are redrawn as sync moves on (not the forms in the box).
      let wasSignedIn = null;
      const paintFacts = st => {
        const dl = el.querySelector('#sync-line');
        if (!dl || wasSignedIn !== !!sync.signedIn()) { wasSignedIn = !!sync.signedIn(); return draw().then(paintCode); }
        dl.innerHTML = factsHtml(st);
        return paintCode();
      };
      // The data code: worked out when Settings is open, at most every few seconds.
      let code = null;
      let codeAt = 0;
      const paintCode = async () => {
        const out = el.querySelector('#sync-code');
        if (!out) return;
        if (!code || Date.now() - codeAt > 4000) { code = await sync.dataCode(); codeAt = Date.now(); }
        out.innerHTML = `<b>${code.words}</b> <span class="muted">(${code.records} records)</span>`;
      };
      const paintTop = st => {
        const top = el.querySelector('#sync-top');
        if (!top) return;
        top.hidden = !sync.signedIn();
        top.innerHTML = `${allUp(st) ? '<span class="sync-tick">✓</span> ' : ''}Sync: ${st.state === 'ok' && !st.pending ? 'in step' : stateText(st).split('.')[0].toLowerCase()} · ${LINK[st.link || 'unknown'].split(':')[0].toLowerCase()} · last finished ${ago(st.last)}`;
      };
      // Draws can overlap (status changes while one is waiting): only the latest one writes.
      let drawing = 0;
      const draw = async () => {
        const mine = ++drawing;
        await sync.ready;
        if (mine !== drawing) return;
        const acct = sync.signedIn();
        const st = sync.status;
        if (acct) {
          box.innerHTML = `
            <p><b>Signed in</b> as ${acct.email} on <code>${acct.server.replace(/^https?:\/\//, '')}</code></p>
            <dl class="sync-facts" id="sync-line">${factsHtml(st)}</dl>
            <p class="muted hint sync-code-hint">Two devices showing the same three words hold the same data. Different words: one of them is still catching up (or can't reach the server).</p>
            <div class="backup-row">
              <button type="button" class="primary" data-sync="now">Sync now</button>
              <button type="button" data-sync="devices">Devices</button>
              <button type="button" data-sync="pwform">Change password</button>
              <button type="button" data-sync="out">Sign out on this device</button>
            </div>
            <ul class="sync-devices" hidden></ul>
            <div class="sync-pw" hidden>
              <form class="settings-grid sync-form">
                <input type="text" name="username" autocomplete="username" value="${esc(acct?.email || '')}" hidden>
                <label>Current password<input name="oldpw" type="password" autocomplete="current-password" class="no-inline"></label>
                <label>New password<input name="newpw" type="password" autocomplete="new-password" class="no-inline"></label>
              </form>
              <div class="backup-row">
                <button type="button" class="primary" data-sync="pw">Change password</button>
                <span class="muted" id="sync-msg"></span>
              </div>
              <p class="muted hint">${esc(word('ph_sync_pw'))}</p>
            </div>
            <p class="muted hint">${esc(word('ph_sync_signed_in'))}</p>`;
          return;
        }
        // What was typed in Server and Email stays on this device (like an unsaved note) until it's cleared.
        const typed = await store.getDeviceSettings();
        if (mine !== drawing) return;
        if (sync.signedIn()) return draw();
        const { isIOS, isStandalone } = await import('../install.js');
        const iosApp = isIOS() && isStandalone();
        box.innerHTML = `
          <p class="sync-out-reason" hidden></p>
          <p class="muted">${esc(word('ph_sync_intro'))}</p>
          <form class="settings-grid sync-form">
            <label class="wide">Server<input name="server" value="${esc(typed.server_url || '')}" placeholder="https://your-server" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off" class="no-inline"></label>
            <label>Email<input name="email" type="email" value="${esc(typed.sync_email || '')}" autocomplete="username" class="no-inline"></label>
            <label>Password<input name="password" type="password" autocomplete="current-password" class="no-inline"></label>
          </form>
          <p class="sync-reach" hidden><span class="sync-reach-text"></span><button type="button" class="link-btn sync-recheck">Check again</button></p>
          <div class="backup-row">
            <button type="button" class="primary" data-sync="in">Sign in</button>
            <button type="button" data-sync="create" hidden>Create account</button>
            <button type="button" data-sync="forgot">Forgot password?</button>
            <span class="muted" id="sync-msg"></span>
          </div>
          <div class="trust-cert" hidden>
            <p class="muted">${esc(word('ph_sync_cert'))}</p>
            <div class="trust-row">
              ${iosApp ? '<button type="button" class="primary" data-sync="copy-cert">Get the certificate</button>' : `<a class="button trust-link"${isIOS() ? '' : ' target="_blank" rel="noopener"'}>Get the certificate</a>`}
              <code class="trust-url"></code>
            </div>
            <p class="muted trust-copied" hidden>Copied. Now open <b>Safari</b>, tap the address bar, paste and go. Allow the download, then follow the iPhone steps below.</p>
          </div>
          <details class="trust-help" hidden>
            <summary>Trust this server: the steps for each device</summary>
            <ul class="trust-steps">
              <li><b>iPhone / iPad:</b> <ol>
                <li>Get the certificate (above) in <b>Safari</b> and tap <b>Allow</b>.</li>
                <li>Settings → Profile Downloaded → Install.</li>
                <li>Settings → General → About → <b>Certificate Trust Settings</b> → switch it on. <b>Installing the profile isn't enough without this switch.</b> After an iOS update, check it again.</li>
              </ol></li>
              <li><b>Android:</b> download it, then Settings → Security → Encryption &amp; credentials → Install a certificate → CA certificate.</li>
              <li><b>Windows:</b> download it, double-click → Install Certificate → Local Machine → "Trusted Root Certification Authorities". Restart the browser.</li>
              <li><b>Mac:</b> download it, double-click → Keychain Access; open it, choose Trust → "Always Trust".</li>
            </ul>
            <p class="muted">${esc(word('ph_sync_cert_then'))}</p>
          </details>
          <div class="sync-recover" hidden>
            <p class="muted">${esc(word('ph_sync_recover'))}</p>
            <form class="settings-grid sync-form">
              <input type="text" name="username" autocomplete="username" value="${esc(typed.sync_email || '')}" hidden>
              <label class="wide">Recovery code<input name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" class="no-inline"></label>
              <label>New password<input name="newpw" type="password" autocomplete="new-password" class="no-inline"></label>
            </form>
            <div class="backup-row"><button type="button" class="primary" data-sync="recover">Set new password</button></div>
          </div>`;
        const reason = box.querySelector('.sync-out-reason');
        if (st.error) { reason.textContent = st.error; reason.hidden = false; }
        const serverInput = box.querySelector('[name="server"]');
        box.querySelector('[name="email"]').addEventListener('input', ev => store.updateDeviceSettings({ sync_email: ev.target.value.trim() }));
        // Whether the server answers, and if so whether it takes new accounts (that's when Create account shows).
        // Checked again on leaving the field, with Check again, and every 12 s while the server can't be reached or isn't taking accounts (it may be changed on the server meanwhile).
        let checking = 0;
        let lastResult = '';
        let checkedServer = null;
        const check = (quiet = false) => {
          const server = serverInput.value.trim();
          clearTimeout(serverInput._t);
          checkedServer = server;
          const create = box.querySelector('[data-sync="create"]');
          const reach = box.querySelector('.sync-reach');
          const reachText = box.querySelector('.sync-reach-text');
          const help = box.querySelector('.trust-help');
          const cert = box.querySelector('.trust-cert');
          const mine = ++checking;
          clearTimeout(this.reachTick);
          if (!quiet) {
            lastResult = '';
            create.hidden = true;
            help.hidden = true;
            help.open = false;
            cert.hidden = true;
            reach.hidden = true;
          }
          if (!/^https?:\/\/.+/i.test(server)) return;
          if (!quiet) { reachText.textContent = 'Looking for the server…'; reach.hidden = false; }
          const again = () => { if (el.isConnected && !sync.signedIn()) this.reachTick = setTimeout(() => check(true), 12000); };
          sync.serverInfo(server).then(info => {
            if (mine !== checking || !el.isConnected) return;
            const open = info.registration === 'open';
            lastResult = open ? 'open' : 'closed';
            create.hidden = !open;
            help.hidden = true;
            cert.hidden = true;
            reachText.textContent = open ? '✓ Server found. It is taking new accounts: sign in, or create an account.'
              : "✓ Server found. It isn't taking new accounts, so there's no Create account: sign in with an account that already exists. To add a person, the server has to allow new accounts first (sift-admin registration open, see the server guide). This updates by itself once it does.";
            if (!open) again();
          }).catch(() => {
            if (mine !== checking || !el.isConnected) return;
            const https = /^https:/i.test(server);
            create.hidden = true;
            reachText.textContent = `Can't reach the server. Create account only shows once it can. Check this device is on the same network as the server${https ? (isIOS() ? ", and that the certificate is switched on: Settings → General → About → Certificate Trust Settings (installing the profile isn't enough)" : ', and that it trusts the certificate (below)') : ''}.`;
            again();
            if (!https || (quiet && lastResult === 'down')) return;
            lastResult = 'down';
            try {
              const url = `http://${new URL(server).hostname}/sift-ca.crt`;
              cert.querySelector('.trust-url').textContent = url;
              const link = cert.querySelector('.trust-link');
              if (link) link.href = url;
              cert.hidden = false;
              help.hidden = false;
              help.open = true;
            } catch { /* not a web address yet */ }
          });
        };
        serverInput.addEventListener('blur', () => check(serverInput.value.trim() === checkedServer));
        box.querySelector('.sync-recheck').addEventListener('click', () => check());
        serverInput.addEventListener('input', () => {
          store.updateDeviceSettings({ server_url: serverInput.value.trim() });
          clearTimeout(serverInput._t);
          serverInput._t = setTimeout(() => check(), 600);
        });
        // In the Home Screen app a link opens a small browser that can't install a profile (a blank page), so it goes through Safari.
        box.querySelector('[data-sync="copy-cert"]')?.addEventListener('click', async () => {
          const url = box.querySelector('.trust-url').textContent;
          try { await navigator.clipboard.writeText(url); box.querySelector('.trust-copied').hidden = false; } catch { toast(`Open this in Safari: ${url}`); }
        });
        check();
      };
      sync.onStatus(st => { if (el.isConnected) { paintFacts(st); paintTop(st); } });
      // Keep "… seconds ago" current while Settings is open.
      this.syncTick = setInterval(() => { if (!el.isConnected) return clearInterval(this.syncTick); if (sync.signedIn()) { paintFacts(sync.status); paintTop(sync.status); } }, 5000);
      // While Settings is open, a quick check of the connection every 10 s (each shows as a pulse).
      this.linkTick = setInterval(() => { if (!el.isConnected) return clearInterval(this.linkTick); if (sync.signedIn()) sync.checkLink(); }, 10000);
      if (sync.signedIn()) sync.checkLink();
      box.addEventListener('click', async ev => {
        const b = ev.target.closest('[data-sync]');
        if (!b) return;
        const what = b.dataset.sync;
        const val = n => box.querySelector(`[name="${n}"]`)?.value.trim();
        const msg = t => { const m = box.querySelector('#sync-msg'); if (m) m.textContent = t; };
        try {
          if (what === 'now') return sync.syncNow();
          if (what === 'out') {
            if (!await askYes('Sign out of sync on this device?', { text: 'Everything stays on this device; it just stops syncing.', ok: 'Sign out' })) return;
            await sync.signOut();
            return draw();
          }
          if (what === 'devices') {
            const ul = box.querySelector('.sync-devices');
            ul.hidden = !ul.hidden;
            if (!ul.hidden) ul.innerHTML = (await sync.devices()).map(d => `<li>${d.name}${d.this ? ' <span class="muted">(this one)</span>' : ''} <span class="muted">· last seen ${ago(d.last_seen)}</span></li>`).join('');
            return;
          }
          if (what === 'pwform') { const f = box.querySelector('.sync-pw'); f.hidden = !f.hidden; return; }
          if (what === 'pw') {
            const oldpw = box.querySelector('[name="oldpw"]').value;
            const newpw = box.querySelector('[name="newpw"]').value;
            if (!oldpw || !newpw) return msg('Enter your current and new password');
            if (newpw.length < 10) return msg('Use at least 10 characters');
            b.disabled = true;
            msg('Changing…');
            await sync.changePassword(oldpw, newpw);
            toast('Password changed');
            return draw();
          }
          if (what === 'forgot') { const f = box.querySelector('.sync-recover'); f.hidden = !f.hidden; return; }
          const server = val('server');
          const email = val('email');
          if (what === 'recover') {
            const newpw = box.querySelector('[name="newpw"]').value;
            if (!server || !email || !val('code') || !newpw) return msg('Enter the server, your email, the recovery code and a new password');
            if (newpw.length < 10) return msg('Use at least 10 characters');
            b.disabled = true;
            msg('Setting your new password…');
            await sync.recover(server, email, val('code'), newpw);
            await sync.start();
            toast('New password set');
            return draw();
          }
          const password = box.querySelector('[name="password"]').value;
          if (!email || !password) return msg('Enter your email and password');
          if (what === 'create') {
            if (password.length < 10) return msg('Use at least 10 characters');
            b.disabled = true;
            msg('Creating your account and keys…');
            const code = await sync.register(server, email, password);
            box.innerHTML = `
              <p><b>Account created.</b> This is your <b>recovery code</b>. If you ever forget your password, it is the only way to get your data back. Nobody (not even the server) can reset it for you.</p>
              <pre class="recovery-code">${code}</pre>
              <div class="backup-row">
                <button type="button" data-copy-code>Copy</button>
                <label class="check-row"><input type="checkbox" id="code-saved"> I've saved it somewhere safe</label>
                <button type="button" class="primary" id="code-done" disabled>Start syncing</button>
              </div>`;
            box.querySelector('[data-copy-code]').onclick = () => navigator.clipboard.writeText(code).then(() => toast('Copied'));
            box.querySelector('#code-saved').onchange = e => { box.querySelector('#code-done').disabled = !e.target.checked; };
            box.querySelector('#code-done').onclick = async () => { await sync.start(); draw(); };
            return;
          }
          b.disabled = true;
          msg('Signing in…');
          await sync.signIn(server, email, password);
          await sync.start();
          draw();
        } catch (e) {
          b.disabled = false;
          msg(e instanceof TypeError ? "Can't reach the server from here (see above)" : e.message);
        }
      });
      draw();
    }

    // Data exchange: days as plain text
    {
      const card = el.querySelector('#exchange-card');
      const { isoDate, addDays } = await import('../days.js');
      card.querySelector('[name="ex_from"]').value = addDays(isoDate(), -6);
      card.querySelector('[name="ex_to"]').value = isoDate();
      card.addEventListener('click', async ev => {
        const b = ev.target.closest('[data-ex]');
        if (!b) return;
        const from = card.querySelector('[name="ex_from"]').value;
        const to = card.querySelector('[name="ex_to"]').value;
        if (!from || !to) return toast('Pick the days first');
        const { daysAsText } = await import('../exporttext.js');
        const text = await daysAsText(from, to, { links: card.querySelector('[name="ex_links"]').checked });
        const pre = card.querySelector('.ex-preview');
        pre.textContent = text;
        pre.hidden = false;
        if (b.dataset.ex === 'copy') {
          try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast("Couldn't copy: the browser blocked the clipboard. The text is shown below."); }
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
          a.download = `sift-days-${from}${to !== from ? `-to-${to}` : ''}.txt`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }
      });
    }

    // Clear and erase
    el.querySelector('#erase-card').addEventListener('click', async ev => {
      const b = ev.target.closest('[data-erase]');
      if (!b) return;
      const kind = b.dataset.erase;
      const siftKeys = prefix => { try { return Object.keys(siftTestStorage).filter(k => k.startsWith(prefix)); } catch { return []; } };
      if (kind === 'drafts') {
        const keys = siftKeys('sift:draft:');
        if (!keys.length) return toast('No unsaved drafts');
        if (!await askYes(`Clear ${keys.length} unsaved draft${keys.length === 1 ? '' : 's'}?`, { text: 'Text typed into "add" boxes but not added.', ok: 'Clear', danger: true })) return;
        keys.forEach(k => siftTestStorage.removeItem(k));
        toast('Drafts cleared');
      } else if (kind === 'history') {
        if (!await askYes('Clear the undo history?', { text: "Your data stays; you just can't undo past changes any more.", ok: 'Clear', danger: true })) return;
        await store.clearHistory();
        toast('Undo history cleared');
      } else if (kind === 'all') {
        const typed = await askText('⚠️ Erase all data on this device', { text: 'This deletes every task, plan, note, contact, box, list and setting stored here. It cannot be undone.\n\nIf you use Sync: this only clears THIS device and signs it out of Sync. Your server and other devices keep their copies (sign in again to get it all back), but anything not yet synced is lost.\n\nBack up first if you might want it.', label: 'Type DELETE (in capitals) to erase everything', ok: 'Erase everything' });
        if (typed === null) return;
        if (typed.trim() !== 'DELETE') return toast('Not erased: you have to type DELETE exactly');
        await store.eraseAll();
        [...siftKeys('sift:'), ...siftKeys('sift-')].forEach(k => siftTestStorage.removeItem(k));
        location.hash = '#/';
        location.reload();
      }
    });

    // Notes: spotting numbers and emails
    const ns = el.querySelector('#notes-settings');
    {
      const { COUNTRIES, spotSettings } = await import('../refs.js');
      const cur = await spotSettings();
      const sel = ns.querySelector('[name="phone_country"]');
      sel.innerHTML = [...COUNTRIES].sort((a, b) => a[1].localeCompare(b[1])).map(([cc, name]) => `<option value="${cc}">${name} (+${cc})</option>`).join('');
      sel.value = cur.phone_country;
      ns.querySelector('[name="spot_details"]').checked = cur.spot_details;
      ns.querySelector('[name="note_history_days"]').value = String((await store.getSettings())?.note_history_days ?? 90);
      ns.addEventListener('change', async ev => {
        const t = ev.target;
        await store.updateSettings({ [t.name]: t.type === 'checkbox' ? t.checked : t.name === 'note_history_days' ? Number(t.value) : t.value });
        toast('✓ Saved');
      });
    }

    // Day Planner settings
    const { daySettings } = await import('../days.js');
    const ps = el.querySelector('#planner-settings');
    const drawPlanner = async () => {
      const d = await daySettings();
      const { PAPERS } = await import('../days.js');
      ps.querySelector('[name="paper_style"]').innerHTML = PAPERS.map(p => `<option value="${p.id}">${p.label}</option>`).join('');
      ps.querySelector('[name="paper_style"]').value = d.paper_style;
      ps.querySelector('[name="day_start"]').value = d.day_start;
      ps.querySelector('[name="day_end"]').value = d.day_end;
      ps.querySelector('[name="slot_min"]').value = String(d.slot_min);
      ps.querySelector('[name="duration_max_min"]').value = String(d.duration_max_min);
      for (const b of ps.querySelectorAll('[data-dow]')) b.setAttribute('aria-pressed', d.down_days.includes(Number(b.dataset.dow)));
    };
    ps.addEventListener('change', async ev => {
      const t = ev.target;
      const value = t.type === 'checkbox' ? t.checked : ['slot_min', 'duration_max_min'].includes(t.name) ? Number(t.value) : t.value;
      if (t.name && value !== '') { await store.updateSettings({ [t.name]: value }); toast('✓ Saved'); }
    });
    ps.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-dow]');
      if (!b) return;
      const d = await daySettings();
      const n = Number(b.dataset.dow);
      const down = d.down_days.includes(n) ? d.down_days.filter(x => x !== n) : [...d.down_days, n];
      await store.updateSettings({ down_days: down });
      drawPlanner();
      toast('✓ Saved');
    });
    drawPlanner();

    // Your words: the Dictionary and the Brain Dump types, each in a sheet.
    el.querySelector('#words-card').addEventListener('click', async ev => {
      const b = ev.target.closest('[data-words]');
      if (!b) return;
      const w = await import('../words.js');
      await w.applyWords();
      const dlg = document.createElement('dialog');
      dlg.className = 'sheet words-sheet';
      document.body.append(dlg);
      dlg.addEventListener('close', () => dlg.remove());
      if (b.dataset.words === 'dict') {
        // Every word, grouped, with a hint and "Reset to default".
        // Each word or phrase: the text itself (edit it in place) and its reset
        // button, with a small grey line under it saying what it is and where it shows. Changed ones are marked.
        const row = x => `
          <div class="dict-row${w.isCustom(x.key) ? ' custom' : ''}" data-key="${esc(x.key)}" data-find="${esc(`${x.default} ${w.word(x.key)} ${x.hint} ${x.group}`.toLowerCase())}">
            <input data-word="${esc(x.key)}" value="${esc(w.word(x.key))}" aria-label="${esc(x.default)}" title="Default: ${esc(x.default)}" autocomplete="off">
            <button type="button" class="icon-btn small dict-reset" data-reset="${esc(x.key)}" aria-label="Reset to default" title="Reset to default: ${esc(x.default)}" ${w.isCustom(x.key) ? '' : 'disabled'}><svg class="icon" aria-hidden="true"><use href="#i-reset"/></svg></button>
            <p class="dict-hint">${esc(x.hint)}</p>
          </div>`;
        const groups = [...new Set(w.WORDS.map(x => x.group))];
        dlg.innerHTML = `<div class="sheet-handle"></div><h2>Dictionary</h2>
          <p class="muted">${esc(word('ph_set_dictionary'))}</p>
          <input type="search" class="search dict-search" placeholder="Find a word or phrase…" autocomplete="off">
          ${groups.map(g => `<section class="dict-group"><h3 class="milestone">${esc(g)}</h3>${w.WORDS.filter(x => x.group === g).map(row).join('')}</section>`).join('')}`;
        const mark = key => {
          const r = dlg.querySelector(`.dict-row[data-key="${key}"]`);
          r.classList.toggle('custom', w.isCustom(key));
          r.querySelector('[data-reset]').disabled = !w.isCustom(key);
        };
        dlg.addEventListener('input', e2 => {
          if (!e2.target.matches('.dict-search')) return;
          const words = e2.target.value.toLowerCase().split(/\s+/).filter(Boolean);
          for (const r of dlg.querySelectorAll('.dict-row')) r.hidden = !words.every(x => r.dataset.find.includes(x));
          for (const g of dlg.querySelectorAll('.dict-group')) g.hidden = ![...g.querySelectorAll('.dict-row')].some(r => !r.hidden);
        });
        dlg.addEventListener('change', async e2 => {
          const key = e2.target.dataset?.word;
          if (!key) return;
          await w.setWord(key, e2.target.value);
          if (!e2.target.value.trim()) e2.target.value = w.word(key); // emptied: the default comes back
          mark(key);
          toast('✓ Saved');
        });
        dlg.addEventListener('click', async e2 => {
          const r = e2.target.closest('[data-reset]');
          if (!r) return;
          await w.setWord(r.dataset.reset, '');
          dlg.querySelector(`[data-word="${r.dataset.reset}"]`).value = w.word(r.dataset.reset);
          mark(r.dataset.reset);
          toast('✓ Back to the default');
        });
      } else {
        // Brain Dump types: the shared sheet (typesheet.js), also on the Brain Dump page.
        dlg.remove();
        (await import('../typesheet.js')).openTypesSheet();
        return;
      }
      dlg.showModal();
    });

    // Check for updates: get the newest version now instead of waiting.
    // The tour starts from the welcome page (its three choices); reset makes it start from the beginning next time.
    el.querySelector('[data-act="tour"]').addEventListener('click', () => { location.hash = '#/welcome'; });
    el.querySelector('[data-act="batch-examples"]').addEventListener('click', async ev => { ev.target.disabled = true; await (await import('../examples.js')).addExamples(); ev.target.disabled = false; toast('Added the example recipes to Batch Book'); });
    // The sign-in and password boxes are forms (so a browser's password manager fills those, not the search box); they're never sent.
    el.addEventListener('submit', ev => ev.preventDefault());
    el.querySelector('[data-act="tour-reset"]').addEventListener('click', async () => { await (await import('../tour.js')).resetTour(); toast('The tour will start from the beginning'); });
    el.querySelector('[data-act="check-update"]').addEventListener('click', async ev => {
      const b = ev.currentTarget;
      b.disabled = true;
      b.textContent = 'Checking…';
      const r = await app.checkForUpdate();
      if (r === 'ready') { toast('Updating…'); await app.applyUpdate(); return; }
      b.disabled = false;
      b.textContent = 'Check for updates';
      toast(r === 'offline' ? "Can't reach the website to check" : `You have the latest version (${versionText()})`);
    });

    // Text size: kept on this device, applied before first paint (index.html).
    const sizeBox = el.querySelector('#text-size');
    const paintSize = () => {
      let cur = '100';
      try { cur = siftTestStorage.getItem('sift-text-size') || '100'; } catch { /* default */ }
      for (const b of sizeBox.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.size) === Number(cur)));
    };
    paintSize();
    sizeBox.addEventListener('click', ev => {
      const b = ev.target.closest('[data-size]');
      if (!b) return;
      try { b.dataset.size === '100' ? siftTestStorage.removeItem('sift-text-size') : siftTestStorage.setItem('sift-text-size', b.dataset.size); } catch { /* not kept */ }
      document.documentElement.style.fontSize = b.dataset.size === '100' ? '' : `${b.dataset.size}%`;
      paintSize();
      toast('✓ Text size changed');
    });

    const hintsBox = el.querySelector('#show-hints');
    hintsBox.checked = document.documentElement.classList.contains('show-hints');
    hintsBox.addEventListener('change', async () => {
      app.setHints(hintsBox.checked);
      await store.updateSettings({ show_hints: hintsBox.checked });
      toast(hintsBox.checked ? '✓ Hints shown' : '✓ Hints hidden');
    });

    // Theme: a dropdown whose rows preview each theme (colours and fonts).
    const themeNote = () => {
      const t = app.THEMES.find(x => x.id === app.currentTheme());
      const note = el.querySelector('#theme-note');
      note.textContent = t?.note || '';
      if (t?.id === 'custom') note.innerHTML = '<button type="button" class="link-btn" data-act="custom-theme">Change fonts and colours</button>';
      el.querySelector('#theme .theme-now').innerHTML = t ? themePreview(t) : '';
    };
    themeNote();
    el.querySelector('#theme .theme-list').addEventListener('click', async e => {
      const id = e.target.closest('[data-value]')?.dataset.value;
      if (!id) return;
      for (const b of el.querySelectorAll('#theme [data-value]')) b.setAttribute('aria-selected', b.dataset.value === id);
      el.querySelector('#theme').open = false;
      if (id === 'custom') await app.openCustomTheme(); else await app.setTheme(id);
      themeNote();
    });
    el.querySelector('#theme-note').addEventListener('click', e => { if (e.target.closest('[data-act="custom-theme"]')) app.openCustomTheme(); });

    // One list: pinned areas, a "More" divider, then everything else.
    // Dragging an area across the divider pins or unpins it.
    const list = el.querySelector('#nav-order');
    const row = a => a.pinnable === false
      ? `<li data-id="${a.id}" class="fixed"><span class="grip-space" aria-hidden="true"></span>${icon(a.icon)}<span>${a.label}</span></li>`
      : `<li data-id="${a.id}"><button type="button" class="drag-handle" aria-label="Reorder ${a.label}">${icon('i-grip')}</button>
          ${icon(a.icon)}<span>${a.label}</span></li>`;

    const renderPins = () => {
      const pinned = app.pinnedAreas();
      list.innerHTML = [
        ...pinned.map(id => row(app.AREAS.find(a => a.id === id))),
        '<li class="divider">More</li>',
        ...app.AREAS.filter(a => !a.hidden && !pinned.includes(a.id)).map(row),
      ].join('');
    };

    const divider = () => list.querySelector('.divider');
    const above = () => [...list.children].slice(0, [...list.children].indexOf(divider()));

    // Keep the rules while dragging: at most MAX_PINNED and at least one
    // pinned, and unpinnable areas always below the divider.
    const enforce = moved => {
      for (const li of above()) if (li.classList.contains('fixed')) divider().after(li);
      const pinned = above();
      if (pinned.length > app.MAX_PINNED) {
        const bump = pinned.at(-1) === moved ? pinned.at(-2) : pinned.at(-1);
        divider().after(bump);
      }
      if (!above().length) divider().before(moved.classList.contains('fixed') ? divider().nextElementSibling : moved);
    };

    sortable(list, {
      onMove: enforce,
      async onEnd() {
        const focused = document.activeElement?.closest('li')?.dataset.id;
        await app.setPinned(above().map(li => li.dataset.id));
        renderPins();
        if (focused) list.querySelector(`[data-id="${focused}"] .drag-handle`)?.focus();
      },
    });

    renderPins();

    // Backup
    const backup = await import('../backup.js');
    const { dateTimeText } = await import('../days.js');
    const backupStatus = async () => {
      const last = await backup.lastBackup();
      const overdue = await backup.backupOverdue();
      const p = el.querySelector('#backup-status');
      p.classList.toggle('warn', overdue);
      p.textContent = last
        ? `Last backup: ${dateTimeText(new Date(last), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.${overdue ? ' ⚠️ Over two weeks ago.' : ''}`
        : overdue ? '⚠️ Never backed up, and this device holds the only copy of your data.' : 'Until sync is set up, this device holds the only copy of your data.';
    };
    backupStatus();
    el.querySelector('#backup-card').addEventListener('click', async ev => {
      if (!ev.target.closest('[data-act="backup"]')) return;
      let passphrase = null;
      if (el.querySelector('#backup-lock').checked) {
        const r = await ask({ title: 'Lock this backup', text: "You'll need the passphrase to restore it. It can't be recovered.", ok: 'Make the backup', fields: [{ name: 'a', label: 'Passphrase', type: 'password' }, { name: 'b', label: 'Type it again', type: 'password' }] });
        if (!r?.a) return;
        if (r.a !== r.b) { toast("Passphrases didn't match"); return; }
        passphrase = r.a;
      }
      toast('Making a backup…');
      const made = await backup.makeBackup({ passphrase });
      const how = await backup.saveBackupFile(made);
      if (how === 'cancelled') return;
      await backup.noteBackup();
      backupStatus();
      const n = Object.entries(made.counts).filter(([k]) => k !== 'settings' && k !== 'files').reduce((a, [, v]) => a + v, 0);
      toast(`✓ Backed up ${n} record${n === 1 ? '' : 's'}${passphrase ? ' (locked)' : ''}`);
    });
    el.querySelector('#restore-file').addEventListener('change', async ev => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      let data;
      try {
        try { data = await backup.readBackup(file); }
        catch (err) {
          if (!(err instanceof backup.NeedsPassphrase)) throw err;
          const pass = await askText('This backup is locked', { label: 'Passphrase', type: 'password', ok: 'Open it' });
          if (!pass) return;
          data = await backup.readBackup(file, pass);
        }
        const result = await backup.restoreBackup(data);
        toast(`✓ Restored from ${new Date(data.created_at).toLocaleDateString()}: ${result.added} added, ${result.updated} updated`);
        setTimeout(() => location.reload(), 1800);
      } catch (err) {
        toast(`Couldn't restore: ${err.message}`);
      }
    });

    const storage = el.querySelector('#storage');
    const est = await navigator.storage?.estimate?.();
    const install = await import('../install.js');
    let persisted = await navigator.storage?.persisted?.();
    if (!persisted) { try { persisted = await navigator.storage?.persist?.(); } catch { /* not supported */ } } // ask again
    // Only an iPhone/iPad is at real risk (7 days); elsewhere the browser rarely clears a site's data.
    const protection = persisted ? 'Yes'
      : install.isIOS() ? '⚠️ No. Add Sift to your Home Screen (see the top of this page) to protect your data.'
      : "Not guaranteed. Your browser could clear this site's data if the computer ran very low on space (it rarely does). Sync or a backup covers you; installing Sift as an app (browser menu → Install) also helps.";
    storage.innerHTML = `
      <dt>Used</dt><dd>${formatBytes(est?.usage)}</dd>
      <dt>Available</dt><dd>${formatBytes(est?.quota)}</dd>
      <dt>Protected from clean-up</dt><dd>${protection}</dd>
      <dt>Unsynced changes</dt><dd>${await store.outboxSize()}</dd>
    `;
  },
};

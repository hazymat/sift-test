// Is Sift installed on the Home Screen? On an iPhone or iPad that matters: Safari
// deletes a website's saved data after 7 days without use, but an app added to the
// Home Screen is exempt. iOS does say whether the page is running from the Home
// Screen (navigator.standalone), so we can warn when it isn't.
//
//   status() → { ios, standalone, persisted }
//   installWarning() → true on an iPhone / iPad that is not on the Home Screen
//   canPromptInstall() / promptInstall() → the real install prompt where the browser has one (Chrome, Edge, Android)
//   showBanner()  a slim red reminder at the top of every page (dismiss = quiet for 3 days)

const DISMISS_KEY = 'sift:install-banner-dismissed';
const QUIET_DAYS = 3;

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

export async function status() {
  let persisted = null;
  try { persisted = await navigator.storage?.persisted?.(); } catch { /* not supported */ }
  return { ios: isIOS(), standalone: isStandalone(), persisted };
}

export const installWarning = () => isIOS() && !isStandalone();

let deferred = null;
addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); deferred = ev; });
export const canPromptInstall = () => !!deferred;
export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const choice = await deferred.userChoice.catch(() => null);
  deferred = null;
  return choice?.outcome === 'accepted';
}

export function showBanner() {
  if (!installWarning() || document.querySelector('.install-banner')) return;
  try {
    const at = Number(siftTestStorage.getItem(DISMISS_KEY));
    if (at && Date.now() - at < QUIET_DAYS * 86400000) return;
  } catch { /* shows anyway */ }
  const bar = document.createElement('div');
  bar.className = 'install-banner';
  bar.setAttribute('role', 'alert');
  bar.innerHTML = `<span>⚠️ Sift isn't on your Home Screen. Safari may delete your data after 7 days. <a href="#/settings" data-jump="install-card">What to do</a></span><button type="button" aria-label="Hide for now">✕</button>`;
  bar.querySelector('button').onclick = () => {
    try { siftTestStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* fine */ }
    bar.remove();
  };
  bar.querySelector('a').onclick = () => { setTimeout(() => document.querySelector('#install-card')?.scrollIntoView({ block: 'start' }), 400); };
  (document.querySelector('header.appbar') || document.body.firstElementChild).after(bar);
}

// The Settings card.
export async function cardHtml() {
  const s = await status();
  if (s.ios && !s.standalone) {
    return `
      <div class="install-alert" role="alert">
        <p><b>⚠️ Sift is not on your Home Screen.</b></p>
        <p>An iPhone deletes what a website has saved after about 7 days without opening it. If that happens, everything in Sift on this phone that hasn't been synced is lost for good. Sift asks Safari to keep it, but only an app on the Home Screen is safe.</p>
        <button type="button" class="primary" data-install="how">Click here to add to Home Screen</button>
        <ol class="install-steps" hidden>
          <li>Open this page in <b>Safari</b> (the blue compass), not inside another app.</li>
          <li>Tap the <b>Share</b> button (a square with an arrow, at the bottom or top).</li>
          <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          <li>Open Sift from the new icon on your Home Screen, and sign in to Sync there (the Home Screen app keeps its own copy of your data).</li>
        </ol>
        <p class="muted">If you use Sync, your data is also on your server: if the phone ever loses it, sign in again and it comes back (anything not yet synced would be lost).</p>
      </div>`;
  }
  if (s.standalone) {
    return `<p class="install-ok">✓ Sift is on your Home Screen, so ${s.ios ? "iOS won't delete its data after 7 days" : 'the browser treats it as an app'}.${s.persisted === false ? ' The browser hasn\'t agreed to keep the data yet; it will ask when it needs to.' : ''}</p>`;
  }
  return `
    <p class="muted">Sift can be installed as an app${s.persisted ? ' (your browser has agreed to keep its data)' : ''}. It works offline and keeps its data safer.</p>
    ${canPromptInstall() ? '<button type="button" class="primary" data-install="prompt">Install Sift</button>' : '<p class="muted">In your browser\'s menu, choose <b>Install app</b> (or <b>Add to Home Screen</b> on Android).</p>'}`;
}

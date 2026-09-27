// The ⚙ view menu every page has (same style as the Day Planner's). It always
// offers Spacing: tight / medium / loose, remembered per page on this device.
// Pages can add their own sections above it.
//
//   cogHtml(extraSectionsHtml)   the ⚙ button and its menu, for a page header
//   spacingHtml(area)            just the Spacing section (the Day Planner adds
//                                it to its own menu)
//   installViewCog(getArea)      once, in app.js: wires the switch and applies
//                                each page's spacing to <main data-density>

export const DENSITIES = [
  { id: 'tight', label: 'Tight', icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 7h12M2 10h12M2 13h12"/></svg>' },
  { id: 'medium', label: 'Medium', icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12M2 8h12M2 12.5h12"/></svg>' },
  { id: 'loose', label: 'Loose', icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12M2 13h12"/><path d="M2 8h8" opacity=".55"/></svg>' },
];

const key = area => `sift-density:${area}`;
export function densityOf(area) {
  try { return siftTestStorage.getItem(key(area)) || 'medium'; } catch { return 'medium'; }
}

export function spacingHtml(area) {
  const on = densityOf(area);
  return `<h4>Spacing</h4>
    <div class="view-opts density-opts" role="group" aria-label="Spacing">
      ${DENSITIES.map(d => `<button type="button" class="density-btn" data-density-set="${d.id}" aria-pressed="${d.id === on}" title="${d.label}" aria-label="${d.label}">${d.icon}</button>`).join('')}
    </div>`;
}

export function cogHtml(area, extra = '') {
  return `<details class="tool-menu view-menu page-cog">
      <summary class="icon-btn" aria-label="View settings" title="View settings"><svg class="icon" aria-hidden="true"><use href="#i-cog"/></svg></summary>
      <div class="menu view-settings">${extra}${spacingHtml(area)}</div>
    </details>`;
}

export function installViewCog(getArea) {
  const apply = () => {
    const main = document.querySelector('#main');
    if (main) main.dataset.density = densityOf(getArea());
  };
  document.addEventListener('click', ev => {
    const b = ev.target.closest?.('[data-density-set]');
    if (!b) return;
    try { siftTestStorage.setItem(key(getArea()), b.dataset.densitySet); } catch { /* not kept */ }
    for (const x of b.parentElement.querySelectorAll('[data-density-set]')) x.setAttribute('aria-pressed', String(x === b));
    apply();
  });
  return apply;
}

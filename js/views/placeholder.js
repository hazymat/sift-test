// Stand-in for areas not built yet.
export function placeholder(title, blurb, step) {
  return {
    mount(el) {
      el.innerHTML = `<div class="empty">
        <h2>${blurb}</h2>
        <p class="muted">Coming in phase 1, step ${step}.</p>
      </div>`;
    },
  };
}

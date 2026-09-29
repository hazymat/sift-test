// Stand-in for areas not built yet.
export function placeholder(title, blurb) {
  return {
    mount(el) {
      el.innerHTML = `<div class="empty">
        <h2>${blurb}</h2>
        <p class="muted">Coming soon.</p>
      </div>`;
    },
  };
}

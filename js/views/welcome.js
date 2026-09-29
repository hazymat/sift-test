// The first time Sift is opened on a device with nothing in it (app.js): a
// welcome, and the choice of the tour now, later (a task that starts it), or
// not at all. #/welcome; not in the navigation.
import * as store from '../store.js';
import { startTour, showTourTask, progress } from '../tour.js';

export default {
  async mount(el) {
    const was = await progress(); // started before: it carries on from there
    el.innerHTML = `<div class="welcome">
      <section class="card welcome-card">
        <h2>Welcome!</h2>
        <p class="welcome-lead">You've found an extremely useful app and I can't wait to show it to you. What do you want to do?</p>
        <div class="welcome-choices">
          <button type="button" class="primary" data-act="tour">See the tour now?</button>
          ${was ? `<p class="muted welcome-was">It carries on from step ${was.n + 1} of ${was.total}, where you left it.</p>` : ''}
          <button type="button" data-act="later">Put it on my to do list?</button>
          <button type="button" data-act="skip">Just use the app</button>
        </div>
      </section>
    </div>`;
    el.querySelector('[data-act="tour"]').focus();
    el.addEventListener('click', async ev => {
      const act = ev.target.closest('button[data-act]')?.dataset.act;
      if (!act) return;
      await store.updateDeviceSettings({ welcomed: true });
      // Later: a task like any other, with a pill that starts the tour (views/tasks.js), shown so it can be found.
      if (act === 'later') return showTourTask();
      location.hash = '#/dump';
      if (act === 'tour') startTour();
    });
  },
};

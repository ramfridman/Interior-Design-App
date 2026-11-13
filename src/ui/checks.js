/**
 * Checks tab: results of the regulations module (clearances, setbacks, safe-room rules…) plus the assumptions the
 * drawing leaves open. The module is written by another specialist and loaded on demand; when it is missing the tab
 * says so instead of failing.
 */
import { h, setKids, debounce } from './dom.js';
import { icon } from './icons.js';
import { section, emptyState } from './components.js';

const ORDER = ['fail', 'warn', 'info', 'pass'];
const LABEL = { fail: 'Problems', warn: 'Warnings', info: 'Notes', pass: 'Passed' };

/** @param {HTMLElement} root  @param {object} app  @param {(counts: object) => void} onCounts */
export function initChecks(root, app, onCounts) {
  const { store, plan, catalog, actions } = app;
  let active = false, stale = true, running = false;
  let results = null;        // null = not run, [] = ok
  let unavailable = false;
  let filter = 'all';
  let runner;                // undefined = not tried

  const summary = h('div', { class: 'chips chips--wrap', role: 'group', 'aria-label': 'Filter checks' });
  const list = h('div', { class: 'checks' });
  const assumptions = section('Assumptions to confirm',
    h('p', { class: 'sec__note' }, 'The drawing does not state these. Confirm them with the architect before ordering.'),
    h('ul', { class: 'assume' }, (plan.assumptions || []).map((a) => h('li', { class: 'assume__row' },
      h('span', { class: `tag tag--${a.status === 'confirmed' ? 'pass' : 'warn'}` }, a.status === 'confirmed' ? 'Confirmed' : 'Assumed'),
      h('span', { class: 'assume__text' }, a.text)))));
  root.append(summary, list, assumptions);

  async function loadRunner() {
    if (runner !== undefined) return runner;
    try {
      const mod = await import('../regulations/index.js');
      runner = typeof mod.runChecks === 'function' ? mod.runChecks : null;
    } catch (err) { runner = null; }
    return runner;
  }

  async function run() {
    if (running) { stale = true; return; }
    running = true;
    stale = false;
    try {
      const fn = await loadRunner();
      if (!fn) { unavailable = true; results = []; }
      else {
        const out = await fn({ store, plan, catalog });
        results = Array.isArray(out) ? out.filter((r) => r && r.title) : [];
      }
    } catch (err) {
      console.error('[ui] runChecks failed', err);
      results = [];
      unavailable = true;
    }
    running = false;
    const counts = { fail: 0, warn: 0, info: 0, pass: 0 };
    for (const r of results) if (counts[r.severity] != null) counts[r.severity]++;
    onCounts && onCounts(counts);
    if (active) render(counts);
    if (stale) run();
  }

  function focus(check) {
    if (check.itemIds && check.itemIds.length) actions.focusItems(check.itemIds);
    else if (check.spaceId) actions.focusSpace(check.spaceId);
  }

  function render(counts) {
    if (unavailable) {
      setKids(summary);
      setKids(list, emptyState({ icon: 'checks', title: 'Checks are not available yet', text: 'Clearance, setback and safe-room checks appear here once the regulations module is installed.' }));
      return;
    }
    if (!counts) { counts = { fail: 0, warn: 0, info: 0, pass: 0 }; for (const r of results || []) if (counts[r.severity] != null) counts[r.severity]++; }
    const chip = (id, label, n) => h('button', { type: 'button', class: `chip chip--${id}`, 'aria-pressed': String(filter === id), onClick: () => { filter = id; render(counts); } },
      label, h('span', { class: 'chip__n num' }, n));
    setKids(summary, chip('all', 'All', (results || []).length), ORDER.filter((s) => counts[s]).map((s) => chip(s, LABEL[s], counts[s])));
    const shown = (results || []).filter((r) => filter === 'all' || r.severity === filter)
      .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
    if (!shown.length) {
      setKids(list, emptyState({ icon: 'pass', title: results && results.length ? 'Nothing in this filter' : 'No checks to show', text: results && results.length ? 'Choose “All” to see every result.' : 'Checks run automatically as you change the design.' }));
      return;
    }
    const groups = new Map();
    for (const r of shown) { const k = r.category || 'General'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    setKids(list, [...groups.entries()].map(([name, rows]) => section(name, h('ul', { class: 'checklist' }, rows.map((r) => {
      const clickable = (r.itemIds && r.itemIds.length) || r.spaceId;
      const body = [h('span', { class: `check-ico check-ico--${r.severity}` }, icon(ORDER.includes(r.severity) ? r.severity : 'info', { size: 16 })),
        h('span', { class: 'checkrow__text' }, h('span', { class: 'checkrow__title' }, r.title),
          r.detail && h('span', { class: 'checkrow__detail' }, r.detail), r.reference && h('span', { class: 'checkrow__ref' }, r.reference))];
      return h('li', null, clickable
        ? h('button', { type: 'button', class: 'checkrow is-link', onClick: () => focus(r), 'data-tip': 'Show in the design', 'data-tip-side': 'left' }, body)
        : h('div', { class: 'checkrow' }, body));
    })))));
  }

  // Re-run in the background too, so the tab badge stays right while another tab is open.
  const schedule = debounce(run, 600);
  store.on('items', (e) => { if (!e.transient) schedule(); });
  store.on('finishes', schedule);
  store.on('project', schedule);
  store.on('load', schedule);

  // First run in the background so the tab badge is right before the tab is opened.
  setTimeout(run, 900);

  return {
    activate() { active = true; if (results == null) run(); else render(); },
    deactivate() { active = false; },
  };
}

/**
 * Checks tab: results of the regulations module (clearances, setbacks, safe-room rules…), what the owner changed in
 * the architect's plan, the assumptions the drawing leaves open and the module's disclaimer. The module is written
 * by another specialist and loaded on demand; when it is missing the tab says so instead of failing.
 */
import { h, setKids, debounce } from './dom.js';
import { icon } from './icons.js';
import { btn, section, emptyState, extLink } from './components.js';
import { changesSection } from './structure-panels.js';
import { FEATURES } from '../core/features.js';
import { levelIds, levelName, upperLevels } from '../core/levels.js';
import { levelPlan } from '../core/plan-edit.js';

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
  let rules = null;          // RULES of the regulations module (for the source links)

  const summary = h('div', { class: 'chips chips--wrap', role: 'group', 'aria-label': 'Filter checks' });
  const list = h('div', { class: 'checks' });
  const assumptions = section('Assumptions to confirm',
    h('p', { class: 'sec__note' }, 'The drawing does not state these. Confirm them with the architect before ordering.'),
    h('ul', { class: 'assume' }, (plan.assumptions || []).map((a) => h('li', { class: 'assume__row' },
      h('span', { class: `tag tag--${a.status === 'confirmed' ? 'pass' : 'warn'}` }, a.status === 'confirmed' ? 'Confirmed' : 'Assumed'),
      h('span', { class: 'assume__text' }, a.text)))));
  const changes = changesSection(app, { quietWhenEmpty: true });
  const disclaimer = h('p', { class: 'checks__disclaimer', hidden: true });
  root.append(summary, changes, list, assumptions, disclaimer);

  async function loadRunner() {
    if (runner !== undefined) return runner;
    let mod = null;
    try { mod = await import('../regulations/index.js'); } catch (err) { mod = null; }
    if (mod && Array.isArray(mod.RULES)) rules = mod.RULES;
    if (mod && typeof mod.DISCLAIMER === 'string' && mod.DISCLAIMER) { disclaimer.textContent = mod.DISCLAIMER; disclaimer.hidden = false; }
    if (typeof app.runChecks === 'function') runner = app.runChecks;   // injected (tests, dev harness)
    else runner = mod && typeof mod.runChecks === 'function' ? mod.runChecks : null;
    return runner;
  }
  /** The published source of a finding's rule, when the rule has one. */
  const sourceUrl = (finding) => { const rule = rules && finding.ruleId ? rules.find((r) => r.id === finding.ruleId) : null; return rule && rule.reference ? rule.reference.url : null; };

  async function run() {
    if (runner === null) { if (active) render(); return; }   // module missing: tried once, wait for the user
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

  // several floors (stage F7): findings carry `level` (and `scope` for site / whole-house rules)
  const multi = () => FEATURES.levels && upperLevels(plan).length > 0 && (results || []).some((r) => r.level);
  const viewOf = (id) => (!id || id === 'L0' ? plan : levelPlan(plan, id) || plan);
  function focus(check) {
    // go to the finding's floor first (a whole-house finding: the floor of the room it names)
    if (check.level && FEATURES.levels && app.levels && levelIds(plan).includes(check.level)) app.levels.set(check.level);
    const v = viewOf(check.level);
    if (check.itemIds && check.itemIds.length) actions.focusItems(check.itemIds);
    else if (check.spaceId && v.rooms.concat(v.outdoorAreas || []).some((s) => s.id === check.spaceId)) actions.focusSpace(check.spaceId);
    else if (check.at) app.structure.focusPoint(check.at);
  }
  /** Category sections of a list of findings. */
  const categorySections = (rows) => {
    const groups = new Map();
    for (const r of rows) { const k = r.category || 'General'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    return [...groups.entries()].map(([name, list]) => section(name, h('ul', { class: 'checklist' }, list.map(rowOf))));
  };

  function render(counts) {
    changes.refresh();
    if (unavailable) {
      setKids(summary);
      setKids(list, emptyState({ icon: 'checks', title: 'Checks are being prepared', text: 'Clearance, setback and safe-room checks will appear here. The assumptions below already apply.',
        action: btn('Check again', { small: true, onClick: () => { runner = undefined; unavailable = false; results = null; run(); } }) }));
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
    if (!multi()) { setKids(list, categorySections(shown)); return; }
    // grouped by floor: the whole house and the site first, then each floor (the one shown first among them)
    const cur = store.ui.level || 'L0';
    const floors = [cur, ...levelIds(plan).filter((id) => id !== cur)];
    const blocks = [{ key: 'house', title: 'Whole house and site', rows: shown.filter((r) => r.scope === 'site' || r.scope === 'house') },
      ...floors.map((id) => ({ key: id, title: levelName(plan, id) || id, rows: shown.filter((r) => !(r.scope === 'site' || r.scope === 'house') && (r.level || 'L0') === id), current: id === cur }))];
    setKids(list, blocks.filter((b) => b.rows.length).map((b) => {
      const bad = b.rows.filter((r) => r.severity === 'fail' || r.severity === 'warn').length;
      return h('div', { class: `floorgroup${b.current ? ' floorgroup--current' : ''}`, dataset: { floor: b.key } },
        h('h3', { class: 'floorgroup__head' }, icon(b.key === 'house' ? 'home' : 'levels', { size: 14 }), h('span', null, b.title + (b.current ? ' (shown)' : '')),
          h('span', { class: 'num' }, `${b.rows.length} ${b.rows.length === 1 ? 'check' : 'checks'}${bad ? ` · ${bad} to look at` : ''}`)),
        categorySections(b.rows));
    }));
  }
  function rowOf(r) {
    {
      const clickable = (r.itemIds && r.itemIds.length) || r.spaceId || r.at;
      // The source is a real link, so it sits beside the row button rather than inside it.
      const link = r.reference ? extLink(r.reference, sourceUrl(r), 'checkrow__ref checkrow__ref--link') : null;
      const body = [h('span', { class: `check-ico check-ico--${r.severity}` }, icon(ORDER.includes(r.severity) ? r.severity : 'info', { size: 16 })),
        h('span', { class: 'checkrow__text' }, h('span', { class: 'checkrow__title' }, r.title),
          r.detail && h('span', { class: 'checkrow__detail' }, r.detail), r.reference && !link && h('span', { class: 'checkrow__ref' }, r.reference))];
      return h('li', { class: 'checkitem' }, clickable
        ? h('button', { type: 'button', class: 'checkrow is-link', onClick: () => focus(r), 'data-tip': 'Show in the design', 'data-tip-side': 'left' }, body)
        : h('div', { class: 'checkrow' }, body), link);
    }
  }

  // Re-run in the background too, so the tab badge stays right while another tab is open.
  const schedule = debounce(run, 600);
  store.on('items', (e) => { if (!e.transient) schedule(); });
  store.on('finishes', schedule);
  store.on('project', schedule);
  store.on('load', schedule);
  store.on('plan', (e) => {
    if (e && e.transient) return;
    if (active) changes.refresh();
    schedule();
  });
  store.on('ui', (e) => { if (active && e.keys.includes('tool')) changes.refresh(); if (active && e.keys.includes('level') && multi()) render(); });

  // First run in the background so the tab badge is right before the tab is opened.
  setTimeout(run, 900);

  return {
    activate() { active = true; if (results == null) run(); else render(); },
    deactivate() { active = false; },
  };
}

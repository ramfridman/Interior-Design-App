/**
 * Carpentry · Quotation package: settings + live page preview + PDF download (English / Hebrew).
 * Mount contract: default export create(ctx) → { el, update({ runId, unitId }), destroy() }.
 */
import { h, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { btn, iconBtn, segmented, toggle, emptyState } from '../components.js';

const CONTACT_KEY = 'house98.carpentry.quotationContact.v1';
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3];
const today = () => new Date().toISOString().slice(0, 10);

function csv(rows) {
  const cell = (v) => {
    if (v == null) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
const txt = (v) => (v == null || v === '' ? '' : typeof v === 'object' ? (v.en != null ? String(v.en) : '') : String(v));

function loadContact() { try { const o = JSON.parse(localStorage.getItem(CONTACT_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
function saveContact(o) { try { localStorage.setItem(CONTACT_KEY, JSON.stringify(o)); } catch (e) { /* private mode: the fields simply are not remembered */ } }

function create(ctx) {
  const { store, plan, Carp, ui } = ctx;
  let sel = { runId: null, unitId: null };
  let destroyed = false, pricebook = null, docApi = null, docError = null;
  const saved = loadContact();
  const S = {
    lang: 'en', paper: 'A4',
    inc: { cutLists: true, questions: true, carpenterForm: true, estimate: false },
    runs: new Set(), runsTouched: false,
    project: { title: (plan && plan.meta && plan.meta.name) || 'House 98', address: (plan && plan.meta && plan.meta.location) || '', reference: '', date: today() },
    edited: { title: false, address: false },
    contact: { ownerName: saved.ownerName || '', phone: saved.phone || '', email: saved.email || '' },
  };
  const root = h('div', { class: 'cp cq', 'aria-label': 'Quotation package' });

  // ───────────── run list ─────────────
  const runsBox = h('div', { class: 'cq-runs', role: 'group', 'aria-label': 'Runs to include' });
  let runInfo = [], runSig = '';
  function scanRuns() {
    const runs = Carp.listRuns();
    const info = runs.map((r) => {
      let f = []; try { f = Carp.checkRun(r.id); } catch (e) { /* treated as no findings */ }
      const errs = f.filter((x) => x.severity === 'error'), warns = f.filter((x) => x.severity === 'warning').length;
      return { id: r.id, code: r.code, name: r.name, errors: errs.length, warnings: warns, reason: errs[0] ? txt(errs[0].text) : '' };
    });
    const sig = JSON.stringify(info.map((i) => [i.id, i.errors, i.warnings, i.name]));
    const changed = sig !== runSig; runSig = sig; runInfo = info;
    // new runs without errors join the selection until the person has chosen by hand
    for (const i of info) if (!S.runsTouched && !i.errors) S.runs.add(i.id);
    for (const id of [...S.runs]) { const i = info.find((x) => x.id === id); if (!i || i.errors) S.runs.delete(id); }
    return changed;
  }
  function renderRuns() {
    const ok = runInfo.filter((i) => !i.errors);
    const setAll = (ids) => { S.runsTouched = true; S.runs = new Set(ids); renderRuns(); changed(); };
    const rows = runInfo.map((i) => {
      const cb = h('input', { type: 'checkbox', class: 'check__input', checked: S.runs.has(i.id), disabled: i.errors > 0, 'aria-describedby': i.errors ? `cq-why-${i.id}` : null,
        onChange: () => { S.runsTouched = true; if (cb.checked) S.runs.add(i.id); else S.runs.delete(i.id); renderRunsCount(); changed(); } });
      return h('li', { class: `cq-run${i.errors ? ' has-error' : ''}` },
        h('label', { class: 'check' }, cb, h('span', { class: 'check__label' }, h('b', null, i.code), ' ', i.name)),
        i.errors ? h('span', { class: 'cp-chip cp-chip--err' }, `${i.errors} error${i.errors === 1 ? '' : 's'}`)
          : i.warnings ? h('span', { class: 'cp-chip cp-chip--warn' }, `${i.warnings} warning${i.warnings === 1 ? '' : 's'}`) : h('span', { class: 'cp-chip cp-chip--ok' }, 'Ready'),
        i.errors ? h('p', { class: 'cq-run__why', id: `cq-why-${i.id}` }, 'Left out until fixed: ', i.reason || 'fix the errors in this run first.') : null);
    });
    runsBox.replaceChildren(
      h('div', { class: 'cq-runs__tools' },
        btn('All ready', { small: true, variant: 'quiet', onClick: () => setAll(ok.map((i) => i.id)) }),
        sel.runId && ok.some((i) => i.id === sel.runId) ? btn('Only selected run', { small: true, variant: 'quiet', onClick: () => setAll([sel.runId]) }) : null,
        btn('None', { small: true, variant: 'quiet', onClick: () => setAll([]) })),
      runInfo.length ? h('ul', { class: 'cq-runs__list' }, rows) : h('p', { class: 'faint' }, 'There are no carpentry runs yet.'),
      h('p', { class: 'cq-runs__count faint', id: 'cq-runcount' }));
    renderRunsCount();
  }
  function renderRunsCount() { const el = runsBox.querySelector('#cq-runcount'); if (el) el.textContent = `${S.runs.size} of ${runInfo.length} runs in the package${runInfo.some((i) => i.errors) ? '; runs with errors are never included' : ''}.`; }

  // ───────────── settings ─────────────
  const field = (label, key, group, o = {}) => {
    const input = h('input', { class: 'cq-in', type: o.type || 'text', value: group[key] || '', placeholder: o.placeholder || '', autocomplete: o.autocomplete || 'off', 'aria-label': label,
      onInput: () => { group[key] = input.value; if (o.onEdit) o.onEdit(); if (o.contact) saveContact(S.contact); changed(); } });
    return h('label', { class: 'cq-field' }, h('span', { class: 'cq-field__label' }, label), input);
  };
  const langSeg = segmented({ label: 'Language', cls: 'seg--block', value: 'en', options: [{ value: 'en', label: 'English' }, { value: 'he', label: 'עברית' }], onChange: (v) => { S.lang = v; changed(); } });
  const paperSeg = segmented({ label: 'Drawing sheet size', cls: 'seg--block', value: 'A4', options: [{ value: 'A4', label: 'A4' }, { value: 'A3', label: 'A3' }], onChange: (v) => { S.paper = v; changed(); } });
  const tog = (label, key, hint) => toggle({ label, hint, checked: S.inc[key], onChange: (v) => { S.inc[key] = v; changed(); } });
  const dateInput = h('input', { class: 'cq-in', type: 'date', value: S.project.date, 'aria-label': 'Date', onInput: () => { S.project.date = dateInput.value || today(); changed(); } });
  const settings = h('div', { class: 'cq-settings' },
    h('section', { class: 'cq-sec' }, h('h3', { class: 'cp-h' }, 'Runs'), runsBox),
    h('section', { class: 'cq-sec' }, h('h3', { class: 'cp-h' }, 'Document'),
      h('div', { class: 'cq-pair' }, h('span', { class: 'cq-field__label' }, 'Language'), langSeg),
      h('div', { class: 'cq-pair' }, h('span', { class: 'cq-field__label' }, 'Drawing sheets'), paperSeg),
      tog('Cutting lists', 'cutLists'), tog('Questions for the carpenter', 'questions'), tog('Quotation form', 'carpenterForm', 'Where each bidder prices every run')),
    h('section', { class: 'cq-sec cq-owner' }, h('h3', { class: 'cp-h' }, 'Owner’s copy'),
      tog('Owner’s copy with my cost estimate', 'estimate', 'Keep this off for the copy you send out: bidders normally should not see your budget.')),
    h('section', { class: 'cq-sec' }, h('h3', { class: 'cp-h' }, 'Project'),
      field('Title', 'title', S.project, { onEdit: () => { S.edited.title = true; } }),
      field('Location', 'address', S.project, { onEdit: () => { S.edited.address = true; } }),
      field('Reference', 'reference', S.project, { placeholder: 'Automatic, e.g. H98-CARP-RFQ-date' }),
      h('label', { class: 'cq-field' }, h('span', { class: 'cq-field__label' }, 'Date'), dateInput)),
    h('section', { class: 'cq-sec' }, h('h3', { class: 'cp-h' }, 'Contact for bidders (optional)'),
      field('Name', 'ownerName', S.contact, { contact: true, autocomplete: 'name' }),
      field('Phone', 'phone', S.contact, { contact: true, type: 'tel', autocomplete: 'tel' }),
      field('Email', 'email', S.contact, { contact: true, type: 'email', autocomplete: 'email' }),
      h('p', { class: 'faint cq-note' }, 'Remembered in this browser only — never stored in your design file.')));

  // ───────────── preview ─────────────
  const statusEl = h('span', { class: 'cq-status', role: 'status', 'aria-live': 'polite' });
  const pageNo = h('span', { class: 'cq-pageno num', 'aria-live': 'off' }, '— / —');
  const zoomLabel = h('span', { class: 'cq-zoomlabel num' }, '100 %');
  const pagesEl = h('div', { class: 'cq-pages' });
  const viewer = h('div', { class: 'cq-viewer', tabindex: '0', role: 'region', 'aria-label': 'Page preview' }, pagesEl);
  const thumbsEl = h('ol', { class: 'cq-thumbs', 'aria-label': 'Pages' });
  const msgEl = h('div', { class: 'cq-msg', hidden: true });
  const stage = h('div', { class: 'cq-stage' }, thumbsEl, viewer, msgEl);
  let zoomIdx = 2, current = 0, pageSvgs = [], pageSizes = [], io = null, tio = null;
  const prevBtn = iconBtn('chevron-up', 'Previous page', { onClick: () => goto(current - 1) });
  const nextBtn = iconBtn('chevron-down', 'Next page', { onClick: () => goto(current + 1) });
  const zOut = iconBtn('minus', 'Zoom out', { onClick: () => zoom(-1) });
  const zIn = iconBtn('plus', 'Zoom in', { onClick: () => zoom(1) });
  const toolbar = h('div', { class: 'cq-bar' }, h('div', { class: 'cq-bar__grp' }, prevBtn, pageNo, nextBtn), statusEl, h('div', { class: 'cq-bar__grp' }, zOut, zoomLabel, zIn));
  const preview = h('div', { class: 'cq-preview' }, toolbar, stage);

  function zoom(d) { zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, zoomIdx + d)); pagesEl.style.setProperty('--z', ZOOMS[zoomIdx]); zoomLabel.textContent = `${Math.round(ZOOMS[zoomIdx] * 100)} %`; zOut.disabled = zoomIdx === 0; zIn.disabled = zoomIdx === ZOOMS.length - 1; }
  function goto(i) {
    if (!pageSvgs.length) return;
    i = Math.max(0, Math.min(pageSvgs.length - 1, i));
    const el = pagesEl.children[i]; if (!el) return;
    viewer.scrollTo({ top: el.offsetTop - 8, behavior: 'auto' }); setCurrent(i);
  }
  function setCurrent(i) {
    current = i;
    pageNo.textContent = pageSvgs.length ? `${i + 1} / ${pageSvgs.length}` : '— / —';
    prevBtn.disabled = i <= 0; nextBtn.disabled = i >= pageSvgs.length - 1;
    thumbsEl.querySelectorAll('button').forEach((b, k) => { if (k === i) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const t = thumbsEl.children[i]; if (t && thumbsEl.scrollHeight > thumbsEl.clientHeight + 2 && stage.offsetWidth > 560) { const top = t.offsetTop - thumbsEl.clientHeight / 2 + t.offsetHeight / 2; thumbsEl.scrollTop = top; }
  }
  const onScroll = () => {
    const y = viewer.scrollTop + viewer.clientHeight * 0.3;
    let idx = 0;
    for (let i = 0; i < pagesEl.children.length; i++) { if (pagesEl.children[i].offsetTop <= y) idx = i; else break; }
    if (idx !== current) setCurrent(idx);
  };
  viewer.addEventListener('scroll', () => requestAnimationFrame(onScroll), { passive: true });

  function mountPages(svgs, sizes) {
    io && io.disconnect(); tio && tio.disconnect();
    pageSvgs = svgs; pageSizes = sizes;
    const keep = viewer.scrollTop;
    io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting && !e.target.dataset.done) { e.target.dataset.done = '1'; e.target.innerHTML = pageSvgs[+e.target.dataset.i]; io.unobserve(e.target); } }, { root: viewer, rootMargin: '900px 0px' });
    tio = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting && !e.target.dataset.done) { e.target.dataset.done = '1'; e.target.innerHTML = pageSvgs[+e.target.dataset.i]; tio.unobserve(e.target); } }, { root: thumbsEl, rootMargin: '400px' });
    const pgs = svgs.map((_, i) => { const d = h('div', { class: 'cq-page', dataset: { i }, style: { aspectRatio: `${sizes[i][0]} / ${sizes[i][1]}` }, role: 'img', 'aria-label': `Page ${i + 1} of ${svgs.length}` }); return d; });
    pagesEl.replaceChildren(...pgs);
    thumbsEl.replaceChildren(...svgs.map((_, i) => h('li', null, h('button', { type: 'button', class: 'cq-thumb', 'aria-label': `Go to page ${i + 1}`, onClick: () => goto(i) },
      h('span', { class: 'cq-thumb__pg', dataset: { i }, style: { aspectRatio: `${sizes[i][0]} / ${sizes[i][1]}` } }), h('span', { class: 'cq-thumb__n num' }, i + 1)))));
    pgs.forEach((p) => io.observe(p));
    thumbsEl.querySelectorAll('.cq-thumb__pg').forEach((p) => tio.observe(p));
    viewer.scrollTop = keep;
    setCurrent(Math.min(current, Math.max(0, svgs.length - 1)));
    onScroll();
  }

  // ───────────── options ─────────────
  function options(lang = S.lang, runIds) {
    const ids = runIds || [...S.runs];
    const p = S.project, c = S.contact;
    return {
      lang, runIds: ids, paper: S.paper,
      include: { estimate: S.inc.estimate, cutLists: S.inc.cutLists, carpenterForm: S.inc.carpenterForm, questions: S.inc.questions },
      project: {
        title: S.edited.title && p.title.trim() ? p.title.trim() : undefined, address: S.edited.address && p.address.trim() ? p.address.trim() : undefined,
        reference: p.reference.trim() || undefined, date: p.date || today(),
        ownerName: c.ownerName.trim() || undefined, phone: c.phone.trim() || undefined, email: c.email.trim() || undefined,
      },
      src: { store, plan }, pricebook: S.inc.estimate ? pricebook : undefined, tier: store.ui.carpentryTier || undefined,
    };
  }

  let seq = 0, dirty = false;
  function showMsg(node) { if (node) { msgEl.replaceChildren(node); msgEl.hidden = false; } else msgEl.hidden = true; }
  function compose() {
    if (destroyed || !docApi) return;
    const my = ++seq;
    if (!S.runs.size) {
      mountPages([], []); statusEl.textContent = '';
      showMsg(emptyState({ icon: 'warn', title: 'No runs selected', text: runInfo.some((i) => i.errors) ? 'Runs with errors are left out. Fix them in the workbench, or tick another run.' : 'Tick at least one run to preview the package.' }));
      updateButtons(); return;
    }
    stage.classList.add('is-updating'); statusEl.textContent = 'Updating…';
    setTimeout(() => {   // let the "Updating…" state paint before the synchronous compose
      if (destroyed || my !== seq) return;
      try {
        const { doc, svgPages } = docApi.buildQuotationPreview(options());
        if (my !== seq) return;
        showMsg(null);
        mountPages(svgPages, doc.pages.map((p) => p.size));
        statusEl.textContent = `${svgPages.length} pages · ${S.paper} sheets · ${S.lang === 'he' ? 'Hebrew' : 'English'}`;
      } catch (err) {
        console.error('[quotation] compose failed', err);
        showMsg(emptyState({ icon: 'warn', title: 'The preview could not be built', text: String(err && err.message || err) }));
        statusEl.textContent = '';
      }
      stage.classList.remove('is-updating'); updateButtons();
    }, 30);
  }
  const composeSoon = debounce(compose, 450);
  function changed() {
    if (!docApi) return;
    dirty = true; statusEl.textContent = 'Updating…'; stage.classList.add('is-updating'); hint.hidden = true;
    root.dataset.lang = S.lang;
    composeSoon();
  }

  // ───────────── downloads ─────────────
  const hint = h('div', { class: 'cq-hint', hidden: true, role: 'status' });
  const errBox = h('div', { class: 'cq-err', hidden: true, role: 'alert' });
  const mkBtn = (label, iconName, variant, fn) => { const b = btn(label, { icon: iconName, variant, onClick: () => fn(b) }); return b; };
  const dl = mkBtn('Download PDF', 'download', 'primary', (b) => downloadPDF([S.lang], b));
  const dlBoth = mkBtn('Download both languages', 'download', 'default', (b) => downloadPDF(['en', 'he'], b));
  const schBtn = mkBtn('Schedules CSV', 'table', 'quiet', () => scheduleCsv());
  function updateButtons() { const none = !S.runs.size || !docApi; for (const b of [dl, dlBoth, schBtn]) b.disabled = none || busy; }
  let busy = false;
  function setBusy(b, label, on) { busy = on; const l = b.querySelector('.btn__label'); if (on) { b.dataset.label = l.textContent; l.textContent = label; b.setAttribute('aria-busy', 'true'); } else { l.textContent = b.dataset.label || l.textContent; b.removeAttribute('aria-busy'); } updateButtons(); }

  async function downloadPDF(langs, b) {
    if (busy || !S.runs.size) return;
    errBox.hidden = true; hint.hidden = true;
    setBusy(b, 'Building PDF…', true);
    try {
      const done = [];
      for (const lang of langs) {
        const { bytes, filename, pages } = await docApi.buildQuotationPDF(options(lang));
        const r = await ui.saveFile({ name: filename, mime: 'application/pdf', data: bytes });
        if (r && r.declined) { ui.toast('Download cancelled', { kind: 'info' }); return; }
        if (!r || !r.ok) throw new Error('The browser did not accept the file.');
        done.push(`${filename} (${pages} pages)`);
      }
      showNext(done);
    } catch (err) {
      console.error('[quotation] pdf failed', err);
      errBox.replaceChildren(icon('warn', { size: 16 }), h('span', null, `The PDF could not be created: ${(err && err.message) || err}. Check your connection (the fonts load on first use) and try again.`));
      errBox.hidden = false;
    } finally { setBusy(b, '', false); }
  }
  function showNext(done) {
    hint.replaceChildren(icon('check', { size: 16 }), h('div', { class: 'cq-hint__txt' }, h('b', null, done.length > 1 ? 'Both PDFs downloaded.' : 'PDF downloaded.'),
      ' Next: send it to two or three carpenters and ask for a quote on the same specification. ', btn('Find a carpenter', { small: true, variant: 'quiet', iconRight: 'chevron-right', onClick: openCarpenters })));
    hint.hidden = false;
  }
  async function openCarpenters() {
    try {
      const m = await import('./carpenters.js');
      const inst = (m.default || m.create)(ctx);
      const dlg = ui.openDialog({ title: 'Find a carpenter', size: 'lg', body: inst.el, onClose: () => inst.destroy() });
      return dlg;
    } catch (e) { ui.toast('Could not open the carpenter list', { kind: 'error' }); }
  }
  async function scheduleCsv() {
    const ids = [...S.runs];
    const parts = ids.map((id) => Carp.schedules(id));
    if (!parts.length) return;
    const rows = [];
    for (const [key, name] of [['units', 'Unit schedule'], ['materials', 'Materials & finishes'], ['hardware', 'Hardware'], ['worktops', 'Worktops'], ['appliances', 'Appliances'], ['questions', 'Questions for the carpenter']]) {
      const cols = parts[0].headers[key] || (key === 'questions' ? [['run', { en: 'Run' }], ['topic', { en: 'Topic' }], ['text', { en: 'Question' }]] : []);
      const data = parts.flatMap((p) => p[key] || []);
      if (!data.length) continue;
      rows.push([name], cols.map(([, t]) => txt(t)));
      for (const r of data) rows.push(cols.map(([k]) => (k === 'size' ? (r.sizeText || '') : txt(r[k]))));
      rows.push([]);
    }
    const r = await ui.saveFile({ name: `House98-Carpentry-Schedules-${today()}.csv`, mime: 'text/csv', data: csv(rows) });
    if (r && r.ok && !r.dialog) ui.toast('Schedules saved as CSV', { kind: 'success' });
  }

  // ───────────── assemble ─────────────
  const actions = h('div', { class: 'cq-actions' }, dl, dlBoth, schBtn);
  const left = h('div', { class: 'cq-left' }, settings, h('div', { class: 'cq-dock' }, errBox, hint, actions));
  root.append(left, preview);
  root.dataset.lang = 'en';
  zoom(0);
  scanRuns(); renderRuns();
  updateButtons();

  Promise.all([import('../../carpentry/doc/index.js'), import('../../carpentry/pricebook.js').catch(() => null)]).then(([d, pb]) => {
    if (destroyed) return;
    docApi = d; pricebook = pb && pb.default; updateButtons(); compose();
  }).catch((e) => {
    console.error('[quotation] module load failed', e); docError = e;
    showMsg(emptyState({ icon: 'warn', title: 'The quotation builder could not be loaded', text: 'Reload the page and try again.' }));
  });

  const refresh = debounce(() => {
    if (destroyed) return;
    if (scanRuns()) renderRuns();
    changed();
  }, 900);
  const offs = ['carpentry', 'items', 'plan'].map((e) => store.on(e, refresh));
  const onKey = (e) => { if (e.target === viewer && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey) { e.preventDefault(); goto(current + (e.key === 'ArrowDown' ? 1 : -1)); } };
  viewer.addEventListener('keydown', onKey);

  return {
    el: root,
    update(s) {
      const n = { runId: (s && s.runId) || null, unitId: (s && s.unitId) || null };
      if (n.runId !== sel.runId) { sel = n; renderRuns(); } else sel = n;
    },
    destroy() { destroyed = true; refresh.cancel(); composeSoon.cancel(); io && io.disconnect(); tio && tio.disconnect(); offs.forEach((f) => f && f()); root.remove(); },
  };
}

export { create };
export default create;

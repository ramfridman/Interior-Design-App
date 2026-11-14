/**
 * Version history (project menu → "History…") for an online project. CONTRACT § 13 "Restore points".
 * Lists automatic and named restore points (time, author), "Save a version now" with a name, a summary of what
 * restoring a point would change (GET /api/projects/:id/versions/:vid), and "Restore" with an in-app confirmation.
 * Before restoring, a named point "Before restoring …" is saved, so the restore can be undone by anyone in the project
 * by restoring that point. Viewers can look but not save or restore.
 */
import { h, setKids } from '../dom.js';
import { btn } from '../components.js';
import { openDialog, confirmDialog, toast } from '../dialogs.js';

const TYPE_WORDS = { item: ['item', 'items'], run: ['carpentry run', 'carpentry runs'], finish: ['finish', 'finishes'], plan: ['plan', 'plan'], project: ['project setting', 'project settings'], carp: ['carpentry setting', 'carpentry settings'], cimg: ['reference picture', 'reference pictures'], cprod: ['own product', 'own products'], underlay: ['sketch', 'sketch'] };
const n = (k, t) => `${k} ${TYPE_WORDS[t] ? TYPE_WORDS[t][k === 1 ? 0 : 1] : t}`;
export const whenText = (iso) => {
  try {
    const d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
    const same = new Date().toDateString() === d.toDateString();
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return same ? `today ${time}` : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
  } catch (e) { return ''; }
};
const personOf = (email) => { const l = String(email || '').split('@')[0].replace(/[._-]+/g, ' ').trim(); return l ? l.replace(/\b\w/g, (c) => c.toUpperCase()) : 'someone'; };
const displayName = (v) => (v.auto ? 'Automatic restore point' : v.name);

/** Plain-English description of a summary from the server. */
export function describeSummary(sm) {
  if (!sm) return 'The details of this point could not be read.';
  const has = `This point has ${n(sm.items, 'item')}${sm.runs ? ` and ${n(sm.runs, 'run')}` : ''}.`;
  if (!sm.changes || !sm.changes.total) return `${has} It is the same as the project now.`;
  const parts = [];
  for (const [t, c] of Object.entries(sm.changes.byType)) {
    if (c.added) parts.push(`bring back ${n(c.added, t)}`);
    if (c.removed) parts.push(`remove ${n(c.removed, t)}`);
    if (c.changed) parts.push(`change ${n(c.changed, t)}`);
  }
  return `${has} Restoring it would ${parts.slice(0, 5).join(', ')}${parts.length > 5 ? ' and more' : ''}.`;
}

export function openHistoryDialog(app, ctl) {
  const s = ctl.session();
  if (!s) { toast('History is kept for online projects. Put the project online from Share… first.', { kind: 'info' }); return null; }
  const { client, projectId } = s;
  const canEdit = client.role() !== 'viewer';
  let versions = null, picked = null;
  const list = h('ul', { class: 'hist__list', role: 'listbox', 'aria-label': 'Restore points' }, h('li', { class: 'share__loading' }, 'Loading…'));
  const detail = h('div', { class: 'hist__detail', 'aria-live': 'polite' }, h('p', { class: 'share__hint' }, 'Pick a restore point to see what it holds.'));
  const nameIn = h('input', { class: 'share__email-in', type: 'text', maxlength: '80', placeholder: 'Name, e.g. “Kitchen option B”', 'aria-label': 'Name of the new version', onKeydown: (e) => { if (e.key === 'Enter') saveNow(); } });
  const saveBtn = btn('Save a version now', { variant: 'primary', onClick: saveNow });
  const body = h('div', { class: 'hist' },
    canEdit ? h('div', { class: 'share__addrow hist__save' }, nameIn, saveBtn)
      : h('p', { class: 'cl-banner__inline' }, 'You can view this project’s history. Only people who can edit can save or restore versions.'),
    h('div', { class: 'hist__cols' }, list, detail),
    h('p', { class: 'share__hint' }, 'A restore point is saved automatically after a quiet spell and every 200 changes (the last 20 are kept). Restoring changes the project for everyone; it can be undone by restoring the point saved just before it.'));
  const dlg = openDialog({ title: 'Version history', size: 'lg', cls: 'dialog--history', body, onClose: () => offs.forEach((f) => f()),
    actions: [btn('Close', { variant: 'quiet', onClick: () => dlg.close() })] });
  const offs = [client.on('versions', (l) => { versions = l; paint(); })];
  client.requestVersions();
  return dlg;

  function paint() {
    if (!versions) return;
    const sorted = [...versions].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (!sorted.length) { setKids(list, h('li', { class: 'share__hint' }, 'No restore points yet. One is saved automatically once people start changing the project.')); return; }
    setKids(list, sorted.map((v) => h('li', null, h('button', {
      type: 'button', class: `hist__row${picked === v.id ? ' is-picked' : ''}`, role: 'option', 'aria-selected': String(picked === v.id), onClick: () => pick(v),
    }, h('span', { class: 'hist__name' }, displayName(v), v.auto ? null : h('span', { class: 'hist__tag' }, 'named')),
    h('span', { class: 'hist__sub' }, `${whenText(v.at)} · ${personOf(v.by)}`)))));
  }
  async function pick(v) {
    picked = v.id; paint();
    setKids(detail, h('p', { class: 'share__hint' }, 'Reading…'));
    const sm = await ctl.online.versionSummary(projectId, v.id).catch(() => null);
    if (picked !== v.id) return;
    const at = (() => { try { return new Date(v.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return v.at; } })();
    setKids(detail,
      h('h3', { class: 'share__h' }, displayName(v)),
      h('p', { class: 'share__sub' }, `${at} · saved by ${personOf(v.by)}${v.auto ? ' (automatic)' : ''}`),
      h('p', { class: 'dialog__text' }, describeSummary(sm)),
      canEdit ? btn('Restore this version…', { onClick: () => restore(v, sm) }) : null);
  }
  function saveNow() {
    const name = nameIn.value.trim() || `Saved ${new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
    client.createVersion(name);
    nameIn.value = '';
    toast(`Version “${name}” saved`, { kind: 'success' });
  }
  async function restore(v, sm) {
    const ok = await confirmDialog({ title: `Restore “${displayName(v)}”?`, confirmLabel: 'Restore', danger: false,
      body: [h('p', { class: 'dialog__text' }, `The project goes back to how it was ${whenText(v.at)}, for everyone working on it.`),
        sm && sm.changes && sm.changes.total ? h('p', { class: 'dialog__text' }, describeSummary(sm)) : null,
        h('p', { class: 'dialog__text' }, 'The current state is saved first as “Before restoring …”, so you or anyone else can go back to it from this list.')] });
    if (!ok) return;
    client.createVersion(`Before restoring “${displayName(v).slice(0, 50)}”`);
    client.restoreVersion(v.id);
    dlg.close();
  }
}

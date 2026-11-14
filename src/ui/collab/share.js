/**
 * Share dialog (project menu → "Share…", the "Share" button and the people list in the top bar). CONTRACT § 13.
 *  * A project on this device: explains what putting it online means, then puts it online (the signed-in person owns it).
 *  * An online project: the link to it (`?online=<id>`, copied with exporter.js `copyText`), the people who have access
 *    with their role (owner / can edit / can view; only the owner changes them), add by email, remove, and "keep a copy
 *    on this device". Nothing here uses alert / confirm / window.open.
 */
import { h, setKids } from '../dom.js';
import { btn, iconBtn } from '../components.js';
import { openDialog, confirmDialog, toast } from '../dialogs.js';
import { copyText } from '../exporter.js';
import { initialsOf } from '../../collab/room.js';

const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}$/;
export const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' };
const GATE_NOTE = 'Only people on this site’s invite list can sign in. Someone you add here must also be on that list (the site owner adds them in Cloudflare Access) — otherwise the link will not open for them.';

const colorOf = (email) => { const C = ['#e4572e', '#2e86ab', '#8e44ad', '#16a085', '#d35400', '#c0392b', '#2c3e50', '#27ae60', '#b8860b', '#e84393']; let x = 0; for (const c of String(email)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return C[x % C.length]; };
export const avatarEl = (email, name, color) => h('span', { class: 'cl-av', style: `background:${color || colorOf(email)}`, 'aria-hidden': 'true' }, initialsOf(name || email));

/** @param {object} app window.app  @param {object} ctl the collaboration controller (src/collab/online.js) */
export function openShareDialog(app, ctl) {
  const body = h('div', { class: 'share' });
  const foot = [];
  const dlg = openDialog({ title: 'Share', size: 'md', cls: 'dialog--share', body, actions: [h('div', { class: 'share__foot' }, foot)] });
  const footEl = dlg.el.querySelector('.share__foot');
  render();
  return dlg;

  function render() {
    const s = ctl.session();
    if (s) renderOnline(s); else renderLocal();
  }

  // ------------------------------------------------------------ not online yet
  function renderLocal() {
    const name = app.store.project.name;
    setKids(body,
      h('p', { class: 'dialog__text' }, `“${name}” is saved only on this device. To work on it together, put it online: it will be saved on this site’s server, and the people you add can open it and change it with you at the same time.`),
      h('ul', { class: 'share__points' },
        h('li', null, 'You become its owner: you decide who can edit and who can only look.'),
        h('li', null, 'The copy on this device stays as it is now; from then on, changes are saved online.'),
        h('li', null, GATE_NOTE)),
    );
    const go = btn('Put online', { variant: 'primary', attrs: { 'data-autofocus': '' }, onClick: async () => {
      go.disabled = true; go.querySelector('.btn__label').textContent = 'Putting online…';
      const r = await ctl.putOnline();
      if (!r.ok) { go.disabled = false; go.querySelector('.btn__label').textContent = 'Put online'; toast(r.reason, { kind: 'error' }); return; }
      toast('The project is online. Add the people who should have access.', { kind: 'success' });
      render();
    } });
    setKids(footEl, btn('Cancel', { variant: 'quiet', onClick: () => dlg.close() }), go);
  }

  // ------------------------------------------------------------ online
  async function renderOnline(s) {
    const id = s.projectId, me = ctl.user;
    const myRole = s.client.role();
    const isOwner = myRole === 'owner';
    const link = ctl.linkFor(id);
    const linkInput = h('input', { class: 'share__link', type: 'text', readonly: true, value: link, 'aria-label': 'Link to this project', spellcheck: 'false' });
    const copy = btn('Copy link', { icon: 'copy', onClick: async () => { const ok = await copyText(link, linkInput); toast(ok ? 'Link copied' : 'Press Ctrl+C to copy the selected link', { kind: ok ? 'success' : 'info' }); } });
    const list = h('ul', { class: 'share__people', 'aria-label': 'People with access' }, h('li', { class: 'share__loading' }, 'Loading…'));
    const status = h('p', { class: 'share__status', role: 'status', 'aria-live': 'polite' });
    setKids(body,
      h('div', { class: 'share__section' }, h('h3', { class: 'share__h' }, 'Link'),
        h('div', { class: 'share__linkrow' }, linkInput, copy),
        h('p', { class: 'share__hint' }, 'Only the people below can open it.')),
      h('div', { class: 'share__section' }, h('h3', { class: 'share__h' }, 'People with access'), list, status,
        isOwner ? addRow() : h('p', { class: 'share__hint' }, `You ${myRole === 'viewer' ? 'can view' : 'can edit'} this project. Only the owner can change who has access.`)),
      h('p', { class: 'share__hint share__gate' }, GATE_NOTE),
    );
    setKids(footEl,
      btn('Keep a copy on this device', { icon: 'duplicate', variant: 'quiet', onClick: keepCopy }),
      btn('Done', { variant: 'primary', onClick: () => dlg.close() }));

    let members = {}, owner = null;
    try { ({ members, owner } = await ctl.online.members(id)); } catch (e) { setKids(list, h('li', { class: 'share__err' }, e.message)); return; }
    const live = new Map([s.client.you(), ...s.client.peers()].filter(Boolean).map((p) => [p.email, p]));
    paint();

    function paint() {
      const rows = Object.entries(members).sort(([a, ra], [b, rb]) => (ra === 'owner' ? -1 : rb === 'owner' ? 1 : a.localeCompare(b)));
      setKids(list, rows.map(([email, role]) => {
        const p = live.get(email);
        const roleCtl = !isOwner || role === 'owner'
          ? h('span', { class: 'share__role' }, ROLE_LABEL[role] || role)
          : h('select', { class: 'select share__select', 'aria-label': `Role of ${email}`, onChange: (e) => save({ ...members, [email]: e.target.value }, `${email} ${e.target.value === 'editor' ? 'can edit' : 'can view'} now`) },
            ['editor', 'viewer'].map((r) => h('option', { value: r, selected: r === role }, ROLE_LABEL[r])));
        return h('li', { class: 'share__person' },
          avatarEl(email, p && p.name, p && p.color),
          h('span', { class: 'share__who' },
            h('span', { class: 'share__email' }, email + (email === me ? ' (you)' : '')),
            h('span', { class: 'share__sub' }, p ? 'In the project now' : role === 'owner' && email === owner ? 'Put it online' : '')),
          roleCtl,
          isOwner && role !== 'owner' ? iconBtn('close', `Remove ${email}`, { onClick: () => remove(email) }) : h('span', { class: 'share__nox' }));
      }));
    }
    async function save(next, message) {
      status.textContent = 'Saving…';
      try { const r = await ctl.online.setMembers(id, next); members = r.members; status.textContent = message || 'Saved'; }
      catch (e) { status.textContent = ''; toast(e.message, { kind: 'error' }); }
      paint();
    }
    async function remove(email) {
      const ok = await confirmDialog({ title: `Remove ${email}?`, confirmLabel: 'Remove', danger: true,
        message: `${email} will no longer be able to open this project. If they have it open now, it closes on their screen.` });
      if (!ok) return;
      const next = { ...members }; delete next[email];
      save(next, `${email} was removed`);
    }
    function addRow() {
      const input = h('input', { class: 'share__email-in', type: 'email', placeholder: 'name@example.com', 'aria-label': 'Email address to add', autocomplete: 'off', spellcheck: 'false', onKeydown: (e) => { if (e.key === 'Enter') add(); } });
      const role = h('select', { class: 'select share__select', 'aria-label': 'Role for the new person' }, h('option', { value: 'editor', selected: true }, ROLE_LABEL.editor), h('option', { value: 'viewer' }, ROLE_LABEL.viewer));
      const err = h('p', { class: 'form__error', role: 'alert', hidden: true });
      function add() {
        const e = input.value.trim().toLowerCase();
        if (!EMAIL.test(e)) { err.textContent = 'Type a full email address, like name@example.com.'; err.hidden = false; return; }
        if (members[e]) { err.textContent = `${e} already has access.`; err.hidden = false; return; }
        err.hidden = true; input.value = '';
        save({ ...members, [e]: role.value }, `${e} added — send them the link`);
      }
      return h('div', { class: 'share__add' }, h('div', { class: 'share__addrow' }, input, role, btn('Add', { variant: 'primary', onClick: add })), err);
    }
  }

  async function keepCopy() {
    const cur = app.projects.current();
    const r = cur ? await app.projects.duplicate(cur.id, { open: false }) : { ok: false, reason: 'Nothing to copy.' };
    if (r.ok) toast(`A copy “${r.project.name}” is saved on this device — find it in the project menu under “On this device”.`, { kind: 'success', duration: 7000 });
    else toast(r.reason, { kind: 'error' });
  }
}

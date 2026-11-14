/**
 * Collaboration panels (loaded by src/collab/online.js only when a backend answered): the Share dialog, version history,
 * the view-only banner for viewers (with the editing tools disabled — see src/styles/collab.css `.is-viewonly`), and the
 * notices everyone gets when a version is restored or their access changes. CONTRACT § 13.
 */
import { h } from '../dom.js';
import { toast } from '../dialogs.js';
import { openShareDialog } from './share.js';
import { openHistoryDialog } from './history.js';

export function initCollabPanels(app, ctl) {
  ctl.openShare = () => openShareDialog(app, ctl);
  ctl.openHistory = () => openHistoryDialog(app, ctl);

  const root = document.getElementById('app');
  const stage = document.getElementById('stage');
  const banner = h('div', { class: 'cl-banner', role: 'status', hidden: true },
    h('strong', null, 'View only'),
    h('span', { class: 'cl-banner__text' }, ' — you can look around, measure and export, but not change this project. Ask its owner for edit access.'),
    h('span', { class: 'cl-banner__short' }, ' — ask the owner for edit access'));
  if (stage) stage.prepend(banner);

  let offs = [];
  const setViewer = (on) => {
    if (root) root.classList.toggle('is-viewonly', on);
    banner.hidden = !on;
  };
  function start(session) {
    stop();
    const { client } = session;
    const sync = () => setViewer(client.role() === 'viewer');
    offs.push(client.on('role', (role) => { sync(); toast(role === 'viewer' ? 'You can view this project now, not change it.' : `You can ${role === 'owner' ? 'manage' : 'edit'} this project now.`, { kind: 'info' }); }));
    offs.push(client.on('welcome', sync));
    offs.push(client.on('remote', (m) => {
      if (m && typeof m.label === 'string' && /^Restored /.test(m.label) && m.cid !== client.cid) {
        toast(`${(m.by && m.by.name) || 'Someone'} ${m.label.replace(/^Restored/, 'restored')}. To go back, open History… and restore “Before restoring …”.`, { kind: 'info', duration: 9000, action: { label: 'History', fn: () => ctl.openHistory() } });
      }
    }));
    offs.push(client.on('restored', (m) => {
      toast(m.changes ? 'Version restored for everyone. “Before restoring …” in History takes it back.' : 'That version is the same as the project now — nothing changed.', { kind: 'success', duration: 7000, action: m.changes ? { label: 'History', fn: () => ctl.openHistory() } : undefined });
    }));
    offs.push(client.on('error', (m) => {
      if (m && m.code === 'removed') { setTimeout(() => { ctl.leaveToLocal(); }, 50); }
    }));
    sync();
  }
  function stop() { for (const f of offs) { try { f(); } catch (e) { /* gone */ } } offs = []; setViewer(false); }
  ctl.on((e) => { if (e.type === 'open') start(e.session); else if (e.type === 'left') stop(); });
  if (ctl.session()) start(ctl.session());
  // the guard on store edits: a viewer's local change is rolled back by the client with a toast; the UI avoids offering it
}

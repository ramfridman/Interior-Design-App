/**
 * LIVE COLLABORATION — entry point (CONTRACT § 13). Detects a backend and, only then, loads the collaboration UI.
 * Without a backend (artifact preview, a plain static host, file://) nothing happens: no request errors, no UI.
 *
 *   initCollaboration(app)        // main.js, after the UI is up
 *   app.projects.openOnline(id)   // open an online project through its room   → Promise<{ ok, reason? }>
 *   app.projects.putOnline()      // copy the open local project to the server and open it online → Promise<{ ok, id?, reason? }>
 *   app.collab                    // the controller: { user, session(), online (adapter-online.js), linkFor(id),
 *                                 //   removeOnline(id), leaveToLocal(), on(fn), … }; session() = { client, bridge, projectId, role } | null
 */
import { createStoreBridge } from './bridge.js';
import { createClient } from './client.js';
import { createOnlineAdapter } from './adapter-online.js';

/**
 * Is there a collaboration backend? `GET api/health` → `{ ok: true, user }` within `timeout` ms. Static hosts answer
 * with the shipped `api/health` file (`{ ok: false }`), so the probe never produces a failed request there.
 */
export async function detectBackend({ timeout = 1500 } = {}) {
  try {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
    if (typeof window !== 'undefined' && window.APP_ENV && window.APP_ENV.sandboxed) return null;   // packaged preview: never has a backend
    if (typeof window !== 'undefined' && window.top !== window.self) return null;      // embedded preview
    if (typeof fetch !== 'function' || typeof WebSocket !== 'function') return null;
  } catch (e) { return null; }
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = setTimeout(() => ctl && ctl.abort(), timeout);
  try {
    const r = await fetch(new URL('api/health', document.baseURI), { cache: 'no-store', credentials: 'same-origin', signal: ctl ? ctl.signal : undefined });
    // the server answered: the timeout guards against a host that never answers, not against a busy page (the 3D view
    // boots on the main thread and can hold the body's read past `timeout`) — give the small body time of its own
    clearTimeout(timer); timer = setTimeout(() => ctl && ctl.abort(), 10000);
    if (!r.ok) return null;
    const j = JSON.parse(await r.text());
    return j && j.ok === true && typeof j.user === 'string' ? j : null;
  } catch (e) { return null; } finally { clearTimeout(timer); }
}

const apiUrl = (p) => new URL('api/' + p, document.baseURI).toString();
const wsUrl = (id) => { const u = new URL('api/rooms/' + encodeURIComponent(id), document.baseURI); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; return u.toString(); };
async function rest(method, p, body) {
  const r = await fetch(apiUrl(p), { method, cache: 'no-store', credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { j = null; }
  return { status: r.status, ok: r.ok, body: j };
}

/**
 * Wire live collaboration into the app when a backend answers. Resolves to the controller or null.
 * @param {{ store, projects, ui, view2d, view3d }} app
 */
export async function initCollaboration(app) {
  const health = await detectBackend();
  if (!health) {
    app.projects.openOnline = async () => ({ ok: false, reason: 'Online projects need the collaboration server.' });
    app.projects.putOnline = app.projects.openOnline;
    return null;
  }
  const { store, projects } = app;
  const online = createOnlineAdapter({ rest });
  let session = null;                    // { client, bridge, projectId }
  const listeners = new Set();
  const emit = (ev) => listeners.forEach((fn) => { try { fn(ev); } catch (e) { console.error('[collab]', e); } });

  function leave() {
    if (!session) return;
    const s = session; session = null;
    s.bridge.detach(); s.client.dispose();
    emit({ type: 'left', projectId: s.projectId });
  }
  let switching = false;               // our own detachForOnline() also announces 'closing'
  projects.on((e) => { if (e.type === 'closing' && !switching) leave(); });

  /** Open an online project through its room. */
  async function openOnline(projectId) {
    if (session && session.projectId === projectId) return { ok: true };
    await projects.flush();
    const meta = await rest('GET', 'projects/' + encodeURIComponent(projectId)).catch(() => null);
    if (!meta || !meta.ok) return { ok: false, reason: (meta && meta.body && meta.body.reason) || 'That online project could not be opened.' };
    leave();
    const pid = projectId;
    const bridge = createStoreBridge(store, {
      fetchUnderlay: async (assetId) => { const r = await rest('GET', `projects/${encodeURIComponent(pid)}/underlay`); return r.ok && r.body && r.body.id === assetId ? r.body.data : null; },
      uploadUnderlay: async (image, m) => { const r = await rest('PUT', `projects/${encodeURIComponent(pid)}/underlay`, { image, meta: m, cid: client.cid }); return r.ok ? r.body.id : null; },
    });
    const client = createClient({ adapter: bridge, connect: () => new WebSocket(wsUrl(pid)) });
    const s = { client, bridge, projectId: pid, role: meta.body.role, name: meta.body.name };
    bridge.onDetached(() => { if (session === s) { session = null; emit({ type: 'left', projectId: pid }); } });
    const opened = new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 15000);
      client.on('welcome', (w) => {
        if (!w.first) return;
        switching = true;
        try { projects.detachForOnline({ id: pid, name: meta.body.name, phase: meta.body.phase, updatedAt: meta.body.updatedAt, role: meta.body.role }); } finally { switching = false; }
        bridge.openDoc(w.doc);
        clearTimeout(t); resolve(true);
      });
      client.on('error', (m) => { if (m.code === 'removed') { clearTimeout(t); resolve(false); } });
    });
    session = s;
    bridge.attach(client);
    client.open();
    const ok = await opened;
    if (!ok) { if (session === s) leave(); return { ok: false, reason: 'The project\'s room did not answer.' }; }
    projects.onlineOpened({ id: pid, name: store.project.name || meta.body.name });
    try { const u = new URL(location.href); u.searchParams.set('online', pid); history.replaceState(history.state, '', u); } catch (e) { /* address bar is read-only here */ }
    emit({ type: 'open', projectId: pid, session: s });
    return { ok: true };
  }

  /** Copy the open local project to the server (the signed-in person becomes its owner) and open it online. */
  async function putOnline() {
    if (session) return { ok: false, reason: 'This project is already online.' };
    await projects.flush();
    const cur = projects.current();
    const exp = cur ? await projects.exportFile(cur.id) : null;
    if (!exp || !exp.ok) return { ok: false, reason: 'The project could not be read.' };
    const record = JSON.parse(exp.text).project;
    let made;
    try { made = await online.put(record); } catch (e) { return { ok: false, reason: e.message || 'The server did not take the project.' }; }
    const res = await openOnline(made.id);
    return res.ok ? { ok: true, id: made.id } : res;
  }

  /** Leave the online project and open the most recent project on this device (or a fresh copy of House 98). */
  async function leaveToLocal() {
    leave();
    let list = [];
    try { list = await projects.list(); } catch (e) { list = []; }
    if (list.length && await projects.open(list[0].id)) return true;
    const r = await projects.create({ from: 'house98', name: 'House 98' });
    return !!(r && r.ok);
  }
  /** Delete an online project on the server (owner). Leaves it first when it is open here. */
  async function removeOnline(id) {
    try { await online.remove(id); } catch (e) { return { ok: false, reason: e.message }; }
    if (session && session.projectId === id) await leaveToLocal();
    return { ok: true };
  }
  /** The address that opens an online project (for "Copy link"). */
  function linkFor(id) {
    const u = new URL(location.href);
    u.search = ''; u.hash = '';
    u.searchParams.set('online', id);
    return u.toString();
  }

  const ctl = {
    user: health.user,
    session: () => session,
    online,
    openOnline, putOnline, leave, leaveToLocal, removeOnline, linkFor,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    rest,
  };
  const { initCollabUI } = await import('./presence.js');
  initCollabUI(app, ctl);
  try { const ui = await import('../ui/collab/index.js'); ui.initCollabPanels(app, ctl); } catch (e) { console.error('[collab] sharing UI', e); }
  projects.openOnline = openOnline;
  projects.putOnline = putOnline;
  app.collab = ctl;
  if (typeof window !== 'undefined' && window.app) window.app.collab = ctl;
  // ?online=<id> in the address opens that project's room
  try {
    const want = new URL(location.href).searchParams.get('online');
    if (want) {
      const res = await openOnline(want);
      if (!res.ok && app.ui && app.ui.toast) app.ui.toast(res.reason, { kind: 'warn' });
    }
  } catch (e) { /* ignore */ }
  return ctl;
}

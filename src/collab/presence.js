/**
 * LIVE COLLABORATION — presence and the small collaboration UI (CONTRACT § 13): connection status in the status bar,
 * people in the top bar (initials + colour, list on click), each person's pointer and selection in the 2D plan, their
 * selection in 3D, soft locks ("being edited by …"), toasts, and the temporary "Put online" action.
 * Loaded only when a backend answered (src/collab/online.js).
 */
import { itemCorners } from '../core/geometry.js';
import { wallSegments } from '../core/plan-edit.js';
import { initialsOf } from './room.js';

const LOCK_MS = 5000;          // a soft lock lapses after 5 s without a presence message from its holder
const HEARTBEAT_MS = 1500;

const CSS = `
.cl-people{display:flex;align-items:center;gap:4px}
.cl-people[hidden],.cl-golive[hidden],.cl-status[hidden]{display:none!important}
.cl-avatars{display:flex;align-items:center;cursor:pointer;background:none;border:0;padding:0 2px;height:32px}
.cl-av{width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font:600 11px/1 var(--font-ui,system-ui);color:#fff;border:2px solid var(--panel,#fff);margin-left:-6px;box-sizing:border-box;flex:none}
.cl-av:first-child{margin-left:0}
.cl-av--me{box-shadow:0 0 0 1px var(--ink-3,#999)}
.cl-more{font:600 11px/1 var(--font-ui,system-ui);color:var(--ink-2,#555);margin-left:4px}
.cl-golive{height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--line-strong,#ccc);background:var(--raised,#fff);color:var(--ink,#222);font:500 12px/1 var(--font-ui,system-ui);cursor:pointer;white-space:nowrap}
.cl-golive:hover{background:var(--hover,#f2f2f2)}
.cl-pop{position:fixed;z-index:60;min-width:240px;max-width:min(340px,calc(100vw - 32px));background:var(--raised,#fff);color:var(--ink,#222);border:1px solid var(--line,#ddd);border-radius:10px;box-shadow:var(--shadow-2,0 6px 24px rgba(0,0,0,.18));padding:6px;font:13px/1.35 var(--font-ui,system-ui)}
.cl-pop__row{display:flex;gap:10px;align-items:center;padding:6px 8px;border-radius:6px}
.cl-pop__row .cl-av{margin:0}
.cl-pop__who{display:flex;flex-direction:column;min-width:0}
.cl-pop__name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cl-pop__sub{color:var(--ink-3,#777);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cl-status{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.cl-dot{width:8px;height:8px;border-radius:50%;background:var(--ink-3,#999);flex:none}
.cl-status--live .cl-dot{background:var(--pass,#2e9d5b)}
.cl-status--reconnecting .cl-dot,.cl-status--connecting .cl-dot{background:var(--warn,#d9a400)}
.cl-status--offline .cl-dot{background:var(--fail,#c0392b)}
.app.is-online .sb__cell--saved{display:none}
.cl-3d{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3}
.cl-3d__box{position:absolute;border:2px solid;border-radius:4px;box-sizing:border-box}
.cl-3d__tag{position:absolute;left:-2px;top:-20px;color:#fff;font:600 11px/18px var(--font-ui,system-ui);padding:0 6px;border-radius:4px;white-space:nowrap}
`;

const MODE_LABEL = { '2d': 'Plan', '3d': '3D', walk: 'Walk-through', split: 'Plan + 3D' };
const modeOf = (ui) => (ui.tool === 'carpentry' ? 'Carpentry' : ['structure', 'wall', 'door', 'window', 'passage'].includes(ui.tool) ? 'Structure' : MODE_LABEL[ui.mode] || ui.mode);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** @param {{ store, view2d, view3d, ui, projects }} app  @param {object} ctl  the controller from online.js */
export function initCollabUI(app, ctl) {
  const { store, view2d, view3d } = app;
  const toast = (msg, opts) => { if (app.ui && typeof app.ui.toast === 'function') app.ui.toast(msg, opts); };
  if (!document.getElementById('cl-style')) { const st = el('style'); st.id = 'cl-style'; st.textContent = CSS; document.head.appendChild(st); }

  // ---------------------------------------------------------------- static DOM
  const topbar = document.getElementById('topbar');
  const people = el('div', 'topbar__group cl-people');
  const avatars = el('button', 'cl-avatars'); avatars.type = 'button'; avatars.setAttribute('aria-label', 'People in this project');
  const golive = el('button', 'cl-golive', 'Put online'); golive.type = 'button';
  golive.title = 'Put this project online so the people you invite can work on it with you, live';
  people.append(avatars, golive);
  const end = topbar && topbar.querySelector('.topbar__end');
  if (topbar) { if (end) topbar.insertBefore(people, end); else topbar.appendChild(people); }
  const statusbar = document.getElementById('statusbar');
  const statusCell = el('div', 'sb__cell cl-status'); statusCell.setAttribute('role', 'status'); statusCell.setAttribute('aria-live', 'polite');
  const dot = el('span', 'cl-dot'), statusText = el('span', 'cl-status__text');
  statusCell.append(dot, statusText); statusCell.hidden = true;
  if (statusbar) statusbar.appendChild(statusCell);
  const layer3d = el('div', 'cl-3d');
  const pane3d = document.getElementById('pane3d');
  if (pane3d) pane3d.appendChild(layer3d);

  golive.addEventListener('click', async () => {
    golive.disabled = true;
    const r = await ctl.putOnline();
    golive.disabled = false;
    toast(r.ok ? 'This project is online now. People you invite can open it from this page\'s address.' : r.reason, { kind: r.ok ? 'success' : 'warn' });
  });

  let pop = null;
  const closePop = () => { if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); } };
  const outside = (e) => { if (pop && !pop.contains(e.target) && !avatars.contains(e.target)) closePop(); };
  avatars.addEventListener('click', () => { if (pop) closePop(); else openPop(); });

  // ---------------------------------------------------------------- session state
  let S = null;    // { client, bridge, offs: [], me, timer }

  function everyone() {
    if (!S) return [];
    const you = S.client.you();
    const list = you ? [{ ...you, me: true, p: S.me }] : [];
    return list.concat(S.client.peers());
  }
  function avatar(p) {
    const a = el('span', 'cl-av' + (p.me ? ' cl-av--me' : ''), initialsOf(p.name || p.email));
    a.style.background = p.color || '#888';
    a.title = `${p.name || p.email}${p.me ? ' (you)' : ''}${p.role === 'viewer' ? ' · view only' : ''}`;
    return a;
  }
  function render() {
    const on = !!S;
    document.getElementById('app')?.classList.toggle('is-online', on);
    golive.hidden = on;
    statusCell.hidden = !on;
    avatars.hidden = !on;
    avatars.replaceChildren();
    if (!on) { closePop(); return; }
    const all = everyone();
    for (const p of all.slice(0, 5)) avatars.appendChild(avatar(p));
    if (all.length > 5) avatars.appendChild(el('span', 'cl-more', `+${all.length - 5}`));
    const st = S.client.status();
    const n = Math.max(1, st.people);
    const text = st.state === 'live' ? `Live · ${n} ${n === 1 ? 'person' : 'people'}${st.role === 'viewer' ? ' · view only' : ''}`
      : st.state === 'reconnecting' ? 'Reconnecting…' : st.state === 'connecting' ? 'Connecting…' : 'Offline — changes will sync';
    statusText.textContent = text;
    statusCell.className = `sb__cell cl-status cl-status--${st.state}`;
    statusCell.title = st.pending ? `${st.pending} change${st.pending === 1 ? '' : 's'} waiting to be sent` : '';
    if (pop) fillPop();
  }
  function openPop() {
    pop = el('div', 'cl-pop'); pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'People in this project');
    fillPop();
    (document.getElementById('ui-layer') || document.body).appendChild(pop);
    const r = avatars.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 6)}px`;
    pop.style.left = `${Math.round(Math.max(16, Math.min(r.left, window.innerWidth - pop.offsetWidth - 16)))}px`;
    document.addEventListener('pointerdown', outside, true);
  }
  function fillPop() {
    pop.replaceChildren();
    for (const p of everyone()) {
      const row = el('div', 'cl-pop__row'), who = el('div', 'cl-pop__who');
      const where = p.p ? [p.p.mode, p.p.room].filter(Boolean).join(' · ') : '';
      who.append(el('span', 'cl-pop__name', `${p.name || p.email}${p.me ? ' (you)' : ''}`), el('span', 'cl-pop__sub', [p.email, p.role === 'viewer' ? 'view only' : p.role, where].filter(Boolean).join(' · ')));
      row.append(avatar(p), who);
      pop.appendChild(row);
    }
  }

  // ---------------------------------------------------------------- presence out
  function start(session) {
    stop();
    const { client, bridge } = session;
    const me = { pointer: null, sel: [...store.selection], mode: modeOf(store.ui), room: null, lock: null };
    S = { client, bridge, offs: [], me, timer: 0, lastBeat: 0 };
    const push = () => client.setPresence({ ...me });
    const on = (target, ev, fn) => { const off = target && typeof target.on === 'function' ? target.on(ev, fn) : null; if (typeof off === 'function') S.offs.push(off); };
    on(client, 'status', render); on(client, 'peers', () => { render(); syncLocks(); redraw(); });
    on(client, 'presence', () => { syncLocks(); redraw(); if (pop) fillPop(); });
    on(client, 'role', render);
    on(client, 'toast', (t) => toast(t.message, { kind: t.kind || 'info' }));
    on(view2d, 'cursor', (c) => {
      me.pointer = c && Number.isFinite(c.x) ? { x: Math.round(c.x), y: Math.round(c.y) } : null;
      if (c && c.space) me.room = c.space.name || c.space.id || null;
      push();
    });
    on(store, 'selection', () => { me.sel = [...store.selection]; push(); });
    on(store, 'ui', (e) => { if (e.keys.includes('mode') || e.keys.includes('tool')) { me.mode = modeOf(store.ui); if (store.ui.mode !== '2d' && store.ui.mode !== 'split') me.pointer = null; push(); } });
    on(store, 'items', (e) => { if (e.transient && !e.collabLocal && store._batch && e.ids && e.ids.length) { const k = 'item:' + e.ids[0]; if (me.lock !== k) { me.lock = k; push(); } } });
    on(store, 'plan', (e) => { if (e.transient && store._batch && store.ui.structureSel) { const k = 'seg:' + store.ui.structureSel.id; if (me.lock !== k) { me.lock = k; push(); } } });
    // a lock lasts while the gesture does; heartbeat so others can tell a held lock from a vanished person
    S.timer = setInterval(() => {
      if (!S) return;
      if (me.lock && !store._batch) { me.lock = null; push(); }
      else if (me.lock && Date.now() - S.lastBeat > HEARTBEAT_MS) { S.lastBeat = Date.now(); push(); }
      syncLocks();
      if (!raf3d && store.ui.mode !== '2d' && S.client.peers().some((p) => p.p && p.p.sel && p.p.sel.length)) raf3d = requestAnimationFrame(paint3d);   // the 3D camera may have moved
    }, 250);
    S.offs.push(view2d.addOverlay(paint2d));
    push();
    render();
  }
  function stop() {
    if (!S) return;
    clearInterval(S.timer);
    for (const off of S.offs) { try { off(); } catch (e) { /* gone */ } }
    S = null;
    layer3d.replaceChildren();
    render();
    if (view2d.redraw) view2d.redraw();
  }
  ctl.on((e) => { if (e.type === 'open') start(e.session); else if (e.type === 'left') { stop(); try { const u = new URL(location.href); u.searchParams.delete('online'); history.replaceState(history.state, '', u); } catch (err) { /* ignore */ } } });

  // ---------------------------------------------------------------- presence in
  const fresh = (p) => p.p && Date.now() - (p.seenAt || 0) < LOCK_MS;
  function lockHolder(key) { if (!S) return null; for (const p of S.client.peers()) if (fresh(p) && p.p.lock === key) return p; return null; }
  function syncLocks() {
    if (!S) return;
    const want = new Set();
    for (const p of S.client.peers()) if (fresh(p) && p.p.lock && p.p.lock.startsWith('item:')) want.add(p.p.lock.slice(5));
    for (const id of S.bridge.softLocked()) if (!want.has(id)) S.bridge.softLock(id, false);
    for (const id of want) if (!store.selection.includes(id) || !store._batch) S.bridge.softLock(id, true);
  }
  /** Is this item / wall being edited by someone else? → their name, or null. */
  ctl.editedBy = (key) => { const p = lockHolder(key); return p ? p.name : null; };

  let raf3d = 0;
  function redraw() {
    if (view2d.redraw) view2d.redraw();
    if (!raf3d) raf3d = requestAnimationFrame(paint3d);
  }
  function paint2d(G) {
    if (!S) return;
    const { ctx, dpr } = G;
    ctx.save();
    for (const p of S.client.peers()) {
      if (!p.p) continue;
      const col = p.color || '#888';
      // selection outlines (dashed) and soft locks (solid + label)
      for (const id of p.p.sel || []) {
        const it = store.getItem(id); if (!it) continue;
        const pts = itemCorners(it);
        ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(G.X(x), G.Y(y)) : ctx.moveTo(G.X(x), G.Y(y)))); ctx.closePath();
        ctx.strokeStyle = col; ctx.lineWidth = 2 * dpr; ctx.setLineDash([5 * dpr, 3 * dpr]); ctx.stroke(); ctx.setLineDash([]);
      }
      if (p.p.lock && fresh(p)) {
        let at = null;
        if (p.p.lock.startsWith('item:')) { const it = store.getItem(p.p.lock.slice(5)); if (it) at = { x: it.x, y: it.y - it.d / 2 }; }
        else if (p.p.lock.startsWith('seg:')) {
          const s = wallSegments().find((g) => g.id === p.p.lock.slice(4));
          if (s) { ctx.strokeStyle = col; ctx.lineWidth = 3 * dpr; ctx.strokeRect(G.X(s.x), G.Y(s.y), s.w * G.k, s.h * G.k); at = { x: s.x + s.w / 2, y: s.y }; }
        }
        if (at) tag(ctx, G.X(at.x), G.Y(at.y) - 6 * dpr, `Being edited by ${p.name}`, col, dpr, true);
      }
      // pointer
      if (p.p.pointer && (p.p.mode === 'Plan' || p.p.mode === 'Plan + 3D' || p.p.mode === 'Structure' || p.p.mode === 'Carpentry')) {
        const x = G.X(p.p.pointer.x), y = G.Y(p.p.pointer.y), s = dpr;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 3 * s, y + 15 * s); ctx.lineTo(x + 6.5 * s, y + 10 * s); ctx.lineTo(x + 12 * s, y + 9.5 * s); ctx.closePath();
        ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2 * s; ctx.stroke();
        tag(ctx, x + 10 * s, y + 24 * s, p.name, col, dpr, false);
      }
    }
    ctx.restore();
  }
  function tag(ctx, x, y, text, col, dpr, centred) {
    ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'left';
    const w = ctx.measureText(text).width + 10 * dpr, h = 17 * dpr, x0 = centred ? x - w / 2 : x;
    ctx.fillStyle = col; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y - h + 3 * dpr, w, h, 4 * dpr); else ctx.rect(x0, y - h + 3 * dpr, w, h);
    ctx.fill(); ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic'; ctx.fillText(text, x0 + 5 * dpr, y - 2 * dpr);
  }
  /** Others' selections in 3D: a box in their colour around the item's screen rectangle, with their name. */
  function paint3d() {
    raf3d = 0;
    if (!S || store.ui.mode === '2d' || !pane3d || typeof view3d.itemScreenRect !== 'function') { layer3d.replaceChildren(); return; }
    const pr = pane3d.getBoundingClientRect(), boxes = [];
    for (const p of S.client.peers()) for (const id of (p.p && p.p.sel) || []) {
      let r = null; try { r = view3d.itemScreenRect(id); } catch (e) { r = null; }
      if (!r || !r.visible || r.w <= 0) continue;
      const b = el('div', 'cl-3d__box'); b.style.borderColor = p.color; b.dataset.peer = p.cid; b.dataset.item = id;
      Object.assign(b.style, { left: `${Math.round(r.x - pr.left)}px`, top: `${Math.round(r.y - pr.top)}px`, width: `${Math.round(r.w)}px`, height: `${Math.round(r.h)}px` });
      const t = el('span', 'cl-3d__tag', p.name); t.style.background = p.color; b.appendChild(t);
      boxes.push(b);
    }
    layer3d.replaceChildren(...boxes);
    if (boxes.length) raf3d = requestAnimationFrame(paint3d);      // follow the camera while someone has a selection
  }

  render();
  return { render };
}

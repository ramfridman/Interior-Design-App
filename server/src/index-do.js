/**
 * ProjectIndex — ONE Durable Object (name "index") that knows every online project: owner, members and their roles,
 * name, dates, phase and who is in its room right now. Strongly consistent (one writer), needs nothing set up by hand
 * (the migration in wrangler.jsonc creates it) and is on the Workers Free plan; Workers KV would be eventually consistent
 * with a small daily write allowance, and D1 would need a database to be created and its id pasted into the config.
 *
 * Storage (SQLite-backed, key-value API): 'p:<id>' → { id, name, owner, members: { email: role }, createdAt, updatedAt,
 * phase, people: [{ email, name, color, role }], peopleAt }.
 * Internal routes (only the Worker and ProjectRoom call them):
 *   GET /list?email= → summaries   GET /entry?id= → entry | 404   POST /create { id, owner, name, phase }
 *   POST /members { id, members } → { members, changes }   POST /delete { id }   POST /touch { id, name?, phase?, updatedAt?, people? }
 */
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
export const ROLES = ['viewer', 'editor', 'owner'];
export const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}$/;
const PEOPLE_FRESH_MS = 15 * 60 * 1000;   // a room that stopped reporting (a restart without close events) shows nobody

export const roleOf = (p, email) => (p && p.members && ROLES.includes(p.members[email]) ? p.members[email] : null);
export const summaryOf = (p, email, now = Date.now()) => ({
  id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, phase: p.phase || 'fixed', owner: p.owner,
  role: roleOf(p, email), online: true,
  people: p.people && now - Date.parse(p.peopleAt || 0) < PEOPLE_FRESH_MS ? p.people : [],
});
/** The members list the owner may set: the owner stays owner; others are editor / viewer; bad emails dropped. */
export function cleanMembers(owner, members) {
  const next = { [owner]: 'owner' };
  for (const [m, rl] of Object.entries(members || {})) { const e = String(m).trim().toLowerCase(); if (EMAIL.test(e) && e !== owner && ROLES.includes(rl) && rl !== 'owner') next[e] = rl; }
  return next;
}

export class ProjectIndex {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async all() { const m = await this.ctx.storage.list({ prefix: 'p:' }); return [...m.values()]; }
  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json() : null;
    switch (url.pathname) {
      case '/list': {
        const email = url.searchParams.get('email');
        const list = (await this.all()).filter((p) => roleOf(p, email)).map((p) => summaryOf(p, email)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        return json(200, list);
      }
      case '/entry': {
        const p = await this.ctx.storage.get('p:' + url.searchParams.get('id'));
        return p ? json(200, p) : json(404, { ok: false });
      }
      case '/create': {
        const at = new Date().toISOString();
        const p = { id: body.id, name: String(body.name || 'Project').slice(0, 120), owner: body.owner, members: { [body.owner]: 'owner' }, createdAt: at, updatedAt: at, phase: body.phase === 'draft' ? 'draft' : 'fixed', people: [], peopleAt: at };
        await this.ctx.storage.put('p:' + p.id, p);
        return json(201, summaryOf(p, body.owner));
      }
      case '/members': {
        const p = await this.ctx.storage.get('p:' + body.id);
        if (!p) return json(404, { ok: false });
        const before = p.members, next = cleanMembers(p.owner, body.members);
        p.members = next;
        await this.ctx.storage.put('p:' + p.id, p);
        const changes = {};
        for (const e of new Set([...Object.keys(before), ...Object.keys(next)])) if (before[e] !== next[e]) changes[e] = next[e] || null;
        return json(200, { members: next, changes });
      }
      case '/delete': { await this.ctx.storage.delete('p:' + body.id); return json(200, { ok: true }); }
      case '/touch': {
        const p = await this.ctx.storage.get('p:' + body.id);
        if (!p) return json(404, { ok: false });
        if (body.updatedAt) p.updatedAt = body.updatedAt;
        if (typeof body.name === 'string' && body.name.trim()) p.name = body.name.slice(0, 120);
        if (body.phase === 'draft' || body.phase === 'fixed') p.phase = body.phase;
        if (Array.isArray(body.people)) { p.people = body.people.slice(0, 50); p.peopleAt = new Date().toISOString(); }
        await this.ctx.storage.put('p:' + p.id, p);
        return json(200, { ok: true });
      }
    }
    return json(404, { ok: false });
  }
}

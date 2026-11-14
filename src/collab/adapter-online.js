/**
 * LIVE COLLABORATION — the projects STORAGE ADAPTER over the REST API (CONTRACT § 10 "Storage adapter", § 13 "REST").
 * Same shape as core/projects.js adapters — { list, get, put, remove }, all async — plus the sharing calls the Share
 * dialog needs. Works against dev/collab-server.mjs and the Cloudflare Worker (server/) alike.
 *
 *   const online = createOnlineAdapter({ rest });   // rest(method, path, body) → { status, ok, body } (online.js)
 *   await online.list()            → summaries { id, name, updatedAt, phase, owner, role, online: true, people: [{ email, name, color, role }] }
 *   await online.get(id)           → record (+ role, members) | null
 *   await online.put(record)       → summary of the NEW online project (the signed-in person owns it)
 *   await online.remove(id)        → deletes it on the server (owner only; throws with the server's reason otherwise)
 *   await online.members(id)       → { members: { email: role }, owner }
 *   await online.setMembers(id, m) → { members }
 *   await online.versionSummary(id, versionId) → { items, runs, changes: { total, byType } } | null
 */
const enc = encodeURIComponent;
const fail = (r, fallback) => { const e = new Error((r && r.body && r.body.reason) || fallback); e.status = r && r.status; throw e; };

export function createOnlineAdapter({ rest }) {
  return {
    kind: 'online',
    async list() {
      const r = await rest('GET', 'projects');
      if (!r.ok || !Array.isArray(r.body)) fail(r, 'The online projects could not be listed.');
      return r.body.map((p) => ({ ...p, online: true, people: Array.isArray(p.people) ? p.people : [] }));
    },
    async get(id) {
      const r = await rest('GET', 'projects/' + enc(id));
      return r.ok ? r.body : null;
    },
    async put(record) {
      const r = await rest('POST', 'projects', { record });
      if (!r.ok) fail(r, 'The server did not take the project.');
      return { ...(r.body.project || {}), id: r.body.id, online: true };
    },
    async remove(id) {
      const r = await rest('DELETE', 'projects/' + enc(id));
      if (!r.ok) fail(r, 'The project could not be deleted.');
    },
    async members(id) {
      const r = await rest('GET', `projects/${enc(id)}/members`);
      if (!r.ok) fail(r, 'The people list could not be read.');
      return r.body;
    },
    async setMembers(id, members) {
      const r = await rest('PUT', `projects/${enc(id)}/members`, { members });
      if (!r.ok) fail(r, 'The people list could not be saved.');
      return r.body;
    },
    async versionSummary(id, vid) {
      const r = await rest('GET', `projects/${enc(id)}/versions/${enc(vid)}`);
      return r.ok ? r.body : null;
    },
  };
}

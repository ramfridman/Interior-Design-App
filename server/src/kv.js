/**
 * The room's storage interface ({ get, put, delete } with JSON values, CONTRACT § 13) over a Durable Object's storage
 * (SQLite-backed; its key-value API). A value is stored as JSON text; text longer than CHUNK characters is split into
 * numbered pieces, because one key + value may not exceed 8 MB while a project snapshot may reach 32 MB and the
 * underlay picture 4 MB. Keys are prefixed so the room's keys never meet the Durable Object's own (`meta:*`).
 */
export const CHUNK = 512 * 1024;   // characters; ≤ 1.5 MB even if every character took 3 bytes

/** @param {{ get, put, delete }} storage  DurableObjectStorage (or a fake with the same async methods)
 *  @param {string} prefix */
export function chunkedKV(storage, prefix = 'r:') {
  const K = (k) => prefix + k;
  const partKey = (k, i) => `${prefix}${k}#${i}`;
  async function parts(k) { const head = await storage.get(K(k)); return head && typeof head === 'object' && head.__chunks ? head.__chunks : 0; }
  return {
    async get(k) {
      const head = await storage.get(K(k));
      if (head === undefined || head === null) return undefined;
      if (typeof head === 'string') return JSON.parse(head);
      if (head.__chunks) {
        const keys = Array.from({ length: head.__chunks }, (_, i) => partKey(k, i));
        const got = await storage.get(keys);          // Map
        let text = '';
        for (const pk of keys) { const piece = got.get(pk); if (typeof piece !== 'string') return undefined; text += piece; }
        return JSON.parse(text);
      }
      return undefined;
    },
    async put(k, v) {
      const text = JSON.stringify(v);
      const old = await parts(k);
      if (text.length <= CHUNK) {
        await storage.put(K(k), text);
        if (old) await storage.delete(Array.from({ length: old }, (_, i) => partKey(k, i)));
        return;
      }
      const n = Math.ceil(text.length / CHUNK), entries = {};
      for (let i = 0; i < n; i++) entries[partKey(k, i)] = text.slice(i * CHUNK, (i + 1) * CHUNK);
      // pieces first, then the head that points at them (a reader never sees a head without its pieces)
      const names = Object.keys(entries);
      for (let i = 0; i < names.length; i += 64) { const batch = {}; for (const nm of names.slice(i, i + 64)) batch[nm] = entries[nm]; await storage.put(batch); }
      await storage.put(K(k), { __chunks: n });
      if (old > n) await storage.delete(Array.from({ length: old - n }, (_, i) => partKey(k, n + i)));
    },
    async delete(k) {
      const old = await parts(k);
      await storage.delete(K(k));
      if (old) await storage.delete(Array.from({ length: old }, (_, i) => partKey(k, i)));
    },
  };
}

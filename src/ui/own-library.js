/**
 * "My library on this device": own products the person keeps to reuse in other projects (CONTRACT § 16).
 * Stored with the UI preferences (prefs.js → localStorage); when storage is unavailable (sandboxed viewer, private
 * window) the library lives in memory for the session and nothing fails. Nothing here is ever sent anywhere.
 */
import { getPref, setPref } from './prefs.js';
import { normalizeOwnProduct } from '../catalog/own.js';

const KEY = 'ownLibrary';
const MAX = 300;

/** The library's products (newest first), sanitised. */
export function libraryList() {
  let raw;
  try { raw = getPref(KEY); } catch (e) { raw = null; }
  return (Array.isArray(raw) ? raw : []).map(normalizeOwnProduct).filter(Boolean);
}

/** Add or replace a product (by id) — newest first. Returns true when it was written (in memory at least). */
export function libraryPut(product) {
  const p = normalizeOwnProduct(product);
  if (!p) return false;
  const { createdBy, ...keep } = p;   // the library belongs to this device's person: no collaborator's address in it
  void createdBy;
  const list = [keep, ...libraryList().filter((x) => x.id !== p.id)].slice(0, MAX);
  try { setPref(KEY, list); return true; } catch (e) { return false; }
}

/** Remove a product from the library. */
export function libraryRemove(id) {
  try { setPref(KEY, libraryList().filter((x) => x.id !== id)); return true; } catch (e) { return false; }
}

/** Is this product in the library? */
export const inLibrary = (id) => libraryList().some((x) => x.id === id);

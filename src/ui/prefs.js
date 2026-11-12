/**
 * UI preferences that are not part of the design file: theme, collapsed panels, split ratio, first-run flag.
 * Everything is optional — when storage is unavailable (sandboxed iframe, private mode) the app keeps working
 * with in-memory values.
 */
const KEY = 'e7-interior-design/ui-prefs/v1';
const DEFAULTS = { theme: 'system', leftOpen: true, rightOpen: true, split: 0.5, welcomed: false, budgetGroup: 'room' };

let cache = null;

function read() {
  if (cache) return cache;
  cache = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(cache, JSON.parse(raw));
  } catch (err) { /* storage unavailable */ }
  return cache;
}

/** Read one preference. */
export const getPref = (key) => read()[key];

/** Write one preference (best effort). */
export function setPref(key, value) {
  read()[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (err) { /* storage unavailable */ }
}

/** True when this browser lets us persist anything at all. */
export function storageAvailable() {
  try {
    const k = KEY + '/probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (err) { return false; }
}

/** Apply 'system' | 'light' | 'dark' to <html data-theme> (absent = follow the system). */
export function applyTheme(theme = getPref('theme')) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

/** Whether the page currently renders dark (manual override or system preference). */
export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

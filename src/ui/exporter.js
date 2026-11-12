/**
 * The single exit for everything the app hands to the user as a file (design .json, shopping-list .csv, plan .png,
 * 3D snapshot .png) and for printing.
 *
 *   await saveFile({ name: 'design.json', mime: 'application/json', data })   // data: string | Blob
 *   canPrint()                                                                // false inside the sandboxed viewer
 *
 * Normal static hosting → ordinary browser download / window.print().
 * Sandboxed viewer (window.APP_ENV.sandboxed) → script-started downloads and print are inert, so:
 *   1. try the host's download capability (window.claude.use('downloads'));
 *   2. otherwise show an in-page Export dialog: copyable text, or the image to save by hand.
 * Call saveFile() directly from the user's click.
 */
import { h } from './dom.js';
import { btn } from './components.js';
import { openDialog, toast } from './dialogs.js';

/** True when the app runs inside the sandboxed viewer iframe. */
export const isSandboxed = () => !!(typeof window !== 'undefined' && window.APP_ENV && window.APP_ENV.sandboxed);

/** Whether window.print() can work here. Hide print actions when false. */
export const canPrint = () => !isSandboxed() && typeof window.print === 'function';

const isImage = (mime) => /^image\//.test(mime || '');

/** Turn a PNG data URL into a Blob (so every image path can use the same download code). */
export function dataUrlToBlob(dataUrl) {
  const [head, body] = String(dataUrl).split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(body || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function browserDownload(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: 'display:none' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Copy text with the async clipboard API; on refusal select the fallback field so Ctrl+C works. */
export async function copyText(text, fallbackField) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    if (fallbackField) { fallbackField.focus(); fallbackField.select(); }
    return false;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** In-page fallback: text to copy, or an image to save by hand. */
async function exportDialog({ name, mime, data }) {
  if (isImage(mime)) {
    const src = typeof data === 'string' ? data : await blobToDataUrl(data);
    openDialog({
      title: 'Export image', size: 'lg',
      body: [
        h('p', { class: 'dialog__text' }, 'Right-click / long-press the image to save it.'),
        h('div', { class: 'export__imgwrap' }, h('img', { class: 'export__img', src, alt: name })),
        h('p', { class: 'dialog__hint faint' }, name),
      ],
    });
    return;
  }
  const text = typeof data === 'string' ? data : await data.text();
  const area = h('textarea', { class: 'export__text', readonly: true, spellcheck: 'false', rows: '12', 'aria-label': `Contents of ${name}` });
  area.value = text;
  const copy = btn('Copy', { variant: 'primary', icon: 'copy', attrs: { 'data-autofocus': '' }, onClick: async () => {
    const ok = await copyText(text, area);
    toast(ok ? 'Copied' : 'Press Ctrl+C to copy the selected text', { kind: ok ? 'success' : 'info' });
  } });
  openDialog({
    title: 'Export', size: 'md',
    body: [h('p', { class: 'dialog__text' }, `Copy the text and keep it as “${name}”.`), area],
    actions: [copy],
  });
}

/**
 * Hand a file to the user.
 * @param {{ name: string, mime: string, data: string|Blob }} file
 * @returns {Promise<{ ok: boolean, declined?: boolean, dialog?: boolean }>}
 */
export async function saveFile({ name, mime, data }) {
  try {
    if (!isSandboxed()) {
      const blob = data instanceof Blob ? data : (isImage(mime) && /^data:/.test(data) ? dataUrlToBlob(data) : new Blob([data], { type: mime }));
      browserDownload(name, blob);
      return { ok: true };
    }
    const use = window.claude && window.claude.use;
    const downloads = use ? await use('downloads').catch(() => null) : null;
    if (downloads) {
      try {
        const payload = typeof data === 'string' && isImage(mime) && /^data:/.test(data) ? dataUrlToBlob(data) : data;
        await downloads.save({ filename: name, data: payload });
        return { ok: true };
      } catch (err) {
        if (err && err.code === 'declined') return { ok: false, declined: true };
      }
    }
    await exportDialog({ name, mime, data });
    return { ok: true, dialog: true };
  } catch (err) {
    console.error('[ui] export failed', err);
    toast('Could not export the file', { kind: 'error' });
    return { ok: false };
  }
}

/** Print the current page (the print stylesheet shows only #print-root). No-op when printing is unavailable. */
export function printPage() {
  if (canPrint()) window.print();
}

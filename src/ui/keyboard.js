/**
 * Global keyboard shortcuts. Ignored while the user types in a field; Esc first closes whatever floats on top.
 * SHORTCUTS is also the source of the shortcuts sheet, so the list can never drift from the behaviour.
 */
import { isTyping, isMac, call } from './dom.js';
import { closeTopmost, hasOpenLayer } from './dialogs.js';

const MOD = isMac() ? '⌘' : 'Ctrl';

/** Shown in Help → Keyboard shortcuts. */
export const SHORTCUTS = [
  { group: 'Edit', rows: [
    [[MOD, 'Z'], 'Undo'], [[MOD, 'Shift', 'Z'], 'Redo'], [[MOD, 'D'], 'Duplicate'], [['Delete'], 'Remove the selection'],
    [[MOD, 'A'], 'Select everything in the active room'], [['Esc'], 'Clear selection / cancel'],
  ] },
  { group: 'Move and rotate', rows: [
    [['←', '↑', '→', '↓'], 'Nudge 1 cm'], [['Shift', '←↑→↓'], 'Nudge 10 cm'], [['R'], 'Rotate 90° clockwise'],
    [['Shift', 'R'], 'Rotate 90° counter-clockwise'], [['Alt', 'R'], 'Rotate 15°'],
  ] },
  { group: 'View', rows: [
    [['1'], 'Plan'], [['2'], '3D'], [['3'], 'Walk through'], [['4'], 'Split'], [['F'], 'Fit to the house or selection'], [['G'], 'Grid on / off'],
  ] },
  { group: 'Tools and files', rows: [
    [['V'], 'Select'], [['H'], 'Pan'], [['M'], 'Measure'], [[MOD, 'S'], 'Save design file'], [['?'], 'This list'],
  ] },
];

/** @param {object} app */
export function initKeyboard(app) {
  const { store, actions } = app;
  const modes = { 1: '2d', 2: '3d', 3: 'walk', 4: 'split' };

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (key === 'Escape') {
      if (closeTopmost()) { e.preventDefault(); return; }
      if (isTyping()) { document.activeElement.blur(); return; }
      if (app.closeDrawers && app.closeDrawers()) return;
      actions.escape();
      return;
    }
    if (mod && key === 's') { e.preventDefault(); actions.saveDesign(); return; }
    if (isTyping() || hasOpenLayer()) return;

    if (mod) {
      if (key === 'z') { e.preventDefault(); e.shiftKey ? actions.redo() : actions.undo(); }
      else if (key === 'y') { e.preventDefault(); actions.redo(); }
      else if (key === 'd') { e.preventDefault(); actions.duplicateSelection(); }
      else if (key === 'a') { e.preventDefault(); actions.selectAll(); }
      return;
    }
    // In walk mode the letters and arrows belong to the 3D view.
    const walking = store.ui.mode === 'walk';
    if (modes[key] && !e.altKey) { actions.setMode(modes[key]); return; }
    if (walking) return;

    const step = e.shiftKey ? 10 : 1;
    switch (key) {
      case 'Delete': case 'Backspace': if (store.selection.length) { e.preventDefault(); actions.deleteSelection(); } break;
      case 'ArrowLeft': if (store.selection.length) { e.preventDefault(); actions.nudge(-step, 0); } break;
      case 'ArrowRight': if (store.selection.length) { e.preventDefault(); actions.nudge(step, 0); } break;
      case 'ArrowUp': if (store.selection.length) { e.preventDefault(); actions.nudge(0, -step); } break;
      case 'ArrowDown': if (store.selection.length) { e.preventDefault(); actions.nudge(0, step); } break;
      case 'r': case '®': actions.rotateSelection((e.shiftKey ? -1 : 1) * (e.altKey ? 15 : 90)); break;
      case 'v': store.setUI({ tool: 'select' }); break;
      case 'h': store.setUI({ tool: 'pan' }); break;
      case 'm': store.setUI({ tool: 'measure' }); break;
      case 'g': store.setUI({ showGrid: !store.ui.showGrid }); break;
      case 'f': actions.fit(); break;
      case '+': case '=': call(app.view2d, 'zoomBy', 1.25); break;
      case '-': case '_': call(app.view2d, 'zoomBy', 0.8); break;
      case '?': app.openShortcuts(); break;
      default:
    }
  });
}

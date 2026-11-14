/**
 * Global keyboard shortcuts. Ignored while the user types in a field; Esc first closes whatever floats on top.
 * SHORTCUTS is also the source of the shortcuts sheet, so the list can never drift from the behaviour.
 */
import { isTyping, isMac, call } from './dom.js';
import { closeTopmost, hasOpenLayer } from './dialogs.js';
import { FEATURES } from '../core/features.js';

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
    ...(FEATURES.levels ? [[['PgUp', 'PgDn'], 'Floor above / below']] : []),
  ] },
  { group: 'Tools and files', rows: [
    [['V'], 'Select'], [['H'], 'Pan'], [['M'], 'Measure'], [[MOD, 'S'], 'Save design file'], [['?'], 'This list'],
  ] },
  { group: 'Structure: walls, doors and windows', rows: [
    [['B'], 'Switch between Furnish and Structure'], [['V'], 'Select walls and openings'], [['W'], 'Draw a wall'],
    [['D'], 'Place a door'], [['N'], 'Place a window'], [['P'], 'Place an open passage'],
    ...(FEATURES.levels ? [[['T'], 'Place a stair (R turns it)']] : []),
    ...(FEATURES.angledWalls ? [[['Shift'], 'While drawing: straight walls only'], [['Alt'], 'While drawing: free angle'], [['0–9', 'Tab', 'Enter'], 'While drawing: type the length, Tab to the angle, Enter builds']] : []),
  ] },
  { group: 'Carpentry: runs and units', rows: [
    [['C'], 'Switch Carpentry mode on / off'], [['N'], 'New run'], [['←', '→'], 'Previous / next unit'], [['Alt', '←', '→'], 'Move the unit left / right'],
    [['+', '−'], 'Unit 5 cm wider / narrower'], [['Delete'], 'Remove the unit'], [['F'], 'Fit the run (fillers at the walls)'], [['Shift', 'F'], 'Show the run'],
    [['Esc'], 'Unit → run → leave Carpentry'], [[MOD, 'Z'], 'Undo, one step per gesture'],
  ] },
  { group: 'Structure: the selected wall or opening', rows: [
    [['←', '↑', '→', '↓'], 'Move it 5 cm'], [['Delete'], 'Remove it'], [['Esc'], 'Put the tool down, then leave Structure'],
    [[MOD, 'Z'], 'Undo a plan change'],
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
      actions.escape(e);
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

    if (key === 'b') { app.structure.toggle(); return; }
    if (key === 'c' && !e.altKey) { app.carpentry.toggle(); return; }
    if (app.carpentry.isActive()) {
      // Carpentry mode: arrows / + − / Delete / F act on the selected unit and run; furnishing keys do nothing here.
      if (app.carpentry.handleKey(e, key)) return;
      if (['h', 'm', 'r', '®', 'v', 'Delete', 'Backspace', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(key)) return;
    }
    if (app.structure.isActive()) {
      // Structure mode: the letters pick wall / opening tools, Delete and the arrows act on the selected wall or opening.
      const tool = { v: 'structure', w: 'wall', d: 'door', n: 'window', p: 'passage', ...(FEATURES.levels ? { t: 'stairs' } : {}) }[key];
      // Stairs tool: R turns the stair to place by a quarter
      if ((key === 'r' || key === '®') && store.ui.tool === 'stairs' && !e.ctrlKey && !e.metaKey) { store.setUI({ stairRot: ((Number(store.ui.stairRot) || 0) + (e.shiftKey ? 270 : 90)) % 360 }); return; }
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
      if (tool) { app.structure.setTool(tool); return; }
      if (arrow) { if (app.structure.nudge(arrow[0], arrow[1])) e.preventDefault(); return; }
      if (key === 'Delete' || key === 'Backspace') { if (store.ui.structureSel) { e.preventDefault(); app.structure.removeSelected(); } return; }
      if (key === 'h' || key === 'm' || key === 'r' || key === '®') return;   // furnishing tools
    }

    // floors: PageUp / PageDown show the floor above / below (only while the levels feature is on)
    if ((key === 'PageUp' || key === 'PageDown') && FEATURES.levels && app.levels && !e.altKey) {
      e.preventDefault();
      app.levels.step(key === 'PageUp' ? 1 : -1);
      return;
    }
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

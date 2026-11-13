/**
 * Icon set — drawn for this app on a 24 px grid, 1.5 px stroke, round caps and joins, no fills
 * (dots use a zero-length stroke so they inherit the same weight).
 *
 *   icon('undo')                → <svg class="icon" aria-hidden="true">
 *   icon('sofa', { size: 20 })
 */
const P = (d) => `<path d="${d}"/>`;

const ICONS = {
  // ── history & tools ──
  undo: P('M8.5 5.5 4 10l4.5 4.5') + P('M4.5 10H14a5 5 0 0 1 0 10h-3'),
  redo: P('M15.5 5.5 20 10l-4.5 4.5') + P('M19.5 10H10a5 5 0 0 0 0 10h3'),
  select: P('M5.5 4 18 9.5l-5.4 2.1L10.5 17z') + P('M13.4 13.4 18.5 18.5'),
  pan: P('M12 3v18M3 12h18') + P('M9.5 5.5 12 3l2.5 2.5M9.5 18.5 12 21l2.5-2.5M5.5 9.5 3 12l2.5 2.5M18.5 9.5 21 12l-2.5 2.5'),
  measure: '<rect x="2.5" y="8" width="19" height="8" rx="1.5"/>' + P('M6.5 8v3.5M10.2 8v2.2M13.8 8v3.5M17.5 8v2.2'),
  snap: P('M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z') + P('M6 8h4M14 8h4'),
  grid: '<rect x="4" y="4" width="16" height="16" rx="1.5"/>' + P('M4 9.33h16M4 14.67h16M9.33 4v16M14.67 4v16'),
  dimensions: P('M4 6v12M20 6v12M4 12h16') + P('M7 9.5 4.5 12 7 14.5M17 9.5 19.5 12 17 14.5'),
  labels: P('M4 5.5A1.5 1.5 0 0 1 5.5 4h6.2c.4 0 .8.16 1.06.44l7 7a1.5 1.5 0 0 1 0 2.12l-6.2 6.2a1.5 1.5 0 0 1-2.12 0l-7-7A1.5 1.5 0 0 1 4 11.7z') + P('M8.5 8.5h.01'),
  site: '<rect x="3.5" y="3.5" width="17" height="17" rx="1" stroke-dasharray="3 2.6"/>' + P('M8.5 15.5v-5L12 8l3.5 2.5v5z'),

  // ── structure: walls and openings as drawn on a plan ──
  wall: '<rect x="2.500" y="8.500" width="19" height="7" rx="0.500"/>' + P('M6 15.500l4-7M11 15.500l4-7M16 15.500l4-7'),
  'wall-add': '<rect x="2.500" y="11.500" width="14.500" height="7" rx="0.500"/>' + P('M5.500 18.500l4-7M10.500 18.500l4-7') + P('M19 3v6M16 6h6'),
  door: P('M2.500 19.500H7M19 19.500h2.500') + P('M7 19.500v-12') + P('M7 7.500a12 12 0 0 1 12 12'),
  window: P('M2.500 12h4M17.500 12h4') + '<rect x="6.500" y="8.500" width="11" height="7"/>' + P('M6.500 12h11'),
  passage: '<rect x="2.500" y="9" width="5.500" height="6" rx="0.500"/><rect x="16" y="9" width="5.500" height="6" rx="0.500"/>' + P('M12 4.500v15M9.500 7 12 4.500 14.500 7M9.500 17l2.500 2.500 2.500-2.500'),
  'flip-h': P('M12 4v16') + P('M9 12H4M6.500 9.500 4 12l2.500 2.500') + P('M15 12h5M17.500 9.500 20 12l-2.500 2.500'),
  'flip-v': P('M4 12h16') + P('M12 9V4M9.500 6.500 12 4l2.500 2.500') + P('M12 15v5M9.500 17.500 12 20l2.500-2.500'),
  changes: '<rect x="4.500" y="3.500" width="15" height="17" rx="1.500"/>' + P('M12 7v5M9.500 9.500h5M9.500 16h5'),
  engineer: P('M3.500 17.500h17') + P('M5.500 17.500V15a6.500 6.500 0 0 1 13 0v2.500') + P('M10 9v3.500M14 9v3.500'),
  permit: P('M6.500 3.500h8l3.500 3.500v13.500h-11.500z') + P('M14.500 3.500V7H18') + P('M9.500 14.500l2 2 3.500-4'),

  // ── sun ──
  start: P('M8 5.500v13L18.500 12z'),
  pause: P('M8.500 5.500v13M15.500 5.500v13'),
  calendar: '<rect x="4" y="5.500" width="16" height="14.500" rx="1.500"/>' + P('M4 10h16M8.500 3.500v4M15.500 3.500v4'),
  sunrise: P('M3 18.500h18M7 18.500a5 5 0 0 1 10 0') + P('M12 10V4M9.500 6.500 12 4l2.500 2.500'),
  sunset: P('M3 18.500h18M7 18.500a5 5 0 0 1 10 0') + P('M12 4v6M9.500 7.500 12 10l2.500-2.500'),

  // ── view modes ──
  plan: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/>' + P('M3.5 12h7M10.5 4.5v4M10.5 11.5v8M14.5 12h6'),
  cube: P('M12 3 4 7.5v9l8 4.5 8-4.5v-9z') + P('M4 7.5l8 4.5 8-4.5M12 12v9'),
  walk: P('M13.2 5.5h.01') + '<circle cx="13.2" cy="4.6" r="1.6"/>' + P('M9 21l2.4-5.8-2-2.7 1-4.7 3 .4 1.9 3.1 3 1') + P('M11.4 15.2 14.6 17l.6 4M10.4 7.8 7.6 9.6 7 12.6'),
  split: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/>' + P('M12 4.5v15'),

  // ── chrome ──
  more: P('M5.5 12h.01M12 12h.01M18.5 12h.01'),
  menu: P('M4 7h16M4 12h16M4 17h16'),
  settings: P('M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20') + '<circle cx="15" cy="7" r="2.5"/><circle cx="9" cy="17" r="2.5"/>',
  help: '<circle cx="12" cy="12" r="8.5"/>' + P('M9.6 9.6a2.5 2.5 0 1 1 3.7 2.2c-.85.47-1.3 1-1.3 1.9v.3') + P('M12 16.8h.01'),
  search: '<circle cx="11" cy="11" r="6"/>' + P('M15.5 15.5 20 20'),
  close: P('M6 6l12 12M18 6 6 18'),
  plus: P('M12 5v14M5 12h14'),
  minus: P('M5 12h14'),
  fit: P('M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15'),
  'chevron-down': P('M6 9.5l6 6 6-6'),
  'chevron-up': P('M6 14.5l6-6 6 6'),
  'chevron-right': P('M9.5 6l6 6-6 6'),
  'chevron-left': P('M14.5 6l-6 6 6 6'),
  external: P('M9 6.5h8.5V15M17.5 6.5 6.5 17.5'),
  'panel-left': '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/>' + P('M9.5 4.5v15'),
  'panel-right': '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/>' + P('M14.5 4.5v15'),
  filter: P('M4 6.5h16M7 12h10M10 17.5h4'),
  check: P('M5 12.5l4.5 4.5L19 7.5'),
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/>' + P('M6.2 10h.01M9.6 10h.01M13 10h.01M16.4 10h.01M6.2 14h.01M9 14h6M17.8 14h.01'),
  all: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',

  // ── item actions ──
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="1.5"/>' + P('M8 10.5V8a4 4 0 0 1 8 0v2.5'),
  unlock: '<rect x="5" y="10.5" width="14" height="9.5" rx="1.5"/>' + P('M8 10.5V8a4 4 0 0 1 7.6-1.7'),
  eye: P('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z') + '<circle cx="12" cy="12" r="2.75"/>',
  'eye-off': P('M6.2 7.4C3.8 9.2 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.45 4.3-1.1M9.6 5.8c.75-.2 1.55-.3 2.4-.3 6 0 9.5 6.5 9.5 6.5s-.8 1.5-2.3 3.1') + P('M4 4l16 16'),
  duplicate: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.5"/>' + P('M15.5 8.5V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3'),
  trash: P('M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2') + P('M6.5 7l.8 11.6a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v5.5M14 11v5.5'),
  front: '<rect x="4" y="4" width="11" height="11" rx="1.5" fill="currentColor" fill-opacity=".2"/>' + P('M15 9h3.5A1.5 1.5 0 0 1 20 10.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5V15'),
  back: '<rect x="9" y="9" width="11" height="11" rx="1.5" fill="currentColor" fill-opacity=".2"/>' + P('M9 15H5.5A1.5 1.5 0 0 1 4 13.5v-8A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5V9'),
  'rotate-ccw': P('M5 12a7 7 0 1 0 2.05-4.95L5 9') + P('M5 4.5V9h4.5'),
  'rotate-cw': P('M19 12a7 7 0 1 1-2.05-4.95L19 9') + P('M19 4.5V9h-4.5'),
  swap: P('M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3'),
  note: P('M5.5 4h13A1.5 1.5 0 0 1 20 5.5V14l-6 6H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z') + P('M20 14h-4.5a1.5 1.5 0 0 0-1.5 1.5V20'),
  target: '<circle cx="12" cy="12" r="6.5"/>' + P('M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4'),
  pin: P('M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.400 6.5 11 6.500 11z') + '<circle cx="12" cy="10" r="2.25"/>',
  'align-left': P('M4 4v16') + '<rect x="7.500" y="6.500" width="11" height="4" rx="1"/><rect x="7.500" y="13.500" width="6.500" height="4" rx="1"/>',
  'align-center': P('M12 4v2.500M12 10.500v3M12 17.500V20') + '<rect x="6" y="6.500" width="12" height="4" rx="1"/><rect x="8.500" y="13.500" width="7" height="4" rx="1"/>',
  'align-right': P('M20 4v16') + '<rect x="5.500" y="6.500" width="11" height="4" rx="1"/><rect x="10" y="13.500" width="6.500" height="4" rx="1"/>',
  'align-top': P('M4 4h16') + '<rect x="6.500" y="7.500" width="4" height="11" rx="1"/><rect x="13.500" y="7.500" width="4" height="6.500" rx="1"/>',
  'align-middle': P('M4 12h2.500M10.500 12h3M17.500 12H20') + '<rect x="6.500" y="6" width="4" height="12" rx="1"/><rect x="13.500" y="8.500" width="4" height="7" rx="1"/>',
  'align-bottom': P('M4 20h16') + '<rect x="6.500" y="5.500" width="4" height="11" rx="1"/><rect x="13.500" y="10" width="4" height="6.500" rx="1"/>',
  'distribute-h': P('M4 4v16M20 4v16') + '<rect x="9.500" y="7" width="5" height="10" rx="1"/>',
  'distribute-v': P('M4 4h16M4 20h16') + '<rect x="7" y="9.500" width="10" height="5" rx="1"/>',

  // ── files & export ──
  save: P('M5.5 4h10.400L20 8.100V18.500a1.500 1.500 0 0 1-1.500 1.500h-13A1.500 1.500 0 0 1 4 18.500v-13A1.500 1.500 0 0 1 5.500 4z') + P('M8 4v5h7V4M7.500 20v-6.500h9V20'),
  open: P('M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z'),
  download: P('M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14'),
  reset: P('M5 12a7 7 0 1 0 2.05-4.95L5 9') + P('M5 4.5V9h4.5M12 8.500V12l2.500 1.500'),
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.5"/>' + P('M20.5 15.5 16 11l-7.5 8.500'),
  camera: P('M4 8.5A1.5 1.5 0 0 1 5.5 7h2L9 5h6l1.500 2h2A1.500 1.500 0 0 1 20 8.500v9a1.500 1.500 0 0 1-1.500 1.500h-13A1.500 1.500 0 0 1 4 17.500z') + '<circle cx="12" cy="13" r="3.250"/>',
  table: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/>' + P('M3.5 9.5h17M3.5 14.250h17M9.500 9.500V19'),
  print: P('M7 8.5V4h10v4.500M7 16.500H5.500A1.500 1.500 0 0 1 4 15v-5a1.500 1.500 0 0 1 1.500-1.500h13A1.500 1.500 0 0 1 20 10v5a1.500 1.500 0 0 1-1.500 1.500H17') + P('M7 13.500h10V20H7z'),
  copy: P('M9 4.500h6v3H9z') + P('M9 6H6.500A1.500 1.500 0 0 0 5 7.500v11A1.500 1.500 0 0 0 6.500 20h11a1.500 1.500 0 0 0 1.500-1.500v-11A1.500 1.500 0 0 0 17.500 6H15'),

  // ── 3D ──
  sun: '<circle cx="12" cy="12" r="3.75"/>' + P('M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600 7 7M17 17l1.400 1.400M5.600 18.400 7 17M17 7l1.400-1.400'),
  moon: P('M19.5 14.200A8 8 0 0 1 9.800 4.500a8 8 0 1 0 9.700 9.700z'),
  roof: P('M3 11.500 12 5l9 6.500') + P('M5.500 10v9.500h13V10'),
  cutaway: P('M4 8.500 12 5l8 3.500v7.500l-8 4-8-4z') + P('M4 12.500l8 4 8-4M12 16.500V20') + P('M4 8.500l8 4 8-4', ),
  home: P('M4 11 12 4.500 20 11') + P('M6 9.500V19h12V9.500M10 19v-5h4v5'),

  // ── status ──
  pass: '<circle cx="12" cy="12" r="8.5"/>' + P('M8 12.300l2.800 2.800L16 9.600'),
  info: '<circle cx="12" cy="12" r="8.5"/>' + P('M12 11v5.500M12 7.800h.01'),
  warn: P('M12 4.500 21 19.500H3z') + P('M12 10v4.500M12 17h.01'),
  fail: '<circle cx="12" cy="12" r="8.5"/>' + P('M9 9l6 6M15 9l-6 6'),

  // ── panels ──
  inspector: '<rect x="4" y="4" width="16" height="16" rx="1.5"/>' + P('M8 9h8M8 12.500h8M8 16h4.500'),
  list: P('M6 3.500h12v17l-2-1.300-2 1.300-2-1.300-2 1.300-2-1.300-2 1.300z') + P('M9 8h6M9 11.500h6M9 15h3.500'),
  rooms: '<rect x="3.5" y="3.500" width="17" height="17" rx="1.500"/>' + P('M3.500 10.500h6M13 10.500h7.500M12 3.500v4M12 14v6.500'),
  checks: P('M12 3.500 5 6v5.500c0 4.300 2.900 7.600 7 9 4.100-1.400 7-4.700 7-9V6z') + P('M9 12l2.200 2.200L15.200 10'),
  paint: '<rect x="5" y="4.500" width="11.500" height="4" rx="1"/>' + P('M16.500 6.500H19V11h-7v3') + '<rect x="10.750" y="14" width="2.500" height="6" rx="1"/>',
  floor: P('M3.500 18.500 7 8.500h10l3.500 10z') + P('M9.700 8.500 8.700 18.500M14.300 8.500l1 10M5.250 13.500h13.500'),

  // ── catalogue categories: indoor ──
  sofa: P('M5 11V8.500A2.500 2.500 0 0 1 7.500 6h9A2.500 2.500 0 0 1 19 8.500V11') + P('M3.500 13a1.750 1.750 0 0 1 3.500 0v2h10v-2a1.750 1.750 0 0 1 3.500 0v4.500h-17z') + P('M6 17.500V19M18 17.500V19'),
  dining: P('M3.500 11h17M6 11v8.500M18 11v8.500') + P('M12 3v2.500M9 8a3 3 0 0 1 6 0z'),
  bed: P('M3.500 18.500V6.500M3.500 15h17v3.500M20.500 15v-2.500A2.500 2.500 0 0 0 18 10h-7.500v5') + '<circle cx="7" cy="11.500" r="1.600"/>',
  kids: '<rect x="4" y="12" width="7.500" height="7.500" rx="1"/><rect x="12.500" y="12" width="7.500" height="7.500" rx="1"/>' + P('M12 4.500l3.800 6.500H8.200z'),
  desk: P('M3.500 14h17M5.500 14v5.500M18.500 14v5.500') + '<rect x="8" y="5" width="8" height="5.500" rx="1"/>' + P('M12 10.500V14'),
  kitchen: P('M5.500 10.500h13V16a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3z') + P('M3 12.500h2.500M18.500 12.500H21M7.500 10.500a4.500 4.500 0 0 1 9 0M12 4v2'),
  bath: P('M3.500 12h17v2.500a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4z') + P('M6 12V6.500a2 2 0 0 1 4 0M7 18.500l-1 2M17 18.500l1 2'),
  laundry: '<rect x="5" y="3.500" width="14" height="17" rx="1.500"/><circle cx="12" cy="13.500" r="4"/>' + P('M8 6.800h.01M10.800 6.800h.01'),
  storage: '<rect x="5" y="3.500" width="14" height="17" rx="1.500"/>' + P('M12 3.500v17M9.750 11v2.500M14.250 11v2.500'),
  lamp: P('M12 3v4.500') + P('M6.500 13.500a5.500 5.500 0 0 1 11 0z') + P('M10 17a2 2 0 0 0 4 0'),
  decor: P('M9.500 4h5') + P('M10 4c0 3-3.500 5-3.500 9.500a5.500 5.500 0 0 0 11 0C17.500 9 14 7 14 4') + P('M7 12h10'),
  climate: '<rect x="3.500" y="6" width="17" height="7" rx="1.500"/>' + P('M6.500 10.300h11') + P('M8 16c0 1.100-.900 1.400-.900 2.500M12 16v2.500M16 16c0 1.100.900 1.400.900 2.500'),

  // ── catalogue categories: outdoor ──
  lounger: P('M3 15.500h12.500L20 7.500') + P('M6 15.500V19M14.500 15.500V19M3 12.500h9'),
  parasol: P('M12 4v16M9 20h6') + P('M3.500 12a8.500 8.500 0 0 1 17 0z'),
  bbq: P('M5 10h14a7 7 0 0 1-14 0z') + P('M9.200 16.400 7.500 20.500M14.800 16.400l1.700 4.100') + P('M9.500 7c0-1.200 1-1.300 1-2.500M13.500 7c0-1.200 1-1.300 1-2.500'),
  tree: '<circle cx="12" cy="9.500" r="6"/>' + P('M12 12v9M9 21h6M12 15.500l2.500-2.500'),
  planter: P('M6 12.500h12l-1.500 7.500h-9z') + P('M12 12.500V7') + P('M12 9.500c0-2.300-1.800-4-4.500-4 0 2.500 1.900 4 4.500 4zM12 8c0-2 1.500-3.500 4-3.500 0 2.200-1.600 3.500-4 3.500z'),
  paving: '<rect x="3.500" y="5" width="17" height="14" rx="1"/>' + P('M3.500 9.670h17M3.500 14.330h17M9 5v4.670M15 9.670v4.660M9 14.330V19'),
  pool: P('M3 16.500c1.500 0 1.500 1.200 3 1.200s1.500-1.200 3-1.200 1.500 1.200 3 1.200 1.500-1.200 3-1.200 1.500 1.200 3 1.200 1.500-1.200 3-1.200') + P('M8 13V6a2 2 0 0 1 4 0M14 13V6a2 2 0 0 1 4 0M8 9.500h6'),
  play: P('M4 4.500h16M6 4.500 4 20M18 4.500 20 20') + P('M10 4.500V13M14 4.500V13M9 13h6'),
  shed: P('M3.500 10 12 4l8.500 6') + P('M5.500 9v10.500h13V9M10 19.500v-6h4v6'),
  lantern: P('M9 20h6M12 20v-8') + P('M8.500 12h7l-1-6h-5z') + P('M12 3.500V6'),
  fence: P('M4 20V8.500l2-2.500 2 2.500V20zM10 20V8.500l2-2.500 2 2.500V20zM16 20V8.500l2-2.500 2 2.500V20z') + P('M8 11.500h2M14 11.500h2M8 16h2M14 16h2'),
  car: P('M5 12l1.800-4.500a1.500 1.500 0 0 1 1.400-1h7.600a1.500 1.500 0 0 1 1.400 1L19 12') + '<rect x="3.500" y="12" width="17" height="5" rx="1.500"/>' + P('M6.500 17v2M17.500 17v2M7 14.500h1.500M15.500 14.500H17'),
};

/** Icon used for each catalogue category id (falls back to a neutral grid). */
export const CATEGORY_ICON = {
  living: 'sofa', dining: 'dining', bedroom: 'bed', kids: 'kids', office: 'desk', kitchen: 'kitchen', bathroom: 'bath',
  laundry: 'laundry', storage: 'storage', lighting: 'lamp', decor: 'decor', 'climate-tech': 'climate', finishes: 'floor',
  'outdoor-furniture': 'lounger', shade: 'parasol', bbq: 'bbq', plants: 'tree', planters: 'planter', surfaces: 'paving',
  'pool-spa': 'pool', play: 'play', 'outdoor-storage': 'shed', 'outdoor-lighting': 'lantern', fencing: 'fence', 'outdoor-utility': 'car',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an icon element.
 * @param {string} name   key of the icon set (unknown names render the neutral "all" glyph)
 * @param {{ size?: number, class?: string }} [opts]
 * @returns {SVGSVGElement}
 */
export function icon(name, opts = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const size = opts.size || 18;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'icon' + (opts.class ? ' ' + opts.class : ''));
  svg.innerHTML = ICONS[name] || ICONS.all;
  return svg;
}

export const iconNames = () => Object.keys(ICONS);

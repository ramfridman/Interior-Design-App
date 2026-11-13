/**
 * Sun control over the 3D view: time of day on a slider that shows night, sunrise, solar noon and sunset for the
 * chosen date; a play button that runs the day; and — expanded — the date with solstice / equinox presets, where the
 * sun is, and the "true shadows" switch.
 *
 * It writes store.ui.timeOfDay (decimal hours), store.ui.date ('YYYY-MM-DD') and store.ui.sunStudy; the sun's
 * position and the day's key times come from the 3D view (`view3d.on('sun', info)`). Without that event (a view
 * that does not send it) the slider still works; the marks and the position read-out stay empty.
 */
import { h, listen, setKids, nextId } from './dom.js';
import { icon } from './icons.js';
import { iconBtn, toggle } from './components.js';
import { fmtClock } from './format.js';

const DAY_SECONDS = 20;      // one played day
const STEP = 0.25;           // slider step, hours
const PRESETS = [
  { label: 'Today', tip: 'Today at the house' },
  { label: '21 Jun', md: '06-21', tip: 'Summer solstice: the longest day, the highest sun' },
  { label: '21 Sep', md: '09-21', tip: 'Autumn equinox' },
  { label: '21 Dec', md: '12-21', tip: 'Winter solstice: the shortest day, the lowest sun' },
  { label: '21 Mar', md: '03-21', tip: 'Spring equinox' },
];
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const clock = (hours) => (hours >= 24 ? '24:00' : fmtClock(hours));
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Today's date at the house, 'YYYY-MM-DD'. */
function todayAt(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch (err) { return new Date().toISOString().slice(0, 10); }
}
/** "14 h 06 min" */
const duration = (hours) => { const m = Math.round(hours * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };

/**
 * @param {object} app  UI context
 * @returns {{ el: HTMLElement, pause(): void }}
 */
export function createSunControl(app) {
  const { store, plan, view3d } = app;
  const today = () => todayAt(plan.meta && plan.meta.timeZone);
  let sun = null;            // last 'sun' event
  let playing = false, raf = 0, timer = 0, last = 0;
  let glyph = '';

  /* ───────── Bar: play, time, slider ───────── */
  const playBtn = iconBtn('start', 'Play the day', { onClick: () => (playing ? pause() : play()) });
  const dayIcon = h('span', { class: 'sunctl__glyph', 'aria-hidden': 'true' });
  const time = h('span', { class: 'sunctl__time num' });
  const where = h('span', { class: 'sunctl__where num' });
  const range = h('input', { type: 'range', class: 'range suntrack__input', min: '0', max: '24', step: String(STEP), 'aria-label': 'Time of day',
    onInput: () => { pause(); store.setUI({ timeOfDay: Number(range.value) }); } });
  const day = h('span', { class: 'suntrack__day' });
  const tick = (name, label) => h('span', { class: `suntrack__tick suntrack__tick--${name}`, hidden: true, 'data-label': label });
  const ticks = { sunrise: tick('sunrise', 'Sunrise'), solarNoon: tick('noon', 'Solar noon'), sunset: tick('sunset', 'Sunset') };
  const track = h('div', { class: 'suntrack' }, h('span', { class: 'suntrack__rail', 'aria-hidden': 'true' }, day, ticks.sunrise, ticks.solarNoon, ticks.sunset), range);
  const panelId = nextId('sun');
  const expandBtn = iconBtn('chevron-up', 'Date, sun position and shadows', { onClick: () => setOpen(!open) });
  expandBtn.setAttribute('aria-expanded', 'false');
  expandBtn.setAttribute('aria-controls', panelId);
  const bar = h('div', { class: 'sunctl__bar' }, playBtn, h('span', { class: 'sunctl__now' }, dayIcon, time, where), track, expandBtn);

  /* ───────── Panel: date, read-out, true shadows ───────── */
  const date = h('input', { type: 'date', class: 'sunctl__date num', 'aria-label': 'Date', min: '1900-01-01', max: '2100-12-31', required: true,
    onChange: () => { if (isDate(date.value)) store.setUI({ date: date.value }); else date.value = store.ui.date; } });
  const presetBtns = PRESETS.map((p) => h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', 'data-tip': p.tip, 'data-tip-side': 'top',
    onClick: () => store.setUI({ date: presetDate(p) }) }, p.label));
  const readout = h('p', { class: 'sunctl__readout' });
  const times = h('p', { class: 'sunctl__times num' });
  const study = toggle({ label: 'True shadows (sun study)', checked: store.ui.sunStudy !== false, onChange: (v) => store.setUI({ sunStudy: v }),
    hint: 'A hidden roof and cut-away walls still block the sun, so rooms show their real sun patches.' });
  const panel = h('div', { class: 'sunctl__panel', id: panelId, hidden: true },
    h('div', { class: 'sunctl__daterow' }, h('label', { class: 'field sunctl__datefield' }, date),
      h('div', { class: 'sunctl__presets', role: 'group', 'aria-label': 'Quick dates' }, presetBtns)),
    h('div', { class: 'sunctl__info' }, readout, times),
    study);
  const el = h('div', { class: 'ovl sunctl', role: 'group', 'aria-label': 'Sun' }, panel, bar);

  let open = false;
  function setOpen(v) {
    open = !!v;
    panel.hidden = !open;
    el.classList.toggle('is-open', open);
    expandBtn.setAttribute('aria-expanded', String(open));
    expandBtn.setIcon(open ? 'chevron-down' : 'chevron-up');
  }

  function presetDate(p) {
    if (!p.md) return today();
    const year = isDate(store.ui.date) ? store.ui.date.slice(0, 4) : today().slice(0, 4);
    return `${year}-${p.md}`;
  }

  /* ───────── Painting ───────── */
  const pct = (hours) => Math.max(0, Math.min(100, (hours / 24) * 100));
  const known = (v) => typeof v === 'number' && Number.isFinite(v);

  function paintTime() {
    const t = Number(store.ui.timeOfDay ?? 12);
    if (document.activeElement !== range || playing) range.value = String(t);
    range.setAttribute('aria-valuetext', clock(t));
    time.textContent = clock(t);
    const current = sun && Math.abs((sun.hours ?? t) - t) < 0.01 ? sun : null;     // the event for this very moment
    const up = current ? current.isDay !== false && current.elevation > 0 : t >= 6 && t < 18.5;
    const next = up ? 'sun' : 'moon';
    if (next !== glyph) { glyph = next; setKids(dayIcon, icon(next, { size: 16 })); }
    if (!current || !known(current.azimuth) || !known(current.elevation)) { where.textContent = ''; readout.textContent = clock(t); return; }
    const az = `${Math.round(current.azimuth)}° ${current.compass || ''}`.trim();
    where.textContent = up ? `${az} · ${Math.round(current.elevation)}°` : 'night';
    readout.textContent = up
      ? `${clock(t)} · sun ${az}, ${Math.round(current.elevation)}° high`
      : `${clock(t)} · the sun is ${Math.max(1, Math.round(-current.elevation))}° below the horizon`;
  }

  function paintDay() {
    const d = isDate(store.ui.date) ? store.ui.date : today();
    if (document.activeElement !== date) date.value = d;
    const now = today();
    PRESETS.forEach((p, i) => presetBtns[i].setAttribute('aria-pressed', String(p.md ? d.slice(5) === p.md : d === now)));
    const rise = sun && known(sun.sunrise) ? sun.sunrise : null, set = sun && known(sun.sunset) ? sun.sunset : null;
    const noon = sun && known(sun.solarNoon) ? sun.solarNoon : null;
    // Daylight band: between sunrise and sunset; a day without either is all day or all night.
    const allDay = sun && rise == null && set == null && sun.dayLength >= 24;
    day.style.left = `${allDay ? 0 : pct(rise ?? 0)}%`;
    day.style.right = `${allDay ? 0 : 100 - pct(set ?? 0)}%`;
    day.hidden = !sun || (!allDay && (rise == null || set == null));
    for (const [key, v] of [['sunrise', rise], ['solarNoon', noon], ['sunset', set]]) {
      ticks[key].hidden = v == null;
      if (v != null) ticks[key].style.left = `${pct(v)}%`;
    }
    times.textContent = !sun ? ''
      : rise != null && set != null ? `Sunrise ${clock(rise)} · noon ${clock(noon ?? 12)} · sunset ${clock(set)} · ${duration(sun.dayLength ?? set - rise)} of daylight`
        : allDay ? 'The sun does not set on this day' : 'The sun does not rise on this day';
    track.title = rise != null && set != null ? `Sunrise ${clock(rise)}, solar noon ${clock(noon ?? 12)}, sunset ${clock(set)}` : '';
  }

  /* ───────── Play ───────── */
  function frame(now) {
    if (!playing) return;
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    let t = (Number(store.ui.timeOfDay) || 0) + dt * (24 / DAY_SECONDS);
    if (t >= 24) t -= 24;
    store.setUI({ timeOfDay: t });
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (playing) return;
    playing = true;
    playBtn.setIcon('pause');
    playBtn.setAttribute('aria-label', 'Pause');
    playBtn.dataset.tip = 'Pause';
    playBtn.setPressed(true);
    if (reducedMotion()) {
      // Reduced motion: no sweep — one calm step per hour.
      timer = setInterval(() => store.setUI({ timeOfDay: (Math.floor(Number(store.ui.timeOfDay) || 0) + 1) % 24 }), (DAY_SECONDS * 1000) / 24);
    } else { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function pause() {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(raf);
    clearInterval(timer);
    playBtn.setIcon('start');
    playBtn.setAttribute('aria-label', 'Play the day');
    playBtn.dataset.tip = 'Play the day';
    playBtn.removeAttribute('aria-pressed');
    // Rest on a slider step so the clock reads a round time.
    store.setUI({ timeOfDay: Math.round((Number(store.ui.timeOfDay) || 0) / STEP) * STEP % 24 });
  }

  /* ───────── Wiring ───────── */
  listen(view3d, 'sun', (info) => { sun = info && typeof info === 'object' ? info : null; paintDay(); paintTime(); });
  store.on('ui', (e) => {
    if (e.keys.includes('timeOfDay')) paintTime();
    if (e.keys.includes('date')) paintDay();
    if (e.keys.includes('sunStudy')) study.set(store.ui.sunStudy !== false);
    if (e.keys.includes('mode') && store.ui.mode === '2d') pause();   // nothing to watch in the plan
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { setOpen(false); expandBtn.focus(); e.stopPropagation(); e.preventDefault(); } });

  paintDay();
  paintTime();
  return { el, pause };
}

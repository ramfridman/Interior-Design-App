/**
 * Solar ephemeris for the 3D daylight model — pure maths, no THREE, no DOM (runs in plain node for the tests).
 *
 * Algorithm: NOAA Solar Calculator (Jean Meeus, "Astronomical Algorithms"): geometric mean longitude and anomaly →
 * equation of centre → apparent longitude → declination; equation of time; hour angle from TRUE solar time, which is
 * derived from the civil clock using the site longitude and the civil UTC offset of the chosen date (daylight-saving
 * time included). Accuracy ≈ 0.01° in position and well under a minute for sunrise / sunset between 1900 and 2100.
 *
 * Conventions
 *   azimuth   degrees clockwise from TRUE north (0 = N, 90 = E, 180 = S, 270 = W)
 *   elevation degrees above the horizon, with atmospheric refraction (what an observer sees)
 *   hours     decimal local civil clock time, 0..24 (15.5 = 15:30)
 */
const RAD = Math.PI / 180;
const sin = (deg) => Math.sin(deg * RAD), cos = (deg) => Math.cos(deg * RAD), tan = (deg) => Math.tan(deg * RAD);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mod = (v, n) => ((v % n) + n) % n;

/** Site defaults (Kibbutz Afikim) — callers normally pass PLAN.meta values. */
export const DEFAULT_SITE = { latitude: 32.68, longitude: 35.58, timeZone: 'Asia/Jerusalem' };
const SUNRISE_ELEVATION = -0.833;                    // centre of the disc when its upper limb touches the horizon (refraction + radius)
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** [year, month, day] of a 'YYYY-MM-DD' string (or a Date, read in UTC); today (UTC) when it cannot be parsed. */
export function parseDate(date) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(typeof date === 'string' ? date : '');
  if (m) return [+m[1], clamp(+m[2], 1, 12), clamp(+m[3], 1, 31)];
  const d = date instanceof Date && !Number.isNaN(+date) ? date : new Date();
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/** Today's calendar date at the site as 'YYYY-MM-DD'. */
export function todayAt(timeZone = DEFAULT_SITE.timeZone, now = new Date()) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
    if (p.year && p.month && p.day) return `${p.year}-${p.month}-${p.day}`;
  } catch (e) { /* unknown zone / no Intl → fall through */ }
  const d = new Date(+now + 2 * 3600e3);
  return d.toISOString().slice(0, 10);
}

/** UTC milliseconds of the n-th last `weekday` (0 = Sunday) of a month at `hour` UTC. */
function lastWeekday(year, month, weekday, back, hourUtc) {
  const last = new Date(Date.UTC(year, month, 0));                      // last day of `month` (1-based)
  const day = last.getUTCDate() - mod(last.getUTCDay() - weekday, 7) - back;
  return Date.UTC(year, month - 1, day, hourUtc);
}

/**
 * Pure-maths UTC offset (hours) used when Intl has no time-zone data.
 * Israel (law of 2013): summer time from the Friday before the last Sunday of March, 02:00, to the last Sunday of
 * October, 02:00 → UTC+3, otherwise UTC+2. Any other zone: the nearest whole hour for the longitude.
 */
export function fallbackUtcOffset(utcMs, timeZone = DEFAULT_SITE.timeZone, longitude = DEFAULT_SITE.longitude) {
  if (!/Jerusalem|Tel_Aviv|Israel/i.test(String(timeZone))) return Math.round(longitude / 15);
  const year = new Date(utcMs).getUTCFullYear();
  const start = lastWeekday(year, 3, 0, 2, 0);                          // Friday 02:00 IST = 00:00 UTC
  const end = lastWeekday(year, 10, 0, 0, -1);                          // Sunday 02:00 IDT = Saturday 23:00 UTC
  return utcMs >= start && utcMs < end ? 3 : 2;
}

const _formatters = new Map();
/** Civil UTC offset (hours, east positive) of a time zone at an instant; daylight-saving time included. */
export function utcOffsetAt(utcMs, timeZone = DEFAULT_SITE.timeZone, longitude = DEFAULT_SITE.longitude) {
  try {
    if (!_formatters.has(timeZone)) _formatters.set(timeZone, new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }));
    const part = _formatters.get(timeZone).formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName');
    const m = part && /(?:GMT|UTC)(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/.exec(part.value);
    if (m) return m[1] ? (m[1] === '-' ? -1 : 1) * (+m[2] + (+m[3] || 0) / 60) : 0;
  } catch (e) { /* unknown zone / no Intl → fall through */ }
  return fallbackUtcOffset(utcMs, timeZone, longitude);
}

/** UTC offset in force at a local civil date + clock hour (two passes, so the hours around a DST switch are right). */
function offsetForLocal(y, mo, d, hours, timeZone, longitude) {
  const local = Date.UTC(y, mo - 1, d) + hours * 3600e3;
  const guess = utcOffsetAt(local - Math.round(longitude / 15) * 3600e3, timeZone, longitude);
  return utcOffsetAt(local - guess * 3600e3, timeZone, longitude);
}

/** Declination (°) and equation of time (minutes) at an instant (UTC ms). */
export function solarCoordinates(utcMs) {
  const T = (utcMs / 86400e3 + 2440587.5 - 2451545) / 36525;           // Julian centuries since J2000.0
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + sin(2 * M) * (0.019993 - 0.000101 * T) + sin(3 * M) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * sin(omega);               // apparent longitude
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * cos(omega);
  const declination = Math.asin(sin(eps) * sin(lambda)) / RAD;
  const y = tan(eps / 2) ** 2;
  const eot = 4 / RAD * (y * sin(2 * L0) - 2 * e * sin(M) + 4 * e * y * sin(M) * cos(2 * L0) - 0.5 * y * y * sin(4 * L0) - 1.25 * e * e * sin(2 * M));
  return { declination, eot };
}

/** Atmospheric refraction (°) for a geometric elevation (NOAA approximation). */
function refraction(elevation) {
  if (elevation > 85) return 0;
  const t = tan(elevation);
  if (elevation > 5) return (58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5) / 3600;
  if (elevation > -0.575) return (1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)))) / 3600;
  return -20.774 / t / 3600;
}

/**
 * Position of the sun.
 * @param {{ date?: string, hours?: number, latitude?: number, longitude?: number, timeZone?: string }} o
 *        date 'YYYY-MM-DD' (civil date at the site), hours = decimal local clock time
 * @returns {{ azimuth: number, elevation: number, declination: number, eot: number, utcOffset: number, hourAngle: number }}
 *          azimuth ° clockwise from true north; elevation ° (apparent); eot minutes; utcOffset hours
 */
export function sunPosition({ date, hours = 12, latitude = DEFAULT_SITE.latitude, longitude = DEFAULT_SITE.longitude, timeZone = DEFAULT_SITE.timeZone } = {}) {
  const [y, mo, d] = parseDate(date);
  const h = Number.isFinite(+hours) ? +hours : 12;
  const utcOffset = offsetForLocal(y, mo, d, h, timeZone, longitude);
  const { declination, eot } = solarCoordinates(Date.UTC(y, mo - 1, d) + (h - utcOffset) * 3600e3);
  const solarMinutes = mod(h * 60 + eot + 4 * longitude - 60 * utcOffset, 1440);    // true solar time
  const hourAngle = solarMinutes / 4 - 180;                                         // ° west of the meridian
  const cosZenith = clamp(sin(latitude) * sin(declination) + cos(latitude) * cos(declination) * cos(hourAngle), -1, 1);
  const geometric = 90 - Math.acos(cosZenith) / RAD;
  const azimuth = mod(Math.atan2(sin(hourAngle), cos(hourAngle) * sin(latitude) - tan(declination) * cos(latitude)) / RAD + 180, 360);
  return { azimuth, elevation: geometric + refraction(geometric), declination, eot, utcOffset, hourAngle };
}

/**
 * Sunrise, sunset and solar noon as decimal local clock hours (civil time of the site, DST included).
 * `sunrise` / `sunset` are null on days without one (polar day / night); `dayLength` is in hours.
 * @param {string|object} date 'YYYY-MM-DD', or one options object { date, latitude, longitude, timeZone }
 * @param {{ latitude?: number, longitude?: number, timeZone?: string }} [site]
 */
export function sunTimes(date, site = {}) {
  const o = date && typeof date === 'object' && !(date instanceof Date) ? date : { ...site, date };
  const { latitude = DEFAULT_SITE.latitude, longitude = DEFAULT_SITE.longitude, timeZone = DEFAULT_SITE.timeZone } = o;
  const [y, mo, d] = parseDate(o.date);
  const day0 = Date.UTC(y, mo - 1, d);
  /** Local clock hour of an event at hour angle `ha(declination)` — iterated, since declination / EoT drift during the day. */
  const solve = (sign) => {
    let t = 12 + sign * 6;                                               // first guess (local clock hours)
    for (let i = 0; i < 4; i++) {
      const offset = offsetForLocal(y, mo, d, t, timeZone, longitude);
      const { declination, eot } = solarCoordinates(day0 + (t - offset) * 3600e3);
      let ha = 0;
      if (sign) {
        const c = (sin(SUNRISE_ELEVATION) - sin(latitude) * sin(declination)) / (cos(latitude) * cos(declination));
        if (c < -1 || c > 1) return null;
        ha = sign * Math.acos(c) / RAD;
      }
      t = (720 + 4 * ha - 4 * longitude - eot) / 60 + offset;
    }
    return t;
  };
  const sunrise = solve(-1), sunset = solve(1), solarNoon = solve(0);
  const up = sunPosition({ date: o.date, hours: solarNoon, latitude, longitude, timeZone }).elevation > SUNRISE_ELEVATION;
  return { sunrise, sunset, solarNoon, dayLength: sunrise != null && sunset != null ? sunset - sunrise : up ? 24 : 0 };
}

/**
 * Unit vector pointing FROM the scene TOWARDS the sun, in world space (X = plan +x = drawing right, Y = up,
 * Z = plan +y = drawing down).
 * `northAngle` = clockwise degrees from the drawing's "up" (plan −y, world −Z) to true north, so a compass bearing b
 * lies at (northAngle + b) clockwise from world −Z:  X = sin, Z = −cos.
 * @returns {[number, number, number]}
 */
export function sunDirectionWorld(azimuth, elevation, northAngle = 0) {
  const th = (northAngle + azimuth) * RAD, el = elevation * RAD;
  return [Math.sin(th) * Math.cos(el), Math.sin(el), -Math.cos(th) * Math.cos(el)];
}

/** Eight-point compass name of a bearing: 225 → 'SW'. */
export const compassPoint = (azimuth) => COMPASS[Math.round(mod(azimuth, 360) / 45) % 8];

/** Decimal hours → 'HH:MM' (null → '—'). */
export function formatClock(hours) {
  if (hours == null || !Number.isFinite(hours)) return '—';
  const m = Math.round(mod(hours, 24) * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

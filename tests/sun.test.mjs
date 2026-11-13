// Solar ephemeris checks for house 98, Kibbutz Afikim (32.68° N, 35.58° E, Asia/Jerusalem) — plain node, no dependencies.
import { PLAN } from '../src/core/plan.js';
import { sunPosition, sunTimes, sunDirectionWorld, fallbackUtcOffset, utcOffsetAt, compassPoint, formatClock, todayAt } from '../src/view3d/sun.js';

const { latitude, longitude, timeZone, northAngle } = PLAN.meta;
const site = { latitude, longitude, timeZone };
let ok = true;
const check = (name, pass, detail = '') => { if (!pass) ok = false; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`); };
const near = (name, value, expected, tol, unit = '°') => check(name, Math.abs(value - expected) <= tol, `${value.toFixed(2)}${unit} (expected ${expected}${unit} ± ${tol})`);
const clock = (text) => { const [h, m] = text.split(':').map(Number); return h + m / 60; };
const nearClock = (name, value, expected, tolMin = 6) => check(name, Math.abs(value - clock(expected)) * 60 <= tolMin, `${formatClock(value)} (published ≈ ${expected} ± ${tolMin} min)`);
const at = (date, hours) => sunPosition({ date, hours, ...site });
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ── civil time: UTC offset incl. daylight-saving time, Intl and the pure-maths fallback must agree ──
for (const [date, expected] of [['2026-06-21', 3], ['2026-12-21', 2], ['2026-03-20', 2], ['2026-03-28', 3], ['2026-10-24', 3], ['2026-10-26', 2]]) {
  const noonUtc = Date.parse(date + 'T10:00:00Z');
  check(`UTC offset ${date}`, at(date, 12).utcOffset === expected && fallbackUtcOffset(noonUtc, timeZone, longitude) === expected && utcOffsetAt(noonUtc, timeZone, longitude) === expected,
    `Intl ${utcOffsetAt(noonUtc, timeZone, longitude)}, fallback ${fallbackUtcOffset(noonUtc, timeZone, longitude)}, expected +${expected}`);
}

// ── solar noon: due south, elevation = 90° − latitude ± obliquity ──
const june = sunTimes('2026-06-21', site), december = sunTimes('2026-12-21', site), equinox = sunTimes('2026-03-20', site);
const juneNoon = at('2026-06-21', june.solarNoon), decNoon = at('2026-12-21', december.solarNoon);
near('June solstice noon elevation', juneNoon.elevation, 80.8, 0.5);
near('June solstice noon azimuth (due south)', juneNoon.azimuth, 180, 0.5);
near('June solstice declination', juneNoon.declination, 23.44, 0.05);
near('December solstice noon elevation', decNoon.elevation, 33.9, 0.5);
near('December solstice noon azimuth (due south)', decNoon.azimuth, 180, 0.5);
near('December solstice declination', decNoon.declination, -23.44, 0.05);
near('Equinox noon elevation (90 − latitude)', at('2026-03-20', equinox.solarNoon).elevation, 90 - latitude, 0.5);
nearClock('June solar noon (clock)', june.solarNoon, '12:40', 3);
nearClock('December solar noon (clock)', december.solarNoon, '11:36', 3);

// ── sunrise / sunset against published values for Afikim (local civil time) ──
nearClock('Sunrise 21 June', june.sunrise, '05:33');
nearClock('Sunset 21 June', june.sunset, '19:47');
nearClock('Sunrise 21 December', december.sunrise, '06:33');
nearClock('Sunset 21 December', december.sunset, '16:39');
nearClock('Sunrise 20 March', equinox.sunrise, '05:43');
nearClock('Sunset 20 March', equinox.sunset, '17:50');
near('Day length 21 June', june.dayLength, 14.3, 0.1, ' h');
near('Day length 21 December', december.dayLength, 10.0, 0.1, ' h');
near('Elevation at sunrise is the horizon', at('2026-06-21', june.sunrise).elevation, -0.26, 0.3);

// ── equinox: rises due east, sets due west ──
near('Equinox sunrise azimuth (due east)', at('2026-03-20', equinox.sunrise).azimuth, 90, 0.5);
// by sunset the declination has crossed zero and refraction lifts the disc, so it sets a touch north of west
near('Equinox sunset azimuth (due west)', at('2026-03-20', equinox.sunset).azimuth, 270, 1);
// solstices: north of east in summer, south of east in winter (cos A = sin δ / cos φ → ±28.2° + refraction)
near('June sunrise azimuth', at('2026-06-21', june.sunrise).azimuth, 61.3, 1);
near('December sunrise azimuth', at('2026-12-21', december.sunrise).azimuth, 117.6, 1);

// ── morning east, afternoon west, every season ──
for (const date of ['2026-03-20', '2026-06-21', '2026-09-23', '2026-12-21']) {
  const am = at(date, 9), pm = at(date, 15.5);
  check(`${date} 09:00 sun in the east, 15:30 in the west`, am.azimuth > 45 && am.azimuth < 180 && pm.azimuth > 180 && pm.azimuth < 315 && am.elevation > 0 && pm.elevation > 0,
    `09:00 az ${am.azimuth.toFixed(1)}° ${compassPoint(am.azimuth)}, 15:30 az ${pm.azimuth.toFixed(1)}° ${compassPoint(pm.azimuth)}`);
}
check('Night: sun below the horizon at 23:00', at('2026-06-21', 23).elevation < -10);

// ── world mapping: X = plan east (drawing right), Z = plan south (drawing down), Y up; north is `northAngle` cw from −Z ──
const n = (northAngle * Math.PI) / 180;
const expectDir = (name, got, want) => check(name, got.every((v, i) => Math.abs(v - want[i]) < 1e-9), `[${got.map((v) => v.toFixed(4)).join(', ')}]`);
expectDir('Bearing 0° (true north) → world', sunDirectionWorld(0, 0, northAngle), [Math.sin(n), 0, -Math.cos(n)]);
expectDir('Bearing 90° (true east) → world', sunDirectionWorld(90, 0, northAngle), [Math.cos(n), 0, Math.sin(n)]);
expectDir('Zenith → +Y', sunDirectionWorld(123, 90, northAngle).map((v) => Math.round(v * 1e12) / 1e12), [0, 1, 0]);
check('northAngle −7°: true north leans to drawing-left (world −X) and up the sheet (world −Z)', sunDirectionWorld(0, 0, northAngle)[0] < 0 && sunDirectionWorld(0, 0, northAngle)[2] < -0.99);
expectDir('northAngle 0: north = −Z, east = +X', [...sunDirectionWorld(0, 0, 0), ...sunDirectionWorld(90, 0, 0)].map((v) => Math.round(v * 1e12) / 1e12), [0, 0, -1, 1, 0, 0]);
check('Direction is a unit vector', Math.abs(Math.hypot(...sunDirectionWorld(217, 31, northAngle)) - 1) < 1e-12);

// ── this house: which façades the sun shines on (outward normals in world space) ──
const FACADE = { west: [-1, 0, 0], east: [1, 0, 0], north: [0, 0, -1], south: [0, 0, 1] };
const terraceDoor = PLAN.openings.find((o) => o.id === 'door-terrace');
check('Terrace sliding door is on the west façade', terraceDoor && terraceDoor.outside === 'w');
const lit = (date, hours, side) => { const p = at(date, hours); return p.elevation > 0 ? dot(sunDirectionWorld(p.azimuth, p.elevation, northAngle), FACADE[side]) : 0; };
for (const date of ['2026-06-21', '2026-12-21', '2026-03-20']) {
  check(`${date} 15:30 sun on the WEST façade (terrace side), not on the east`, lit(date, 15.5, 'west') > 0.3 && lit(date, 15.5, 'east') < 0, `cos incidence west ${lit(date, 15.5, 'west').toFixed(2)}`);
  check(`${date} 08:30 sun on the EAST façade (bedroom windows), not on the west`, lit(date, 8.5, 'east') > 0.3 && lit(date, 8.5, 'west') < 0, `cos incidence east ${lit(date, 8.5, 'east').toFixed(2)}`);
}
check('Solar noon: sun on the south façade', lit('2026-12-21', december.solarNoon, 'south') > 0.8 && lit('2026-06-21', june.solarNoon, 'south') > 0.1);
check('North façade: no direct sun at midday', lit('2026-06-21', 12.5, 'north') < 0 && lit('2026-12-21', 12, 'north') < 0);
check('North façade: direct sun only early / late in summer', lit('2026-06-21', 6.5, 'north') > 0 && lit('2026-06-21', 19, 'north') > 0 && lit('2026-12-21', 7.5, 'north') <= 0 && lit('2026-12-21', 16, 'north') <= 0);

check('todayAt() gives YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(todayAt(timeZone)) && todayAt(timeZone, new Date('2026-06-21T22:30:00Z')) === '2026-06-22');
check('Bad input degrades gracefully', Number.isFinite(sunPosition({ date: 'nonsense', hours: NaN }).elevation) && Number.isFinite(sunTimes(undefined).solarNoon));

console.log(`\n21 Jun  rise ${formatClock(june.sunrise)}  noon ${formatClock(june.solarNoon)} (${juneNoon.elevation.toFixed(1)}°)  set ${formatClock(june.sunset)}`);
console.log(`20 Mar  rise ${formatClock(equinox.sunrise)}  noon ${formatClock(equinox.solarNoon)}  set ${formatClock(equinox.sunset)}`);
console.log(`21 Dec  rise ${formatClock(december.sunrise)}  noon ${formatClock(december.solarNoon)} (${decNoon.elevation.toFixed(1)}°)  set ${formatClock(december.sunset)}`);
console.log(ok ? 'SUN OK' : 'SUN HAS ERRORS');
process.exit(ok ? 0 : 1);

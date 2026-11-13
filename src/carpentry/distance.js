/**
 * Carpenters by distance from the house. The list itself lives in src/carpentry/carpenters.js (researched data):
 *   { id, name, nameHe?, city, region, lat, lon, specialties: [], website, phone?, email?, address?, source: { url, checkedAt }, notes? }
 */
import { PLAN } from '../core/plan.js';

const R = 6371.0088; // mean Earth radius, km
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * New array of the carpenters with `distanceKm` (1 decimal; null without coordinates), nearest first; entries without
 * coordinates last (by name). `from` defaults to the house (PLAN.meta.latitude / longitude).
 */
export function sortCarpentersByDistance(list, from = { latitude: PLAN.meta.latitude, longitude: PLAN.meta.longitude }) {
  const lat0 = +from.latitude, lon0 = +from.longitude;
  return (Array.isArray(list) ? list : []).map((c) => {
    const ok = c && Number.isFinite(+c.lat) && Number.isFinite(+c.lon) && c.lat !== null && c.lon !== null;
    return { ...c, distanceKm: ok ? Math.round(haversineKm(lat0, lon0, +c.lat, +c.lon) * 10) / 10 : null };
  }).sort((a, b) => (a.distanceKm == null) - (b.distanceKm == null) || (a.distanceKm ?? 0) - (b.distanceKm ?? 0) || String(a.name).localeCompare(String(b.name)));
}

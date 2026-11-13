import { HIGHLIGHTS } from '../../mars-atlas-src/data/highlights.js';
import { METERS_PER_PIXEL } from '../services/coordinates.js';
import { calculateRouteMetrics } from '../services/pathSolver.js';

const MARS_R_KM = 3389.5;
export const EVA_RANGE_KM = 12;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversineKm(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat);
  const dφ = p2 - p1, dλ = rad(b.lon - a.lon);
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dλ / 2) ** 2;
  return 2 * MARS_R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a, b) {
  const φ1 = rad(a.lat), φ2 = rad(b.lat), λ = rad(b.lon - a.lon);
  const y = Math.sin(λ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function offsetKm(pt, bearing, km) {
  const δ = km / MARS_R_KM, θ = rad(bearing);
  const φ1 = rad(pt.lat), λ1 = rad(pt.lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: deg(φ2), lon: ((deg(λ2) + 540) % 360) - 180 };
}

export function interpolate(a, b, f) {
  const d = haversineKm(a, b) / MARS_R_KM;
  if (d < 1e-6) return { lat: a.lat, lon: a.lon };
  const φ1 = rad(a.lat), λ1 = rad(a.lon), φ2 = rad(b.lat), λ2 = rad(b.lon);
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: deg(Math.atan2(y, x)) };
}

function sampleGeodesic(from, to, n = 96) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(interpolate(from, to, i / n));
  return out;
}

const SEVERE = new Set(['volcano', 'canyon', 'chaos']);
const SCIENCE = new Set(['canyon', 'chaos', 'crater', 'basin']);

function nearestFeature(pt, cats) {
  let best = null, bestD = Infinity;
  for (const f of HIGHLIGHTS) {
    if (cats && !cats.has(f.category)) continue;
    const d = haversineKm(pt, f);
    const r = Math.max(40, (f.diameter || 80) * 0.45);
    if (d < r && d < bestD) { best = { ...f, distKm: d, radiusKm: r }; bestD = d; }
  }
  return best;
}

function skirtPoint(from, to, feature) {
  const brg = bearingDeg(from, to);
  const left = offsetKm(feature, brg - 90, feature.radiusKm + 80);
  const right = offsetKm(feature, brg + 90, feature.radiusKm + 80);
  const mid = interpolate(from, to, 0.5);
  return haversineKm(mid, left) < haversineKm(mid, right) ? left : right;
}

function waypointsForMode(from, dest, mode) {
  const straight = sampleGeodesic(from, dest, 48);
  const hits = [];
  const seen = new Set();
  for (const p of straight) {
    const f = nearestFeature(p, SEVERE);
    if (f && !seen.has(f.name)) { seen.add(f.name); hits.push(f); }
  }
  if (mode === 'direct') return [from, dest];
  if (mode === 'science') {
    let via = null, bestOff = Infinity;
    const total = Math.max(1, haversineKm(from, dest));
    for (const f of HIGHLIGHTS) {
      if (!SCIENCE.has(f.category)) continue;
      const d0 = haversineKm(from, f), d1 = haversineKm(f, dest);
      const extra = d0 + d1 - total;
      if (extra > 0 && extra < total * 0.45 && extra < bestOff && d0 > 80 && d1 > 80) {
        bestOff = extra; via = f;
      }
    }
    return via ? [from, via, dest] : [from, dest];
  }
  const wps = [from];
  hits.forEach((f) => wps.push({ ...skirtPoint(from, dest, f), name: `Skirt ${f.name}`, via: true }));
  wps.push(dest);
  return wps;
}

function elevationGuess(pt, startElev, dest) {
  const f = nearestFeature(pt);
  if (f?.category === 'volcano') return Math.round((startElev || -2000) + 8000 * Math.exp(-((f.distKm / f.radiusKm) ** 2)));
  if (f?.category === 'canyon') return Math.round((startElev || -2000) - 4000 * Math.exp(-((f.distKm / f.radiusKm) ** 2)));
  if (f?.category === 'polar') return Math.round((startElev || -2000) + 1200);
  const t = dest && haversineKm(pt, dest) < 1 ? 1 : 0;
  return Math.round((startElev || -2500) * (1 - t * 0.1));
}

function slopeGuess(a, b) {
  const km = Math.max(0.2, haversineKm(a, b));
  const ang = Math.atan(Math.abs((b.elevation - a.elevation) / (km * 1000))) * (180 / Math.PI);
  return Math.min(45, Math.round(ang * 10) / 10);
}

function bandOf(p) {
  if (p.isHazard) return 'hazard';
  if (p.zone) return 'caution';
  return 'safe';
}

/** Geodesic (or skirted) route on the Mars ellipsoid, with feature-based hazards. */
export function generatePlanetRoute(from, dest, mode = 'safe', startElev = -2500) {
  const origin = { lat: from.lat, lon: from.lon, name: 'You' };
  const end = { lat: dest.lat, lon: dest.lon, name: dest.name };
  const wps = waypointsForMode(origin, end, mode);
  const raw = [];
  for (let i = 0; i < wps.length - 1; i++) raw.push(...sampleGeodesic(wps[i], wps[i + 1], 40).slice(i ? 1 : 0));

  let cumM = 0;
  const points = raw.map((p, i) => {
    const elevation = elevationGuess(p, startElev, end);
    const prev = raw[i - 1];
    const stepKm = prev ? haversineKm(prev, p) : 0;
    cumM += stepKm * 1000;
    const hit = nearestFeature(p, SEVERE);
    const zone = !!nearestFeature(p);
    const isHazard = !!(hit && (hit.category === 'canyon' || hit.category === 'volcano' || hit.distKm < hit.radiusKm * 0.55));
    return {
      ...p,
      elevation,
      slope: 0,
      isHazard,
      zone,
      reported: false,
      band: isHazard ? 'hazard' : zone ? 'caution' : 'safe',
      hazardName: hit?.name,
      hazardCategory: hit?.category,
      d: cumM / METERS_PER_PIXEL,
      x: 20 + (cumM / Math.max(1, haversineKm(origin, end) * 1000)) * 760,
      y: 300,
      planetary: true
    };
  });
  const total = points[points.length - 1]?.d || 1;
  points.forEach((p) => { p.t = p.d / total; p.band = bandOf(p); });
  for (let i = 1; i < points.length; i++) points[i].slope = slopeGuess(points[i - 1], points[i]);

  const km = haversineKm(origin, end);
  const metrics = calculateRouteMetrics(points);
  metrics.distanceKm = +((points[points.length - 1]?.d || 0) * METERS_PER_PIXEL / 1000).toFixed(1);
  if (!metrics.distanceKm) metrics.distanceKm = +km.toFixed(1);
  const roverKmh = metrics.distanceKm > EVA_RANGE_KM ? 35 : Math.max(1.2, 3.2 - (metrics.avgSlope || 0) * 0.12);
  const min = Math.round((metrics.distanceKm / roverKmh) * 60);
  metrics.estimatedTimeMin = min;
  metrics.estimatedTimeFormatted = min > 5999 ? `${Math.round(min / 1440)} sols` : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;

  const stations = [
    { index: 0, wp: { id: 'you', name: 'You', type: 'crew', ...origin } },
    { index: points.length - 1, wp: { id: dest.id || 'dest', name: dest.name, type: dest.type || 'place', ...end } }
  ];

  return { points, stations, metrics, planetary: true, alerts: planetAlerts({ points, metrics, dest, km: metrics.distanceKm }) };
}

export function hazardCopy(p) {
  const hot = !!(p.isHazard || p.band === 'hazard' || p.hazard);
  const kind = p.hazardCategory === 'canyon' ? 'canyon wall / chasma'
    : p.hazardCategory === 'volcano' ? 'volcanic escarpment'
    : p.hazardCategory === 'chaos' ? 'collapsed chaos terrain'
    : 'mapped hazard terrain';
  return {
    name: p.hazardName,
    category: p.hazardCategory,
    lat: p.lat,
    lon: p.lon,
    level: hot ? 'fail' : 'warn',
    label: hot ? `Hazard: ${p.hazardName}` : `Caution: ${p.hazardName}`,
    detail: hot
      ? `Route transits ${kind} at ${p.hazardName}. Slow the traverse, check slope, and keep a return margin.`
      : `${p.hazardName} lies near this traverse. Expect rough terrain.`
  };
}

export function hazardsAlong(points = []) {
  const seen = new Set();
  const out = [];
  for (const p of points) {
    if (!p.hazardName || seen.has(p.hazardName)) continue;
    if (!p.isHazard && p.band === 'safe' && !p.hazard) continue;
    seen.add(p.hazardName);
    out.push(hazardCopy(p));
  }
  return out;
}

export function planetAlerts({ points, metrics, dest, km }) {
  const alerts = [];
  if (km > EVA_RANGE_KM) alerts.push({ id: 'range', level: 'fail', label: 'Beyond EVA range', detail: `${km.toFixed(0)} km from your position. Suited walking is limited to ~${EVA_RANGE_KM} km. This is an orbital traverse preview, not a walk.` });
  const hits = [];
  const seen = new Set();
  points.forEach((p) => {
    if (p.hazardName && !seen.has(p.hazardName)) { seen.add(p.hazardName); hits.push(p); }
  });
  hits.filter((p) => p.isHazard).forEach((p) => {
    const kind = p.hazardCategory === 'canyon' ? 'canyon wall / chasma' : p.hazardCategory === 'volcano' ? 'volcanic escarpment' : 'collapsed chaos terrain';
    alerts.push({ id: `hz-${p.hazardName}`, level: 'fail', label: `Hazard: ${p.hazardName}`, detail: `Route transits ${kind}. Safest mode skirts the edifice; Fastest does not.` });
  });
  hits.filter((p) => !p.isHazard && p.zone).forEach((p) => {
    alerts.push({ id: `zn-${p.hazardName}`, level: 'warn', label: `Caution: ${p.hazardName}`, detail: 'Mapped planetary feature near the traverse. Expect rough terrain.' });
  });
  if (metrics.maxSlope > 15) alerts.push({ id: 'slope', level: 'fail', label: 'Slope exceeds 15°', detail: `Peak modelled slope ${metrics.maxSlope.toFixed(1)}° on this path.` });
  else if (metrics.maxSlope > 8) alerts.push({ id: 'slope', level: 'warn', label: 'Steep sections ahead', detail: `Peak modelled slope ${metrics.maxSlope.toFixed(1)}°.` });
  if (km > 500) alerts.push({ id: 'comms', level: 'warn', label: 'Habitat link will drop', detail: `A walk of this length leaves line-of-sight to ${dest?.name || 'the target'} only from orbit or a relay.` });
  if (!alerts.length) alerts.push({ id: 'ok', level: 'pass', label: 'Route clear of mapped mega-hazards', detail: 'Local EVA checks still apply once you are on site.' });
  return alerts;
}

export function isPlanetaryDest(from, dest) {
  if (!from || !dest || dest.lat == null || dest.lon == null) return false;
  if (dest.planetary) return true;
  return haversineKm(from, dest) > 8;
}

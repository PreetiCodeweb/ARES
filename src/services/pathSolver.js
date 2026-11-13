// Slope- and hazard-weighted A* traverse solver (EVA walking model).
// Grid is the 800x600 tactical frame the terrain model is defined on.
import { getElevationAtPoint, getSlopeAtPoint, HAZARD_ZONES } from '../data/terrainElevationData.js';
import { SCIENCE_POIS } from '../data/sciencePoisData.js';
import { pixelsToKm } from './coordinates.js';

export const SLOPE_LIMIT = 15; // deg, EVA rollover / slip threshold
const W = 800, H = 600, CELL = 16, NX = W / CELL, NY = Math.ceil(H / CELL);
const EXEMPT = 26; // px: crew-approved stations may sit inside advisory zones
const grids = {};

const inPoly = (poly, x, y) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
export const inMappedZone = (id, x, y) => (HAZARD_ZONES[id] || []).some((z) => inPoly(z.points, x, y));
export const inReported = (hz, x, y, pad = 0) => hz.some((h) => Math.hypot(x - h.x, y - h.y) < h.r + pad);

export function gridFor(id) {
  if (grids[id]) return grids[id];
  const slope = new Float32Array(NX * NY), zone = new Uint8Array(NX * NY);
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const x = Math.min(W - 1, i * CELL + CELL / 2), y = Math.min(H - 1, j * CELL + CELL / 2);
      slope[j * NX + i] = getSlopeAtPoint(id, x, y);
      zone[j * NX + i] = inMappedZone(id, x, y) ? 1 : 0;
    }
  return (grids[id] = { slope, zone });
}
const cellOf = (x, y) => [Math.min(NX - 1, Math.max(0, (x / CELL) | 0)), Math.min(NY - 1, Math.max(0, (y / CELL) | 0))];

// minimal binary heap keyed on f
class Heap {
  constructor() { this.a = []; }
  push(n, f) { const a = this.a; a.push([n, f]); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][1] <= a[i][1]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][1] < a[m][1]) m = l; if (r < a.length && a[r][1] < a[m][1]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top[0]; }
  get size() { return this.a.length; }
}

function astar(id, A, B, ctx) {
  const { slope, zone } = gridFor(id);
  const [ai, aj] = cellOf(A.x, A.y), [bi, bj] = cellOf(B.x, B.y);
  const start = aj * NX + ai, goal = bj * NX + bi;
  const g = new Float32Array(NX * NY).fill(Infinity), from = new Int32Array(NX * NY).fill(-1);
  const open = new Heap();
  g[start] = 0; open.push(start, 0);
  const near = (x, y) => Math.hypot(x - A.x, y - A.y) < EXEMPT || Math.hypot(x - B.x, y - B.y) < EXEMPT;
  const cellCost = (n) => {
    const x = (n % NX) * CELL + CELL / 2, y = ((n / NX) | 0) * CELL + CELL / 2, s = slope[n];
    let c = 1 + (s / 7) ** 2 + (s > SLOPE_LIMIT ? (s - SLOPE_LIMIT) * 40 : 0);
    if (zone[n] && !near(x, y)) c += 400;
    if (inReported(ctx.hazards, x, y, 14)) c += 900;
    if (ctx.science && ctx.pois.some((p) => Math.hypot(x - p.x, y - p.y) < 34)) c *= 0.6;
    return c;
  };
  while (open.size) {
    const n = open.pop();
    if (n === goal) break;
    const ni = n % NX, nj = (n / NX) | 0;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ni + di, j = nj + dj;
        if (i < 0 || j < 0 || i >= NX || j >= NY) continue;
        const m = j * NX + i, step = di && dj ? 1.414 : 1;
        const cost = g[n] + step * CELL * (cellCost(n) + cellCost(m)) / 2;
        if (cost < g[m]) { g[m] = cost; from[m] = n; open.push(m, cost + Math.hypot(i - bi, j - bj) * CELL); }
      }
  }
  const cells = [];
  for (let n = goal; n !== -1; n = from[n]) { cells.push({ x: (n % NX) * CELL + CELL / 2, y: ((n / NX) | 0) * CELL + CELL / 2 }); if (n === start) break; }
  cells.reverse();
  const pts = [{ x: A.x, y: A.y }, ...cells.slice(1, -1), { x: B.x, y: B.y }];
  // line-of-sight smoothing so the route is not a staircase
  const free = (p, q) => {
    const { slope: sl, zone: zn } = gridFor(id), d = Math.hypot(q.x - p.x, q.y - p.y);
    for (let s = 0; s <= d; s += 6) {
      const x = p.x + ((q.x - p.x) * s) / d, y = p.y + ((q.y - p.y) * s) / d, [ci, cj] = cellOf(x, y), n = cj * NX + ci;
      if (sl[n] > SLOPE_LIMIT || inReported(ctx.hazards, x, y, 14) || (zn[n] && !near(x, y))) return false;
    }
    return true;
  };
  const out = [pts[0]]; let i = 0;
  while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !free(pts[i], pts[j])) j--; out.push(pts[j]); i = j; }
  return out;
}

// Science Max: add unvisited POIs that sit close to a leg of the route
function withScienceVias(wps, pois) {
  const out = [];
  wps.forEach((a, k) => {
    out.push(a);
    const b = wps[k + 1]; if (!b) return;
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    pois.map((p) => { const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; return { p, t, off: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) }; })
      .filter((c) => c.t > 0.1 && c.t < 0.9 && c.off < 90 && !wps.some((w) => Math.hypot(w.x - c.p.x, w.y - c.p.y) < 30))
      .sort((m, n) => m.t - n.t).slice(0, 2).forEach((c) => out.push({ x: c.p.x, y: c.p.y, via: true, name: c.p.name }));
  });
  return out;
}

/** @returns {{points: object[], stations: {index:number,wp:object}[]}} */
export function generateDensePath(waypoints, missionId, mode = 'safe', hazards = []) {
  if (!waypoints || waypoints.length < 2) return { points: [], stations: [] };
  const pois = SCIENCE_POIS.filter((p) => p.missionId === missionId).map((p) => ({ ...p.mapPos, name: p.name }));
  const ctx = { hazards, science: mode === 'science', pois };
  const stops = mode === 'science' ? withScienceVias(waypoints, pois) : waypoints;
  let poly = [stops[0]]; const stationAt = [0];
  for (let k = 0; k < stops.length - 1; k++) {
    const leg = mode === 'direct' ? [stops[k], stops[k + 1]] : astar(missionId, stops[k], stops[k + 1], ctx);
    poly.push(...leg.slice(1)); stationAt.push(poly.length - 1);
  }
  // densify to ~8px samples, keeping the station vertices exactly
  const points = [], stations = []; let cum = 0;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k - 1], b = poly[k];
    if (a) {
      const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.round(d / 8));
      for (let s = 1; s <= n; s++) push(a.x + ((b.x - a.x) * s) / n, a.y + ((b.y - a.y) * s) / n, d / n);
    } else push(b.x, b.y, 0);
    const si = stationAt.indexOf(k);
    if (si !== -1 && stops[si] && !stops[si].via) stations.push({ index: points.length - 1, wp: stops[si] });
  }
  function push(x, y, step) {
    cum += step;
    const elevation = getElevationAtPoint(missionId, x, y), slope = getSlopeAtPoint(missionId, x, y);
    const nearStation = stops.some((w) => Math.hypot(w.x - x, w.y - y) < EXEMPT);
    points.push({ x: Math.round(x), y: Math.round(y), elevation, slope, isHazard: slope > SLOPE_LIMIT, zone: !nearStation && inMappedZone(missionId, x, y), d: cum });
  }
  const total = cum || 1; points.forEach((p) => (p.t = p.d / total));
  return { points, stations };
}

export function calculateRouteMetrics(pts) {
  if (!pts || pts.length < 2) return { distanceKm: 0, elevationGain: 0, elevationLoss: 0, peakElevation: 0, minElevation: 0, avgSlope: 0, maxSlope: 0, estimatedTimeMin: 0, estimatedTimeFormatted: '0h 00m', hazardSegmentsCount: 0, zoneSamples: 0 };
  let gain = 0, loss = 0, sum = 0, max = 0, haz = 0, zone = 0, peak = -Infinity, low = Infinity;
  pts.forEach((p, i) => {
    peak = Math.max(peak, p.elevation); low = Math.min(low, p.elevation); sum += p.slope; max = Math.max(max, p.slope);
    if (p.isHazard) haz++; if (p.zone) zone++;
    if (i) { const dz = p.elevation - pts[i - 1].elevation; dz > 0 ? (gain += dz) : (loss -= dz); }
  });
  const km = pixelsToKm(pts[pts.length - 1].d), avg = +(sum / pts.length).toFixed(1);
  const speed = Math.max(1.2, 3.2 - avg * 0.12), min = Math.round((km / speed) * 60);
  return {
    distanceKm: +km.toFixed(2), elevationGain: Math.round(gain), elevationLoss: Math.round(loss), peakElevation: Math.round(peak), minElevation: Math.round(low),
    avgSlope: avg, maxSlope: max, estimatedTimeMin: min, estimatedTimeFormatted: `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`,
    hazardSegmentsCount: haz, zoneSamples: zone
  };
}

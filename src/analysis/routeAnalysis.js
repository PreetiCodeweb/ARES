import { SLOPE_LIMIT } from '../services/pathSolver.js';
import { pixelsToKm, pixelsToMeters } from '../services/coordinates.js';
import { cardinal, headingBetween } from '../navigation/heading.js';

const band = (slope, zone, reported) => {
  if (reported || slope > SLOPE_LIMIT) return 'hazard';
  if (zone || slope > 8) return 'caution';
  return 'safe';
};

/** Remaining path samples for the "terrain ahead" chart. */
export function terrainAhead(points, idx, lookPx = 160) {
  if (!points.length) return [];
  const start = Math.max(0, Math.min(idx, points.length - 1));
  const origin = points[start].d || 0;
  const out = [];
  for (let i = start; i < points.length; i++) {
    const dd = (points[i].d || 0) - origin;
    if (dd > lookPx) break;
    out.push({
      i,
      km: pixelsToKm(dd),
      m: pixelsToMeters(dd),
      elevation: points[i].elevation,
      slope: points[i].slope,
      zone: !!points[i].zone,
      reported: !!points[i].reported,
      isHazard: !!points[i].isHazard,
      band: band(points[i].slope, points[i].zone, points[i].reported)
    });
  }
  return out;
}

export function nextInstruction(points, idx, heading) {
  if (!points.length) return { text: 'Hold position at habitat', remainingKm: 0, etaMin: 0, caution: null, bearing: heading || 0 };
  const i = Math.max(0, Math.min(idx, points.length - 1));
  const here = points[i];
  const look = points[Math.min(points.length - 1, i + 8)];
  const end = points[points.length - 1];
  const remainingPx = Math.max(0, (end.d || 0) - (here.d || 0));
  const remainingKm = pixelsToKm(remainingPx);
  const bearing = look ? headingBetween(here.x, here.y, look.x, look.y) : heading || 0;
  let nextTurn = 0;
  for (let k = i + 4; k < Math.min(points.length, i + 40); k++) {
    const h = headingBetween(points[k - 1].x, points[k - 1].y, points[k].x, points[k].y);
    let delta = ((h - bearing + 540) % 360) - 180;
    if (Math.abs(delta) > 28) { nextTurn = pixelsToMeters((points[k].d || 0) - (here.d || 0)); break; }
  }
  const distM = Math.max(20, nextTurn || pixelsToMeters(Math.min(remainingPx, 80)));
  const caution = here.isHazard ? 'Hazard underfoot' : here.zone ? 'Mapped hazard zone' : here.slope > 12 ? 'Steep slope ahead' : look?.slope > SLOPE_LIMIT ? 'Terrain caution ahead' : null;
  const text = remainingPx < 12
    ? 'Arriving at destination'
    : `Continue ${Math.round(distM)} m ${cardinal(bearing).toLowerCase()}`;
  return { text, remainingKm, remainingM: pixelsToMeters(remainingPx), bearing, caution };
}

export function classifyPoint(p) {
  return band(p?.slope || 0, p?.zone, p?.reported);
}

/** Compass helpers. Heading 0° is north, clockwise, matching Cesium. */

export function wrapDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

export function headingBetween(ax, ay, bx, by) {
  // Canvas y increases south, so north is -y.
  const deg = (Math.atan2(bx - ax, ay - by) * 180) / Math.PI;
  return wrapDeg(deg);
}

export function cardinal(deg) {
  const d = wrapDeg(deg);
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round(d / 22.5) % 16];
}

export function headingLabel(deg) {
  const d = wrapDeg(deg);
  return `${String(Math.round(d)).padStart(3, '0')}° ${cardinal(d)}`;
}

export function turnToward(current, target, maxDeg) {
  let delta = wrapDeg(target - current);
  if (delta > 180) delta -= 360;
  if (delta > maxDeg) delta = maxDeg;
  if (delta < -maxDeg) delta = -maxDeg;
  return wrapDeg(current + delta);
}

export function offsetByHeading(x, y, heading, pixels) {
  const rad = (heading * Math.PI) / 180;
  return { x: x + Math.sin(rad) * pixels, y: y - Math.cos(rad) * pixels };
}

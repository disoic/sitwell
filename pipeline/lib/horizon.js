// The horizon toward the sunset from a spot: how high the land rises in each direction between
// 230 and 310 degrees, out to 50 km, allowing for the Earth's curve and for the way air bends light
// near the horizon. The first 250 m are left out: bare-earth data has no buildings or trees, and
// sunset spots look across open water there anyway.
'use strict';
const C = require('../../core/core.js');
const { tileXY } = require('./dem.js');

const EARTH = 6371000, BEND = 0.13, EYE = 1.2, NEAR = 250, REACH = 50000;
const STEPS = [];
for (let d = NEAR; d <= REACH;) { STEPS.push(d); d += d < 2000 ? 30 : d < 6000 ? 60 : d < 20000 ? 150 : 300; }
const zoomFor = d => (d <= 6000 ? 12 : 10);   // about 26 m detail close by, 100 m further out

function destination(lat, lon, bearing, d) {
  const b = bearing * Math.PI / 180, r = d / EARTH, la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  const la2 = Math.asin(Math.sin(la) * Math.cos(r) + Math.cos(la) * Math.sin(r) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(r) * Math.cos(la), Math.cos(r) - Math.sin(la) * Math.sin(la2));
  return [la2 * 180 / Math.PI, lo2 * 180 / Math.PI];
}
// Elevation tiles needed for these spots: only the westward sector the rays cross.
function tilesFor(points) {
  const need = new Map();
  const add = (z, p, reach) => {
    const dLat = reach * 0.66 / 110574, dLon = reach / (111320 * Math.cos(p.lat * Math.PI / 180));
    const [x0, y0] = tileXY(p.lat + dLat, p.lon - dLon, z), [x1, y1] = tileXY(p.lat - dLat, p.lon + 0.002, z);
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let y = Math.floor(y0); y <= Math.floor(y1); y++) need.set(z + '/' + x + '/' + y, [z, x, y]);
  };
  for (const p of points) { add(12, p, 6200); add(10, p, REACH + 500); }
  return [...need.values()];
}
// The profile for one spot: one value per bearing, (degrees + 5) x 10 as a whole number 0-255, or null.
function profile(dem, lat, lon) {
  const here = dem.at(lat, lon, 12);
  if (here == null) return null;
  const z0 = Math.max(here, 0) + EYE, out = [];
  for (let b = C.HORIZON.from; b <= C.HORIZON.to; b += C.HORIZON.step) {
    let best = -5, seen = 0;
    for (const d of STEPS) {
      const [la, lo] = destination(lat, lon, b, d), z = dem.at(la, lo, zoomFor(d));
      if (z == null) continue;
      seen++;
      // The sea's surface, not its floor; the Earth's curve, less what the air bends back.
      const a = Math.atan2(Math.max(z, 0) - z0 - d * d / (2 * EARTH) * (1 - BEND), d) * 180 / Math.PI;
      if (a > best) best = a;
    }
    if (!seen) return null;
    out.push(Math.max(0, Math.min(255, Math.round((best + 5) * 10))));
  }
  return out;
}
module.exports = { profile, tilesFor, destination, STEPS };

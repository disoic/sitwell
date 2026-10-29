// Checks the core's spatial indexes against brute force, and the sunset rays on simple shapes.
// Run: node pipeline/test/check-core.js
'use strict';
const C = require('../../core/core.js');
const assert = require('assert');

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

// 1. SegIndex.nearest equals brute force.
{
  const idx = new C.SegIndex(50), segs = [];
  for (let k = 0; k < 3000; k++) {
    const x = rnd() * 4000 - 2000, y = rnd() * 4000 - 2000;
    const len = rnd() < 0.1 ? 600 : 30, a = rnd() * Math.PI * 2;
    const s = [x, y, x + Math.cos(a) * len, y + Math.sin(a) * len];
    segs.push(s);
    idx.add(...s, k);
  }
  for (let q = 0; q < 2000; q++) {
    const px = rnd() * 4400 - 2200, py = rnd() * 4400 - 2200, lim = rnd() < 0.5 ? 250 : 600;
    let best = Infinity;
    for (const s of segs) best = Math.min(best, C.segDist(px, py, ...s));
    const r = idx.nearest(px, py, lim);
    if (best <= lim) assert(r && Math.abs(r.d - best) < 1e-9, `nearest mismatch ${r && r.d} vs ${best}`);
    else assert(r === null, 'found a segment beyond the limit');
  }
  console.log('SegIndex.nearest matches brute force on 2000 queries');
}

// 2. Shape.inside equals plain even-odd over all segments (polygon with a hole, crossing the window).
{
  const proj = C.makeProj({ lat: 47, lon: 8 });
  const toLatLon = (x, y) => [47 + y / proj.ky, 8 + x / proj.kx];
  const ring = (cx, cy, r, n, wobble) => {
    const a = [];
    for (let k = 0; k < n; k++) {
      const t = k / n * Math.PI * 2, rr = r * (1 + wobble * Math.sin(5 * t));
      a.push(...toLatLon(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr));
    }
    return a;
  };
  const rings = [ring(300, 0, 2500, 400, 0.3), ring(400, 100, 600, 50, 0.1)];
  const shape = new C.Shape(rings, proj, -2000, 2000);
  const brute = (px, py) => {
    let c = false;
    for (const r of rings) {
      const n = r.length / 2;
      for (let k = 0; k < n; k++) {
        const [x1, y1] = proj(r[2 * k], r[2 * k + 1]), [x2, y2] = proj(r[(2 * k + 2) % r.length], r[(2 * k + 3) % r.length]);
        if ((y1 > py) !== (y2 > py) && px < x1 + (py - y1) * (x2 - x1) / (y2 - y1)) c = !c;
      }
    }
    return c;
  };
  let ins = 0;
  for (let q = 0; q < 5000; q++) {
    const px = rnd() * 6000 - 3000, py = rnd() * 4000 - 2000;
    const a = shape.inside(px, py), b = brute(px, py);
    assert.strictEqual(a, b, `inside mismatch at ${px},${py}`);
    if (a) ins++;
  }
  console.log(`Shape.inside matches brute force on 5000 points (${ins} inside, hole respected)`);
}

// 3. Rays: a lake to the west of a bench; a pond to the west; the sea with a coastline.
{
  const center = { lat: 47.3, lon: 8.5 };
  const proj = C.makeProj(center);
  const ll = (x, y) => [center.lat + y / proj.ky, center.lon + x / proj.kx];
  const rect = (x0, y0, x1, y1) => [...ll(x0, y0), ...ll(x1, y0), ...ll(x1, y1), ...ll(x0, y1), ...ll(x0, y0)];
  const run = (areas, lines, bx, by) => {
    const D = C.buildContext({ seats: [], points: [], lines, areas }, center, { window: { x: 3000, y: 3000 }, rays: { x: 5000, y: 5000 } });
    return C.waterRuns(bx, by, D);
  };
  // Lake: 1.5 km wide, starting 20 m west of the bench.
  const lake = [{ id: 'way/1', tags: { natural: 'water', water: 'lake' }, rings: [rect(-1520, -3000, -20, 3000)] }];
  const r1 = run(lake, [], 0, 0);
  assert.strictEqual(r1[C.RAY_BEARINGS.indexOf(270)], 1500, 'due west should cross 1.5 km of lake');
  console.log('lake to the west:', r1.join(' '));
  // A pond 30 m across, 10 m away: short runs only.
  const pond = [{ id: 'way/2', tags: { natural: 'water', water: 'pond' }, rings: [rect(-40, -15, -10, 15)] }];
  const r2 = run(pond, [], 0, 0);
  assert(Math.max(...r2) <= 30, 'a small pond is not open water');
  console.log('small pond:      ', r2.join(' '));
  // Sea: coastline running north to south 40 m west of the bench, so the water (on its right) is to the west.
  const coast = [{ id: 'way/3', tags: { natural: 'coastline' }, parts: [[...ll(-40, 3000), ...ll(-40, -3000)]] }];
  const r3 = run([], coast, 0, 0);
  assert.strictEqual(r3[C.RAY_BEARINGS.indexOf(270)], 1960, 'sea to the west, measured to the ray end');
  // A coast 40 m east of the bench, drawn south to north, has the sea on its right, to the east:
  // the bench is on land and looks west over land, so no open water toward the sunset.
  const coastEast = [{ id: 'way/4', tags: { natural: 'coastline' }, parts: [[...ll(40, -3000), ...ll(40, 3000)]] }];
  const r4 = run([], coastEast, 0, 0);
  assert.strictEqual(Math.max(...r4), 0, 'land to the west');
  // An island 900 m out ends the open water: the run stops at its shore.
  const island = [...coast, { id: 'way/5', tags: { natural: 'coastline' },
    parts: [[...ll(-900, 300), ...ll(-1100, 300), ...ll(-1100, -300), ...ll(-900, -300), ...ll(-900, 300)]] }];
  const r5 = run([], island, 0, 0);
  assert.strictEqual(r5[C.RAY_BEARINGS.indexOf(270)], 860, 'sea until the island');
  console.log('sea to the west: ', r3.join(' '));
  console.log('sea with an island 900 m out:', r5.join(' '));
  console.log('sea to the east, bench facing west over land: all', r4[0]);
}

// 4. Grouping: same result as the prototype's local grouping.
{
  const old = require('./old-core.js');
  const center = { lat: 47.37, lon: 8.54 };
  const proj = C.makeProj(center);
  const seats = [];
  for (let k = 0; k < 1500; k++) {
    const x = rnd() * 2000 - 1000, y = rnd() * 2000 - 1000;
    const lat = center.lat + y / proj.ky, lon = center.lon + x / proj.kx;
    seats.push({ id: 'node/' + (1000 + k), kind: rnd() < 0.8 ? 'bench' : 'table', lat, lon, tags: {} });
    if (rnd() < 0.4) { // a neighbour within a few metres
      seats.push({ id: 'node/' + (900000 + k), kind: 'bench', lat: lat + (rnd() - 0.5) * 20 / proj.ky, lon: lon + (rnd() - 0.5) * 20 / proj.kx, tags: {} });
    }
  }
  const groups = C.groupSeats(seats).map(g => g.map(s => s.id).join(','));
  const json = { elements: [{ type: 'section', tags: { name: 'spots' } }].concat(seats.map(s => ({
    type: 'node', id: Number(s.id.slice(5)), lat: s.lat, lon: s.lon, tags: s.kind === 'bench' ? { amenity: 'bench' } : { leisure: 'picnic_table' },
  }))) };
  const oldSpots = old.analyseSections(Object.assign({ spots: [], pois: [], trees: [], bins: [], lines: [], areas: [] },
    { spots: json.elements.slice(1) }), center, 5000);
  const oldGroups = oldSpots.map(s => s.members.map(m => m.id.replace('node/', 'node/')).join(','));
  const norm = gs => gs.map(g => { const [a, ...b] = g.split(','); return [a, ...b.sort()].join(','); }).sort();
  assert.deepStrictEqual(norm(groups), norm(oldGroups));
  console.log(`grouping matches the prototype: ${groups.length} spots from ${seats.length} seats`);
}
console.log('all core checks passed');

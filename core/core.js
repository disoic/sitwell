/* ============================================================
   Sitwell core, shared by the app (in the browser) and the data pipeline (in Node).
   Measures what is around each place to sit, groups seats that stand together
   into spots, and turns the measurements into a summary, flags and an estimate.
   No DOM and no network: give it map data, get spots back.
   ============================================================ */
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.SitwellCore = core;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FORMAT = 1; // shape of the static spot files; bump when it changes

  // Thresholds in metres. Tune these against benches you know.
  const RULES = {
    lake: 40,           // "lakeside"
    river: 30,          // "riverside"
    stream: 20,         // "by a stream"
    sea: 40,            // "seaside"
    promenade: 15,      // "on a promenade" (named footpath or pedestrian street)
    pond: 40,           // "by a pond" / "by the water"
    forestEdge: 20,     // "at the forest edge"
    view: 50,           // "with a view" (mapped viewpoint)
    landmark: 60,       // "near Grossmünster" (named landmark)
    sunsetFrom: 225,    // prototype rule: nearest lake or river lies between these compass directions
    sunsetTo: 315,
    shadeRadius: 12,    // trees counted within this radius...
    shadeTrees: 2,      // ...need at least this many for "likely shaded"
    shelter: 6,         // "roofed" if a shelter is this close
    busyRoad: 30,       // warning: main road
    railway: 50,        // warning: railway
    tram: 20,           // warning: tram line
    stop: 15,           // warning: bus or tram stop
    drinkingWater: 300, // nearby
    toilet: 400,
    food: 400,
    bin: 20,
    bikeParking: 50,
  };

  // How far measurements look. Anything further counts as "none nearby".
  const LIMITS = {
    line: 250,   // water, paths, railways, forest edges
    road: 600,   // roads by class: motorways are heard from far away
    point: 450,  // points of interest
    bin: 60,
  };

  const GROUP_RADIUS = 15;  // benches and tables this close to a spot's first seat form one spot
  const SEARCH_RADIUS = 1500;

  // Squares of about 3.3 km, the same grid everywhere on Earth. Blocks of 8 x 8 squares
  // carry the index of which squares exist and what their content fingerprint is.
  const GRID = { lat: 0.03, lon: 0.045, block: 8 };

  // Sunset rays: open water measured along these compass bearings from each spot near water.
  // 230-310 covers the sunset direction all year from Croatia to the north of Switzerland.
  const RAYS = { from: 230, to: 310, step: 5, reach: 2000, startWithin: 150, gap: 15, near: 150 };
  const RAY_BEARINGS = [];
  for (let b = RAYS.from; b <= RAYS.to; b += RAYS.step) RAY_BEARINGS.push(b);

  const MATERIAL = { wood: 'wooden', metal: 'metal', steel: 'metal', stone: 'stone', granite: 'stone', concrete: 'concrete', plastic: 'plastic' };
  const FOOD_LABEL = { bakery: 'Bakery', supermarket: 'Supermarket', convenience: 'Corner shop' };
  const SNACK_LABEL = { kiosk: 'Kiosk', cafe: 'Café', ice_cream: 'Ice cream' };
  const ROAD_CLASS = { motorway: 'roadMajor', trunk: 'roadMajor', primary: 'roadPrimary', secondary: 'roadSecondary', tertiary: 'roadTertiary' };

  /* ---------- the grid ---------- */

  const squareOf = (lat, lon) => Math.floor(lat / GRID.lat) + '_' + Math.floor(lon / GRID.lon);
  const parseSquare = id => id.split('_').map(Number);
  function squareBox(id) {
    const [i, j] = parseSquare(id);
    return [i * GRID.lat, j * GRID.lon, (i + 1) * GRID.lat, (j + 1) * GRID.lon];
  }
  function squareCenter(id) {
    const b = squareBox(id);
    return { lat: (b[0] + b[2]) / 2, lon: (b[1] + b[3]) / 2 };
  }
  function blockOf(id) {
    const [i, j] = parseSquare(id);
    return Math.floor(i / GRID.block) + '_' + Math.floor(j / GRID.block);
  }
  // Position of a square inside its block, 0..63, for the coverage bit mask.
  function slotInBlock(id) {
    const [i, j] = parseSquare(id);
    const B = GRID.block;
    return (((i % B) + B) % B) * B + (((j % B) + B) % B);
  }
  // Squares that touch a circle, nearest first.
  function squaresForCircle(c, r) {
    const dLat = r / 110574, dLon = r / (111320 * Math.cos(c.lat * Math.PI / 180));
    const proj = makeProj(c), out = [];
    for (let i = Math.floor((c.lat - dLat) / GRID.lat); i <= Math.floor((c.lat + dLat) / GRID.lat); i++) {
      for (let j = Math.floor((c.lon - dLon) / GRID.lon); j <= Math.floor((c.lon + dLon) / GRID.lon); j++) {
        const id = i + '_' + j, b = squareBox(id);
        const [x, y] = proj(Math.min(Math.max(c.lat, b[0]), b[2]), Math.min(Math.max(c.lon, b[1]), b[3]));
        const d = Math.hypot(x, y);
        if (d <= r) out.push({ id, d });
      }
    }
    return out.sort((a, b) => a.d - b.d).map(t => t.id);
  }

  /* ---------- geometry (local metric coordinates around a centre) ---------- */

  function makeProj(c) {
    const kx = 111320 * Math.cos(c.lat * Math.PI / 180), ky = 110574;
    const f = (lat, lon) => [(lon - c.lon) * kx, (lat - c.lat) * ky];
    f.kx = kx; f.ky = ky; f.lat0 = c.lat; f.lon0 = c.lon;
    return f;
  }
  function metres(lat1, lon1, lat2, lon2) {
    const kx = 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 110574);
  }
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  // Compass direction from one point to another: 0 north, 90 east, 180 south, 270 west.
  const bearingTo = (px, py, qx, qy) => (Math.atan2(qx - px, qy - py) * 180 / Math.PI + 360) % 360;

  const KEY_OFF = 32768, KEY_SPAN = 65536;
  const cellKey = (i, j) => (i + KEY_OFF) * KEY_SPAN + (j + KEY_OFF);

  // Line segments in a uniform grid, for "nearest line within a limit" and for rays.
  class SegIndex {
    constructor(cell) {
      this.cell = cell;
      this.s = [];       // x1, y1, x2, y2 per segment
      this.fid = [];     // feature number per segment
      this.cells = new Map();
      this.n = 0;
      this.minx = Infinity; this.miny = Infinity; this.maxx = -Infinity; this.maxy = -Infinity;
      this.mark = null; this.stamp = 0;
    }
    add(x1, y1, x2, y2, f = 0) {
      const k = this.n++;
      this.s.push(x1, y1, x2, y2);
      this.fid.push(f);
      if (x1 < this.minx) this.minx = x1; if (x2 < this.minx) this.minx = x2;
      if (x1 > this.maxx) this.maxx = x1; if (x2 > this.maxx) this.maxx = x2;
      if (y1 < this.miny) this.miny = y1; if (y2 < this.miny) this.miny = y2;
      if (y1 > this.maxy) this.maxy = y1; if (y2 > this.maxy) this.maxy = y2;
      const c = this.cell;
      const i0 = Math.floor(Math.min(x1, x2) / c), i1 = Math.floor(Math.max(x1, x2) / c);
      const j0 = Math.floor(Math.min(y1, y2) / c), j1 = Math.floor(Math.max(y1, y2) / c);
      if (i0 === i1 && j0 === j1) { this.put(i0, j0, k); return; }
      // Register the segment in every cell it passes through (cells whose centre is within half a diagonal).
      const reach = c * 0.7072;
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          if (segDist((i + 0.5) * c, (j + 0.5) * c, x1, y1, x2, y2) <= reach) this.put(i, j, k);
        }
      }
    }
    put(i, j, k) {
      const key = cellKey(i, j), a = this.cells.get(key);
      if (a) a.push(k); else this.cells.set(key, [k]);
    }
    nextStamp() {
      if (!this.mark || this.mark.length < this.n) { this.mark = new Int32Array(Math.max(this.n, 16)); this.stamp = 0; }
      if (++this.stamp > 2e9) { this.mark.fill(0); this.stamp = 1; }
      return this.stamp;
    }
    scan(list, px, py, stamp) {
      const s = this.s, mark = this.mark;
      for (let n = 0; n < list.length; n++) {
        const k = list[n];
        if (mark[k] === stamp) continue;
        mark[k] = stamp;
        const o = k * 4, x1 = s[o], y1 = s[o + 1], dx = s[o + 2] - x1, dy = s[o + 3] - y1, L = dx * dx + dy * dy;
        let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = x1 + t * dx, qy = y1 + t * dy, d = Math.hypot(px - qx, py - qy);
        if (d < this.bd) { this.bd = d; this.bx = qx; this.by = qy; this.bf = this.fid[k]; }
      }
    }
    // Nearest segment within the limit: { d, x, y, f } or null.
    nearest(px, py, limit) {
      if (!this.n) return null;
      const ox = Math.max(this.minx - px, 0, px - this.maxx), oy = Math.max(this.miny - py, 0, py - this.maxy);
      if (Math.hypot(ox, oy) > limit) return null;
      const c = this.cell, ci = Math.floor(px / c), cj = Math.floor(py / c), cells = this.cells;
      const stamp = this.nextStamp(), maxR = Math.ceil(limit / c) + 1;
      this.bd = Infinity; this.bx = 0; this.by = 0; this.bf = -1;
      for (let r = 0; r <= maxR; r++) {
        // Segments not seen yet lie in rings >= r, at least (r - 1) cells away.
        if (r > 0 && (r - 1) * c > Math.min(this.bd, limit)) break;
        if (r === 0) {
          const a = cells.get(cellKey(ci, cj));
          if (a) this.scan(a, px, py, stamp);
          continue;
        }
        for (let i = ci - r; i <= ci + r; i++) {
          let a = cells.get(cellKey(i, cj - r)); if (a) this.scan(a, px, py, stamp);
          a = cells.get(cellKey(i, cj + r)); if (a) this.scan(a, px, py, stamp);
        }
        for (let j = cj - r + 1; j <= cj + r - 1; j++) {
          let a = cells.get(cellKey(ci - r, j)); if (a) this.scan(a, px, py, stamp);
          a = cells.get(cellKey(ci + r, j)); if (a) this.scan(a, px, py, stamp);
        }
      }
      return this.bd <= limit ? { d: this.bd, x: this.bx, y: this.by, f: this.bf } : null;
    }
    // Every crossing of the ray (px, py) + t * (dx, dy), 0 <= t <= len, with the indexed segments.
    // Pushes t, feature number and side (+1 when the ray crosses from a segment's left to its right).
    crossings(px, py, dx, dy, len, out) {
      if (!this.n) return;
      const c = this.cell, cells = this.cells, s = this.s, stamp = this.nextStamp(), mark = this.mark;
      let i = Math.floor(px / c), j = Math.floor(py / c);
      const si = dx > 0 ? 1 : dx < 0 ? -1 : 0, sj = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      const tdx = si ? Math.abs(c / dx) : Infinity, tdy = sj ? Math.abs(c / dy) : Infinity;
      let tx = si > 0 ? ((i + 1) * c - px) / dx : si < 0 ? (i * c - px) / dx : Infinity;
      let ty = sj > 0 ? ((j + 1) * c - py) / dy : sj < 0 ? (j * c - py) / dy : Infinity;
      for (;;) {
        const list = cells.get(cellKey(i, j));
        if (list) {
          for (let n = 0; n < list.length; n++) {
            const k = list[n];
            if (mark[k] === stamp) continue;
            mark[k] = stamp;
            const o = k * 4, x1 = s[o], y1 = s[o + 1], sx = s[o + 2] - x1, sy = s[o + 3] - y1;
            const den = dx * sy - dy * sx;
            if (Math.abs(den) < 1e-12) continue;
            const qx = x1 - px, qy = y1 - py;
            const t = (qx * sy - qy * sx) / den, u = (qx * dy - qy * dx) / den;
            if (t < 0 || t > len || u < 0 || u >= 1) continue;
            out.push(t, this.fid[k], den > 0 ? 1 : -1);
          }
        }
        if (tx < ty) { if (tx > len) break; i += si; tx += tdx; } else { if (ty > len) break; j += sj; ty += tdy; }
      }
    }
  }

  // An area for "is this point inside?": the rings' segments bucketed in horizontal bands,
  // even-odd rule, so multipolygons with holes work. Only bands between y0 and y1 are indexed.
  class Shape {
    constructor(rings, proj, y0, y1, band = 25) {
      const kx = proj.kx, ky = proj.ky, lat0 = proj.lat0, lon0 = proj.lon0;
      const segs = [];
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const r of rings) {
        const n = r.length;
        if (n < 6) continue;
        let px = (r[1] - lon0) * kx, py = (r[0] - lat0) * ky;
        const fx = px, fy = py;
        for (let k = 0; k <= n; k += 2) {
          let x, y;
          if (k < n) { x = (r[k + 1] - lon0) * kx; y = (r[k] - lat0) * ky; } else { x = fx; y = fy; } // closes the ring
          if (x < minx) minx = x; if (x > maxx) maxx = x;
          if (y < miny) miny = y; if (y > maxy) maxy = y;
          if (k > 0 && !(x === px && y === py) && Math.max(py, y) >= y0 && Math.min(py, y) <= y1) segs.push(px, py, x, y);
          px = x; py = y;
        }
      }
      this.minx = minx; this.miny = miny; this.maxx = maxx; this.maxy = maxy;
      this.segs = segs;
      this.y0 = y0; this.h = band;
      const nb = Math.max(1, Math.ceil((y1 - y0) / band) + 1);
      this.bands = new Array(nb);
      for (let k = 0; k < segs.length; k += 4) {
        const lo = Math.max(Math.min(segs[k + 1], segs[k + 3]), y0), hi = Math.min(Math.max(segs[k + 1], segs[k + 3]), y1);
        const b0 = Math.max(0, Math.floor((lo - y0) / band)), b1 = Math.min(nb - 1, Math.floor((hi - y0) / band));
        for (let b = b0; b <= b1; b++) (this.bands[b] || (this.bands[b] = [])).push(k);
      }
    }
    inside(px, py) {
      if (px < this.minx || px > this.maxx || py < this.miny || py > this.maxy) return false;
      const list = this.bands[Math.floor((py - this.y0) / this.h)];
      if (!list) return false;
      const s = this.segs;
      let c = false;
      for (let n = 0; n < list.length; n++) {
        const o = list[n], y1 = s[o + 1], y2 = s[o + 3];
        if ((y1 > py) !== (y2 > py)) {
          const x = s[o] + (py - y1) * (s[o + 2] - s[o]) / (y2 - y1);
          if (px < x) c = !c;
        }
      }
      return c;
    }
  }

  // Points in a grid, for "how many within r" and "nearest within r".
  function makeGrid(cell) { return { cell, m: new Map() }; }
  function gridAdd(g, x, y) {
    const k = cellKey(Math.floor(x / g.cell), Math.floor(y / g.cell));
    let a = g.m.get(k);
    if (!a) { a = []; g.m.set(k, a); }
    a.push(x, y);
  }
  function gridScan(g, x, y, r) {
    const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell), span = Math.ceil(r / g.cell);
    let count = 0, nearest = Infinity;
    for (let i = cx - span; i <= cx + span; i++) {
      for (let j = cy - span; j <= cy + span; j++) {
        const a = g.m.get(cellKey(i, j));
        if (!a) continue;
        for (let k = 0; k < a.length; k += 2) {
          const d = Math.hypot(a[k] - x, a[k + 1] - y);
          if (d <= r) count++;
          if (d < nearest) nearest = d;
        }
      }
    }
    return { count, nearest: nearest <= r ? nearest : Infinity };
  }
  function nearestPoint(list, px, py, skipKey, limit = Infinity) {
    let best = Infinity, item = null;
    for (let n = 0; n < list.length; n++) {
      const p = list[n];
      if (p.key === skipKey) continue;
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < best) { best = d; item = p; }
    }
    return best <= limit ? { d: best, item } : { d: Infinity, item: null };
  }

  /* ---------- what things are ---------- */

  const isClosed = t => /^(private|no)$/.test(t.access || '');
  function seatKind(t) {
    return t.amenity === 'bench' ? 'bench' : t.leisure === 'picnic_table' ? 'table' : t.amenity === 'toilets' ? 'toilet' : null;
  }
  function stopLabel(t) {
    if (t.railway === 'tram_stop' || t.tram === 'yes') return 'Tram stop';
    if (t.highway === 'bus_stop' || t.bus === 'yes') return 'Bus stop';
    return 'Stop';
  }
  function waterKind(t) {
    const w = t.water;
    if (!w) return 'water';
    if (/^(lake|reservoir|lagoon)$/.test(w)) return 'lake';
    if (/^(river|canal|oxbow)$/.test(w)) return 'river';
    if (/^(wastewater|basin|fish_pass|stream|ditch|moat)$/.test(w)) return null;
    return 'pond';
  }
  // What a point of interest counts as; one place can count as several things.
  function pointRoles(t, isNode) {
    if (isClosed(t)) return [];
    const r = [];
    if (t.amenity === 'drinking_water' && t.drinking_water !== 'no') r.push(['drink']);
    if ((t.amenity === 'fountain' || t.man_made === 'water_tap') && t.drinking_water === 'yes') r.push(['drink']);
    if (FOOD_LABEL[t.shop]) r.push(['food', FOOD_LABEL[t.shop]]);
    if (t.amenity === 'bicycle_parking') r.push(['bike']);
    if (t.tourism === 'viewpoint') r.push(['view']);
    if (t.amenity === 'shelter') r.push(['shelter']);
    if (t.name && (t.historic || t.amenity === 'place_of_worship' || /^(attraction|museum|artwork)$/.test(t.tourism || '')
      || (t.amenity === 'fountain' && t.drinking_water !== 'yes'))) r.push(['landmark', t.name]);
    if (isNode && (t.highway === 'bus_stop' || t.railway === 'tram_stop' || t.public_transport === 'platform')) r.push(['stop', stopLabel(t)]);
    if (t.leisure === 'firepit' || t.amenity === 'bbq') r.push(['firepit']);
    if (t.leisure === 'playground') r.push(['playground']);
    if (t.leisure === 'bathing_place') r.push(['swim']);
    const snack = t.shop === 'kiosk' ? SNACK_LABEL.kiosk : SNACK_LABEL[t.amenity];
    if (snack) r.push(['snack', snack]);
    return r;
  }
  function lineRole(t) {
    const h = t.highway;
    if (h) {
      if (/^(pedestrian|footway|path)$/.test(h)) {
        return t.name && !/^(sidewalk|crossing|traffic_island)$/.test(t.footway || '') && t.tunnel !== 'yes' ? 'promenade' : null;
      }
      const cls = ROAD_CLASS[h.replace(/_link$/, '')];
      return cls && !/^(yes|building_passage)$/.test(t.tunnel || '') ? cls : null;
    }
    if (t.railway === 'tram') return t.tunnel !== 'yes' ? 'tram' : null;
    if (/^(rail|light_rail|narrow_gauge)$/.test(t.railway || '')) return t.tunnel !== 'yes' ? 'rail' : null;
    if (/^(river|canal|stream)$/.test(t.waterway || '')) {
      if (/^(yes|culvert)$/.test(t.tunnel || '')) return null;
      return t.waterway === 'stream' ? 'stream' : 'river';
    }
    if (t.natural === 'tree_row') return 'treerow';
    if (t.natural === 'water') return waterKind(t);
    if (t.natural === 'coastline') return 'sea';
    return null;
  }
  function areaRole(t) {
    if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'cemetery';
    if (t.leisure === 'park') return 'park';
    if (t.leisure === 'garden') return (isClosed(t) || /^(residential|private)$/.test(t['garden:type'] || '')) ? null : 'garden';
    if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
    if (t.natural === 'beach' || t.leisure === 'swimming_area') return 'swim';
    return null;
  }

  /* ---------- the context around a place ---------- */

  const LINE_KINDS = ['lake', 'river', 'stream', 'pond', 'water', 'sea', 'promenade', 'roadMajor', 'roadPrimary', 'roadSecondary',
    'roadTertiary', 'rail', 'tram', 'treerow', 'forestEdge', 'swim'];
  const POINT_KINDS = ['drink', 'food', 'bike', 'view', 'shelter', 'stop', 'toilet', 'landmark', 'firepit', 'playground', 'swim', 'snack'];
  const AREA_KINDS = ['park', 'garden', 'cemetery', 'forest', 'swim'];

  /* Builds everything measure() needs around one centre.
     input:
       seats:  [{ id, tags, lat, lon }]  benches, tables and toilets (toilets also count as "toilet nearby")
       points: [{ id, tags, lat, lon, node }]  points of interest; areas already reduced to their centre
       trees, bins: flat [lat, lon, lat, lon, ...]
       lines:  [{ id, tags, parts: [[lat, lon, ...], ...] }]  roads, paths, rails, waterways, coastline, open water outlines
       areas:  [{ id, tags, rings: [[lat, lon, ...], ...] }]  parks, gardens, cemeteries, woods, beaches, and complete water polygons
     opts:
       window: { x, y }  half-size in metres around the centre; segments wholly outside are skipped
       rays:   { x, y }  half-size for open water used by the sunset rays, or null to skip rays */
  function buildContext(input, center, opts = {}) {
    const proj = makeProj(center);
    const kx = proj.kx, ky = proj.ky, lat0 = center.lat, lon0 = center.lon;
    const win = opts.window || { x: Infinity, y: Infinity };
    const rayWin = opts.rays || null;
    const P = {}, L = {}, A = {};
    for (const k of POINT_KINDS) P[k] = [];
    for (const k of LINE_KINDS) L[k] = new SegIndex(/^road/.test(k) ? 100 : 50);
    for (const k of AREA_KINDS) A[k] = [];
    const water = rayWin ? { seg: new SegIndex(50), shapes: [] } : null;
    const D = { proj, center, P, L, A, trees: makeGrid(20), bins: makeGrid(20), water };

    const addPoint = (kind, x, y, key, label) => P[kind].push({ x, y, key, label });
    for (const el of input.seats || []) {
      if (seatKind(el.tags) === 'toilet' && !isClosed(el.tags)) addPoint('toilet', (el.lon - lon0) * kx, (el.lat - lat0) * ky, el.id);
    }
    for (const el of input.points || []) {
      const roles = pointRoles(el.tags || {}, el.node !== false);
      if (!roles.length) continue;
      const x = (el.lon - lon0) * kx, y = (el.lat - lat0) * ky;
      for (const [kind, label] of roles) addPoint(kind, x, y, el.id, label);
    }
    const addFlat = (g, a) => { if (a) for (let k = 0; k < a.length; k += 2) gridAdd(g, (a[k + 1] - lon0) * kx, (a[k] - lat0) * ky); };
    addFlat(D.trees, input.trees);
    addFlat(D.bins, input.bins);

    // Adds a chain of vertices to an index, keeping segments that touch the window.
    const addChain = (idx, a, w, closeRing, fid) => {
      const n = a.length;
      if (n < 4) return;
      let px = (a[1] - lon0) * kx, py = (a[0] - lat0) * ky;
      const fx = px, fy = py;
      const last = closeRing && (a[0] !== a[n - 2] || a[1] !== a[n - 1]) ? n : n - 2;
      for (let k = 2; k <= last; k += 2) {
        const x = k < n ? (a[k + 1] - lon0) * kx : fx, y = k < n ? (a[k] - lat0) * ky : fy;
        if (Math.max(px, x) >= -w.x && Math.min(px, x) <= w.x && Math.max(py, y) >= -w.y && Math.min(py, y) <= w.y) idx.add(px, py, x, y, fid);
        px = x; py = y;
      }
    };
    for (const el of input.lines || []) {
      const role = lineRole(el.tags || {});
      if (!role) continue;
      for (const part of el.parts) {
        addChain(L[role], part, win, false, 0);
        if (role === 'sea' && water) addChain(water.seg, part, rayWin, false, -1);
      }
    }
    for (const el of input.areas || []) {
      const t = el.tags || {};
      if (t.natural === 'water') {
        const kind = waterKind(t);
        if (!kind) continue;
        for (const ring of el.rings) addChain(L[kind], ring, win, true, 0);
        if (water) {
          const f = water.shapes.length;
          water.shapes.push(new Shape(el.rings, proj, -win.y, win.y));
          for (const ring of el.rings) addChain(water.seg, ring, rayWin, true, f);
        }
        continue;
      }
      const role = areaRole(t);
      if (!role) continue;
      A[role].push(new Shape(el.rings, proj, -win.y, win.y));
      if (role === 'forest') for (const ring of el.rings) addChain(L.forestEdge, ring, win, true, 0);
      if (role === 'swim') for (const ring of el.rings) addChain(L.swim, ring, win, true, 0);
    }
    return D;
  }

  /* ---------- measuring one place ---------- */

  function measure(x, y, key, D) {
    const L = D.L, P = D.P, A = D.A;
    const line = (idx, lim = LIMITS.line) => { const r = idx.nearest(x, y, lim); return r ? r.d : Infinity; };
    const near = list => nearestPoint(list, x, y, key, LIMITS.point);
    const m = {};
    const wl = L.lake.nearest(x, y, LIMITS.line), wr = L.river.nearest(x, y, LIMITS.line), ws = L.sea.nearest(x, y, LIMITS.line);
    m.lake = wl ? wl.d : Infinity;
    m.river = wr ? wr.d : Infinity;
    m.sea = ws ? ws.d : Infinity;
    // Which way the nearest lake, river or sea lies (the prototype's sunset rule uses it).
    let w = wl && (!wr || wl.d <= wr.d) ? wl : wr;
    if (ws && (!w || ws.d < w.d)) w = ws;
    m.waterDir = w ? Math.round(bearingTo(x, y, w.x, w.y)) : -1;
    m.stream = line(L.stream);
    m.promenade = line(L.promenade);
    m.pond = line(L.pond);
    m.water = line(L.water);
    m.inPark = A.park.some(f => f.inside(x, y));
    m.inGarden = A.garden.some(f => f.inside(x, y));
    m.inCemetery = A.cemetery.some(f => f.inside(x, y));
    m.inForest = A.forest.some(f => f.inside(x, y));
    m.forestEdge = line(L.forestEdge);
    m.view = near(P.view).d;
    const lm = near(P.landmark);
    m.landmark = lm.d;
    m.landmarkName = lm.item ? lm.item.label : '';
    m.trees = gridScan(D.trees, x, y, RULES.shadeRadius).count;
    m.treeRow = line(L.treerow);
    m.shelter = near(P.shelter).d;
    m.roadMajor = line(L.roadMajor, LIMITS.road);
    m.roadPrimary = line(L.roadPrimary, LIMITS.road);
    m.roadSecondary = line(L.roadSecondary, LIMITS.road);
    m.roadTertiary = line(L.roadTertiary, LIMITS.road);
    m.road = Math.min(m.roadMajor, m.roadPrimary, m.roadSecondary);   // the prototype's "main road"
    if (m.road > LIMITS.line) m.road = Infinity;
    m.rail = line(L.rail);
    m.tram = line(L.tram);
    const st = near(P.stop);
    m.stop = st.d;
    m.stopLabel = st.item ? st.item.label : 'Stop';
    m.drink = near(P.drink).d;
    m.toilet = near(P.toilet).d;
    const fd = near(P.food);
    m.food = fd.d;
    m.foodLabel = fd.item ? fd.item.label : 'Shop';
    m.bin = gridScan(D.bins, x, y, LIMITS.bin).nearest;
    m.bike = near(P.bike).d;
    m.firepit = near(P.firepit).d;
    m.playground = near(P.playground).d;
    m.swim = A.swim.some(f => f.inside(x, y)) ? 0 : Math.min(near(P.swim).d, line(L.swim));
    const sn = near(P.snack);
    m.snack = sn.d;
    m.snackLabel = sn.item ? sn.item.label : '';
    return m;
  }

  // A spot is described by its best and worst seats: nearest water, nearest road, and so on.
  function combineMeasures(list) {
    if (list.length === 1) return list[0];
    const m = {};
    for (const k of Object.keys(list[0])) {
      const vals = list.map(x => x[k]);
      if (typeof vals[0] === 'number') m[k] = k === 'trees' ? Math.max(...vals) : Math.min(...vals);
      else if (typeof vals[0] === 'boolean') m[k] = vals.some(Boolean);
    }
    const by = k => list.reduce((a, b) => (b[k] < a[k] ? b : a));
    m.stopLabel = by('stop').stopLabel;
    m.landmarkName = by('landmark').landmarkName;
    m.foodLabel = by('food').foodLabel;
    m.snackLabel = by('snack').snackLabel;
    const wet = list.reduce((a, b) => (Math.min(b.lake, b.river, b.sea) < Math.min(a.lake, a.river, a.sea) ? b : a));
    m.waterDir = wet.waterDir;
    return m;
  }

  // Length of open water along each sunset bearing, in metres (0 = none), or null when no water is near.
  function waterRuns(x, y, D) {
    const W = D.water;
    if (!W || !W.seg.n) return null;
    const out = [], buf = [];
    for (const b of RAY_BEARINGS) {
      const a = b * Math.PI / 180, dx = Math.sin(a), dy = Math.cos(a);
      buf.length = 0;
      W.seg.crossings(x, y, dx, dy, RAYS.reach, buf);
      const byF = new Map(), coast = [], iv = [];
      for (let k = 0; k < buf.length; k += 3) {
        const f = buf[k + 1];
        if (f < 0) coast.push([buf[k], buf[k + 2]]);
        else { let l = byF.get(f); if (!l) byF.set(f, l = []); l.push(buf[k]); }
      }
      for (const [f, ts] of byF) {
        ts.sort((p, q) => p - q);
        let inside = W.shapes[f].inside(x, y), start = 0;
        for (const t of ts) {
          if (inside) iv.push([start, t]); else start = t;
          inside = !inside;
        }
        if (inside) iv.push([start, RAYS.reach]);
      }
      if (coast.length) {
        // Coastlines run with the water on their right, so the crossing direction tells sea from land.
        coast.sort((p, q) => p[0] - q[0]);
        let start = null;
        for (const [t, side] of coast) {
          if (side > 0) { if (start === null) start = t; } else { iv.push([start === null ? 0 : start, t]); start = null; }
        }
        if (start !== null) iv.push([start, RAYS.reach]);
      }
      out.push(longestRun(iv));
    }
    return out;
  }
  function longestRun(iv) {
    if (!iv.length) return 0;
    iv.sort((p, q) => p[0] - q[0]);
    let best = 0, cs = iv[0][0], ce = iv[0][1];
    const close = () => { if (cs <= RAYS.startWithin) best = Math.max(best, Math.min(ce, RAYS.reach) - cs); };
    for (let k = 1; k < iv.length; k++) {
      if (iv[k][0] <= ce + RAYS.gap) ce = Math.max(ce, iv[k][1]);
      else { close(); cs = iv[k][0]; ce = iv[k][1]; }
    }
    close();
    return Math.round(best / 10) * 10;
  }
  const nearWater = m => Math.min(m.lake, m.river, m.pond, m.water, m.sea) <= RAYS.near;

  /* ---------- seats into spots ---------- */

  const COMPASS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225,
    WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
  // A bench's "direction" tag (the way you face when sitting) as degrees, or null.
  function normDirection(v) {
    if (v == null) return null;
    const s = String(v).trim().toUpperCase();
    if (COMPASS[s] != null) return COMPASS[s];
    if (/^-?\d+(\.\d+)?$/.test(s)) return Math.round(((Number(s) % 360) + 360) % 360);
    return null;
  }
  const SEAT_TAGS = ['backrest', 'armrest', 'material', 'covered', 'seats', 'lit'];
  const TOILET_TAGS = ['fee', 'charge', 'opening_hours', 'wheelchair', 'changing_table', 'access'];
  function pick(t, keys) {
    const o = {};
    for (const k of keys) if (t[k] != null && t[k] !== '') o[k] = String(t[k]);
    return o;
  }
  // yes / some / no across a group, like "some with backrest".
  function allSomeNo(vals) {
    if (vals.length && vals.every(v => v === 'yes')) return 'yes';
    if (vals.some(v => v === 'yes')) return 'some';
    if (vals.length && vals.every(v => v === 'no')) return 'no';
    return null;
  }
  function groupTags(members) {
    if (members.length === 1) {
      const t = members[0].tags || {};
      if (members[0].kind === 'toilet') return pick(t, TOILET_TAGS);
      const o = pick(t, SEAT_TAGS);
      const d = normDirection(t.direction);
      if (d != null) o.direction = d;
      return o;
    }
    const benches = members.filter(s => s.kind === 'bench');
    const t = {};
    const back = allSomeNo(benches.map(s => s.tags.backrest));
    if (back) t.backrest = back;
    const arm = allSomeNo(benches.map(s => s.tags.armrest));
    if (arm) t.armrest = arm;
    const mats = benches.map(s => s.tags.material);
    if (mats.length && mats[0] && mats.every(v => v === mats[0])) t.material = mats[0];
    if (members.some(s => s.tags.covered === 'yes')) t.covered = 'yes';
    if (members.some(s => s.tags.lit === 'yes')) t.lit = 'yes';
    const seats = benches.map(s => Number(s.tags.seats));
    if (seats.length && seats.every(n => n > 0 && n < 100)) t.seats = String(seats.reduce((a, b) => a + b, 0));
    // A shared direction, if every bench that has one faces roughly the same way.
    const dirs = benches.map(s => normDirection(s.tags.direction)).filter(d => d != null);
    if (dirs.length) {
      const sx = dirs.reduce((n, d) => n + Math.sin(d * Math.PI / 180), 0), cx = dirs.reduce((n, d) => n + Math.cos(d * Math.PI / 180), 0);
      const mean = (Math.atan2(sx, cx) * 180 / Math.PI + 360) % 360;
      if (dirs.every(d => Math.abs(((d - mean + 540) % 360) - 180) <= 45)) t.direction = Math.round(mean) % 360;
    }
    return t;
  }

  const seatRank = s => (s.added ? 2 : s.id.startsWith('node/') ? 0 : 1);
  const seatNum = s => { const n = Number(s.id.slice(s.id.indexOf('/') + 1)); return isFinite(n) ? n : 0; };
  const seatOrder = (a, b) => seatRank(a) - seatRank(b) || seatNum(a) - seatNum(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  /* Groups benches and tables (not toilets) into spots. Each spot is a circle of GROUP_RADIUS around
     its first seat, so a row of benches along a promenade becomes a row of spots, not one long chain.
     Older OpenStreetMap entries go first, so spots keep the same first seat over time.
     seats: [{ id, kind, lat, lon, tags, added }]; returns arrays of seats, first seat first. */
  function groupSeats(seats, radius = GROUP_RADIUS) {
    const list = seats.slice().sort(seatOrder);
    if (!list.length) return [];
    let latMax = -90;
    for (const s of list) if (Math.abs(s.lat) > latMax) latMax = Math.abs(s.lat);
    const cy = radius / 110574, cx = radius / (111320 * Math.cos(Math.min(latMax, 89) * Math.PI / 180));
    const grid = new Map();
    list.forEach((s, i) => {
      const k = cellKey(Math.floor(s.lon / cx), Math.floor(s.lat / cy));
      const a = grid.get(k);
      if (a) a.push(i); else grid.set(k, [i]);
    });
    const used = new Uint8Array(list.length), groups = [];
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const seed = list[i], found = [];
      const ci = Math.floor(seed.lon / cx), cj = Math.floor(seed.lat / cy);
      const kxs = 111320 * Math.cos(seed.lat * Math.PI / 180);
      for (let a = ci - 1; a <= ci + 1; a++) {
        for (let b = cj - 1; b <= cj + 1; b++) {
          for (const j of grid.get(cellKey(a, b)) || []) {
            if (used[j]) continue;
            const s = list[j];
            if (Math.hypot((s.lon - seed.lon) * kxs, (s.lat - seed.lat) * 110574) <= radius) { used[j] = 1; found.push(j); }
          }
        }
      }
      found.sort((p, q) => p - q);
      groups.push([seed].concat(found.map(j => list[j])));
    }
    return groups;
  }

  function makeSpot(members, D) {
    const xy = members.map(s => D.proj(s.lat, s.lon));
    const ms = members.map((s, k) => measure(xy[k][0], xy[k][1], s.id, D));
    const counts = { bench: members.filter(s => s.kind === 'bench').length, table: members.filter(s => s.kind === 'table').length };
    const spot = {
      id: members[0].id,
      kind: counts.bench ? 'bench' : 'table',
      lat: members.reduce((n, s) => n + s.lat, 0) / members.length,
      lon: members.reduce((n, s) => n + s.lon, 0) / members.length,
      tags: groupTags(members),
      added: !!members[0].added,
      members: members.map(s => ({ id: s.id, kind: s.kind, lat: s.lat, lon: s.lon, added: !!s.added })),
      counts, hasBench: counts.bench > 0, hasTable: counts.table > 0,
      m: combineMeasures(ms),
    };
    if (D.water && nearWater(spot.m)) {
      // Rays start from the seat closest to the water.
      let best = 0, bd = Infinity;
      ms.forEach((m, k) => { const d = Math.min(m.lake, m.river, m.pond, m.water, m.sea); if (d < bd) { bd = d; best = k; } });
      spot.rays = waterRuns(xy[best][0], xy[best][1], D);
    }
    return spot;
  }
  function makeToiletSpot(seat, D) {
    const [x, y] = D.proj(seat.lat, seat.lon);
    return {
      id: seat.id, kind: 'toilet', lat: seat.lat, lon: seat.lon, tags: groupTags([Object.assign({ kind: 'toilet' }, seat)]),
      added: false, members: [{ id: seat.id, kind: 'toilet', lat: seat.lat, lon: seat.lon, added: false }],
      counts: { bench: 0, table: 0 }, hasBench: false, hasTable: false,
      m: measure(x, y, seat.id, D),
    };
  }

  /* Everything for one area at once, as the app does where no ready-made squares exist yet:
     seats within R of the centre become spots, described and estimated. */
  function analyseArea(input, center, R = SEARCH_RADIUS, opts = {}) {
    const D = buildContext(input, center, opts);
    const spots = [], seats = [];
    for (const el of input.seats || []) {
      const t = el.tags || {}, kind = seatKind(t);
      if (!kind || isClosed(t)) continue;
      const [x, y] = D.proj(el.lat, el.lon), dist = Math.hypot(x, y);
      if (kind === 'toilet') {
        if (dist <= R) spots.push(Object.assign(makeToiletSpot(el, D), { dist }));
      } else if (dist <= R + GROUP_RADIUS) {
        seats.push({ id: el.id, kind, lat: el.lat, lon: el.lon, tags: t, added: !!el.added });
      }
    }
    for (const g of groupSeats(seats)) {
      const s = makeSpot(g, D);
      const [x, y] = D.proj(s.lat, s.lon);
      s.dist = Math.hypot(x, y);
      if (s.dist <= R) spots.push(s);
    }
    for (const s of spots) finishSpot(s);
    return spots.sort((a, b) => a.dist - b.dist);
  }
  // Adds what the app shows: summary, flags, estimate.
  function finishSpot(s) {
    s.osmType = s.id.slice(0, s.id.indexOf('/'));
    s.osmId = s.id.slice(s.id.indexOf('/') + 1);
    s.text = describe(s);
    s.flags = flagsOf(s.m);
    s.estimate = estimateOf(s);
    return s;
  }

  /* ---------- static spot files ---------- */

  const NUMS = ['lake', 'river', 'sea', 'stream', 'promenade', 'pond', 'water', 'forestEdge', 'view', 'landmark', 'trees', 'treeRow',
    'shelter', 'road', 'roadMajor', 'roadPrimary', 'roadSecondary', 'roadTertiary', 'rail', 'tram', 'stop', 'drink', 'toilet', 'food',
    'bin', 'bike', 'firepit', 'playground', 'swim', 'snack'];
  const BOOLS = ['inPark', 'inGarden', 'inCemetery', 'inForest'];
  const LABELS = { landmarkName: ['landmark', ''], stopLabel: ['stop', 'Stop'], foodLabel: ['food', 'Shop'], snackLabel: ['snack', ''] };
  const r6 = v => Math.round(v * 1e6) / 1e6;

  function packMeasures(m) {
    const o = {};
    for (const k of NUMS) {
      const v = m[k];
      // Rounded up: every "within X metres" rule (whole metres) then decides exactly as with the raw distance.
      if (k === 'trees' ? v > 0 : isFinite(v)) o[k] = Math.ceil(v);
    }
    if (m.waterDir >= 0 && Math.min(m.lake, m.river, m.sea) <= LIMITS.line) o.waterDir = m.waterDir;
    for (const k of BOOLS) if (m[k]) o[k] = 1;
    for (const k in LABELS) if (m[k] && o[LABELS[k][0]] != null) o[k] = m[k];
    return o;
  }
  function unpackMeasures(o) {
    const m = {};
    for (const k of NUMS) m[k] = o[k] != null ? o[k] : (k === 'trees' ? 0 : Infinity);
    m.waterDir = o.waterDir != null ? o.waterDir : -1;
    for (const k of BOOLS) m[k] = !!o[k];
    for (const k in LABELS) m[k] = o[k] || LABELS[k][1];
    return m;
  }
  function packSpot(s) {
    const rec = { id: s.id, kind: s.kind, lat: r6(s.lat), lon: r6(s.lon) };
    if (s.members.length > 1) rec.members = s.members.map(mb => [mb.id, r6(mb.lat), r6(mb.lon), mb.kind]);
    if (Object.keys(s.tags).length) rec.tags = s.tags;
    rec.m = packMeasures(s.m);
    if (s.rays) rec.rays = s.rays;
    if (s.place != null) rec.place = s.place;
    return rec;
  }
  function unpackSpot(rec) {
    const members = rec.members
      ? rec.members.map(a => ({ id: a[0], lat: a[1], lon: a[2], kind: a[3], added: false }))
      : [{ id: rec.id, lat: rec.lat, lon: rec.lon, kind: rec.kind, added: false }];
    const counts = { bench: members.filter(s => s.kind === 'bench').length, table: members.filter(s => s.kind === 'table').length };
    return {
      id: rec.id, kind: rec.kind, lat: rec.lat, lon: rec.lon, tags: rec.tags || {}, added: false, members,
      counts, hasBench: counts.bench > 0, hasTable: counts.table > 0,
      m: unpackMeasures(rec.m || {}), rays: rec.rays || null, place: rec.place != null ? rec.place : null,
    };
  }

  /* ---------- the summary (unchanged from the prototype for now; the app rewrite revises it) ---------- */

  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

  function describe(s) {
    const t = s.tags, m = s.m, R = RULES;
    const facts = [], warnings = [];
    const where =
      m.inCemetery ? 'in a cemetery' :
      m.inPark ? 'in a park' :
      m.inGarden ? 'in a garden' :
      m.inForest ? 'in the woods' :
      m.forestEdge <= R.forestEdge ? 'at the forest edge' : '';

    if (s.kind === 'toilet') {
      const fee = t.fee === 'no' ? 'free' : t.fee === 'yes' ? 'paid' : '';
      const noun = t.access === 'customers' ? 'toilet for customers' : 'public toilet';
      let sentence = [fee, noun].filter(Boolean).join(' ') + (where ? ' ' + where : '');
      if (t.fee === 'yes' && t.charge) sentence += ` (${t.charge})`;
      const c = [];
      const oh = (t.opening_hours || '').trim();
      if (oh === '24/7') c.push('open 24/7');
      else if (oh) c.push('hours ' + (oh.length > 48 ? oh.slice(0, 46) + '…' : oh));
      if (t.wheelchair === 'yes') c.push('wheelchair accessible');
      else if (t.wheelchair === 'limited') c.push('limited wheelchair access');
      else if (t.wheelchair === 'no') c.push('not wheelchair accessible');
      if (t.changing_table === 'yes') c.push('changing table');
      if (m.drink <= R.drinkingWater) facts.push({ label: 'Drinking water', d: m.drink });
      if (m.food <= R.food) facts.push({ label: m.foodLabel, d: m.food });
      if (m.bike <= R.bikeParking) facts.push({ label: 'Bike parking', d: m.bike });
      return {
        sentence: cap(sentence) + '.',
        comfort: c.length ? cap(c.join(', ')) + '.' : '',
        note: !fee && !oh ? 'Fee and opening hours not mapped.' : '',
        facts, warnings,
      };
    }

    const nb = s.counts ? s.counts.bench : s.kind === 'bench' ? 1 : 0;
    const nt = s.counts ? s.counts.table : s.kind === 'table' ? 1 : 0;
    const mat = MATERIAL[t.material] ? MATERIAL[t.material] + ' ' : '';
    let noun;
    if (nb + nt <= 1) noun = mat + (nt ? 'picnic table' : 'bench');
    else if (nb <= 1 && nt <= 1) noun = 'bench and picnic table';
    else if (!nt) noun = `group of ${nb} ${mat}benches`;
    else if (!nb) noun = `group of ${nt} picnic tables`;
    else noun = `group of ${nb} ${nb === 1 ? 'bench' : mat + 'benches'} and ${nt === 1 ? 'a picnic table' : nt + ' picnic tables'}`;
    const lakeside = m.lake <= R.lake;
    const riverside = !lakeside && m.river <= R.river;
    const head = [lakeside ? 'lakeside' : riverside ? 'riverside' : '', noun].filter(Boolean).join(' ');
    const tail = [];
    if (where) tail.push(where);
    if (m.promenade <= R.promenade) tail.push('on a promenade');
    if (!lakeside && !riverside) {
      if (m.stream <= R.stream) tail.push('by a stream');
      else if (m.pond <= R.pond) tail.push('by a pond');
      else if (m.water <= R.pond) tail.push('by the water');
    }
    if (m.landmark <= R.landmark && m.landmarkName) tail.push(`near ${m.landmarkName}`);
    if (m.view <= R.view) tail.push('with a view');
    if (sunsetWater(m)) tail.push('with sunsets over the water');
    const sentence = cap(head + (tail.length ? ' ' + tail.join(', ') : '')) + '.';

    const c = [];
    if (nb) {
      if (t.backrest === 'yes') c.push(nb > 1 ? 'backrests' : 'backrest');
      else if (t.backrest === 'some') c.push('some with backrest');
      else if (t.backrest === 'no') c.push('no backrest');
    }
    if (t.covered === 'yes' || m.shelter <= R.shelter) c.push('roofed');
    if (!m.inForest && (m.trees >= R.shadeTrees || m.treeRow <= R.shadeRadius)) c.push('likely shaded');

    if (m.drink <= R.drinkingWater) facts.push({ label: 'Drinking water', d: m.drink });
    if (m.toilet <= R.toilet) facts.push({ label: 'Toilet', d: m.toilet });
    if (m.food <= R.food) facts.push({ label: m.foodLabel, d: m.food });
    if (m.bin <= R.bin) facts.push({ label: 'Bin', d: m.bin });
    if (m.bike <= R.bikeParking) facts.push({ label: 'Bike parking', d: m.bike });

    if (m.road <= R.busyRoad) warnings.push({ label: 'Busy road', d: m.road });
    if (m.rail <= R.railway) warnings.push({ label: 'Railway', d: m.rail });
    if (m.tram <= R.tram) warnings.push({ label: 'Tram line', d: m.tram });
    if (m.stop <= R.stop) warnings.push({ label: m.stopLabel, d: m.stop });

    return {
      sentence,
      comfort: c.length ? cap(c.join(', ')) + '.' : '',
      note: !tail.length && !c.length && head === noun && nb + nt <= 1 ? 'Nothing notable mapped around it.' : '',
      facts, warnings,
    };
  }

  // A first guess at how nice a spot is (1 to 5), from its surroundings alone.
  const PROMISING_FROM = 4.0;
  function estimateOf(s) {
    if (s.kind === 'toilet') return null;
    const m = s.m, R = RULES, t = s.tags || {};
    let x = 2.6;
    if (m.lake <= R.lake || m.river <= R.river) x += 1.2;
    else if (m.stream <= R.stream || m.pond <= R.pond || m.water <= R.pond) x += 0.8;
    if (m.inPark || m.inGarden) x += 0.6;
    if (m.inForest || m.forestEdge <= R.forestEdge) x += 0.6;
    if (m.view <= R.view) x += 0.8;
    if (sunsetWater(m)) x += 0.3;
    if (m.landmark <= R.landmark && m.landmarkName) x += 0.3;
    if (m.promenade <= R.promenade) x += 0.3;
    if (m.trees >= R.shadeTrees || m.treeRow <= R.shadeRadius) x += 0.2;
    if (t.backrest === 'yes' || t.backrest === 'some') x += 0.2;
    if (m.inCemetery) x -= 0.6;
    if (m.road <= R.busyRoad) x -= 1.0;
    if (m.rail <= R.railway) x -= 0.6;
    if (m.tram <= R.tram) x -= 0.3;
    if (m.stop <= R.stop) x -= 0.7;
    return Math.max(1, Math.min(5, Math.round(x * 10) / 10));
  }

  // Sunset time for a place and day, calculated on the phone (the standard solar formulas, as in SunCalc).
  function sunsetAt(date, lat, lon) {
    const rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009;
    const e = rad * 23.4397;
    const d = date.valueOf() / dayMs - 0.5 + J1970 - J2000;
    const lw = rad * -lon, phi = rad * lat;
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const ds = J0 + lw / (2 * Math.PI) + n;
    const M = rad * (357.5291 + 0.98560028 * ds);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const cosW = (Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (cosW < -1 || cosW > 1) return null;
    const w = Math.acos(cosW);
    const a = J0 + (w + lw) / (2 * Math.PI) + n;
    const Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    return new Date((Jset + 0.5 - J1970) * dayMs);
  }
  // Prototype rule: the nearest lake or river lies to the west.
  function sunsetWater(m) {
    const R = RULES;
    return (m.lake <= R.lake || m.river <= R.river) && m.waterDir >= R.sunsetFrom && m.waterDir <= R.sunsetTo;
  }
  function flagsOf(m) {
    const R = RULES;
    return {
      water: m.lake <= R.lake || m.river <= R.river || m.stream <= R.stream || m.pond <= R.pond || m.water <= R.pond,
      green: m.inPark || m.inGarden || m.inForest || m.forestEdge <= R.forestEdge,
      quiet: !(m.road <= R.busyRoad || m.rail <= R.railway || m.tram <= R.tram || m.stop <= R.stop),
    };
  }
  function compass(deg) {
    return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(deg / 45) % 8];
  }
  function fmtDist(d) {
    if (!isFinite(d)) return 'none nearby';
    if (d < 5) return 'under 5 m';
    if (d < 100) return Math.round(d / 5) * 5 + ' m';
    if (d < 1000) return Math.round(d / 10) * 10 + ' m';
    if (d < 10000) return (d / 1000).toFixed(1).replace(/\.0$/, '') + ' km';
    return Math.round(d / 1000).toLocaleString('en') + ' km';
  }

  return {
    FORMAT, RULES, LIMITS, GROUP_RADIUS, SEARCH_RADIUS, GRID, RAYS, RAY_BEARINGS, MATERIAL, FOOD_LABEL, SNACK_LABEL, PROMISING_FROM,
    squareOf, squareBox, squareCenter, blockOf, slotInBlock, squaresForCircle,
    makeProj, metres, segDist, bearingTo, SegIndex, Shape, makeGrid, gridAdd, gridScan, nearestPoint,
    isClosed, seatKind, stopLabel, waterKind, pointRoles, lineRole, areaRole, normDirection,
    buildContext, measure, combineMeasures, waterRuns, groupTags, groupSeats, makeSpot, makeToiletSpot, analyseArea, finishSpot,
    packMeasures, unpackMeasures, packSpot, unpackSpot,
    describe, estimateOf, sunsetAt, sunsetWater, flagsOf, compass, fmtDist,
  };
}));

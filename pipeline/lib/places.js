// Passport places from administrative boundaries, worked out once per spot instead of
// asking Overpass on every check-in. Also decides which grid squares a region owns.
'use strict';
const fs = require('fs');
const C = require('../../core/core.js');

// Lat/lon used directly as x/y: even-odd tests don't need metres.
const DEG = Object.assign((lat, lon) => [lon, lat], { kx: 1, ky: 1, lat0: 0, lon0: 0 });
const shapeOf = rings => {
  const b = bbox(rings);
  return new C.Shape(rings, DEG, b[0], b[2], Math.max((b[2] - b[0]) / 400, 0.0005));
};
function bbox(rings) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const a of rings) {
    for (let k = 0; k < a.length; k += 2) {
      if (a[k] < s) s = a[k]; if (a[k] > n) n = a[k];
      if (a[k + 1] < w) w = a[k + 1]; if (a[k + 1] > e) e = a[k + 1];
    }
  }
  return [s, w, n, e];
}
// A point guaranteed to be inside a polygon: the middle of the widest inside stretch of a horizontal line.
function interiorPoint(rings) {
  const [s, , n] = bbox(rings);
  for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
    const y = s + (n - s) * f, xs = [];
    for (const a of rings) {
      for (let k = 0; k < a.length; k += 2) {
        const k2 = (k + 2) % a.length, y1 = a[k], y2 = a[k2];
        if ((y1 > y) !== (y2 > y)) xs.push(a[k + 1] + (y - y1) * (a[k2 + 1] - a[k + 1]) / (y2 - y1));
      }
    }
    xs.sort((p, q) => p - q);
    let best = null, width = 0;
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > width) { width = xs[k + 1] - xs[k]; best = [y, (xs[k] + xs[k + 1]) / 2]; }
    if (best) return best;
  }
  return null;
}

class Places {
  constructor(admins) {
    this.items = admins.map(a => Object.assign({}, a, { area: (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]), shape: null }));
    // Coarse grid of bounding boxes, 0.1 degree cells.
    this.grid = new Map();
    this.items.forEach((a, k) => {
      const [s, w, n, e] = a.bbox;
      for (let i = Math.floor(s * 10); i <= Math.floor(n * 10); i++) {
        for (let j = Math.floor(w * 10); j <= Math.floor(e * 10); j++) {
          const key = i + '_' + j;
          (this.grid.get(key) || this.grid.set(key, []).get(key)).push(k);
        }
      }
    });
    this.subCounts = this.countSubareas();
  }
  contains(a, lat, lon) {
    const [s, w, n, e] = a.bbox;
    if (lat < s || lat > n || lon < w || lon > e) return false;
    if (!a.shape) a.shape = shapeOf(a.rings);
    return a.shape.inside(lon, lat);
  }
  // Boundaries containing a point, smallest first within each level.
  containing(lat, lon) {
    const out = [];
    for (const k of this.grid.get(Math.floor(lat * 10) + '_' + Math.floor(lon * 10)) || []) {
      const a = this.items[k];
      if (this.contains(a, lat, lon)) out.push(a);
    }
    return out.sort((p, q) => p.level - q.level || p.area - q.area || (p.id < q.id ? -1 : 1));
  }
  // How many differently named districts (level 9) and neighbourhoods (level 10) each town has,
  // for "Zürich: 3 of 34 neighbourhoods".
  countSubareas() {
    const names = new Map();
    for (const a of this.items) {
      if (a.level !== 9 && a.level !== 10) continue;
      const p = interiorPoint(a.rings);
      if (!p) continue;
      for (const town of this.containing(p[0], p[1])) {
        if (town.level !== 8 && town.level !== 7) continue;
        const key = town.id + ':' + a.level;
        (names.get(key) || names.set(key, new Set()).get(key)).add(a.name);
      }
    }
    const counts = new Map();
    for (const [k, set] of names) counts.set(k, set.size);
    return counts;
  }
  // The same chain the prototype stored per check-in (place format v3), plus the subarea counts.
  placeAt(lat, lon) {
    const areas = this.containing(lat, lon);
    const lvl = n => areas.find(a => a.level === n);
    const country = lvl(2);
    const town = lvl(8) || lvl(7) || lvl(6);
    const inTown = town && (town.level === 8 || town.level === 7);
    const l9 = inTown ? lvl(9) : null, l10 = inTown ? lvl(10) : null;
    if (!town && !country) return null;
    const cname = country ? (country.nameEn || country.name) : 'Somewhere';
    const p = {
      v: 3,
      townArea: town ? town.id : null,
      country: cname,
      code: country ? country.iso : '',
      town: town ? town.name : cname,
      district: l9 ? l9.name : '',
      neighbourhood: l10 ? l10.name : '',
    };
    if (town) {
      const d = this.subCounts.get(town.id + ':9'), nb = this.subCounts.get(town.id + ':10');
      if (d) p.districts = d;
      if (nb) p.neighbourhoods = nb;
    }
    return p;
  }
  // Towns, districts and neighbourhoods for the app's place search: [name, context, lat, lon, level].
  // Only places inside the region's own squares; one entry per name and context.
  searchEntries(owned) {
    const out = [], seen = new Set();
    const items = this.items.filter(a => a.level >= 6).sort((p, q) => q.level - p.level || p.area - q.area);
    for (const a of items) {
      const p = interiorPoint(a.rings);
      if (!p || !owned.has(C.squareOf(p[0], p[1]))) continue;
      const around = this.containing(p[0], p[1]);
      const town = around.find(x => (x.level === 8 || x.level === 7) && x.name !== a.name);
      const country = around.find(x => x.level === 2);
      const context = a.level >= 9 && town ? town.name : country ? (country.nameEn || country.name) : '';
      const key = a.name + '|' + context;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a.name, context, Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5, a.level]);
    }
    return out;
  }
  country(iso) {
    return this.items.filter(a => a.level === 2 && a.iso === iso).sort((p, q) => q.area - p.area)[0] || null;
  }
}

// Geofabrik .poly files: the outline each extract was cut with.
function readPoly(path) {
  const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/).map(l => l.trim());
  const rings = [];
  let cur = null;
  for (let k = 1; k < lines.length; k++) {
    const l = lines[k];
    if (!l) continue;
    if (l === 'END') { if (cur) { rings.push(Float64Array.from(cur)); cur = null; } continue; }
    const nums = l.split(/\s+/).map(Number);
    if (nums.length >= 2 && nums.every(isFinite) && cur) cur.push(nums[1], nums[0]);
    else cur = [];   // a section name starts a ring (a leading "!" marks a hole; even-odd handles both)
  }
  return rings;
}

/* The squares a region owns: those whose centre lies inside its country boundary
   (or the extract outline, or a bounding box given in the config for test extracts). */
function ownedSquares(region, places, cfg) {
  let test = null, box = null, how = '';
  const country = cfg.iso && places.country(cfg.iso);
  if (country) {
    const sh = shapeOf(country.rings);
    test = (lat, lon) => sh.inside(lon, lat);
    box = country.bbox; how = `country boundary ${country.id}`;
  } else if (cfg.polyFile && fs.existsSync(cfg.polyFile)) {
    const rings = readPoly(cfg.polyFile), sh = shapeOf(rings);
    test = (lat, lon) => sh.inside(lon, lat);
    box = bbox(rings); how = 'extract outline (.poly)';
  } else if (cfg.bbox) {
    const [s, w, n, e] = cfg.bbox;
    test = (lat, lon) => lat >= s && lat <= n && lon >= w && lon <= e;
    box = cfg.bbox; how = 'bounding box from the config';
  } else {
    throw new Error(`${region.code}: no country boundary, .poly file or bbox to decide which squares it owns`);
  }
  const owned = new Set();
  for (let i = Math.floor(box[0] / C.GRID.lat); i <= Math.floor(box[2] / C.GRID.lat); i++) {
    for (let j = Math.floor(box[1] / C.GRID.lon); j <= Math.floor(box[3] / C.GRID.lon); j++) {
      const id = i + '_' + j, c = C.squareCenter(id);
      if (test(c.lat, c.lon)) owned.add(id);
    }
  }
  return { owned, how };
}

module.exports = { Places, ownedSquares, readPoly, interiorPoint };

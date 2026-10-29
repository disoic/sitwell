// One region's map data in memory: seats, points of interest, trees, bins, lines and areas,
// bucketed by grid square so each square's surroundings can be gathered quickly.
'use strict';
const fs = require('fs');
const readline = require('readline');
const C = require('../../core/core.js');

// Tags worth keeping per kind of feature; everything else is dropped to save memory.
const SEAT_KEYS = ['amenity', 'leisure', 'access', 'backrest', 'armrest', 'material', 'covered', 'seats', 'direction', 'lit',
  'fee', 'charge', 'opening_hours', 'wheelchair', 'changing_table'];
const POINT_KEYS = ['amenity', 'drinking_water', 'man_made', 'shop', 'tourism', 'historic', 'name', 'highway', 'railway',
  'public_transport', 'tram', 'bus', 'leisure', 'access'];
const LINE_KEYS = ['highway', 'footway', 'tunnel', 'railway', 'waterway', 'natural', 'water', 'name']; // name only as present/absent
const AREA_KEYS = ['landuse', 'amenity', 'leisure', 'natural', 'water', 'access', 'garden:type'];
const keep = (t, keys) => {
  const o = {};
  for (const k of keys) if (t[k] != null) o[k] = k === 'name' && keys === LINE_KEYS ? '1' : t[k];
  return o;
};

// osmium's ids: n123 node, w123 way, a<2*id> area from a way, a<2*id+1> area from a relation.
function osmId(fid) {
  const t = fid[0], n = Number(fid.slice(1));
  if (t === 'n') return 'node/' + n;
  if (t === 'w') return 'way/' + n;
  if (t === 'r') return 'relation/' + n;
  return n % 2 === 0 ? 'way/' + n / 2 : 'relation/' + (n - 1) / 2;
}
const flat = coords => {
  const a = new Float64Array(coords.length * 2);
  for (let k = 0; k < coords.length; k++) { a[2 * k] = coords[k][1]; a[2 * k + 1] = coords[k][0]; }
  return a;
};
function bboxOf(arrays) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const a of arrays) {
    for (let k = 0; k < a.length; k += 2) {
      if (a[k] < s) s = a[k]; if (a[k] > n) n = a[k];
      if (a[k + 1] < w) w = a[k + 1]; if (a[k + 1] > e) e = a[k + 1];
    }
  }
  return [s, w, n, e];
}

// A growable list of numbers (trees, bins).
class FloatList {
  constructor() { this.a = new Float64Array(1024); this.n = 0; }
  push(x, y) {
    if (this.n + 2 > this.a.length) { const b = new Float64Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = x; this.a[this.n++] = y;
  }
}

class Region {
  constructor(code) {
    this.code = code;
    this.seats = [];   // { id, kind, lat, lon, tags }
    this.points = [];  // { id, tags, lat, lon, node }
    this.trees = new FloatList();
    this.bins = new FloatList();
    this.lines = [];   // { id, tags, parts, bbox }
    this.areas = [];   // { id, tags, rings, bbox }  (parks, woods, beaches, open water)
    this.admins = [];  // { id, level, name, nameEn, iso, rings, bbox }
    this.seenSeat = new Set();
    this.seenPoint = new Set();
    this.counts = { features: 0 };
  }

  async read(path) {
    const rl = readline.createInterface({ input: fs.createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 }), crlfDelay: Infinity });
    for await (let line of rl) {
      if (line.charCodeAt(0) === 0x1e) line = line.slice(1);
      if (!line) continue;
      this.add(JSON.parse(line));
    }
  }

  add(f) {
    this.counts.features++;
    const t = f.properties || {}, g = f.geometry;
    if (!g) return;
    const id = osmId(String(f.id));
    const type = g.type;
    const isPoint = type === 'Point', isLine = type === 'LineString' || type === 'MultiLineString';
    const isArea = type === 'Polygon' || type === 'MultiPolygon';
    let parts = null, rings = null, center = null;
    if (isPoint) center = [g.coordinates[1], g.coordinates[0]];
    else if (type === 'LineString') parts = [flat(g.coordinates)];
    else if (type === 'MultiLineString') parts = g.coordinates.map(flat);
    else if (type === 'Polygon') rings = g.coordinates.map(flat);
    else if (type === 'MultiPolygon') rings = [].concat(...g.coordinates.map(p => p.map(flat)));
    const box = isPoint ? null : bboxOf(parts || rings);
    if (!center) center = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]; // like Overpass "out center"

    const kind = C.seatKind(t);
    if (kind && !this.seenSeat.has(id)) {
      this.seenSeat.add(id);
      this.seats.push({ id, kind, lat: center[0], lon: center[1], tags: keep(t, SEAT_KEYS) });
    }
    if (C.pointRoles(t, isPoint).length && !this.seenPoint.has(id)) {
      this.seenPoint.add(id);
      this.points.push({ id, tags: keep(t, POINT_KEYS), lat: center[0], lon: center[1], node: isPoint });
    }
    if (isPoint) {
      if (t.natural === 'tree') this.trees.push(center[0], center[1]);
      if (t.amenity === 'waste_basket') this.bins.push(center[0], center[1]);
      return;
    }
    if (t.boundary === 'administrative' && isArea) {
      const level = Number(t.admin_level);
      if (level >= 2 && level <= 10 && t.name) {
        this.admins.push({ id, level, name: t.name, nameEn: t['name:en'] || '', iso: (t['ISO3166-1:alpha2'] || t['ISO3166-1'] || '').toUpperCase(), rings, bbox: box });
      }
    }
    if (isArea && (t.natural === 'water' ? C.waterKind(t) : C.areaRole(t))) {
      this.areas.push({ id, tags: keep(t, AREA_KEYS), rings, bbox: box });
      return;
    }
    if (t.natural === 'water') return;   // open water only as complete polygons
    const role = C.lineRole(t);
    if (role) this.lines.push({ id, tags: keep(t, LINE_KEYS), parts: parts || rings, bbox: box, sea: role === 'sea' });
  }

  // Bucket everything by the grid squares it touches.
  index() {
    const sq = (lat, lon) => C.squareOf(lat, lon);
    const bucket = (map, key) => { let b = map.get(key); if (!b) map.set(key, b = []); return b; };
    this.bSeats = new Map(); this.bPoints = new Map(); this.bTrees = new Map(); this.bBins = new Map();
    this.bLines = new Map(); this.bAreas = new Map();
    this.seats.forEach((s, k) => bucket(this.bSeats, sq(s.lat, s.lon)).push(k));
    this.points.forEach((p, k) => bucket(this.bPoints, sq(p.lat, p.lon)).push(k));
    for (const [list, map] of [[this.trees, this.bTrees], [this.bins, this.bBins]]) {
      for (let k = 0; k < list.n; k += 2) bucket(map, sq(list.a[k], list.a[k + 1])).push(list.a[k], list.a[k + 1]);
    }
    const spread = (items, map) => items.forEach((it, k) => {
      const [s, w, n, e] = it.bbox;
      for (let i = Math.floor(s / C.GRID.lat); i <= Math.floor(n / C.GRID.lat); i++) {
        for (let j = Math.floor(w / C.GRID.lon); j <= Math.floor(e / C.GRID.lon); j++) bucket(map, i + '_' + j).push(k);
      }
    });
    spread(this.lines, this.bLines);
    spread(this.areas, this.bAreas);
  }

  // Everything around one square, for core.buildContext. Margins are in metres beyond the square's edge.
  gather(id, M) {
    const [i, j] = id.split('_').map(Number);
    const box = C.squareBox(id);
    const latMid = (box[0] + box[2]) / 2, kx = 111320 * Math.cos(latMid * Math.PI / 180), ky = 110574;
    const within = (lat, lon, m) => lat >= box[0] - m / ky && lat <= box[2] + m / ky && lon >= box[1] - m / kx && lon <= box[3] + m / kx;
    const touches = (b, m) => b[2] >= box[0] - m / ky && b[0] <= box[2] + m / ky && b[3] >= box[1] - m / kx && b[1] <= box[3] + m / kx;
    const out = { seats: [], points: [], trees: [], bins: [], lines: [], areas: [] };
    const seenL = new Set(), seenA = new Set();
    for (let a = i - 1; a <= i + 1; a++) {
      for (let b = j - 1; b <= j + 1; b++) {
        const key = a + '_' + b;
        for (const k of this.bSeats.get(key) || []) { const s = this.seats[k]; if (within(s.lat, s.lon, M.point)) out.seats.push(s); }
        for (const k of this.bPoints.get(key) || []) { const p = this.points[k]; if (within(p.lat, p.lon, M.point)) out.points.push(p); }
        for (const [map, arr, m] of [[this.bTrees, out.trees, M.trees], [this.bBins, out.bins, M.bins]]) {
          const f = map.get(key);
          if (f) for (let k = 0; k < f.length; k += 2) if (within(f[k], f[k + 1], m)) arr.push(f[k], f[k + 1]);
        }
        for (const k of this.bLines.get(key) || []) {
          if (seenL.has(k)) continue;
          seenL.add(k);
          const l = this.lines[k];
          if (touches(l.bbox, l.sea ? M.rays : M.line)) out.lines.push(l);
        }
        for (const k of this.bAreas.get(key) || []) {
          if (seenA.has(k)) continue;
          seenA.add(k);
          const ar = this.areas[k];
          if (touches(ar.bbox, ar.tags.natural === 'water' ? M.rays : M.area)) out.areas.push(ar);
        }
      }
    }
    return out;
  }

  // Seats that become spots: benches and tables grouped across the whole region, toilets on their own.
  spots() {
    const seats = [], toilets = [];
    for (const s of this.seats) {
      if (C.isClosed(s.tags)) continue;
      if (s.kind === 'toilet') toilets.push(s); else seats.push(s);
    }
    return { groups: C.groupSeats(seats), toilets };
  }
}

module.exports = { Region, osmId };

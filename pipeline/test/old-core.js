// The prototype's core, copied unchanged from bench-finder.html, for regression checks.

/* ============================================================
   Core: query building, geometry and the surroundings summary.
   No DOM access here, so it can be tested on its own.
   ============================================================ */

// Thresholds in metres. Tune these against benches you know.
const RULES = {
  lake: 40,           // "lakeside"
  river: 30,          // "riverside"
  stream: 20,         // "by a stream"
  promenade: 15,      // "on a promenade" (named footpath or pedestrian street)
  pond: 40,           // "by a pond" / "by the water"
  forestEdge: 20,     // "at the forest edge"
  view: 50,           // "with a view" (mapped viewpoint)
  landmark: 60,       // "near Grossmünster" (named landmark)
  sunsetFrom: 225,    // nearest lake or river lies between these compass directions,
  sunsetTo: 315,      // so looking at the water means looking at the sunset
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
const SEARCH_RADIUS = 1500;   // spots are shown within this distance
const GROUP_RADIUS = 15;      // benches and tables this close to a spot's first seat form one spot
const FETCH_RADIUS = 5000;    // data is loaded and saved on the phone this far around you
const TILE_LAT = 0.03;        // data is fetched in squares of about 3.3 km...
const TILE_LON = 0.045;       // ...so moving around reuses what's already saved
const TILE_MAX_AGE_DAYS = 14; // saved squares older than this are refreshed in the background
const TILE_VERSION = 2;       // bump when the query changes, so saved squares are refreshed
const MEASURE_LIMIT = 250;    // line and area distances are measured up to this

const MATERIAL = { wood: 'wooden', metal: 'metal', steel: 'metal', stone: 'stone', granite: 'stone', concrete: 'concrete', plastic: 'plastic' };
const FOOD_LABEL = { bakery: 'Bakery', supermarket: 'Supermarket', convenience: 'Corner shop' };

function clipBox(c, half) {
  const dLat = half / 110574;
  const dLon = half / (111320 * Math.cos(c.lat * Math.PI / 180));
  return [c.lat - dLat, c.lon - dLon, c.lat + dLat, c.lon + dLon];
}

function expandBox(box, m) {
  const dLat = m / 110574, dLon = m / (111320 * Math.cos((box[0] + box[2]) / 2 * Math.PI / 180));
  return [box[0] - dLat, box[1] - dLon, box[2] + dLat, box[3] + dLon];
}
function tileBox(id) {
  const [i, j] = id.split('_').map(Number);
  return [i * TILE_LAT, j * TILE_LON, (i + 1) * TILE_LAT, (j + 1) * TILE_LON];
}
// Squares that touch a circle, nearest first.
function tilesForCircle(c, r) {
  const dLat = r / 110574, dLon = r / (111320 * Math.cos(c.lat * Math.PI / 180));
  const proj = makeProj(c), out = [];
  for (let i = Math.floor((c.lat - dLat) / TILE_LAT); i <= Math.floor((c.lat + dLat) / TILE_LAT); i++) {
    for (let j = Math.floor((c.lon - dLon) / TILE_LON); j <= Math.floor((c.lon + dLon) / TILE_LON); j++) {
      const id = i + '_' + j, b = tileBox(id);
      const [x, y] = proj(Math.min(Math.max(c.lat, b[0]), b[2]), Math.min(Math.max(c.lon, b[1]), b[3]));
      const d = Math.hypot(x, y);
      if (d <= r) out.push({ id, d });
    }
  }
  return out.sort((a, b) => a.d - b.d).map(t => t.id);
}

function buildTileQuery(box) {
  const bb = box.map(v => v.toFixed(5)).join(',');
  const clip = expandBox(box, 120).map(v => v.toFixed(5)).join(',');
  return `[out:json][timeout:45][maxsize:268435456][bbox:${bb}];
make section name="spots";out;
(
  node["amenity"="bench"];
  way["amenity"="bench"];
  node["leisure"="picnic_table"];
  way["leisure"="picnic_table"];
  nwr["amenity"="toilets"];
);
out center qt;
make section name="pois";out;
(
  nwr["amenity"="drinking_water"];
  nwr["amenity"="fountain"]["drinking_water"="yes"];
  nwr["man_made"="water_tap"]["drinking_water"="yes"];
  nwr["shop"~"^(bakery|supermarket|convenience)$"];
  nwr["amenity"="bicycle_parking"];
  nwr["tourism"="viewpoint"];
  nwr["amenity"="shelter"];
  nwr["historic"~"^(castle|monument|ruins|city_gate|fort|tower|manor|church)$"]["name"];
  nwr["amenity"="place_of_worship"]["name"];
  nwr["tourism"~"^(attraction|museum|artwork)$"]["name"];
  nwr["amenity"="fountain"]["name"];
  node["highway"="bus_stop"];
  node["railway"="tram_stop"];
  node["public_transport"="platform"];
);
out center qt;
make section name="trees";out;
node["natural"="tree"];
out skel qt;
make section name="bins";out;
node["amenity"="waste_basket"];
out skel qt;
make section name="lines";out;
(
  way["highway"~"^(motorway|trunk|primary|secondary)(_link)?$"]["tunnel"!~"^(yes|building_passage)$"];
  way["highway"~"^(pedestrian|footway|path)$"]["name"]["footway"!~"^(sidewalk|crossing|traffic_island)$"]["tunnel"!="yes"];
  way["railway"~"^(rail|light_rail|narrow_gauge)$"]["tunnel"!="yes"];
  way["railway"="tram"]["tunnel"!="yes"];
  way["waterway"~"^(river|canal|stream)$"]["tunnel"!~"^(yes|culvert)$"];
  way["natural"="tree_row"];
  way["natural"="water"];
  relation["natural"="water"];
);
out geom(${clip});
make section name="areas";out;
(
  way["leisure"~"^(park|garden)$"];
  relation["leisure"~"^(park|garden)$"];
  way["landuse"="cemetery"];
  relation["landuse"="cemetery"];
  way["amenity"="grave_yard"];
  way["landuse"="forest"];
  relation["landuse"="forest"];
  way["natural"="wood"];
  relation["natural"="wood"];
);
out geom;`;
}

// Keeps only what the summaries need, so saved squares stay small.
const KEEP_TAGS = new Set(['amenity', 'leisure', 'highway', 'railway', 'waterway', 'natural', 'water', 'landuse', 'tourism',
  'shop', 'man_made', 'drinking_water', 'access', 'garden:type', 'public_transport', 'bus', 'tram', 'footway', 'tunnel',
  'backrest', 'material', 'covered', 'seats', 'direction', 'fee', 'charge', 'opening_hours', 'wheelchair', 'changing_table']);
function slimTags(t) {
  const o = {};
  for (const k in t) if (KEEP_TAGS.has(k)) o[k] = t[k];
  return o;
}
function slimTile(json, box) {
  const s = splitSections(json);
  const r6 = v => Math.round(v * 1e6) / 1e6;
  const pts = g => g.map(p => (p && p.lat != null ? { lat: r6(p.lat), lon: r6(p.lon) } : null));
  const pt = (el, keepName) => {
    const o = { type: el.type, id: el.id, tags: slimTags(el.tags || {}) };
    if (keepName && el.tags && el.tags.name) o.tags.name = el.tags.name;
    if (el.lat != null) { o.lat = r6(el.lat); o.lon = r6(el.lon); } else if (el.center) o.center = { lat: r6(el.center.lat), lon: r6(el.center.lon) };
    return o;
  };
  const shape = (el, clip) => {
    const o = { type: el.type, id: el.id, tags: slimTags(el.tags || {}) };
    if (el.geometry) o.geometry = pts(el.geometry);
    if (el.members) o.members = el.members.filter(m => m.type === 'way' && m.geometry).map(m => ({ type: 'way', geometry: pts(m.geometry) }));
    if (clip) o.clip = clip;
    return o;
  };
  const flat = list => {
    const a = [];
    for (const el of list) if (el.lat != null) a.push(r6(el.lat), r6(el.lon));
    return a;
  };
  const clip = expandBox(box, 120);
  return {
    spots: s.spots.map(el => pt(el)), pois: s.pois.map(el => pt(el, true)), trees: flat(s.trees), bins: flat(s.bins),
    lines: s.lines.map(el => shape(el, clip)), areas: s.areas.map(el => shape(el, null)),
  };
}
// Combines saved squares. Points and areas appear once; clipped lines keep each square's piece.
function mergeTiles(list) {
  const out = { spots: [], pois: [], trees: [], bins: [], lines: [], areas: [] };
  const seen = { spots: new Set(), pois: new Set(), areas: new Set() };
  for (const d of list) {
    for (const k of ['spots', 'pois', 'areas']) {
      for (const el of d[k]) {
        const key = el.type + '/' + el.id;
        if (seen[k].has(key)) continue;
        seen[k].add(key);
        out[k].push(el);
      }
    }
    for (const el of d.lines) out.lines.push(el);
    out.trees.push(d.trees);
    out.bins.push(d.bins);
  }
  return out;
}

function buildQuery(c, R = SEARCH_RADIUS) {
  const R1 = R + 60;    // local context (roads, trees, water...)
  const R2 = R + 420;   // amenities that count as "nearby"
  const ll = `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`;
  const a = r => `(around:${r},${ll})`;
  const bb = clipBox(c, R1 + 150).map(v => v.toFixed(6)).join(',');
  return `[out:json][timeout:45][maxsize:268435456];
make section name="spots";out;
(
  node["amenity"="bench"]${a(R)};
  way["amenity"="bench"]${a(R)};
  node["leisure"="picnic_table"]${a(R)};
  way["leisure"="picnic_table"]${a(R)};
  nwr["amenity"="toilets"]${a(R2)};
);
out center qt;
make section name="pois";out;
(
  nwr["amenity"="drinking_water"]${a(R2)};
  nwr["amenity"="fountain"]["drinking_water"="yes"]${a(R2)};
  nwr["man_made"="water_tap"]["drinking_water"="yes"]${a(R2)};
  nwr["shop"~"^(bakery|supermarket|convenience)$"]${a(R2)};
  nwr["amenity"="bicycle_parking"]${a(R1)};
  nwr["tourism"="viewpoint"]${a(R1)};
  nwr["amenity"="shelter"]${a(R1)};
  node["highway"="bus_stop"]${a(R1)};
  node["railway"="tram_stop"]${a(R1)};
  node["public_transport"="platform"]${a(R1)};
);
out center qt;
make section name="trees";out;
node["natural"="tree"]${a(R1)};
out skel qt;
make section name="bins";out;
node["amenity"="waste_basket"]${a(R1)};
out skel qt;
make section name="lines";out;
(
  way["highway"~"^(motorway|trunk|primary|secondary)(_link)?$"]["tunnel"!~"^(yes|building_passage)$"]${a(R1)};
  way["highway"~"^(pedestrian|footway|path)$"]["name"]["footway"!~"^(sidewalk|crossing|traffic_island)$"]["tunnel"!="yes"]${a(R1)};
  way["railway"~"^(rail|light_rail|narrow_gauge)$"]["tunnel"!="yes"]${a(R1)};
  way["railway"="tram"]["tunnel"!="yes"]${a(R1)};
  way["waterway"~"^(river|canal|stream)$"]["tunnel"!~"^(yes|culvert)$"]${a(R1)};
  way["natural"="tree_row"]${a(R1)};
  way["natural"="water"]${a(R1)};
  relation["natural"="water"]${a(R1)};
);
out geom(${bb});
make section name="areas";out;
(
  way["leisure"~"^(park|garden)$"]${a(R1)};
  relation["leisure"~"^(park|garden)$"]${a(R1)};
  way["landuse"="cemetery"]${a(R1)};
  relation["landuse"="cemetery"]${a(R1)};
  way["amenity"="grave_yard"]${a(R1)};
  way["landuse"="forest"]${a(R1)};
  relation["landuse"="forest"]${a(R1)};
  way["natural"="wood"]${a(R1)};
  relation["natural"="wood"]${a(R1)};
);
out geom;`;
}

/* ---------- geometry helpers (local metric coordinates) ---------- */

function makeProj(c) {
  const kx = 111320 * Math.cos(c.lat * Math.PI / 180), ky = 110574;
  return (lat, lon) => [(lon - c.lon) * kx, (lat - c.lat) * ky];
}
function coordOf(el) {
  if (el.lat != null) return [el.lat, el.lon];
  if (el.center) return [el.center.lat, el.center.lon];
  return null;
}
// Turns a way or relation into a flat list of segments [x1,y1,x2,y2, ...].
// Clipped output may contain nulls; gaps are never bridged.
function buildFeature(el, proj, clipHalf) {
  const segs = [];
  const box = el.clip;
  const offBox = g => box ? (g.lat < box[0] || g.lat > box[2] || g.lon < box[1] || g.lon > box[3]) : false;
  const offHalf = p => clipHalf && (Math.abs(p[0]) > clipHalf || Math.abs(p[1]) > clipHalf);
  const add = geom => {
    let prev = null, prevG = null;
    for (const g of geom) {
      if (!g || g.lat == null) { prev = null; prevG = null; continue; }
      const p = proj(g.lat, g.lon);
      // A segment with both ends outside the clip area can be a bridge over omitted nodes, so skip it.
      if (prev && !(offBox(prevG) && offBox(g)) && !(offHalf(prev) && offHalf(p))) segs.push(prev[0], prev[1], p[0], p[1]);
      prev = p;
      prevG = g;
    }
  };
  if (el.type === 'way' && el.geometry) add(el.geometry);
  if (el.type === 'relation' && el.members) {
    for (const m of el.members) if (m.type === 'way' && m.geometry) add(m.geometry);
  }
  if (!segs.length) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < segs.length; i += 2) {
    const x = segs[i], y = segs[i + 1];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  return { segs, minx, miny, maxx, maxy, tags: el.tags || {} };
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
  let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function boxDist(f, px, py) {
  const dx = Math.max(f.minx - px, 0, px - f.maxx), dy = Math.max(f.miny - py, 0, py - f.maxy);
  return Math.hypot(dx, dy);
}
function nearestLine(list, px, py, limit = MEASURE_LIMIT) {
  let best = Infinity;
  for (const f of list) {
    if (boxDist(f, px, py) > Math.min(best, limit)) continue;
    const s = f.segs;
    for (let i = 0; i < s.length; i += 4) {
      const d = segDist(px, py, s[i], s[i + 1], s[i + 2], s[i + 3]);
      if (d < best) best = d;
    }
  }
  return best <= limit ? best : Infinity;
}
// Like nearestLine, but also returns the nearest point, so we know which way it lies.
function nearestLinePoint(list, px, py, limit = MEASURE_LIMIT) {
  let best = Infinity, bx = 0, by = 0;
  for (const f of list) {
    if (boxDist(f, px, py) > Math.min(best, limit)) continue;
    const s = f.segs;
    for (let i = 0; i < s.length; i += 4) {
      const x1 = s[i], y1 = s[i + 1], dx = s[i + 2] - x1, dy = s[i + 3] - y1, L = dx * dx + dy * dy;
      let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = x1 + t * dx, qy = y1 + t * dy, d = Math.hypot(px - qx, py - qy);
      if (d < best) { best = d; bx = qx; by = qy; }
    }
  }
  return best <= limit ? { d: best, x: bx, y: by } : null;
}
// Compass direction from one point to another: 0 north, 90 east, 180 south, 270 west.
const bearingTo = (px, py, qx, qy) => (Math.atan2(qx - px, qy - py) * 180 / Math.PI + 360) % 360;

// Even-odd ray casting over all segments, so multipolygons with holes work too.
function inside(f, px, py) {
  if (px < f.minx || px > f.maxx || py < f.miny || py > f.maxy) return false;
  let c = false;
  const s = f.segs;
  for (let i = 0; i < s.length; i += 4) {
    const y1 = s[i + 1], y2 = s[i + 3];
    if ((y1 > py) !== (y2 > py)) {
      const x = s[i] + (py - y1) * (s[i + 2] - s[i]) / (y2 - y1);
      if (px < x) c = !c;
    }
  }
  return c;
}
function nearestPoint(list, px, py, skipKey) {
  let best = Infinity, item = null;
  for (const p of list) {
    if (p.key === skipKey) continue;
    const d = Math.hypot(p.x - px, p.y - py);
    if (d < best) { best = d; item = p; }
  }
  return { d: best, item };
}
function makeGrid(cell) { return { cell, m: new Map() }; }
function gridAdd(g, x, y) {
  const k = Math.floor(x / g.cell) + ',' + Math.floor(y / g.cell);
  let a = g.m.get(k);
  if (!a) { a = []; g.m.set(k, a); }
  a.push(x, y);
}
function gridScan(g, x, y, r) {
  const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell), span = Math.ceil(r / g.cell);
  let count = 0, nearest = Infinity;
  for (let i = cx - span; i <= cx + span; i++) {
    for (let j = cy - span; j <= cy + span; j++) {
      const a = g.m.get(i + ',' + j);
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

/* ---------- classification ---------- */

const isClosed = t => /^(private|no)$/.test(t.access || '');
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
function splitSections(json) {
  const s = { spots: [], pois: [], trees: [], bins: [], lines: [], areas: [] };
  let cur = null;
  for (const el of json.elements || []) {
    if (el.type === 'section') { cur = el.tags && el.tags.name; continue; }
    if (cur && s[cur]) s[cur].push(el);
  }
  return s;
}

/* ---------- analysis ---------- */

function analyse(json, center, R = SEARCH_RADIUS) {
  const sec = splitSections(json);
  sec.trees = [sec.trees.flatMap(el => (el.lat != null ? [el.lat, el.lon] : []))];
  sec.bins = [sec.bins.flatMap(el => (el.lat != null ? [el.lat, el.lon] : []))];
  return analyseSections(sec, center, R, R + 60 + 150);
}

function analyseSections(sec, center, R = SEARCH_RADIUS, clipHalf = null) {
  const proj = makeProj(center);

  const P = { drink: [], food: [], bike: [], view: [], shelter: [], stop: [], toilet: [], landmark: [] };
  const addPt = (list, el, extra) => {
    const c = coordOf(el);
    if (!c) return;
    const [x, y] = proj(c[0], c[1]);
    list.push(Object.assign({ x, y, key: el.type + '/' + el.id }, extra));
  };
  for (const el of sec.pois) {
    const t = el.tags || {};
    if (isClosed(t)) continue;
    if (t.amenity === 'drinking_water' && t.drinking_water !== 'no') addPt(P.drink, el);
    if ((t.amenity === 'fountain' || t.man_made === 'water_tap') && t.drinking_water === 'yes') addPt(P.drink, el);
    if (FOOD_LABEL[t.shop]) addPt(P.food, el, { label: FOOD_LABEL[t.shop] });
    if (t.amenity === 'bicycle_parking') addPt(P.bike, el);
    if (t.tourism === 'viewpoint') addPt(P.view, el);
    if (t.amenity === 'shelter') addPt(P.shelter, el);
    if (t.name && (t.historic || t.amenity === 'place_of_worship' || /^(attraction|museum|artwork)$/.test(t.tourism || '')
      || (t.amenity === 'fountain' && t.drinking_water !== 'yes'))) addPt(P.landmark, el, { label: t.name });
    if (t.highway === 'bus_stop' || t.railway === 'tram_stop' || t.public_transport === 'platform') addPt(P.stop, el, { label: stopLabel(t) });
  }
  for (const el of sec.spots) {
    const t = el.tags || {};
    if (t.amenity === 'toilets' && !isClosed(t)) addPt(P.toilet, el);
  }

  const trees = makeGrid(20), bins = makeGrid(20);
  for (const a of sec.trees) for (let i = 0; i < a.length; i += 2) gridAdd(trees, ...proj(a[i], a[i + 1]));
  for (const a of sec.bins) for (let i = 0; i < a.length; i += 2) gridAdd(bins, ...proj(a[i], a[i + 1]));

  const Lf = { road: [], promenade: [], rail: [], tram: [], river: [], stream: [], lake: [], pond: [], water: [], treerow: [] };
  for (const el of sec.lines) {
    const t = el.tags || {};
    let b = null;
    if (/^(pedestrian|footway|path)$/.test(t.highway || '')) b = 'promenade';
    else if (t.highway) b = 'road';
    else if (t.railway === 'tram') b = 'tram';
    else if (t.railway) b = 'rail';
    else if (t.waterway === 'stream') b = 'stream';
    else if (t.waterway) b = 'river';
    else if (t.natural === 'tree_row') b = 'treerow';
    else if (t.natural === 'water') b = waterKind(t);
    if (!b) continue;
    const f = buildFeature(el, proj, clipHalf);
    if (f) Lf[b].push(f);
  }

  const A = { park: [], garden: [], cemetery: [], forest: [] };
  for (const el of sec.areas) {
    const t = el.tags || {};
    let b = null;
    if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') b = 'cemetery';
    else if (t.leisure === 'park') b = 'park';
    else if (t.leisure === 'garden') b = (isClosed(t) || /^(residential|private)$/.test(t['garden:type'] || '')) ? null : 'garden';
    else if (t.landuse === 'forest' || t.natural === 'wood') b = 'forest';
    if (!b) continue;
    const f = buildFeature(el, proj, null);
    if (f) A[b].push(f);
  }

  const D = { P, Lf, A, trees, bins };
  const spots = [], seats = [];
  for (const el of sec.spots) {
    const t = el.tags || {};
    const kind = t.amenity === 'bench' ? 'bench' : t.leisure === 'picnic_table' ? 'table' : t.amenity === 'toilets' ? 'toilet' : null;
    if (!kind || isClosed(t)) continue;
    const c = coordOf(el);
    if (!c) continue;
    const [x, y] = proj(c[0], c[1]);
    const dist = Math.hypot(x, y);
    const id = el.type + '/' + el.id;
    const item = { id, el, kind, lat: c[0], lon: c[1], x, y, dist, tags: t, added: el.type === 'user' };
    if (kind === 'toilet') {
      if (dist > R) continue;
      const spot = {
        id, osmType: el.type, osmId: el.id, kind, lat: c[0], lon: c[1], dist, tags: t, added: false,
        members: [{ id, kind, lat: c[0], lon: c[1], added: false }], counts: { bench: 0, table: 0 }, hasBench: false, hasTable: false,
      };
      spot.m = measure(x, y, id, D);
      spot.text = describe(spot);
      spot.flags = flagsOf(spot.m);
      spots.push(spot);
    } else if (dist <= R + GROUP_RADIUS) {
      seats.push(item);
    }
  }

  // Group seats into spots. Each spot is a circle of GROUP_RADIUS around its first seat,
  // so a row of benches along a promenade becomes a row of spots instead of one long chain.
  // Older OpenStreetMap entries go first, so spots keep the same first seat over time.
  const rank = s => (s.added ? 2 : s.el.type === 'node' ? 0 : 1);
  seats.sort((a, b) => rank(a) - rank(b) || Number(a.el.id) - Number(b.el.id));
  const grid = new Map(), cell = GROUP_RADIUS;
  seats.forEach((s, i) => {
    const k = Math.floor(s.x / cell) + ',' + Math.floor(s.y / cell);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const used = new Uint8Array(seats.length);
  seats.forEach((seed, i) => {
    if (used[i]) return;
    used[i] = 1;
    const members = [seed];
    const cx = Math.floor(seed.x / cell), cy = Math.floor(seed.y / cell);
    for (let a = cx - 1; a <= cx + 1; a++) {
      for (let b = cy - 1; b <= cy + 1; b++) {
        for (const j of grid.get(a + ',' + b) || []) {
          if (used[j]) continue;
          if (Math.hypot(seats[j].x - seed.x, seats[j].y - seed.y) <= GROUP_RADIUS) { used[j] = 1; members.push(seats[j]); }
        }
      }
    }
    const mx = members.reduce((n, s) => n + s.x, 0) / members.length;
    const my = members.reduce((n, s) => n + s.y, 0) / members.length;
    const dist = Math.hypot(mx, my);
    if (dist > R) return;
    const counts = { bench: members.filter(s => s.kind === 'bench').length, table: members.filter(s => s.kind === 'table').length };
    const spot = {
      id: seed.id, osmType: seed.el.type, osmId: seed.el.id,
      kind: counts.bench ? 'bench' : 'table',
      lat: members.reduce((n, s) => n + s.lat, 0) / members.length,
      lon: members.reduce((n, s) => n + s.lon, 0) / members.length,
      dist, tags: groupTags(members), added: seed.added,
      members: members.map(s => ({ id: s.id, kind: s.kind, lat: s.lat, lon: s.lon, added: s.added })),
      counts, hasBench: counts.bench > 0, hasTable: counts.table > 0,
    };
    spot.m = combineMeasures(members.map(s => measure(s.x, s.y, s.id, D)));
    spot.text = describe(spot);
    spot.flags = flagsOf(spot.m);
    spot.estimate = estimateOf(spot);
    spots.push(spot);
  });
  spots.sort((a, b) => a.dist - b.dist);
  return spots;
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
  m.stopLabel = list.reduce((a, b) => (b.stop < a.stop ? b : a)).stopLabel;
  const wet = list.reduce((a, b) => (Math.min(b.lake, b.river) < Math.min(a.lake, a.river) ? b : a));
  m.waterDir = wet.waterDir;
  m.landmarkName = list.reduce((a, b) => (b.landmark < a.landmark ? b : a)).landmarkName;
  m.foodLabel = list.reduce((a, b) => (b.food < a.food ? b : a)).foodLabel;
  return m;
}
function groupTags(members) {
  if (members.length === 1) return members[0].tags;
  const benches = members.filter(s => s.kind === 'bench');
  const t = {};
  const backs = benches.map(s => s.tags.backrest);
  if (backs.length && backs.every(v => v === 'yes')) t.backrest = 'yes';
  else if (backs.some(v => v === 'yes')) t.backrest = 'some';
  else if (backs.length && backs.every(v => v === 'no')) t.backrest = 'no';
  const mats = benches.map(s => s.tags.material);
  if (mats.length && mats[0] && mats.every(v => v === mats[0])) t.material = mats[0];
  if (members.some(s => s.tags.covered === 'yes')) t.covered = 'yes';
  return t;
}

function measure(x, y, key, D) {
  const line = list => nearestLine(list, x, y);
  const near = list => nearestPoint(list, x, y, key);
  const m = {};
  m.lake = line(D.Lf.lake);
  m.river = line(D.Lf.river);
  // Which way the nearest lake or river lies, for "sunset over the water".
  const wl = nearestLinePoint(D.Lf.lake, x, y), wr = nearestLinePoint(D.Lf.river, x, y);
  const w = wl && (!wr || wl.d <= wr.d) ? wl : wr;
  m.waterDir = w ? Math.round(bearingTo(x, y, w.x, w.y)) : -1;
  m.stream = line(D.Lf.stream);
  m.promenade = line(D.Lf.promenade);
  m.pond = line(D.Lf.pond);
  m.water = line(D.Lf.water);
  m.inPark = D.A.park.some(f => inside(f, x, y));
  m.inGarden = D.A.garden.some(f => inside(f, x, y));
  m.inCemetery = D.A.cemetery.some(f => inside(f, x, y));
  m.inForest = D.A.forest.some(f => inside(f, x, y));
  m.forestEdge = line(D.A.forest);
  m.view = near(D.P.view).d;
  const lm = near(D.P.landmark);
  m.landmark = lm.d;
  m.landmarkName = lm.item ? lm.item.label : '';
  m.trees = gridScan(D.trees, x, y, RULES.shadeRadius).count;
  m.treeRow = line(D.Lf.treerow);
  m.shelter = near(D.P.shelter).d;
  m.road = line(D.Lf.road);
  m.rail = line(D.Lf.rail);
  m.tram = line(D.Lf.tram);
  const st = near(D.P.stop);
  m.stop = st.d;
  m.stopLabel = st.item ? st.item.label : 'Stop';
  m.drink = near(D.P.drink).d;
  m.toilet = near(D.P.toilet).d;
  const fd = near(D.P.food);
  m.food = fd.d;
  m.foodLabel = fd.item ? fd.item.label : 'Shop';
  m.bin = gridScan(D.bins, x, y, 60).nearest;
  m.bike = near(D.P.bike).d;
  return m;
}

/* ---------- the summary ---------- */

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
// Used before anyone has rated it, so a new town doesn't look empty.
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
// Returns null where the sun doesn't set that day.
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

// The nearest lake or river lies to the west, so looking at the water means looking at the sunset.
function sunsetWater(m) {
  const R = RULES;
  return (m.lake <= R.lake || m.river <= R.river) && m.waterDir >= R.sunsetFrom && m.waterDir <= R.sunsetTo;
}

// Yes/no features used by the filters.
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

// Raw measurements, shown when a spot is opened, for checking the rules.
function measuredRows(s) {
  const m = s.m, d = fmtDist;
  const inside = [m.inPark && 'park', m.inGarden && 'garden', m.inCemetery && 'cemetery', m.inForest && 'woods'].filter(Boolean);
  const rows = [
    ['Lake', d(m.lake)],
    ['River', d(m.river)],
    ['Stream', d(m.stream)],
    ['Pond or other water', d(Math.min(m.pond, m.water))],
    ['Inside', inside.length ? inside.join(', ') : 'no park, garden, cemetery or woods'],
    ['Forest edge', d(m.forestEdge)],
    ['Named footpath', d(m.promenade)],
    ['Viewpoint', d(m.view)],
    ['Landmark', m.landmarkName && isFinite(m.landmark) ? `${m.landmarkName}, ${d(m.landmark)}` : d(m.landmark)],
    ['Water lies to the', m.waterDir >= 0 ? compass(m.waterDir) + ` (${m.waterDir}°)` : 'no lake or river nearby'],
    [`Trees within ${RULES.shadeRadius} m`, String(m.trees)],
    ['Tree row', d(m.treeRow)],
    ['Shelter', d(m.shelter)],
    ['Main road', d(m.road)],
    ['Railway', d(m.rail)],
    ['Tram line', d(m.tram)],
    ['Bus or tram stop', d(m.stop)],
    ['Drinking water', d(m.drink)],
    ['Toilet', d(m.toilet)],
    ['Bakery or shop', d(m.food)],
    ['Bin', d(m.bin)],
    ['Bike parking', d(m.bike)],
  ];
  const keys = ['backrest', 'material', 'covered', 'seats', 'direction', 'fee', 'charge', 'opening_hours', 'wheelchair', 'changing_table', 'access'];
  const tags = keys.filter(k => s.tags[k]).map(k => `${k}=${s.tags[k]}`).join(', ');
  rows.push(['Mapped details', tags || 'none of the useful ones']);
  return rows;
}

module.exports = {RULES, SEARCH_RADIUS, GROUP_RADIUS, MEASURE_LIMIT, analyseSections, measure, describe, estimateOf, flagsOf, sunsetAt, sunsetWater, makeProj, buildFeature, groupTags, combineMeasures};

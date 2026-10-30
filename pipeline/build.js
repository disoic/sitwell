#!/usr/bin/env node
/* Builds Sitwell's static spot files from reduced OpenStreetMap extracts.

   node pipeline/build.js --work work --out site/data [--prev previous/data] [--regions pipeline/regions.json] [--only CH,HR]

   For each region it reads work/<CODE>.geojsonseq (made by pipeline/reduce.sh), groups seats into spots
   across the whole region, measures each spot's surroundings square by square, adds the passport place,
   and writes fingerprinted square files. Unchanged squares come out byte-identical, so publishing only
   uploads what changed and phones only re-download what changed. */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../core/core.js');
const { Region } = require('./lib/region.js');
const { Places, ownedSquares } = require('./lib/places.js');
const { publish } = require('./lib/publish.js');
const { Elevation } = require('./lib/dem.js');
const Horizon = require('./lib/horizon.js');

const args = {};
for (let k = 2; k < process.argv.length; k += 2) args[process.argv[k].replace(/^--/, '')] = process.argv[k + 1];
const WORK = args.work || 'work';
const OUT = args.out || 'site/data';
const CONFIG = JSON.parse(fs.readFileSync(args.regions || path.join(__dirname, 'regions.json'), 'utf8'));
const ONLY = args.only ? new Set(args.only.split(',')) : null;

// How far beyond a square's edge its surroundings are gathered, in metres.
const MARGIN = {
  point: C.LIMITS.point + C.GROUP_RADIUS + 20,   // amenities nearby
  trees: C.RULES.shadeRadius + C.GROUP_RADIUS + 5,
  bins: C.LIMITS.bin + C.GROUP_RADIUS + 5,
  line: C.LIMITS.road + C.GROUP_RADIUS + 35,     // roads are measured furthest
  area: C.LIMITS.line + C.GROUP_RADIUS + 35,     // parks and woods, and forest edges
  rays: C.RAYS.reach + C.GROUP_RADIUS + 85,      // open water for the sunset rays
};

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

// Horizons from the previous build, reused while a spot hasn't moved: terrain doesn't change.
function previousHorizons(prev) {
  const out = new Map(), dir = prev && path.join(prev, 'v1', 's');
  if (!dir || !fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    try { for (const r of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).spots) if (r.horizon) out.set(r.id, { lat: r.lat, lon: r.lon, h: r.horizon }); } catch (e) { /* skip */ }
  }
  return out;
}
const PREV_HORIZONS = previousHorizons(args.prev);

// Sunset spots (open water toward the sunset) get a horizon profile, so the app knows when hills hide the sun.
async function addHorizons(code, recs, stats) {
  const want = recs.filter(r => r.kind !== 'toilet' && r.rays && r.rays.some(v => v >= 150)), todo = [];
  for (const r of want) {
    const p = PREV_HORIZONS.get(r.id);
    if (p && C.metres(p.lat, p.lon, r.lat, r.lon) < 2) r.horizon = p.h; else todo.push(r);
  }
  stats.horizons = want.length - todo.length;
  if (!todo.length) { log(`${code}: ${stats.horizons} sunset horizons reused, none new`); return; }
  const dem = new Elevation({ cacheDir: path.join(WORK, 'dem') }), tiles = Horizon.tilesFor(todo);
  log(`${code}: ${todo.length} sunset spots need a horizon; loading ${tiles.length} elevation tiles`);
  await dem.load(tiles);
  let made = 0;
  for (const r of todo) { const h = Horizon.profile(dem, r.lat, r.lon); if (h) { r.horizon = h; made++; } }
  stats.horizons += made;
  log(`${code}: ${made} new horizons (${dem.fetched} tiles downloaded, ${dem.failed} unavailable), ${stats.horizons - made} reused`);
}

async function buildRegion(cfg, squares, allOwned, searchPlaces) {
  const file = path.join(WORK, cfg.code + '.geojsonseq');
  if (!fs.existsSync(file)) throw new Error(`${cfg.code}: ${file} is missing; run pipeline/prepare.sh first`);
  const region = new Region(cfg.code);
  await region.read(file);
  log(`${cfg.code}: read ${region.counts.features} features: ${region.seats.length} seats, ${region.points.length} points of interest, ` +
    `${region.trees.n / 2} trees, ${region.lines.length} lines, ${region.areas.length} areas, ${region.admins.length} boundaries`);
  region.index();

  const places = new Places(region.admins);
  const { owned, how } = ownedSquares(region, places, Object.assign({ polyFile: path.join(WORK, cfg.code + '.poly') }, cfg));
  log(`${cfg.code}: owns ${owned.size} squares (by ${how})`);

  // Seats grouped across the whole region, then each spot handled in the square of its first seat.
  const { groups, toilets } = region.spots();
  const bySquare = new Map();
  const add = (sq, item) => { if (!owned.has(sq)) return; (bySquare.get(sq) || bySquare.set(sq, []).get(sq)).push(item); };
  for (const g of groups) add(C.squareOf(g[0].lat, g[0].lon), { group: g });
  for (const t of toilets) add(C.squareOf(t.lat, t.lon), { toilet: t });
  const inOwned = [...bySquare.values()].reduce((n, l) => n + l.length, 0);
  log(`${cfg.code}: ${inOwned} spots and toilets in ${bySquare.size} of its squares (${groups.length + toilets.length} in the whole extract)`);

  const stats = { spots: 0, toilets: 0, rays: 0, sunsetWater: 0, places: 0, squares: bySquare.size, horizons: 0 };
  const regionRecs = [];
  let done = 0;
  for (const sq of [...bySquare.keys()].sort()) {
    if (squares.has(sq)) { console.warn(`  ${sq} already built by another region, skipped`); continue; }
    const input = region.gather(sq, MARGIN);
    const center = C.squareCenter(sq), box = C.squareBox(sq);
    const hx = (box[3] - box[1]) / 2 * 111320 * Math.cos(center.lat * Math.PI / 180), hy = (box[2] - box[0]) / 2 * 110574;
    const D = C.buildContext(input, center, {
      window: { x: hx + MARGIN.line, y: hy + MARGIN.line },
      rays: { x: hx + MARGIN.rays, y: hy + MARGIN.rays },
    });
    const placeIndex = new Map(), placeList = [], spots = [];
    const placeOf = (lat, lon) => {
      const p = places.placeAt(lat, lon);
      if (!p) return null;
      const key = JSON.stringify(p);
      if (!placeIndex.has(key)) { placeIndex.set(key, placeList.length); placeList.push(p); }
      return placeIndex.get(key);
    };
    for (const item of bySquare.get(sq)) {
      const s = item.group ? C.makeSpot(item.group, D) : C.makeToiletSpot(item.toilet, D);
      s.place = placeOf(s.lat, s.lon);
      if (s.place != null) stats.places++;
      if (s.kind === 'toilet') stats.toilets++; else stats.spots++;
      if (s.rays) { stats.rays++; if (s.rays.some(v => v >= 150)) stats.sunsetWater++; }
      spots.push(C.packSpot(s));
    }
    spots.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const r of spots) regionRecs.push(r);
    squares.set(sq, { spots, places: placeList });
    if (++done % 500 === 0) log(`${cfg.code}: ${done} of ${bySquare.size} squares`);
  }
  await addHorizons(cfg.code, regionRecs, stats);
  for (const sq of owned) allOwned.add(sq);
  const found = places.searchEntries(owned);
  for (const p of found) searchPlaces.push(p);
  stats.searchPlaces = found.length;
  log(`${cfg.code}: ${stats.spots} spots and ${stats.toilets} toilets measured; ${stats.rays} near water, ` +
    `${stats.sunsetWater} with open water toward the sunset; ${stats.places} with a passport place`);
  return stats;
}

(async () => {
  const squares = new Map(), owned = new Set(), stats = {}, searchPlaces = [];
  const regions = CONFIG.regions.filter(r => !ONLY || ONLY.has(r.code));
  for (const cfg of regions) stats[cfg.code] = await buildRegion(cfg, squares, owned, searchPlaces);
  const report = publish(OUT, squares, owned, { prev: args.prev, regions: regions.map(r => r.code), stats, places: searchPlaces });
  const s = report.squares;
  log(`wrote ${s.withSpots} square files (${(report.bytes / 1e6).toFixed(1)} MB before compression), ${s.covered} squares covered`);
  if (s.changed + s.added + s.removed + s.unchanged) {
    log(`compared with the previous build: ${s.changed} changed, ${s.added} new, ${s.removed} gone, ${s.unchanged} unchanged; ` +
      `seats ${report.seats.added} added, ${report.seats.removed} removed, ${report.seats.moved} moved`);
  }
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });

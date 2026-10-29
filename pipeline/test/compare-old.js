// Compares the pipeline's spots with what the prototype's core computes from the same map data.
// Run after build.js:  node pipeline/test/compare-old.js <work dir> <data dir> <CODE> [regions.json]
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../../core/core.js');
const old = require('./old-core.js');
const { Region } = require('../lib/region.js');

const [work, data, code, regionsFile] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(regionsFile || path.join(__dirname, 'regions.test.json'), 'utf8')).regions.find(r => r.code === code);

(async () => {
  const region = new Region(code);
  await region.read(path.join(work, code + '.geojsonseq'));

  // The same data in the shape the prototype got from Overpass.
  const el = (id, extra) => { const [type, n] = id.split('/'); return Object.assign({ type, id: Number(n) }, extra); };
  const geom = a => { const g = []; for (let k = 0; k < a.length; k += 2) g.push({ lat: a[k], lon: a[k + 1] }); return g; };
  const asWayOrRel = (id, tags, chains) => chains.length === 1
    ? el(id, { type: 'way', tags, geometry: geom(chains[0]) })
    : el(id, { type: 'relation', tags, members: chains.map(c => ({ type: 'way', geometry: geom(c) })) });
  const sec = {
    spots: region.seats.map(s => el(s.id, { lat: s.lat, lon: s.lon, tags: s.tags })),
    pois: region.points.map(p => {
      const tags = Object.assign({}, p.tags);
      if (!p.node) { delete tags.highway; delete tags.railway; delete tags.public_transport; } // stops were nodes only
      return el(p.id, { lat: p.lat, lon: p.lon, tags });
    }),
    trees: [Array.from(region.trees.a.subarray(0, region.trees.n))],
    bins: [Array.from(region.bins.a.subarray(0, region.bins.n))],
    lines: region.lines
      .filter(l => !/^tertiary/.test(l.tags.highway || '') && l.tags.natural !== 'coastline')  // not fetched by the prototype
      .map(l => asWayOrRel(l.id, Object.assign({}, l.tags, l.tags.name ? { name: 'x' } : {}), l.parts))
      .concat(region.areas.filter(a => a.tags.natural === 'water').map(a => asWayOrRel(a.id, a.tags, a.rings))),
    areas: region.areas.filter(a => a.tags.natural !== 'water' && C.areaRole(a.tags) !== 'swim').map(a => asWayOrRel(a.id, a.tags, a.rings)),
  };
  const lats = region.seats.map(x => x.lat), lons = region.seats.map(x => x.lon);
  const [s, w, n, e] = cfg.bbox || [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
  const center = { lat: (s + n) / 2, lon: (w + e) / 2 };
  const R = 20000;
  const oldSpots = old.analyseSections(sec, center, R, R + 5000);

  // The pipeline's spots for this region.
  const dir = path.join(data, 'v1', 's'), mine = new Map();
  for (const f of fs.readdirSync(dir)) {
    const file = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const rec of file.spots) mine.set(rec.id, C.unpackSpot(rec));
  }

  const NUM = ['lake', 'river', 'stream', 'promenade', 'pond', 'water', 'forestEdge', 'view', 'landmark', 'trees', 'treeRow',
    'shelter', 'road', 'rail', 'tram', 'stop', 'drink', 'toilet', 'food', 'bin', 'bike'];
  const BOOL = ['inPark', 'inGarden', 'inCemetery', 'inForest'];
  const lim = k => (['view', 'landmark', 'shelter', 'stop', 'drink', 'toilet', 'food', 'bike'].includes(k) ? C.LIMITS.point
    : k === 'bin' ? C.LIMITS.bin : k === 'trees' ? Infinity : C.LIMITS.line);
  const diffs = {}, examples = [];
  let compared = 0, sameGroups = 0, sameText = 0, sameEstimate = 0;
  for (const o of oldSpots) {
    const p = mine.get(o.id);
    if (!p) continue;
    compared++;
    const ids = x => x.members.map(m => m.id).sort().join(',');
    if (ids(o) === ids(p)) sameGroups++;
    for (const k of NUM) {
      let a = o.m[k], b = p.m[k];
      if (a > lim(k)) a = Infinity;
      // Distances are rounded up to whole metres, and projected around the square instead of the search centre.
      const tol = 0.1 + a * 0.003;
      const ok = (a === Infinity && b === Infinity) || (b >= a - tol && b <= a + 1 + tol);
      if (!ok) { diffs[k] = (diffs[k] || 0) + 1; if (examples.length < 12) examples.push(`${o.id} ${k}: prototype ${a.toFixed ? a.toFixed(1) : a}, pipeline ${b}`); }
    }
    for (const k of BOOL) if (o.m[k] !== p.m[k]) diffs[k] = (diffs[k] || 0) + 1;
    if (Math.min(o.m.lake, o.m.river) <= 250 && Math.abs(((o.m.waterDir - p.m.waterDir + 540) % 360) - 180) > 1) diffs.waterDir = (diffs.waterDir || 0) + 1;
    const pt = C.describe(p), ot = o.text;
    const words = t => JSON.stringify([t.sentence, t.comfort, t.note, t.facts.map(f => f.label), t.warnings.map(f => f.label)]);
    const near = (a, b) => a.every((f, k) => Math.abs(f.d - b[k].d) <= 1 + f.d * 0.003);
    if (words(pt) === words(ot) && near(pt.facts, ot.facts) && near(pt.warnings, ot.warnings)) sameText++;
    else if (process.env.DEBUG) console.log('  summary', o.id, JSON.stringify(ot), JSON.stringify(pt), 'waterDir', o.m.waterDir, p.m.waterDir, 'sea', p.m.sea);
    else if (examples.length < 12) examples.push(`${o.id} summary: prototype "${ot.sentence} ${ot.comfort}" pipeline "${pt.sentence} ${pt.comfort}"`);
    if (C.estimateOf(p) === (o.estimate === undefined ? null : o.estimate)) sameEstimate++;
    else if (process.env.DEBUG) console.log('  estimate', o.id, o.estimate, C.estimateOf(p), JSON.stringify(o.m), JSON.stringify(C.packMeasures(p.m)), JSON.stringify(o.tags), JSON.stringify(p.tags));
  }
  console.log(`${code}: ${oldSpots.length} spots from the prototype's core, ${mine.size} in the pipeline's files, ${compared} compared`);
  console.log(`  same seats grouped: ${sameGroups}/${compared}; same summary: ${sameText}/${compared}; same estimate: ${sameEstimate}/${compared}`);
  console.log(`  measurements that differ: ${Object.keys(diffs).length ? JSON.stringify(diffs) : 'none'}`);
  for (const x of examples) console.log('   ', x);
})();

// Checks that a square measured live on the phone (from an Overpass answer) matches the pipeline's
// static square. The Overpass answer is made from the same extract, with the same boxes the app asks for,
// and multipolygon rings split into pieces so the ring-joining is exercised too.
// Run: node test/check-live.js <work dir> <data dir> <CODE> <square> [save the answer to this file]
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const D = require('../app/data.js');
const { Region } = require('../pipeline/lib/region.js');

const [work, data, code, id, saveTo] = process.argv.slice(2);
(async () => {
  const region = new Region(code);
  await region.read(path.join(work, code + '.geojsonseq'));
  const b = D.liveBoxes(id);
  const inBox = (lat, lon, x) => lat >= x[0] && lat <= x[2] && lon >= x[1] && lon <= x[3];
  const touches = (bb, x) => bb[2] >= x[0] && bb[0] <= x[2] && bb[3] >= x[1] && bb[1] <= x[3];
  const split = sid => { const [type, n] = sid.split('/'); return { type, id: Number(n) }; };
  const geom = a => { const g = []; for (let k = 0; k < a.length; k += 2) g.push({ lat: a[k], lon: a[k + 1] }); return g; };
  const point = (sid, lat, lon, tags) => { const e = split(sid); return Object.assign(e, e.type === 'node' ? { lat, lon } : { center: { lat, lon } }, { tags }); };
  const area = (a) => {
    const e = split(a.id);
    if (e.type === 'way' && a.rings.length === 1) return Object.assign(e, { tags: a.tags, geometry: geom(a.rings[0]) });
    const members = [];
    for (const r of a.rings) {   // each ring in two open pieces, the second reversed
      const half = Math.max(2, Math.floor(r.length / 4) * 2);
      members.push({ type: 'way', geometry: geom(r.slice(0, half + 2)) });
      const rest = Array.from(r.slice(half)), rev = [];
      for (let k = rest.length - 2; k >= 0; k -= 2) rev.push(rest[k], rest[k + 1]);
      members.push({ type: 'way', geometry: geom(rev) });
    }
    return Object.assign(e, { type: 'relation', tags: a.tags, members });
  };
  const sec = name => ({ type: 'section', tags: { name } });
  const els = [sec('seats')];
  for (const s of region.seats) if ((s.kind !== 'toilet' && inBox(s.lat, s.lon, b.S)) || (s.kind === 'toilet' && inBox(s.lat, s.lon, b.P))) els.push(point(s.id, s.lat, s.lon, s.tags));
  els.push(sec('points'));
  for (const p of region.points) if (inBox(p.lat, p.lon, b.P)) els.push(point(p.id, p.lat, p.lon, p.tags));
  for (const [name, list, box] of [['trees', region.trees, b.T], ['bins', region.bins, b.B]]) {
    els.push(sec(name));
    for (let k = 0; k < list.n; k += 2) if (inBox(list.a[k], list.a[k + 1], box)) els.push({ type: 'node', id: k, lat: list.a[k], lon: list.a[k + 1] });
  }
  els.push(sec('lines'));
  for (const l of region.lines) if (!l.sea && touches(l.bbox, b.L)) for (const p of l.parts) els.push(Object.assign(split(l.id), { tags: l.tags, geometry: geom(p) }));
  els.push(sec('coast'));
  for (const l of region.lines) if (l.sea && touches(l.bbox, b.W)) for (const p of l.parts) els.push(Object.assign(split(l.id), { tags: l.tags, geometry: geom(p) }));
  els.push(sec('areas'));
  for (const a of region.areas) if (a.tags.natural !== 'water' && touches(a.bbox, b.A)) els.push(area(a));
  els.push(sec('water'));
  for (const a of region.areas) if (a.tags.natural === 'water' && touches(a.bbox, b.W)) els.push(area(a));
  els.push(sec('place'));
  const answer = { elements: els };
  if (saveTo) fs.writeFileSync(saveTo, JSON.stringify(answer));

  const live = D.buildLiveSquare(id, answer);
  const stat = JSON.parse(fs.readFileSync(path.join(data, 'v1', 's', id + '.json'), 'utf8'));
  const byId = new Map(stat.spots.map(s => [s.id, s]));
  let same = 0, measured = 0, diff = 0, rays = 0;
  const examples = [];
  for (const s of live.spots) {
    const t = byId.get(s.id);
    if (!t) continue;
    measured++;
    const canon = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
    const a = canon(s.m), c = canon(t.m);
    if (a === c) same++; else { diff++; if (examples.length < 4) examples.push(`${s.id}\n      live   ${a}\n      static ${c}`); }
    if (s.rays || t.rays) { assert.deepStrictEqual(s.rays, t.rays, 'rays differ for ' + s.id); rays++; }
  }
  console.log(`${code} square ${id}: Overpass-style answer with ${els.length} elements`);
  console.log(`  live: ${live.spots.length} spots; static: ${stat.spots.length}; ${measured} in both`);
  console.log(`  identical measurements: ${same}/${measured}; identical sunset rays: ${rays}`);
  for (const e of examples) console.log('   ', e);
  assert(measured >= stat.spots.length * 0.9, 'most static spots appear live too');
  assert.strictEqual(diff, 0, 'live and static measurements differ');
  console.log('live square matches the pipeline');
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });

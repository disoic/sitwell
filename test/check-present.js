// Checks the app's presentation logic and prints sample summaries from built spot files.
// Run: node test/check-present.js [data dir]
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const C = require('../core/core.js');
const P = require('../app/present.js');

// 1. Where the sun sets over Zurich: about 306 degrees at midsummer, 234 at midwinter.
{
  const at = (d) => P.sunsetBearing(new Date(d), 47.37, 8.54);
  const jun = at('2026-06-21T12:00Z'), dec = at('2026-12-21T12:00Z'), mar = at('2026-03-20T12:00Z');
  assert(Math.abs(jun - 306) < 2 && Math.abs(dec - 234) < 2 && Math.abs(mar - 270) < 3, `sunset bearings ${jun} ${dec} ${mar}`);
  const alt = P.sunPosition(C.sunsetAt(new Date('2026-06-21T12:00Z'), 47.37, 8.54), 47.37, 8.54).altitude;
  assert(Math.abs(alt + 0.83) < 0.3, `sun altitude at sunset ${alt}`);
  console.log(`Zurich sunset bearings: June ${jun.toFixed(1)}°, March ${mar.toFixed(1)}°, December ${dec.toFixed(1)}°; altitude at sunset ${alt.toFixed(2)}°`);
}

// 2. Season wording.
assert.strictEqual(P.seasonPhrase([4, 5, 6, 7, 8, 9]), ' from April to September');
assert.strictEqual(P.seasonPhrase([10, 11, 12, 1, 2]), ' from October to February');
assert.strictEqual(P.seasonPhrase([3, 9]), ' in spring and autumn');
assert.strictEqual(P.seasonPhrase([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), '');
console.log('season wording ok');

// 3. The score: estimate as the starting point, real ratings take over.
{
  const s = e => ({ kind: 'bench', estimate: e });
  assert.strictEqual(P.score(s(4.2), { n: 2, sum: 10 }).value, 4.5);
  assert.strictEqual(P.band(P.score(s(4.2), { n: 2, sum: 10 })), 'lovely');
  assert.strictEqual(P.band(P.score(s(4.8), null)), null, 'an estimate alone is never Lovely');
  assert.strictEqual(P.score(s(2.0), { n: 1, sum: 5 }).value, 2.8);
  assert.strictEqual(P.band(P.score(s(2.0), { n: 6, sum: 30 })), 'nice');
  console.log('score: promising spot + two 5-star ratings = 4.5 (Lovely); plain spot + one 5-star = 2.8; estimate alone never Lovely');
}

// 3b. Wording: a named path in the woods is "by a footpath", elsewhere "on a promenade".
{
  const woods = C.unpackSpot({ id: 'node/1', kind: 'bench', lat: 47.37, lon: 8.54, m: { promenade: 5, inForest: 1 } });
  const town = C.unpackSpot({ id: 'node/2', kind: 'bench', lat: 47.37, lon: 8.54, m: { promenade: 5 } });
  assert(/by a footpath/.test(P.describe(woods).sentence) && /on a promenade/.test(P.describe(town).sentence));
  console.log('wording: "' + P.describe(woods).sentence + '" / "' + P.describe(town).sentence + '"');
}

// 4. Real spots from the built files, when there are any (the workflow runs this after each build).
const dir = path.join(process.argv[2] || 'site/data', 'v1', 's');
if (!fs.existsSync(dir)) { console.log('no spot files to sample; presentation checks passed'); process.exit(0); }
const spots = [];
for (const f of fs.readdirSync(dir)) for (const rec of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).spots) spots.push(P.prepare(C.unpackSpot(rec)));
const benches = spots.filter(s => s.kind !== 'toilet');
const sunsetSpots = benches.filter(s => s.text.sunsetMonths.length);
console.log(`\n${spots.length} spots; ${sunsetSpots.length} with sunsets over open water in some months; ` +
  `looks promising: ${P.promising(benches).size} (the prototype's fixed rule: ${benches.filter(s => C.estimateOf(s) >= C.PROMISING_FROM).length})`);
const show = s => {
  const t = s.text, f = t.facts.map(x => `${x.label} ${C.fmtDist(x.d)}`).join(', '), w = t.warnings.map(x => `${x.label} ${C.fmtDist(x.d)}`).join(', ');
  console.log(`  [${s.estimate}] ${t.sentence} ${t.comfort}${f ? '\n        Nearby: ' + f : ''}${w ? '\n        Note: ' + w : ''}`);
};
const sample = (list, n) => list.filter((s, k) => k % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n);
console.log('\nSunset spots:');
sample(sunsetSpots, 5).forEach(show);
console.log('\nOther spots:');
sample(benches.filter(s => !s.text.sunsetMonths.length && (s.text.facts.length > 2 || s.text.warnings.length)), 6).forEach(show);

// 5. Best right now around a sunset spot: a rainy afternoon, then a clear evening shortly before sunset
//    in a month when that spot faces the sunset.
const centre = sunsetSpots[0] || benches[0];
if (centre) {
  const at = { lat: centre.lat, lon: centre.lon };
  const near = benches.filter(s => C.metres(at.lat, at.lon, s.lat, s.lon) < 1500);
  const month = centre.text.sunsetMonths.length ? centre.text.sunsetMonths[Math.floor(centre.text.sunsetMonths.length / 2)] : 9;
  const sunset = C.sunsetAt(new Date(Date.UTC(new Date().getUTCFullYear(), month - 1, 15, 12)), at.lat, at.lon);
  const clear = { precip: 0, low: 10, mid: 30, high: 40, temp: 18 };
  for (const [label, ctx] of [
    ['rainy afternoon', { now: new Date(sunset - 5 * 3600000), at, weather: { temp: 15, precip: 1.2, low: 90, mid: 80, high: 50 } }],
    [`clear evening in ${['January','February','March','April','May','June','July','August','September','October','November','December'][month - 1]}, 40 min before sunset`,
      { now: new Date(sunset - 40 * 60000), at, weather: clear, sunset: { at: sunset, outlook: P.sunsetOutlook(clear) } }],
  ]) {
    console.log(`\nBest right now, ${label}${ctx.sunset ? ' (' + ctx.sunset.outlook.label + ')' : ''}:`);
    for (const r of P.rankNow(near, ctx).slice(0, 3)) console.log(`  ${r.value}  ${r.minutes} min  ${r.reasons.join(', ') || '-'}  ${r.spot.text.sentence}`);
  }
}
console.log('\nall presentation checks passed');

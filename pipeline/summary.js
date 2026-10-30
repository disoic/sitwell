#!/usr/bin/env node
// Prints a short Markdown summary of a build for the GitHub job page.
//   node pipeline/summary.js site/data >> "$GITHUB_STEP_SUMMARY"
'use strict';
const path = require('path');
const r = require(path.resolve(process.argv[2] || 'site/data', 'v1', 'report.json'));
const n = x => Number(x).toLocaleString('en');
const out = [`### Spot files built ${r.built}`, ''];
out.push('| Region | Spots | Toilets | Near water | Open water toward sunset | With hills measured | With passport place |', '|---|---:|---:|---:|---:|---:|---:|');
for (const [code, s] of Object.entries(r.regions)) {
  out.push(`| ${code} | ${n(s.spots)} | ${n(s.toilets)} | ${n(s.rays)} | ${n(s.sunsetWater)} | ${n(s.horizons || 0)} | ${n(s.places)} |`);
}
const q = r.squares, t = r.seats;
out.push('', `${n(q.withSpots)} square files (${(r.bytes / 1e6).toFixed(1)} MB before compression), ${n(q.covered)} squares covered.`);
if (q.changed + q.added + q.removed + q.unchanged) {
  out.push(`Since the last build: ${n(q.changed)} squares changed, ${n(q.added)} new, ${n(q.removed)} gone, ${n(q.unchanged)} unchanged.`);
  out.push(`Seats: ${n(t.added)} added, ${n(t.removed)} removed, ${n(t.moved)} moved.`);
}
console.log(out.join('\n'));

// Checks the field guide: pages, souvenir rules and passport, on a made-up history.
// Run: node test/check-guide.js
'use strict';
const assert = require('assert');
const C = require('../core/core.js');
const G = require('../app/guide.js');

const Z = { lat: 47.355, lon: 8.553 }, day = 86400000;
const at = (iso) => new Date(iso).getTime();
const seefeld = { v: 3, country: 'Switzerland', code: 'CH', town: 'Zürich', district: 'Kreis 8', neighbourhood: 'Seefeld', districts: 12, neighbourhoods: 34 };
const wipkingen = Object.assign({}, seefeld, { district: 'Kreis 10', neighbourhood: 'Wipkingen' });
const samobor = { v: 3, country: 'Croatia', code: 'HR', town: 'Samobor', district: '', neighbourhood: '' };
const sunsetTime = C.sunsetAt(new Date('2026-10-20T12:00Z'), Z.lat, Z.lon).getTime();
const ev = [
  { type: 'checkin', t: at('2026-10-05T14:00Z'), spot: 'node/1', lat: Z.lat, lon: Z.lon, rating: 5, kind: 'bench', where: 'Lakeside bench in a park.', place: seefeld, first: true },
  { type: 'checkin', t: at('2026-10-06T14:00Z'), spot: 'node/2', lat: 47.39, lon: 8.52, rating: 4, kind: 'bench', where: 'Riverside group of 2 benches.', place: wipkingen, first: true },
  { type: 'checkin', t: at('2026-10-07T14:00Z'), spot: 'node/3', lat: 47.37, lon: 8.54, rating: 3, kind: 'bench', where: 'Bench.', place: seefeld, first: true },
  { type: 'checkin', t: sunsetTime - 30 * 60000, spot: 'node/4', lat: Z.lat, lon: Z.lon + 0.001, rating: 5, kind: 'bench', where: 'Lakeside bench with sunsets over the lake from April to September.', place: seefeld, first: true },
  { type: 'checkin', t: at('2026-10-21T10:00Z'), spot: 'node/5', lat: 45.8, lon: 15.7, rating: 'okay', kind: 'toilet', where: 'Public toilet.' },
  { type: 'add', t: at('2026-10-22T10:00Z'), id: 'user/100', lat: 45.80, lon: 15.71, kind: 'table', rating: 4, place: samobor },
  { type: 'add', t: at('2026-10-23T10:00Z'), id: 'user/200', lat: 45.80, lon: 15.72, kind: 'bench', rating: 2 },
  { type: 'remove', t: at('2026-10-23T11:00Z'), id: 'user/200' },
  { type: 'rate', t: at('2026-10-05T15:00Z'), spot: 'node/1', rating: 4 },
  { type: 'tags', t: at('2026-10-05T15:01Z'), spot: 'node/1', tags: ['view', 'fortwo'] },
  { type: 'checkin', t: at('2026-11-05T14:00Z'), spot: 'node/1', lat: Z.lat, lon: Z.lon, rating: 5, kind: 'bench', where: 'Lakeside bench in a park.', revisit: true },
];
const g = G.build(ev, { sentenceFor: p => (p.key === 'user/100' ? 'Picnic table in the woods.' : '') });
const by = k => g.pages.find(p => p.key === k);
const show = p => `${p.key.padEnd(9)} ${String(p.rating).padEnd(2)} ${p.settings.join(',').padEnd(16)} ${p.souvenir ? p.souvenir.caption : '-'}`;
g.pages.forEach(p => console.log(' ', show(p)));
assert.strictEqual(g.pages.length, 5, 'toilets and removed benches have no page');
assert.strictEqual(by('node/1').souvenir.kind, 'pebble', 'first lake: pebble, before the autumn chestnut');
assert.strictEqual(by('node/1').rating, 5, 'the latest rating counts');
assert.deepStrictEqual(by('node/1').tags, ['view', 'fortwo']);
assert.strictEqual(by('node/1').visits, 2);
assert.strictEqual(by('node/2').souvenir.caption, 'A feather from Wipkingen');
assert.strictEqual(by('node/3').souvenir.kind, 'chestnut', 'the first page of autumn with nothing else gets the chestnut');
assert.strictEqual(by('node/4').souvenir.kind, 'watercolour', 'a sunset spot rated half an hour before sunset');
assert.strictEqual(by('user/100').souvenir.kind, 'pinecone', 'a picnic table you added in the woods: one souvenir per page, the first new kind wins');
assert.strictEqual(g.found, 5);
assert.strictEqual(g.passport[0].town, 'Zürich');
assert.strictEqual(g.passport[0].parts, 2);
assert.strictEqual(g.passport[0].total, 34);
console.log(`  shelf: ${g.found} of ${g.shelf.length} kinds; passport: ${g.passport.map(t => `${t.town} ${t.parts}${t.total ? ' of ' + t.total + ' ' + t.unit : ''}`).join('; ')}; ${g.places} places`);
assert.deepStrictEqual(JSON.stringify(G.build(ev, { sentenceFor: p => (p.key === 'user/100' ? 'Picnic table in the woods.' : '') })), JSON.stringify(g), 'the same history always gives the same guide');

// Now and then: after the first lake, about one lakeside page in five holds a pebble.
const many = [];
for (let k = 0; k < 400; k++) many.push({ type: 'checkin', t: at('2026-07-01T10:00Z') + k * day / 10, spot: 'node/' + (1000 + k), lat: Z.lat, lon: Z.lon, rating: 4, kind: 'bench', where: 'Lakeside bench.', first: true });
const h = G.build(many), pebbles = h.pages.filter(p => p.souvenir).length;
console.log(`  400 summer lakeside pages: ${pebbles} souvenirs (${(pebbles / 400 * 100).toFixed(0)}%)`);
assert(pebbles > 50 && pebbles < 110, 'about one in five');
for (const k of G.KINDS) assert(G.svg(k.id, 24).startsWith('<svg'), k.id);
console.log('field guide checks passed');

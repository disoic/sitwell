// Drives the whole app in a simulated browser (jsdom) with real spot files and a stand-in map.
// Needs jsdom:  npm install jsdom   Then:  node test/smoke.js <built data dir> [path to jsdom]
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, ResourceLoader, VirtualConsole } = require(process.argv[3] || 'jsdom');
const C = require('../core/core.js');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.resolve(process.argv[2] || 'site/data');
const SITE = '/tmp/sitwell-smoke-site';
fs.rmSync(SITE, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'app'), SITE, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'core/core.js'), path.join(SITE, 'core.js'));
fs.cpSync(DATA, path.join(SITE, 'data'), { recursive: true });
const ORIGIN = 'http://sitwell.test/';
const file = url => path.join(SITE, decodeURIComponent(new URL(url).pathname));

class Loader extends ResourceLoader {
  fetch(url) {
    if (url.endsWith('maplibre-gl.js')) return Promise.resolve(Buffer.from('/* the stand-in map is set up before the page */'));
    return Promise.resolve(fs.readFileSync(file(url)));
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FORECAST = (() => {   // a clear evening: high clouds, no rain, 18 degrees
  const t0 = Math.floor(Date.now() / 3600000) * 3600 - 24 * 3600, time = [], n = 72;
  for (let k = 0; k < n; k++) time.push(t0 + k * 3600);
  const fill = v => new Array(n).fill(v);
  return { hourly: { time, temperature_2m: fill(18), precipitation: fill(0), cloud_cover_low: fill(10), cloud_cover_mid: fill(30), cloud_cover_high: fill(40) } };
})();

async function openApp(hash = '', start = { lat: 43.725, lon: 7.4165 }, seed = []) {
  const errors = [], shared = [], vc = new VirtualConsole();
  // The simulator can't draw on a canvas (phones can); the app already copes with that.
  vc.on('jsdomError', e => { if (!/HTMLCanvasElement.prototype.getContext/.test(e.message)) errors.push(e.stack || e.message); });
  vc.on('error', e => errors.push(String(e)));
  let watcher = null;
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: ORIGIN + hash, runScripts: 'dangerously', resources: new Loader(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem('sitwell.located.v1', 'true');
      if (seed.length) w.localStorage.setItem('pause.events.v1', JSON.stringify(seed));
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.open = () => null;
      w.fetch = async url => {
        const u = new URL(url, ORIGIN);
        if (u.hostname === 'api.open-meteo.com') return { ok: true, status: 200, json: async () => FORECAST };
        const f = file(u.href);
        if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) };
      };
      Object.defineProperty(w.navigator, 'geolocation', { value: {
        watchPosition(ok) { watcher = ok; setTimeout(() => ok({ coords: { latitude: start.lat, longitude: start.lon, accuracy: 10, speed: 0, heading: null } }), 20); return 1; },
        clearWatch() {},
      } });
      w.navigator.share = async d => { shared.push(d); };
      w.maplibregl = {
        Map: class {
          constructor(o) { this.h = {}; this.src = {}; this.layers = []; this.c = o.center; this.z = o.zoom; this.filters = {}; this.touchZoomRotate = { disableRotation() {} }; w.__map = this; setTimeout(() => this.emit('load'), 5); }
          on(ev, a, b) { const k = b ? ev + ':' + a : ev; (this.h[k] = this.h[k] || []).push(b || a); }
          emit(ev, e) { (this.h[ev] || []).forEach(f => f(e || {})); }
          getStyle() { return { layers: [{ id: 'bg', type: 'background' }, { id: 'water', type: 'fill', 'source-layer': 'water' }, { id: 'poi', type: 'symbol', 'source-layer': 'poi' }] }; }
          setPaintProperty() {} setLayoutProperty() {} addControl() {} addImage() {} hasImage() { return false; }
          setFilter(id, f) { this.filters[id] = f; }
          addSource(id, s) { this.src[id] = { data: s.data, setData(d) { this.data = d; } }; }
          getSource(id) { return this.src[id]; }
          addLayer(l) { this.layers.push(l); }
          easeTo(o) { this.c = o.center; if (o.zoom) this.z = o.zoom; setTimeout(() => this.emit('moveend'), 1); }
          getZoom() { return this.z; }
          getCenter() { return { lng: this.c[0], lat: this.c[1] }; }
          getCanvas() { return { style: {} }; }
        },
        AttributionControl: class {},
      };
    },
  });
  const w = dom.window;
  await new Promise(r => w.addEventListener('load', r));
  await sleep(400);
  const move = async (lat, lon, acc = 8) => { watcher({ coords: { latitude: lat, longitude: lon, accuracy: acc, speed: 0, heading: null } }); await sleep(150); };
  const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
  const click = async el => { assert(el, 'nothing to click'); el.click(); await sleep(120); };
  const sheet = () => w.document.body.dataset.sheet;
  const text = s => ($(s) || {}).textContent || '';
  return { dom, w, $, $$, click, move, sheet, text, errors, shared };
}

(async () => {
  const log = (...a) => console.log('  ', ...a);

  // 1. First open in Monaco, with one rating saved by the prototype nearby.
  const dir = path.join(DATA, 'v1', 's');
  const monaco = [];
  for (const f of fs.readdirSync(dir)) for (const r of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).spots) if (r.lat < 44 && r.kind !== 'toilet') monaco.push(r);
  const old = monaco[0];
  const seed = [{ type: 'checkin', t: Date.now() - 5 * 86400000, spot: old.id, lat: old.lat, lon: old.lon, rating: 'lovely', value: 2, first: true }];
  const a = await openApp('', undefined, seed);
  console.log('Main screen');
  assert.strictEqual(a.sheet(), 'peek');
  const cards = a.$$('#sheet-body .card');
  assert.strictEqual(cards.length, 3, 'three cards in the panel');
  log('title:', a.text('#sheet-body h1'), '| context:', a.text('#sheet-body .context'));
  for (const c of cards) log('card:', c.querySelector('.t').textContent, '|', c.querySelector('.r').textContent, '|', c.querySelector('.time').textContent.trim());
  const feats = a.w.__map.getSource('spots').data.features;
  log(`map: ${feats.length} spots drawn, ${feats.filter(f => f.properties.promising).length} with the gold ring, ${feats.filter(f => f.properties.lovely).length} with a heart (the prototype's rating)`);
  assert(feats.some(f => f.properties.lovely), 'the old rating shows as a heart');

  // 2. Cycling, filters, the list.
  await a.click(a.$('[data-act="mode"][data-v="bike"]'));
  await new Promise(r => setTimeout(r, 300));
  log('cycling times:', a.$$('#sheet-body .card .time').map(e => e.textContent.trim()).join(', '));
  await a.click(a.$('[data-act="filter"][data-f="sunset"]'));
  log('Sunset filter:', a.$$('#sheet-body .card').length, 'cards;', a.text('#sheet-body .note') || a.text('#sheet-body .context'));
  await a.click(a.$('[data-act="filter"][data-f="sunset"]'));
  await a.click(a.$('[data-act="filter"][data-f="toilet"]'));
  log('Toilet filter:', a.text('#sheet-body h1'), '|', a.$$('#sheet-body .card .t').slice(0, 2).map(e => e.textContent).join(' / '));
  await a.click(a.$('[data-act="filter"][data-f="toilet"]'));
  await a.click(a.$('#handle'));
  assert.strictEqual(a.sheet(), 'list');
  log('list:', a.$$('#sheet-body .card').length, 'cards; then', a.text('#sheet-body .linkish'));
  await a.click(a.$('#handle'));
  assert.strictEqual(a.sheet(), 'peek');

  // 3. The spot card, saving, meet me here.
  await a.click(a.$('#sheet-body .card'));
  assert.strictEqual(a.sheet(), 'spot');
  console.log('Spot card');
  log(a.text('#sheet-body h2'), '|', a.text('#sheet-body .status'));
  log(a.text('#sheet-body .sentence'), a.text('#sheet-body .comfort'));
  log('nearby:', a.$$('#sheet-body .row').map(r => r.textContent.trim().replace(/\s+/g, ' ')).join('; '));
  log('hint:', a.$$('#sheet-body .hint')[0].textContent);
  await a.click(a.$('[data-act="save"]'));
  assert.strictEqual(JSON.parse(a.w.localStorage.getItem('sitwell.saved.v1')).length, 1);
  await a.click(a.$('[data-act="meet"]'));
  assert.strictEqual(a.sheet(), 'meet');
  log('meet options:', a.$$('#sheet-body .option').map(o => o.textContent.trim().replace(/\s+/g, ' ')).join(' | '));
  await a.click(a.$('[data-act="share"][data-when="30"]'));
  assert.strictEqual(a.shared.length, 1);
  const invite = a.shared[0];
  log('shared:', invite.text, invite.url.replace(ORIGIN, '/'));
  assert(/#meet=/.test(invite.url));
  await a.click(a.$('[data-act="close"]'));
  assert.strictEqual(a.sheet(), 'peek');

  // 4. Arriving at a spot: the prompt, one-tap rating, tags.
  console.log('Arriving');
  const target = monaco.find(r => r.id !== old.id && r.members);
  await a.move(target.lat, target.lon);
  assert.strictEqual(a.sheet(), 'arrive', 'the arrival prompt opens');
  log(a.text('#sheet-body h2'), '|', a.text('#sheet-body .sub'), '|', a.$$('#sheet-body .star-btn .w').map(e => e.textContent).join(', '));
  await a.click(a.$('[data-act="rate"][data-n="5"]'));
  log(a.text('#sheet-body .saved-line'));
  await a.click(a.$('[data-act="tag"][data-tag="sunset"]'));
  await a.click(a.$('[data-act="tag"][data-tag="fortwo"]'));
  const evs = JSON.parse(a.w.localStorage.getItem('pause.events.v1'));
  const mine = evs.filter(e => e.spot === target.id);
  log('saved events:', mine.map(e => `${e.type}${e.rating ? ' ' + e.rating : ''}${e.tags ? ' [' + e.tags.join(',') + ']' : ''}${e.place ? ' place:' + (e.place.town || '-') : ''}`).join('; '));
  assert(mine.some(e => e.type === 'checkin' && e.rating === 5 && e.first), 'a first check-in in the prototype format');
  assert(mine.some(e => e.type === 'tags' && e.tags.includes('fortwo')));
  await a.click(a.$('[data-act="close"]'));
  await a.move(target.lat + 0.00001, target.lon);
  assert.notStrictEqual(a.sheet(), 'arrive', 'not asked again right away');

  // 5. My spots.
  await a.click(a.$('#mine'));
  console.log('My spots');
  log(a.$$('#sheet-body .list-title, #sheet-body .option').map(e => e.textContent.trim().replace(/\s+/g, ' ')).slice(0, 6).join(' | '));
  await a.click(a.$('[data-act="close"]'));

  // 6. Place search.
  console.log('Search');
  a.$('#q').dispatchEvent(new a.w.Event('focus'));
  await new Promise(r => setTimeout(r, 200));
  a.$('#q').value = 'rous';
  a.$('#q').dispatchEvent(new a.w.Event('input'));
  log('results for "rous":', a.$$('#results button').map(b => b.textContent.trim()).join(', '));
  await a.click(a.$('#results button[data-lat]'));
  await new Promise(r => setTimeout(r, 300));
  log('after choosing it: centre', a.w.__map.getCenter().lat.toFixed(4), a.w.__map.getCenter().lng.toFixed(4), '| first card:', a.text('#sheet-body .card .t'), '|', a.text('#sheet-body .card .time').trim());
  assert(a.errors.length === 0, 'errors: ' + a.errors.join('\n'));

  // 7. Opening the invitation link a friend received.
  const b = await openApp(invite.url.replace(ORIGIN, ''), { lat: 43.75, lon: 7.44 });
  console.log('Invitation');
  assert.strictEqual(b.sheet(), 'invite');
  log(b.text('#sheet-body h2'), '|', b.text('#sheet-body .when'), '|', b.text('#sheet-body .place'));
  log(b.text('#sheet-body .invite .sentence'));
  assert(b.text('#sheet-body .place') && !/map above/.test(b.text('#sheet-body .place')), 'the invited spot is found');
  await b.click(b.$('[data-act="explore"]'));
  assert.strictEqual(b.sheet(), 'peek');
  assert(b.errors.length === 0, 'errors: ' + b.errors.join('\n'));
  console.log('\nsmoke test passed: no errors');
  process.exit(0);
})().catch(e => { console.error('\nSMOKE TEST FAILED:', e.stack || e.message); process.exit(1); });

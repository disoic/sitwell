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
const ORIGIN = 'http://sitwell.test/';
let SITE = '/tmp/sitwell-smoke-site';
function buildSite(data, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'app'), dir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'core/core.js'), path.join(dir, 'core.js'));
  fs.cpSync(data, path.join(dir, 'data'), { recursive: true });
}
buildSite(DATA, SITE);
const file = url => path.join(SITE, decodeURIComponent(new URL(url).pathname));
// Overpass answers by square, from files saved by test/check-live.js; other squares come back empty.
const LIVE_ANSWERS = {};
let overpassCalls = 0;

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
      w.fetch = async (url, init) => {
        const u = new URL(url, ORIGIN);
        if (/overpass/.test(u.hostname)) {
          overpassCalls++;
          const q = decodeURIComponent(String(init && init.body || '').replace(/^data=/, '').replace(/\+/g, ' '));
          const m = /is_in\(([-\d.]+),([-\d.]+)\)/.exec(q), sq = m ? C.squareOf(Number(m[1]), Number(m[2])) : '';
          const answer = LIVE_ANSWERS[sq] || { elements: [] };
          return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(answer)) };
        }
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
      Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async x => { global.__clip = x; }, readText: async () => global.__clip || '' } });
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
  const move = async (lat, lon, acc = 8, speed = 0) => { watcher({ coords: { latitude: lat, longitude: lon, accuracy: acc, speed, heading: null } }); await sleep(150); };
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
  const a = await openApp('?dwell=0.02', undefined, seed);
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
  assert.notStrictEqual(a.sheet(), 'arrive', 'not asked the moment you get there');
  await sleep(1400);
  await a.move(target.lat, target.lon);
  assert.strictEqual(a.sheet(), 'arrive', 'asked after staying a while');
  log('not this spot?', a.$$('[data-act="arrive-other"]').map(b => b.textContent.trim().replace(/\s+/g, ' ')).join(' | ') || '(no other spot within reach)');
  const pick = a.$(`[data-act="arrive-other"][data-id="${target.id}"]`);
  if (pick) { await a.click(pick); log('switched to the spot you are really at'); }
  log(a.text('#sheet-body h2'), '|', a.text('#sheet-body .sub'), '|', a.$$('#sheet-body .star-btn .w').map(e => e.textContent).join(', '));
  await a.click(a.$('[data-act="rate"][data-n="5"]'));
  log(a.text('#sheet-body .saved-line'), '|', a.text('#sheet-body .found').trim() || '(no souvenir on this page)');
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
  // 8. Outside the static files: Utrecht is left out of this build, so its squares load live from Overpass.
  const liveFile = process.argv[4] || '/tmp/live-UT-1735_113.json';
  LIVE_ANSWERS['1735_113'] = JSON.parse(fs.readFileSync(liveFile, 'utf8'));
  SITE = '/tmp/sitwell-smoke-noUT';
  buildSite(path.join(path.dirname(DATA), '..', 'site-noUT', 'data'), SITE);
  const seatsUT = LIVE_ANSWERS['1735_113'].elements.filter(e => e.tags && (e.tags.amenity === 'bench' || e.tags.leisure === 'picnic_table'))
    .map(e => (e.lat != null ? { lat: e.lat, lon: e.lon } : { lat: e.center.lat, lon: e.center.lon }));
  let here = null;   // a place in that square at least 60 m from any mapped bench
  for (let la = 52.052; la < 52.078 && !here; la += 0.0007) for (let lo = 5.09; lo < 5.125 && !here; lo += 0.0007) {
    if (Math.min(...seatsUT.map(p => C.metres(la, lo, p.lat, p.lon))) > 60) here = { lat: la, lon: lo };
  }
  overpassCalls = 0;
  const u = await openApp('?dwell=0.02', here);
  await sleep(600);
  console.log('Live squares (Utrecht, not in this build)');
  log(`Overpass asked ${overpassCalls} times (one per square around you); ${u.$$('#sheet-body .card').length} cards`);
  for (const c of u.$$('#sheet-body .card').slice(0, 2)) log('card:', c.querySelector('.t').textContent, '|', c.querySelector('.r').textContent, '|', c.querySelector('.time').textContent.trim());
  assert(u.$$('#sheet-body .card').length >= 2, 'spots from the live square show up');

  // A tram isn't a bike: two fixes at 54 km/h keep walking times, two at 22 km/h switch to cycling.
  const pressed = () => u.$('[data-act="mode"][aria-pressed="true"]').dataset.v;
  await u.move(here.lat, here.lon, 8, 15); await u.move(here.lat, here.lon, 8, 15);
  assert.strictEqual(pressed(), 'walk', 'a tram ride does not count as cycling');
  await u.move(here.lat, here.lon, 8, 6); await u.move(here.lat, here.lon, 8, 6);
  await sleep(400);
  assert.strictEqual(pressed(), 'bike', 'cycling speed switches to cycling');
  log('54 km/h: walking; 22 km/h:', u.text('#toast') || 'cycling');
  await u.click(u.$('[data-act="mode"][data-v="walk"]'));

  // 9. Adding a missing bench where you stand.
  await u.click(u.$('#mine'));
  await u.click(u.$('[data-act="add-start"]'));
  assert.strictEqual(u.sheet(), 'add');
  assert(!u.$('#crosshair').hidden, 'the cross shows');
  console.log('Adding a bench');
  log('status:', u.text('#add-status'));
  await u.click(u.$('[data-act="add-kind"][data-v="table"]'));
  await u.click(u.$('[data-act="add-kind"][data-v="bench"]'));
  await u.click(u.$('[data-act="add-back"][data-v="yes"]'));
  await u.click(u.$('[data-act="add-rate"][data-n="4"]'));
  const before = overpassCalls;
  await u.click(u.$('[data-act="add-save"]'));
  await sleep(300);
  log(u.text('#sheet-body h2'), '|', u.$$('#sheet-body .comfort')[0].textContent);
  const added = JSON.parse(u.w.localStorage.getItem('pause.events.v1')).find(e => e.type === 'add');
  log('saved:', JSON.stringify({ type: added.type, id: added.id, kind: added.kind, tags: added.tags, rating: added.rating }));
  assert(added && added.kind === 'bench' && added.rating === 4 && added.tags.backrest === 'yes');
  assert(overpassCalls > before, 'its surroundings were looked up');
  const pinm = JSON.parse(u.w.localStorage.getItem('sitwell.pinm.v1'))[added.id];
  log('its surroundings:', JSON.stringify(pinm.m).slice(0, 140) + '…');
  await u.click(u.$('[data-act="close"]'));
  assert(u.w.__map.getSource('spots').data.features.some(f => f.properties.id === added.id), 'the new bench is on the map');
  // Too close to it now: adding another right here is refused.
  await u.click(u.$('#mine'));
  await u.click(u.$('[data-act="add-start"]'));
  log('second try, same place:', u.text('#add-status'));
  assert(/already a bench/.test(u.text('#add-status')));
  await u.click(u.$('[data-act="close"]'));
  // Open it, then remove it.
  u.w.document.querySelector('#sheet-body').dispatchEvent(new u.w.Event('click'));
  const card = u.$$('#sheet-body .card').find(c => /added/i.test(c.textContent)) || null;
  await u.click(u.$('#mine'));
  await u.click(u.$$('#sheet-body .page-row').find(o => /you added/i.test(o.textContent)));
  log('its page:', u.text('#sheet-body h2'), '|', u.text('#sheet-body .rating').trim(), '|', u.text('#sheet-body .sentence'));
  await u.click(u.$('[data-act="goto"]'));
  await sleep(300);
  log('its card:', u.text('#sheet-body h2'), '|', u.text('#sheet-body .status'), '|', u.text('#sheet-body .sentence'));
  await u.click(u.$('[data-act="remove-pin"]'));
  assert(!u.w.__map.getSource('spots').data.features.some(f => f.properties.id === added.id), 'removed from the map');
  void card;

  // 10. The home-screen offer after rating, where the browser offers installing.
  const ev = new u.w.Event('beforeinstallprompt');
  let prompted = false;
  ev.prompt = () => { prompted = true; };
  ev.userChoice = Promise.resolve({ outcome: 'accepted' });
  u.w.dispatchEvent(ev);
  const near = u.w.__map.getSource('spots').data.features[0].geometry.coordinates;
  await u.move(near[1], near[0]);
  await sleep(1400);
  await u.move(near[1], near[0]);
  assert.strictEqual(u.sheet(), 'arrive', 'asked after staying a while');
  {
    await u.click(u.$('[data-act="rate"][data-n="3"]'));
    log('after rating:', u.text('#sheet-body .install p').slice(0, 80) + '…');
    await u.click(u.$('[data-act="install"]'));
    assert(prompted, 'the install prompt was shown');
  }
  // 11. Moving the history to a fresh browser (like the home-screen app on an iPhone).
  await u.click(u.$('#mine'));
  await u.click(u.$('[data-act="copy-history"]'));
  const fresh = await openApp('', here);
  const countBefore = JSON.parse(fresh.w.localStorage.getItem('pause.events.v1') || '[]').length;
  await fresh.click(fresh.$('#mine'));
  await fresh.click(fresh.$('[data-act="paste-history"]'));
  await sleep(200);
  const countAfter = JSON.parse(fresh.w.localStorage.getItem('pause.events.v1') || '[]').length;
  console.log('Moving the history');
  log(`fresh browser: ${countBefore} entries before pasting, ${countAfter} after; toast: ${fresh.text('#toast')}`);
  assert(countAfter > countBefore, 'history pasted');
  await fresh.click(fresh.$('[data-act="paste-history"]'));
  assert.strictEqual(JSON.parse(fresh.w.localStorage.getItem('pause.events.v1')).length, countAfter, 'pasting twice adds nothing');
  assert(u.errors.length === 0 && fresh.errors.length === 0, 'errors: ' + u.errors.concat(fresh.errors).join('\n'));

  // 12. The field guide: a wish after a quiet week, the shelf, a page, sharing it, and opening a shared page.
  SITE = '/tmp/sitwell-smoke-site';
  const quiet = [{ type: 'checkin', t: Date.now() - 10 * 86400000, spot: old.id, lat: old.lat, lon: old.lon, rating: 5, kind: 'bench', where: 'Seaside group of 2 benches in a garden.', first: true }];
  const f = await openApp('', undefined, quiet);
  console.log('Field guide');
  log('wish in the panel:', f.text('#sheet-body .wish').trim() || '(none)');
  assert(f.$('#sheet-body .wish'), 'a wish shows after a quiet week');
  await f.click(f.$('#mine'));
  assert.strictEqual(f.sheet(), 'mine');
  log(f.text('#sheet-body h2'), '|', f.$$('#sheet-body .comfort')[0].textContent, '|', f.$$('#sheet-body .hint')[0].textContent);
  log('shelf:', f.$$('#sheet-body .shelf .k').map(k => (k.classList.contains('missing') ? '(' : '') + k.textContent.trim() + (k.classList.contains('missing') ? ')' : '')).join(', '));
  assert.strictEqual(f.$$('#sheet-body .shelf .k').length, 13);
  await f.click(f.$('#sheet-body .page-row'));
  assert.strictEqual(f.sheet(), 'page');
  log('page:', f.text('#sheet-body .date'), '|', f.text('#sheet-body h2'), '|', f.text('#sheet-body .rating').trim(), '|', f.text('#sheet-body .pressed').trim() || '(no souvenir)');
  await f.click(f.$('[data-act="share-page"]'));
  await sleep(200);
  assert.strictEqual(f.shared.length, 1, 'the page was shared');
  const pageLink = f.shared[0].url;
  log('shared:', f.shared[0].text.slice(0, 70) + '…', pageLink.replace(ORIGIN, '/'));
  assert(/#spot=/.test(pageLink));
  const g2 = await openApp(pageLink.replace(ORIGIN, ''), { lat: 43.75, lon: 7.44 });
  log('a friend opens it:', g2.sheet(), '|', g2.text('#sheet-body h2'), '| map stays at', g2.w.__map.getCenter().lat.toFixed(3));
  assert.strictEqual(g2.sheet(), 'spot', 'the shared page opens its spot');
  assert(Math.abs(g2.w.__map.getCenter().lat - old.lat) < 0.01, 'the map stays on the shared spot');
  assert(f.errors.length === 0 && g2.errors.length === 0, 'errors: ' + f.errors.concat(g2.errors).join('\n'));
  console.log('\nsmoke test passed: no errors');
  process.exit(0);
})().catch(e => { console.error('\nSMOKE TEST FAILED:', e.stack || e.message); process.exit(1); });

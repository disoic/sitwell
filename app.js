/* ============================================================
   Sitwell app: the map, the panel, the spot card, arriving and rating,
   meet-me-here invitations, My spots and place search.
   Spots come from the published squares (data.js), what the app says about them from
   present.js, and measuring and the file format from core.js.
   ============================================================ */
(function () {
  'use strict';
  const C = window.SitwellCore, P = window.SitwellPresent, D = window.SitwellData, G = window.SitwellGuide;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const TEST = new URLSearchParams(location.search).has('test');   // ?test: check in without being there
  // How long you stay at a spot before the app asks how it is (minutes; ?dwell= changes it for testing).
  const DWELL = (Number(new URLSearchParams(location.search).get('dwell')) || 10) * 60000;
  const ZURICH = { lat: 47.3686, lon: 8.5392 };
  const RADIUS = { walk: 1600, bike: 4500 };
  const SPEED = { walk: 80, bike: 250 };   // metres per minute
  const GAME = { checkinRadius: 40, accuracySlack: 25, maxAccuracy: 75, rateWindowHours: 24,
    addMaxDistance: 40, addMinGap: 15, addsPerDay: 10, addMaxAccuracy: 30 };
  const KEYS = { events: 'pause.events.v1', saved: 'sitwell.saved.v1', mode: 'sitwell.mode.v1', located: 'sitwell.located.v1',
    pins: 'sitwell.pinm.v1', install: 'sitwell.install.v1', wishNo: 'sitwell.wishno.v1', dwell: 'sitwell.dwell.v1' };
  const WORDS = { seat: ['Not worth it', 'Meh', 'Okay', 'Nice', 'Lovely'], toilet: ['Avoid', 'Grim', 'Okay', 'Clean', 'Spotless'] };
  const TAGS = [['view', 'View'], ['quiet', 'Quiet'], ['sunset', 'Sunset'], ['fortwo', 'For two'], ['shade', 'Shade'], ['sun', 'Sunny'], ['picnic', 'Picnics'], ['kids', 'Kids']];
  const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
  const OVERLAYS = ['spot', 'arrive', 'meet', 'mine', 'invite', 'add', 'page'];

  /* ---------- icons ---------- */
  const PATHS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    tree: '<path d="M12 21v-5M6.5 16h11L14 11h2L12 3.5 8 11h2z"/>',
    roof: '<path d="M3 10.5 12 5l9 5.5M6 9.5V19M18 9.5V19M4 19h16"/>',
    water: '<path d="M3 9c2 0 2-1.5 4.5-1.5S9.5 9 12 9s2-1.5 4.5-1.5S18.5 9 21 9M3 15c2 0 2-1.5 4.5-1.5S9.5 15 12 15s2-1.5 4.5-1.5S18.5 15 21 15"/>',
    table: '<path d="M4 9h16M7 9l-2.5 9M17 9l2.5 9M3.5 14h17"/>',
    bench: '<path d="M4 10h16M5 14h14M6 10V7M18 10V7M6 14v4M18 14v4"/>',
    rain: '<path d="M7 14a4.5 4.5 0 0 1 .6-9 5.5 5.5 0 0 1 10.3 2A3.5 3.5 0 0 1 17.5 14z"/><path d="M8 17.5l-1 2.5M12 17.5l-1 2.5M16 17.5l-1 2.5"/>',
    heat: '<path d="M10 13.5V5a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0z"/><path d="M12 9v6"/>',
    moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5z"/>',
    walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M9.5 21l2.5-6.5 3 2.5V21M8 12l3-4.5 3.5 3 2.5 1M11 7.5 9.5 14"/>',
    bike: '<circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16 9.5 9h5l4 7M9.5 9l3 7H5.5M13 6h2.5l-1 3"/>',
    back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    bookmark: '<path d="M7 4h10v16l-5-3.5L7 20z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    drop: '<path d="M12 3.5c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.5-6 5.5-10z"/>',
    cup: '<path d="M5 9h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5c-.6 1 .6 2-.2 3M12 3.5c-.6 1 .6 2-.2 3"/>',
    shop: '<path d="M5 8h14l-1.2 11H6.2zM9 8V6.5a3 3 0 0 1 6 0V8"/>',
    fire: '<path d="M12 21c-3.5 0-6-2.3-6-5.5 0-3 2.2-4.7 3.5-7 .5 1.6 1.4 2.6 2.5 3 0-2.7 1-5.4 3-7 .4 3 4 5.5 4 9.5 0 3.7-3.2 7-7 7z"/>',
    play: '<path d="M4 20V5h16v15M8 5v9M16 5v9M6.5 14h3M14.5 14h3"/>',
    bin: '<path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13"/>',
    warn: '<path d="M12 4 21 19H3z"/><path d="M12 10v4M12 17v.5"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  function icon(name, size = 22, color = 'currentColor', width = 1.8, fill = 'none') {
    return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
  }
  const RING = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B8860B" stroke-width="3"><circle cx="12" cy="12" r="8"/></svg>';
  const WC = '<span class="wc-mark" aria-hidden="true">WC</span>';

  /* ---------- what you did, kept on the phone (the prototype's format, so old history counts) ---------- */
  const getLS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const setLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: this visit only */ } };
  let events = getLS(KEYS.events, []);
  if (!Array.isArray(events)) events = [];
  let saved = getLS(KEYS.saved, []);
  if (!Array.isArray(saved)) saved = [];
  function record(e) { events.push(e); setLS(KEYS.events, events); return e; }
  const OLD_WORDS = { lovely: 5, okay: 3, notgreat: 2, clean: 4, avoid: 1 };
  function normRating(r) {
    if (r === 'closed' || typeof r === 'number') return r;
    if (typeof r === 'string' && /^[1-5]$/.test(r)) return Number(r);
    return OLD_WORDS[r] || null;
  }
  // Your rating, tags and visits for a spot: matched by its id, a seat's id, or within 15 m of a seat.
  function myInfo(s) {
    if (s._mine && s._mine.n === events.length) return s._mine;
    const ids = new Set([s.id].concat(s.members.map(m => m.id)));
    let rating = null, rt = -1, tags = [], tt = -1, visited = false, lastVisit = 0;
    for (const e of events) {
      const mine = (e.spot && ids.has(e.spot)) || (e.id && ids.has(e.id)) ||
        (e.lat != null && s.members.some(m => C.metres(e.lat, e.lon, m.lat, m.lon) <= C.GROUP_RADIUS));
      if (!mine) continue;
      const t = e.t || 0;
      if (e.type === 'checkin' || e.type === 'add') { visited = true; lastVisit = Math.max(lastVisit, t); }
      if ((e.type === 'checkin' || e.type === 'rate' || e.type === 'add') && e.rating != null && t >= rt) { rating = normRating(e.rating); rt = t; }
      if (e.type === 'vote' && t >= rt) { rating = e.v === 1 ? 5 : e.v === -1 ? 2 : rating; rt = t; }
      if (e.type === 'tags' && t >= tt) { tags = e.tags || []; tt = t; }
    }
    return (s._mine = { n: events.length, rating, ratedAt: rt, tags, visited, lastVisit });
  }
  const wordFor = (r, kind) => (r === 'closed' ? 'Closed or locked' : (kind === 'toilet' ? WORDS.toilet : WORDS.seat)[r - 1] || '');
  const isSaved = s => saved.some(x => x.id === s.id);

  /* ---------- state ---------- */
  const source = D.createSource({ store: D.idbStore() });
  const state = {
    user: null, center: null, centerIsUser: false, locDenied: false,
    mode: getLS(KEYS.mode, 'walk') === 'bike' ? 'bike' : 'walk',
    filter: null, moreFilters: false, sort: 'best', shown: 12,
    spots: [], byId: new Map(), ranked: [], promising: new Set(),
    sheet: 'peek', base: 'peek', pushed: false, selected: null, arrive: null, dismissed: new Set(),
    weather: null, weatherKey: '', weatherTime: 0, sunset: null, outlook: null,
    loading: true, uncovered: false, error: '', invite: null, pendingOpen: null,
    placeList: null, fastFixes: 0, autoBike: false, lastRankAt: 0, programmatic: false,
    liveLoading: 0, liveError: '', add: null, pad: null, pageKey: null, keepView: false,
  };

  /* ---------- small helpers ---------- */
  const hhmm = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const lowerFirst = s => (s ? s[0].toLowerCase() + s.slice(1) : s);
  const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  function bearing(a, b) {
    const kx = Math.cos(a.lat * Math.PI / 180);
    return (Math.atan2((b.lon - a.lon) * kx, b.lat - a.lat) * 180 / Math.PI + 360) % 360;
  }
  const origin = () => (state.centerIsUser && state.user ? state.user : state.center);
  const minutesLabel = m => (m < 1 ? '1 min' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);
  function nearestSeat(s, p) { return Math.min(...s.members.map(m => C.metres(p.lat, p.lon, m.lat, m.lon))); }
  function atSpot(s) {
    if (TEST) return true;
    const u = state.user;
    return !!u && u.acc <= GAME.maxAccuracy && nearestSeat(s, u) <= GAME.checkinRadius + Math.min(u.acc, GAME.accuracySlack);
  }
  const ready = s => { if (!s.text) P.prepare(s); return s; };
  function findSpot(p) {
    if (!p) return null;
    if (p.id && state.byId.has(p.id)) return state.byId.get(p.id);
    let best = null, bd = 30;
    for (const s of state.spots) { const d = nearestSeat(s, p); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  /* ---------- names and reasons ---------- */
  function titleOf(s) {
    const m = s.m, t = s.tags || {}, nb = s.counts.bench, nt = s.counts.table;
    let noun;
    if (s.kind === 'toilet') noun = t.access === 'customers' ? 'Toilet for customers' : 'Public toilet';
    else if (nb && nt) noun = nb + nt > 2 ? 'Benches and picnic tables' : 'Bench and picnic table';
    else if (nt) noun = nt > 1 ? 'Picnic tables' : 'Picnic table';
    else noun = nb > 1 ? 'Benches' : 'Bench';
    let head = noun;
    if (s.kind !== 'toilet') {
      if (m.sea <= P.R.sea) head = 'Seaside ' + lowerFirst(noun);
      else if (m.lake <= P.R.lake) head = 'Lakeside ' + lowerFirst(noun);
      else if (m.river <= P.R.river) head = 'Riverside ' + lowerFirst(noun);
      else if (m.inForest) head = noun + ' in the woods';
      else if (m.inPark) head = noun + ' in a park';
      else if (m.inGarden) head = noun + ' in a garden';
      else if (m.view <= P.R.view) head = noun + ' with a view';
      else if (m.landmark <= P.R.landmark && m.landmarkName) head = noun + ' near ' + m.landmarkName;
    }
    const pl = s.placeInfo;
    const where = pl ? (pl.neighbourhood || pl.district || pl.town || '') : '';
    if (where && !head.includes(where)) return `${head}, ${where}`;
    // No neighbourhood known: a landmark close by tells similar spots apart.
    if (!where && s.kind !== 'toilet' && m.landmark <= P.R.landmark && m.landmarkName && !head.includes(m.landmarkName)) return `${head} near ${m.landmarkName}`;
    return head;
  }
  function reasonOf(s, r) {
    const out = [], m = s.m, why = r ? r.reasons : [];
    if (s.kind === 'toilet') {
      const t = s.tags || {};
      if (t.fee === 'no') out.push('Free');
      else if (t.fee === 'yes') out.push('Paid');
      if ((t.opening_hours || '').trim() === '24/7') out.push('open 24/7');
      if (t.wheelchair === 'yes') out.push('wheelchair accessible');
      const mine = myInfo(s).rating;
      if (mine != null) out.unshift('You said: ' + wordFor(mine, 'toilet'));
      return out.length ? out.slice(0, 2).join(', ').replace(/^./, c => c.toUpperCase()) : 'Public toilet';
    }
    if (why.includes('sunset')) {
      const g = P.sunGone(s, new Date());
      out.push(g && g.measured && g.early >= 3 ? `Sun leaves at ${hhmm(g.at)}, over ${P.waterWord(m)}` : 'Sunset over ' + P.waterWord(m));
    }
    if (why.includes('roofed')) out.push('Roofed');
    if (why.includes('shade')) out.push('Shaded');
    if (why.includes('sun')) out.push('In the sun');
    if (why.includes('lit')) out.push('Lit at night');
    const mine = myInfo(s);
    if (typeof mine.rating === 'number') out.push('You rated it ' + wordFor(mine.rating, s.kind));
    else if (state.promising.has(s.id)) out.push(out.length ? 'looks promising' : 'Looks promising');
    if (out.length < 2) {
      let extra = '';
      if (s.text.sunsetMonths.length && !why.includes('sunset')) extra = 'Sunsets over ' + P.waterWord(m);
      else if (m.view <= P.R.view) extra = 'With a view';
      else if (m.firepit <= P.R.firepit) extra = 'Fire pit nearby';
      else if (m.swim <= P.R.swim) extra = 'Swimming nearby';
      else if (s.flags.quiet && (m.inForest || m.inPark)) extra = 'Quiet';
      else if (s.flags.water) extra = 'By the water';
      if (extra) out.push(out.length ? lowerFirst(extra) : extra);
    }
    if (!out.length) {
      const f = s.text.facts[0];
      out.push(f ? `${f.label} ${C.fmtDist(f.d)}` : s.text.warnings.length ? s.text.warnings[0].label + ' nearby' : 'Nothing notable mapped around it');
    }
    return out.slice(0, 2).join(', ');
  }
  function tileOf(s, r) {
    const why = r ? r.reasons : [];
    if (s.kind === 'toilet') return ['wc', WC];
    if (why.includes('sunset')) return ['sun', icon('sun')];
    if (why.includes('roofed')) return ['roof', icon('roof')];
    if (why.includes('shade') || s.m.inForest) return ['tree', icon('tree')];
    if (s.flags.water) return ['water', icon('water')];
    if (s.hasTable && !s.hasBench) return ['table', icon('table')];
    if (s.m.inPark || s.m.inGarden) return ['tree', icon('tree')];
    return ['bench', icon('bench')];
  }
  function factIcon(label) {
    if (label === 'Drinking water') return icon('drop', 20, '#2F6496');
    if (label === 'Toilet') return WC;
    if (/Café|Kiosk|Ice cream/.test(label)) return icon('cup', 20, '#7E4A1E');
    if (label === 'Fire pit') return icon('fire', 20, '#B35A12');
    if (label === 'Swimming') return icon('water', 20, '#2F6496');
    if (label === 'Playground') return icon('play', 20, '#2F5E43');
    if (label === 'Bin') return icon('bin', 20, '#5E5950');
    if (label === 'Bike parking') return icon('bike', 20, '#5E5950');
    return icon('shop', 20, '#5E5950');
  }
  function stars(n) {
    let h = '';
    for (let k = 1; k <= 5; k++) h += k <= n ? icon('star', 20, '#B8860B', 1.5, '#B8860B') : icon('star', 20, '#CFC8BA', 1.5);
    return h;
  }

  /* ---------- the sun and the weather ---------- */
  async function loadWeather(c) {
    const key = c.lat.toFixed(2) + ',' + c.lon.toFixed(2);
    if (state.weatherKey === key && Date.now() - state.weatherTime < 30 * 60000) return;
    state.weatherKey = key;
    state.weatherTime = Date.now();
    try {
      const r = await fetch(P.forecastUrl(c.lat, c.lon));
      if (!r.ok) throw new Error('forecast ' + r.status);
      state.weather = await r.json();
    } catch (e) { state.weather = null; }
    computeSunset();
    rank();
    drawSpots();
    renderSoft();
  }
  function computeSunset() {
    const c = state.center;
    if (!c) return;
    const now = new Date();
    let t = C.sunsetAt(now, c.lat, c.lon);
    if (t && now - t > 30 * 60000) t = C.sunsetAt(new Date(now.getTime() + 86400000), c.lat, c.lon);
    state.sunset = t;
    state.outlook = state.weather && t ? P.sunsetOutlook(P.forecastAt(state.weather, t)) : null;
  }
  const sunsetSoon = (now = new Date()) => !!state.sunset && (state.sunset - now) / 60000 <= 120 && (state.sunset - now) / 60000 >= -10;
  // A sun on the map: this spot's own sunset is within the next 90 minutes, over open water.
  function sunNow(s, now) {
    if (s.kind === 'toilet' || !s.rays) return false;
    const g = P.sunGone(s, now), m = g ? (g.at - now) / 60000 : Infinity;
    return m <= 90 && m >= -5 && P.sunsetToday(s, now);
  }
  function contextLine() {
    const now = new Date();
    if (navigator.onLine === false) return { icon: '', text: 'You’re offline. Spots you’ve opened before still show.' };
    if (state.filter === 'toilet') return { icon: '', text: 'Nearest toilets first.' };
    if (state.sort === 'near') return { icon: '', text: 'Nearest spots first.' };
    if (state.filter === 'sunset' && state.sunset) return { icon: icon('sun', 18, '#B35A12', 2), text: `Sunset around ${hhmm(state.sunset)}. These spots face it over open water; each card says when the sun leaves it.` };
    const w = state.weather ? P.forecastAt(state.weather, now) : null, sun = state.sunset;
    if (sun && sunsetSoon(now)) {
      const q = state.outlook ? state.outlook.quality : null;
      const any = state.ranked.some(r => r.reasons.includes('sunset'));
      if (q != null && q <= 0.1) return { icon: icon('sun', 18, '#B35A12', 2), text: `Sunset around ${hhmm(sun)}, but ${q === 0 ? 'rain is likely' : 'it looks overcast'}.` };
      const sky = q == null ? '' : q >= 1 ? ' with high clouds that could colour up' : q >= 0.8 ? ' with a clear sky' : ' with some clouds';
      return { icon: icon('sun', 18, '#B35A12', 2), text: any ? `The sun goes down soon${sky}, so sunset spots come first.` : `Sunset around ${hhmm(sun)}${sky}. No spots nearby face it over open water.` };
    }
    if (w && w.precip >= 0.2) return { icon: icon('rain', 18, '#2F6496', 2), text: "It's raining, so roofed spots come first." };
    if (w && w.temp >= 26) return { icon: icon('heat', 18, '#B35A12', 2), text: `It's ${Math.round(w.temp)}° out, so shady spots come first.` };
    if (w && w.temp <= 10 && Math.max(w.low, w.mid) < 50) return { icon: icon('sun', 18, '#B35A12', 2), text: "It's cold and clear, so sunny spots come first." };
    if (sun && now - sun > 30 * 60000) return { icon: icon('moon', 18, '#5E5950', 2), text: "It's dark, so lit spots come first." };
    return { icon: icon('sun', 18, '#B35A12', 2), text: sun ? `Sunset today at ${hhmm(sun)}.` : 'The nicest spots near you.' };
  }

  /* ---------- loading and ranking ---------- */
  let loadToken = 0;
  async function load(center) {
    const token = ++loadToken;
    state.center = { lat: center.lat, lon: center.lon };
    state.loading = true;
    state.error = '';
    $('#here').hidden = true;
    renderSoft();
    loadWeather(state.center);
    let r;
    try { r = await source.spotsAround(state.center, RADIUS[state.mode] + 300); } catch (e) { r = { spots: [], uncovered: [], failed: ['all'], error: e }; }
    if (token !== loadToken) return;
    state.loading = false;
    state.spots = r.spots.map(ready).concat(pinsNear(state.center, RADIUS[state.mode] + 300));
    state.byId = new Map(state.spots.map(s => [s.id, s]));
    state.liveLoading = r.pending.length;
    state.liveError = '';
    state.error = !r.spots.length && r.failed.length && !r.pending.length
      ? (navigator.onLine === false ? 'You’re offline, and this area hasn’t been opened before.' : 'Couldn’t load spots. Check your connection and try again.') : '';
    computeSunset();
    rank();
    drawSpots();
    if (r.pending.length) fetchLiveSquares(r.pending, token);
    measureMissingPins();
    if (state.invite && !state.invite.spot) {
      state.invite.spot = findSpot(state.invite);
      if (state.invite.spot) { state.selected = state.invite.spot.id; drawSpots(); }
    }
    if (state.pendingOpen) {
      const s = findSpot(state.pendingOpen);
      state.pendingOpen = null;
      if (s) { openSpot(s.id, true); return; }
    }
    render();
    checkArrival();
  }
  function passes(s) {
    const f = state.filter;
    if (f === 'toilet') return s.kind === 'toilet';
    if (s.kind === 'toilet') return false;
    switch (f) {
      case 'sunset': return P.sunsetToday(s, new Date()) || myInfo(s).tags.includes('sunset');
      case 'water': return s.flags.water;
      case 'quiet': return s.flags.quiet;
      case 'picnic': return s.hasTable || s.flags.firepit;
      case 'green': return s.flags.green;
      case 'firepit': return s.flags.firepit;
      case 'swim': return s.flags.swim;
      case 'roofed': return s.tags.covered === 'yes' || s.m.shelter <= P.R.shelter;
      case 'saved': return isSaved(s);
      case 'visited': return myInfo(s).visited;
      default: return true;
    }
  }
  function rank() {
    const at = origin();
    state.lastRankAt = Date.now();
    if (!at) { state.ranked = []; return; }
    const seats = state.spots.filter(s => s.kind !== 'toilet');
    state.promising = P.promising(seats, id => { const s = state.byId.get(id); return !!s && myInfo(s).rating != null; });
    const list = state.spots.filter(passes), speed = SPEED[state.mode];
    if (state.filter === 'toilet' || state.sort === 'near') {
      state.ranked = list.map(s => { const d = C.metres(at.lat, at.lon, s.lat, s.lon); return { spot: s, value: 0, d, minutes: d / speed, reasons: [] }; })
        .sort((a, b) => a.d - b.d);
      return;
    }
    const now = new Date(), bike = state.mode === 'bike', u = state.user;
    const ctx = { now, at, bike, weather: state.weather ? P.forecastAt(state.weather, now) : null, sunset: state.sunset ? { at: state.sunset, outlook: state.outlook } : null };
    const heading = bike && state.centerIsUser && u && u.speed > 2 && Number.isFinite(u.heading) ? u.heading : null;
    state.ranked = P.rankNow(list, ctx).map(r => {
      r.d = C.metres(at.lat, at.lon, r.spot.lat, r.spot.lon);
      r.minutes = r.d / speed;
      const mine = myInfo(r.spot).rating;
      if (typeof mine === 'number') r.value += (mine - (r.spot.estimate || 3)) * 0.5;   // your own stars count
      if (heading != null && r.d > 150 && angleDiff(bearing(at, r.spot), heading) > 100) r.value -= 0.8;   // behind you on the bike
      return r;
    }).sort((a, b) => b.value - a.value || a.d - b.d);
  }
  function timeLabel(r) {
    return state.centerIsUser && state.user ? minutesLabel(r.minutes) : C.fmtDist(r.d);
  }

  /* ---------- the map ---------- */
  let map = null, mapReady = false;
  const fc = features => ({ type: 'FeatureCollection', features });
  function initMap() {
    if (!window.maplibregl) return;
    try {
      map = new maplibregl.Map({ container: 'map', style: STYLE_URL, center: [ZURICH.lon, ZURICH.lat], zoom: 14.5,
        attributionControl: false, dragRotate: false, pitchWithRotate: false, maxPitch: 0 });
    } catch (e) { map = null; toast('The map couldn’t start on this device. The list still works.'); return; }
    if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.on('load', onMapLoad);
    map.on('moveend', onMoveEnd);
  }
  function calmStyle() {
    const layers = (map.getStyle() || {}).layers || [];
    for (const l of layers) {
      const sl = l['source-layer'] || '';
      try {
        if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#EEEAE2');
        else if (sl === 'water' && l.type === 'fill') map.setPaintProperty(l.id, 'fill-color', '#C8DBE3');
        else if (sl === 'waterway' && l.type === 'line') map.setPaintProperty(l.id, 'line-color', '#B9D0DA');
        else if (sl === 'park' && l.type === 'fill') map.setPaintProperty(l.id, 'fill-color', '#D6E3CB');
        else if (sl === 'landcover' && l.type === 'fill') map.setPaintProperty(l.id, 'fill-color', '#D9E4CF');
        else if (sl === 'landuse' && l.type === 'fill') map.setPaintProperty(l.id, 'fill-color', '#E9E5DC');
        else if (sl === 'building' && l.type === 'fill') map.setPaintProperty(l.id, 'fill-color', '#E3DED3');
        else if (sl === 'poi' && l.type === 'symbol') map.setLayoutProperty(l.id, 'visibility', 'none');
      } catch (e) { /* that layer doesn't take this property */ }
    }
  }
  function addImages() {
    const make = draw => {
      const c = document.createElement('canvas');
      c.width = c.height = 48;
      const g = c.getContext && c.getContext('2d');
      if (!g) return null;
      g.scale(2, 2);
      draw(g);
      return g.getImageData(0, 0, 48, 48);
    };
    const sun = make(g => {
      g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(12, 12, 10, 0, Math.PI * 2); g.fill();
      g.fillStyle = g.strokeStyle = '#C46A17'; g.beginPath(); g.arc(12, 12, 4, 0, Math.PI * 2); g.fill();
      g.lineWidth = 1.6; g.lineCap = 'round';
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        g.beginPath(); g.moveTo(12 + Math.cos(a) * 6, 12 + Math.sin(a) * 6); g.lineTo(12 + Math.cos(a) * 8, 12 + Math.sin(a) * 8); g.stroke();
      }
    });
    const heart = make(g => {
      if (typeof Path2D === 'undefined') return;
      const p = new Path2D('M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z');
      g.fillStyle = '#C4476A'; g.strokeStyle = '#FFFFFF'; g.lineWidth = 1.5; g.fill(p); g.stroke(p);
    });
    try {
      if (sun && !map.hasImage('sun')) map.addImage('sun', sun, { pixelRatio: 2 });
      if (heart && !map.hasImage('heart')) map.addImage('heart', heart, { pixelRatio: 2 });
    } catch (e) { /* the map still works without them */ }
  }
  function onMapLoad() {
    calmStyle();
    addImages();
    const kindColor = ['match', ['get', 'kind'], 'toilet', '#2F6496', 'table', '#A0672E', '#2F5E43'];
    map.addSource('spots', { type: 'geojson', data: fc([]) });
    map.addSource('me', { type: 'geojson', data: fc([]) });
    map.addLayer({ id: 'spots-ring', type: 'circle', source: 'spots', filter: ['==', ['get', 'promising'], true],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 6, 17, 12], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#B8860B', 'circle-stroke-width': 2.5 } });
    map.addLayer({ id: 'spots', type: 'circle', source: 'spots',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 17, 7], 'circle-color': kindColor, 'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2] } });
    map.addLayer({ id: 'spots-heart', type: 'symbol', source: 'spots', filter: ['==', ['get', 'lovely'], true],
      layout: { 'icon-image': 'heart', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    map.addLayer({ id: 'spots-sun', type: 'symbol', source: 'spots', filter: ['==', ['get', 'sun'], true],
      layout: { 'icon-image': 'sun', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-offset': [11, -11] } });
    map.addLayer({ id: 'spots-selected', type: 'circle', source: 'spots', filter: ['==', ['get', 'id'], ''],
      paint: { 'circle-radius': 10, 'circle-color': kindColor, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 3 } });
    map.addLayer({ id: 'spots-hit', type: 'circle', source: 'spots', paint: { 'circle-radius': 16, 'circle-opacity': 0 } });
    map.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 20, 'circle-color': '#2F6496', 'circle-opacity': 0.14 } });
    map.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 7, 'circle-color': '#2F6496', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 3 } });
    map.on('click', 'spots-hit', e => { const f = e.features && e.features[0]; if (f) openSpot(f.properties.id, false); });
    map.on('mouseenter', 'spots-hit', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'spots-hit', () => { map.getCanvas().style.cursor = ''; });
    map.on('move', () => { if (state.sheet === 'add') updateAddStatus(); });
    mapReady = true;
    drawSpots();
    drawMe();
  }
  function drawSpots() {
    if (!mapReady) return;
    const now = new Date(), soon = sunsetSoon(now);
    const shown = state.filter ? state.ranked.map(r => r.spot) : state.spots.filter(s => s.kind !== 'toilet');
    const features = shown.map(s => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { id: s.id, kind: s.kind === 'toilet' ? 'toilet' : s.hasBench ? 'bench' : 'table', promising: state.promising.has(s.id),
        lovely: myInfo(s).rating === 5, sun: soon && sunNow(s, now) },
    }));
    map.getSource('spots').setData(fc(features));
    map.setFilter('spots-selected', ['==', ['get', 'id'], state.selected || '']);
  }
  function drawMe() {
    if (!mapReady) return;
    const u = state.user;
    map.getSource('me').setData(fc(u ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [u.lon, u.lat] }, properties: {} }] : []));
  }
  function flyTo(c, zoom, instant) {
    if (!map) return;
    const desktop = window.matchMedia && window.matchMedia('(min-width: 900px)').matches;
    state.pad = desktop ? { left: 430, top: 0, right: 0, bottom: 0 } : { top: 70, bottom: sheetTarget(), left: 0, right: 0 };
    state.programmatic = true;
    map.easeTo({ center: [c.lon, c.lat], zoom: zoom || map.getZoom(), duration: instant ? 0 : 700, padding: state.pad });
  }
  // The panel's height once it has settled in the current mode (it animates, so measuring would be too early).
  function sheetTarget() {
    const H = window.innerHeight, m = state.sheet;
    if (m === 'peek') return 332;
    if (m === 'list') return H - 100;
    if (m === 'add') return Math.min(H * 0.56, 460);
    return Math.min(H * 0.8, 660);
  }
  function onMoveEnd() {
    if (state.sheet === 'add') updateAddStatus();
    if (state.programmatic) { state.programmatic = false; return; }
    if (!state.center || !map) return;
    const c = map.getCenter();
    $('#here').hidden = C.metres(c.lat, c.lng, state.center.lat, state.center.lon) < 700;
  }

  /* ---------- where you are ---------- */
  let watchId = null;
  function startLocation(fromButton) {
    if (!('geolocation' in navigator)) { if (fromButton) toast('This browser can’t share your location.'); return; }
    if (watchId != null) { if (state.user) recenter(); return; }
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  }
  function recenter() {
    state.centerIsUser = true;
    flyTo(state.user, Math.max(map ? map.getZoom() : 15, 15));
    load(state.user);
  }
  function onPosition(pos) {
    const c = pos.coords, first = !state.user;
    const prev = state.user;
    state.user = { lat: c.latitude, lon: c.longitude, acc: c.accuracy || 999, speed: c.speed, heading: c.heading };
    state.locDenied = false;
    setLS(KEYS.located, true);
    drawMe();
    autoBike(c.speed);
    if (first) {
      if (state.invite || state.keepView) { renderSoft(); return; }
      state.centerIsUser = true;
      flyTo(state.user, 15.5);
      load(state.user);
      return;
    }
    if (state.centerIsUser && C.metres(state.user.lat, state.user.lon, state.center.lat, state.center.lon) > 700) { load(state.user); return; }
    const moved = prev ? C.metres(prev.lat, prev.lon, state.user.lat, state.user.lon) : 0;
    if (moved > 40 || Date.now() - state.lastRankAt > 20000) { rank(); drawSpots(); renderSoft(); }
    checkArrival();
  }
  function onPositionError(err) {
    if (err && err.code === 1) {
      state.locDenied = true;
      if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
      toast('Location is off for Sitwell. Search a place instead.');
      renderSoft();
    }
  }
  // Switch to cycling once when the phone reports cycling speed twice in a row.
  function autoBike(speed) {
    // Cycling speed is 16 to 40 km/h; faster is a tram or a car, slower is walking.
    if (speed != null && speed >= 4.5 && speed <= 11) state.fastFixes++; else if (speed != null && (speed < 2 || speed > 11)) state.fastFixes = 0;
    if (state.fastFixes >= 2 && state.mode === 'walk' && !state.autoBike) {
      state.autoBike = true;
      setMode('bike');
      toast('You seem to be cycling, so times are by bike now.');
    }
  }
  /* Staying at a spot: after DWELL (10 minutes) within reach of a spot, ask how it is. The clock starts
     where you stop, keeps running if you close and reopen the app, and starts again if you move more than
     50 m away. Not for toilets, not twice for one spot in a visit, not again within 12 hours of rating it.
     The "Check in and rate" button works at once, whatever the clock says. */
  let dwell = getLS(KEYS.dwell, null);
  const reach = u => GAME.checkinRadius + Math.min(u.acc, GAME.accuracySlack);
  function nearbySpots(u, extra = 0) {
    const out = [];
    for (const s of state.spots) {
      if (s.kind === 'toilet') continue;
      const d = nearestSeat(s, u);
      if (d <= reach(u) + extra) out.push({ s, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }
  function checkArrival() {
    const u = state.user;
    if (!u || u.acc > GAME.maxAccuracy) return;
    const near = nearbySpots(u), now = Date.now();
    if (!near.length) { if (dwell) { dwell = null; setLS(KEYS.dwell, null); } return; }
    if (!dwell || C.metres(dwell.lat, dwell.lon, u.lat, u.lon) > 50 || now - dwell.last > 2 * 3600000) dwell = { lat: u.lat, lon: u.lon, since: now };
    dwell.last = now;
    setLS(KEYS.dwell, dwell);
    if (now - dwell.since < DWELL || OVERLAYS.includes(state.sheet)) return;
    const best = near.find(x => !state.dismissed.has(x.s.id));
    if (!best) return;
    const mine = myInfo(best.s);
    if (mine.lastVisit && now - mine.lastVisit < 12 * 3600000) return;
    openArrive(best.s.id);
  }

  /* ---------- the panel ---------- */
  function setSheet(mode) {
    if (OVERLAYS.includes(mode) && !OVERLAYS.includes(state.sheet)) {
      state.base = state.sheet;
      try { history.pushState({ sitwell: mode }, ''); state.pushed = true; } catch (e) { state.pushed = false; }
    }
    state.sheet = mode;
    render();
  }
  function closeOverlay() {
    if (state.pushed) { state.pushed = false; history.back(); return; }   // popstate finishes the job
    backToBase();
  }
  function backToBase() {
    if (state.sheet === 'arrive' && state.selected) state.dismissed.add(state.selected);
    state.sheet = OVERLAYS.includes(state.base) ? 'peek' : state.base || 'peek';
    state.selected = null;
    state.arrive = null;
    state.add = null;
    showCrosshair(false);
    drawSpots();
    render();
  }
  function openSpot(id, fly) {
    const s = state.byId.get(id);
    if (!s) return;
    state.selected = id;
    state.arrive = null;
    if (OVERLAYS.includes(state.sheet)) { state.sheet = 'spot'; render(); } else setSheet('spot');
    if (fly !== false) flyTo(s, Math.max(map ? map.getZoom() : 16, 16));
    drawSpots();
  }
  function openArrive(id) {
    state.selected = id;
    state.arrive = { id, rated: null };
    if (OVERLAYS.includes(state.sheet)) { state.sheet = 'arrive'; render(); } else setSheet('arrive');
    drawSpots();
  }
  function setMode(v) {
    state.mode = v === 'bike' ? 'bike' : 'walk';
    setLS(KEYS.mode, state.mode);
    if (state.center) load(state.centerIsUser && state.user ? state.user : state.center);
  }
  function renderSoft() { if (!OVERLAYS.includes(state.sheet)) render(); }

  function chips() {
    const base = [['sunset', 'Sunset', icon('sun', 16, '#B35A12', 2)], ['water', 'By water'], ['quiet', 'Quiet'], ['picnic', 'Picnic'], ['toilet', 'Toilet']];
    const extra = [['green', 'Park or woods'], ['firepit', 'Fire pit'], ['swim', 'Swimming'], ['roofed', 'Roofed'], ['saved', 'Saved'], ['visited', 'Visited']];
    const list = base.concat(extra.filter(c => state.moreFilters || c[0] === state.filter));
    return list.map(([id, label, ic]) => `<button type="button" class="chip${id === 'toilet' ? ' wc' : ''}" data-act="filter" data-f="${id}" aria-pressed="${state.filter === id}">${ic || ''}${esc(label)}</button>`).join('') +
      `<button type="button" class="chip" data-act="more-filters" aria-expanded="${state.moreFilters}">${state.moreFilters ? 'Fewer' : 'More'}</button>`;
  }
  function emptyText() {
    if (state.liveLoading) return 'Loading spots from OpenStreetMap…';
    switch (state.filter) {
      case 'sunset': return 'No spots nearby face today’s sunset over open water.';
      case 'toilet': return 'No public toilets mapped nearby.';
      case 'saved': return 'You haven’t saved any spots nearby.';
      case 'visited': return 'You haven’t checked in anywhere nearby yet.';
      case null: return 'No benches or picnic tables mapped nearby.';
      default: return 'Nothing nearby matches this filter.';
    }
  }
  function cardHTML(r) {
    const s = r.spot, [kind, tile] = tileOf(s, r);
    const travel = state.centerIsUser && state.user ? icon(state.mode === 'bike' ? 'bike' : 'walk', 16, '#5E5950', 2) : '';
    return `<button type="button" class="card" data-act="open" data-id="${esc(s.id)}">
      <span class="tile ${kind}">${tile}</span>
      <span class="txt"><span class="t">${esc(titleOf(s))}</span><span class="r">${esc(reasonOf(s, r))}</span></span>
      <span class="time">${travel}${esc(timeLabel(r))}</span></button>`;
  }
  function listHTML() {
    const title = state.filter === 'toilet' ? 'Nearest toilets' : state.sort === 'near' ? 'Nearest spots' : 'Best right now';
    const welcome = !state.user && !state.locDenied && !state.invite;
    const ctx = contextLine();
    const context = welcome
      ? `<p class="context">${icon('sun', 18, '#B35A12', 2)}<span>Sitwell finds lovely spots to linger. <button type="button" class="linkish" data-act="locate" style="padding:0;min-height:0">Show the best ones near you</button></span></p>`
      : `<p class="context">${ctx.icon}<span>${esc(ctx.text)}</span></p>`;
    let body;
    if (state.loading && !state.spots.length) body = '<p class="note">Finding spots…</p>';
    else if (state.error) body = `<p class="note">${esc(state.error)}</p>`;
    else if (!state.ranked.length) body = `<p class="note">${esc(emptyText())}</p>`;
    else {
      const n = state.sheet === 'list' ? state.shown : 3;
      body = '<div class="cards">' + state.ranked.slice(0, n).map(cardHTML).join('') + '</div>';
      if (state.sheet === 'list') {
        if (state.ranked.length > n) body += '<button type="button" class="linkish" data-act="more">Show more spots</button>';
        if (state.filter !== 'toilet') body += `<button type="button" class="linkish" data-act="sort">${state.sort === 'near' ? 'Show the best first' : 'Show the nearest first'}</button>`;
      }
    }
    if (state.liveLoading && state.ranked.length) body += '<p class="note">Loading more spots from OpenStreetMap…</p>';
    if (state.liveError) body += `<p class="note">${esc(state.liveError)} <button type="button" class="linkish" data-act="retry" style="padding:0;min-height:0">Try again</button></p>`;
    if (state.sheet === 'list' && canAddHere()) body += '<button type="button" class="linkish" data-act="add-start">No bench mapped where you are? Add it</button>';
    return `<div class="head"><h1>${title}</h1>
        <div class="seg"><button type="button" data-act="mode" data-v="walk" aria-pressed="${state.mode === 'walk'}">Walking</button><button type="button" data-act="mode" data-v="bike" aria-pressed="${state.mode === 'bike'}">Cycling</button></div></div>
      ${context}${wishRow()}<div class="chips">${chips()}</div>${body}`;
  }
  function spotHTML(s) {
    const t = s.text, mine = myInfo(s), now = new Date(), here = atSpot(s);
    let status = '';
    if (s.pin) status = `<p class="status mine">${icon('check', 16, '#2F5E43', 2.2)}You added it${s._v ? '' : '. Its surroundings are being looked up'}.</p>`;
    else if (mine.rating != null) status = `<p class="status mine">${icon('check', 16, '#2F5E43', 2.2)}You rated it ${esc(wordFor(mine.rating, s.kind))}.</p>`;
    else if (state.promising.has(s.id)) status = `<p class="status">${RING}Looks promising. You haven’t rated it yet.</p>`;
    let tonight = '';
    const g = s.kind !== 'toilet' && s.rays ? P.sunGone(s, now) : null;
    if (g && g.at > now && P.sunsetToday(s, now)) {
      const water = esc(P.waterWord(s.m));
      const line = !g.measured
        ? `Official sunset tonight is ${hhmm(g.at)}, over ${water}. Hills can hide the sun a little earlier, so come a bit before.`
        : g.early >= 3 ? `Tonight the sun leaves this spot at ${hhmm(g.at)}, behind the hills, ${g.early} minutes before the official sunset.`
          : `Tonight the sun sets over ${water} at ${hhmm(g.at)}.`;
      tonight = `<div class="tonight">${icon('sun', 22, '#B35A12', 1.9)}<p>${line}${state.outlook ? ' ' + esc(state.outlook.label) + '.' : ''}</p></div>`;
    }
    const warn = t.warnings.map(w => `<div class="row warn">${icon('warn', 20, '#8A4B12')}<span class="k">${esc(w.label)}</span><span class="d">${esc(C.fmtDist(w.d))}</span></div>`).join('');
    const near = t.facts.slice(0, 5).map(f => `<div class="row">${factIcon(f.label)}<span class="k">${esc(f.label)}</span><span class="d">${esc(C.fmtDist(f.d))}</span></div>`).join('');
    const rows = warn || near ? `<div class="rows"><h3>Nearby</h3>${warn}${near}</div>` : '';
    const d = state.user ? nearestSeat(s, state.user) : null;
    const hint = here ? '' : d != null ? `You’re ${C.fmtDist(d)} away. Rate it when you’re there.` : 'Rate it when you’re there.';
    const main = here
      ? `<button type="button" class="btn primary" data-act="arrive" data-id="${esc(s.id)}">Check in and rate</button>`
      : `<button type="button" class="btn primary" data-act="go" data-id="${esc(s.id)}">Go</button>`;
    const sv = isSaved(s);
    return `<div class="spot">
      <div class="bar"><button type="button" class="back" data-act="close" aria-label="Back to the list">${icon('back', 22, 'currentColor', 2)}</button></div>
      <div><h2>${esc(titleOf(s))}</h2>${status}</div>
      <div><p class="sentence">${esc(t.sentence)}</p>${t.comfort ? `<p class="comfort">${esc(t.comfort)}</p>` : ''}${t.note ? `<p class="comfort">${esc(t.note)}</p>` : ''}</div>
      ${tonight}${rows}
      <div class="actions">${main}
        <button type="button" class="btn secondary" data-act="meet" data-id="${esc(s.id)}">Meet me here</button>
        <button type="button" class="btn icon" data-act="save" data-id="${esc(s.id)}" aria-pressed="${sv}" aria-label="${sv ? 'Saved for later' : 'Save for later'}">${icon('bookmark', 20, 'currentColor', 1.8, sv ? 'currentColor' : 'none')}</button></div>
      ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
      <p class="hint"><a href="https://www.openstreetmap.org/note/new#map=19/${s.lat.toFixed(6)}/${s.lon.toFixed(6)}" target="_blank" rel="noopener">${s.pin ? 'Tell OpenStreetMap it’s here' : 'Something wrong or gone? Tell OpenStreetMap'}</a></p>
      ${s.pin ? '<button type="button" class="linkish" data-act="remove-pin" style="align-self:center">Remove this bench</button>' : ''}
    </div>`;
  }
  function arriveHTML(s) {
    const a = state.arrive || {}, mine = myInfo(s), words = s.kind === 'toilet' ? WORDS.toilet : WORDS.seat;
    const name = lowerFirst(titleOf(s));
    if (a.rated == null) {
      const prev = typeof mine.rating === 'number' ? mine.rating : null;
      const ask = mine.visited && prev ? `Still ${words[prev - 1]}?` : 'How is it?';
      let btns = '';
      for (let n = 5; n >= 1; n--) {
        btns += `<button type="button" class="star-btn" data-act="rate" data-n="${n}" aria-pressed="${prev === n}" aria-label="${esc(words[n - 1])}, ${n} ${n === 1 ? 'star' : 'stars'}"><span class="s">${stars(n)}</span><span class="w">${esc(words[n - 1])}</span></button>`;
      }
      if (s.kind === 'toilet') btns += '<button type="button" class="star-btn" data-act="rate" data-n="closed"><span class="w">Closed or locked</span></button>';
      return `<div class="ask"><h2>You’re at the ${esc(name)}${mine.visited ? ' again' : ''}</h2><p class="sub">${esc(ask)}</p>
        <div class="stars">${btns}</div>
        <p class="note">One tap saves it. You can change it for 24 hours.</p>
        ${otherSpotsHTML(s)}
        <button type="button" class="linkish" data-act="close">Not now</button></div>`;
    }
    const tags = s.kind === 'toilet' ? '' : `<h3 style="margin:18px 0 0;font-size:16px">What’s good here?</h3><div class="tags">${TAGS.map(([id, label]) =>
      `<button type="button" class="chip" data-act="tag" data-tag="${id}" aria-pressed="${mine.tags.includes(id)}">${esc(label)}</button>`).join('')}</div>`;
    return `<div class="ask"><h2>You’re at the ${esc(name)}</h2>
      <p class="saved-line" style="margin-top:14px">${icon('check', 22, '#2F5E43', 2.2)}Saved as ${esc(wordFor(a.rated, s.kind))}. Thanks for checking in.</p>
      ${foundHTML(s)}
      ${tags}${installHTML()}
      <div class="actions" style="margin-top:20px"><button type="button" class="btn primary" data-act="close">Done</button><button type="button" class="btn quiet" data-act="change">Change rating</button></div></div>`;
  }
  // GPS can be 20–30 m out, so the nearest spot isn't always yours: offer the others within reach.
  function otherSpotsHTML(s) {
    const others = state.user ? nearbySpots(state.user, 25).filter(x => x.s.id !== s.id).slice(0, 3) : [];
    if (!others.length) return '';
    const u = state.user, way = s2 => {
      const dx = (s2.lon - u.lon) * Math.cos(u.lat * Math.PI / 180) * 111320, dy = (s2.lat - u.lat) * 110540;
      return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(C.bearingTo(0, 0, dx, dy) / 45) % 8];
    };
    return '<p class="list-title">Not this spot?</p>' + others.map(x =>
      `<button type="button" class="option" data-act="arrive-other" data-id="${esc(x.s.id)}"><span>${esc(titleOf(x.s))}</span><small>${esc(C.fmtDist(x.d) + ' ' + way(x.s))}</small></button>`).join('');
  }
  function meetHTML(s) {
    const now = new Date();
    const before = beforeSunset(s, now);
    const sunsetOpt = before && before - now > 10 * 60000 && before - now < 14 * 3600000
      ? `<button type="button" class="option" data-act="share" data-when="sunset">Before sunset<small>${hhmm(before)}</small></button>` : '';
    return `<div class="spot"><div class="bar"><button type="button" class="back" data-act="back-spot" aria-label="Back to the spot">${icon('back', 22, 'currentColor', 2)}</button></div>
      <div><h2>Meet me here</h2><p class="comfort">${esc(titleOf(s))}. Pick a time and send the link. Your friend can open it without installing anything.</p></div>
      <div><button type="button" class="option" data-act="share" data-when="now">Now</button>
      <button type="button" class="option" data-act="share" data-when="30">In 30 minutes<small>${hhmm(new Date(now.getTime() + 30 * 60000))}</small></button>
      ${sunsetOpt}
      <div class="option"><label for="meet-time">At a time</label><input id="meet-time" type="time" value="${hhmm(new Date(now.getTime() + 60 * 60000))}"></div>
      <button type="button" class="btn primary" style="width:100%;margin-top:10px" data-act="share-time">Send the link for that time</button></div></div>`;
  }
  /* ---------- your field guide ---------- */
  const placeName = pl => (pl ? pl.neighbourhood || pl.district || pl.town || '' : '');
  function dateLabel(t, long) {
    const d = new Date(t);
    return long ? d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  function guideData() {
    let dirty = false;
    const spotOf = p => (p.added ? pinCache.get(p.key) : state.byId.get(p.key));
    const g = G.build(events, {
      sentenceFor: p => { const s = spotOf(p); return s && s.text ? s.text.sentence : ''; },
      // Ratings from the prototype carry no title: name them once the spot is loaded, and keep that name.
      titleFor: p => {
        const s = !p.added && spotOf(p);
        if (!s) return '';
        const title = titleOf(s), e = events.find(x => x.type === 'checkin' && x.spot === p.key);
        if (e && !e.title) { e.title = title; if (!e.where && s.text) e.where = s.text.sentence; dirty = true; }
        return title;
      },
    });
    if (dirty) setLS(KEYS.events, events);
    return g;
  }
  function mineHTML() {
    const g = guideData(), pages = g.pages.slice().reverse(), n = pages.length, w = wish();
    const sub = n ? `${n} ${n === 1 ? 'page' : 'pages'}${g.places ? `, from ${g.places} ${g.places === 1 ? 'place' : 'places'}` : ''}` : 'Every new spot you rate becomes a page here.';
    const next = w ? `<div class="wish"><button type="button" class="wish-go" data-act="open" data-id="${esc(w.spot.id)}">${icon('spark', 20, '#A2801F')}<span>Your next page could be the ${esc(lowerFirst(titleOf(w.spot)))}, ${esc(timeLabel(w))} away.</span></button></div>` : '';
    const shelf = `<div class="shelf">${g.shelf.map(k => `<div class="k${k.count ? '' : ' missing'}">${G.svg(k.id, 30, !k.count)}<span>${esc(k.count ? k.name + (k.count > 1 ? ' ×' + k.count : '') : k.from)}</span></div>`).join('')}</div>
      <p class="hint" style="text-align:left;margin-top:8px">${g.found} of ${g.shelf.length} kinds of souvenir found</p>`;
    const rows = pages.map(p => `<button type="button" class="page-row" data-act="page" data-k="${esc(p.key)}"><span class="pg">${p.souvenir ? G.svg(p.souvenir.kind, 26) : ''}</span>
      <span class="txt"><span class="t">${esc(p.title)}</span><span class="r">${esc([p.rating != null ? wordFor(p.rating, p.kind) : '', placeName(p.place), dateLabel(p.first)].filter(Boolean).join(', '))}</span></span></button>`).join('');
    const savedList = saved.length ? '<p class="list-title">Saved for later</p>' + saved.slice().reverse().map(x =>
      `<button type="button" class="option" data-act="goto" data-id="${esc(x.id)}" data-lat="${x.lat}" data-lon="${x.lon}"><span>${esc(x.title)}</span></button>`).join('') : '';
    const pass = g.passport.length ? '<p class="list-title">Passport</p>' + g.passport.map(t =>
      `<div class="passport-row"><span>${esc(t.town)}</span><span class="d">${t.total ? `${t.parts} of ${t.total} ${t.unit}` : `${t.pages} ${t.pages === 1 ? 'page' : 'pages'}`}</span></div>`).join('') : '';
    return `<div class="spot guide"><div class="bar"><button type="button" class="back" data-act="close" aria-label="Back to the map">${icon('back', 22, 'currentColor', 2)}</button></div>
      <div><h2>Your field guide</h2><p class="comfort">${esc(sub)}</p></div>
      ${next}${shelf}
      ${n ? '<p class="list-title">Pages</p>' + rows : ''}
      ${savedList}${pass}
      <button type="button" class="btn secondary" data-act="add-start" style="margin-top:18px">Add a missing bench</button>${installHTML(true)}
      <p class="list-title">Your history</p>
      <p class="comfort" style="margin-top:0">It lives on this phone, in this browser. To use it elsewhere, such as the app on your home screen, copy it here and paste it there.</p>
      <div class="actions"><button type="button" class="btn quiet" data-act="copy-history">Copy my history</button><button type="button" class="btn quiet" data-act="paste-history">Paste history</button></div>
      <p class="hint" style="margin-top:20px;text-align:left">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.
      Map style by OpenFreeMap. Weather from Open-Meteo. Hills from the Terrain Tiles by Mapzen, including EU-DEM.</p>
      </div>`;
  }
  function pageHTML(key) {
    const p = guideData().pages.find(x => x.key === key);
    if (!p) return mineHTML();
    const where = p.place ? [placeName(p.place), p.place.town !== placeName(p.place) ? p.place.town : ''].filter(Boolean).join(', ') : '';
    const tags = p.tags.length ? `<div class="tags">${p.tags.map(id => { const t = TAGS.find(x => x[0] === id); return t ? `<span class="chip static">${esc(t[1])}</span>` : ''; }).join('')}</div>` : '';
    const sv = p.souvenir ? `<div class="pressed">${G.svg(p.souvenir.kind, 56)}<p>${esc(p.souvenir.caption)}</p></div>` : '';
    const more = p.visits > 1 ? `, and ${p.visits - 1} more ${p.visits === 2 ? 'visit' : 'visits'} since` : '';
    return `<div class="spot page"><div class="bar"><button type="button" class="back" data-act="back-guide" aria-label="Back to your field guide">${icon('back', 22, 'currentColor', 2)}</button></div>
      <p class="date">Found on ${esc(dateLabel(p.first, true))}${more}</p>
      <div><h2>${esc(p.title)}</h2>${where ? `<p class="comfort">${esc(where)}</p>` : ''}</div>
      ${typeof p.rating === 'number' ? `<p class="rating">${stars(p.rating)}<span>${esc(wordFor(p.rating, p.kind))}</span></p>` : ''}
      ${p.where ? `<p class="sentence">${esc(p.where)}</p>` : ''}
      ${tags}${sv}
      <div class="actions"><button type="button" class="btn primary" data-act="share-page" data-k="${esc(p.key)}">Share this page</button>
      <button type="button" class="btn secondary" data-act="goto" data-id="${esc(p.key)}" data-lat="${p.lat}" data-lon="${p.lon}">Show on map</button></div></div>`;
  }
  // After rating a new spot: the souvenir it held, if any.
  function foundHTML(s) {
    const a = state.arrive;
    if (!a || a.rated == null || s.kind === 'toilet') return '';
    const p = guideData().pages.find(x => x.key === s.id);
    if (!p || !p.souvenir || p.visits !== 1) return '';
    return `<div class="found">${G.svg(p.souvenir.kind, 40)}<p>You found ${esc(lowerFirst(p.souvenir.caption))}. It’s in your field guide.</p></div>`;
  }
  // Wishes: a promising spot near you that you haven't rated, suggested after a week without a new page.
  function wish() {
    const at = origin();
    if (!at) return null;
    const speed = SPEED[state.mode], most = state.mode === 'bike' ? 20 : 15;
    let best = null, bd = Infinity;
    for (const s of state.spots) {
      if (s.kind === 'toilet' || s.pin || !state.promising.has(s.id) || myInfo(s).visited) continue;
      const d = C.metres(at.lat, at.lon, s.lat, s.lon);
      if (d / speed <= most && d < bd) { bd = d; best = s; }
    }
    return best ? { spot: best, d: bd, minutes: bd / speed } : null;
  }
  function wishDue() {
    const firsts = events.filter(e => (e.type === 'checkin' && !e.revisit) || e.type === 'add');
    if (!firsts.length || getLS(KEYS.wishNo, '') === new Date().toDateString()) return false;
    return Date.now() - Math.max(...firsts.map(e => e.t || 0)) > 7 * 86400000;
  }
  function wishRow() {
    if (state.filter || state.sort !== 'best' || !wishDue()) return '';
    const w = wish();
    if (!w) return '';
    const noun = w.spot.hasTable && !w.spot.hasBench ? 'picnic table' : 'bench';
    return `<div class="wish"><button type="button" class="wish-go" data-act="open" data-id="${esc(w.spot.id)}">${icon('spark', 20, '#A2801F')}<span>A promising ${noun} ${esc(timeLabel(w))} away that you haven’t rated yet. Your next page?</span></button>
      <button type="button" class="wish-x" data-act="wish-no" aria-label="Not today">${icon('close', 18)}</button></div>`;
  }

  /* ---------- sharing a page: a picture of it, with a link back to the spot ---------- */
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function wrapText(g, text, x, y, maxW, lineH, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    let line = '', n = 0;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (g.measureText(test).width > maxW && line) {
        if (n === maxLines - 1) { g.fillText(line.replace(/[,.;:]?$/, '…'), x, y); return y + lineH; }
        g.fillText(line, x, y); y += lineH; n++; line = w;
      } else line = test;
    }
    if (line) { g.fillText(line, x, y); y += lineH; }
    return y;
  }
  async function pageCard(p) {
    const W = 1080, H = 1350, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext && c.getContext('2d');
    if (!g || !c.toBlob) return null;
    if (document.fonts && document.fonts.load) {
      try { await Promise.all(['500 60px "IBM Plex Serif"', '400 42px "IBM Plex Serif"', '400 32px "IBM Plex Sans"', '600 32px "IBM Plex Sans"'].map(f => document.fonts.load(f))); } catch (e) { /* fallback fonts */ }
    }
    const SERIF = '"IBM Plex Serif", Georgia, serif', SANS = '"IBM Plex Sans", -apple-system, sans-serif', x = 120, maxW = W - 240;
    g.fillStyle = '#F6F4EF'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#FFFFFF'; roundRect(g, 56, 56, W - 112, H - 112, 40); g.fill();
    let y = 170;
    g.fillStyle = '#5E5950'; g.font = `400 32px ${SANS}`; g.fillText('From my field guide', x, y);
    y += 96; g.fillStyle = '#23211D'; g.font = `500 60px ${SERIF}`; y = wrapText(g, p.title, x, y, maxW, 72, 3);
    g.fillStyle = '#5E5950'; g.font = `400 32px ${SANS}`; g.fillText([placeName(p.place), dateLabel(p.first, true)].filter(Boolean).join(', '), x, y + 4);
    y += 92;
    if (typeof p.rating === 'number') {
      for (let k = 0; k < 5; k++) {
        g.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 11 : 25; g.lineTo(x + 25 + k * 58 + Math.cos(a) * r, y - 14 + Math.sin(a) * r); }
        g.closePath(); g.fillStyle = k < p.rating ? '#B8860B' : '#E2DDD3'; g.fill();
      }
      g.fillStyle = '#23211D'; g.font = `600 34px ${SANS}`; g.fillText(wordFor(p.rating, p.kind), x + 5 * 58 + 22, y);
      y += 92;
    }
    const bottom = p.souvenir ? H - 500 : H - 220;
    g.fillStyle = '#23211D'; g.font = `400 42px ${SERIF}`; wrapText(g, p.where, x, y, maxW, 60, Math.max(2, Math.floor((bottom - y) / 60)));
    if (p.souvenir) {
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(G.svg(p.souvenir.kind, 180));
      try { await (img.decode ? img.decode() : new Promise((ok, no) => { img.onload = ok; img.onerror = no; })); g.drawImage(img, x - 10, H - 470, 180, 180); } catch (e) { /* no picture */ }
      g.fillStyle = '#5E5950'; g.font = `400 32px ${SANS}`; wrapText(g, p.souvenir.caption, x + 200, H - 395, maxW - 200, 44, 3);
    }
    g.fillStyle = '#2F5E43'; g.font = `500 40px ${SERIF}`; g.fillText('Sitwell', x, H - 150);
    g.fillStyle = '#5E5950'; g.font = `400 30px ${SANS}`; g.fillText('Find a lovely spot to linger', x, H - 104);
    g.textAlign = 'right'; g.fillText(location.host, W - 120, H - 104); g.textAlign = 'left';
    return new Promise(res => c.toBlob(b => res(b), 'image/png'));
  }
  async function sharePage(key) {
    const p = guideData().pages.find(x => x.key === key);
    if (!p) return;
    const url = location.origin + location.pathname + '#spot=' + encodeURIComponent([p.key, (+p.lat).toFixed(5), (+p.lon).toFixed(5)].join('~'));
    const text = [p.title + '.', p.where].filter(Boolean).join(' ');
    let file = null;
    try { const blob = await pageCard(p); if (blob && typeof File !== 'undefined') file = new File([blob], 'sitwell-field-guide.png', { type: 'image/png' }); } catch (e) { file = null; }
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Sitwell', text, url }); return; }
      if (navigator.share) { await navigator.share({ title: 'Sitwell', text, url }); return; }
      if (file) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); }
      if (navigator.clipboard) { await navigator.clipboard.writeText(url); toast(file ? 'Picture saved and link copied.' : 'Link copied.'); }
    } catch (e) { /* cancelled */ }
  }
  function inviteHTML(inv) {
    const s = inv.spot, when = inv.when && !isNaN(inv.when) ? inv.when : null;
    let whenLine = 'Whenever suits you.';
    if (when) {
      const today = new Date(), tomorrow = new Date(today.getTime() + 86400000);
      const day = when.toDateString() === today.toDateString() ? 'Today' : when.toDateString() === tomorrow.toDateString() ? 'Tomorrow'
        : when.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
      const g = s && s.rays ? P.sunGone(s, when) : null, sun = g ? g.at : C.sunsetAt(when, inv.lat, inv.lon);
      const near = sun && Math.abs(sun - when) < 3 * 3600000;
      const sunLine = !near ? '' : g && g.measured && g.early >= 3 ? ` The sun leaves the spot at ${hhmm(sun)}.` : ` The sun sets around ${hhmm(sun)}.`;
      whenLine = `${day} at ${hhmm(when)}.${sunLine}`;
    }
    const spot = s ? `<p class="place">${esc(titleOf(s))}</p><p class="sentence">${esc(s.text.sentence)}</p>${s.text.comfort ? `<p class="comfort">${esc(s.text.comfort)}</p>` : ''}`
      : '<p class="place">A spot on the map above</p>';
    return `<div class="invite"><p class="brand">Sitwell</p><h2>A friend invites you here</h2>
      <p class="when">${icon('sun', 20, '#B35A12', 1.9)}${esc(whenLine)}</p>${spot}
      <div class="stack"><a class="btn primary" href="${esc(directionsUrl(inv))}" target="_blank" rel="noopener">Get directions</a>
      ${when ? '<button type="button" class="btn secondary" data-act="ics">Add to calendar</button>' : ''}</div>
      <p class="about">Sitwell shows benches, picnic tables and toilets nearby, described by what is around them.</p>
      <button type="button" class="linkish" data-act="explore">Find lovely spots near you</button></div>`;
  }
  function render() {
    const body = $('#sheet-body');
    if (!body) return;
    const mode = state.sheet;
    document.body.dataset.sheet = mode;
    const keep = body.dataset.mode === mode ? body.scrollTop : 0;
    const s = state.selected ? state.byId.get(state.selected) : null;
    let html;
    if (mode === 'spot' && s) html = spotHTML(s);
    else if (mode === 'arrive' && s) html = arriveHTML(s);
    else if (mode === 'meet' && s) html = meetHTML(s);
    else if (mode === 'mine') html = mineHTML();
    else if (mode === 'add' && state.add) html = addHTML();
    else if (mode === 'page' && state.pageKey) html = pageHTML(state.pageKey);
    else if (mode === 'invite' && state.invite) html = inviteHTML(state.invite);
    else html = listHTML();
    body.innerHTML = html;
    body.dataset.mode = mode;
    body.scrollTop = keep;
  }

  /* ---------- actions ---------- */
  function directionsUrl(p) {
    return `https://www.google.com/maps/dir/?api=1&destination=${(+p.lat).toFixed(6)},${(+p.lon).toFixed(6)}&travelmode=${state.mode === 'bike' ? 'bicycling' : 'walking'}`;
  }
  function toggleSave(s) {
    if (isSaved(s)) { saved = saved.filter(x => x.id !== s.id); toast('Removed from saved spots'); }
    else { saved.push({ id: s.id, lat: +s.lat.toFixed(6), lon: +s.lon.toFixed(6), title: titleOf(s), t: Date.now() }); toast('Saved. Find it under My spots.'); }
    setLS(KEYS.saved, saved);
  }
  function saveRating(s, n) {
    const now = Date.now(), mine = myInfo(s);
    const base = { t: now, spot: s.id, lat: +s.lat.toFixed(6), lon: +s.lon.toFixed(6), rating: n, where: s.text.sentence, title: titleOf(s), kind: s.kind, place: s.placeInfo || null };
    const recent = mine.visited && now - mine.lastVisit < GAME.rateWindowHours * 3600000;
    if (recent && state.arrive && state.arrive.changed) record({ type: 'rate', t: now, spot: s.id, lat: base.lat, lon: base.lon, rating: n, where: base.where, kind: s.kind });
    else if (!mine.visited) record(Object.assign({ type: 'checkin', first: true, value: 0 }, base));
    else record(Object.assign({ type: 'checkin', revisit: true, value: 0 }, base));
    state.arrive = { id: s.id, rated: n };
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});   // ask the browser to keep your history
    rank();
    drawSpots();
    render();
  }
  function toggleTag(s, id) {
    const cur = myInfo(s).tags.slice(), k = cur.indexOf(id);
    if (k >= 0) cur.splice(k, 1); else cur.push(id);
    record({ type: 'tags', t: Date.now(), spot: s.id, lat: +s.lat.toFixed(6), lon: +s.lon.toFixed(6), tags: cur });
    render();
  }
  // Meeting before sunset: 15 minutes before the sun leaves the spot where that's known, otherwise
  // 45 minutes before the official sunset, so hills can't spoil it.
  function beforeSunset(s, now) {
    const g = P.sunGone(s, now);
    return g ? new Date(g.at.getTime() - (g.measured ? 15 : 45) * 60000) : null;
  }
  function whenFor(code, s) {
    const now = new Date();
    if (code === '30') return new Date(now.getTime() + 30 * 60000);
    if (code === 'sunset' && s) return beforeSunset(s, now) || now;
    return now;
  }
  async function shareMeet(s, when) {
    const stamp = when.toISOString().slice(0, 16) + 'Z';
    const url = location.origin + location.pathname + '#meet=' + encodeURIComponent([s.id, s.lat.toFixed(5), s.lon.toFixed(5), stamp].join('~'));
    const text = `Meet me at the ${lowerFirst(titleOf(s))}, at ${hhmm(when)}.`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Sitwell', text, url }); toast('Invitation sent'); }
      else if (navigator.clipboard) { await navigator.clipboard.writeText(text + ' ' + url); toast('Link copied. Paste it into a message.'); }
      else toast(url);
    } catch (e) { /* cancelled */ }
    state.sheet = 'spot';
    render();
  }
  function downloadIcs(inv) {
    if (!inv || !inv.when) return;
    const f = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const start = inv.when, end = new Date(start.getTime() + 3600000);
    const title = inv.spot ? 'Meet at the ' + lowerFirst(titleOf(inv.spot)) : 'Meet at a spot';
    const clean = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, ' ');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sitwell//EN', 'BEGIN:VEVENT', `UID:${Date.now()}@sitwell`, `DTSTAMP:${f(new Date())}`,
      `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:${clean(title)}`, `GEO:${inv.lat};${inv.lon}`, `LOCATION:${inv.lat}\\,${inv.lon}`,
      `URL:${location.href}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = 'sitwell.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function parseInvite() {
    const m = /#meet=([^&]+)/.exec(location.hash);
    if (!m) return null;
    const [id, lat, lon, when] = decodeURIComponent(m[1]).split('~');
    const la = Number(lat), lo = Number(lon);
    if (!isFinite(la) || !isFinite(lo)) return null;
    const w = when ? new Date(when) : null;
    return { id, lat: la, lon: lo, when: w && !isNaN(w) ? w : null, spot: null };
  }
  function leaveInvite() {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* fine */ }
    state.invite = null;
    state.selected = null;
    state.sheet = 'peek';
    state.base = 'peek';
    render();
    startLocation(true);
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
  }

  /* ---------- live squares, where no static files exist ---------- */
  function fetchLiveSquares(ids, token) {
    source.fetchLive(ids, sq => {
      if (token !== loadToken) return false;
      state.liveLoading = Math.max(0, state.liveLoading - 1);
      mergeSquare(sq);
      return true;
    }, (id, e) => {
      if (token !== loadToken) return false;
      state.liveLoading = 0;
      state.liveError = e && e.busy ? 'The OpenStreetMap servers are busy, so some spots are missing.' : 'Some spots couldn’t load.';
      renderSoft();
      return false;   // stop asking: be gentle with the shared servers
    });
  }
  function mergeSquare(sq) {
    state.spots = state.spots.filter(s => s.square !== sq.id || s.pin).concat(sq.spots.map(ready));
    state.byId = new Map(state.spots.map(s => [s.id, s]));
    rank();
    drawSpots();
    if (state.invite && !state.invite.spot) { state.invite.spot = findSpot(state.invite); if (state.invite.spot) state.selected = state.invite.spot.id; }
    if (state.pendingOpen) { const s = findSpot(state.pendingOpen); if (s) { state.pendingOpen = null; openSpot(s.id, true); return; } }
    if (state.sheet === 'invite') render(); else renderSoft();
    checkArrival();
  }

  /* ---------- benches you added (on this phone until Sitwell has accounts) ---------- */
  let pinMeasures = getLS(KEYS.pins, {});
  if (!pinMeasures || typeof pinMeasures !== 'object') pinMeasures = {};
  const pinCache = new Map(), measuring = new Set();
  function pinsAll() {
    const removed = new Set(events.filter(e => e.type === 'remove').map(e => e.id));
    return events.filter(e => e.type === 'add' && e.id && e.lat != null && !removed.has(e.id));
  }
  function pinSpot(e) {
    const known = pinMeasures[e.id], v = known ? 1 : 0, cached = pinCache.get(e.id);
    if (cached && cached._v === v) return cached;
    const kind = e.kind === 'table' ? 'table' : 'bench';
    const s = { id: e.id, kind, lat: e.lat, lon: e.lon, tags: Object.assign({}, e.tags || {}), added: true, pin: true, _v: v,
      members: [{ id: e.id, kind, lat: e.lat, lon: e.lon, added: true }],
      counts: { bench: kind === 'bench' ? 1 : 0, table: kind === 'table' ? 1 : 0 }, hasBench: kind === 'bench', hasTable: kind === 'table',
      m: C.unpackMeasures(known ? known.m : {}), rays: known ? known.rays : null, place: null,
      placeInfo: (known && known.place) || e.place || null, square: C.squareOf(e.lat, e.lon) };
    ready(s);
    pinCache.set(e.id, s);
    return s;
  }
  const pinsNear = (c, r) => pinsAll().filter(e => C.metres(c.lat, c.lon, e.lat, e.lon) <= r).map(pinSpot);
  async function measurePin(e) {
    if (measuring.has(e.id)) return;
    measuring.add(e.id);
    try {
      pinMeasures[e.id] = await source.measurePoint(e.lat, e.lon);
      setLS(KEYS.pins, pinMeasures);
      pinCache.delete(e.id);
      const s = pinSpot(e);
      state.spots = state.spots.filter(x => x.id !== e.id).concat([s]);
      state.byId = new Map(state.spots.map(x => [x.id, x]));
      rank();
      drawSpots();
      if (state.selected === e.id || !OVERLAYS.includes(state.sheet)) render();
    } catch (err) { /* looked up again next time the area loads */ }
    measuring.delete(e.id);
  }
  function measureMissingPins() {
    const missing = pinsAll().filter(e => !pinMeasures[e.id] && state.byId.has(e.id));
    missing.reduce((chain, e) => chain.then(() => measurePin(e)), Promise.resolve());
  }
  function nearestSeatAny(p) {
    let bd = Infinity;
    for (const s of state.spots) if (s.kind !== 'toilet') for (const m of s.members) bd = Math.min(bd, C.metres(p.lat, p.lon, m.lat, m.lon));
    return bd;
  }
  const addsToday = () => events.filter(e => e.type === 'add' && new Date(e.t).toDateString() === new Date().toDateString()).length;
  const canAddHere = () => !!state.user && state.user.acc <= GAME.addMaxAccuracy && nearestSeatAny(state.user) > GAME.checkinRadius;
  function showCrosshair(on) {
    const x = $('#crosshair');
    if (!x) return;
    x.hidden = !on;
    if (!on) return;
    const p = state.pad || { top: 70, bottom: sheetTarget(), left: 0, right: 0 }, W = window.innerWidth, H = window.innerHeight;
    x.style.left = (p.left + (W - p.left - p.right) / 2) + 'px';
    x.style.top = (p.top + (H - p.top - p.bottom) / 2) + 'px';
  }
  function startAdd() {
    if (addsToday() >= GAME.addsPerDay) { toast(`That’s ${GAME.addsPerDay} new benches today, the daily limit.`); return; }
    if (!TEST) {
      if (!state.user) { startLocation(true); toast('Turn on your location to add a bench where you are.'); return; }
      if (state.user.acc > GAME.addMaxAccuracy) { toast(`Your location is only accurate to ${Math.round(state.user.acc)} m. Try again from a more open spot.`); return; }
    }
    state.add = { kind: 'bench', backrest: '', rating: null, done: null };
    state.selected = null;
    if (OVERLAYS.includes(state.sheet)) { state.sheet = 'add'; render(); } else setSheet('add');
    const c = state.user || (map ? { lat: map.getCenter().lat, lon: map.getCenter().lng } : state.center);
    if (c) flyTo(c, 19);
    showCrosshair(true);
    updateAddStatus();
  }
  // Where the cross is, and whether a bench can go there.
  function addCheck() {
    if (!map) return { ok: false, text: 'The map isn’t available here, so the bench can’t be placed.' };
    const c = map.getCenter(), p = { lat: c.lat, lon: c.lng }, near = nearestSeatAny(p);
    if (near < GAME.addMinGap) return { ok: false, p, text: `There’s already a bench ${Math.round(near)} m from the cross. Rate that one, or move the cross.` };
    if (TEST) return { ok: true, p, text: 'Test mode: the bench goes where the cross is.' };
    const u = state.user;
    if (!u) return { ok: false, p, text: 'Your location is needed to add a bench.' };
    const d = C.metres(u.lat, u.lon, p.lat, p.lon);
    if (d > GAME.addMaxDistance) return { ok: false, p, text: `The cross is ${Math.round(d)} m from you. Bring it within ${GAME.addMaxDistance} m of where you stand.` };
    return { ok: true, p, text: d < 3 ? 'The cross is where you stand.' : `The cross is ${Math.round(d)} m from you.` };
  }
  function updateAddStatus() {
    const el = $('#add-status');
    if (!el || !state.add || state.add.done) return;
    const chk = addCheck();
    el.textContent = chk.text;
    el.className = 'status ' + (chk.ok ? 'mine' : 'warn');
  }
  function addHTML() {
    const a = state.add;
    if (a.done) {
      const e = a.done, what = e.kind === 'table' ? 'picnic table' : 'bench';
      return `<div class="spot"><div><h2>Added</h2><p class="comfort">Only you can see this ${what} for now. Once Sitwell has shared ratings, everyone will.</p></div>
        <p class="comfort">Telling OpenStreetMap helps every map that uses it, Sitwell included.</p>
        <a class="btn secondary" href="https://www.openstreetmap.org/note/new#map=19/${e.lat}/${e.lon}" target="_blank" rel="noopener">Tell OpenStreetMap</a>
        <button type="button" class="btn primary" data-act="close">Done</button></div>`;
    }
    const chk = addCheck();
    let rows = '';
    for (let n = 5; n >= 1; n--) rows += `<button type="button" class="star-btn" data-act="add-rate" data-n="${n}" aria-pressed="${a.rating === n}"><span class="s">${stars(n)}</span><span class="w">${esc(WORDS.seat[n - 1])}</span></button>`;
    const back = a.kind !== 'bench' ? '' : `<div><p class="list-title">Does it have a backrest?</p><div class="tags">${[['yes', 'Yes'], ['no', 'No'], ['', 'Not sure']].map(([v, l]) =>
      `<button type="button" class="chip" data-act="add-back" data-v="${v}" aria-pressed="${a.backrest === v}">${l}</button>`).join('')}</div></div>`;
    return `<div class="spot add"><div class="bar"><button type="button" class="back" data-act="close" aria-label="Cancel">${icon('back', 22, 'currentColor', 2)}</button></div>
      <div><h2>Add a missing bench</h2><p class="comfort">Move the map so the cross sits on it.</p></div>
      <p id="add-status" class="status ${chk.ok ? 'mine' : 'warn'}">${esc(chk.text)}</p>
      <div><p class="list-title">What is it?</p><div class="seg wide"><button type="button" data-act="add-kind" data-v="bench" aria-pressed="${a.kind === 'bench'}">Bench</button><button type="button" data-act="add-kind" data-v="table" aria-pressed="${a.kind === 'table'}">Picnic table</button></div></div>
      ${back}
      <div><p class="list-title">How is it?</p><div class="stars">${rows}</div></div>
      <button type="button" class="btn primary" data-act="add-save">Add it</button>
      <p class="hint">Up to ${GAME.addsPerDay} a day. It needs to be at least ${GAME.addMinGap} m from a bench that’s already mapped.</p></div>`;
  }
  function nearestPlace(p) {
    let best = null, bd = 3000;
    for (const s of state.spots) {
      if (!s.placeInfo || s.pin) continue;
      const d = C.metres(p.lat, p.lon, s.lat, s.lon);
      if (d < bd) { bd = d; best = s.placeInfo; }
    }
    return best;
  }
  function saveAdd() {
    const a = state.add, chk = addCheck();
    if (!chk.ok) { toast(chk.text); return; }
    if (a.rating == null) { toast('Pick how it is first.'); return; }
    const now = Date.now();
    const e = record({ type: 'add', t: now, id: 'user/' + now, kind: a.kind, lat: +chk.p.lat.toFixed(6), lon: +chk.p.lon.toFixed(6),
      tags: a.kind === 'bench' && a.backrest ? { backrest: a.backrest } : {}, rating: a.rating, value: 0, place: nearestPlace(chk.p),
      title: a.kind === 'table' ? 'Picnic table you added' : 'Bench you added' });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const s = pinSpot(e);
    state.spots.push(s);
    state.byId.set(s.id, s);
    a.done = e;
    showCrosshair(false);
    rank();
    drawSpots();
    render();
    measurePin(e);
  }

  /* ---------- on the home screen ---------- */
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; });
  const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function installHTML(always) {
    if (standalone() || (!always && getLS(KEYS.install, false))) return '';
    const why = 'It opens faster, works offline, and keeps your ratings safe.';
    if (installEvent) {
      return `<div class="install"><p><strong>Keep Sitwell on your home screen.</strong> ${why}</p>
        <div class="actions"><button type="button" class="btn primary" data-act="install">Add to home screen</button>${always ? '' : '<button type="button" class="btn quiet" data-act="install-no">Not now</button>'}</div></div>`;
    }
    if (isIOS()) {
      return `<div class="install"><p><strong>Keep Sitwell on your home screen.</strong> ${why} Tap the Share button, then “Add to Home Screen”. On iPhone the home-screen app starts empty, so copy your history across under My spots.</p>
        ${always ? '' : '<button type="button" class="btn quiet" data-act="install-no">Got it</button>'}</div>`;
    }
    return '';
  }

  /* ---------- moving your history (to the home-screen app, another browser, or a new address) ---------- */
  const PREFIX = 'sitwell-history:';
  async function copyHistory() {
    const data = JSON.stringify({ v: 1, events, saved, pins: pinMeasures });
    const text = PREFIX + btoa(unescape(encodeURIComponent(data)));
    try { await navigator.clipboard.writeText(text); toast('History copied. Now open Sitwell where you want it, and paste it under My spots.'); }
    catch (e) { toast('This browser doesn’t allow copying here.'); }
  }
  async function pasteHistory() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (e) { toast('This browser doesn’t allow pasting here.'); return; }
    const m = /^sitwell-history:(\S+)$/.exec((text || '').trim());
    if (!m) { toast('There’s no Sitwell history on the clipboard. Copy it first.'); return; }
    let d;
    try { d = JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (e) { toast('That history couldn’t be read.'); return; }
    const key = e => [e.type, e.t, e.spot || e.id || '', e.rating || ''].join('|');
    const have = new Set(events.map(key));
    let added = 0;
    for (const e of d.events || []) if (e && e.type && !have.has(key(e))) { events.push(e); have.add(key(e)); added++; }
    events.sort((a, b) => (a.t || 0) - (b.t || 0));
    setLS(KEYS.events, events);
    for (const x of d.saved || []) if (x && !saved.some(y => y.id === x.id)) saved.push(x);
    setLS(KEYS.saved, saved);
    if (d.pins && typeof d.pins === 'object') { Object.assign(pinMeasures, d.pins); setLS(KEYS.pins, pinMeasures); }
    pinCache.clear();
    toast(added ? `Added ${added} ${added === 1 ? 'entry' : 'entries'} from your history.` : 'That history was already here.');
    if (state.center) load(state.centerIsUser && state.user ? state.user : state.center);
    render();
  }

  /* ---------- place search ---------- */
  function renderResults() {
    const q = $('#q'), out = $('#results'), v = q.value.trim();
    if (!v) { out.hidden = true; out.innerHTML = ''; return; }
    if (!state.placeList) { out.innerHTML = '<li><button type="button" disabled>Loading places…</button></li>'; out.hidden = false; return; }
    const hits = D.searchPlaces(state.placeList, v);
    out.innerHTML = hits.length
      ? hits.map(h => `<li><button type="button" data-lat="${h.lat}" data-lon="${h.lon}">${esc(h.name)}${h.context ? `<small>${esc(h.context)}</small>` : ''}</button></li>`).join('')
      : '<li><button type="button" disabled>No town or neighbourhood with that name<small>Sitwell covers Switzerland and Croatia for now</small></button></li>';
    out.hidden = false;
  }
  function goTo(c) {
    const q = $('#q');
    q.value = '';
    $('#results').hidden = true;
    q.blur();
    state.centerIsUser = false;
    state.sheet = 'peek';
    flyTo(c, 15);
    load(c);
  }

  /* ---------- wiring ---------- */
  function bindUI() {
    const body = $('#sheet-body');
    body.addEventListener('click', e => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act, s = el.dataset.id ? state.byId.get(el.dataset.id) : state.selected ? state.byId.get(state.selected) : null;
      switch (act) {
        case 'mode': setMode(el.dataset.v); break;
        case 'filter': state.filter = state.filter === el.dataset.f ? null : el.dataset.f; state.shown = 12; rank(); drawSpots(); render(); break;
        case 'more-filters': state.moreFilters = !state.moreFilters; render(); break;
        case 'open': openSpot(el.dataset.id); break;
        case 'more': state.shown += 20; render(); break;
        case 'sort': state.sort = state.sort === 'best' ? 'near' : 'best'; rank(); render(); break;
        case 'locate': startLocation(true); break;
        case 'close': closeOverlay(); break;
        case 'go': if (s) window.open(directionsUrl(s), '_blank', 'noopener'); break;
        case 'meet': if (s) { state.selected = s.id; state.sheet = 'meet'; render(); } break;
        case 'back-spot': state.sheet = 'spot'; render(); break;
        case 'save': if (s) { toggleSave(s); render(); } break;
        case 'arrive': if (s) openArrive(s.id); break;
        case 'arrive-other': if (s) { state.selected = s.id; state.arrive = { id: s.id, rated: null }; render(); drawSpots(); } break;
        case 'rate': if (s) saveRating(s, el.dataset.n === 'closed' ? 'closed' : Number(el.dataset.n)); break;
        case 'change': if (state.arrive) { state.arrive.rated = null; state.arrive.changed = true; render(); } break;
        case 'tag': if (s) toggleTag(s, el.dataset.tag); break;
        case 'share': if (s) shareMeet(s, whenFor(el.dataset.when, s)); break;
        case 'share-time': {
          const v = ($('#meet-time') || {}).value;
          if (s && /^\d{2}:\d{2}$/.test(v || '')) {
            const [h, m] = v.split(':').map(Number), d = new Date();
            d.setHours(h, m, 0, 0);
            if (d < new Date(Date.now() - 5 * 60000)) d.setDate(d.getDate() + 1);
            shareMeet(s, d);
          }
          break;
        }
        case 'goto': {
          const p = { id: el.dataset.id, lat: Number(el.dataset.lat), lon: Number(el.dataset.lon) };
          state.pushed = false;
          state.sheet = 'peek';
          state.centerIsUser = false;
          state.pendingOpen = p;
          flyTo(p, 16);
          load(p);
          break;
        }
        case 'ics': downloadIcs(state.invite); break;
        case 'explore': leaveInvite(); break;
        case 'retry': state.liveError = ''; if (state.center) load(state.centerIsUser && state.user ? state.user : state.center); break;
        case 'add-start': startAdd(); break;
        case 'add-kind': if (state.add) { state.add.kind = el.dataset.v; render(); } break;
        case 'add-back': if (state.add) { state.add.backrest = el.dataset.v; render(); } break;
        case 'add-rate': if (state.add) { state.add.rating = Number(el.dataset.n); render(); } break;
        case 'add-save': if (state.add) saveAdd(); break;
        case 'remove-pin':
          if (s && s.pin) {
            record({ type: 'remove', t: Date.now(), id: s.id });
            state.spots = state.spots.filter(x => x.id !== s.id);
            state.byId.delete(s.id);
            pinCache.delete(s.id);
            rank();
            drawSpots();
            closeOverlay();
            toast('Removed');
          }
          break;
        case 'install':
          if (installEvent) {
            const ev = installEvent;
            installEvent = null;
            ev.prompt();
            if (ev.userChoice) ev.userChoice.finally(() => { setLS(KEYS.install, true); render(); });
          }
          break;
        case 'install-no': setLS(KEYS.install, true); render(); break;
        case 'copy-history': copyHistory(); break;
        case 'page': state.pageKey = el.dataset.k; state.sheet = 'page'; render(); $('#sheet-body').scrollTop = 0; break;
        case 'back-guide': state.sheet = 'mine'; render(); break;
        case 'share-page': sharePage(el.dataset.k); break;
        case 'wish-no': setLS(KEYS.wishNo, new Date().toDateString()); render(); break;
        case 'paste-history': pasteHistory(); break;
        default: break;
      }
    });
    window.addEventListener('popstate', () => { state.pushed = false; if (OVERLAYS.includes(state.sheet) && state.sheet !== 'invite') backToBase(); });

    // The handle: tap to open or close the list, or drag it up and down.
    const handle = $('#handle');
    let drag = null, suppress = false;
    handle.addEventListener('pointerdown', e => { drag = { y: e.clientY }; try { handle.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } });
    handle.addEventListener('pointerup', e => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      drag = null;
      if (Math.abs(dy) < 10) return;
      suppress = true;
      if (dy < 0 && state.sheet === 'peek') { state.sheet = 'list'; render(); }
      else if (dy > 0) { if (OVERLAYS.includes(state.sheet)) closeOverlay(); else if (state.sheet === 'list') { state.sheet = 'peek'; render(); } }
    });
    handle.addEventListener('click', () => {
      if (suppress) { suppress = false; return; }
      if (OVERLAYS.includes(state.sheet)) closeOverlay();
      else { state.sheet = state.sheet === 'peek' ? 'list' : 'peek'; render(); }
    });

    $('#locate').addEventListener('click', () => { state.keepView = false; if (state.user) recenter(); else startLocation(true); });
    $('#mine').addEventListener('click', () => { state.selected = null; setSheet('mine'); });
    $('#here').addEventListener('click', () => {
      if (!map) return;
      const c = map.getCenter();
      state.centerIsUser = false;
      load({ lat: c.lat, lon: c.lng });
    });
    const q = $('#q'), results = $('#results');
    q.addEventListener('focus', () => {
      if (state.placeList) return;
      source.places().then(list => { state.placeList = list; renderResults(); }).catch(() => { state.placeList = []; renderResults(); });
    });
    q.addEventListener('input', renderResults);
    q.addEventListener('keydown', e => {
      if (e.key === 'Escape') { q.value = ''; renderResults(); q.blur(); }
      if (e.key === 'Enter') { const b = results.querySelector('button[data-lat]'); if (b) b.click(); }
    });
    results.addEventListener('click', e => {
      const b = e.target.closest('button[data-lat]');
      if (b) goTo({ lat: Number(b.dataset.lat), lon: Number(b.dataset.lon) });
    });
  }

  async function maybeLocate() {
    if (getLS(KEYS.located, false)) { startLocation(false); return; }
    try {
      const p = await navigator.permissions.query({ name: 'geolocation' });
      if (p.state === 'granted') startLocation(false);
    } catch (e) { /* ask when they tap */ }
  }

  function start() {
    state.invite = parseInvite();
    bindUI();
    initMap();
    if (state.invite) {
      state.sheet = 'invite';
      state.base = 'peek';
      state.selected = state.invite.id;
      flyTo(state.invite, 16, true);
      load(state.invite);
      maybeLocate();
    } else if (/#spot=/.test(location.hash)) {
      const [id, lat, lon] = decodeURIComponent(/#spot=([^&]+)/.exec(location.hash)[1]).split('~');
      const p = { id, lat: Number(lat), lon: Number(lon) };
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* fine */ }
      if (isFinite(p.lat) && isFinite(p.lon)) { state.pendingOpen = p; state.keepView = true; flyTo(p, 16, true); load(p); } else load(ZURICH);
      maybeLocate();
    } else {
      load(ZURICH);
      maybeLocate();
    }
    render();
    // Works offline and from the home screen once the service worker is in place.
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    window.addEventListener('online', () => { if (state.error || state.liveError) load(state.centerIsUser && state.user ? state.user : state.center || ZURICH); else renderSoft(); });
    window.addEventListener('offline', renderSoft);
    // Standing still sends few location updates, so check the arrival clock regularly too.
    setInterval(checkArrival, 20000);
    // The moment changes as the evening comes: re-rank every minute.
    setInterval(() => { computeSunset(); rank(); drawSpots(); renderSoft(); }, 60000);
  }
  start();
}());

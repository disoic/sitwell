/* ============================================================
   Sitwell: where the app's spots come from.
   Reads the static files the pipeline publishes (coverage, block indexes, squares),
   keeps squares on the phone, and fetches a square again only when its fingerprint changes.
   ============================================================ */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('../core/core.js') : root.SitwellCore);
  if (node) module.exports = api; else root.SitwellData = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  // Is a square covered? Its slot in the block's 64-bit mask, written as 16 hex characters.
  function covered(mask, slot) {
    const nibble = parseInt(mask[slot >> 2], 16);
    return ((nibble >> (3 - (slot & 3))) & 1) === 1;
  }

  // A small key-value store in IndexedDB, with memory in front; memory only where IndexedDB is missing.
  function idbStore(name = 'sitwell', store = 'files') {
    let dbp = null;
    const mem = new Map();
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(store);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    return {
      async get(k) {
        if (mem.has(k)) return mem.get(k);
        try {
          const db = await open();
          return await new Promise(res => {
            const q = db.transaction(store).objectStore(store).get(k);
            q.onsuccess = () => res(q.result || null);
            q.onerror = () => res(null);
          });
        } catch (e) { return null; }
      },
      async put(k, v) {
        mem.set(k, v);
        try { (await open()).transaction(store, 'readwrite').objectStore(store).put(v, k); } catch (e) { /* memory only */ }
      },
    };
  }
  function memoryStore() {
    const m = new Map();
    return { get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } };
  }


  /* ---------- live squares: where no static files exist yet ----------
     One Overpass request per square fetches its seats and everything around them within the same
     margins the pipeline uses; the phone measures them with the same core and keeps the result
     for 14 days, in the same format as a static square. */
  const LIVE = { version: 1, maxAgeDays: 14, margins: { point: 485, trees: 32, bins: 80, line: 650, area: 300, rays: 2100 } };
  const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  function expandBox(b, m) {
    const mid = (b[0] + b[2]) / 2, dLat = m / 110574, dLon = m / (111320 * Math.cos(mid * Math.PI / 180));
    return [b[0] - dLat, b[1] - dLon, b[2] + dLat, b[3] + dLon];
  }
  function liveBoxes(id) {
    const S = C.squareBox(id), M = LIVE.margins;
    return { S, P: expandBox(S, M.point), T: expandBox(S, M.trees), B: expandBox(S, M.bins), L: expandBox(S, M.line), A: expandBox(S, M.area), W: expandBox(S, M.rays) };
  }
  function liveQuery(id) {
    const b = liveBoxes(id), c = C.squareCenter(id), bb = x => x.map(v => v.toFixed(5)).join(',');
    return `[out:json][timeout:90][maxsize:268435456];
make section name="seats";out;
(node["amenity"="bench"](${bb(b.S)});way["amenity"="bench"](${bb(b.S)});node["leisure"="picnic_table"](${bb(b.S)});way["leisure"="picnic_table"](${bb(b.S)});nwr["amenity"="toilets"](${bb(b.P)}););
out tags center;
make section name="points";out;
(nwr["amenity"~"^(drinking_water|fountain|bicycle_parking|shelter|place_of_worship|bbq|cafe|ice_cream)$"](${bb(b.P)});nwr["man_made"="water_tap"](${bb(b.P)});nwr["shop"~"^(bakery|supermarket|convenience|kiosk)$"](${bb(b.P)});nwr["tourism"~"^(viewpoint|attraction|museum|artwork)$"](${bb(b.P)});nwr["historic"~"^(castle|monument|ruins|city_gate|fort|tower|manor|church)$"](${bb(b.P)});nwr["leisure"~"^(firepit|playground|bathing_place)$"](${bb(b.P)});node["highway"="bus_stop"](${bb(b.P)});node["railway"="tram_stop"](${bb(b.P)});node["public_transport"="platform"](${bb(b.P)}););
out tags center;
make section name="trees";out;
node["natural"="tree"](${bb(b.T)});
out skel;
make section name="bins";out;
node["amenity"="waste_basket"](${bb(b.B)});
out skel;
make section name="lines";out;
(way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"](${bb(b.L)});way["highway"~"^(pedestrian|footway|path)$"]["name"](${bb(b.L)});way["railway"~"^(rail|light_rail|narrow_gauge|tram)$"](${bb(b.L)});way["waterway"~"^(river|canal|stream)$"](${bb(b.L)});way["natural"="tree_row"](${bb(b.L)}););
out tags geom(${bb(b.L)});
make section name="coast";out;
way["natural"="coastline"](${bb(b.W)});
out tags geom(${bb(b.W)});
make section name="areas";out;
(nwr["leisure"~"^(park|garden|swimming_area)$"](${bb(b.A)});nwr["landuse"~"^(cemetery|forest)$"](${bb(b.A)});way["amenity"="grave_yard"](${bb(b.A)});nwr["natural"~"^(wood|beach)$"](${bb(b.A)}););
out tags geom;
make section name="water";out;
nwr["natural"="water"](${bb(b.W)});
out tags geom;
make section name="place";out;
is_in(${c.lat.toFixed(5)},${c.lon.toFixed(5)})->.a;
area.a["boundary"="administrative"]["admin_level"];
out tags;`;
  }
  function splitSections(json) {
    const s = { seats: [], points: [], trees: [], bins: [], lines: [], coast: [], areas: [], water: [], place: [] };
    let cur = null;
    for (const el of (json && json.elements) || []) {
      if (el.type === 'section') { cur = el.tags && el.tags.name; continue; }
      if (cur && s[cur]) s[cur].push(el);
    }
    return s;
  }
  const elId = el => el.type + '/' + el.id;
  const centerOf = el => (el.lat != null ? [el.lat, el.lon] : el.center ? [el.center.lat, el.center.lon] : null);
  // A clipped geometry (nulls where nodes were cut off) as separate flat chains [lat, lon, ...].
  function chains(geom) {
    const out = [];
    let cur = [];
    for (const g of geom || []) {
      if (!g || g.lat == null) { if (cur.length >= 4) out.push(cur); cur = []; continue; }
      cur.push(g.lat, g.lon);
    }
    if (cur.length >= 4) out.push(cur);
    return out;
  }
  const reversed = a => { const r = []; for (let k = a.length - 2; k >= 0; k -= 2) r.push(a[k], a[k + 1]); return r; };
  const closed = a => a.length >= 6 && a[0] === a[a.length - 2] && a[1] === a[a.length - 1];
  // Joins a relation's member ways into rings: ways that share end points become one chain.
  function stitch(parts) {
    const rings = [], open = [];
    for (const p of parts) (closed(p) ? rings : open).push(p.slice());
    while (open.length) {
      let cur = open.pop(), grew = true;
      while (grew && !closed(cur)) {
        grew = false;
        const e0 = cur[cur.length - 2], e1 = cur[cur.length - 1];
        for (let k = 0; k < open.length; k++) {
          const o = open[k], n = o.length;
          if (o[0] === e0 && o[1] === e1) cur = cur.concat(o.slice(2));
          else if (o[n - 2] === e0 && o[n - 1] === e1) cur = cur.concat(reversed(o).slice(2));
          else if (o[n - 2] === cur[0] && o[n - 1] === cur[1]) cur = o.concat(cur.slice(2));
          else if (o[0] === cur[0] && o[1] === cur[1]) cur = reversed(o).concat(cur.slice(2));
          else continue;
          open.splice(k, 1);
          grew = true;
          break;
        }
      }
      if (cur.length >= 6) rings.push(cur);   // closed, or as closed as the data allows
    }
    return rings;
  }
  // The passport place at the square's centre, as the prototype stored it (place format v3).
  function placeFrom(areas) {
    const lvl = n => areas.find(a => a.tags && a.tags.admin_level === String(n) && a.tags.name);
    const country = lvl(2), town = lvl(8) || lvl(7) || lvl(6);
    const inTown = town && (town === lvl(8) || town === lvl(7));
    const l9 = inTown ? lvl(9) : null, l10 = inTown ? lvl(10) : null;
    if (!town && !country) return null;
    const cname = country ? (country.tags['name:en'] || country.tags.name) : 'Somewhere';
    return { v: 3, townArea: town ? 'area/' + town.id : null, country: cname,
      code: country ? (country.tags['ISO3166-1:alpha2'] || country.tags['ISO3166-1'] || '').toUpperCase() : '',
      town: town ? town.tags.name : cname, district: l9 ? l9.tags.name : '', neighbourhood: l10 ? l10.tags.name : '' };
  }
  // Overpass's answer for one square, as core.buildContext input.
  function liveInput(json) {
    const s = splitSections(json), flat = list => { const a = []; for (const el of list) if (el.lat != null) a.push(el.lat, el.lon); return a; };
    const seats = [], points = [], lines = [], areas = [];
    for (const el of s.seats) { const c = centerOf(el); if (c) seats.push({ id: elId(el), lat: c[0], lon: c[1], tags: el.tags || {} }); }
    for (const el of s.points) { const c = centerOf(el); if (c) points.push({ id: elId(el), lat: c[0], lon: c[1], tags: el.tags || {}, node: el.type === 'node' }); }
    for (const el of s.lines.concat(s.coast)) { const parts = chains(el.geometry); if (parts.length) lines.push({ id: elId(el), tags: el.tags || {}, parts }); }
    for (const el of s.areas.concat(s.water)) {
      const parts = el.type === 'relation' ? [].concat(...(el.members || []).filter(m => m.type === 'way').map(m => chains(m.geometry))) : chains(el.geometry);
      const rings = stitch(parts);
      if (rings.length) areas.push({ id: elId(el), tags: el.tags || {}, rings });
    }
    return { input: { seats, points, trees: flat(s.trees), bins: flat(s.bins), lines, areas }, place: placeFrom(s.place) };
  }
  function liveContext(id, input) {
    const box = C.squareBox(id), ctr = C.squareCenter(id), M = LIVE.margins;
    const hx = (box[3] - box[1]) / 2 * 111320 * Math.cos(ctr.lat * Math.PI / 180), hy = (box[2] - box[0]) / 2 * 110574;
    return C.buildContext(input, ctr, { window: { x: hx + M.line, y: hy + M.line }, rays: { x: hx + M.rays, y: hy + M.rays } });
  }
  // The finished spots of one square, in the static file format.
  function buildLiveSquare(id, json) {
    const { input, place } = liveInput(json), D = liveContext(id, input), seats = [], toilets = [];
    for (const el of input.seats) {
      const kind = C.seatKind(el.tags);
      if (!kind || C.isClosed(el.tags) || C.squareOf(el.lat, el.lon) !== id) continue;
      (kind === 'toilet' ? toilets : seats).push({ id: el.id, kind, lat: el.lat, lon: el.lon, tags: el.tags });
    }
    const spots = C.groupSeats(seats).map(g => C.makeSpot(g, D)).concat(toilets.map(t => C.makeToiletSpot(t, D)));
    for (const s of spots) s.place = place ? 0 : null;
    spots.sort((a, b) => (a.id < b.id ? -1 : 1));
    return { v: C.FORMAT, square: id, places: place ? [place] : [], spots: spots.map(C.packSpot) };
  }
  // Measures one point (a bench someone added) from a fresh Overpass answer for its square.
  function measureFrom(json, lat, lon) {
    const id = C.squareOf(lat, lon), { input, place } = liveInput(json), D = liveContext(id, input);
    const [x, y] = D.proj(lat, lon), m = C.measure(x, y, 'pin', D);
    const near = Math.min(m.lake, m.river, m.pond, m.water, m.sea) <= C.RAYS.near;
    return { m: C.packMeasures(m), rays: near ? C.waterRuns(x, y, D) : null, place };
  }
  async function overpass(query, timeoutMs = 90000) {
    const why = [];
    for (const url of MIRRORS) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query), signal: ctrl ? ctrl.signal : undefined });
        if (!r.ok) throw new Error('replied ' + r.status);
        const json = await r.json();
        if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error('ran out of time');
        return json;
      } catch (e) {
        why.push(new URL(url).host + ' ' + (e.name === 'AbortError' ? 'took too long' : e.message));
      } finally { if (timer) clearTimeout(timer); }
    }
    const err = new Error('The OpenStreetMap servers are busy: ' + why.join(', '));
    err.busy = true;
    throw err;
  }

  function createSource(opts = {}) {
    const base = opts.base || 'data/v1/';
    const store = opts.store || memoryStore();
    const fetchJSON = opts.fetchJSON || (async (url, init) => {
      const r = await fetch(url, init);
      if (!r.ok) { const e = new Error(url + ' replied ' + r.status); e.status = r.status; throw e; }
      return r.json();
    });
    let coverage = null, coverageTime = 0;
    const blocks = new Map(), squares = new Map();
    const query = opts.overpass || overpass;
    const unpack = (id, file, live) => {
      const places = file.places || [];
      return file.spots.map(r => {
        const s = C.unpackSpot(r);
        s.placeInfo = s.place != null ? places[s.place] || null : null;
        s.square = id;
        s.live = !!live;
        return s;
      });
    };

    async function getCoverage(force) {
      if (coverage && !force && Date.now() - coverageTime < 30 * 60000) return coverage;
      try {
        coverage = await fetchJSON(base + 'coverage.json', { cache: 'no-cache' });
        coverageTime = Date.now();
        await store.put('coverage', coverage);
      } catch (e) {
        if (!coverage) coverage = await store.get('coverage');   // offline: the last one we had
        if (!coverage) throw e;
      }
      return coverage;
    }
    async function getBlock(id) {
      const h = (await getCoverage()).blocks[id];
      if (!h) return null;
      const mem = blocks.get(id);
      if (mem && mem.h === h) return mem.data;
      let rec = await store.get('b:' + id);
      if (!(rec && rec.h === h)) {
        rec = { h, data: await fetchJSON(base + 'b/' + id + '.json?h=' + h) };
        await store.put('b:' + id, rec);
      }
      blocks.set(id, rec);
      return rec.data;
    }
    // One square: { id, covered, spots }. Spot objects are reused while the square is unchanged.
    async function getSquare(id) {
      const block = await getBlock(C.blockOf(id));
      if (!block || !covered(block.covered, C.slotInBlock(id))) return { id, covered: false, spots: [] };
      const h = block.squares[id];
      if (!h) return { id, covered: true, spots: [] };
      const mem = squares.get(id);
      if (mem && mem.h === h) return mem.sq;
      let rec = await store.get('s:' + id);
      if (!(rec && rec.h === h)) {
        rec = { h, file: await fetchJSON(base + 's/' + id + '.json?h=' + h) };
        await store.put('s:' + id, rec);
      }
      const sq = { id, covered: true, spots: unpack(id, rec.file, false) };
      squares.set(id, { h, sq });
      return sq;
    }
    // A square measured on the phone: from what's kept (even if old, while a fresh one loads), or fetched.
    async function getLiveSquare(id, fetchNow) {
      const mem = squares.get('live:' + id);
      if (mem && Date.now() - mem.t < LIVE.maxAgeDays * 86400000) return mem.sq;
      const rec = await store.get('live:' + id);
      const fresh = rec && rec.v === LIVE.version && Date.now() - rec.t < LIVE.maxAgeDays * 86400000;
      if (fresh || (rec && rec.v === LIVE.version && !fetchNow)) {
        const sq = { id, covered: 'live', stale: !fresh, spots: unpack(id, rec.file, true) };
        if (fresh) squares.set('live:' + id, { t: rec.t, sq });
        return sq;
      }
      if (!fetchNow) return { id, covered: 'live', stale: true, spots: [] };
      const file = buildLiveSquare(id, await query(liveQuery(id)));
      const t = Date.now();
      await store.put('live:' + id, { v: LIVE.version, t, file });
      const sq = { id, covered: 'live', stale: false, spots: unpack(id, file, true) };
      squares.set('live:' + id, { t, sq });
      return sq;
    }
    // Spots within reach of a point. Static squares come at once; squares without static files come
    // from the phone's store, and the ones it lacks or has only old copies of are listed in `pending`
    // for fetchLive().
    async function spotsAround(center, radius) {
      const ids = C.squaresForCircle(center, radius);
      const res = await Promise.all(ids.map(async id => {
        try {
          const sq = await getSquare(id);
          return sq.covered ? sq : await getLiveSquare(id, false);
        } catch (e) {
          if (e.status === 404) return getLiveSquare(id, false).catch(() => ({ id, covered: null, error: e, spots: [] }));
          return { id, covered: null, error: e, spots: [] };
        }
      }));
      const spots = [];
      for (const r of res) for (const s of r.spots) spots.push(s);
      return {
        spots,
        pending: res.filter(r => r.covered === 'live' && r.stale).map(r => r.id),
        live: res.filter(r => r.covered === 'live').map(r => r.id),
        failed: res.filter(r => r.covered === null).map(r => r.id),
        error: (res.find(r => r.error) || {}).error || null,
      };
    }
    // Fetches live squares one at a time (gentle on the shared servers), nearest first.
    // onSquare(sq) returns false to stop, e.g. when the person has moved on.
    async function fetchLive(ids, onSquare, onError) {
      for (const id of ids) {
        try {
          const sq = await getLiveSquare(id, true);
          if (onSquare(sq) === false) return;
        } catch (e) {
          if (onError && onError(id, e) === false) return;
        }
      }
    }
    async function measurePoint(lat, lon) {
      return measureFrom(await query(liveQuery(C.squareOf(lat, lon))), lat, lon);
    }
    let placeList = null;
    async function places() {
      if (placeList) return placeList;
      const cov = await getCoverage();
      const json = await fetchJSON(base + 'places.json?b=' + encodeURIComponent(cov.built || ''));
      return (placeList = json.places || []);
    }
    return { getCoverage, getSquare, getLiveSquare, spotsAround, fetchLive, measurePoint, places };
  }

  // Place search: accents and case ignored, matching the start of any word, towns before neighbourhoods.
  const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function searchPlaces(list, query, limit = 8) {
    const q = fold(query.trim());
    if (q.length < 2) return [];
    const hits = [];
    for (const p of list) {
      const n = fold(p[0]);
      const where = n.startsWith(q) ? 0 : (n.includes(' ' + q) || n.includes('-' + q)) ? 1 : -1;
      if (where < 0) continue;
      hits.push({ name: p[0], context: p[1], lat: p[2], lon: p[3], level: p[4], rank: where * 10 + (p[4] >= 9 ? 2 : p[4] === 6 ? 1 : 0) + n.length / 100 });
    }
    return hits.sort((a, b) => a.rank - b.rank).slice(0, limit);
  }

  return { createSource, idbStore, memoryStore, covered, searchPlaces, fold, liveBoxes, liveQuery, liveInput, buildLiveSquare, measureFrom, stitch, LIVE };
}));

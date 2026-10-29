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
      const places = rec.file.places || [];
      const spots = rec.file.spots.map(r => {
        const s = C.unpackSpot(r);
        s.placeInfo = s.place != null ? places[s.place] || null : null;
        s.square = id;
        return s;
      });
      const sq = { id, covered: true, spots };
      squares.set(id, { h, sq });
      return sq;
    }
    // Spots within reach of a point; also which squares around it aren't covered or failed to load.
    async function spotsAround(center, radius) {
      const ids = C.squaresForCircle(center, radius);
      const res = await Promise.all(ids.map(id => getSquare(id).catch(e => ({ id, covered: null, error: e, spots: [] }))));
      const spots = [];
      for (const r of res) for (const s of r.spots) spots.push(s);
      return {
        spots,
        uncovered: res.filter(r => r.covered === false).map(r => r.id),
        failed: res.filter(r => r.covered === null).map(r => r.id),
        error: (res.find(r => r.error) || {}).error || null,
      };
    }
    let placeList = null;
    async function places() {
      if (placeList) return placeList;
      const cov = await getCoverage();
      const json = await fetchJSON(base + 'places.json?b=' + encodeURIComponent(cov.built || ''));
      return (placeList = json.places || []);
    }
    return { getCoverage, getSquare, spotsAround, places };
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

  return { createSource, idbStore, memoryStore, covered, searchPlaces, fold };
}));

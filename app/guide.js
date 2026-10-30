/* ============================================================
   Sitwell: your field guide.
   One page for every spot you've rated or added, the passport stamps, and the souvenirs
   pressed into some pages. Worked out from your history alone, so it needs no spot files and
   counts ratings made in the prototype too. Pure functions: no DOM, no network.
   ============================================================ */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('../core/core.js') : root.SitwellCore);
  if (node) module.exports = api; else root.SitwellGuide = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  // The souvenirs, in the order the shelf shows them. Small line drawings in the app's style.
  const KINDS = [
    { id: 'pebble', name: 'Smooth pebble', from: 'by a lake', color: '#6E7C82',
      path: '<path d="M4.5 14.5c0-3.6 3.4-6 7.8-6s7.2 2.2 7.2 5.4-3.2 5.1-7.6 5.1-7.4-1.1-7.4-4.5z"/><path d="M8.3 12.2c1.3-1 3-1.4 4.6-1.2"/>' },
    { id: 'feather', name: 'Feather', from: 'by a river', color: '#8A6A4A',
      path: '<path d="M18.5 4.5C11 5.5 6.5 10.5 6 18.5"/><path d="M18.5 4.5c-.5 6.5-4.8 11.5-12.5 14"/><path d="M6 18.5 3.5 21"/><path d="M14 8.5l-3.5 3.5M16 10l-4.5 4.5M11.5 7l-2.5 2.5"/>' },
    { id: 'shell', name: 'Seashell', from: 'by the sea', color: '#B9804F',
      path: '<path d="M12 5.5c-4.7 0-8 3.6-8 8.2l3.2 4.8h9.6l3.2-4.8c0-4.6-3.3-8.2-8-8.2z"/><path d="M12 5.5v13M8.4 6.6l1.4 11.9M15.6 6.6l-1.4 11.9M5.3 9.9l3.3 8.6M18.7 9.9l-3.3 8.6"/><path d="M10 18.5v2h4v-2"/>' },
    { id: 'dragonfly', name: 'Dragonfly', from: 'by a pond or stream', color: '#3F8A8C',
      path: '<path d="M12 6.5V21"/><circle cx="12" cy="5" r="1.6"/><path d="M12 8.5C9.5 6 4.5 6 4 8s5 2.5 8 .5zM12 8.5C14.5 6 19.5 6 20 8s-5 2.5-8 .5zM12 11.5c-2-1.5-6.5-1.4-7 .2s4.5 2 7-.2zM12 11.5c2-1.5 6.5-1.4 7 .2s-4.5 2-7-.2z"/>' },
    { id: 'pinecone', name: 'Pinecone', from: 'in the woods', color: '#7A5232',
      path: '<path d="M12 3.5c3.2 2.8 5.2 6.4 5.2 10.2 0 4-2.4 6.8-5.2 6.8s-5.2-2.8-5.2-6.8c0-3.8 2-7.4 5.2-10.2z"/><path d="M7.6 10.5 12 13l4.4-2.5M7 14.5l5 3 5-3M9.5 7.5 12 9l2.5-1.5"/>' },
    { id: 'flower', name: 'Pressed flower', from: 'in a park or garden', color: '#AE5A7C',
      path: '<circle cx="12" cy="8" r="1.8"/><path d="M12 6.2c-.8-2.4 1.6-3.7 2.6-2 .9 1.4-.6 2.6-2.6 2zM13.7 8.6c2.3-.9 3.8 1.4 2.2 2.5-1.4 1-2.7-.5-2.2-2.5zM12.4 9.8c.6 2.4-2 3.4-2.8 1.6-.8-1.5.8-2.5 2.8-1.6zM10.3 8.4c-2.3.7-3.6-1.7-1.9-2.6 1.5-.8 2.6.8 1.9 2.6z"/><path d="M12 10v10.5M12 16c1.6-1.8 3.8-2 4.8-1.2-1 1.6-3 2-4.8 1.2zM12 14c-1.4-1.4-3.4-1.5-4.2-.8.9 1.4 2.6 1.6 4.2.8z"/>' },
    { id: 'postcard', name: 'Postcard', from: 'at a viewpoint', color: '#4A6F96',
      path: '<rect x="3" y="6" width="18" height="12.5" rx="1.5"/><path d="M13 9v7M15.5 9h3v3.2h-3zM5.5 10h5M5.5 12.8h5M5.5 15.5h3.5"/>' },
    { id: 'coin', name: 'Old coin', from: 'near a landmark', color: '#A2801F',
      path: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="5.6"/><path d="M12 8.6l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z"/>' },
    { id: 'napkin', name: 'Checked napkin', from: 'at a picnic table', color: '#B4473F',
      path: '<path d="M5 5.5h14v13H5z"/><path d="M9.7 5.5v13M14.3 5.5v13M5 9.8h14M5 14.2h14"/>' },
    { id: 'watercolour', name: 'Watercolour of the sunset', from: 'rating a sunset spot in the hour before sunset', color: '#C2641F',
      path: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 14.5h18"/><path d="M8.5 14.5a3.5 3.5 0 0 1 7 0"/><path d="M6 17h4M12.5 17h5.5M12 9.2V8M8.4 10.6l-.8-.7M15.6 10.6l.8-.7"/>' },
    { id: 'chestnut', name: 'Chestnut', from: 'in autumn', color: '#8A4F2A',
      path: '<path d="M12 5.2c4.6 0 8 3.2 8 7.5 0 4.3-3.6 7.3-8 7.3s-8-3-8-7.3c0-4.3 3.4-7.5 8-7.5z"/><path d="M6.3 14.6c3.6 1.6 7.8 1.6 11.4 0"/><path d="M12 5.2l.6-2"/>' },
    { id: 'blossom', name: 'Blossom', from: 'in spring', color: '#C46C8C',
      path: '<path d="M3.5 20.5c3.5-1.5 6.5-4.5 8.5-8.5"/><circle cx="15" cy="8.5" r="1.4"/><path d="M15 7.1c-.9-2.4 1.3-3.8 2.5-2.4M16.3 8.1c2.3-.6 3.2 1.9 1.6 2.8M15.8 9.8c1 2.2-1.2 3.6-2.4 2.3M14.1 9.6c-2.1 1-3.5-1.2-2.1-2.4M14 7.6c-1.3-2-.1-3.6 1-3.1"/><path d="M8 16.5c-1.5-.5-2.5.5-2 1.5"/>' },
    { id: 'frost', name: 'Frost', from: 'in winter', color: '#5B87A8',
      path: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M12 3l-2 2M12 3l2 2M12 21l-2-2M12 21l2-2M4.2 7.5l.7 2.7M4.2 7.5l2.7-.7M19.8 16.5l-.7-2.7M19.8 16.5l-2.7.7M4.2 16.5l2.7.7M4.2 16.5l.7-2.7M19.8 7.5l-2.7-.7M19.8 7.5l-.7 2.7"/>' },
  ];
  const BY_ID = Object.fromEntries(KINDS.map(k => [k.id, k]));
  const SETTING_KIND = { lake: 'pebble', river: 'feather', sea: 'shell', pond: 'dragonfly', woods: 'pinecone', park: 'flower', view: 'postcard', landmark: 'coin', picnic: 'napkin' };
  const SEASON_KIND = { autumn: 'chestnut', spring: 'blossom', winter: 'frost' };
  const CAPTION = { pebble: 'A smooth pebble', feather: 'A feather', shell: 'A seashell', dragonfly: 'A dragonfly', pinecone: 'A pinecone',
    flower: 'A pressed flower', postcard: 'A postcard', coin: 'An old coin', napkin: 'A checked napkin', watercolour: 'A watercolour of the sunset',
    chestnut: 'A chestnut', blossom: 'Blossom', frost: 'Frost on a leaf' };
  const ONE_IN = 5;   // after the first of each kind, about one new page in five holds a souvenir

  function svg(kind, size = 24, faint = false) {
    const k = BY_ID[kind];
    if (!k) return '';
    return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${faint ? '#D3CDC1' : k.color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${k.path}</svg>`;
  }

  // Which settings a page has, read from its summary sentence: the same words the app writes.
  function settingsOf(where, kind) {
    const raw = where || '', w = raw.toLowerCase(), out = [];
    if (/\bseaside\b/.test(w)) out.push('sea');
    if (/\blakeside\b/.test(w)) out.push('lake');
    if (/\briverside\b/.test(w)) out.push('river');
    if (/by a stream|by a pond|by the water/.test(w)) out.push('pond');
    if (/in the woods|at the forest edge/.test(w)) out.push('woods');
    if (/in a park|in a garden/.test(w)) out.push('park');
    if (/with a view/.test(w)) out.push('view');
    if (/\bnear [A-ZÀ-ÖØ-ÞĀ-Ž0-9]/.test(raw)) out.push('landmark');
    if (kind === 'table' || /picnic table/.test(w)) out.push('picnic');
    return out;
  }
  const isSunsetSpot = where => /sunsets over/i.test(where || '');
  function season(d) {
    const m = d.getMonth();
    return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
  }
  const seasonKey = d => season(d) + ':' + (d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear());   // December counts with the next winter
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const OLD_WORDS = { lovely: 5, okay: 3, notgreat: 2, clean: 4, avoid: 1 };
  const norm = r => (r === 'closed' || typeof r === 'number' ? r : typeof r === 'string' && /^[1-5]$/.test(r) ? Number(r) : OLD_WORDS[r] || null);
  const placeName = p => (p ? p.neighbourhood || p.district || p.town || '' : '');

  /* The field guide from the history.
     sentenceFor(page) and titleFor(page) fill in pages whose events carry no summary or title
     (benches you added, ratings from the prototype).
     Returns { pages (oldest first), shelf, found, passport, places }. */
  function build(events, opts = {}) {
    const sentenceFor = opts.sentenceFor || (() => ''), titleFor = opts.titleFor || (() => '');
    const removed = new Set(events.filter(e => e.type === 'remove').map(e => e.id));
    const pages = new Map();
    const sorted = events.filter(e => e && e.type).slice().sort((a, b) => (a.t || 0) - (b.t || 0));
    for (const e of sorted) {
      const key = e.type === 'add' ? e.id : e.spot || e.id;
      if (!key) continue;
      if (e.type === 'checkin' || e.type === 'add') {
        if (e.type === 'add' && removed.has(e.id)) continue;
        let p = pages.get(key);
        if (!p) {
          p = { key, first: e.t || 0, lat: e.lat, lon: e.lon, kind: e.kind || 'bench', title: '', where: '', place: null,
            rating: null, tags: [], visits: 0, times: [], added: e.type === 'add' };
          pages.set(key, p);
        }
        p.visits++;
        p.times.push(e.t || 0);
        if (e.rating != null) p.rating = norm(e.rating);
        if (e.where) p.where = e.where;
        if (e.title) p.title = e.title;
        if (e.place) p.place = e.place;
      } else if (pages.has(key)) {
        const p = pages.get(key);
        if (e.type === 'rate' && e.rating != null) p.rating = norm(e.rating);
        else if (e.type === 'tags') p.tags = e.tags || [];
        else if (e.type === 'vote') p.rating = e.v === 1 ? 5 : e.v === -1 ? 2 : p.rating;
      }
    }
    const list = [...pages.values()].filter(p => p.kind !== 'toilet').sort((a, b) => a.first - b.first);
    const have = {}, seasons = new Set();
    for (const p of list) {
      if (!p.where) p.where = sentenceFor(p) || '';
      p.settings = settingsOf(p.where, p.kind);
      const when = new Date(p.first);
      let pick = null;
      // 1. A sunset spot, rated in the hour before sunset (or just after).
      if (isSunsetSpot(p.where) && p.lat != null) {
        for (const t of p.times) {
          const ss = C.sunsetAt(new Date(t), p.lat, p.lon);
          if (ss && t >= ss.getTime() - 3600000 && t <= ss.getTime() + 600000) { pick = 'watercolour'; break; }
        }
      }
      // 2. The first spot in each kind of setting.
      if (!pick) pick = p.settings.map(s => SETTING_KIND[s]).find(k => !have[k]) || null;
      // 3. The first page of each autumn, spring and winter that has nothing else.
      const sk = SEASON_KIND[season(when)] ? seasonKey(when) : null;
      if (!pick && sk && !seasons.has(sk)) { pick = SEASON_KIND[season(when)]; seasons.add(sk); }
      // 4. Now and then: about one page in five, from one of its settings. Fixed per spot.
      if (!pick && p.settings.length && hash(p.key) % ONE_IN === 0) pick = SETTING_KIND[p.settings[hash(p.key + '#') % p.settings.length]];
      if (pick) {
        have[pick] = (have[pick] || 0) + 1;
        const at = placeName(p.place);
        p.souvenir = { kind: pick, name: BY_ID[pick].name, caption: CAPTION[pick] + (at ? ' from ' + at : '') };
      }
      if (!p.title) p.title = titleFor(p) || (p.added ? (p.kind === 'table' ? 'Picnic table you added' : 'Bench you added') : 'A spot you rated');
    }
    const shelf = KINDS.map(k => ({ id: k.id, name: k.name, from: k.from, count: have[k.id] || 0 }));
    return { pages: list, shelf, found: shelf.filter(k => k.count).length, passport: passport(list), places: new Set(list.map(p => stampOf(p.place)).filter(Boolean)).size };
  }

  // A passport stamp per neighbourhood (district in Croatia, where neighbourhoods are tiny), else per town.
  function stampOf(pl) {
    if (!pl || !pl.town) return null;
    const sub = pl.code === 'HR' ? pl.district : pl.neighbourhood || pl.district;
    return [pl.code || '', pl.town, sub || ''].join('|');
  }
  function passport(pages) {
    const towns = new Map();
    for (const p of pages) {
      const pl = p.place;
      if (!pl || !pl.town) continue;
      const k = (pl.code || '') + '|' + pl.town;
      let t = towns.get(k);
      if (!t) { t = { town: pl.town, country: pl.country || '', code: pl.code || '', parts: new Set(), total: 0, unit: '', pages: 0, first: p.first }; towns.set(k, t); }
      t.pages++;
      const hr = pl.code === 'HR', sub = hr ? pl.district : pl.neighbourhood || pl.district;
      if (sub) t.parts.add(sub);
      const total = hr ? pl.districts : pl.neighbourhood ? pl.neighbourhoods : pl.districts;
      if (total && total > t.total) { t.total = total; t.unit = hr || !pl.neighbourhood ? 'districts' : 'neighbourhoods'; }
    }
    return [...towns.values()].map(t => Object.assign(t, { parts: t.parts.size })).sort((a, b) => b.pages - a.pages || a.first - b.first);
  }

  return { KINDS, SETTING_KIND, SEASON_KIND, ONE_IN, svg, settingsOf, build, passport, stampOf, hash };
}));

/* ============================================================
   Sitwell: what the app says about a spot.
   Summary, sunset seasons, warnings, the estimate, the score, "looks promising"
   and "best right now", from a spot unpacked from the static files (core.unpackSpot).
   Pure functions: no DOM, no network.
   ============================================================ */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('../core/core.js') : root.SitwellCore);
  if (node) module.exports = api; else root.SitwellPresent = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  // Thresholds in metres: the prototype's, plus the new ones.
  const R = Object.assign({}, C.RULES, {
    sea: 40,            // "seaside"
    firepit: 150,       // fire pit nearby
    playground: 60,
    swim: 150,          // swimming spot nearby
    snack: 200,         // kiosk, café or ice cream
    motorway: 200,      // motorway or expressway heard from here
    primaryRoad: 40,    // busy main road
    tertiaryRoad: 12,   // smaller road right next to the seat
    sunsetWater: 150,   // open water toward the sunset, in metres, for "sunsets over the water"
    facingSlack: 100,   // a bench facing further than this from the sunset doesn't count for it
  });

  // The score: the surroundings estimate counts as `priorWeight` imaginary ratings.
  const SCORE = { priorWeight: 3, lovely: 4.5, nice: 3.5, promisingShare: 0.1, promisingFloor: 3.5 };

  const round1 = x => Math.round(x * 10) / 10;
  const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /* ---------- the sun ---------- */

  const rad = Math.PI / 180, DAY = 86400000, J1970 = 2440588, J2000 = 2451545, OBL = rad * 23.4397;
  // Compass bearing (0 north, 90 east) and altitude of the sun, in degrees (the SunCalc formulas).
  function sunPosition(date, lat, lon) {
    const d = date.valueOf() / DAY - 0.5 + J1970 - J2000, lw = rad * -lon, phi = rad * lat;
    const M = rad * (357.5291 + 0.98560028 * d);
    const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(OBL) * Math.sin(L)), ra = Math.atan2(Math.sin(L) * Math.cos(OBL), Math.cos(L));
    const H = rad * (280.16 + 360.9856235 * d) - lw - ra;
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    return { bearing: (az / rad + 540) % 360, altitude: alt / rad };
  }
  // Where on the horizon the sun sets that day.
  function sunsetBearing(date, lat, lon) {
    const t = C.sunsetAt(date, lat, lon);
    return t ? sunPosition(t, lat, lon).bearing : null;
  }
  // Open water (metres) toward a compass bearing, from the spot's rays.
  function waterToward(rays, bearing) {
    if (!rays || bearing == null) return 0;
    const B = C.RAY_BEARINGS, step = C.RAYS.step, last = B.length - 1;
    if (bearing <= B[0]) return rays[0];
    if (bearing >= B[last]) return rays[last];
    const k = Math.floor((bearing - B[0]) / step), f = (bearing - B[k]) / step;
    return rays[k] * (1 - f) + rays[Math.min(k + 1, last)] * f;
  }
  const faces = (tags, bearing) => tags.direction == null || angleDiff(Number(tags.direction), bearing) <= R.facingSlack;
  const sunsetOverWater = (s, bearing) => bearing != null && waterToward(s.rays, bearing) >= R.sunsetWater && faces(s.tags || {}, bearing);

  // Months (1-12) when the sun sets over open water, seen from this spot. Cached on the spot.
  function sunsetMonths(s) {
    if (s._sunsetMonths) return s._sunsetMonths;
    const out = [];
    if (s.rays) {
      const year = new Date().getUTCFullYear();
      for (let m = 0; m < 12; m++) if (sunsetOverWater(s, sunsetBearing(new Date(Date.UTC(year, m, 15, 12)), s.lat, s.lon))) out.push(m + 1);
    }
    return (s._sunsetMonths = out);
  }
  const sunsetToday = (s, date = new Date()) => !!s.rays && sunsetOverWater(s, sunsetBearing(date, s.lat, s.lon));

  // "from April to September", "in spring and autumn", or '' for all year.
  function seasonPhrase(months) {
    if (months.length >= 11) return '';
    const on = new Array(12).fill(false);
    for (const m of months) on[m - 1] = true;
    const runs = [];
    for (let k = 0; k < 12; k++) {
      if (on[k] && !on[(k + 11) % 12]) {
        let e = k;
        while (on[(e + 1) % 12] && (e + 1) % 12 !== k) e = (e + 1) % 12;
        runs.push([k, e]);
      }
    }
    if (runs.length === 1) {
      const [a, b] = runs[0];
      return a === b ? ` in ${MONTHS[a]}` : ` from ${MONTHS[a]} to ${MONTHS[b]}`;
    }
    return ' in spring and autumn';
  }
  function waterWord(m) {
    const near = [['the sea', m.sea], ['the lake', m.lake], ['the river', m.river], ['the water', Math.min(m.pond, m.water)]];
    return near.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
  }

  /* ---------- noise ---------- */

  function noise(m) {
    if (m.roadMajor <= R.motorway) return { label: 'Motorway', d: m.roadMajor };
    const busy = Math.min(m.roadSecondary, m.roadPrimary);
    if (busy <= R.busyRoad) return { label: 'Busy road', d: busy };
    if (m.roadPrimary <= R.primaryRoad) return { label: 'Busy road', d: m.roadPrimary };
    if (m.roadTertiary <= R.tertiaryRoad) return { label: 'Road', d: m.roadTertiary };
    return null;
  }
  function roadPenalty(m) {
    return Math.max(
      m.roadMajor <= 100 ? 1.0 : m.roadMajor <= R.motorway ? 0.5 : 0,
      m.roadPrimary <= R.busyRoad ? 1.0 : m.roadPrimary <= 60 ? 0.3 : 0,
      m.roadSecondary <= R.busyRoad ? 0.8 : 0,
      m.roadTertiary <= R.tertiaryRoad ? 0.3 : 0);
  }

  /* ---------- the summary ---------- */

  function describe(s) {
    if (s.kind === 'toilet') return C.describe(s);
    const t = s.tags || {}, m = s.m, facts = [], warnings = [];
    const where =
      m.inCemetery ? 'in a cemetery' :
      m.inPark ? 'in a park' :
      m.inGarden ? 'in a garden' :
      m.inForest ? 'in the woods' :
      m.forestEdge <= R.forestEdge ? 'at the forest edge' : '';
    const nb = s.counts.bench, nt = s.counts.table;
    const mat = C.MATERIAL[t.material] ? C.MATERIAL[t.material] + ' ' : '';
    let noun;
    if (nb + nt <= 1) noun = mat + (nt ? 'picnic table' : 'bench');
    else if (nb <= 1 && nt <= 1) noun = 'bench and picnic table';
    else if (!nt) noun = `group of ${nb} ${mat}benches`;
    else if (!nb) noun = `group of ${nt} picnic tables`;
    else noun = `group of ${nb} ${nb === 1 ? 'bench' : mat + 'benches'} and ${nt === 1 ? 'a picnic table' : nt + ' picnic tables'}`;
    const seaside = m.sea <= R.sea, lakeside = !seaside && m.lake <= R.lake, riverside = !seaside && !lakeside && m.river <= R.river;
    const head = [seaside ? 'seaside' : lakeside ? 'lakeside' : riverside ? 'riverside' : '', noun].filter(Boolean).join(' ');
    const tail = [];
    if (where) tail.push(where);
    if (m.promenade <= R.promenade) tail.push('on a promenade');
    if (!seaside && !lakeside && !riverside) {
      if (m.stream <= R.stream) tail.push('by a stream');
      else if (m.pond <= R.pond) tail.push('by a pond');
      else if (m.water <= R.pond) tail.push('by the water');
    }
    if (m.landmark <= R.landmark && m.landmarkName) tail.push(`near ${m.landmarkName}`);
    const months = sunsetMonths(s), sunset = months.length ? `sunsets over ${waterWord(m)}${seasonPhrase(months)}` : '';
    if (m.view <= R.view) tail.push(sunset ? `with a view and ${sunset}` : 'with a view');
    else if (sunset) tail.push(`with ${sunset}`);
    const sentence = cap(head + (tail.length ? ' ' + tail.join(', ') : '')) + '.';

    const c = [];
    if (nb) {
      if (t.backrest === 'yes') c.push(nb > 1 ? 'backrests' : 'backrest');
      else if (t.backrest === 'some') c.push('some with backrest');
      else if (t.backrest === 'no') c.push('no backrest');
      if (t.armrest === 'yes') c.push('armrests');
    }
    if (t.covered === 'yes' || m.shelter <= R.shelter) c.push('roofed');
    if (!m.inForest && (m.trees >= R.shadeTrees || m.treeRow <= R.shadeRadius)) c.push('likely shaded');
    if (t.lit === 'yes') c.push('lit at night');

    if (m.drink <= R.drinkingWater) facts.push({ label: 'Drinking water', d: m.drink });
    if (m.toilet <= R.toilet) facts.push({ label: 'Toilet', d: m.toilet });
    if (m.snack <= R.snack && m.snackLabel) facts.push({ label: m.snackLabel, d: m.snack });
    if (m.food <= R.food) facts.push({ label: m.foodLabel, d: m.food });
    if (m.firepit <= R.firepit) facts.push({ label: 'Fire pit', d: m.firepit });
    if (m.swim <= R.swim) facts.push({ label: 'Swimming', d: m.swim });
    if (m.playground <= R.playground) facts.push({ label: 'Playground', d: m.playground });
    if (m.bin <= R.bin) facts.push({ label: 'Bin', d: m.bin });
    if (m.bike <= R.bikeParking) facts.push({ label: 'Bike parking', d: m.bike });

    const n = noise(m);
    if (n) warnings.push(n);
    if (m.rail <= R.railway) warnings.push({ label: 'Railway', d: m.rail });
    if (m.tram <= R.tram) warnings.push({ label: 'Tram line', d: m.tram });
    if (m.stop <= R.stop) warnings.push({ label: m.stopLabel, d: m.stop });

    return {
      sentence,
      comfort: c.length ? cap(c.join(', ')) + '.' : '',
      note: !tail.length && !c.length && head === noun && nb + nt <= 1 ? 'Nothing notable mapped around it.' : '',
      facts, warnings, sunsetMonths: months,
    };
  }

  /* ---------- estimate, score, bands ---------- */

  // A first guess (1 to 5) from the surroundings alone. Provisional weights: to be fitted
  // against spots rated by people who know them.
  function estimate(s) {
    if (s.kind === 'toilet') return null;
    const m = s.m, t = s.tags || {};
    let x = 2.6;
    if (m.lake <= R.lake || m.river <= R.river || m.sea <= R.sea) x += 1.2;
    else if (m.stream <= R.stream || m.pond <= R.pond || m.water <= R.pond) x += 0.8;
    if (m.inPark || m.inGarden) x += 0.6;
    if (m.inForest || m.forestEdge <= R.forestEdge) x += 0.6;
    if (m.view <= R.view) x += 0.8;
    if (sunsetMonths(s).length >= 3) x += 0.3;
    if (m.landmark <= R.landmark && m.landmarkName) x += 0.3;
    if (m.promenade <= R.promenade) x += 0.3;
    if (m.trees >= R.shadeTrees || m.treeRow <= R.shadeRadius) x += 0.2;
    if (t.backrest === 'yes' || t.backrest === 'some') x += 0.2;
    if (m.firepit <= R.firepit) x += 0.2;
    if (m.swim <= R.swim) x += 0.2;
    if (m.snack <= R.snack) x += 0.1;
    if (m.inCemetery) x -= 0.6;
    x -= roadPenalty(m);
    if (m.rail <= R.railway) x -= 0.6;
    if (m.tram <= R.tram) x -= 0.3;
    if (m.stop <= R.stop) x -= 0.7;
    return Math.max(1, Math.min(5, round1(x)));
  }
  // One score for everything: a spot starts at its estimate, and real ratings take over as they arrive.
  // ratings: { n, sum } of stars from people who checked in there.
  function score(s, ratings) {
    const e = s.estimate != null ? s.estimate : estimate(s);
    if (e == null) return null;
    if (!ratings || !ratings.n) return { value: e, rated: false, n: 0 };
    return { value: round1((SCORE.priorWeight * e + ratings.sum) / (SCORE.priorWeight + ratings.n)), rated: true, n: ratings.n };
  }
  // Lovely and Nice need real ratings; an estimate alone never earns them.
  const band = sc => (!sc || !sc.rated ? null : sc.value >= SCORE.lovely ? 'lovely' : sc.value >= SCORE.nice ? 'nice' : null);

  // "Looks promising": the best tenth of the unrated spots in view, and never below the floor,
  // so it means something both on a lakefront full of lovely spots and in a plain suburb.
  function promising(spots, isRated = () => false) {
    const pool = spots.filter(s => s.kind !== 'toilet' && !isRated(s.id) && s.estimate != null).sort((a, b) => b.estimate - a.estimate);
    if (!pool.length) return new Set();
    const k = Math.max(1, Math.ceil(pool.length * SCORE.promisingShare));
    const cut = Math.max(SCORE.promisingFloor, pool[k - 1].estimate);
    return new Set(pool.filter(s => s.estimate >= cut).map(s => s.id));
  }

  /* ---------- flags for the filters ---------- */

  function flags(s) {
    const m = s.m;
    return {
      water: m.lake <= R.lake || m.river <= R.river || m.sea <= R.sea || m.stream <= R.stream || m.pond <= R.pond || m.water <= R.pond,
      green: m.inPark || m.inGarden || m.inForest || m.forestEdge <= R.forestEdge,
      quiet: !(noise(m) || m.rail <= R.railway || m.tram <= R.tram || m.stop <= R.stop),
      sunset: sunsetMonths(s).length > 0,
      firepit: m.firepit <= R.firepit,
      swim: m.swim <= R.swim,
    };
  }

  /* ---------- best right now ---------- */

  // Tonight's sunset sky from an hourly forecast at the sunset hour: cloud cover in percent, rain in mm.
  function sunsetOutlook(h) {
    if (!h) return null;
    if (h.precip >= 0.3) return { label: 'Rain likely around sunset', quality: 0 };
    if (h.low >= 70) return { label: 'Overcast at sunset', quality: 0.1 };
    const upper = Math.max(h.mid, h.high);
    if (h.low < 40 && upper >= 20 && upper <= 75) return { label: 'High clouds at sunset: could be colourful', quality: 1 };
    if (h.low < 30 && upper < 20) return { label: 'Clear sky at sunset', quality: 0.8 };
    return { label: 'Some clouds at sunset', quality: 0.5 };
  }
  // Open-Meteo, free and without a key. The position is rounded to about a kilometre.
  function forecastUrl(lat, lon) {
    return `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
      '&hourly=temperature_2m,precipitation,cloud_cover_low,cloud_cover_mid,cloud_cover_high&forecast_days=2&timeformat=unixtime&timezone=GMT';
  }
  // The forecast hour nearest to a moment, as { temp, precip, low, mid, high }.
  function forecastAt(json, date) {
    const h = json && json.hourly;
    if (!h || !h.time || !h.time.length) return null;
    const t = date.valueOf() / 1000;
    let k = 0;
    for (let i = 1; i < h.time.length; i++) if (Math.abs(h.time[i] - t) < Math.abs(h.time[k] - t)) k = i;
    if (Math.abs(h.time[k] - t) > 5400) return null;
    return { temp: h.temperature_2m[k], precip: h.precipitation[k], low: h.cloud_cover_low[k], mid: h.cloud_cover_mid[k], high: h.cloud_cover_high[k] };
  }

  /* How good a spot is right now, for sorting "Best right now".
     ctx: { now, at: { lat, lon }, bike, weather: { temp, precip, low, mid, high } | null, sunset: { at: Date, outlook } | null } */
  function nowValue(s, ctx) {
    const m = s.m, t = s.tags || {};
    let v = s.score ? s.score.value : s.estimate != null ? s.estimate : 3;
    const reasons = [];
    const w = ctx.weather;
    const roofed = t.covered === 'yes' || m.shelter <= R.shelter;
    const shaded = m.inForest || m.trees >= R.shadeTrees || m.treeRow <= R.shadeRadius;
    if (w && w.precip >= 0.2) { v += roofed ? 1.2 : -0.6; if (roofed) reasons.push('roofed'); }
    if (w && w.temp >= 26) { v += shaded ? 0.5 : -0.3; if (shaded) reasons.push('shade'); }
    if (w && w.temp <= 10 && w.precip < 0.2 && Math.max(w.low, w.mid) < 50 && !shaded) { v += 0.3; reasons.push('sun'); }
    if (ctx.sunset && ctx.sunset.at) {
      const minutes = (ctx.sunset.at - ctx.now) / 60000;
      if (minutes <= 90 && minutes >= -10 && sunsetToday(s, ctx.now)) {
        const q = ctx.sunset.outlook ? ctx.sunset.outlook.quality : 1;
        v += 0.3 + 0.7 * q;
        reasons.push('sunset');
      }
      if (minutes < -30 && t.lit === 'yes') { v += 0.3; reasons.push('lit'); }
    }
    // Every minute of getting there beyond the first few counts a little against a spot.
    const minutesAway = C.metres(ctx.at.lat, ctx.at.lon, s.lat, s.lon) / (ctx.bike ? 250 : 80);
    v -= Math.max(0, minutesAway - 3) * 0.06;
    return { value: round1(v), minutes: Math.round(minutesAway), reasons };
  }
  function rankNow(spots, ctx) {
    return spots.filter(s => s.kind !== 'toilet')
      .map(s => Object.assign({ spot: s }, nowValue(s, ctx)))
      .sort((a, b) => b.value - a.value || a.minutes - b.minutes);
  }

  // Everything the app shows about a spot, worked out once.
  function prepare(s, ratings) {
    s.estimate = estimate(s);
    s.score = score(s, ratings);
    s.text = describe(s);
    s.flags = s.kind === 'toilet' ? C.flagsOf(s.m) : flags(s);
    return s;
  }

  return {
    R, SCORE, sunPosition, sunsetBearing, waterToward, sunsetMonths, sunsetToday, seasonPhrase, waterWord, noise,
    describe, estimate, score, band, promising, flags, sunsetOutlook, forecastUrl, forecastAt, nowValue, rankNow, prepare,
  };
}));

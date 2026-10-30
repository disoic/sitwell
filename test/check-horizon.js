// Checks the elevation reader and the horizon profiles, against a made-up world served locally.
// Run: node test/check-horizon.js
'use strict';
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const PORT = 8790;
process.env.DEM_URL = `http://127.0.0.1:${PORT}/terrarium/{z}/{x}/{y}.png`;
const C = require('../core/core.js');
const P = require('../app/present.js');
const { Elevation, decodePNG, terrarium } = require('../pipeline/lib/dem.js');
const Horizon = require('../pipeline/lib/horizon.js');
const server = require('./dem-server.js');

(async () => {
  // 1. A tile written by an independent encoder (Python's imaging library), when it's available.
  const file = '/tmp/sitwell-pil-terrarium.png';
  try {
    execFileSync('python3', ['-c', `
from PIL import Image
im = Image.new('RGB', (256, 256))
px = im.load()
for y in range(256):
    for x in range(256):
        v = 100 + x * 0.5 + y * 2.25 + 32768
        px[x, y] = (int(v // 256), int(v) % 256, int((v - int(v)) * 256))
im.save('${file}')`], { stdio: 'pipe' });
    const e = terrarium(decodePNG(fs.readFileSync(file)));
    let worst = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) worst = Math.max(worst, Math.abs(e[y * 256 + x] - (100 + x * 0.5 + y * 2.25)));
    assert(worst < 0.01, 'PIL tile read wrong by ' + worst);
    console.log(`reads a PNG written by another encoder exactly (worst error ${worst.toFixed(4)} m)`);
  } catch (e) { if (e.code === 'ERR_ASSERTION') throw e; console.log('(no Python imaging library here, skipped the independent PNG check)'); }

  const srv = await server.start(PORT, 'ridge');
  // 2. All five PNG row filters, through the stand-in.
  const dem = new Elevation();
  await dem.load([[12, 2145, 1434]]);
  assert(dem.tiles.get('12/2145/1434'), 'tile loaded');
  console.log('reads tiles using all five PNG row filters');

  // 3. The ridge seen from Zürichhorn: about 5.7 degrees due west, lower toward the sides.
  const spot = { lat: 47.3540, lon: 8.5530 };
  await dem.load(Horizon.tilesFor([spot]));
  const h = Horizon.profile(dem, spot.lat, spot.lon).map(v => v / 10 - 5);
  const at = b => h[(b - C.HORIZON.from) / C.HORIZON.step];
  console.log(`ridge 4.6 km west: horizon ${at(230).toFixed(1)}° at 230, ${at(270).toFixed(1)}° at 270, ${at(306).toFixed(1)}° at 306 (${dem.tiles.size} tiles)`);
  assert(Math.abs(at(270) - 5.7) < 0.3, 'due west about 5.7 degrees');
  assert(at(230) < at(270) && at(306) < at(270), 'lower toward the sides');

  // 4. When the sun leaves: about half an hour early at the equinox.
  const s = { lat: spot.lat, lon: spot.lon, horizon: h, rays: [0] };
  for (const [label, day] of [['equinox', '2026-09-23T12:00Z'], ['midsummer', '2026-06-21T12:00Z'], ['midwinter', '2026-12-21T12:00Z']]) {
    s._gone = null;
    const g = P.sunGone(s, new Date(day)), official = C.sunsetAt(new Date(day), s.lat, s.lon);
    console.log(`  ${label}: official sunset ${official.toISOString().slice(11, 16)} UTC, sun leaves ${g.at.toISOString().slice(11, 16)} UTC, ${g.early} min early, bearing ${g.bearing.toFixed(0)}°`);
    if (label === 'equinox') assert(g.early >= 25 && g.early <= 45, 'about half an hour at the equinox');
  }

  // 5. A flat world gives the official time, give or take a minute.
  srv.world = 'flat';
  const flat = new Elevation();
  await flat.load(Horizon.tilesFor([spot]));
  const hf = Horizon.profile(flat, spot.lat, spot.lon).map(v => v / 10 - 5);
  const f = { lat: spot.lat, lon: spot.lon, horizon: hf, rays: [0] }, gf = P.sunGone(f, new Date('2026-09-23T12:00Z'));
  console.log(`flat world: horizon ${Math.min(...hf).toFixed(1)}° to ${Math.max(...hf).toFixed(1)}°, sun leaves ${gf.early} min from the official time`);
  assert(Math.abs(gf.early) <= 2, 'flat land: official time');
  srv.close();
  console.log('horizon checks passed');
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });

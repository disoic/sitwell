// Elevation from the free Terrain Tiles on AWS: bare-earth heights as Terrarium PNG tiles
// (in Europe built from EU-DEM). No account needed. Tiles are fetched once per build and
// kept in memory; a failed tile just means no horizon for the spots that needed it.
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SOURCES = process.env.DEM_URL ? [process.env.DEM_URL] : [
  'https://elevation-tiles-prod-eu.s3.eu-central-1.amazonaws.com/terrarium/{z}/{x}/{y}.png',
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
];

// Slippy-map tile coordinates (Web Mercator) as fractions.
function tileXY(lat, lon, z) {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
}

// A small PNG reader for 8-bit RGB or RGBA without interlacing, which is what Terrarium tiles are.
function decodePNG(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace) throw new Error(`unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, prev = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= bpp ? out[dst + i - bpp] : 0, b = y ? out[prev + i] : 0, c = y && i >= bpp ? out[prev + i - bpp] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else throw new Error('bad PNG filter ' + f);
      out[dst + i] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}
// Terrarium encoding: height = (R * 256 + G + B / 256) - 32768 metres.
function terrarium(png) {
  const n = png.w * png.h, e = new Float32Array(n);
  for (let k = 0; k < n; k++) { const o = k * png.bpp; e[k] = png.px[o] * 256 + png.px[o + 1] + png.px[o + 2] / 256 - 32768; }
  return e;
}

class Elevation {
  constructor(opts = {}) { this.tiles = new Map(); this.dir = opts.cacheDir || null; this.fetched = 0; this.failed = 0; }
  async load(list, concurrency = 8) {
    const todo = list.filter(([z, x, y]) => !this.tiles.has(z + '/' + x + '/' + y));
    let next = 0;
    const worker = async () => {
      while (next < todo.length) { const [z, x, y] = todo[next++]; this.tiles.set(z + '/' + x + '/' + y, await this.fetchTile(z, x, y)); }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  }
  async fetchTile(z, x, y) {
    const file = this.dir ? path.join(this.dir, `${z}-${x}-${y}.png`) : null;
    try {
      let buf = file && fs.existsSync(file) ? fs.readFileSync(file) : null;
      if (!buf) {
        for (const src of SOURCES) {
          for (let attempt = 0; attempt < 2 && !buf; attempt++) {
            try {
              const r = await fetch(src.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal: AbortSignal.timeout(30000) });
              if (r.ok) buf = Buffer.from(await r.arrayBuffer());
              else if (r.status === 404) break;
            } catch (e) { /* retry, then the next source */ }
          }
          if (buf) break;
        }
        if (!buf) throw new Error('unavailable');
        this.fetched++;
        if (file) { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(file, buf); }
      }
      return terrarium(decodePNG(buf));
    } catch (e) { this.failed++; return null; }
  }
  // Height in metres (bilinear) from the tile at zoom z, or null where that tile is missing.
  at(lat, lon, z) {
    const [fx, fy] = tileXY(lat, lon, z), tx = Math.floor(fx), ty = Math.floor(fy);
    const t = this.tiles.get(z + '/' + tx + '/' + ty);
    if (!t) return null;
    const px = Math.min(Math.max((fx - tx) * 256 - 0.5, 0), 254.999), py = Math.min(Math.max((fy - ty) * 256 - 0.5, 0), 254.999);
    const x0 = Math.floor(px), y0 = Math.floor(py), dx = px - x0, dy = py - y0, k = y0 * 256 + x0;
    return (t[k] * (1 - dx) + t[k + 1] * dx) * (1 - dy) + (t[k + 256] * (1 - dx) + t[k + 257] * dx) * dy;
  }
}
module.exports = { Elevation, tileXY, decodePNG, terrarium, SOURCES };

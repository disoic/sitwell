// A stand-in for the elevation tile service, for tests: makes Terrarium PNG tiles of a made-up world.
//   node test/dem-server.js <port> <world>    worlds: flat (406 m, like Lake Zurich), ridge (an Uetliberg-like
//   ridge 4.6 km west of Zürichhorn), sea (0 m everywhere)
'use strict';
const http = require('http');
const zlib = require('zlib');

const TABLE = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
// PNG writer that cycles through all five row filters, so the reader's unfiltering is fully exercised.
function encodePNG(w, h, rgb) {
  const stride = w * 3, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const f = y % 5;
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i++) {
      const x = rgb[y * stride + i], a = i >= 3 ? rgb[y * stride + i - 3] : 0, b = y ? rgb[(y - 1) * stride + i] : 0, c = y && i >= 3 ? rgb[(y - 1) * stride + i - 3] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[y * (stride + 1) + 1 + i] = (x - p) & 255;
    }
  }
  const chunk = (name, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(name, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const WORLDS = {
  flat: () => 406,
  sea: () => 0,
  ridge: (lat, lon) => { const dx = (lon - 8.4919) * 111320 * Math.cos(lat * Math.PI / 180); return 406 + 463 * Math.exp(-((dx / 300) ** 2)); },
};
function tile(world, z, x, y) {
  const rgb = Buffer.alloc(256 * 256 * 3), n = 2 ** z, f = WORLDS[world];
  for (let py = 0; py < 256; py++) {
    const fy = y + (py + 0.5) / 256, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * fy / n))) * 180 / Math.PI;
    for (let px = 0; px < 256; px++) {
      const lon = (x + (px + 0.5) / 256) / n * 360 - 180, v = f(lat, lon) + 32768, o = (py * 256 + px) * 3;
      rgb[o] = Math.floor(v / 256); rgb[o + 1] = Math.floor(v) % 256; rgb[o + 2] = Math.floor((v - Math.floor(v)) * 256);
    }
  }
  return encodePNG(256, 256, rgb);
}
function start(port, world) {
  const server = http.createServer((req, res) => {
    const m = /\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(req.url);
    if (!m) { res.writeHead(404); res.end(); return; }
    server.served++;
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(tile(server.world, +m[1], +m[2], +m[3]));
  });
  server.world = world || 'flat';
  server.served = 0;
  return new Promise(ok => server.listen(port, '127.0.0.1', () => ok(server)));
}
module.exports = { start, encodePNG, WORLDS };
if (require.main === module) start(Number(process.argv[2] || 8765), process.argv[3] || 'flat').then(s => console.log('elevation stand-in on', s.address().port, s.world));

// Writes the static files the app reads, with a fingerprint per square so phones only fetch
// what changed, and compares with the previous build.
//
//   data/v1/coverage.json        which blocks exist, with a fingerprint of each block index
//   data/v1/b/<block>.json       per block of 8 x 8 squares: which squares are covered, and their fingerprints
//   data/v1/s/<square>.json      the finished spots of one square
//   data/v1/places.json          town and neighbourhood names for the place search
//   data/v1/report.json          what changed since the previous build
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('../../core/core.js');

const fingerprint = text => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);

// Sorts object keys so the same content always gives the same text.
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = stable(v[k]);
    return o;
  }
  return v;
}

function squareFile(id, spots, places) {
  return JSON.stringify({ v: C.FORMAT, square: id, places, spots: spots.map(stable) });
}

// 64 squares per block as a 16-character hex bit mask.
function coverMask(slots) {
  const bits = new Uint8Array(64);
  for (const s of slots) bits[s] = 1;
  let hex = '';
  for (let k = 0; k < 64; k += 4) hex += ((bits[k] << 3) | (bits[k + 1] << 2) | (bits[k + 2] << 1) | bits[k + 3]).toString(16);
  return hex;
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

// The previous build's square fingerprints, if there is one.
function previousIndex(prevDir) {
  const out = new Map();
  if (!prevDir) return out;
  const cov = readJSON(path.join(prevDir, 'v1', 'coverage.json'));
  if (!cov) return out;
  for (const b of Object.keys(cov.blocks || {})) {
    const idx = readJSON(path.join(prevDir, 'v1', 'b', b + '.json'));
    if (idx) for (const [sq, h] of Object.entries(idx.squares || {})) out.set(sq, h);
  }
  return out;
}

// Seats in a square file: id -> [lat, lon].
function seatsOf(file) {
  const out = new Map();
  if (!file) return out;
  for (const s of file.spots) {
    if (s.members) for (const m of s.members) out.set(m[0], [m[1], m[2]]);
    else out.set(s.id, [s.lat, s.lon]);
  }
  return out;
}

/* squares: Map id -> { spots: [packed], places: [...] }, owned: Set of covered square ids. */
function publish(outDir, squares, owned, opts = {}) {
  const base = path.join(outDir, 'v1');
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(path.join(base, 's'), { recursive: true });
  fs.mkdirSync(path.join(base, 'b'), { recursive: true });
  const prev = previousIndex(opts.prev);

  const hashes = new Map();
  let bytes = 0;
  for (const id of [...squares.keys()].sort()) {
    const sq = squares.get(id);
    if (!sq.spots.length) continue;
    const text = squareFile(id, sq.spots, sq.places);
    fs.writeFileSync(path.join(base, 's', id + '.json'), text);
    hashes.set(id, fingerprint(text));
    bytes += text.length;
  }

  // Block indexes.
  const blocks = new Map();
  for (const id of owned) {
    const b = C.blockOf(id);
    if (!blocks.has(b)) blocks.set(b, { slots: [], squares: {} });
    blocks.get(b).slots.push(C.slotInBlock(id));
  }
  for (const [id, h] of hashes) {
    const b = blocks.get(C.blockOf(id));
    if (b) b.squares[id] = h;
  }
  const blockHashes = {};
  for (const b of [...blocks.keys()].sort()) {
    const blk = blocks.get(b);
    const text = JSON.stringify(stable({ v: C.FORMAT, block: b, covered: coverMask(blk.slots), squares: blk.squares }));
    fs.writeFileSync(path.join(base, 'b', b + '.json'), text);
    blockHashes[b] = fingerprint(text);
  }
  const built = new Date().toISOString().slice(0, 16) + 'Z';
  // Town and neighbourhood names for the place search, sorted so unchanged data gives the same file.
  const places = (opts.places || []).slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  fs.writeFileSync(path.join(base, 'places.json'), JSON.stringify({ v: C.FORMAT, places }));
  fs.writeFileSync(path.join(base, 'coverage.json'), JSON.stringify({
    v: C.FORMAT, built, regions: opts.regions || [], grid: C.GRID, blocks: blockHashes,
  }));

  // What changed since last time, including seats that appeared, vanished or moved:
  // the list ratings will need when a mapper redraws a bench and its id changes.
  const report = { built, squares: { withSpots: hashes.size, covered: owned.size, changed: 0, added: 0, removed: 0, unchanged: 0 },
    seats: { added: 0, removed: 0, moved: 0, examples: [] }, bytes, regions: opts.stats || {} };
  if (prev.size) {
    // Only squares this build covers: a region left out of a run is not "removed".
    const all = new Set([...hashes.keys(), ...[...prev.keys()].filter(id => owned.has(id))]);
    for (const id of all) {
      const now = hashes.get(id), before = prev.get(id);
      if (now === before) { report.squares.unchanged++; continue; }
      if (!before) report.squares.added++; else if (!now) report.squares.removed++; else report.squares.changed++;
      const a = seatsOf(before ? readJSON(path.join(opts.prev, 'v1', 's', id + '.json')) : null);
      const b = seatsOf(now ? JSON.parse(fs.readFileSync(path.join(base, 's', id + '.json'), 'utf8')) : null);
      const note = (kind, seat, ll) => { if (report.seats.examples.length < 200) report.seats.examples.push({ kind, seat, at: ll }); };
      for (const [seat, ll] of b) {
        const old = a.get(seat);
        if (!old) { report.seats.added++; note('added', seat, ll); } else if (C.metres(old[0], old[1], ll[0], ll[1]) > 2) { report.seats.moved++; note('moved', seat, ll); }
      }
      for (const [seat, ll] of a) if (!b.has(seat)) { report.seats.removed++; note('removed', seat, ll); }
    }
  }
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 1));
  return report;
}

module.exports = { publish, fingerprint, coverMask, stable };

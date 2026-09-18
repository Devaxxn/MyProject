/* Generates icons/icon-192.png and icons/icon-512.png with zero deps.
   Run: node make-icons.js */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- PNG encoding (RGBA, 8-bit) ----
const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) crc = (crc >>> 8) ^ TABLE[(crc ^ buf[n]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function png(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- icon drawing ----
function drawIcon(S, maskable = false) {
  const px = Buffer.alloc(S * S * 4);
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const inTri = (P, A, B, C) => {
    const d1 = (B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]);
    const d2 = (C[0] - B[0]) * (P[1] - B[1]) - (C[1] - B[1]) * (P[0] - B[0]);
    const d3 = (A[0] - C[0]) * (P[1] - C[1]) - (A[1] - C[1]) * (P[0] - C[0]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
  const A = [0.5, 0.22], B = [0.24, 0.70], C = [0.76, 0.70];
  const A2 = [0.5, 0.40], B2 = [0.38, 0.62], C2 = [0.62, 0.62];
  // maskable: sample art coords compressed toward center so the ship sits
  // inside the safe zone (inner 80% circle) even when the OS crops a circle
  const scale = maskable ? 0.72 : 1;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const su = 0.5 + (u - 0.5) / scale;
      const sv = 0.5 + (v - 0.5) / scale;
      let r = 5, g = 6, b = 15;
      // faint grid (background decoration, full-bleed)
      const gs = S / 8;
      if (x % gs < 1 || y % gs < 1) { r = 13; g = 22; b = 40; }
      // border glow — only for the non-maskable "any" icon
      if (!maskable) {
        const e = Math.min(x, y, S - 1 - x, S - 1 - y);
        if (e < S * 0.015) { r = 77; g = 243; b = 255; }
        else if (e < S * 0.045) { r = 18; g = 58; b = 78; }
      }
      // ship hull (cyan gradient: bright nose -> cyan tail)
      if (inTri([su, sv], A, B, C)) {
        const t = clamp01((sv - A[1]) / (B[1] - A[1]));
        r = lerp(223, 77, t); g = lerp(252, 243, t); b = 255;
      }
      // cockpit window
      if (inTri([su, sv], A2, B2, C2)) { r = 7; g = 12; b = 26; }
      // magenta gem
      if (Math.abs(su - 0.5) + Math.abs(sv - 0.845) <= 0.055) { r = 255; g = 92; b = 225; }
      const i = (y * S + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  function clamp01(t) { return Math.max(0, Math.min(1, t)); }
  return px;
}

const dir = path.join(__dirname, 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const size of [192, 512]) {
  const buf = png(size, size, drawIcon(size, false));
  fs.writeFileSync(path.join(dir, `icon-${size}.png`), buf);
  console.log(`wrote icons/icon-${size}.png (${buf.length} bytes)`);
  const mbuf = png(size, size, drawIcon(size, true));
  fs.writeFileSync(path.join(dir, `icon-maskable-${size}.png`), mbuf);
  console.log(`wrote icons/icon-maskable-${size}.png (${mbuf.length} bytes)`);
}

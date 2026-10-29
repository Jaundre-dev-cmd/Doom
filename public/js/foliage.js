// Trees and bushes for the Forest Outpost (instanced, card-based foliage).
//
// createTreeKit() is the contract forest.js uses:
//   addPine(x, z, scale, rand)      a conifer at (x, z), scale ~1-2
//   addBroadleaf(x, z, scale, rand) a deciduous tree
//   addBush(x, z, scale, rand)      undergrowth (no collision)
//   build() -> THREE.Group          all instanced meshes
// forest.js decides placement and collision; this file decides looks.
//
// How it looks real without being heavy:
//  - Foliage is made of alpha-tested textured cards (spruce sprays, leaf
//    clusters, fern fronds) painted procedurally into one 1024² atlas, with
//    a separate alpha mask whose mip chain is coverage-preserving so distant
//    trees don't thin out / go transparent.
//  - Card normals point away from the crown/clump centre ("spherical
//    normals") so a crown shades as a soft volume; vertex colours add
//    ambient occlusion toward the trunk and crown interior.
//  - Trunks are tapered tubes with root flare and a bark texture + normal map.
//  - Every tree variant is one InstancedMesh (trunk) + one (foliage), so the
//    whole kit is ~18 draw calls. Leaves sway in a vertex shader; shadows use
//    an alpha-tested, wind-matched depth material so they are dappled.

import * as THREE from 'three';
import { hash2, makeRng } from './vegetationUtils.js';

const TAU = Math.PI * 2;
const FOLIAGE_DEBUG = false;
const ATLAS = 1024;

// --- Small vector helpers (plain arrays, build-time only) ---------------------
const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// --- Atlas layout -----------------------------------------------------------
// Canvas pixel rects; flipY maps canvas row 0 to v = 1.
function region(x, y, w, h) {
  const inset = 2;
  return {
    x, y, w, h,
    u0: (x + inset) / ATLAS,
    u1: (x + w - inset) / ATLAS,
    vTop: 1 - (y + inset) / ATLAS,
    vBot: 1 - (y + h - inset) / ATLAS,
  };
}
const R_SPRAY = region(0, 0, 512, 512); // flat spruce spray, stem along the middle
const R_CURTAIN = region(512, 0, 512, 512); // spruce branch with hanging twigs, stem near the top
const R_LEAVES = region(0, 512, 512, 512); // broadleaf cluster, twig base at bottom centre
const R_FERN = region(512, 512, 512, 256); // fern frond, rachis along the middle
const R_SPRIG = region(512, 768, 512, 256); // small-leaved shrub sprig, stem along the middle

// --- Procedural textures --------------------------------------------------------

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Paints on a transparent colour canvas; the alpha mask is extracted from
// its coverage afterwards (finish()), then each region gets an opaque
// background colour behind the strokes so mips don't bleed black.
function makePainter() {
  const colorCanvas = makeCanvas(ATLAS);
  const alphaCanvas = makeCanvas(ATLAS);
  const c = colorCanvas.getContext('2d', { willReadFrequently: true });
  c.lineCap = 'round';
  // `a` used to be a second canvas drawn in lockstep; keep the call sites
  // working with a no-op context.
  const a = new Proxy({}, { get: () => () => {}, set: () => true });
  const bgs = [];
  const line = (x1, y1, x2, y2, w, col) => {
    c.strokeStyle = col;
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
  };
  const clip = (R, fn) => {
    c.save();
    c.beginPath();
    c.rect(R.x + 3, R.y + 3, R.w - 6, R.h - 6);
    c.clip();
    fn();
    c.restore();
  };
  const bg = (R, col) => bgs.push([R, col]);
  const finish = () => {
    const src = c.getImageData(0, 0, ATLAS, ATLAS);
    const actx = alphaCanvas.getContext('2d', { willReadFrequently: true });
    const out = actx.createImageData(ATLAS, ATLAS);
    const sd = src.data;
    const od = out.data;
    for (let i = 0; i < sd.length; i += 4) {
      od[i] = od[i + 1] = od[i + 2] = sd[i + 3];
      od[i + 3] = 255;
    }
    actx.putImageData(out, 0, 0);
    c.globalCompositeOperation = 'destination-over';
    for (const [R, col] of bgs) {
      c.fillStyle = col;
      c.fillRect(R.x, R.y, R.w, R.h);
    }
    c.globalCompositeOperation = 'source-over';
  };
  return { colorCanvas, alphaCanvas, c, a, line, clip, bg, finish };
}

const hsl = (h, s, l) => `hsl(${h.toFixed(1)},${s.toFixed(1)}%,${l.toFixed(1)}%)`;

// A twig densely covered in needles. `shade(t)` gives lightness offset.
function needleTwig(P, rng, x0, y0, ang, length, depth, inner) {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  P.line(x0, y0, x0 + ca * length, y0 + sa * length, depth === 0 ? 2.4 : 1.5, '#3a2a1c');
  const step = 2.1;
  for (let d = 0; d < length; d += step) {
    const px = x0 + ca * d;
    const py = y0 + sa * d;
    const tip = d / length;
    const nl = (7 + rng() * 7) * (1 - 0.35 * tip);
    for (const side of [-1, 1]) {
      const na = ang + side * (0.75 + rng() * 0.55);
      const l = nl * (0.6 + rng() * 0.5);
      const fresh = tip > 0.86 && depth > 0 ? 1 : 0;
      const light = 12 + 11 * tip + 7 * (1 - inner) + rng() * 8 + fresh * 6;
      const hue = fresh ? 96 + rng() * 12 : 124 + rng() * 26;
      const sat = fresh ? 38 : 20 + rng() * 14;
      P.line(px, py, px + Math.cos(na) * l, py + Math.sin(na) * l, 1.7 + rng() * 0.6, hsl(hue, sat, light));
    }
    // Foreshortened needles pointing up out of the plane: short dots.
    if (rng() < 0.6) {
      const na = ang + (rng() - 0.5) * 1.2;
      const l = 2 + rng() * 4;
      P.line(px, py, px + Math.cos(na) * l, py + Math.sin(na) * l, 2.2, hsl(115 + rng() * 20, 30, 18 + 14 * tip + rng() * 8));
    }
    if (depth === 0 && d > 18 && d < length * 0.8 && rng() < 0.05) {
      const side = rng() < 0.5 ? -1 : 1;
      needleTwig(P, rng, px, py, ang + side * (0.5 + rng() * 0.4), (length - d) * (0.3 + rng() * 0.25), 1, inner);
    }
  }
}

function drawSpray(P, R, rng) {
  P.bg(R, '#18241a');
  P.clip(R, () => {
    const midY = R.y + R.h * 0.5;
    const L = R.w - 16;
    const stem = (s) => [R.x + 6 + s * L, midY + Math.sin(s * 5) * 5];
    const halfW = (s) => (R.h * 0.47) * (s < 0.3 ? 0.35 + 0.65 * (s / 0.3) : 1 - 0.8 * Math.pow((s - 0.3) / 0.7, 1.3));
    let side = 1;
    for (let s = 0.07; s < 0.96; s += 0.032 + rng() * 0.018) {
      side = -side;
      const [x, y] = stem(s);
      const ang = side * (0.6 + rng() * 0.35);
      const tl = (halfW(s) / Math.sin(Math.abs(ang))) * (0.7 + rng() * 0.35);
      needleTwig(P, rng, x, y, ang, Math.min(tl, (1 - s) * L * 0.9 + 20), 0, 1 - s);
    }
    const [x0, y0] = stem(0);
    const [x1, y1] = stem(1);
    needleTwig(P, rng, x0, y0, Math.atan2(y1 - y0, x1 - x0), L, 0, 0.5);
  });
}

function drawCurtain(P, R, rng) {
  P.bg(R, '#18241a');
  P.clip(R, () => {
    const topY = R.y + R.h * 0.28;
    const L = R.w - 16;
    const stem = (s) => [R.x + 6 + s * L, topY + s * s * 18];
    for (let s = 0.06; s < 0.95; s += 0.026 + rng() * 0.02) {
      const [x, y] = stem(s);
      const shape = s < 0.25 ? 0.5 + 2 * s : 1 - 0.75 * Math.pow((s - 0.25) / 0.75, 1.2);
      if (rng() < 0.62) {
        // hanging twig
        const ang = 1.05 + rng() * 0.45;
        const tl = (R.y + R.h - y - 10) * shape * (0.6 + rng() * 0.45);
        needleTwig(P, rng, x, y, ang, tl / Math.sin(ang), 0, 1 - s);
      } else {
        const ang = -(0.5 + rng() * 0.4);
        const tl = (topY - R.y - 8) * shape * (0.5 + rng() * 0.5);
        needleTwig(P, rng, x, y, ang, tl / Math.sin(-ang), 1, 1 - s);
      }
    }
    const [x0, y0] = stem(0);
    const [x1, y1] = stem(1);
    needleTwig(P, rng, x0, y0, Math.atan2(y1 - y0, x1 - x0), L, 0, 0.5);
  });
}

// One broad leaf with gradient, midrib and veins.
function drawLeaf(P, rng, x, y, ang, length, width, hue, light) {
  const { c, a } = P;
  const shape = (ctx) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(length * 0.25, -width * 0.68, length * 0.72, -width * 0.5, length, 0);
    ctx.bezierCurveTo(length * 0.72, width * 0.5, length * 0.25, width * 0.68, 0, 0);
  };
  for (const ctx of [c, a]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
  }
  shape(a);
  a.fill();
  const sat = 32 + rng() * 16;
  const g = c.createLinearGradient(0, -width * 0.5, 0, width * 0.5);
  const tilt = rng() < 0.5 ? 1 : -1;
  g.addColorStop(0, hsl(hue, sat, light + 6 * tilt));
  g.addColorStop(0.5, hsl(hue + 3, sat, light));
  g.addColorStop(1, hsl(hue, sat, light - 6 * tilt));
  shape(c);
  c.fillStyle = g;
  c.fill();
  // Darker rim, lighter midrib, faint veins.
  c.lineWidth = 1;
  c.strokeStyle = hsl(hue, sat, light - 9);
  c.stroke();
  c.strokeStyle = hsl(hue - 8, sat - 10, light + 13);
  c.lineWidth = Math.max(1, width * 0.05);
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(length * 0.93, 0);
  c.stroke();
  c.lineWidth = 0.8;
  c.strokeStyle = hsl(hue - 5, sat - 5, light + 7);
  for (let k = 1; k <= 6; k++) {
    const xk = length * (0.08 + 0.12 * k);
    const reach = width * 0.42 * Math.sin(Math.PI * Math.min(1, xk / length + 0.1));
    for (const s of [-1, 1]) {
      c.beginPath();
      c.moveTo(xk, 0);
      c.lineTo(xk + length * 0.14, s * reach);
      c.stroke();
    }
  }
  c.restore();
  a.restore();
}

function drawLeafCluster(P, R, rng) {
  P.bg(R, '#26381c');
  P.clip(R, () => {
    const bx = R.x + R.w * 0.5;
    const by = R.y + R.h - 6;
    const leaves = [];
    const twigs = 5;
    for (let i = 0; i < twigs; i++) {
      let ang = -Math.PI / 2 + (i / (twigs - 1) - 0.5) * 1.9 + (rng() - 0.5) * 0.25;
      let x = bx + (rng() - 0.5) * 30;
      let y = by;
      const total = 300 + rng() * 140;
      let d = 0;
      let side = 1;
      while (d < total) {
        const seg = 22 + rng() * 14;
        ang += (rng() - 0.5) * 0.25;
        const nx = x + Math.cos(ang) * seg;
        const ny = y + Math.sin(ang) * seg;
        P.line(x, y, nx, ny, Math.max(1.2, 4 * (1 - d / total)), '#4a3a28');
        x = nx;
        y = ny;
        d += seg;
        if (d > 50) {
          side = -side;
          const t = d / total;
          leaves.push({ x, y, ang: ang + side * (0.55 + rng() * 0.6), l: 52 + rng() * 26 - t * 8, t });
        }
      }
      // tuft at the twig end
      for (let k = 0; k < 3; k++) leaves.push({ x, y, ang: ang + (k - 1) * 0.6 + (rng() - 0.5) * 0.3, l: 44 + rng() * 18, t: 1 });
    }
    // Back (shaded) leaves first, then lighter sunlit ones on top.
    leaves.sort((p, q) => p.t - q.t + (rng() - 0.5) * 0.4);
    for (const lf of leaves) {
      const light = 17 + lf.t * 12 + rng() * 10;
      drawLeaf(P, rng, lf.x, lf.y, lf.ang, lf.l, lf.l * (0.5 + rng() * 0.12), 82 + rng() * 22, light);
    }
  });
}

function drawSprig(P, R, rng) {
  P.bg(R, '#25361b');
  P.clip(R, () => {
    const midY = R.y + R.h * 0.5;
    const leaves = [];
    const branch = (x, y, ang, total, depth) => {
      let d = 0;
      let side = 1;
      while (d < total) {
        const seg = 14 + rng() * 8;
        ang += (rng() - 0.5) * 0.2;
        const nx = x + Math.cos(ang) * seg;
        const ny = y + Math.sin(ang) * seg;
        P.line(x, y, nx, ny, depth ? 1.4 : 2.6, '#4b3a29');
        x = nx;
        y = ny;
        d += seg;
        side = -side;
        if (d > 20) leaves.push({ x, y, ang: ang + side * (0.6 + rng() * 0.6), l: 26 + rng() * 14, t: d / total });
        if (!depth && rng() < 0.22 && d < total * 0.75) branch(x, y, ang + side * (0.5 + rng() * 0.4), (total - d) * 0.45, 1);
      }
      leaves.push({ x, y, ang, l: 28, t: 1 });
    };
    branch(R.x + 6, midY, 0, R.w - 30, 0);
    leaves.sort((p, q) => p.t - q.t + (rng() - 0.5) * 0.5);
    for (const lf of leaves) drawLeaf(P, rng, lf.x, lf.y, lf.ang, lf.l, lf.l * 0.55, 88 + rng() * 20, 18 + lf.t * 10 + rng() * 10);
  });
}

function drawFern(P, R, rng) {
  P.bg(R, '#26401c');
  P.clip(R, () => {
    const midY = R.y + R.h * 0.5;
    const L = R.w - 14;
    const rach = (s) => [R.x + 6 + s * L, midY - Math.sin(s * Math.PI) * 6];
    for (let s = 0.04; s < 0.99; s += 0.022) {
      const [x, y] = rach(s);
      const pl = (R.h * 0.47) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + s * 0.95)), 0.7) * (s > 0.9 ? 0.6 : 1);
      for (const side of [-1, 1]) {
        const ang = side * (1.15 + rng() * 0.12);
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        P.line(x, y, x + ca * pl, y + sa * pl, 1.2, '#3c5a24');
        // pinnules along the pinna
        for (let d = 3; d < pl; d += 5) {
          const r = 5.2 * (1 - (d / pl) * 0.7);
          const px = x + ca * d;
          const py = y + sa * d;
          const light = 24 + rng() * 8 + (1 - s) * 4 - (d / pl) * 3;
          P.c.fillStyle = hsl(88 + rng() * 10, 48, light);
          for (const ctx of [P.c, P.a]) {
            ctx.beginPath();
            ctx.ellipse(px + ca * 1.5, py + sa * 1.5, r * 0.8, r * 1.15, ang + 0.4, 0, TAU);
            ctx.fill();
          }
        }
      }
    }
    const [x0, y0] = rach(0);
    const [x1, y1] = rach(1);
    P.line(x0, y0, x1, y1, 2.4, '#5b6e2c');
  });
}

// Coverage-preserving mip chain for the alpha mask: plain box-filtered mips
// make alpha-tested foliage thin out and vanish at distance. Each level's
// alpha is rescaled per atlas cell so the fraction of pixels passing the
// 0.5 test matches level 0.
function alphaMips(base) {
  const cells = [];
  for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 2; cx++) cells.push([cx / 2, cy / 4, 0.5, 0.25]);
  const coverage = (data, size) => {
    return cells.map(([fx, fy, fw, fh]) => {
      const hist = new Uint32Array(256);
      const x0 = Math.floor(fx * size);
      const y0 = Math.floor(fy * size);
      const w = Math.max(1, Math.floor(fw * size));
      const h = Math.max(1, Math.floor(fh * size));
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) hist[data[(y * size + x) * 4 + 1]]++;
      return { hist, n: w * h, x0, y0, w, h };
    });
  };
  const ctx0 = base.getContext('2d');
  const d0 = ctx0.getImageData(0, 0, ATLAS, ATLAS).data;
  const target = coverage(d0, ATLAS).map(({ hist, n }) => {
    let c = 0;
    for (let i = 128; i < 256; i++) c += hist[i];
    return c / n;
  });
  const levels = [base];
  let prev = base;
  for (let size = ATLAS / 2; size >= 1; size /= 2) {
    const raw = makeCanvas(size);
    const rctx = raw.getContext('2d');
    rctx.imageSmoothingEnabled = true;
    rctx.imageSmoothingQuality = 'high';
    rctx.drawImage(prev, 0, 0, size, size);
    prev = raw;
    const out = makeCanvas(size);
    const octx = out.getContext('2d');
    const img = rctx.getImageData(0, 0, size, size);
    const data = img.data;
    if (size >= 4) {
      const covs = coverage(data, size);
      covs.forEach(({ hist, n, x0, y0, w, h }, ci) => {
        // threshold T so that fraction(a >= T) ≈ target coverage
        const want = target[ci] * n;
        let acc = 0;
        let T = 255;
        while (T > 1 && acc + hist[T] < want) acc += hist[T--];
        const s = Math.min(4, Math.max(1, 128 / Math.max(T, 1)));
        for (let y = y0; y < y0 + h; y++) {
          for (let x = x0; x < x0 + w; x++) {
            const i = (y * size + x) * 4;
            const v = Math.min(255, data[i + 1] * s);
            data[i] = data[i + 1] = data[i + 2] = v;
          }
        }
      });
    }
    octx.putImageData(img, 0, 0);
    levels.push(out);
  }
  return levels;
}

function makeFoliageTextures() {
  const rng = makeRng(1234);
  const P = makePainter();
  drawSpray(P, R_SPRAY, rng);
  drawCurtain(P, R_CURTAIN, rng);
  drawLeafCluster(P, R_LEAVES, rng);
  drawFern(P, R_FERN, rng);
  drawSprig(P, R_SPRIG, rng);
  P.finish();

  const map = new THREE.CanvasTexture(P.colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const alpha = new THREE.CanvasTexture(P.alphaCanvas);
  alpha.colorSpace = THREE.NoColorSpace;
  alpha.mipmaps = alphaMips(P.alphaCanvas);
  alpha.generateMipmaps = false;
  alpha.minFilter = THREE.LinearMipmapLinearFilter;
  alpha.anisotropy = 4;
  return { map, alpha };
}

// Value noise with independent x/y periods (tileable, stretched features).
function noiseP(x, y, px, py, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % px) + px) % px;
  const y0 = ((iy % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbmP(x, y, px, py, seed, oct) {
  let s = 0;
  let amp = 0.5;
  let nrm = 0;
  for (let i = 0; i < oct; i++) {
    s += noiseP(x, y, px, py, seed + i * 31) * amp;
    nrm += amp;
    x *= 2;
    y *= 2;
    px *= 2;
    py *= 2;
    amp *= 0.5;
  }
  return s / nrm;
}

// Fissured bark: vertical plates split by dark cracks, flecks of lichen.
function makeBarkTextures() {
  const W = 256;
  const H = 512;
  const GX = 10;
  const GY = 3;
  const hgt = new Float32Array(W * H);
  const col = makeCanvas(W, H);
  const cctx = col.getContext('2d');
  const cimg = cctx.createImageData(W, H);
  for (let j = 0; j < H; j++) {
    const v = j / H;
    for (let i = 0; i < W; i++) {
      const u = i / W;
      // Elongated cellular plates (F2 - F1 of jittered grid points): the
      // gaps between neighbouring cells become the bark fissures.
      const wu = (fbmP(u * 4, v * 4, 4, 4, 11, 3) - 0.5) * 0.7;
      const wv = (fbmP(u * 4, v * 4, 4, 4, 12, 3) - 0.5) * 0.5;
      const x = u * GX + wu;
      const y = v * GY + wv;
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      let f1 = 9;
      let f2 = 9;
      let id = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gy = cy + oy;
          const hx = ((gx % GX) + GX) % GX;
          const hy = ((gy % GY) + GY) % GY;
          const px = gx + 0.15 + 0.7 * hash2(hx, hy, 71);
          const py = gy + 0.15 + 0.7 * hash2(hx, hy, 72);
          const d = Math.hypot(x - px, (y - py) * 0.8);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            id = hash2(hx, hy, 73);
          } else if (d < f2) f2 = d;
        }
      }
      const fine = fbmP(u * 48, v * 24, 48, 24, 5, 3);
      const streak = fbmP(u * 64, v * 4, 64, 4, 41, 2);
      const gap = f2 - f1 + (fine - 0.5) * 0.08;
      const plate = smooth(0.0, 0.13, gap);
      const h = plate * (0.65 + 0.2 * id + 0.1 * fine + 0.05 * streak);
      hgt[j * W + i] = h;
      const lichen = smooth(0.62, 0.74, fbmP(u * 4, v * 4, 4, 4, 33, 3)) * plate * smooth(0.45, 0.6, fine);
      const tone = (0.78 + 0.3 * id) * (0.85 + 0.3 * fine * streak + 0.25 * smooth(0.1, 0.5, gap));
      const flake = 0.88 + 0.24 * fbmP(u * 20, v * 40, 20, 40, 51, 2);
      let r = mix(46, 92 * tone * flake, plate);
      let g = mix(37, 80 * tone * flake, plate);
      let b = mix(31, 69 * tone * flake, plate);
      r = mix(r, 128, lichen * 0.55);
      g = mix(g, 140, lichen * 0.55);
      b = mix(b, 112, lichen * 0.55);
      const k = (j * W + i) * 4;
      cimg.data[k] = r;
      cimg.data[k + 1] = g;
      cimg.data[k + 2] = b;
      cimg.data[k + 3] = 255;
    }
  }
  cctx.putImageData(cimg, 0, 0);
  const nrm = makeCanvas(W, H);
  const nctx = nrm.getContext('2d');
  const nimg = nctx.createImageData(W, H);
  const at = (i, j) => hgt[((j + H) % H) * W + ((i + W) % W)];
  const strength = 3.5;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) * strength;
      const dy = (at(i, j + 1) - at(i, j - 1)) * strength;
      // canvas y grows downward, texture v grows upward
      const n = norm([-dx, dy, 1]);
      const k = (j * W + i) * 4;
      nimg.data[k] = (n[0] * 0.5 + 0.5) * 255;
      nimg.data[k + 1] = (n[1] * 0.5 + 0.5) * 255;
      nimg.data[k + 2] = (n[2] * 0.5 + 0.5) * 255;
      nimg.data[k + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  const normalMap = new THREE.CanvasTexture(nrm);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  return { map, normalMap };
}

// --- Geometry builder -----------------------------------------------------------

class Geo {
  constructor(withWind) {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.wind = withWind ? [] : null;
    this.idx = [];
  }
  get count() {
    return this.pos.length / 3;
  }
  vert(p, n, u, v, ao, w = 0) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.col.push(ao, ao, ao);
    if (this.wind) this.wind.push(w);
    return this.count - 1;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.wind) g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Card strip: rows of {fx, c: centre, s: half-width vector toward canvas top,
// sb: optional vector toward canvas bottom (defaults to -s)}. `shade(p, fx, fy)`
// returns [normal, ao, wind].
function strip(geo, R, rows, shade) {
  const base = geo.count;
  for (const row of rows) {
    const top = add(row.c, row.s);
    const bot = add(row.c, row.sb || mul(row.s, -1));
    const u = mix(R.u0, R.u1, row.fx);
    let [n, ao, w] = shade(top, row.fx, 0);
    geo.vert(top, n, u, R.vTop, ao, w);
    [n, ao, w] = shade(bot, row.fx, 1);
    geo.vert(bot, n, u, R.vBot, ao, w);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const a = base + i * 2;
    geo.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

// A flat quad: centre, half-vector along canvas +x, half-vector toward canvas top.
function card(geo, R, c, ax, ay, shade) {
  strip(geo, R, [
    { fx: 0, c: sub(c, ax), s: ay },
    { fx: 1, c: add(c, ax), s: ay },
  ], shade);
}

// Tapered tube along a polyline. radius(i, phi) per ring.
function tube(geo, pts, radius, segs, { uRep = 2, vPerM = 0.7, ao = () => 1 } = {}) {
  const base = geo.count;
  const n = pts.length;
  let N = null;
  let vAcc = 0;
  for (let i = 0; i < n; i++) {
    const T = norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]));
    if (!N) {
      const ref = Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      N = norm(cross(T, ref));
    } else {
      N = norm(sub(N, mul(T, dot(N, T))));
    }
    const B = cross(T, N);
    if (i > 0) vAcc += len(sub(pts[i], pts[i - 1]));
    for (let j = 0; j <= segs; j++) {
      const phi = (j / segs) * TAU;
      const off = add(mul(N, Math.cos(phi)), mul(B, Math.sin(phi)));
      const r = radius(i, phi);
      geo.vert(add(pts[i], mul(off, r)), off, (j / segs) * uRep, vAcc * vPerM, ao(i, pts[i]));
    }
  }
  const rs = segs + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = base + i * rs + j;
      const b = a + rs;
      geo.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}

function bezier(p0, p1, p2, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1], a * p0[2] + b * p1[2] + c * p2[2]]);
  }
  return out;
}

// --- Conifer (spruce) -----------------------------------------------------------

// lod 0: playable tree; lod 1: distant treeline tree (far fewer cards).
function buildPine(seed, lod, dens) {
  const rng = makeRng(seed * 7919 + 13);
  const trunk = new Geo(false);
  const leaves = new Geo(true);
  const H = 13.5 * (0.92 + rng() * 0.16);
  const baseR = 0.3;
  const leanX = (rng() - 0.5) * 0.5;
  const leanZ = (rng() - 0.5) * 0.5;
  const axis = (y) => [leanX * (y / H) ** 2, y, leanZ * (y / H) ** 2];
  const rAt = (y) => 0.025 + (baseR - 0.025) * Math.pow(Math.max(0, 1 - y / H), 1.05);
  // Treeline trees keep low branches so the map edge reads as a solid wall.
  const crownBase = lod ? 0.9 + rng() * 0.9 : 2.4 + rng() * 1.3;

  // Trunk with root flare.
  const ys = lod ? [-0.3, 0.4, 2, 5, 9, H * 0.85] : [-0.3, 0, 0.2, 0.5, 0.9, 1.5, 2.3, 3.3, 4.6, 6.2, 8, 10, 11.8, H - 0.6];
  const lobePh = rng() * TAU;
  tube(
    trunk,
    ys.map(axis),
    (i, phi) => {
      const y = Math.max(0, ys[i]);
      const fl = Math.exp(-y * 3.2);
      return rAt(y) * (1 + fl * (0.45 + 0.35 * Math.max(0, Math.cos(5 * phi + lobePh))));
    },
    lod ? 6 : 12,
    { uRep: 2, vPerM: 0.65, ao: (i, p) => (p[1] < 0.3 ? 0.6 : p[1] < crownBase ? 0.95 : 0.55) }
  );

  // Dead lower branch stubs.
  if (!lod) {
    const stubs = 7 + Math.floor(rng() * 6);
    for (let k = 0; k < stubs; k++) {
      const y = 1.1 + rng() * (crownBase - 1.0);
      const th = rng() * TAU;
      const l = 0.2 + rng() * 0.55 * (1 - y / H);
      const o = axis(y);
      const d = [Math.cos(th), -0.15 - rng() * 0.25, Math.sin(th)];
      const p0 = add(o, mul([d[0], 0, d[2]], rAt(y) * 0.6));
      const p1 = add(p0, mul(norm(d), l));
      tube(trunk, [p0, p1], (i) => (i ? 0.006 : 0.03), 4, { uRep: 0.5, vPerM: 1, ao: () => 0.7 });
    }
  }

  // Branch whorls.
  const crownH = H - crownBase;
  // Lower quality: fewer whorls, but each branch keeps both cards and gets
  // wider so the crown stays full instead of turning skeletal.
  const step = lod ? 0.7 : 0.42 / Math.min(1, Math.sqrt(dens));
  const perWhorl = lod ? 5 : dens >= 1.3 ? 6 : dens >= 1 ? 5 : 4;
  const curtains = !lod;
  const widen = lod ? 1 : 1 + 0.45 * Math.max(0, 1 - dens);
  const Lmax = 2.9 * (0.9 + rng() * 0.2);
  let phase = rng() * TAU;
  for (let y = crownBase; y < H - 0.5; y += step * (0.85 + rng() * 0.3)) {
    const t = (y - crownBase) / crownH; // 0 at crown base, 1 at top
    const L = Lmax * Math.pow(1 - t, 0.85) * (t < 0.1 ? 0.8 + 2 * t : 1) * (lod ? 1.15 : 1) + 0.3;
    phase += 2.4;
    const n = perWhorl - (t > 0.8 ? 1 : 0);
    for (let b = 0; b < n; b++) {
      const th = phase + (b / n) * TAU + (rng() - 0.5) * 0.6;
      const Lb = L * (0.75 + rng() * 0.35);
      const elev = mix(-0.22, 0.3, t) + (rng() - 0.5) * 0.2;
      const droop = mix(0.3, 0.06, t) * (0.7 + rng() * 0.6);
      const rad = [Math.cos(th), 0, Math.sin(th)];
      const dir = norm([Math.cos(th) * Math.cos(elev), Math.sin(elev), Math.sin(th) * Math.cos(elev)]);
      const perp = [-Math.sin(th), 0, Math.cos(th)];
      const upv = cross(perp, dir); // roughly +Y
      const o = axis(y);
      const p0 = add(o, mul(rad, rAt(y) * 0.5));
      const segs = lod ? 2 : 4;
      const centre = (s) => add(add(p0, mul(dir, Lb * s)), [0, Lb * (-droop * s * s + 0.07 * s * s * s), 0]);
      const branchAo = 0.85 + rng() * 0.2;
      const shade = (p, fx) => {
        const r = Math.hypot(p[0] - o[0], p[2] - o[2]);
        const outward = norm([rad[0] * 1.0, 0.55 + 0.4 * t, rad[2] * 1.0]);
        const nn = norm(add(outward, mul(norm([p[0] - o[0], 0, p[2] - o[2]]), 0.3)));
        const ao = (0.32 + 0.68 * Math.pow(clamp01(r / (Lmax + 0.3)), 0.7)) * (0.62 + 0.38 * t) * branchAo + 0.08;
        const w = Math.pow(fx, 1.5) * (0.06 + 0.06 * Lb) * (0.6 + 0.9 * t);
        return [nn, Math.min(1, ao), w];
      };
      // Main flat spray, slightly rolled.
      const roll = (rng() - 0.5) * 0.7;
      const side = add(mul(perp, Math.cos(roll)), mul(upv, Math.sin(roll)));
      const halfW = Lb * (lod ? 0.42 : 0.33 * widen);
      const rows = [];
      for (let s = 0; s <= segs; s++) rows.push({ fx: s / segs, c: centre(s / segs), s: mul(side, halfW) });
      strip(leaves, R_SPRAY, rows, shade);
      // Hanging "curtain" card in the vertical plane along the branch.
      if ((curtains && Lb > 0.7) || lod) {
        const roll2 = (rng() - 0.5) * 0.5;
        const vside = add(mul(upv, Math.cos(roll2)), mul(perp, Math.sin(roll2)));
        const ch = Lb * 0.62 * widen;
        const rows2 = [];
        for (let s = 0; s <= segs; s++) {
          const c = centre(s / segs);
          rows2.push({ fx: s / segs, c, s: mul(vside, ch * 0.28), sb: mul(vside, -ch * 0.72) });
        }
        strip(leaves, R_CURTAIN, rows2, shade);
      }
      // Woody branch stem (visible from beneath).
      if (!lod && Lb > 1.2 && t < 0.55) {
        const pts = [p0, centre(0.45)];
        tube(trunk, pts, (i) => [0.035, 0.008][i], 3, { uRep: 0.5, vPerM: 1, ao: () => 0.5 });
      }
    }
  }
  // Leader at the top: two crossed upright sprays.
  const top = axis(H - 1.4);
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI * 0.5 + rng();
    const side = [Math.cos(a), 0, Math.sin(a)];
    const rows = [];
    for (let s = 0; s <= 2; s++) rows.push({ fx: s / 2, c: add(top, [0, 1.9 * (s / 2), 0]), s: mul(side, 0.45 * (1 - s * 0.2)) });
    strip(leaves, R_SPRAY, rows, (p, fx) => [norm([p[0] - top[0], 1, p[2] - top[2]]), 0.95, 0.12 * fx]);
  }
  return { trunk: trunk.build(), leaves: leaves.build() };
}

// --- Broadleaf (oak/beech-like) -------------------------------------------------

function buildBroadleaf(seed, lod, dens) {
  const rng = makeRng(seed * 104729 + 7);
  const trunk = new Geo(false);
  const leaves = new Geo(true);
  const baseR = 0.36;
  const fork = 3.2 + rng() * 1.0;
  const lobePh = rng() * TAU;
  const tilt = [(rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3];
  const tp = (y) => [tilt[0] * y / fork, y, tilt[2] * y / fork];
  const ys = lod ? [-0.3, 0.5, fork * 0.6, fork + 0.6] : [-0.3, 0, 0.2, 0.5, 1, 1.8, fork * 0.7, fork, fork + 0.7];
  tube(
    trunk,
    ys.map(tp),
    (i, phi) => {
      const y = Math.max(0, ys[i]);
      const r = mix(baseR, baseR * 0.62, clamp01(y / (fork + 0.7)));
      const fl = Math.exp(-y * 2.6);
      return r * (1 + fl * (0.5 + 0.4 * Math.max(0, Math.cos(4 * phi + lobePh))));
    },
    lod ? 6 : 12,
    { uRep: 2, vPerM: 0.6, ao: (i, p) => (p[1] < 0.3 ? 0.6 : 0.95) }
  );

  // Crown clumps around and above the fork.
  const clumps = [];
  const k = 4 + Math.floor(rng() * 2);
  const a0 = rng() * TAU;
  for (let i = 0; i < k; i++) {
    const a = a0 + (i / k) * TAU + (rng() - 0.5) * 0.7;
    const d = 1.5 + rng() * 1.5;
    clumps.push({ c: [Math.cos(a) * d, fork + 2.3 + rng() * 3.2, Math.sin(a) * d], r: 1.9 + rng() * 0.9 });
  }
  clumps.push({ c: [(rng() - 0.5) * 0.8, fork + 5.8 + rng() * 1.2, (rng() - 0.5) * 0.8], r: 2.1 + rng() * 0.6 });
  let cy = 0;
  for (const cl of clumps) cy += cl.c[1];
  const crownC = [0, cy / clumps.length, 0];
  const crownTop = Math.max(...clumps.map((cl) => cl.c[1] + cl.r));
  const crownBot = fork + 0.8;

  // Limbs from the fork to each clump, with a few twigs into the clump.
  for (const cl of clumps) {
    const start = add(tp(fork - 0.2 + rng() * 0.6), [0, 0, 0]);
    const end = add(cl.c, [0, -cl.r * 0.2, 0]);
    const mid = add(mix3(start, end, 0.45), [0, 0.6, 0]);
    tube(trunk, bezier(start, mid, end, lod ? 2 : 5), (i) => mix(0.17, 0.05, i / (lod ? 2 : 5)), lod ? 4 : 6, { uRep: 1, vPerM: 0.8, ao: () => 0.7 });
    if (!lod) {
      for (let t = 0; t < 3; t++) {
        const dir = norm([rng() - 0.5, rng() * 0.8, rng() - 0.5]);
        const tip = add(end, mul(dir, cl.r * 0.85));
        tube(trunk, [end, mix3(end, tip, 0.5), tip], (i) => [0.045, 0.025, 0.008][i], 4, { uRep: 0.5, vPerM: 1, ao: () => 0.6 });
      }
    }
  }

  // Leaf cards.
  for (const cl of clumps) {
    const n = Math.round(cl.r * cl.r * (lod ? 4 : 19 * Math.pow(dens, 0.8)));
    for (let i = 0; i < n; i++) {
      let d = norm([rng() * 2 - 1, rng() * 1.6 - 0.6, rng() * 2 - 1]);
      const rr = cl.r * (0.5 + 0.5 * Math.sqrt(rng()));
      const p = add(cl.c, [d[0] * rr, d[1] * rr * 0.8, d[2] * rr]);
      const out = norm(add(sub(p, cl.c), [0, cl.r * 0.3, 0]));
      const nrm = norm(add(out, [rng() * 1.8 - 0.9, rng() * 1.8 - 0.9, rng() * 1.8 - 0.9]));
      let up = sub(out, mul(nrm, dot(out, nrm)));
      if (len(up) < 0.05) up = cross(nrm, [1, 0, 0]);
      up = norm(up);
      const sideV = cross(nrm, up);
      const sz = (lod ? 2.0 : 1.35) * (0.85 + rng() * 0.35);
      const useSprig = !lod && rng() < 0.2;
      const R = useSprig ? R_SPRIG : R_LEAVES;
      const c = add(p, mul(up, sz * 0.25));
      const ax = useSprig ? mul(up, sz * 0.6) : mul(sideV, sz * 0.5);
      const ay = useSprig ? mul(sideV, sz * 0.3) : mul(up, sz * 0.5);
      card(leaves, R, c, ax, ay, (q) => {
        const nn = norm(add(mul(norm(sub(q, cl.c)), 0.6), add(mul(norm(sub(q, crownC)), 0.6), [0, 0.3, 0])));
        const inner = clamp01(len(sub(q, cl.c)) / (cl.r * 1.1));
        const hf = clamp01((q[1] - crownBot) / (crownTop - crownBot));
        const radial = clamp01(Math.hypot(q[0], q[2]) / 4.5);
        const ao = (0.3 + 0.7 * Math.pow(inner, 1.1)) * (0.6 + 0.25 * hf + 0.15 * radial) + 0.08;
        const w = (0.05 + 0.08 * hf + 0.06 * radial) * (0.4 + 0.6 * inner);
        return [nn, Math.min(1, ao), w];
      });
    }
  }
  return { trunk: trunk.build(), leaves: leaves.build() };
}

function mix3(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

// --- Undergrowth -----------------------------------------------------------------

function buildShrub(seed, dens, low) {
  const rng = makeRng(seed * 31337 + 5);
  const g = new Geo(true);
  const centre = [0, low ? 0.15 : 0.3, 0];
  const clumps = [];
  const k = low ? 5 : 4;
  for (let i = 0; i < k; i++) {
    const a = (i / k) * TAU + rng();
    const d = low ? 0.35 + rng() * 0.35 : 0.2 + rng() * 0.3;
    clumps.push({ c: [Math.cos(a) * d, (low ? 0.32 : 0.6) + rng() * (low ? 0.15 : 0.4), Math.sin(a) * d], r: low ? 0.45 : 0.5 + rng() * 0.15 });
  }
  if (!low) clumps.push({ c: [0, 1.0, 0], r: 0.42 });
  for (const cl of clumps) {
    const n = Math.round((low ? 16 : 18) * Math.max(0.5, dens));
    for (let i = 0; i < n; i++) {
      const d = norm([rng() * 2 - 1, rng() * 1.4 - 0.4, rng() * 2 - 1]);
      const rr = cl.r * (0.4 + 0.6 * Math.sqrt(rng()));
      const p = add(cl.c, mul(d, rr));
      const out = norm(add(sub(p, [0, 0, 0]), [0, 0.3, 0]));
      const nrm = norm(add(out, [rng() * 1.6 - 0.8, rng() * 1.6 - 0.8, rng() * 1.6 - 0.8]));
      let up = sub(out, mul(nrm, dot(out, nrm)));
      if (len(up) < 0.05) up = cross(nrm, [1, 0, 0]);
      up = norm(up);
      const sideV = cross(nrm, up);
      const sz = (low ? 0.7 : 0.8) * (0.8 + rng() * 0.4);
      const useSprig = rng() < 0.45;
      const R = useSprig ? R_SPRIG : R_LEAVES;
      const c = add(p, mul(up, sz * 0.2));
      const ax = useSprig ? mul(up, sz * 0.6) : mul(sideV, sz * 0.5);
      const ay = useSprig ? mul(sideV, sz * 0.3) : mul(up, sz * 0.5);
      card(g, R, c, ax, ay, (q) => {
        const nn = norm(add(sub(q, centre), [0, 0.25, 0]));
        const ao = 0.3 + 0.7 * clamp01(q[1] / (low ? 0.7 : 1.1)) * (0.6 + 0.4 * clamp01(len(sub(q, cl.c)) / cl.r));
        return [nn, Math.min(1, ao + 0.05), 0.04 * clamp01(q[1])];
      });
    }
  }
  return g.build();
}

function buildFern(seed, dens) {
  const rng = makeRng(seed * 7 + 99);
  const g = new Geo(true);
  const n = Math.round(11 + 5 * Math.min(1, dens));
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU + (rng() - 0.5) * 0.5;
    const L = 0.75 + rng() * 0.45;
    const e0 = 0.85 + rng() * 0.45;
    const h = [Math.cos(th), 0, Math.sin(th)];
    const perp = [-Math.sin(th), 0, Math.cos(th)];
    const segs = 5;
    let p = mul(h, 0.04);
    const rows = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const ang = e0 - 1.9 * t;
      const dir = add(mul(h, Math.cos(ang)), [0, Math.sin(ang), 0]);
      const roll = 0.25 * (rng() - 0.5);
      const up = cross(perp, dir);
      const side = add(mul(perp, Math.cos(roll)), mul(up, Math.sin(roll)));
      rows.push({ fx: t, c: p, s: mul(side, L * 0.25) });
      p = add(p, mul(dir, L / segs));
    }
    strip(g, R_FERN, rows, (q, fx) => [norm([q[0], 0.8, q[2]]), 0.45 + 0.55 * clamp01(fx * 1.3), 0.06 * fx * fx]);
  }
  return g.build();
}

// --- Materials --------------------------------------------------------------------

const WIND_GLSL = /* glsl */ `
  {
    float ph = 0.0;
    #ifdef USE_INSTANCING
      ph = instanceMatrix[3].x * 0.23 + instanceMatrix[3].z * 0.19;
    #endif
    float t = uWindTime;
    float gust = 0.65 + 0.35 * sin(t * 0.37 + ph * 0.31);
    float s1 = sin(t * 1.45 + ph + position.y * 0.12);
    float s2 = sin(t * 3.3 + ph * 1.7 + position.x * 1.1 + position.z * 0.9);
    float s3 = sin(t * 5.1 + position.x * 2.3 - position.z * 1.9 + ph);
    transformed.x += aWind * gust * (0.9 * s1 + 0.35 * s2);
    transformed.z += aWind * gust * (0.55 * cos(t * 1.2 + ph * 1.3) + 0.35 * s3);
    transformed.y += aWind * 0.3 * s2 * s3;
  }
`;

function patchWind(material, windUniform, depth) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWind;\nuniform float uWindTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_GLSL);
    if (!depth) {
      // Keep the outward "spherical" normals on both faces of a card instead of
      // flipping them for back faces, so the crown shades as one volume.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        // Leaves are waxy but not glossy: tame the grazing-angle sky sheen.
        // Clip cards right in front of the camera (walking through a bush)
        // instead of filling the screen with one magnified leaf.
        .replace(
          '#include <alphatest_fragment>',
          `#include <alphatest_fragment>
          if (length(vViewPosition) < 0.7) discard;`
        )
        .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n  material.specularColor *= 0.35;\n  material.specularF90 = 0.35;');
    }
  };
  material.customProgramCacheKey = () => (depth ? 'foliage-wind-depth' : 'foliage-wind');
}

// --- Instancing ------------------------------------------------------------------

class Batch {
  constructor(geometry, material, { cast = true, receive = true, noRaycast = false, depthMaterial = null, name = '' } = {}) {
    Object.assign(this, { geometry, material, cast, receive, noRaycast, depthMaterial, name });
    this.mats = [];
    this.cols = [];
  }
  add(m, c) {
    this.mats.push(...m.elements);
    this.cols.push(c.r, c.g, c.b);
  }
  build() {
    const n = this.cols.length / 3;
    if (!n) return null;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, n);
    mesh.instanceMatrix.array.set(this.mats);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cols), 3);
    mesh.castShadow = this.cast;
    mesh.receiveShadow = this.receive;
    if (this.depthMaterial) mesh.customDepthMaterial = this.depthMaterial;
    if (this.noRaycast) mesh.userData.noRaycast = true;
    mesh.name = this.name;
    mesh.computeBoundingSphere();
    return mesh;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
function compose(x, y, z, rotY, s, sy, tiltX = 0, tiltZ = 0) {
  _q.setFromEuler(_e.set(tiltX, rotY, tiltZ));
  return _m.compose(_p.set(x, y, z), _q, _s.set(s, sy, s));
}

// --- Kit ---------------------------------------------------------------------------

export function createTreeKit({ quality = {}, windUniform } = {}) {
  const t0 = performance.now();
  const wind = windUniform || { value: 0 };
  const dens = Math.min(1.4, Math.max(0.35, quality.grass ?? 1));
  const shadows = !!quality.shadows;

  const tex = makeFoliageTextures();
  const t1 = performance.now();
  const bark = makeBarkTextures();
  const t2 = performance.now();
  bark.map.repeat.set(1, 1);
  const barkMat = new THREE.MeshStandardMaterial({
    map: bark.map,
    normalMap: bark.normalMap,
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughness: 0.95,
    metalness: 0,
    vertexColors: true,
  });
  const leafMat = new THREE.MeshStandardMaterial({
    map: tex.map,
    alphaMap: tex.alpha,
    alphaTest: 0.5,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 0.82,
    metalness: 0,
  });
  patchWind(leafMat, wind, false);
  const leafDepth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    alphaMap: tex.alpha,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  patchWind(leafDepth, wind, true);

  const trunkBatch = (geo, name, far) => new Batch(geo, barkMat, { cast: shadows, receive: !far, name });
  const leafBatch = (geo, name, cast, far) =>
    new Batch(geo, leafMat, { cast: shadows && cast, receive: !far, noRaycast: true, depthMaterial: leafDepth, name });

  const pineNear = [1, 2, 3].map((s) => buildPine(s, 0, dens));
  const pineFar = [4, 5].map((s) => buildPine(s, 1, dens));
  const broadNear = [1, 2].map((s) => buildBroadleaf(s, 0, dens));
  const broadFar = [3].map((s) => buildBroadleaf(s, 1, dens));

  const mk = (list, label, far) =>
    list.map((t, i) => ({
      trunk: trunkBatch(t.trunk, `${label}-trunk-${i}`, far),
      leaves: leafBatch(t.leaves, `${label}-leaves-${i}`, true, far),
    }));
  const pinesN = mk(pineNear, 'pine', false);
  const pinesF = mk(pineFar, 'pine-far', true);
  const broadsN = mk(broadNear, 'broadleaf', false);
  const broadsF = mk(broadFar, 'broadleaf-far', true);
  // Level of detail: every playable tree also gets a light copy (same
  // transform, far-variant geometry). The renderer shows full detail near
  // the player and the light copy further out — see vegetationLod.js.
  const pinesL = mk(pineFar, 'pine-lod', true);
  const broadsL = mk(broadFar, 'broadleaf-lod', true);

  const bushCast = shadows && dens >= 1;
  const shrubs = [
    leafBatch(buildShrub(1, dens, false), 'shrub', bushCast, false),
    leafBatch(buildShrub(2, dens, true), 'shrub-low', bushCast, false),
    leafBatch(buildFern(1, dens), 'fern', bushCast, false),
  ];

  const leafCol = new THREE.Color();
  const barkCol = new THREE.Color();
  const isFar = (x, z) => Math.max(Math.abs(x), Math.abs(z)) > 122;

  // Each add* draws a fixed number of values from `rand`, independent of
  // quality, so the forest layout (and collision) is identical on every client.
  return {
    addPine(x, z, scale, rand) {
      const r = [rand(), rand(), rand(), rand(), rand(), rand(), rand()];
      const far = isFar(x, z);
      const set = far ? pinesF : pinesN;
      const v = set[Math.floor(r[0] * set.length) % set.length];
      const sy = scale * (0.9 + r[1] * 0.2);
      const m = compose(x, 0, z, r[2] * TAU, scale, sy, (r[3] - 0.5) * 0.04, (r[4] - 0.5) * 0.04);
      const b = 0.82 + r[5] * 0.32;
      const warm = r[6] - 0.5;
      leafCol.setRGB(b * (1 + warm * 0.12), b * (1 + warm * 0.04), b * (1 - warm * 0.2));
      barkCol.setRGB(1.0, 0.84, 0.74).multiplyScalar(0.75 + r[5] * 0.3);
      v.trunk.add(m, barkCol);
      v.leaves.add(m, leafCol);
      if (!far) {
        const l = pinesL[Math.floor(r[0] * pinesL.length) % pinesL.length];
        l.trunk.add(m, barkCol);
        l.leaves.add(m, leafCol);
      }
    },
    addBroadleaf(x, z, scale, rand) {
      const r = [rand(), rand(), rand(), rand(), rand(), rand(), rand()];
      const far = isFar(x, z);
      const set = far ? broadsF : broadsN;
      const v = set[Math.floor(r[0] * set.length) % set.length];
      const sy = scale * (0.88 + r[1] * 0.24);
      const m = compose(x, 0, z, r[2] * TAU, scale, sy, (r[3] - 0.5) * 0.05, (r[4] - 0.5) * 0.05);
      const b = 0.85 + r[5] * 0.3;
      const warm = r[6] - 0.5;
      leafCol.setRGB(b * (1 + warm * 0.22), b * (1 + warm * 0.08), b * (1 - warm * 0.3));
      barkCol.setRGB(0.86, 0.85, 0.82).multiplyScalar(0.8 + r[6] * 0.3);
      v.trunk.add(m, barkCol);
      v.leaves.add(m, leafCol);
      if (!far) {
        const l = broadsL[Math.floor(r[0] * broadsL.length) % broadsL.length];
        l.trunk.add(m, barkCol);
        l.leaves.add(m, leafCol);
      }
    },
    addBush(x, z, s, rand) {
      const r = [rand(), rand(), rand(), rand(), rand()];
      const kind = r[0] < 0.35 ? 2 : r[0] < 0.7 ? 0 : 1;
      const sxz = s * (0.9 + r[1] * 0.4);
      const m = compose(x, 0, z, r[2] * TAU, sxz, s * (0.85 + r[3] * 0.3));
      const b = 0.8 + r[4] * 0.35;
      const warm = r[3] - 0.5;
      leafCol.setRGB(b * (1 + warm * 0.2), b, b * (1 - warm * 0.25));
      shrubs[kind].add(m, leafCol);
    },
    build() {
      const group = new THREE.Group();
      group.name = 'trees';
      const all = [...pinesN, ...pinesF, ...broadsN, ...broadsF, ...pinesL, ...broadsL].flatMap((v) => [v.trunk, v.leaves]).concat(shrubs);
      let tris = 0;
      for (const b of all) {
        const mesh = b.build();
        if (!mesh) continue;
        group.add(mesh);
        tris += (mesh.geometry.index.count / 3) * mesh.count;
        if (FOLIAGE_DEBUG) console.info(`[foliage] ${mesh.name}: ${mesh.count} x ${mesh.geometry.index.count / 3}`);
      }
      console.info(`[foliage] ${group.children.length} instanced meshes, ${(tris / 1000).toFixed(0)}k tris, built in ${(performance.now() - t0).toFixed(0)}ms (atlas ${(t1 - t0).toFixed(0)}, bark ${(t2 - t1).toFixed(0)})`);
      return group;
    },
  };
}

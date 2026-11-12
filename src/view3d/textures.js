/**
 * Procedural finish materials for the 3D house.
 *
 * Every texture is drawn on a 2D canvas (≤ 1024²) in real-world centimetres and tiles seamlessly; the
 * texture repeat is set so that ONE UV UNIT = ONE METRE. Floors use uv = (X, Z) in world metres, walls use
 * uv = (distance along the wall, height) in metres, so a 60 × 60 tile really measures 60 × 60 cm on screen.
 *
 *   floorMaterial(params)   params of a 'floor-finish' product (see models/types.js)
 *   wallMaterial(params)    params of a 'wall-finish' product
 *   surfaceMaterial(kind)   site / envelope surfaces: 'earth' | 'asphalt' | 'render' | 'roof' | 'pavers' | 'sidewalk'
 *
 * Materials are cached by their parameters and shared; call disposeMaterials() to free all of them.
 */
import * as THREE from 'three';

const MAX_PX = 1024;
const _cache = new Map();

// ───────────────────────── small colour / random helpers ─────────────────────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);

/** Deterministic PRNG (mulberry32) so a finish looks identical every time it is rebuilt. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
const hash2 = (a, b) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function rgb(hex, fallback = '#cccccc') {
  let s = typeof hex === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex.slice(1) : fallback.slice(1);
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, amt) => (amt >= 0 ? mix(c, [255, 255, 255], amt) : mix(c, [0, 0, 0], -amt));
const css = (c, a = 1) => `rgba(${Math.round(clamp(c[0], 0, 255))},${Math.round(clamp(c[1], 0, 255))},${Math.round(clamp(c[2], 0, 255))},${a})`;
const hex = (c) => '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

/** One tile / plank tone: between the two product tones with a little lightness jitter. */
function tone(c1, c2, r, spread = 0.55, jitter = 0.035) {
  return shade(mix(c1, c2, r() * spread), (r() - 0.5) * 2 * jitter);
}

// ───────────────────────── canvas plumbing ─────────────────────────
const pow2 = (v) => clamp(2 ** Math.round(Math.log2(v)), 64, MAX_PX);

/** Canvas covering wCm × hCm of real surface; the returned context draws in centimetres. */
function surface(wCm, hCm, pxPerCm = 5) {
  const s = Math.min(MAX_PX / wCm, MAX_PX / hCm, pxPerCm);
  const c = document.createElement('canvas');
  c.width = pow2(wCm * s); c.height = pow2(hCm * s);
  const g = c.getContext('2d');
  g.scale(c.width / wCm, c.height / hCm);
  return { c, g, w: wCm, h: hCm, px: wCm / c.width };
}

/** Run `draw(dx, dy)` for the 9 wrapped copies so that shapes crossing an edge tile seamlessly. */
function wrapped(S, draw) {
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { S.g.save(); S.g.translate(i * S.w, j * S.h); draw(); S.g.restore(); }
}

/** Fine grain so that no surface is a perfectly flat CG colour. */
function speckle(S, r, count, alpha, size = 1.2) {
  const { g } = S;
  for (let i = 0; i < count; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${alpha * r()})` : `rgba(255,255,255,${alpha * r()})`;
    const s = S.px * (0.6 + r() * size);
    g.fillRect(r() * S.w, r() * S.h, s, s);
  }
}

/** Soft cloudy blotches (concrete, plaster, earth). */
function clouds(S, r, count, minR, maxR, alpha) {
  const { g } = S;
  for (let i = 0; i < count; i++) {
    const x = r() * S.w, y = r() * S.h, rad = minR + r() * (maxR - minR), dark = r() < 0.5, a = alpha * (0.4 + 0.6 * r());
    wrapped(S, () => {
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    });
  }
}

/** A wooden board lying along +x in the current transform: fill + grain + soft edge. */
function board(g, r, len, wid, color, px) {
  g.fillStyle = css(color); g.fillRect(0, 0, len, wid);
  const n = Math.max(3, Math.round(wid / 1.4));
  for (let i = 0; i < n; i++) {
    const y = r() * wid;
    g.strokeStyle = r() < 0.7 ? `rgba(0,0,0,${0.03 + r() * 0.07})` : `rgba(255,255,255,${0.03 + r() * 0.06})`;
    g.lineWidth = px * (0.6 + r() * 1.2);
    g.beginPath(); g.moveTo(0, y);
    const wob = (r() - 0.5) * wid * 0.12;
    g.bezierCurveTo(len * 0.33, y + wob, len * 0.66, y - wob, len, y + (r() - 0.5) * wid * 0.08);
    g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = px * 1.1; g.strokeRect(0, 0, len, wid);
}

// ───────────────────────── pattern painters (all return a `surface`) ─────────────────────────
function paintTiles(p, r, o = {}) {
  const tw = num(p.tileW, 60), th = num(p.tileH, tw);
  const cols = clamp(Math.round((o.span || 240) / tw), 2, 16), rows = clamp(Math.round((o.span || 240) / th), 2, 16);
  const S = surface(tw * cols + (o.evenCols && cols % 2 ? tw : 0), th * rows + (o.evenRows && rows % 2 ? th : 0), o.pxPerCm || 5), { g } = S;
  const nc = Math.round(S.w / tw), nr = Math.round(S.h / th);
  const c1 = rgb(p.color, '#d9d4ca'), c2 = rgb(p.color2, hex(shade(c1, -0.12)));
  const grout = o.grout || c2, gw = Math.max(S.px * 1.4, o.groutW || clamp(tw * 0.006, 0.22, 0.4));
  g.fillStyle = css(grout); g.fillRect(0, 0, S.w, S.h);
  for (let j = 0; j < nr; j++) {
    const off = o.bond ? ((j % 2) * tw) / 2 : 0;
    for (let i = -1; i <= nc; i++) {
      const x = i * tw + off, y = j * th, k = ((i % nc) + nc) % nc;
      const rr = prng(hashStr(`${k}:${j}:${o.seed || 0}`));
      let col = o.checker ? ((k + j) % 2 ? c2 : c1) : shade(c1, (rr() - 0.5) * 2 * (o.vary ?? 0.03));
      if (o.checker) col = shade(col, (rr() - 0.5) * 0.03);
      g.fillStyle = css(col); g.fillRect(x + gw / 2, y + gw / 2, tw - gw, th - gw);
      if (o.mottle) { // faint cloud inside each tile (porcelain / stone look)
        for (let m = 0; m < 3; m++) {
          const mx = x + rr() * tw, my = y + rr() * th, rad = Math.min(tw, th) * (0.3 + rr() * 0.5);
          const gr = g.createRadialGradient(mx, my, 0, mx, my, rad);
          gr.addColorStop(0, rr() < 0.5 ? `rgba(255,255,255,${o.mottle})` : `rgba(0,0,0,${o.mottle * 0.8})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.save(); g.beginPath(); g.rect(x + gw / 2, y + gw / 2, tw - gw, th - gw); g.clip(); g.fillStyle = gr; g.fillRect(x, y, tw, th); g.restore();
        }
      }
    }
  }
  S.tw = tw; S.th = th; S.gw = gw; S.grout = grout;
  return S;
}

function regrout(S, bond) {
  const { g } = S;
  g.fillStyle = css(S.grout);
  for (let y = 0; y <= S.h + 0.01; y += S.th) g.fillRect(0, y - S.gw / 2, S.w, S.gw);
  if (!bond) for (let x = 0; x <= S.w + 0.01; x += S.tw) g.fillRect(x - S.gw / 2, 0, S.gw, S.h);
}

function paintMarble(p, r) {
  const c1 = rgb(p.color, '#ece9e4');
  const S = paintTiles({ ...p, tileW: num(p.tileW, 80), tileH: num(p.tileH, 80) }, r, { vary: 0.015, mottle: 0.05, span: 240 });
  const { g } = S, vein = mix(shade(c1, -0.42), [120, 120, 128], 0.5);
  for (let i = 0; i < 22; i++) {
    let x = r() * S.w, y = r() * S.h; const ang = r() * Math.PI, len = 60 + r() * 160, a = 0.05 + r() * 0.16, lw = S.px * (0.8 + r() * 2.6);
    const pts = [[x, y]]; let d = ang;
    for (let s = 0; s < len; s += 9) { d += (r() - 0.5) * 0.7; x += Math.cos(d) * 9; y += Math.sin(d) * 9; pts.push([x, y]); }
    wrapped(S, () => {
      g.strokeStyle = css(vein, a); g.lineWidth = lw; g.lineJoin = 'round';
      g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke();
      g.strokeStyle = css(vein, a * 0.35); g.lineWidth = lw * 4; g.stroke();
    });
  }
  regrout(S);
  return S;
}

function paintTerrazzo(p, r) {
  const tw = num(p.tileW, 60), th = num(p.tileH, tw);
  const S = surface(tw * Math.max(1, Math.round(120 / tw)), th * Math.max(1, Math.round(120 / th)), 8), { g } = S;
  const c1 = rgb(p.color, '#d9d5cc'), c2 = rgb(p.color2, '#8f8a80');
  g.fillStyle = css(c1); g.fillRect(0, 0, S.w, S.h);
  const chips = [c2, shade(c2, 0.35), shade(c1, -0.22), shade(c1, 0.3), mix(c2, [176, 122, 92], 0.55), mix(c2, [70, 74, 80], 0.5)];
  const n = Math.round((S.w * S.h) / 11);
  for (let i = 0; i < n; i++) {
    const x = r() * S.w, y = r() * S.h, rad = 0.25 + r() * r() * 1.9, k = 3 + Math.floor(r() * 4), a0 = r() * 6.28, col = chips[Math.floor(r() * chips.length)];
    const pts = []; for (let v = 0; v < k; v++) { const a = a0 + (v / k) * 6.283 + (r() - 0.5) * 0.6, rr = rad * (0.6 + r() * 0.5); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); }
    wrapped(S, () => { g.fillStyle = css(col, 0.9); g.beginPath(); pts.forEach(([px, py], q) => (q ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.fill(); });
  }
  if (tw < S.w + 1 && num(p.tileW, 0)) { S.tw = tw; S.th = th; S.gw = Math.max(S.px, 0.2); S.grout = shade(c1, -0.25); regrout(S); }
  return S;
}

function paintConcrete(p, r, o = {}) {
  const tw = num(p.tileW, 0), th = num(p.tileH, tw);
  const joints = tw >= 40 && tw <= 400;
  const S = surface(joints ? tw * Math.max(1, Math.round(240 / tw)) : 240, joints ? th * Math.max(1, Math.round(240 / th)) : 240, 4.2), { g } = S;
  const c1 = rgb(p.color, '#b7b5b0');
  g.fillStyle = css(c1); g.fillRect(0, 0, S.w, S.h);
  clouds(S, r, 46, 20, 90, o.cloud ?? 0.05);
  speckle(S, r, 9000, o.grain ?? 0.09, 1.4);
  if (joints) { S.tw = tw; S.th = th; S.gw = Math.max(S.px * 1.2, 0.5); S.grout = rgb(p.color2, hex(shade(c1, -0.22))); regrout(S); }
  return S;
}

function paintPlanks(p, r, o = {}) {
  const len = num(p.tileW, 120), wid = num(p.tileH, 19);
  const S = surface(len * (len < 100 ? 3 : 2), wid * Math.max(4, Math.round(228 / wid)), 5), { g } = S;
  const c1 = rgb(p.color, '#c9a77c'), c2 = rgb(p.color2, hex(shade(c1, -0.14)));
  const gap = o.gap || 0;
  g.fillStyle = css(shade(c2, -0.6)); g.fillRect(0, 0, S.w, S.h);
  const rows = Math.round(S.h / wid), per = Math.round(S.w / len);
  for (let j = 0; j < rows; j++) {
    const off = o.aligned ? 0 : r() * len;
    for (let i = -1; i <= per; i++) {
      const k = ((i % per) + per) % per, rr = prng(hashStr(`pl${j}:${k}`));
      g.save(); g.translate(i * len + off, j * wid + gap / 2);
      board(g, rr, len - (o.aligned ? 0 : gap * 0.4), wid - gap, tone(c1, c2, rr, 0.75, 0.04), S.px);
      g.restore();
    }
  }
  return S;
}

function paintHerringbone(p, r) {
  const W = num(p.tileH, 12), n = Math.max(2, Math.round(num(p.tileW, 60) / W)), L = n * W;
  const S = surface(2 * L, 2 * L, 6), { g } = S;
  const c1 = rgb(p.color, '#c9a77c'), c2 = rgb(p.color2, hex(shade(c1, -0.14)));
  g.fillStyle = css(shade(c2, -0.5)); g.fillRect(0, 0, S.w, S.h);
  const P = 2 * L, wrapKey = (x, y) => hash2(Math.round((((x % P) + P) % P) * 10), Math.round((((y % P) + P) % P) * 10) + 7919);
  for (let i = -3 * n; i <= 5 * n; i++) for (let j = -4; j <= 4; j++) {
    const x = i * W + j * L, y = i * W - j * L;
    if (x > P + L || x < -2 * L || y > P + L || y < -2 * L) continue;
    let rr = prng(Math.floor(wrapKey(x, y) * 1e9));
    g.save(); g.translate(x, y); board(g, rr, L, W, tone(c1, c2, rr, 0.8, 0.045), S.px); g.restore();
    rr = prng(Math.floor(wrapKey(x + L, y + W - L) * 1e9) + 3);
    g.save(); g.translate(x + L + W, y + W - L); g.rotate(Math.PI / 2); board(g, rr, L, W, tone(c1, c2, rr, 0.8, 0.045), S.px); g.restore();
  }
  return S;
}

function paintChevron(p, r) {
  const L = num(p.tileW, 60), W = num(p.tileH, 12);
  const c = L / Math.SQRT2, s = W * Math.SQRT2, rows = Math.max(4, Math.round(170 / s));
  const S = surface(2 * c, s * rows, 6), { g } = S;
  const c1 = rgb(p.color, '#c9a77c'), c2 = rgb(p.color2, hex(shade(c1, -0.14)));
  g.fillStyle = css(shade(c2, -0.5)); g.fillRect(0, 0, S.w, S.h);
  for (let col = 0; col < 2; col++) for (let j = -Math.ceil(c / s) - 1; j <= rows; j++) {
    const k = ((j % rows) + rows) % rows, rr = prng(hashStr(`ch${col}:${k}`)), up = col === 0 ? 1 : -1;
    const x0 = col * c, y0 = j * s + (col === 0 ? 0 : c);
    g.save();
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + c, y0 + up * c); g.lineTo(x0 + c, y0 + up * c + s); g.lineTo(x0, y0 + s); g.closePath(); g.clip();
    g.translate(x0, y0); g.rotate((up * Math.PI) / 4); g.translate(-W, 0);
    board(g, rr, L + 2 * W, W, tone(c1, c2, rr, 0.8, 0.045), S.px);
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = S.px;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + c, y0 + up * c); g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = S.px * 1.2;
  for (const x of [0, c, 2 * c]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S.h); g.stroke(); }
  return S;
}

function paintHex(p, r) {
  const w = num(p.tileW, 20), R = w / Math.sqrt(3);
  const cols = clamp(Math.round(160 / w), 2, 12), k = clamp(Math.round(160 / (3 * R)), 1, 8);
  const S = surface(w * cols, 3 * R * k, 7), { g } = S;
  const c1 = rgb(p.color, '#e4e1da'), c2 = rgb(p.color2, hex(shade(c1, -0.2)));
  const gw = Math.max(S.px * 1.4, 0.25);
  g.fillStyle = css(c2); g.fillRect(0, 0, S.w, S.h);
  for (let j = -1; j <= 2 * k; j++) for (let i = -1; i <= cols; i++) {
    const cx = i * w + (j % 2 ? w / 2 : 0), cy = j * 1.5 * R;
    const rr = prng(hashStr(`hx${((i % cols) + cols) % cols}:${((j % (2 * k)) + 2 * k) % (2 * k)}`));
    g.fillStyle = css(shade(c1, (rr() - 0.5) * 0.09));
    g.beginPath();
    for (let v = 0; v < 6; v++) { const a = Math.PI / 6 + (v * Math.PI) / 3, q = R - gw / 1.7; g[v ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * q, cy + Math.sin(a) * q); }
    g.closePath(); g.fill();
  }
  return S;
}

function paintStone(p, r) {
  const tw = num(p.tileW, 50), th = num(p.tileH, 30);
  const S = surface(240, 240, 4.2), { g } = S;
  const c1 = rgb(p.color, '#cfc6b4'), c2 = rgb(p.color2, hex(shade(c1, -0.3)));
  const gw = 0.9;
  g.fillStyle = css(c2); g.fillRect(0, 0, S.w, S.h);
  const hs = []; let sum = 0;
  while (sum < S.h - th * 0.4) { const h = th * [1, 0.7, 1.3, 0.85, 1.15][hs.length % 5]; hs.push(h); sum += h; }
  let y = 0;
  hs.forEach((h0, j) => {
    const h = (h0 * S.h) / sum, ws = []; let ww = 0;
    while (ww < S.w - tw * 0.4) { const w = tw * (0.7 + r() * 1.1); ws.push(w); ww += w; }
    let x = r() * tw;
    ws.forEach((w0, i) => {
      const w = (w0 * S.w) / ww, rr = prng(hashStr(`st${j}:${i}`)), col = tone(c1, shade(c1, -0.16), rr, 1, 0.05), x0 = x;
      wrapped(S, () => {
        g.fillStyle = css(col); g.beginPath();
        if (g.roundRect) g.roundRect(x0 + gw / 2, y + gw / 2, w - gw, h - gw, 1.2); else g.rect(x0 + gw / 2, y + gw / 2, w - gw, h - gw);
        g.fill();
      });
      x += w;
    });
    y += h;
  });
  clouds(S, r, 30, 8, 30, 0.035);
  speckle(S, r, 7000, 0.08, 1.3);
  return S;
}

function paintBrick(p, r) {
  const S = paintTiles({ tileW: num(p.tileW, 22), tileH: num(p.tileH, 7.5), color: p.color || '#b5654a', color2: p.color2 || '#d8d2c6' }, r,
    { bond: true, vary: 0.11, groutW: 1, span: 132, evenRows: true, pxPerCm: 7 });
  speckle(S, r, 9000, 0.1, 1.4);
  regrout(S, true);
  return S;
}

/** Wallpaper motifs: 'stripes' (vertical), 'plain' (woven texture) or a small repeating motif. */
function paintWallpaper(p, r) {
  const c1 = rgb(p.color, '#e9e4d8'), c2 = rgb(p.color2, hex(shade(c1, -0.14)));
  if (p.pattern === 'stripes') {
    const w = num(p.tileW, 8), S = surface(2 * w, 2 * w, 16), { g } = S;
    g.fillStyle = css(c1); g.fillRect(0, 0, S.w, S.h); g.fillStyle = css(c2); g.fillRect(w / 2, 0, w, S.h);
    speckle(S, r, 1500, 0.04);
    return S;
  }
  const u = p.pattern === 'plain' ? 40 : num(p.tileW, 16), S = surface(u * 2, u * 2, 12), { g } = S;
  g.fillStyle = css(c1); g.fillRect(0, 0, S.w, S.h);
  for (let i = 0; i < 900; i++) { // woven fibre
    g.strokeStyle = r() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.05)'; g.lineWidth = S.px;
    const x = r() * S.w, y = r() * S.h, l = 1 + r() * 5;
    g.beginPath(); if (r() < 0.5) { g.moveTo(x, y); g.lineTo(x + l, y); } else { g.moveTo(x, y); g.lineTo(x, y + l); } g.stroke();
  }
  if (p.pattern !== 'plain') {
    g.strokeStyle = css(c2); g.fillStyle = css(c2); g.lineWidth = Math.max(S.px, u * 0.035);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) {
      const cx = i * u + (j % 2 ? u / 2 : 0) + u / 4, cy = j * (u / 2) + u / 4, q = u * 0.2;
      wrapped(S, () => { g.beginPath(); g.moveTo(cx, cy - q); g.lineTo(cx + q * 0.7, cy); g.lineTo(cx, cy + q); g.lineTo(cx - q * 0.7, cy); g.closePath(); g.stroke(); g.beginPath(); g.arc(cx, cy, u * 0.025, 0, 6.3); g.fill(); });
    }
  }
  return S;
}

function paintWoodPanel(p, r) {
  const c1 = rgb(p.color, '#b98d5f'), c2 = rgb(p.color2, hex(shade(c1, -0.16)));
  const slats = p.pattern === 'slats', w = num(p.tileW, slats ? 4 : 12), gap = slats ? Math.max(1, w * 0.4) : 0, pitch = w + gap;
  const n = clamp(Math.round(96 / pitch), 4, 32), S = surface(pitch * n, 160, 9), { g } = S;
  g.fillStyle = css(slats ? shade(c2, -0.78) : shade(c2, -0.5)); g.fillRect(0, 0, S.w, S.h);
  for (let i = 0; i < n; i++) {
    const rr = prng(hashStr(`wp${i}`));
    g.save(); g.translate(i * pitch + gap / 2 + w, 0); g.rotate(Math.PI / 2);
    board(g, rr, S.h, w, tone(c1, c2, rr, 0.7, 0.035), S.px);
    g.restore();
  }
  return S;
}

function paintPlaster(p, r, strength = 1) {
  const S = surface(200, 200, 2.56), { g } = S;
  g.fillStyle = css(rgb(p.color, '#e8e3d9')); g.fillRect(0, 0, S.w, S.h);
  clouds(S, r, 70, 12, 70, 0.035 * strength);
  speckle(S, r, 5000, 0.035 * strength, 1.6);
  return S;
}

// ───────────────────────── site / envelope painters ─────────────────────────
function paintEarth(r) {
  const S = surface(700, 700, 2), { g } = S;
  const base = [186, 164, 128];
  g.fillStyle = css(base); g.fillRect(0, 0, S.w, S.h);
  clouds(S, r, 90, 40, 190, 0.09);
  // dry-grass patches: thin straw / dull-olive blades in loose clusters
  const blades = [[203, 186, 128], [176, 168, 108], [150, 152, 96], [214, 200, 150], [128, 134, 84]];
  for (let c = 0; c < 150; c++) {
    const cx = r() * S.w, cy = r() * S.h, rad = 14 + r() * 60, n = 30 + Math.floor(r() * 110), col = blades[Math.floor(r() * blades.length)];
    for (let i = 0; i < n; i++) {
      const a = r() * 6.283, d = Math.sqrt(r()) * rad, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, l = 2 + r() * 5, t = r() * 6.283;
      wrapped(S, () => { g.strokeStyle = css(shade(col, (r() - 0.5) * 0.2), 0.5 + r() * 0.4); g.lineWidth = S.px * (0.8 + r() * 0.6); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(t) * l, y + Math.sin(t) * l); g.stroke(); });
    }
  }
  for (let i = 0; i < 500; i++) { // pebbles
    const x = r() * S.w, y = r() * S.h, q = 0.6 + r() * 1.8;
    g.fillStyle = css(shade([160, 150, 134], (r() - 0.5) * 0.5), 0.8); g.beginPath(); g.ellipse(x, y, q, q * (0.6 + r() * 0.4), r() * 3.1, 0, 6.3); g.fill();
  }
  speckle(S, r, 26000, 0.12, 1.5);
  return S;
}

function paintAsphalt(r) {
  const S = surface(300, 300, 3.4), { g } = S;
  g.fillStyle = '#5b5c5f'; g.fillRect(0, 0, S.w, S.h);
  clouds(S, r, 40, 30, 120, 0.06);
  speckle(S, r, 30000, 0.2, 1.3);
  return S;
}

// ───────────────────────── material factories ─────────────────────────
function textureFrom(S) {
  const t = new THREE.CanvasTexture(S.c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(100 / S.w, 100 / S.h);          // uv in metres → one canvas every S.w × S.h cm
  return t;
}

function cached(key, make) {
  let m = _cache.get(key);
  if (!m) { m = make(); _cache.set(key, m); }
  return m;
}

function standard(S, roughness, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0, ...extra });
  if (S) m.map = textureFrom(S);
  return m;
}

const roughFromGloss = (gloss, base = 0.9) => clamp(base - 0.78 * clamp(+gloss || 0, 0, 1), 0.14, 0.96);
const paramKey = (p) => Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join(';');

const FLOOR_PAINTERS = {
  tile: (p, r) => paintTiles(p, r, { vary: 0.028, mottle: 0.035 }),
  mosaic: (p, r) => paintTiles({ ...p, tileW: num(p.tileW, 2.5), tileH: num(p.tileH, num(p.tileW, 2.5)) }, r, { vary: 0.1, span: 40, pxPerCm: 16, groutW: 0.3 }),
  checker: (p, r) => paintTiles(p, r, { checker: true, evenCols: true, evenRows: true, grout: shade(mix(rgb(p.color, '#eeeeee'), rgb(p.color2, '#333333'), 0.5), -0.3) }),
  marble: paintMarble,
  terrazzo: paintTerrazzo,
  concrete: paintConcrete,
  plank: paintPlanks,
  deck: (p, r) => paintPlanks({ ...p, tileW: num(p.tileW, 240), tileH: num(p.tileH, 14) }, r, { gap: 0.6, aligned: false }),
  herringbone: paintHerringbone,
  chevron: paintChevron,
  hex: paintHex,
  stone: paintStone,
};

/**
 * Floor material for a 'floor-finish' parameter set: { pattern, tileW, tileH, color, color2, gloss }.
 * Unknown patterns fall back to tiles; never throws.
 * @returns {THREE.MeshStandardMaterial} shared, cached material (uv unit = 1 m)
 */
export function floorMaterial(params) {
  const p = params && typeof params === 'object' ? params : {};
  return cached('floor|' + paramKey(p), () => {
    const paint = FLOOR_PAINTERS[p.pattern] || FLOOR_PAINTERS.tile;
    let S = null;
    try { S = paint(p, prng(hashStr(paramKey(p)))); } catch (e) { S = null; }
    const m = standard(S, roughFromGloss(p.gloss, p.pattern === 'deck' || p.pattern === 'stone' ? 0.95 : 0.9));
    if (!S) m.color.set(hex(rgb(p.color, '#d9d4ca')));
    m.userData.finish = 'floor';
    return m;
  });
}

/**
 * Wall material for a 'wall-finish' parameter set: { kind, color, color2, tileW, tileH, pattern, gloss }.
 * 'paint' is a plain matt colour; every other kind gets a world-scaled texture (uv = metres along wall, height).
 * @returns {THREE.MeshStandardMaterial} shared, cached material
 */
export function wallMaterial(params) {
  const p = params && typeof params === 'object' ? params : {};
  return cached('wall|' + paramKey(p), () => {
    const r = prng(hashStr(paramKey(p)));
    let S = null, rough = roughFromGloss(p.gloss, 0.93);
    try {
      switch (p.kind) {
        case 'tile':
          if (p.pattern === 'herringbone') S = paintHerringbone({ ...p, tileW: num(p.tileW, 30), tileH: num(p.tileH, 7.5), color2: hex(shade(rgb(p.color, '#eceae6'), -0.03)) }, r);
          else if (p.pattern === 'subway') S = paintTiles({ ...p, tileW: num(p.tileW, 15), tileH: num(p.tileH, 7.5) }, r, { bond: true, evenRows: true, vary: 0.02, span: 90, pxPerCm: 10 });
          else S = paintTiles(p, r, { vary: 0.018, mottle: 0.03 });
          break;
        case 'wallpaper': S = paintWallpaper(p, r); break;
        case 'wood-panel': S = paintWoodPanel(p, r); rough = roughFromGloss(p.gloss, 0.7); break;
        case 'stone': S = paintStone({ ...p, tileW: num(p.tileW, 45), tileH: num(p.tileH, 22) }, r); break;
        case 'brick': S = paintBrick(p, r); break;
        case 'plaster': S = paintPlaster(p, r, 1); break;
        case 'microcement': S = paintPlaster(p, r, 1.7); rough = roughFromGloss(p.gloss, 0.75); break;
        default: break;                                           // paint
      }
    } catch (e) { S = null; }
    const m = standard(S, rough);
    if (!S) m.color.set(hex(rgb(p.color, '#f4f1ea')));
    m.userData.finish = 'wall';
    return m;
  });
}

/**
 * Non-finish surfaces used by the site and the building envelope.
 * @param {'earth'|'asphalt'|'render'|'roof'|'pavers'|'sidewalk'|'path'} kind
 * @param {{ color?: string }} [opts] base colour for 'render'
 */
export function surfaceMaterial(kind, opts = {}) {
  return cached(`surface|${kind}|${opts.color || ''}`, () => {
    const r = prng(hashStr(kind));
    switch (kind) {
      case 'earth': return standard(paintEarth(r), 1, { vertexColors: true });
      case 'asphalt': return standard(paintAsphalt(r), 0.95);
      case 'render': { // fine sprayed render: the colour lives on the material so it can be re-tinted live
        const m = standard(paintPlaster({ color: '#ffffff' }, r, 0.9), 0.94);
        m.color.set(opts.color || '#efece6');
        return m;
      }
      case 'roof': return standard(paintConcrete({ color: '#cfd0cc' }, r, { cloud: 0.035, grain: 0.05 }), 0.9);
      case 'pavers': return standard(paintHerringbone({ tileW: 20, tileH: 10, color: '#a9a39a', color2: '#8f8a83' }, r), 0.95);
      case 'path': return standard(paintTiles({ tileW: 40, tileH: 40, color: '#bdb6aa', color2: '#9a948a' }, r, { vary: 0.045, mottle: 0.04, groutW: 0.5 }), 0.95);
      case 'sidewalk': return standard(paintConcrete({ color: '#b9b6ae', tileW: 100, tileH: 100, color2: '#8f8c85' }, r), 0.96);
      default: return standard(null, 0.9, { color: new THREE.Color(opts.color || '#bbbbbb') });
    }
  });
}

/** Free every cached finish material and its texture (GPU memory); they are rebuilt on demand. */
export function disposeMaterials() {
  for (const m of _cache.values()) { if (m.map) m.map.dispose(); m.dispose(); }
  _cache.clear();
}

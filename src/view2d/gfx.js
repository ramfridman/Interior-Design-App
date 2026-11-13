/**
 * Drawing surface helper. All plan-static artwork is drawn in DEVICE pixels with explicit rounding, so wall
 * edges and hairlines land exactly on pixel boundaries at every zoom level (crisp, never blurry).
 *
 *   k      device px per plan cm          scale  CSS px per cm        dpr  device px per CSS px
 *   ox/oy  device px position of the plan origin (always integers)
 */
const HALO = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];

export function createGfx(ctx, { scale, dpr, ox, oy, width, height, font }) {
  const k = scale * dpr;
  const G = {
    ctx, k, scale, dpr, ox, oy, width, height, font,
    /** Visible plan rectangle (cm). */
    view: { x0: -ox / k, y0: -oy / k, x1: (width - ox) / k, y1: (height - oy) / k },
    X: (x) => x * k + ox,
    Y: (y) => y * k + oy,
    RX: (x) => Math.round(x * k + ox),
    RY: (y) => Math.round(y * k + oy),
    /** CSS px → whole device px (≥ 1). */
    px: (cssPx) => Math.max(1, Math.round(cssPx * dpr)),
    /** Switch the context to plan units (cm) — used for item symbols. */
    planSpace() { ctx.setTransform(k, 0, 0, k, ox, oy); },
    deviceSpace() { ctx.setTransform(1, 0, 0, 1, 0, 0); },
    /** Is a plan rect (x0,y0,x1,y1) at least partly on screen? */
    visible: (x0, y0, x1, y1) => x1 >= G.view.x0 && x0 <= G.view.x1 && y1 >= G.view.y0 && y0 <= G.view.y1,

    /** Add a pixel-snapped plan rect to the current path. */
    rect(x, y, w, h) {
      const x0 = G.RX(x), y0 = G.RY(y);
      ctx.rect(x0, y0, G.RX(x + w) - x0, G.RY(y + h) - y0);
    },
    /** Add a plan segment to the current path; axis-aligned segments are snapped for a line `lw` device px wide. */
    seg(x1, y1, x2, y2, lw = 1) {
      const off = lw % 2 ? 0.5 : 0;
      if (x1 === x2) { const x = G.RX(x1) + off; ctx.moveTo(x, G.RY(y1)); ctx.lineTo(x, G.RY(y2)); }
      else if (y1 === y2) { const y = G.RY(y1) + off; ctx.moveTo(G.RX(x1), y); ctx.lineTo(G.RX(x2), y); }
      else { ctx.moveTo(G.X(x1), G.Y(y1)); ctx.lineTo(G.X(x2), G.Y(y2)); }
    },
    /** Trace a plan polygon ([[x, y], …]) as a closed path (pixel-snapped vertices). */
    poly(points) {
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(G.RX(x), G.RY(y)) : ctx.moveTo(G.RX(x), G.RY(y))));
      ctx.closePath();
    },
    /** Filled + hairline-stroked box given two opposite plan corners. */
    box(xa, ya, xb, yb, fill, stroke, lw = 1) {
      const x0 = G.RX(Math.min(xa, xb)), y0 = G.RY(Math.min(ya, yb));
      const w = Math.max(1, G.RX(Math.max(xa, xb)) - x0), h = Math.max(1, G.RY(Math.max(ya, yb)) - y0);
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(x0, y0, w, h); }
      if (stroke) {
        ctx.strokeStyle = stroke; ctx.lineWidth = lw;
        const o = lw / 2;
        if (w > lw && h > lw) ctx.strokeRect(x0 + o, y0 + o, w - lw, h - lw);
        else { ctx.fillStyle = stroke; ctx.fillRect(x0, y0, w, h); }
      }
    },
    /** Set the font: size in CSS px. */
    setFont(size, weight = 400, style = '') {
      ctx.font = `${style ? style + ' ' : ''}${weight} ${Math.round(size * dpr * 100) / 100}px ${font}`;
    },
    /**
     * Draw text at a DEVICE-px anchor. opts: { size, weight, color, halo, align, baseline, angle (rad), spacing (em) }.
     */
    text(str, x, y, opts = {}) {
      const { size = 11, weight = 400, color = '#000', halo = null, align = 'center', baseline = 'middle', angle = 0, spacing = 0 } = opts;
      G.setFont(size, weight);
      ctx.textAlign = align; ctx.textBaseline = baseline;
      if ('letterSpacing' in ctx) ctx.letterSpacing = spacing ? `${spacing * size * dpr}px` : '0px';
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      if (angle) ctx.rotate(angle);
      if (halo) {
        // eight offset copies: far cheaper than strokeText (glyphs come from the raster cache) and just as legible
        const r = Math.max(1, 1.3 * dpr);
        ctx.fillStyle = halo;
        for (const [hx, hy] of HALO) ctx.fillText(str, hx * r, hy * r);
      }
      ctx.fillStyle = color;
      ctx.fillText(str, 0, 0);
      ctx.restore();
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    },
    /** Text width in device px for the given style. */
    measure(str, size = 11, weight = 400, spacing = 0) {
      G.setFont(size, weight);
      if ('letterSpacing' in ctx) ctx.letterSpacing = spacing ? `${spacing * size * dpr}px` : '0px';
      const w = ctx.measureText(str).width;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      return w;
    },
  };
  return G;
}

/** Collision registry for annotation text (device-px boxes). */
export function createBoxes() {
  const list = [];
  const hit = (a, b, pad) => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;
  return {
    list,
    collides: (box, pad = 2) => list.some((b) => hit(box, b, pad)),
    overlapArea(box) {
      let s = 0;
      for (const b of list) {
        const w = Math.min(box.x1, b.x1) - Math.max(box.x0, b.x0), h = Math.min(box.y1, b.y1) - Math.max(box.y0, b.y0);
        if (w > 0 && h > 0) s += w * h;
      }
      return s;
    },
    add(box) { list.push(box); return box; },
  };
}

/** Rounded-rect path in the current transform. */
export function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

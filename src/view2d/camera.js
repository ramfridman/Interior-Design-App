/**
 * 2D camera: plan (cm) ↔ screen (CSS px inside the view), with animated fits, eased wheel zoom about a fixed
 * anchor, and pan inertia. `tick(now)` advances all motion and returns true while something is still moving.
 */
import { clamp } from '../core/geometry.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Camera {
  constructor() {
    this.scale = 0.5;          // CSS px per cm
    this.tx = 0; this.ty = 0;  // CSS px position of the plan origin
    this.w = 1; this.h = 1;    // view size, CSS px
    this.minScale = 0.05; this.maxScale = 9;
    this._anim = null; this._zoom = null; this._glide = null;
  }

  toScreen(x, y) { return { x: x * this.scale + this.tx, y: y * this.scale + this.ty }; }
  toPlan(sx, sy) { return { x: (sx - this.tx) / this.scale, y: (sy - this.ty) / this.scale }; }
  /** Visible plan rectangle. */
  viewRect() { const a = this.toPlan(0, 0), b = this.toPlan(this.w, this.h); return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }; }
  get moving() { return !!(this._anim || this._zoom || this._glide); }

  stop() { this._anim = this._zoom = this._glide = null; }
  panBy(dx, dy) { this._anim = null; this.tx += dx; this.ty += dy; }

  /** Immediate zoom keeping the screen point (sx, sy) fixed. */
  zoomAt(sx, sy, factor) {
    const s = clamp(this.scale * factor, this.minScale, this.maxScale);
    const f = s / this.scale;
    this.tx = sx - (sx - this.tx) * f; this.ty = sy - (sy - this.ty) * f; this.scale = s;
  }
  /** Eased zoom towards scale × factor about (sx, sy) — successive calls accumulate (mouse wheel). */
  zoomToward(sx, sy, factor) {
    this._anim = null; this._glide = null;
    const from = this._zoom ? this._zoom.target : this.scale;
    this._zoom = { target: clamp(from * factor, this.minScale, this.maxScale), sx, sy };
  }
  /** Start an inertial glide with the given velocity (CSS px / ms). */
  glide(vx, vy) { if (Math.hypot(vx, vy) > 0.12) this._glide = { vx, vy, t: 0 }; }

  /** Camera state that shows plan rect `r` centred inside the view minus `pad` ({top,right,bottom,left} px). */
  frame(r, pad, maxScale = this.maxScale) {
    const aw = Math.max(40, this.w - pad.left - pad.right), ah = Math.max(40, this.h - pad.top - pad.bottom);
    const scale = clamp(Math.min(aw / Math.max(1, r.w), ah / Math.max(1, r.h)), this.minScale, maxScale);
    return {
      scale,
      tx: pad.left + (aw - r.w * scale) / 2 - r.x * scale,
      ty: pad.top + (ah - r.h * scale) / 2 - r.y * scale,
    };
  }
  /** Go to a camera state, optionally animated (ms). */
  goTo(target, duration = 0) {
    this._zoom = null; this._glide = null;
    if (!duration) { this._anim = null; Object.assign(this, target); return; }
    this._anim = { from: { scale: this.scale, tx: this.tx, ty: this.ty }, to: target, t0: 0, duration };
  }

  /** Advance animations. Returns true while the camera is still moving. */
  tick(now, dt) {
    if (this._anim) {
      const a = this._anim;
      if (!a.t0) a.t0 = now;
      const t = clamp((now - a.t0) / a.duration, 0, 1), e = ease(t);
      // Interpolate scale geometrically and the view centre linearly in plan space → a natural "fly-to".
      const s = a.from.scale * Math.pow(a.to.scale / a.from.scale, e);
      const cx0 = (this.w / 2 - a.from.tx) / a.from.scale, cy0 = (this.h / 2 - a.from.ty) / a.from.scale;
      const cx1 = (this.w / 2 - a.to.tx) / a.to.scale, cy1 = (this.h / 2 - a.to.ty) / a.to.scale;
      const cx = cx0 + (cx1 - cx0) * e, cy = cy0 + (cy1 - cy0) * e;
      this.scale = s; this.tx = this.w / 2 - cx * s; this.ty = this.h / 2 - cy * s;
      if (t >= 1) { Object.assign(this, a.to); this._anim = null; }
    }
    if (this._zoom) {
      const z = this._zoom;
      const ratio = z.target / this.scale;
      if (Math.abs(Math.log(ratio)) < 0.002) { this.zoomAt(z.sx, z.sy, ratio); this._zoom = null; }
      else this.zoomAt(z.sx, z.sy, Math.pow(ratio, 1 - Math.exp(-dt / 60)));
    }
    if (this._glide) {
      const g = this._glide;
      const decay = Math.exp(-dt / 180);
      this.tx += g.vx * dt; this.ty += g.vy * dt;
      g.vx *= decay; g.vy *= decay;
      if (Math.hypot(g.vx, g.vy) < 0.02) this._glide = null;
    }
    return this.moving;
  }
}

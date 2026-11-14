/** 2D affine maps [a, b, c, d, e, f]: X = a·x + c·y + e, Y = b·x + d·y + f (the engine's `transform` convention). */
/** a ∘ b for [a, b, c, d, e, f] affine maps (first `first`, then `then`). */
export function affThen(first, then) {
  const [a1, b1, c1, d1, e1, f1] = first, [a2, b2, c2, d2, e2, f2] = then;
  return [a2 * a1 + c2 * b1, b2 * a1 + d2 * b1, a2 * c1 + c2 * d1, b2 * c1 + d2 * d1, a2 * e1 + c2 * f1 + e2, b2 * e1 + d2 * f1 + f2];
}
export function affInv(m) {
  const [a, b, c, d, e, f] = m, det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
export const affApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

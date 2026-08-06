// Pure zoom/pan math for the mobile seat-map canvas. Kept framework-free so the
// bun self-check (seatMapZoom.test.ts) can import it without React/JSX.

export const MAX_SCALE = 2.5;

/** Clamp a scale into [fit, MAX_SCALE]. fit is the fit-to-width scale (never zoom out past it). */
export function clampScale(scale: number, fit: number): number {
  const min = Math.min(fit, MAX_SCALE);
  return Math.max(min, Math.min(MAX_SCALE, scale));
}

/**
 * Clamp a translate so the scaled content can't be dragged fully off-screen.
 * content/viewport are unscaled intrinsic + viewport sizes. `margin` is the
 * fraction of the viewport allowed as overscroll on each edge (0 = flush).
 * When the scaled content is smaller than the viewport on an axis, it's centered.
 */
export function clampTranslate(
  x: number,
  y: number,
  scale: number,
  viewport: { w: number; h: number },
  content: { w: number; h: number },
  margin = 0.15,
): { x: number; y: number } {
  return {
    x: clampAxis(x, scale, viewport.w, content.w, margin),
    y: clampAxis(y, scale, viewport.h, content.h, margin),
  };
}

function clampAxis(t: number, scale: number, vp: number, size: number, margin: number): number {
  const scaled = size * scale;
  if (scaled <= vp) {
    // Content narrower than viewport: center it.
    return (vp - scaled) / 2;
  }
  const slack = vp * margin;
  const min = vp - scaled - slack; // most-negative (content pushed left/up)
  const max = slack; // content pushed right/down
  return Math.max(min, Math.min(max, t));
}

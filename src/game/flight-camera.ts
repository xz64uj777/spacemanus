/**
 * Flight-camera field of view policy.
 *
 * The chase camera keeps a fixed vertical FOV, which is right for landscape screens but collapses
 * the horizontal view on tall phones: at 390x844 the aspect is 0.46, so 58 degrees vertical leaves
 * roughly 28 degrees across — a keyhole. Below an aspect of 1 (as tall as it is wide) the vertical
 * FOV opens up so the horizontal view stays usable, capped so the projection never turns fisheye.
 *
 * Landscape framing is deliberately untouched: any aspect of 1 or wider returns the base FOV.
 */

/** Vertical FOV used whenever the viewport is at least as wide as it is tall. */
export const BASE_FLIGHT_FOV = 58

/** Ceiling for the portrait widening; about 38 degrees horizontal on a 9:19.5 phone. */
export const MAX_FLIGHT_FOV = 82

/** Vertical FOV for the flight chase camera at the given viewport aspect (width / height). */
export function flightVerticalFov(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= 1) return BASE_FLIGHT_FOV
  // Keep the horizontal half-angle from the base FOV, then convert it back to a vertical angle.
  const halfBase = (BASE_FLIGHT_FOV * Math.PI) / 360
  const needed = (2 * Math.atan(Math.tan(halfBase) / aspect) * 180) / Math.PI
  return Math.min(MAX_FLIGHT_FOV, needed)
}

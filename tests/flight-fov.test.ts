import { describe, expect, it } from 'vitest'
import { BASE_FLIGHT_FOV, flightVerticalFov, MAX_FLIGHT_FOV } from '../src/game/flight-camera'

/** Horizontal FOV that a vertical FOV produces at the given aspect. */
function horizontalFov(vertical: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((vertical * Math.PI) / 360) * aspect) * 180) / Math.PI
}

describe('flightVerticalFov', () => {
  it('leaves landscape and desktop framing exactly as it was', () => {
    for (const aspect of [1, 1.33, 1.78, 2.16, 3.56]) {
      expect(flightVerticalFov(aspect)).toBe(BASE_FLIGHT_FOV)
    }
  })

  it('widens the view on tall phones instead of showing a keyhole', () => {
    const portrait = flightVerticalFov(390 / 844)
    expect(portrait).toBeGreaterThan(BASE_FLIGHT_FOV)
    expect(portrait).toBeLessThanOrEqual(MAX_FLIGHT_FOV)
    // The old 58 degree vertical FOV gave about 28 degrees across on this screen.
    expect(horizontalFov(portrait, 390 / 844)).toBeGreaterThan(35)
  })

  it('grows monotonically as the screen gets taller', () => {
    const fovs = [0.95, 0.85, 0.75, 0.65].map(flightVerticalFov)
    for (let i = 1; i < fovs.length; i += 1) expect(fovs[i]).toBeGreaterThan(fovs[i - 1])
  })

  it('clamps so the projection never turns fisheye', () => {
    expect(flightVerticalFov(0.2)).toBe(MAX_FLIGHT_FOV)
    expect(flightVerticalFov(0.05)).toBe(MAX_FLIGHT_FOV)
  })

  it('falls back to the base FOV for a missing or broken aspect', () => {
    expect(flightVerticalFov(0)).toBe(BASE_FLIGHT_FOV)
    expect(flightVerticalFov(-1)).toBe(BASE_FLIGHT_FOV)
    expect(flightVerticalFov(Number.NaN)).toBe(BASE_FLIGHT_FOV)
    expect(flightVerticalFov(Number.POSITIVE_INFINITY)).toBe(BASE_FLIGHT_FOV)
  })
})

import { describe, expect, it } from 'vitest'
import { shapeStick, STICK_DEAD_ZONE } from '../src/ui/touch'

describe('shapeStick', () => {
  it('reports no thrust inside the dead zone', () => {
    expect(shapeStick(0, 0)).toEqual({ x: 0, y: 0 })
    expect(shapeStick(STICK_DEAD_ZONE * 0.5, -STICK_DEAD_ZONE * 0.5)).toEqual({ x: 0, y: 0 })
  })

  it('keeps a straight back pull straight despite sideways thumb wobble', () => {
    const shaped = shapeStick(0.07, -1)
    expect(shaped.x).toBe(0)
    expect(shaped.y).toBe(-1)
  })

  it('keeps full throw at the ring edge', () => {
    expect(shapeStick(0, -1).y).toBe(-1)
    expect(shapeStick(0, -0.5).y).toBe(-0.5)
  })

  it('preserves deliberate diagonal thrust', () => {
    const shaped = shapeStick(0.7, 0.7)
    expect(shaped.x).toBeGreaterThan(0.5)
    expect(shaped.y).toBeGreaterThan(0.5)
  })

  it('drops sideways drift while pushing or pulling hard along the other axis', () => {
    const shaped = shapeStick(0.9, -0.1)
    expect(shaped.x).toBe(0.9)
    expect(shaped.y).toBe(0)
  })
})

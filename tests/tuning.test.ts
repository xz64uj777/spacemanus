import { afterEach, describe, expect, it } from 'vitest'
import { CONFIG, DEFAULT_CONFIG } from '../src/game/config'
import { tuning } from '../src/game/tuning'

const defaults = Object.fromEntries(tuning.controls.map(control => [control.id, control.default]))

afterEach(() => {
  tuning.apply(defaults)
  tuning.activate('run')
})

describe('Orbital gameplay tuning', () => {
  it('validates a whole preview patch atomically and leaves immutable source defaults untouched', () => {
    const before = tuning.read()
    for (const patch of [
      { 'flight.acceleration': 10, unknown: 3 },
      { 'flight.acceleration': 2 },
      { 'flight.acceleration': 9.3 },
      { 'eva.oxygenSeconds': Number.POSITIVE_INFINITY },
      { 'eva.maxSpeed': '3' },
    ]) {
      expect(() => tuning.apply(patch)).toThrow()
      expect(tuning.read()).toEqual(before)
    }
    tuning.apply({ 'flight.acceleration': 10 })
    expect(CONFIG.flight.acceleration).toBe(10)
    expect(DEFAULT_CONFIG.flight.acceleration).toBe(8.5)
    expect(tuning.read().active['flight.acceleration']).toBe(10)
    expect(tuning.unranked).toBe(true)
  })

  it('applies flight and EVA response live while reserving docking and life-support values for the next mission', () => {
    tuning.apply({ 'flight.acceleration': 9, 'flight.dockRadius': 14, 'eva.tetherLength': 32, 'eva.oxygenSeconds': 180 })
    expect(CONFIG.flight.acceleration).toBe(9)
    expect(CONFIG.flight.dockRadius).toBe(DEFAULT_CONFIG.flight.dockRadius)
    expect(CONFIG.eva.tetherLength).toBe(DEFAULT_CONFIG.eva.tetherLength)
    expect(CONFIG.eva.oxygenSeconds).toBe(DEFAULT_CONFIG.eva.oxygenSeconds)
    expect(tuning.read().requested['flight.dockRadius']).toBe(14)

    tuning.activate('run')
    expect(CONFIG.flight.dockRadius).toBe(14)
    expect(CONFIG.eva.tetherLength).toBe(32)
    expect(CONFIG.eva.oxygenSeconds).toBe(180)
    expect(tuning.unranked).toBe(true)
  })

  it('does not alter gameplay when the requested preview values have not crossed their activation boundary', () => {
    const before = tuning.read()
    tuning.activate('jump')
    tuning.activate('dash')
    expect(tuning.read()).toEqual(before)
    expect(CONFIG.flight).toEqual(DEFAULT_CONFIG.flight)
    expect(CONFIG.eva).toEqual(DEFAULT_CONFIG.eva)
  })

  it('exposes only flight/EVA controls that the simulation consumes', () => {
    expect(tuning.controls.length).toBeGreaterThanOrEqual(12)
    expect(tuning.controls.every(control => control.category === 'Flight systems' || control.category === 'EVA systems')).toBe(true)
    expect(tuning.controls.every(control => control.integrity === 'GAMEPLAY')).toBe(true)
  })
})

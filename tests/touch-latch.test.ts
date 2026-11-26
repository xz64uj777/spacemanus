import { describe, expect, it } from 'vitest'
import { isLatching, LATCH_ACTIONS, TouchLatches } from '../src/ui/touch'

describe('TouchLatches', () => {
  it('engages on the first tap and releases on the next', () => {
    const latches = new TouchLatches()
    expect(latches.toggle('sprint')).toEqual([['sprint', true]])
    expect(latches.get('sprint')).toBe(true)
    expect(latches.toggle('sprint')).toEqual([['sprint', false]])
    expect(latches.get('sprint')).toBe(false)
  })

  it('leaves other axes alone when a latch engages', () => {
    const latches = new TouchLatches()
    latches.toggle('jump')
    expect(latches.toggle('sprint')).toEqual([['sprint', true]])
    expect(latches.get('jump')).toBe(true)
  })

  it('releases the opposite vertical button when the other is tapped', () => {
    const latches = new TouchLatches()
    latches.toggle('jump')
    expect(latches.toggle('descend')).toEqual([['descend', true], ['jump', false]])
    expect(latches.get('jump')).toBe(false)
  })

  it('releases boost when brake is tapped and brake when boost is tapped', () => {
    const latches = new TouchLatches()
    latches.toggle('sprint')
    expect(latches.toggle('brake')).toEqual([['brake', true], ['sprint', false]])
    expect(latches.toggle('sprint')).toEqual([['sprint', true], ['brake', false]])
  })

  it('clears every engaged latch and reports what was lit', () => {
    const latches = new TouchLatches()
    latches.toggle('jump')
    latches.toggle('sprint')
    expect(latches.clear().sort()).toEqual(['jump', 'sprint'])
    expect(latches.get('jump')).toBe(false)
    expect(latches.get('sprint')).toBe(false)
    expect(latches.clear()).toEqual([])
  })
})

describe('LATCH_ACTIONS', () => {
  it('covers the four thrust buttons in the flight HUD', () => {
    expect([...LATCH_ACTIONS].sort()).toEqual(['brake', 'descend', 'jump', 'sprint'])
  })

  it('leaves one-shot actions on hold behavior', () => {
    expect(isLatching('dash')).toBe(false)
    expect(isLatching('interact')).toBe(false)
  })
})

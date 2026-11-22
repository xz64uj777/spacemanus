import { describe, expect, it } from 'vitest'
import {
  canServiceRelay,
  dockingReadiness,
  INITIAL_CAMPAIGN,
  isMissionUnlocked,
  MISSION_DEFINITIONS,
  parseCampaign,
  recordMission,
  scaledMissionRange,
} from '../src/game/missions'

describe('Orbital campaign and encounter rules', () => {
  it('unlocks the close relay first and only unlocks the lunar transfer after it', () => {
    const fresh = { ...INITIAL_CAMPAIGN }
    expect(isMissionUnlocked(fresh, 'relay')).toBe(true)
    expect(isMissionUnlocked(fresh, 'lunar')).toBe(false)
    expect(recordMission(fresh, 'lunar')).toEqual(fresh)
    const relay = recordMission(fresh, 'relay')
    expect(relay).toEqual({ relayComplete: true, lunarComplete: false })
    expect(isMissionUnlocked(relay, 'lunar')).toBe(true)
    expect(recordMission(relay, 'lunar')).toEqual({ relayComplete: true, lunarComplete: true })
  })

  it('sanitizes campaign saves and prevents a lunar flag from bypassing the relay', () => {
    expect(parseCampaign(null)).toEqual({ relayComplete: false, lunarComplete: false })
    expect(parseCampaign('not-json')).toEqual({ relayComplete: false, lunarComplete: false })
    expect(parseCampaign('{"relayComplete":false,"lunarComplete":true}')).toEqual({ relayComplete: false, lunarComplete: false })
    expect(parseCampaign('{"relayComplete":true,"lunarComplete":true}')).toEqual({ relayComplete: true, lunarComplete: true })
  })

  it('gives the far mission a materially longer destination and a distinct displayed range', () => {
    const close = MISSION_DEFINITIONS.relay
    const far = MISSION_DEFINITIONS.lunar
    expect(far.worldDistance).toBeGreaterThan(close.worldDistance * 2)
    expect(far.reportedRangeKm).toBeGreaterThan(close.reportedRangeKm * 1000)
    expect(scaledMissionRange(close.worldDistance, close.worldDistance, close.reportedRangeKm)).toBe(close.reportedRangeKm)
    expect(scaledMissionRange(far.worldDistance, far.worldDistance, far.reportedRangeKm)).toBe(far.reportedRangeKm)
    expect(scaledMissionRange(Number.NaN, 0, 384_400)).toBe(384_400)
  })

  it('requires both a safe relative speed and capture-range distance for docking', () => {
    expect(dockingReadiness(10, 7)).toEqual({ inRange: true, safeSpeed: true, ready: true })
    expect(dockingReadiness(10.01, 1)).toEqual({ inRange: false, safeSpeed: true, ready: false })
    expect(dockingReadiness(2, 7.01)).toEqual({ inRange: true, safeSpeed: false, ready: false })
    expect(dockingReadiness(-1, 0)).toEqual({ inRange: true, safeSpeed: true, ready: true })
    expect(dockingReadiness(Number.NaN, 0).ready).toBe(false)
    expect(dockingReadiness(0, Number.POSITIVE_INFINITY).ready).toBe(false)
  })

  it('requires the EVA astronaut to be within the reachable repair envelope', () => {
    expect(canServiceRelay(4.5)).toBe(true)
    expect(canServiceRelay(4.51)).toBe(false)
    expect(canServiceRelay(Number.NaN)).toBe(false)
  })
})

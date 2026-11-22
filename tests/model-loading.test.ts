import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { loadRegisteredModels } from '../src/game/model-loading'

const urls = { ship: '/ship.glb', astronaut: '/astronaut.glb' }

describe('registered model loading', () => {
  it('preserves both registered models when both requests succeed', async () => {
    const ship = { scene: new THREE.Group() }
    const astronaut = { scene: new THREE.Group() }
    const load = vi.fn(async (url: string) => url === urls.ship ? ship : astronaut)

    const result = await loadRegisteredModels(urls, load)

    expect(result.ship).toBe(ship)
    expect(result.astronaut).toBe(astronaut)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps a successful astronaut when the ship request fails', async () => {
    const error = new Error('ship fetch failed')
    const astronaut = { scene: new THREE.Group() }
    const load = vi.fn(async (url: string) => {
      if (url === urls.ship) throw error
      return astronaut
    })
    const onUnavailable = vi.fn()

    const result = await loadRegisteredModels(urls, load, onUnavailable)

    expect(result.ship).toBeUndefined()
    expect(result.astronaut).toBe(astronaut)
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith('ship', error)
  })

  it('keeps a successful ship when the astronaut request fails', async () => {
    const error = new Error('astronaut fetch failed')
    const ship = { scene: new THREE.Group() }
    const load = vi.fn(async (url: string) => {
      if (url === urls.astronaut) throw error
      return ship
    })
    const onUnavailable = vi.fn()

    const result = await loadRegisteredModels(urls, load, onUnavailable)

    expect(result.ship).toBe(ship)
    expect(result.astronaut).toBeUndefined()
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith('astronaut', error)
  })

  it('returns an empty model set and reports both failures instead of rejecting startup', async () => {
    const load = vi.fn(async () => { throw new Error('offline') })
    const onUnavailable = vi.fn()

    const result = await loadRegisteredModels(urls, load, onUnavailable)

    expect(result).toEqual({})
    expect(onUnavailable).toHaveBeenCalledTimes(2)
  })
})

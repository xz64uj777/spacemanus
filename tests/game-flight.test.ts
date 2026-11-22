import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { Audio } from '../src/engine/audio'
import type { Input } from '../src/engine/input'
import type { Renderer } from '../src/engine/renderer'
import { Game } from '../src/game/game'
import type { MissionId } from '../src/game/missions'

function fakeDocument(): object {
  const context = {
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {}, beginPath() {}, lineTo() {}, moveTo() {}, closePath() {}, fill() {},
    ellipse() {}, arc() {}, stroke() {},
  }
  const canvas = { width: 0, height: 0, getContext: () => context }
  return { pointerLockElement: null, createElement: () => canvas }
}

function buildGame(models: { ship?: { scene: THREE.Group; animations?: unknown[] }; astronaut?: { scene: THREE.Group; animations?: unknown[] } } = {
  ship: { scene: new THREE.Group(), animations: [] },
  astronaut: { scene: new THREE.Group(), animations: [] },
}) {
  vi.stubGlobal('document', fakeDocument())
  const heldActions = new Set<string>()
  const input = {
    move: { x: 0, y: 0 },
    consume: vi.fn(() => false),
    held: vi.fn((action: string) => heldActions.has(action)),
    endFrame: vi.fn(),
    takeLook: vi.fn(() => ({ x: 0, y: 0 })),
  }
  const renderer = { applyQuality: vi.fn(), render: vi.fn() }
  const audio = { play: vi.fn() }
  const completed: MissionId[] = []
  const message = vi.fn()
  const game = new Game(
    renderer as unknown as Renderer,
    input as unknown as Input,
    audio as unknown as Audio,
    { message, missionComplete: (id: MissionId) => completed.push(id) },
    models as never,
  )
  return { game, input, heldActions, renderer, audio, completed, message }
}

afterEach(() => vi.unstubAllGlobals())

describe('Orbital mission simulation', () => {
  it('starts with procedural spacecraft and astronaut visuals when models are unavailable', () => {
    const { game } = buildGame({})
    const countMeshes = (root: THREE.Object3D) => {
      let count = 0
      root.traverse(child => { if ((child as THREE.Mesh).isMesh) count += 1 })
      return count
    }

    game.start('relay')
    expect(game.mode).toBe('playing')
    expect(countMeshes(game.shipRoot)).toBeGreaterThan(5)
    expect(countMeshes(game.avatarRoot)).toBeGreaterThan(5)
  })

  it('accelerates the playable ship under direct thrust and independent RCS strafe input', () => {
    const { game, input } = buildGame()
    game.start('relay')
    input.move.y = 1
    input.move.x = 0.5
    game.step(0.5)
    expect(game.shipRoot.position.z).toBeLessThan(0)
    expect(game.shipRoot.position.x).toBeGreaterThan(0)
    expect(game.velocity.length()).toBeGreaterThan(0)
    game.render(0, 1 / 60)
  })

  it('rejects a high-speed docking attempt and consumes the interaction edge only once', () => {
    const { game, input, message } = buildGame()
    game.start('relay')
    game.shipRoot.position.copy(game.targetPosition).add(new THREE.Vector3(0, 0, 8))
    game.velocity.set(0, 0, -8)
    input.consume.mockReturnValueOnce(true)
    game.step(1 / 60)
    expect(game.stage).toBe('approach')
    expect(message).toHaveBeenLastCalledWith('message.tooFast')

    game.velocity.set(0, 0, 0)
    game.requestInteract()
    game.step(1 / 60)
    expect(game.stage).toBe('docked')
    game.step(1 / 60)
    expect(game.stage).toBe('docked')
  })

  it('supports a moving tethered EVA and completes the close-range relay repair', () => {
    const { game, input, completed, audio } = buildGame()
    game.start('relay')
    game.shipRoot.position.copy(game.targetPosition).add(new THREE.Vector3(0, 0, 8))
    input.consume.mockReturnValueOnce(true)
    game.step(1 / 60)
    expect(game.stage).toBe('docked')

    input.consume.mockReturnValueOnce(true)
    game.step(1 / 60)
    expect(game.stage).toBe('eva')
    expect(game.avatarRoot.visible).toBe(true)
    expect(game.hud().canService).toBe(false)

    input.move.y = 1
    game.step(0.8)
    expect(game.avatarRoot.position.distanceTo(game.servicePosition)).toBeGreaterThan(0)
    expect(game.hud().tether).toBeLessThan(game.hud().tetherLimit)

    game.avatarRoot.position.copy(game.servicePosition)
    input.consume.mockReturnValueOnce(true)
    game.step(1 / 60)
    expect(completed).toEqual(['relay'])
    expect(game.stage).toBe('complete')
    expect(game.mode).toBe('ended')
    expect(audio.play).toHaveBeenCalledWith('win')
  })

  it('keeps the lunar target materially farther away and completes it by docking without EVA', () => {
    const { game, input, completed } = buildGame()
    game.start('lunar')
    const lunarDistance = game.targetPosition.length()
    expect(lunarDistance).toBeGreaterThan(200)
    expect((game as unknown as { moonGroup: THREE.Group }).moonGroup.visible).toBe(true)

    game.shipRoot.position.copy(game.targetPosition).add(new THREE.Vector3(0, 0, 8))
    input.consume.mockReturnValueOnce(true)
    game.step(1 / 60)
    expect(completed).toEqual(['lunar'])
    expect(game.stage).toBe('complete')
    expect(game.avatarRoot.visible).toBe(false)
  })
})

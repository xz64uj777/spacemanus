import * as THREE from 'three'
import type { Audio } from '../engine/audio'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import { CONFIG } from './config'
import { canServiceRelay, dockingReadiness, MISSION_DEFINITIONS, scaledMissionRange, type MissionId, type MissionStage } from './missions'
import type { ModelSet } from './model-loading'
import { createFallbackAstronaut, createFallbackShuttle } from './model-fallbacks'
import { tuning } from './tuning'

export type GameMode = 'title' | 'playing' | 'paused' | 'ended'
export type GameHooks = {
  message(key: string): void
  missionComplete(id: MissionId): void
}
type HudData = {
  mission: MissionId; stage: MissionStage; speed: number; distanceKm: number; objectiveKey: string
  canDock: boolean; dockDistance: number; oxygen: number; tether: number; tetherLimit: number
  serviceDistance: number; canService: boolean; statusKey: string
}

const UP = new THREE.Vector3(0, 1, 0)
const FORWARD = new THREE.Vector3(0, 0, -1)
const tempForward = new THREE.Vector3()
/** Back-stick past this much is treated as retro-thrust for the plume and the HUD status line. */
const RETRO_THRESHOLD = 0.15
const tempRight = new THREE.Vector3()
const tempAccel = new THREE.Vector3()

/** Three-dimensional inertial flight model with RCS translation, retro-thrust, docking and EVA. */
export class Game {
  mode: GameMode = 'title'
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 4000)
  readonly shipRoot = new THREE.Group()
  readonly velocity = new THREE.Vector3()
  readonly targetPosition = new THREE.Vector3()
  readonly evaRoot = new THREE.Group()
  readonly avatarRoot = new THREE.Group()
  readonly servicePosition = new THREE.Vector3()
  readonly tetherAnchor = new THREE.Vector3()
  missionId: MissionId = 'relay'
  stage: MissionStage = 'approach'
  oxygen = CONFIG.eva.oxygenSeconds
  reducedMotion = false
  time = 0
  private readonly shipModel = new THREE.Group()
  private readonly engineGlow: THREE.Mesh
  private readonly targetGroup = new THREE.Group()
  private readonly relayGroup = new THREE.Group()
  private readonly lunarGroup = new THREE.Group()
  private readonly moonGroup = new THREE.Group()
  private readonly earth: THREE.Mesh
  private readonly station: THREE.Group
  private readonly lunarOutpost: THREE.Group
  private readonly avatarVisual = new THREE.Group()
  private readonly tetherGeometry = new THREE.BufferGeometry()
  private readonly tetherLine: THREE.Line
  private readonly cameraTarget = new THREE.Vector3()
  private readonly cameraDesired = new THREE.Vector3()
  private readonly evaVelocity = new THREE.Vector3()
  private readonly evaHeading = new THREE.Euler(0, 0, 0, 'YXZ')
  private evaYaw = 0
  private evaPitch = 0
  private boostWasOn = false
  private interactRequested = false
  private readonly starField: THREE.Points
  private readonly backgroundOrbit: THREE.LineLoop

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly hooks: GameHooks,
    models: ModelSet = {},
  ) {
    this.scene.background = new THREE.Color('#050a16')
    this.scene.add(new THREE.HemisphereLight('#b4d3ff', '#151a28', 0.5))
    const sun = new THREE.DirectionalLight('#e9efff', 2.15)
    sun.position.set(180, 130, 100)
    sun.castShadow = true
    this.scene.add(sun)
    const fill = new THREE.PointLight('#71b9ff', 34, 420, 1.8)
    fill.position.set(-120, 55, -240)
    this.scene.add(fill)

    this.starField = createStarfield()
    this.scene.add(this.starField)
    this.earth = createPlanet(68, '#154c83', 'earth')
    this.earth.position.set(110, -42, 105)
    this.scene.add(this.earth)
    const earthOrbit = circleLine(79, '#335574', 0.35)
    earthOrbit.position.copy(this.earth.position)
    earthOrbit.rotation.x = Math.PI / 2.35
    this.scene.add(earthOrbit)
    this.backgroundOrbit = circleLine(30, '#54606c', 0.27)
    this.scene.add(this.backgroundOrbit)
    this.moonGroup.add(createPlanet(23, '#737984', 'moon'))
    this.moonGroup.visible = false
    this.scene.add(this.moonGroup)

    this.shipRoot.add(this.shipModel)
    this.shipModel.add(normalizedModel(models.ship?.scene.clone(true) ?? createFallbackShuttle(), 13, false))
    this.shipRoot.traverse(setSafeMaterial)
    const engineMat = new THREE.MeshBasicMaterial({ color: '#ffae59', transparent: true, opacity: 0.8, depthWrite: false })
    this.engineGlow = new THREE.Mesh(new THREE.ConeGeometry(0.75, 3.7, 20, 1, true), engineMat)
    this.engineGlow.rotation.x = Math.PI / 2
    this.engineGlow.position.set(0, 0, 8.3)
    this.engineGlow.scale.set(0.06, 0.07, 0.7)
    this.shipRoot.add(this.engineGlow)
    this.scene.add(this.shipRoot)

    this.station = createRelayStation()
    this.relayGroup.add(this.station)
    this.relayGroup.add(createDockingRing())
    this.targetGroup.add(this.relayGroup)
    this.lunarOutpost = createLunarOutpost()
    this.lunarGroup.add(this.lunarOutpost)
    this.lunarGroup.add(createDockingRing())
    this.targetGroup.add(this.lunarGroup)
    const targetPing = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 10), new THREE.MeshBasicMaterial({ color: '#ffbf62' }))
    targetPing.position.set(0, 7.5, 0)
    this.targetGroup.add(targetPing)
    const pingLight = new THREE.PointLight('#ffb75e', 20, 24)
    pingLight.position.copy(targetPing.position)
    this.targetGroup.add(pingLight)
    this.scene.add(this.targetGroup)

    const suit = normalizedModel(models.astronaut?.scene.clone(true) ?? createFallbackAstronaut(), 1.9, true)
    this.avatarVisual.add(suit)
    this.avatarRoot.add(this.avatarVisual)
    this.avatarRoot.visible = false
    this.scene.add(this.avatarRoot)
    const beacon = createServiceBeacon()
    this.evaRoot.add(beacon)
    this.scene.add(this.evaRoot)
    this.tetherGeometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
    this.tetherLine = new THREE.Line(this.tetherGeometry, new THREE.LineDashedMaterial({ color: '#7ce6ff', dashSize: 0.65, gapSize: 0.34, transparent: true, opacity: 0.8 }))
    this.tetherLine.computeLineDistances()
    this.scene.add(this.tetherLine)
    this.tetherLine.visible = false
    this.shipRoot.position.set(0, 0, 0)
    this.camera.position.set(0, 5, 17)
    this.camera.lookAt(0, 0, -5)
  }

  start(id: MissionId): void {
    tuning.activate('run')
    this.missionId = id
    this.stage = 'approach'
    this.mode = 'playing'
    this.oxygen = CONFIG.eva.oxygenSeconds
    this.velocity.set(0, 0, 0)
    this.evaVelocity.set(0, 0, 0)
    this.shipRoot.position.set(0, 0, 0)
    this.shipRoot.rotation.set(0, 0, 0, 'YXZ')
    this.evaRoot.visible = false
    this.avatarRoot.visible = false
    this.tetherLine.visible = false
    this.boostWasOn = false
    this.input.endFrame()
    this.input.takeLook()
    this.targetPosition.fromArray([...MISSION_DEFINITIONS[id].worldTarget])
    this.targetGroup.position.copy(this.targetPosition)
    this.targetGroup.visible = true
    this.relayGroup.visible = id === 'relay'
    this.lunarGroup.visible = id === 'lunar'
    this.moonGroup.visible = id === 'lunar'
    this.moonGroup.position.copy(this.targetPosition).add(new THREE.Vector3(0, -31, -9))
    this.backgroundOrbit.position.copy(this.moonGroup.position)
    this.servicePosition.copy(this.targetPosition).add(new THREE.Vector3(8, 3, 0))
    this.evaRoot.position.copy(this.servicePosition)
    this.camera.position.set(0, 5, 17)
    this.camera.lookAt(0, 0, -5)
  }

  pause(): void { if (this.mode === 'playing') this.mode = 'paused' }
  requestInteract(): void { this.interactRequested = true }
  resume(): void {
    if (this.mode !== 'paused') return
    this.mode = 'playing'
    this.input.endFrame()
    this.input.takeLook()
  }
  toTitle(): void {
    this.mode = 'title'
    this.stage = 'approach'
    this.velocity.set(0, 0, 0)
    this.evaVelocity.set(0, 0, 0)
    this.avatarRoot.visible = false
    this.tetherLine.visible = false
    this.input.endFrame()
  }

  setQuality(quality: 'low' | 'medium' | 'high'): void {
    this.renderer.applyQuality(quality)
  }

  step(dt: number): void {
    this.time += dt
    const keyboardInteract = this.input.consume('interact')
    const interact = this.interactRequested || keyboardInteract
    this.interactRequested = false
    if (this.mode !== 'playing') return
    const look = this.input.takeLook()
    if (this.stage === 'eva') {
      this.stepEVA(dt, look, interact)
      return
    }
    this.stepFlight(dt, look, interact)
  }

  render(_alpha: number, frameSeconds: number): void {
    const dt = Math.min(0.05, Math.max(0, frameSeconds))
    this.time += dt
    this.earth.rotation.y += dt * 0.0016
    this.starField.rotation.y = Math.sin(this.time * 0.015) * 0.02
    this.engineGlow.visible = this.mode === 'playing' && this.stage === 'approach' && this.engineGlow.scale.x > 0.08
    this.station.rotation.y = Math.sin(this.time * 0.13) * 0.035
    this.evaRoot.rotation.y = Math.sin(this.time * 0.45) * 0.025
    this.updateTether()
    if (this.mode === 'title') {
      const orbit = this.time * (this.reducedMotion ? 0.006 : 0.035)
      this.camera.position.set(Math.sin(orbit) * 36, 19 + Math.sin(orbit * 0.65) * 2, 32 + Math.cos(orbit) * 36)
      this.camera.lookAt(10, -4, -44)
    } else if (this.stage === 'eva' && this.mode !== 'ended') {
      const forward = new THREE.Vector3(Math.sin(this.evaYaw), 0, -Math.cos(this.evaYaw))
      this.cameraDesired.copy(this.avatarRoot.position).addScaledVector(forward, 8).add(new THREE.Vector3(0, 3.8, 0))
      this.camera.position.lerp(this.cameraDesired, 1 - Math.exp(-4.2 * dt))
      this.cameraTarget.copy(this.avatarRoot.position).addScaledVector(forward, 2.8).add(new THREE.Vector3(0, 0.9, 0))
      this.camera.lookAt(this.cameraTarget)
    } else {
      const forward = tempForward.copy(FORWARD).applyQuaternion(this.shipRoot.quaternion)
      this.cameraDesired.copy(this.shipRoot.position).add(new THREE.Vector3(0, 4.8, 0)).addScaledVector(forward, -17)
      this.camera.position.lerp(this.cameraDesired, 1 - Math.exp(-3.4 * dt))
      this.cameraTarget.copy(this.shipRoot.position).addScaledVector(forward, 6)
      this.camera.lookAt(this.cameraTarget)
    }
    this.renderer.render(this.scene, this.camera)
  }

  hud(): HudData {
    const def = MISSION_DEFINITIONS[this.missionId]
    const dockDistance = this.shipRoot.position.distanceTo(this.targetPosition)
    const dock = dockingReadiness(dockDistance, this.velocity.length(), CONFIG.flight.dockRadius, CONFIG.flight.dockMaxSpeed)
    const serviceDistance = this.avatarRoot.position.distanceTo(this.servicePosition)
    const objectiveKey = this.stage === 'eva' ? def.objectiveKeys.repair! : this.stage === 'docked' ? def.objectiveKeys.eva ?? def.objectiveKeys.dock : def.objectiveKeys.approach
    const statusKey = this.stage === 'eva'
      ? (this.avatarRoot.position.distanceTo(this.tetherAnchor) > CONFIG.eva.tetherLength * 0.82 ? 'status.tether' : 'status.eva')
      : this.input.held('brake') || this.input.move.y < -RETRO_THRESHOLD ? 'status.retro'
        : this.input.held('sprint') ? 'status.boost' : 'status.nominal'
    return {
      mission: this.missionId, stage: this.stage, speed: this.stage === 'eva' ? this.evaVelocity.length() : this.velocity.length(),
      distanceKm: scaledMissionRange(dockDistance, def.worldDistance, def.reportedRangeKm), objectiveKey,
      canDock: dock.ready, dockDistance, oxygen: Math.max(0, this.oxygen / CONFIG.eva.oxygenSeconds * 100),
      tether: this.avatarRoot.position.distanceTo(this.tetherAnchor), tetherLimit: CONFIG.eva.tetherLength,
      serviceDistance, canService: canServiceRelay(serviceDistance, CONFIG.eva.repairRadius), statusKey,
    }
  }

  private stepFlight(dt: number, look: { x: number; y: number }, interact: boolean): void {
    const rotation = this.shipRoot.rotation
    rotation.order = 'YXZ'
    rotation.y -= look.x
    rotation.x = THREE.MathUtils.clamp(rotation.x - look.y, -1.25, 1.25)
    const roll = Number(this.input.held('rollRight')) - Number(this.input.held('rollLeft'))
    rotation.z += roll * CONFIG.flight.rollSpeed * dt
    rotation.z *= Math.exp(-CONFIG.flight.angularDamping * dt * 0.12)

    const boost = this.input.held('sprint')
    const throttle = this.input.move.y
    const reversing = throttle < -RETRO_THRESHOLD
    const boosted = boost && throttle > 0
    this.engineGlow.scale.setScalar(boosted ? 1.1 : throttle > 0 ? 0.6 : reversing ? 0.34 : 0.06)
    this.engineGlow.visible = throttle > 0 || reversing
    // Retro-thrust exhausts out of the nose, so the plume mirrors to the front while reversing.
    this.engineGlow.rotation.x = reversing ? -Math.PI / 2 : Math.PI / 2
    this.engineGlow.position.z = reversing ? -8.3 : 8.3
    if (boosted && !this.boostWasOn) this.audio.play('dash')
    this.boostWasOn = boosted

    const forward = tempForward.copy(FORWARD).applyQuaternion(this.shipRoot.quaternion)
    const right = tempRight.set(1, 0, 0).applyQuaternion(this.shipRoot.quaternion)
    tempAccel.set(0, 0, 0)
    const thrustScale = boost ? CONFIG.flight.boostMultiplier : 1
    tempAccel.addScaledVector(forward, this.input.move.y * CONFIG.flight.acceleration * thrustScale)
    tempAccel.addScaledVector(right, this.input.move.x * CONFIG.flight.strafeAcceleration)
    if (this.input.held('jump')) tempAccel.addScaledVector(UP, CONFIG.flight.verticalAcceleration)
    if (this.input.held('descend')) tempAccel.addScaledVector(UP, -CONFIG.flight.verticalAcceleration)
    this.velocity.addScaledVector(tempAccel, dt)
    if (this.input.held('brake')) {
      const speed = this.velocity.length()
      if (speed > 0) this.velocity.addScaledVector(this.velocity.clone().normalize(), -Math.min(speed, CONFIG.flight.braking * dt))
    } else {
      this.velocity.multiplyScalar(Math.exp(-0.018 * dt))
    }
    const maxSpeed = CONFIG.flight.maxSpeed * (boost ? 1.3 : 1)
    if (this.velocity.length() > maxSpeed) this.velocity.setLength(maxSpeed)
    this.shipRoot.position.addScaledVector(this.velocity, dt)

    if (interact) {
      const distance = this.shipRoot.position.distanceTo(this.targetPosition)
      const readiness = dockingReadiness(distance, this.velocity.length(), CONFIG.flight.dockRadius, CONFIG.flight.dockMaxSpeed)
      if (this.stage === 'docked') {
        if (MISSION_DEFINITIONS[this.missionId].requiresEva) this.beginEVA()
      } else if (readiness.ready) {
        this.dock()
      } else if (distance <= CONFIG.flight.dockRadius && !readiness.safeSpeed) {
        this.hooks.message('message.tooFast')
      } else {
        this.hooks.message('message.outOfRange')
      }
    }
  }

  private dock(): void {
    this.stage = 'docked'
    this.shipRoot.position.copy(this.targetPosition).add(new THREE.Vector3(0, 1.5, 12))
    this.velocity.set(0, 0, 0)
    this.shipRoot.lookAt(this.targetPosition)
    this.audio.play('pickup')
    if (!MISSION_DEFINITIONS[this.missionId].requiresEva) this.completeMission()
    else this.hooks.message('message.docked')
  }

  private beginEVA(): void {
    this.stage = 'eva'
    this.oxygen = CONFIG.eva.oxygenSeconds
    this.tetherAnchor.copy(this.shipRoot.position)
    this.evaRoot.position.copy(this.targetPosition).add(new THREE.Vector3(8, 3, 0))
    this.avatarRoot.position.copy(this.shipRoot.position).add(new THREE.Vector3(0, 2, -1))
    this.avatarRoot.visible = true
    this.tetherLine.visible = true
    this.evaYaw = Math.atan2(this.servicePosition.x - this.avatarRoot.position.x, -(this.servicePosition.z - this.avatarRoot.position.z))
    this.evaPitch = 0
    this.evaVelocity.set(0, 0, 0)
    this.hooks.message('message.evaStarted')
  }

  private stepEVA(dt: number, look: { x: number; y: number }, interact: boolean): void {
    this.evaYaw -= look.x
    this.evaPitch = THREE.MathUtils.clamp(this.evaPitch - look.y, -0.8, 0.8)
    const forward = tempForward.set(Math.sin(this.evaYaw), 0, -Math.cos(this.evaYaw))
    const right = tempRight.set(Math.cos(this.evaYaw), 0, Math.sin(this.evaYaw))
    tempAccel.set(0, 0, 0)
    tempAccel.addScaledVector(forward, this.input.move.y * CONFIG.eva.acceleration)
    tempAccel.addScaledVector(right, this.input.move.x * CONFIG.eva.acceleration)
    if (this.input.held('jump')) tempAccel.addScaledVector(UP, CONFIG.eva.acceleration)
    if (this.input.held('descend')) tempAccel.addScaledVector(UP, -CONFIG.eva.acceleration)
    this.evaVelocity.addScaledVector(tempAccel, dt).multiplyScalar(Math.exp(-CONFIG.eva.damping * dt))
    if (this.evaVelocity.length() > CONFIG.eva.maxSpeed) this.evaVelocity.setLength(CONFIG.eva.maxSpeed)
    this.avatarRoot.position.addScaledVector(this.evaVelocity, dt)

    const tether = this.avatarRoot.position.distanceTo(this.tetherAnchor)
    if (tether > CONFIG.eva.tetherLength) {
      const away = this.avatarRoot.position.clone().sub(this.tetherAnchor).normalize()
      this.evaVelocity.addScaledVector(away, -Math.min(12, (tether - CONFIG.eva.tetherLength) * 1.5) * dt)
    }
    this.oxygen = Math.max(0, this.oxygen - dt)
    this.evaHeading.set(this.evaPitch, this.evaYaw, 0)
    this.avatarRoot.rotation.copy(this.evaHeading)

    if (this.oxygen <= 0) {
      this.returnToAirlock()
      return
    }
    if (interact) {
      const serviceDistance = this.avatarRoot.position.distanceTo(this.servicePosition)
      if (canServiceRelay(serviceDistance, CONFIG.eva.repairRadius)) {
        this.completeMission()
      } else {
        this.hooks.message('message.panelRange')
      }
    }
  }

  private returnToAirlock(): void {
    this.stage = 'docked'
    this.avatarRoot.visible = false
    this.tetherLine.visible = false
    this.evaVelocity.set(0, 0, 0)
    this.hooks.message('message.oxygenReturn')
  }

  private completeMission(): void {
    this.stage = 'complete'
    this.mode = 'ended'
    this.avatarRoot.visible = false
    this.tetherLine.visible = false
    this.audio.play('win')
    this.hooks.missionComplete(this.missionId)
  }

  private updateTether(): void {
    if (!this.tetherLine.visible) return
    const positions = this.tetherGeometry.attributes.position as THREE.BufferAttribute
    positions.setXYZ(0, this.tetherAnchor.x, this.tetherAnchor.y, this.tetherAnchor.z)
    positions.setXYZ(1, this.avatarRoot.position.x, this.avatarRoot.position.y, this.avatarRoot.position.z)
    positions.needsUpdate = true
    this.tetherGeometry.computeBoundingSphere()
    this.tetherLine.computeLineDistances()
  }
}

function normalizedModel(source: THREE.Object3D, maxDimension: number, feetOnOrigin: boolean): THREE.Group {
  const wrapper = new THREE.Group()
  source.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(source)
  const size = bounds.getSize(new THREE.Vector3())
  const max = Math.max(size.x, size.y, size.z, 0.001)
  const scale = maxDimension / max
  const center = bounds.getCenter(new THREE.Vector3())
  source.scale.setScalar(scale)
  source.position.set(-center.x * scale, (feetOnOrigin ? -bounds.min.y : -center.y) * scale, -center.z * scale)
  source.traverse(setSafeMaterial)
  wrapper.add(source)
  return wrapper
}

function setSafeMaterial(object: THREE.Object3D): void {
  const mesh = object as THREE.Mesh
  if (!mesh.isMesh) return
  mesh.castShadow = true
  mesh.receiveShadow = true
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const material of materials) {
    const standard = material as THREE.MeshStandardMaterial
    if ('roughness' in standard && Number.isFinite(standard.roughness)) standard.roughness = Math.max(0.48, standard.roughness)
    if ('metalness' in standard && Number.isFinite(standard.metalness)) standard.metalness = Math.min(0.45, standard.metalness)
  }
}

function createRelayStation(): THREE.Group {
  const g = new THREE.Group()
  const hull = new THREE.MeshStandardMaterial({ color: '#c8d1d7', roughness: 0.76, metalness: 0.28 })
  const white = new THREE.MeshStandardMaterial({ color: '#e5e2d9', roughness: 0.81, metalness: 0.12 })
  const dark = new THREE.MeshStandardMaterial({ color: '#182431', roughness: 0.82, metalness: 0.18 })
  const gold = new THREE.MeshStandardMaterial({ color: '#bd9365', roughness: 0.78, metalness: 0.2 })
  const panel = new THREE.MeshStandardMaterial({ color: '#153e62', roughness: 0.73, metalness: 0.15, emissive: '#07182a', emissiveIntensity: 0.18 })
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 13, 16), hull)
  spine.rotation.z = Math.PI / 2
  g.add(spine)
  for (const [x, length, radius] of [[-4.8, 5.2, 1.8], [4.2, 4.8, 1.55]] as const) {
    const module = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.92, length, 20), white)
    module.rotation.z = Math.PI / 2
    module.position.x = x
    g.add(module)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.82, 0.09, 8, 28), gold)
    ring.rotation.y = Math.PI / 2
    ring.position.x = x + (x > 0 ? -length / 2 : length / 2)
    g.add(ring)
  }
  for (const side of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.2, 26), hull)
    beam.position.set(0, side * 3.5, 0)
    g.add(beam)
    for (const wingSide of [-1, 1]) {
      const solar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 10.5, 24), panel)
      solar.position.set(wingSide * 8, side * 4.8, 0)
      solar.rotation.z = side * 0.05
      g.add(solar)
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 10.7, 0.18), gold)
      rail.position.set(wingSide * 8, side * 4.8, 0)
      g.add(rail)
      for (let z = -10; z <= 10; z += 5) {
        const cellLine = new THREE.Mesh(new THREE.BoxGeometry(0.14, 10.3, 0.055), dark)
        cellLine.position.set(wingSide * 8, side * 4.8, z)
        g.add(cellLine)
      }
    }
  }
  const port = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.32, 12, 48), white)
  port.position.set(0, 0.3, -7.2)
  g.add(port)
  const dockingCore = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 16), dark)
  dockingCore.position.set(0, 0.3, -7.1)
  g.add(dockingCore)
  for (const x of [-1, 1]) {
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 5, 6), hull)
    antenna.position.set(x * 2.2, 5.8, 3)
    antenna.rotation.z = x * -0.3
    g.add(antenna)
  }
  return g
}

function createLunarOutpost(): THREE.Group {
  const g = new THREE.Group()
  const hull = new THREE.MeshStandardMaterial({ color: '#b8c0bf', roughness: 0.86, metalness: 0.16 })
  const ceramic = new THREE.MeshStandardMaterial({ color: '#e0d9c9', roughness: 0.9, metalness: 0.08 })
  const dark = new THREE.MeshStandardMaterial({ color: '#252c34', roughness: 0.86, metalness: 0.18 })
  const gold = new THREE.MeshStandardMaterial({ color: '#b89970', roughness: 0.78, metalness: 0.22 })
  const photovoltaic = new THREE.MeshStandardMaterial({ color: '#17344e', roughness: 0.72, metalness: 0.18, emissive: '#081624', emissiveIntensity: 0.12 })

  const cabin = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.45, 7.2, 24), hull)
  cabin.position.set(0, -1.35, -8.3)
  g.add(cabin)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.25, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), ceramic)
  dome.position.set(0, 2.25, -8.3)
  g.add(dome)
  const airlock = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.22, 3.6, 18), dark)
  airlock.rotation.x = Math.PI / 2
  airlock.position.set(0, 0.2, -5.8)
  g.add(airlock)
  const passage = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.92, 3.1, 16), hull)
  passage.rotation.x = Math.PI / 2
  passage.position.set(0, 0.2, -2.45)
  g.add(passage)
  const collar = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.16, 10, 36), gold)
  collar.position.set(0, 0.2, -0.88)
  g.add(collar)

  for (const side of [-1, 1] as const) {
    const truss = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.17, 0.22), hull)
    truss.position.set(side * 7.0, -1.35, -8.3)
    g.add(truss)
    const panel = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.14, 8.8), photovoltaic)
    panel.position.set(side * 11.8, -1.45, -8.3)
    g.add(panel)
    for (let z = -12; z <= -4; z += 2) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(8.55, 0.035, 0.055), gold)
      line.position.set(side * 11.8, -1.34, z)
      g.add(line)
    }
    for (let x = -3; x <= 3; x += 2) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 8.55), gold)
      line.position.set(side * 11.8 + x, -1.34, -8.3)
      g.add(line)
    }
  }

  for (const x of [-1, 1] as const) {
    for (const z of [-1, 1] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.19, 4.8, 0.19), gold)
      leg.position.set(x * 2.65, -5.25, -8.3 + z * 0.75)
      leg.rotation.z = -x * 0.42
      g.add(leg)
      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.18, 1.1), dark)
      foot.position.set(x * 3.65, -7.7, -8.3 + z * 1.15)
      g.add(foot)
    }
  }

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, 4.2, 8), hull)
  mast.position.set(0, 5.15, -8.3)
  g.add(mast)
  const antenna = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), ceramic)
  antenna.scale.set(1, 0.45, 1)
  antenna.rotation.x = -Math.PI / 2
  antenna.position.set(0, 7.0, -8.3)
  g.add(antenna)
  return g
}

function createDockingRing(): THREE.Group {
  const g = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: '#87dcff', transparent: true, opacity: 0.52, depthWrite: false })
  const ring = new THREE.Mesh(new THREE.TorusGeometry(11.5, 0.07, 6, 96), material)
  g.add(ring)
  return g
}

function createServiceBeacon(): THREE.Group {
  const g = new THREE.Group()
  const housing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.9, 0.75), new THREE.MeshStandardMaterial({ color: '#d4d9d7', roughness: 0.78, metalness: 0.22 }))
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.6, 0.08), new THREE.MeshStandardMaterial({ color: '#69dcce', roughness: 0.62, metalness: 0.16, emissive: '#168a7b', emissiveIntensity: 0.38 }))
  screen.position.set(0, 0.3, -0.42)
  const marker = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.075, 8, 48), new THREE.MeshBasicMaterial({ color: '#7df1d6', transparent: true, opacity: 0.88 }))
  marker.position.y = 2.5
  g.add(housing, screen, marker)
  const light = new THREE.PointLight('#62e4ca', 14, 16)
  light.position.set(0, 2.8, 0)
  g.add(light)
  return g
}

function createStarfield(): THREE.Points {
  let seed = 0x25a117
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const points: number[] = []
  for (let i = 0; i < 1700; i += 1) {
    const u = random() * 2 - 1
    const angle = random() * Math.PI * 2
    const radius = 900 + random() * 1700
    const ring = Math.sqrt(1 - u * u)
    points.push(Math.cos(angle) * ring * radius, u * radius, Math.sin(angle) * ring * radius)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#d4e5ff', size: 1.15, sizeAttenuation: false, transparent: true, opacity: 0.88, depthWrite: false }))
}

function createPlanet(radius: number, color: string, kind: 'earth' | 'moon'): THREE.Mesh {
  const texture = proceduralPlanetTexture(kind)
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', map: texture, roughness: 0.98, metalness: 0.015 })
  if (kind === 'moon') material.color.set(color)
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), material)
  sphere.castShadow = true
  sphere.receiveShadow = true
  return sphere
}

function proceduralPlanetTexture(kind: 'earth' | 'moon'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const ctx = canvas.getContext('2d')!
  if (kind === 'earth') {
    const ocean = ctx.createLinearGradient(0, 0, 0, canvas.height)
    ocean.addColorStop(0, '#28618d'); ocean.addColorStop(0.48, '#1d5680'); ocean.addColorStop(1, '#103a65')
    ctx.fillStyle = ocean; ctx.fillRect(0, 0, canvas.width, canvas.height)
    const land = ['#526d57', '#67795a', '#4f6f63']
    const shapes = [
      [[110,110],[180,75],[240,96],[268,145],[238,172],[222,221],[177,242],[160,201],[128,179]],
      [[240,248],[278,267],[286,314],[266,377],[240,418],[224,366],[232,319]],
      [[434,103],[505,82],[559,105],[604,96],[667,128],[713,169],[694,204],[647,214],[613,179],[572,195],[545,242],[504,233],[478,193],[438,167]],
      [[490,238],[545,234],[574,277],[565,351],[533,410],[503,372],[480,310]],
      [[718,118],[783,90],[845,107],[873,148],[846,180],[792,181],[762,151]],
      [[77,286],[117,266],[148,292],[135,324],[99,331]],
    ]
    for (const [i, points] of shapes.entries()) {
      ctx.beginPath(); points.forEach(([x, y], j) => j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath()
      ctx.fillStyle = land[i % land.length]; ctx.fill()
    }
    ctx.globalAlpha = 0.18
    for (let i = 0; i < 120; i += 1) {
      const x = (i * 83) % canvas.width; const y = (i * 47) % canvas.height
      ctx.fillStyle = i % 2 ? '#ffffff' : '#b9c9d5'
      ctx.beginPath(); ctx.ellipse(x, y, 25 + (i % 39), 3 + (i % 6), 0.16, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
  } else {
    const shade = ctx.createLinearGradient(0, 0, 0, canvas.height)
    shade.addColorStop(0, '#858995'); shade.addColorStop(1, '#4f535e')
    ctx.fillStyle = shade; ctx.fillRect(0, 0, canvas.width, canvas.height)
    let seed = 48291
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let i = 0; i < 190; i += 1) {
      const x = random() * canvas.width; const y = random() * canvas.height; const r = 3 + random() * 24
      ctx.fillStyle = `rgba(27,31,38,${0.08 + random() * 0.13})`
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = 'rgba(190,194,201,0.12)'; ctx.lineWidth = 1.5; ctx.stroke()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function circleLine(radius: number, color: string, opacity: number): THREE.LineLoop {
  const points: THREE.Vector3[] = []
  for (let i = 0; i < 160; i += 1) {
    const angle = i / 160 * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
  }
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity }))
}

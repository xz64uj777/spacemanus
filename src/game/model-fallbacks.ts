import * as THREE from 'three'

/** Simple in-memory shuttle used only when the registered GLB cannot be fetched. */
export function createFallbackShuttle(): THREE.Group {
  const group = new THREE.Group()
  const hull = new THREE.MeshStandardMaterial({ color: '#d5d8d7', roughness: 0.68, metalness: 0.2 })
  const trim = new THREE.MeshStandardMaterial({ color: '#b88b5a', roughness: 0.72, metalness: 0.25 })
  const dark = new THREE.MeshStandardMaterial({ color: '#243544', roughness: 0.55, metalness: 0.3 })
  const glass = new THREE.MeshStandardMaterial({ color: '#356983', roughness: 0.22, metalness: 0.42, emissive: '#102b3b', emissiveIntensity: 0.2 })

  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.78, 7.1, 20), hull)
  fuselage.rotation.x = Math.PI / 2
  group.add(fuselage)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.58, 2.35, 20), hull)
  nose.rotation.x = -Math.PI / 2
  nose.position.z = -4.55
  group.add(nose)

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.57, 24, 16), glass)
  cockpit.scale.set(0.82, 0.45, 0.68)
  cockpit.position.set(0, 0.48, -2.25)
  group.add(cockpit)

  for (const side of [-1, 1] as const) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(3.15, 0.14, 2.3), hull)
    wing.position.set(side * 1.4, -0.14, 0.6)
    wing.rotation.y = side * -0.12
    group.add(wing)
    const wingRail = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.055, 0.09), trim)
    wingRail.position.set(side * 1.4, -0.055, 0.64)
    group.add(wingRail)

    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.82, 1.15), hull)
    fin.position.set(side * 0.68, 0.48, 2.7)
    fin.rotation.z = side * -0.12
    group.add(fin)
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.52, 0.78, 18), dark)
    engine.rotation.x = Math.PI / 2
    engine.position.set(side * 0.39, -0.08, 3.72)
    group.add(engine)
    const nozzle = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.075, 8, 24), trim)
    nozzle.position.set(side * 0.39, -0.08, 4.12)
    group.add(nozzle)
  }

  return group
}

/** Compact suit geometry that preserves the astronaut's scale and facing when offline. */
export function createFallbackAstronaut(): THREE.Group {
  const group = new THREE.Group()
  const suit = new THREE.MeshStandardMaterial({ color: '#d9ddd8', roughness: 0.82, metalness: 0.08 })
  const accent = new THREE.MeshStandardMaterial({ color: '#cf8e54', roughness: 0.7, metalness: 0.14 })
  const dark = new THREE.MeshStandardMaterial({ color: '#263745', roughness: 0.46, metalness: 0.28 })
  const visor = new THREE.MeshStandardMaterial({ color: '#132b3e', roughness: 0.2, metalness: 0.52, emissive: '#123246', emissiveIntensity: 0.22 })

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.45, 6, 14), suit)
  torso.position.y = 0.76
  group.add(torso)
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.16), accent)
  chest.position.set(0, 0.88, -0.29)
  group.add(chest)

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.39, 24, 16), suit)
  helmet.position.y = 1.38
  group.add(helmet)
  const faceplate = new THREE.Mesh(new THREE.SphereGeometry(0.31, 24, 14), visor)
  faceplate.scale.set(1, 0.68, 0.26)
  faceplate.position.set(0, 1.38, -0.31)
  group.add(faceplate)
  const brow = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 8, 24, Math.PI), accent)
  brow.position.set(0, 1.39, -0.31)
  group.add(brow)

  const arm = new THREE.CapsuleGeometry(0.115, 0.39, 5, 10)
  const glove = new THREE.SphereGeometry(0.14, 12, 8)
  const leg = new THREE.CapsuleGeometry(0.14, 0.38, 5, 10)
  for (const side of [-1, 1] as const) {
    const upperArm = new THREE.Mesh(arm, suit)
    upperArm.position.set(side * 0.43, 0.72, -0.01)
    upperArm.rotation.z = side * -0.22
    group.add(upperArm)
    const hand = new THREE.Mesh(glove, dark)
    hand.position.set(side * 0.52, 0.37, -0.02)
    group.add(hand)

    const legPiece = new THREE.Mesh(leg, suit)
    legPiece.position.set(side * 0.17, 0.2, 0.01)
    group.add(legPiece)
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.38), dark)
    boot.position.set(side * 0.17, 0.02, -0.05)
    group.add(boot)
  }

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.58, 0.27), accent)
  pack.position.set(0, 0.76, 0.34)
  group.add(pack)
  const packPanel = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.04), dark)
  packPanel.position.set(0, 0.83, 0.495)
  group.add(packPanel)
  return group
}

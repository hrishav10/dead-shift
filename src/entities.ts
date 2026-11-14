import * as THREE from 'three'

export interface Humanoid {
  group: THREE.Group
  head: THREE.Mesh
  torso: THREE.Mesh
  armL: THREE.Group; armR: THREE.Group
  legL: THREE.Group; legR: THREE.Group
  hips: THREE.Group
  female: boolean
  baseY: number
}

const skinTones = [0xc9995c, 0x8a5a33, 0xe8b98a, 0x6e4226, 0xd9a066]
const shirtColors = [0x3a6ea5, 0x8a3324, 0x2e5e4e, 0x666c75, 0x7a4a8c, 0xb08830, 0x37414f, 0x93586a]
const pantsColors = [0x23262b, 0x2c3e50, 0x4a3b2a, 0x3d3d55, 0x222222]

export function makeHumanoid(opts: {
  female?: boolean; zombie?: boolean; dancer?: boolean; skin?: number; shirt?: number; pants?: number; seated?: boolean; reduced?: boolean
} = {}): Humanoid {
  const g = new THREE.Group()
  const female = !!opts.female
  const skin = new THREE.MeshStandardMaterial({ color: opts.skin ?? skinTones[Math.floor(Math.random() * skinTones.length)], roughness: 0.8 })
  let shirtCol = opts.shirt ?? shirtColors[Math.floor(Math.random() * shirtColors.length)]
  if (opts.zombie) shirtCol = [0x4a5240, 0x54423a, 0x3c4148][Math.floor(Math.random() * 3)]
  const shirt = new THREE.MeshStandardMaterial({ color: shirtCol, roughness: 0.9 })
  const pants = new THREE.MeshStandardMaterial({ color: opts.pants ?? pantsColors[Math.floor(Math.random() * pantsColors.length)], roughness: 0.95 })

  const hips = new THREE.Group(); hips.position.y = 0.98; g.add(hips)

  const torsoGeo = female ? new THREE.BoxGeometry(0.42, 0.58, 0.24) : new THREE.BoxGeometry(0.46, 0.6, 0.26)
  const torso = new THREE.Mesh(torsoGeo, shirt)
  torso.position.y = 0.32; torso.castShadow = true; hips.add(torso)
  if (female && !opts.reduced) {
    // dress / stage-costume skirt cone
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.5, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: opts.dancer ? 0xc2185b : shirtCol, roughness: 0.6, side: THREE.DoubleSide }))
    skirt.position.y = 0.02; hips.add(skirt)
  }
  if (opts.dancer && !opts.reduced) {
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.23),
      new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0xaa7714, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.6 }))
    top.position.y = 0.48; hips.add(top)
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.26), skin)
  head.position.y = 0.82; head.castShadow = true; hips.add(head)
  // hair
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.28, female ? 0.34 : 0.12, 0.28),
    new THREE.MeshStandardMaterial({ color: [0x1a120b, 0x3a2410, 0x6e4a1f, 0x111111, 0x8c2f39][Math.floor(Math.random() * 5)], roughness: 1 }))
  hair.position.y = female ? 0.86 : 0.97; hair.position.z = female ? -0.03 : 0; hips.add(hair)
  if (opts.zombie) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.05), new THREE.MeshStandardMaterial({ color: 0x7a1f1f, roughness: 1 }))
    jaw.position.set(0, 0.68, 0.14); hips.add(jaw)
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: 0xd8ff5e }))
    eye.position.set(0, 0.86, 0.135); hips.add(eye)
  }
  const mkArm = (side: number) => {
    const a = new THREE.Group(); a.position.set(side * (female ? 0.26 : 0.29), 0.58, 0)
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.34, 0.11), shirt); upper.position.y = -0.17; upper.castShadow = true; a.add(upper)
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.09), skin); fore.position.y = -0.47; a.add(fore)
    hips.add(a); return a
  }
  const mkLeg = (side: number) => {
    const l = new THREE.Group(); l.position.set(side * 0.11, 0.02, 0)
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.52, 0.13), opts.dancer || (female && !opts.reduced) ? skin : pants)
    leg.position.y = -0.26; leg.castShadow = true; l.add(leg)
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.44, 0.11), opts.dancer ? skin : pants)
    shin.position.y = -0.72; l.add(shin)
    if (opts.dancer) { // heels
      const heel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.22), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 }))
      heel.position.set(0, -0.95, 0.04); l.add(heel)
    }
    hips.add(l); return l
  }
  const armL = mkArm(-1), armR = mkArm(1)
  const legL = mkLeg(-1), legR = mkLeg(1)
  if (opts.seated) {
    legL.rotation.x = -Math.PI / 2; legR.rotation.x = -Math.PI / 2
    hips.position.y = 0.55
  }
  return { group: g, head, torso, armL, armR, legL, legR, hips, female, baseY: hips.position.y }
}

export type Pose = 'walk' | 'run' | 'zombie' | 'idle' | 'talk' | 'flee' | 'dance' | 'attack' | 'seated' | 'dead' | 'hurt'

export function animateHumanoid(h: Humanoid, pose: Pose, t: number, phase: number, speed01 = 0.5) {
  const s = Math.sin(t * (4 + speed01 * 5) + phase)
  const s2 = Math.sin(t * (4 + speed01 * 5) + phase + Math.PI)
  switch (pose) {
    case 'walk': case 'flee': {
      const amp = pose === 'flee' ? 0.85 : 0.5
      h.legL.rotation.x = s * amp; h.legR.rotation.x = s2 * amp
      h.armL.rotation.x = s2 * amp * 0.8; h.armR.rotation.x = s * amp * 0.8
      h.hips.position.y = h.baseY + Math.abs(Math.cos(t * (4 + speed01 * 5) + phase)) * 0.04
      break
    }
    case 'run': case 'zombie': {
      h.legL.rotation.x = s * 0.9; h.legR.rotation.x = s2 * 0.9
      if (pose === 'zombie') { h.armL.rotation.x = -Math.PI / 2 + s * 0.14; h.armR.rotation.x = -Math.PI / 2 + s2 * 0.14 }
      else { h.armL.rotation.x = s2 * 0.9; h.armR.rotation.x = s * 0.9 }
      h.hips.position.y = h.baseY + Math.abs(Math.cos(t * 8 + phase)) * 0.05
      h.group.rotation.z = pose === 'zombie' ? Math.sin(t * 1.7 + phase) * 0.05 : 0
      break
    }
    case 'attack': {
      const a = Math.sin(t * 6 + phase)
      h.armL.rotation.x = -2.2 + a * 0.5; h.armR.rotation.x = -2.2 - a * 0.5
      h.legL.rotation.x = 0.1; h.legR.rotation.x = -0.1
      break
    }
    case 'dance': {
      h.hips.rotation.y = Math.sin(t * 1.6 + phase) * 0.45
      h.hips.position.y = h.baseY + Math.abs(Math.sin(t * 3.2 + phase)) * 0.07
      h.armL.rotation.x = -2.6 + Math.sin(t * 2.1 + phase) * 0.5; h.armL.rotation.z = 0.5
      h.armR.rotation.x = -2.6 + Math.cos(t * 2.3 + phase) * 0.5; h.armR.rotation.z = -0.5
      h.legL.rotation.x = Math.sin(t * 3.2 + phase) * 0.22; h.legR.rotation.x = -Math.sin(t * 3.2 + phase) * 0.22
      h.head.rotation.y = Math.sin(t * 0.9 + phase) * 0.4
      break
    }
    case 'talk': {
      h.armR.rotation.x = -0.4 + Math.sin(t * 2.4 + phase) * 0.25
      h.armL.rotation.x = -0.2 + Math.cos(t * 2.0 + phase) * 0.2
      h.head.rotation.y = Math.sin(t * 0.6 + phase) * 0.25
      break
    }
    case 'seated': {
      h.hips.position.y = h.baseY + Math.sin(t * 1.4 + phase) * 0.012 // breathing
      h.armL.rotation.x = -0.5; h.armR.rotation.x = -0.5
      break
    }
    case 'dead': {
      h.group.rotation.x = -Math.PI / 2
      break
    }
    default: { // idle
      h.hips.position.y = h.baseY + Math.sin(t * 1.5 + phase) * 0.015
      h.armL.rotation.x = Math.sin(t * 1.5 + phase) * 0.05
      h.armR.rotation.x = -Math.sin(t * 1.5 + phase) * 0.05
      h.legL.rotation.x = 0; h.legR.rotation.x = 0
    }
  }
}

// ---------------- cars ----------------
export interface CarMesh {
  group: THREE.Group
  wheels: THREE.Mesh[]
  frontWheels: THREE.Group[]
  brakeMat: THREE.MeshStandardMaterial
  headMat: THREE.MeshStandardMaterial
  bodyMat: THREE.MeshStandardMaterial
}
const carColors = [0xb03030, 0x3060a8, 0xc0c4cc, 0x22262c, 0x2e7d4f, 0xc9a227, 0x7430a8, 0xd96c27]
export function makeCar(kind: string, color?: number): CarMesh {
  const g = new THREE.Group()
  const col = color ?? carColors[Math.floor(Math.random() * carColors.length)]
  const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.7 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.4, metalness: 0.4 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x8fc6de, roughness: 0.08, metalness: 0.9 })
  const L = kind === 'van' ? 4.9 : kind === 'sports' ? 4.3 : 4.6
  const W = kind === 'van' ? 2.0 : 1.85
  const bodyH = kind === 'van' ? 1.15 : kind === 'sports' ? 0.55 : 0.68
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, bodyH, L), bodyMat)
  body.position.y = 0.42 + bodyH / 2; body.castShadow = true; g.add(body)
  if (kind === 'van') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.75, 1.1), glass)
    cab.position.set(0, 0.42 + bodyH + 0.32, -L / 2 + 0.75); g.add(cab)
  } else {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(W - 0.35, 0.5, L * 0.48), glass)
    cab.position.set(0, 0.42 + bodyH + 0.22, 0.1); cab.castShadow = true; g.add(cab)
  }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.22, 0.25), dark)
  bumper.position.set(0, 0.42, -L / 2 - 0.05); g.add(bumper)
  const bumper2 = bumper.clone(); bumper2.position.z = L / 2 + 0.05; g.add(bumper2)
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffedb5, emissiveIntensity: 0.4 })
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.06), headMat)
    hl.position.set(sx * W * 0.32, 0.72, -L / 2 - 0.16); g.add(hl)
  }
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x881111, emissive: 0xff2222, emissiveIntensity: 0.3 })
  for (const sx of [-1, 1]) {
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.06), brakeMat)
    bl.position.set(sx * W * 0.32, 0.74, L / 2 + 0.16); g.add(bl)
  }
  // headlight cone (fake volumetric) + light pool
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.9, 11, 14, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.026, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  cone.rotation.x = Math.PI / 2 + 0.06; cone.position.set(0, 0.65, -L / 2 - 5.5); cone.name = 'beam'; g.add(cone)
  const wheels: THREE.Mesh[] = []; const frontWheels: THREE.Group[] = []
  const wgeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12)
  const wmat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9 })
  for (const [sx, sz, front] of [[-1, -L / 2 + 0.75, 1], [1, -L / 2 + 0.75, 1], [-1, L / 2 - 0.75, 0], [1, L / 2 - 0.75, 0]] as const) {
    const pivot = new THREE.Group(); pivot.position.set(sx * (W / 2 + 0.02), 0.36, sz)
    const wm = new THREE.Mesh(wgeo, wmat); wm.rotation.z = Math.PI / 2; wm.castShadow = true
    pivot.add(wm); g.add(pivot); wheels.push(wm)
    if (front) frontWheels.push(pivot)
  }
  return { group: g, wheels, frontWheels, brakeMat, headMat, bodyMat }
}

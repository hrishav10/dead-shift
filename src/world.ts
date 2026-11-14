import * as THREE from 'three'

export interface AABB { x0: number; x1: number; z0: number; z1: number; h: number }
export interface Platform { x0: number; x1: number; z0: number; z1: number; y: number }
export interface Ramp { x0: number; x1: number; z0: number; z1: number; yHigh: number; highAt: 'x0' | 'x1' }

export const ROADS = [-200, -100, 0, 100, 200]
export const ROAD_W = 14
export const WORLD_HALF = 300

export interface Poi { id: string; name: string; x: number; z: number; color: string }
export const POIS: Poi[] = [
  { id: 'factory', name: 'Dead Shift Factory', x: -50, z: -150, color: '#ffb454' },
  { id: 'club', name: 'Velvet Room Club', x: 150, z: 50, color: '#ff4fd8' },
  { id: 'guns', name: 'Gun Shop', x: -150, z: 50, color: '#7ee787' },
  { id: 'clinic', name: 'Clinic', x: -150, z: -50, color: '#58c7ff' },
  { id: 'garage', name: 'Depot Garage', x: 50, z: 150, color: '#c9d1d9' }
]

export const FACTORY = { cx: -50, cz: -150, w: 76, d: 56, wallH: 9 }
export const CLUB = { cx: 150, cz: 50, w: 38, d: 28 }
export const SHOP = { cx: -150, cz: 50, w: 24, d: 18 }
export const CLINIC = { cx: -150, cz: -50, w: 24, d: 18 }

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d')!, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]) }
  t.anisotropy = 4
  return t
}

export function signTexture(text: string, fg: string, bg = 'rgba(5,5,10,0.92)', font = 700) {
  return canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h)
    g.font = `${font} 54px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.shadowColor = fg; g.shadowBlur = 22; g.fillStyle = fg
    g.fillText(text, w / 2, h / 2 + 2)
    g.shadowBlur = 0
  })
}

export interface WorldRefs {
  colliders: AABB[]
  platforms: Platform[]
  ramps: Ramp[]
  barrels: { mesh: THREE.Mesh; pos: THREE.Vector3; alive: boolean }[]
  collectibles: THREE.Mesh[]
  spawnDoors: THREE.Vector3[]
  trafficLoops: THREE.Vector3[][]
  sidewalkNodes: THREE.Vector3[]
  parkedSpots: { x: number; z: number; rotY: number; kind: string }[]
  clubDancerSpots: { x: number; z: number; pole?: boolean }[]
  clubBooths: { x: number; z: number }[]
  clubPlayerSeat: { x: number; z: number }
  update: (dt: number, t: number) => void
}

const MAT = {
  steel: new THREE.MeshStandardMaterial({ color: 0x5a6672, roughness: 0.55, metalness: 0.7 }),
  steelDark: new THREE.MeshStandardMaterial({ color: 0x2e343b, roughness: 0.6, metalness: 0.6 }),
  hazard: new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.7, metalness: 0.2 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x74603c, roughness: 0.9 }),
  crate2: new THREE.MeshStandardMaterial({ color: 0x44586b, roughness: 0.85 }),
  machine: new THREE.MeshStandardMaterial({ color: 0x3d6e5e, roughness: 0.45, metalness: 0.55 }),
  machine2: new THREE.MeshStandardMaterial({ color: 0x74563a, roughness: 0.5, metalness: 0.5 }),
  barrelRed: new THREE.MeshStandardMaterial({ color: 0xb3312a, roughness: 0.5, metalness: 0.4 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x767c84, roughness: 0.95 }),
  wallFactory: new THREE.MeshStandardMaterial({ color: 0x4d565f, roughness: 0.8, metalness: 0.3 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd7dde3, roughness: 0.15, metalness: 1.0 })
}

export function buildWorld(scene: THREE.Scene): WorldRefs {
  const colliders: AABB[] = []
  const platforms: Platform[] = []
  const ramps: Ramp[] = []
  const barrels: WorldRefs['barrels'] = []
  const animated: ((dt: number, t: number) => void)[] = []

  const box = (parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, collide = false, castShadow = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = castShadow
    parent.add(m)
    if (collide) colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: y + h / 2 })
    return m
  }
  const wallRun = (parent: THREE.Object3D, mat: THREE.Material, x: number, z: number, len: number, h: number, horiz: boolean, gaps: [number, number][] = []) => {
    // build a wall along x (horiz) or z, with gap ranges [from,to] measured from segment start
    const segs: [number, number][] = []
    let cur = -len / 2
    const sorted = [...gaps].sort((a, b) => a[0] - b[0])
    for (const [g0, g1] of sorted) { if (g0 > cur) segs.push([cur, g0]); cur = Math.max(cur, g1) }
    if (cur < len / 2) segs.push([cur, len / 2])
    for (const [s, e] of segs) {
      const l = e - s; if (l <= 0.05) continue
      const mid = (s + e) / 2
      if (horiz) box(parent, mat, x + mid, h / 2, z, l, h, 0.5, true)
      else box(parent, mat, x, h / 2, z + mid, 0.5, h, l, true)
    }
    // lintels above gaps (door height 3.2)
    for (const [g0, g1] of sorted) {
      const l = g1 - g0; if (l <= 0.05) continue
      const mid = (g0 + g1) / 2, hh = h - 3.2
      if (hh <= 0) continue
      if (horiz) box(parent, mat, x + mid, 3.2 + hh / 2, z, l, hh, 0.5, false)
      else box(parent, mat, x, 3.2 + hh / 2, z + mid, 0.5, hh, l, false)
    }
  }

  // ---------- ground with painted roads (same drawing feeds the map) ----------
  const groundTex = canvasTex(1024, 1024, (g, w, h) => {
    const S = w / (WORLD_HALF * 2)
    const px = (x: number) => (x + WORLD_HALF) * S
    g.fillStyle = '#23262b'; g.fillRect(0, 0, w, h) // block base / sidewalk tone
    // blocks (slightly lighter pavement)
    g.fillStyle = '#2b2e34'
    for (const bx of [-150, -50, 50, 150]) for (const bz of [-150, -50, 50, 150])
      g.fillRect(px(bx - 43), px(bz - 43), 86 * S, 86 * S)
    // roads
    g.fillStyle = '#17181c'
    for (const r of ROADS) {
      g.fillRect(px(r - ROAD_W / 2), 0, ROAD_W * S, h)
      g.fillRect(0, px(r - ROAD_W / 2), w, ROAD_W * S)
    }
    // lane dashes
    g.fillStyle = '#9a8f3f'
    for (const r of ROADS) {
      for (let i = -WORLD_HALF; i < WORLD_HALF; i += 12) {
        g.fillRect(px(r) - 1, px(i), 2, 6 * S)
        g.fillRect(px(i), px(r) - 1, 6 * S, 2)
      }
    }
    // canal / edge at south + east
    g.fillStyle = '#0d2033'; g.fillRect(px(243), 0, 57 * S, h); g.fillRect(0, px(243), w, 57 * S)
  })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.94, metalness: 0.05 }))
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true
  scene.add(ground)
  // world edge blockers
  colliders.push({ x0: -302, x1: -298, z0: -300, z1: 300, h: 6 }, { x0: 298, x1: 302, z0: -300, z1: 300, h: 6 },
    { x0: -300, x1: 300, z0: -302, z1: -298, h: 6 }, { x0: -300, x1: 300, z0: 238, z1: 302, h: 6 })

  // ---------- district buildings (instanced) ----------
  const facadeTex = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#22252c'; g.fillRect(0, 0, w, h)
    for (let y = 14; y < h - 10; y += 26) for (let x = 12; x < w - 16; x += 30) {
      const lit = Math.random()
      g.fillStyle = lit > 0.55 ? (lit > 0.85 ? '#ffd98a' : '#9fd4ff') : '#12141a'
      g.fillRect(x, y, 18, 14)
    }
  }, [1, 1])
  const facadeMat = new THREE.MeshStandardMaterial({ map: facadeTex, emissive: 0xffffff, emissiveMap: facadeTex, emissiveIntensity: 0.55, roughness: 0.9 })
  const buildingXforms: THREE.Matrix4[] = []
  const dummy = new THREE.Object3D()
  const poiBlocks = new Set(['-50,-150', '150,50', '-150,50', '-150,-50', '50,150'])
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (const bx of [-150, -50, 50, 150]) for (const bz of [-150, -50, 50, 150]) {
    if (poiBlocks.has(`${bx},${bz}`)) continue
    const n = 3 + Math.floor(rnd() * 2)
    for (let i = 0; i < n; i++) {
      const w = 16 + rnd() * 14, d = 16 + rnd() * 14, hh = 12 + rnd() * 26
      const x = bx - 30 + (i % 2) * 42 + rnd() * 8, z = bz - 28 + Math.floor(i / 2) * 44 + rnd() * 8
      dummy.position.set(x, hh / 2, z); dummy.scale.set(w, hh, d); dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix(); buildingXforms.push(dummy.matrix.clone())
      colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: hh })
    }
  }
  const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), facadeMat, buildingXforms.length)
  buildingXforms.forEach((m, i) => buildings.setMatrixAt(i, m))
  buildings.receiveShadow = true
  scene.add(buildings)

  // skyline billboards beyond fog edge + perimeter glow strips
  const skyTex = signTexture(' ', '#000', 'rgba(0,0,0,0)')
  void skyTex

  // ---------- streetlights (instanced, fake light pools) ----------
  const lightSpots: [number, number][] = []
  for (const rx of ROADS) for (let z = -260; z <= 260; z += 52) if (Math.abs(z - rx) > 12) lightSpots.push([rx + 9, z])
  for (const rz of ROADS) for (let x = -260; x <= 260; x += 52) if (Math.abs(x - rz) > 12) lightSpots.push([x, rz + 9])
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6)
  const poles = new THREE.InstancedMesh(poleGeo, MAT.steelDark, lightSpots.length)
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffc37a, emissive: 0xffa64d, emissiveIntensity: 2.4 })
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.16, 0.3), headMat, lightSpots.length)
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xff9d45, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false })
  const pools = new THREE.InstancedMesh(new THREE.CircleGeometry(5.5, 20), poolMat, lightSpots.length)
  lightSpots.forEach(([x, z], i) => {
    dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1)
    dummy.position.set(x, 2.7, z); dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix)
    dummy.position.set(x, 5.45, z); dummy.updateMatrix(); heads.setMatrixAt(i, dummy.matrix)
    dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.position.set(x, 0.04, z); dummy.updateMatrix(); pools.setMatrixAt(i, dummy.matrix)
    dummy.rotation.set(0, 0, 0)
  })
  scene.add(poles, heads, pools)

  // neon signs for POIs
  const mkSign = (text: string, color: string, x: number, y: number, z: number, w: number, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4),
      new THREE.MeshBasicMaterial({ map: signTexture(text, color), transparent: true }))
    m.position.set(x, y, z); m.rotation.y = rotY; scene.add(m); return m
  }

  // ============================================================ FACTORY
  const F = new THREE.Group(); scene.add(F)
  const fx = FACTORY.cx, fz = FACTORY.cz, fw = FACTORY.w, fd = FACTORY.d, fh = FACTORY.wallH
  const floorTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#3a3f45'; g.fillRect(0, 0, w, h)
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke(); g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke() }
    g.fillStyle = 'rgba(201,162,39,0.5)'
    for (let i = 0; i < w; i += 32) { g.fillRect(i, 6, 16, 6); g.fillRect(i, h - 12, 16, 6) }
  }, [4, 3])
  const ffloor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, metalness: 0.15 }))
  ffloor.rotation.x = -Math.PI / 2; ffloor.rotation.z = Math.PI
  ffloor.position.set(fx, 0.02, fz); ffloor.receiveShadow = true; F.add(ffloor)
  // walls: south door gap centred (-4..4 from centre start offset), spawn doors N/E/W
  wallRun(F, MAT.wallFactory, fx, fz - fd / 2, fw, fh, true, [[-6, -2.5], [20, 23.5]])       // north, 2 spawn vents
  wallRun(F, MAT.wallFactory, fx, fz + fd / 2, fw, fh, true, [[-3, 3]])                      // south main door
  wallRun(F, MAT.wallFactory, fx - fw / 2, fz, fd, fh, false, [[-3, 0.5]])                   // west spawn door
  wallRun(F, MAT.wallFactory, fx + fw / 2, fz, fd, fh, false, [[10, 13.5]])                  // east spawn door
  // roof beams + skylight panels (no shadow casting, interior stays lit by lamps)
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.9, transparent: true, opacity: 0.92 })
  box(F, roofMat, fx, fh + 0.4, fz, fw + 2, 0.3, fd + 2)
  for (let i = -3; i <= 3; i++) box(F, MAT.steelDark, fx + i * 10, fh - 0.4, fz, 0.5, 0.8, fd)
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x87b7d9, transparent: true, opacity: 0.13 })
  for (let i = -2; i <= 2; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(6, fd - 8), skyMat); p.rotation.x = Math.PI / 2; p.position.set(fx + i * 14, fh + 0.2, fz); F.add(p) }
  mkSign('DEAD SHIFT FACTORY', '#ffb454', fx, 6.4, fz + fd / 2 + 0.6, 26)
  const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshBasicMaterial({ map: signTexture('EXIT', '#39ff7a'), transparent: true }))
  exitSign.position.set(fx, 3.8, fz + fd / 2 - 0.4); exitSign.rotation.y = Math.PI; F.add(exitSign)

  // pillars (instanced look via loop of merged-ish boxes, colliders)
  for (const pxo of [-24, 0, 24]) for (const pzo of [-16, 8]) box(F, MAT.steel, fx + pxo, fh / 2, fz + pzo, 1.1, fh, 1.1, true)
  // machines
  const machineSpots: [number, number, number][] = [[-26, -6, 0], [-14, 14, 1], [10, -12, 0], [24, 12, 1], [2, 18, 0], [-30, 18, 1], [18, -20, 0], [-8, -20, 1]]
  for (const [mx, mz, v] of machineSpots) {
    const m = box(F, v ? MAT.machine2 : MAT.machine, fx + mx, 1.3, fz + mz, 5.5, 2.6, 3.2, true, true)
    box(F, MAT.steelDark, fx + mx, 2.9, fz + mz, 4.6, 0.6, 2.4)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff5545 }))
    lamp.position.set(fx + mx, 3.35, fz + mz); F.add(lamp)
    void m
  }
  // conveyor
  box(F, MAT.steelDark, fx - 2, 0.9, fz + 2, 20, 0.5, 2.2, true)
  for (let i = -4; i <= 4; i++) box(F, MAT.steel, fx - 2 + i * 2.2, 0.45, fz + 2, 0.3, 0.9, 2.2)
  // forklift (simple, static)
  const fork = new THREE.Group(); fork.position.set(fx + 28, 0, fz - 6); fork.rotation.y = -0.5; F.add(fork)
  box(fork, MAT.hazard, 0, 0.65, 0, 2.6, 0.9, 1.5, false)
  box(fork, MAT.steelDark, -0.9, 1.7, 0, 0.25, 2.4, 1.5)
  box(fork, MAT.steelDark, 1.15, 1.3, 0, 0.2, 2.6, 0.14); box(fork, MAT.steelDark, 1.15, 1.3, 0.6, 0.2, 2.6, 0.14)
  colliders.push({ x0: fx + 26.4, x1: fx + 29.6, z0: fz - 7.2, z1: fz - 4.8, h: 2 })
  // crates (instanced)
  const cratePos: [number, number, number][] = []
  const crateSpots: [number, number][] = [[-34, -22], [-34, -20], [-33, -21], [34, 20], [33, 21], [-18, -2], [14, 4], [30, -20], [-36, 10], [8, -24], [-24, 24], [36, -2]]
  for (const [cx, cz] of crateSpots) { cratePos.push([fx + cx, 0.65, fz + cz]); if (Math.random() > 0.4) cratePos.push([fx + cx, 1.95, fz + cz]) }
  const crates = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), MAT.crate, cratePos.length)
  cratePos.forEach((p, i) => { dummy.position.set(p[0], p[1], p[2]); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, (i % 5) * 0.13, 0); dummy.updateMatrix(); crates.setMatrixAt(i, dummy.matrix) })
  crates.castShadow = true; crates.receiveShadow = true; F.add(crates)
  for (const [cx, cz] of crateSpots) colliders.push({ x0: fx + cx - 0.8, x1: fx + cx + 0.8, z0: fz + cz - 0.8, z1: fz + cz + 0.8, h: 2.6 })
  // pipes along west wall
  for (let i = 0; i < 3; i++) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.28 - i * 0.05, 0.28 - i * 0.05, fd - 6, 10), MAT.steel)
    pipe.rotation.x = Math.PI / 2; pipe.position.set(fx - fw / 2 + 1 + i * 0.65, 5.4 + i * 0.55, fz); F.add(pipe)
  }
  // mezzanine (north) + stairs
  const mezY = 3.1, mezZ0 = fz - fd / 2 + 0.5, mezZ1 = fz - fd / 2 + 8.5
  const mez = box(F, MAT.steelDark, fx, mezY - 0.15, (mezZ0 + mezZ1) / 2, fw - 4, 0.3, mezZ1 - mezZ0)
  mez.receiveShadow = true
  platforms.push({ x0: fx - fw / 2 + 2, x1: fx + fw / 2 - 2, z0: mezZ0, z1: mezZ1, y: mezY })
  ramps.push({ x0: fx - fw / 2 + 2, x1: fx - fw / 2 + 12, z0: mezZ0, z1: mezZ1, yHigh: mezY, highAt: 'x0' })
  ramps.push({ x0: fx + fw / 2 - 12, x1: fx + fw / 2 - 2, z0: mezZ0, z1: mezZ1, yHigh: mezY, highAt: 'x1' })
  for (let i = 0; i < 9; i++) { // railing posts + rail
    box(F, MAT.steel, fx - fw / 2 + 4 + i * 8.5, mezY + 0.55, mezZ1 - 0.2, 0.12, 1.1, 0.12)
  }
  box(F, MAT.steel, fx, mezY + 1.12, mezZ1 - 0.2, fw - 4, 0.1, 0.1)
  // office at south-east interior
  box(F, MAT.concrete, fx + 28, 1.5, fz + 22, 14, 3, 0.4, true)
  box(F, MAT.concrete, fx + 21.2, 1.5, fz + 18, 0.4, 3, 8, true)
  // factory work lights (real points, few)
  const lampPts: [number, number][] = [[-24, -10], [0, 10], [24, -8], [0, -22]]
  for (const [lx, lz] of lampPts) {
    const pl = new THREE.PointLight(0xffa64d, 95, 38, 1.8)
    pl.position.set(fx + lx, 6.8, fz + lz); F.add(pl)
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.5), new THREE.MeshBasicMaterial({ color: 0xffc37a }))
    bulb.position.set(fx + lx, 7.6, fz + lz); F.add(bulb)
  }
  const cool = new THREE.PointLight(0x7fc4de, 80, 46, 1.7); cool.position.set(fx, 7.5, fz); F.add(cool)
  // spawn doors glow
  const spawnDoors = [
    new THREE.Vector3(fx - 4, 0, fz - fd / 2 + 1.5), new THREE.Vector3(fx + 21.5, 0, fz - fd / 2 + 1.5),
    new THREE.Vector3(fx - fw / 2 + 1.5, 0, fz - 1), new THREE.Vector3(fx + fw / 2 - 1.5, 0, fz + 11.5)
  ]
  for (const sd of spawnDoors) {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.2), new THREE.MeshBasicMaterial({ color: 0x881111, transparent: true, opacity: 0.55 }))
    glow.position.set(sd.x, 1.6, sd.z); F.add(glow)
  }
  // explosive barrels
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.35, 12)
  for (const [bx, bz] of [[-20, 8], [16, 16], [30, -14], [-32, -14], [4, -14], [-12, 22]] as [number, number][]) {
    const b = new THREE.Mesh(barrelGeo, MAT.barrelRed)
    b.position.set(fx + bx, 0.68, fz + bz); b.castShadow = true; F.add(b)
    barrels.push({ mesh: b, pos: b.position.clone(), alive: true })
    colliders.push({ x0: fx + bx - 0.55, x1: fx + bx + 0.55, z0: fz + bz - 0.55, z1: fz + bz + 0.55, h: 1.35 })
  }
  // wall-buy + stations visuals
  const wb = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.6), new THREE.MeshBasicMaterial({ map: signTexture('WALL BUYS — GUNS / AMMO / HEALTH', '#7ee787'), transparent: true }))
  wb.position.set(fx - 14, 2.2, fz + fd / 2 - 0.35); wb.rotation.y = Math.PI; F.add(wb)

  // ============================================================ CLUB
  const C = new THREE.Group(); scene.add(C)
  const cx = CLUB.cx, cz = CLUB.cz, cw = CLUB.w, cd = CLUB.d, ch = 5.2
  const clubFloorMat = new THREE.MeshStandardMaterial({ color: 0x17121c, roughness: 0.35, metalness: 0.4 })
  const cf = new THREE.Mesh(new THREE.PlaneGeometry(cw, cd), clubFloorMat)
  cf.rotation.x = -Math.PI / 2; cf.rotation.z = Math.PI; cf.position.set(cx, 0.03, cz); cf.receiveShadow = true; C.add(cf)
  const clubWall = new THREE.MeshStandardMaterial({ color: 0x241a2e, roughness: 0.85 })
  wallRun(C, clubWall, cx, cz - cd / 2, cw, ch, true)
  wallRun(C, clubWall, cx, cz + cd / 2, cw, ch, true)
  wallRun(C, clubWall, cx - cw / 2, cz, cd, ch, false, [[-2.2, 2.2]]) // west door
  wallRun(C, clubWall, cx + cw / 2, cz, cd, ch, false)
  box(C, MAT.steelDark, cx, ch + 0.2, cz, cw + 1, 0.3, cd + 1)
  mkSign('VELVET ROOM', '#ff4fd8', cx - cw / 2 - 0.7, 3.6, cz, 15, -Math.PI / 2)
  // stage (east end) + poles
  box(C, new THREE.MeshStandardMaterial({ color: 0x2c1836, roughness: 0.4 }), cx + 12, 0.4, cz, 10, 0.8, 16)
  platforms.push({ x0: cx + 7, x1: cx + 17, z0: cz - 8, z1: cz + 8, y: 0.8 })
  const clubDancerSpots: WorldRefs['clubDancerSpots'] = [
    { x: cx + 12, z: cz - 3.5, pole: true }, { x: cx + 12, z: cz + 3.5, pole: true }, { x: cx + 12, z: cz, pole: false }
  ]
  for (const s of clubDancerSpots) if (s.pole) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.4, 8), MAT.chrome)
    pole.position.set(s.x, 0.8 + 2.2, s.z); C.add(pole)
  }
  // bar (west wall interior)
  box(C, MAT.steelDark, cx - 15.5, 0.55, cz, 2.2, 1.1, 18, true)
  for (let i = 0; i < 8; i++) {
    const bottle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22),
      new THREE.MeshStandardMaterial({ color: [0x37d67a, 0xffb454, 0x58c7ff, 0xff4f6d][i % 4], emissive: [0x37d67a, 0xffb454, 0x58c7ff, 0xff4f6d][i % 4], emissiveIntensity: 0.7 }))
    bottle.position.set(cx - 17.8, 1.5, cz - 7 + i * 2); C.add(bottle)
  }
  box(C, MAT.steelDark, cx - 18.2, 1.05, cz, 0.6, 0.12, 20)
  // booths along south wall
  const clubBooths: WorldRefs['clubBooths'] = []
  for (let i = 0; i < 4; i++) {
    const bx = cx - 9 + i * 6.5, bz = cz + cd / 2 - 2.6
    clubBooths.push({ x: bx, z: bz })
    box(C, new THREE.MeshStandardMaterial({ color: 0x3a1030, roughness: 0.9 }), bx, 1.1, bz + 1.4, 5.4, 2.2, 0.3, true)
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.4), new THREE.MeshStandardMaterial({ color: 0x7a1145, roughness: 1, side: THREE.DoubleSide }))
    curtain.position.set(bx, 1.3, bz - 1.2); C.add(curtain)
    const seat = box(C, new THREE.MeshStandardMaterial({ color: 0x51162e, roughness: 0.8 }), bx, 0.35, bz + 0.7, 3.6, 0.7, 1.1, true)
    seat.name = 'boothSeat'
  }
  // neon strips + spotlights + cones + mirror ball
  const neonM = new THREE.MeshBasicMaterial({ color: 0xff4fd8 })
  const neonC = new THREE.MeshBasicMaterial({ color: 0x38e8ff })
  box(C, neonM, cx, 4.4, cz - cd / 2 + 0.3, cw - 2, 0.12, 0.12)
  box(C, neonC, cx, 4.4, cz + cd / 2 - 0.3, cw - 2, 0.12, 0.12)
  box(C, neonM, cx + cw / 2 - 0.3, 4.4, cz, 0.12, 0.12, cd - 2)
  const spot1 = new THREE.SpotLight(0xff4fd8, 220, 30, 0.6, 0.5); spot1.position.set(cx + 12, 5, cz - 6); spot1.target.position.set(cx + 12, 0.8, cz - 3); C.add(spot1, spot1.target)
  const spot2 = new THREE.SpotLight(0x38e8ff, 220, 30, 0.6, 0.5); spot2.position.set(cx + 12, 5, cz + 6); spot2.target.position.set(cx + 12, 0.8, cz + 3); C.add(spot2, spot2.target)
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  const cones: THREE.Mesh[] = []
  for (const [sx, sz, col] of [[cx + 12, cz - 6, 0xff4fd8], [cx + 12, cz + 6, 0x38e8ff]] as [number, number, number][]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.4, 5, 20, 1, true), coneMat.clone())
    ;(cone.material as THREE.MeshBasicMaterial).color.setHex(col)
    cone.position.set(sx, 2.6, sz); C.add(cone); cones.push(cone)
  }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), MAT.chrome)
  ball.position.set(cx + 2, 4.3, cz); C.add(ball)
  // DJ booth
  box(C, MAT.steelDark, cx + 16.5, 0.7, cz - 11, 3, 1.4, 4, true)
  // tip rail
  box(C, MAT.chrome, cx + 6.6, 0.95, cz, 0.12, 0.08, 15)

  // ============================================================ GUN SHOP + CLINIC + GARAGE
  const shopWall = new THREE.MeshStandardMaterial({ color: 0x39424a, roughness: 0.85 })
  for (const [bc, bw2, bd2, doorSide] of [[SHOP, SHOP.w, SHOP.d, 1], [CLINIC, CLINIC.w, CLINIC.d, 1]] as const) {
    const g = new THREE.Group(); scene.add(g)
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(bw2, bd2), new THREE.MeshStandardMaterial({ color: 0x30353b, roughness: 0.9 }))
    fl.rotation.x = -Math.PI / 2; fl.rotation.z = Math.PI; fl.position.set(bc.cx, 0.025, bc.cz); fl.receiveShadow = true; g.add(fl)
    wallRun(g, shopWall, bc.cx, bc.cz - bd2 / 2, bw2, 4.2, true)
    wallRun(g, shopWall, bc.cx, bc.cz + bd2 / 2, bw2, 4.2, true)
    wallRun(g, shopWall, bc.cx - bw2 / 2, bc.cz, bd2, 4.2, false)
    wallRun(g, shopWall, bc.cx + bw2 / 2 * doorSide, bc.cz, bd2, 4.2, false, [[-1.8, 1.8]])
    box(g, MAT.steelDark, bc.cx, 4.4, bc.cz, bw2 + 1, 0.3, bd2 + 1)
    box(g, MAT.steelDark, bc.cx, 0.55, bc.cz + 2, bw2 - 6, 1.1, 1.6, true) // counter
  }
  mkSign('GUNS & AMMO', '#7ee787', SHOP.cx + SHOP.w / 2 + 0.7, 3.2, SHOP.cz, 12, Math.PI / 2)
  mkSign('CLINIC +', '#58c7ff', CLINIC.cx + CLINIC.w / 2 + 0.7, 3.2, CLINIC.cz, 12, Math.PI / 2)
  // gun racks in shop
  for (let i = 0; i < 5; i++) box(scene, MAT.steelDark, SHOP.cx - 4 + i * 2, 1.7, SHOP.cz - SHOP.d / 2 + 0.6, 1.1, 0.28, 0.5)
  // garage block (decor)
  box(scene, MAT.concrete, 50, 5, 150, 30, 10, 22, true)
  mkSign('DEPOT GARAGE', '#c9d1d9', 50, 7, 150 - 11.6, 14, Math.PI)

  // ============================================================ traffic / peds / parking data
  const lane = 3.6
  const loop = (r: number) => [
    new THREE.Vector3(-r + lane, 0, -r - lane), new THREE.Vector3(r + lane, 0, -r - lane),
    new THREE.Vector3(r + lane, 0, r + lane), new THREE.Vector3(-r + lane, 0, r + lane)
  ]
  const trafficLoops = [loop(100), loop(200), loop(50).reverse()]
  const sidewalkNodes: THREE.Vector3[] = []
  for (const rx of ROADS) for (const rz of ROADS)
    for (const [ox, oz] of [[10, 10], [10, -10], [-10, 10], [-10, -10]])
      sidewalkNodes.push(new THREE.Vector3(rx + ox, 0, rz + oz))
  const parkedSpots: WorldRefs['parkedSpots'] = [
    { x: 142, z: 32, rotY: Math.PI / 2, kind: 'sports' }, { x: 142, z: 40, rotY: Math.PI / 2, kind: 'sedan' },
    { x: 142, z: 68, rotY: Math.PI / 2, kind: 'sedan' }, { x: 158, z: 32, rotY: -Math.PI / 2, kind: 'van' },
    { x: -20, z: -108, rotY: 0, kind: 'van' }, { x: -72, z: -108, rotY: 0, kind: 'sedan' }, { x: -86, z: -160, rotY: Math.PI / 2, kind: 'sports' },
    { x: -138, z: 38, rotY: Math.PI / 2, kind: 'sedan' }, { x: -138, z: -38, rotY: Math.PI / 2, kind: 'sedan' },
    { x: 8, z: 92, rotY: 0, kind: 'sedan' }, { x: 62, z: 108, rotY: Math.PI, kind: 'sports' },
    { x: -108, z: -30, rotY: Math.PI / 2, kind: 'van' }, { x: 108, z: 24, rotY: -Math.PI / 2, kind: 'sedan' },
    { x: 40, z: -92, rotY: 0, kind: 'sedan' }, { x: -40, z: 208, rotY: Math.PI, kind: 'van' },
    { x: 208, z: -40, rotY: Math.PI / 2, kind: 'sports' }, { x: -208, z: 60, rotY: -Math.PI / 2, kind: 'sedan' },
    { x: 92, z: -160, rotY: 0, kind: 'sedan' }
  ]

  // collectibles: neon orbs around the district
  const collectibles: THREE.Mesh[] = []
  const orbGeo = new THREE.OctahedronGeometry(0.42)
  const orbMat = new THREE.MeshStandardMaterial({ color: 0x38e8ff, emissive: 0x38e8ff, emissiveIntensity: 1.6, roughness: 0.3 })
  const orbSpots: [number, number][] = [[-10, -90], [110, -10], [-110, 110], [60, -60], [-60, 160], [160, -110], [-160, -160], [210, 110], [10, 210], [-210, -10], [90, 90], [-90, -190], [190, 190], [30, -210], [-30, 30], [130, 130], [-130, -90], [70, 170], [-170, 170], [230, -60]]
  for (const [ox, oz] of orbSpots) {
    const o = new THREE.Mesh(orbGeo, orbMat); o.position.set(ox, 1.2, oz); scene.add(o); collectibles.push(o)
  }

  const clubPlayerSeat = { x: CLUB.cx - 3, z: CLUB.cz + CLUB.d / 2 - 3.3 }
  const update = (dt: number, t: number) => {
    ball.rotation.y += dt * 0.7
    cones.forEach((c, i) => { (c.material as THREE.MeshBasicMaterial).opacity = 0.018 + 0.014 * (0.5 + 0.5 * Math.sin(t * 2.2 + i * 2)) })
    for (const o of collectibles) if (o.visible) { o.rotation.y += dt * 1.6; o.position.y = 1.2 + Math.sin(t * 2 + o.position.x) * 0.18 }
  }

  return {
    colliders, platforms, ramps, barrels, collectibles, spawnDoors, trafficLoops, sidewalkNodes, parkedSpots,
    clubDancerSpots, clubBooths, clubPlayerSeat, update
  }
}

// ground height from platforms/ramps (player + dancers stage etc.)
export function groundHeightAt(refs: { platforms: Platform[]; ramps: Ramp[] }, x: number, z: number, curY: number): number {
  let y = 0
  for (const p of refs.platforms) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && curY >= p.y - 1.0) y = Math.max(y, p.y)
  for (const r of refs.ramps) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
    const t = r.highAt === 'x0' ? 1 - (x - r.x0) / (r.x1 - r.x0) : (x - r.x0) / (r.x1 - r.x0)
    y = Math.max(y, r.yHigh * THREE.MathUtils.clamp(t, 0, 1))
  }
  return y
}

export function collideAABB(colliders: AABB[], pos: THREE.Vector3, radius: number, feetY: number) {
  for (const c of colliders) {
    if (feetY > c.h - 0.25) continue
    if (pos.x > c.x0 - radius && pos.x < c.x1 + radius && pos.z > c.z0 - radius && pos.z < c.z1 + radius) {
      const dxl = pos.x - (c.x0 - radius), dxr = (c.x1 + radius) - pos.x
      const dzl = pos.z - (c.z0 - radius), dzr = (c.z1 + radius) - pos.z
      const m = Math.min(dxl, dxr, dzl, dzr)
      if (m === dxl) pos.x = c.x0 - radius
      else if (m === dxr) pos.x = c.x1 + radius
      else if (m === dzl) pos.z = c.z0 - radius
      else pos.z = c.z1 + radius
    }
  }
}

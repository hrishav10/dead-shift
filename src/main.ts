import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import './style.css'
import { AudioEngine } from './audio'
import { WEAPONS, weaponById, falloff, ZOMBIE_TYPES, waveCount, waveHpMult, waveSpeedMult, spawnInterval, waveClearBonus, zombieTypeFor, CAR_SPECS, steerAtSpeed, runOverDamage, astar, fmtCash } from './data'
import { buildWorld, collideAABB, groundHeightAt, POIS, ROADS, FACTORY, CLUB, SHOP, CLINIC, signTexture, WorldRefs } from './world'
import { makeHumanoid, animateHumanoid, makeCar, Humanoid, CarMesh, Pose } from './entities'

const $ = (id: string) => document.getElementById(id)!
const clamp = THREE.MathUtils.clamp
const rand = (a: number, b: number) => a + Math.random() * (b - a)

// ---------------- settings & save ----------------
export interface Settings { sens: number; invertY: boolean; fov: number; quality: string; difficulty: string; volMaster: number; volMusic: number; volSfx: number; volUi: number; mute: boolean; subtitles: boolean; headbob: boolean; vignette: number; reduceClub: boolean; crouchToggle: boolean }
const DEF_SETTINGS: Settings = { sens: 1.0, invertY: false, fov: 80, quality: 'auto', difficulty: 'normal', volMaster: 0.8, volMusic: 0.7, volSfx: 0.9, volUi: 0.8, mute: false, subtitles: true, headbob: true, vignette: 0.8, reduceClub: false, crouchToggle: false }
let settings: Settings = { ...DEF_SETTINGS }
try { settings = { ...DEF_SETTINGS, ...JSON.parse(localStorage.getItem('deadshift-settings') || '{}') } } catch {}
const persistSettings = () => localStorage.setItem('deadshift-settings', JSON.stringify(settings))

interface Save { cash: number; score: number; owned: string[]; bestWave: number; bestScore: number; orbs: number[]; dancerContact: boolean; visitedClub: boolean; droveCar: boolean; boughtWeapon: boolean }
const DEF_SAVE: Save = { cash: 500, score: 0, owned: ['pistol'], bestWave: 0, bestScore: 0, orbs: [], dancerContact: false, visitedClub: false, droveCar: false, boughtWeapon: false }
let save: Save = { ...DEF_SAVE }
let hasSave = false
try { const s = localStorage.getItem('deadshift-save'); if (s) { save = { ...DEF_SAVE, ...JSON.parse(s) }; hasSave = true } } catch {}
const persistSave = () => { localStorage.setItem('deadshift-save', JSON.stringify(save)); hasSave = true }

// ---------------- audio ----------------
const audio = new AudioEngine()
const applyAudio = () => { audio.settings = { master: settings.volMaster, music: settings.volMusic, sfx: settings.volSfx, ui: settings.volUi, muted: settings.mute }; audio.applySettings() }
applyAudio()

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.domElement.className = 'game'
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.12
$('app').appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x070a12)
scene.fog = new THREE.FogExp2(0x0a0e16, 0.0048)
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.35

const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.08, 900)
camera.position.set(0, 30, 120)

const moon = new THREE.DirectionalLight(0x9db8dd, 1.1)
moon.position.set(60, 90, -40); moon.castShadow = true
moon.shadow.mapSize.set(1024, 1024)
moon.shadow.camera.left = -45; moon.shadow.camera.right = 45; moon.shadow.camera.top = 45; moon.shadow.camera.bottom = -45
moon.shadow.camera.far = 260; moon.shadow.bias = -0.0006
scene.add(moon, moon.target)
scene.add(new THREE.HemisphereLight(0x3d4f6e, 0x0c0e12, 0.85))
// stars + moon disc
{
  const n = 700, pos = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, e = Math.random() * 0.9 + 0.08, r = 700; pos[i * 3] = Math.cos(a) * Math.cos(e) * r; pos[i * 3 + 1] = Math.sin(e) * r; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xaFC4de, size: 1.6, sizeAttenuation: false, fog: false })))
  const md = new THREE.Mesh(new THREE.CircleGeometry(22, 24), new THREE.MeshBasicMaterial({ color: 0xdfe9f5, fog: false }))
  md.position.set(280, 330, -420); md.lookAt(0, 0, 0); scene.add(md)
}

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.6, 0.85)
composer.addPass(bloom)
composer.addPass(new OutputPass())
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight)
})

const world: WorldRefs = buildWorld(scene)
// hide collected orbs from a previous save
world.collectibles.forEach((o, i) => { if (save.orbs.includes(i)) o.visible = false })

// collision + factory A* grid
const colliders = world.colliders
const GRID = { x0: -90, z0: -180, cell: 2, cols: 42, rows: 30 }
const gridBlocked = new Uint8Array(GRID.cols * GRID.rows)
for (let cz = 0; cz < GRID.rows; cz++) for (let cx = 0; cx < GRID.cols; cx++) {
  const wx = GRID.x0 + (cx + 0.5) * GRID.cell, wz = GRID.z0 + (cz + 0.5) * GRID.cell
  for (const c of colliders) if (wx > c.x0 - 0.5 && wx < c.x1 + 0.5 && wz > c.z0 - 0.5 && wz < c.z1 + 0.5 && c.h > 0.9 && c.h < 8) { gridBlocked[cz * GRID.cols + cx] = 1; break }
}
const toCell = (x: number, z: number) => ({ x: clamp(Math.floor((x - GRID.x0) / GRID.cell), 0, GRID.cols - 1), z: clamp(Math.floor((z - GRID.z0) / GRID.cell), 0, GRID.rows - 1) })
const cellCenter = (c: { x: number; z: number }) => new THREE.Vector3(GRID.x0 + (c.x + 0.5) * GRID.cell, 0, GRID.z0 + (c.z + 0.5) * GRID.cell)

// ---------------- game state ----------------
type GState = 'loading' | 'menu' | 'playing' | 'paused' | 'gameover'
let gstate: GState = 'loading'
let mode: 'roam' | 'waves' = 'roam'
let phoneOpen = false, mapOpen = false, settingsFrom: 'menu' | 'pause' = 'menu'
let timeScale = 1
const clockT = new THREE.Clock()
let elapsed = 0

const player = {
  pos: new THREE.Vector3(-50, 0, -100), vel: new THREE.Vector3(), yaw: Math.PI, pitch: 0,
  hp: 100, stamina: 100, onGround: true, crouch: false, ads: false,
  lastDamageT: -99, bobPhase: 0, radius: 0.42, dead: false
}
let stats = { kills: 0, headshots: 0, shots: 0, hits: 0, earned: 0 }
const ledger: { desc: string; amt: number; t: number }[] = []
function earn(n: number, desc: string) {
  const mult = settings.difficulty === 'hard' ? 1.25 : 1
  const v = Math.round(n * (desc === 'Wave pay' || desc === 'Kill' || desc === 'Headshot kill' || desc === 'Wave clear' ? mult : 1))
  save.cash += v; if (v > 0) stats.earned += v
  ledger.unshift({ desc, amt: v, t: Date.now() }); if (ledger.length > 30) ledger.pop()
  if (v >= 40) audio.cash()
  updateCashHud()
}
function spend(n: number, desc: string): boolean {
  if (save.cash < n) { audio.denied(); toast(`Not enough cash — need ${fmtCash(n)}`); return false }
  save.cash -= n; ledger.unshift({ desc, amt: -n, t: Date.now() }); updateCashHud(); return true
}

// zones
const inRect = (x: number, z: number, cx: number, cz: number, w: number, d: number, pad = 0) =>
  Math.abs(x - cx) < w / 2 + pad && Math.abs(z - cz) < d / 2 + pad
const zoneAt = (x: number, z: number) =>
  inRect(x, z, FACTORY.cx, FACTORY.cz, FACTORY.w, FACTORY.d) ? 'factory' :
  inRect(x, z, CLUB.cx, CLUB.cz, CLUB.w, CLUB.d) ? 'club' :
  inRect(x, z, SHOP.cx, SHOP.cz, SHOP.w, SHOP.d) ? 'guns' :
  inRect(x, z, CLINIC.cx, CLINIC.cz, CLINIC.w, CLINIC.d) ? 'clinic' : 'street'
let curZone = 'street'

// ---------------- weapons ----------------
interface WState { mag: number; reserve: number }
const wstate: Record<string, WState> = {}
for (const w of WEAPONS) wstate[w.id] = { mag: w.mag, reserve: w.reserve === Infinity ? Infinity : Math.floor(w.reserve * 0.6) }
let curWeapon = 'pistol'
let fireCd = 0, swapT = 0, reloadT = -1, reloadDur = 0, reloadCredited = false, meleeT = 0
let saleActive = false
const priceOf = (id: string) => Math.round(weaponById(id).price * (saleActive ? 0.8 : 1))

// viewmodel
const vm = new THREE.Group(); camera.add(vm); scene.add(camera)
vm.position.set(0.26, -0.24, -0.5)
const vmGuns = new Map<string, THREE.Group>()
function buildViewmodels() {
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.4, metalness: 0.75 })
  const grip = new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: 0.85 })
  const accent = new THREE.MeshStandardMaterial({ color: 0x8a929c, roughness: 0.3, metalness: 0.9 })
  const mk = (parts: [number, number, number, number, number, number, THREE.Material?][]) => {
    const g = new THREE.Group()
    for (const [x, y, z, w, h, d, m] of parts) { const mm = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || dark); mm.position.set(x, y, z); g.add(mm) }
    return g
  }
  vmGuns.set('pistol', mk([[0, 0, -0.1, 0.07, 0.1, 0.34], [0, -0.09, 0.02, 0.06, 0.12, 0.09, grip], [0, 0.07, -0.24, 0.02, 0.04, 0.02, accent]]))
  vmGuns.set('smg', mk([[0, 0, -0.16, 0.07, 0.11, 0.48], [0, -0.11, -0.05, 0.055, 0.16, 0.07, grip], [0, 0.09, -0.1, 0.05, 0.05, 0.2, accent], [0, -0.02, 0.16, 0.06, 0.08, 0.14, grip]]))
  vmGuns.set('ar', mk([[0, 0, -0.24, 0.075, 0.11, 0.66], [0, -0.12, -0.08, 0.055, 0.17, 0.08, grip], [0, 0.1, -0.28, 0.045, 0.07, 0.26, accent], [0, 0.02, 0.28, 0.07, 0.09, 0.2, grip], [0, 0.115, -0.52, 0.018, 0.05, 0.018, accent]]))
  vmGuns.set('shotgun', mk([[0, 0.01, -0.3, 0.08, 0.1, 0.6, grip], [0, -0.045, -0.28, 0.055, 0.05, 0.34, dark], [0, -0.1, 0.05, 0.065, 0.12, 0.1, grip]]))
  vmGuns.set('sniper', mk([[0, 0, -0.34, 0.07, 0.1, 0.8], [0, 0.1, -0.22, 0.06, 0.07, 0.3, dark], [0, -0.11, -0.02, 0.055, 0.15, 0.08, grip], [0, 0.02, 0.3, 0.065, 0.08, 0.22, grip]]))
  for (const [id, g] of vmGuns) { g.visible = id === curWeapon; vm.add(g) }
  // hands
  const handMat = new THREE.MeshStandardMaterial({ color: 0xc9995c, roughness: 0.8 })
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.12), handMat)
  hand.position.set(0, -0.1, -0.05); vm.add(hand)
}
buildViewmodels()
const muzzleFlash = new THREE.PointLight(0xffc37a, 0, 13, 1.8); scene.add(muzzleFlash)
const flashSprite = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
vm.add(flashSprite); flashSprite.position.set(0, 0.02, -0.85)
let flashT = 0
const muzzleWorld = () => { const v = new THREE.Vector3(0, 0.02, -0.85); flashSprite.localToWorld(v); return v }

// tracers / sparks / blood pools
interface PLine { line: THREE.Line; life: number }
const tracers: PLine[] = []
for (let i = 0; i < 24; i++) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0 }))
  line.visible = false; scene.add(line); tracers.push({ line, life: 0 })
}
function fireTracer(a: THREE.Vector3, b: THREE.Vector3) {
  const t = tracers.find(t => t.life <= 0) || tracers[0]
  const p = t.line.geometry.getAttribute('position') as THREE.BufferAttribute
  p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true
  t.line.visible = true; (t.line.material as THREE.LineBasicMaterial).opacity = 0.85; t.life = 0.08
}
interface Particle { pos: THREE.Vector3; vel: THREE.Vector3; life: number; maxLife: number }
const P_COUNT = 260
const pGeo = new THREE.BufferGeometry()
const pPos = new Float32Array(P_COUNT * 3); const pCol = new Float32Array(P_COUNT * 3)
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3))
const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95 }))
points.frustumCulled = false; scene.add(points)
const particles: Particle[] = Array.from({ length: P_COUNT }, () => ({ pos: new THREE.Vector3(0, -50, 0), vel: new THREE.Vector3(), life: 0, maxLife: 1 }))
let pIdx = 0
function burst(at: THREE.Vector3, color: THREE.Color, n: number, speed = 2.4, life = 0.45, up = 1) {
  for (let i = 0; i < n; i++) {
    const p = particles[pIdx]; pIdx = (pIdx + 1) % P_COUNT
    p.pos.copy(at); p.vel.set(rand(-1, 1), rand(0, up), rand(-1, 1)).normalize().multiplyScalar(rand(0.3, 1) * speed)
    p.life = p.maxLife = life * rand(0.6, 1.2)
    const pa = pGeo.getAttribute('position') as THREE.BufferAttribute; const pc = pGeo.getAttribute('color') as THREE.BufferAttribute
    const idx = particles.indexOf(p)
    pc.setXYZ(idx, color.r, color.g, color.b)
  }
}
const COL_BLOOD = new THREE.Color(0xa01818), COL_SPARK = new THREE.Color(0xffc37a), COL_DUST = new THREE.Color(0x8b93a0), COL_GREEN = new THREE.Color(0x6dc24a)

// ---------------- stations / interactables ----------------
interface Interactable { x: number; z: number; r: number; prompt: () => string | null; use: () => void; hold?: boolean; zone?: string }
const interactables: Interactable[] = []
function addSign(text: string, color: string, x: number, y: number, z: number, w: number, rotY: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: signTexture(text, color), transparent: true }))
  m.position.set(x, y, z); m.rotation.y = rotY; scene.add(m); return m
}
{ // factory stations along south wall interior
  const fzIn = FACTORY.cz + FACTORY.d / 2 - 1.1
  WEAPONS.slice(1).forEach((w, i) => {
    const x = FACTORY.cx - 30 + i * 9
    addSign(w.name.toUpperCase() + ' ' + fmtCash(w.price), '#7ee787', x, 2.4, fzIn + 0.35, 7, Math.PI)
    interactables.push({ x, z: fzIn, r: 2.4, zone: 'factory', prompt: () => save.owned.includes(w.id) ? null : `Buy ${w.name} — ${fmtCash(priceOf(w.id))}`, use: () => buyWeapon(w.id) })
  })
  addSign('AMMO $60', '#ffd54f', FACTORY.cx + 12, 2.4, fzIn + 0.35, 6, Math.PI)
  interactables.push({ x: FACTORY.cx + 12, z: fzIn, r: 2.4, zone: 'factory', prompt: () => 'Refill ammo — $60', use: () => { if (spend(60, 'Ammo refill')) { refillAmmo(1); audio.buy(); subtitle('Ammo refilled.') } } })
  addSign('HEALTH $50', '#ff8a7a', FACTORY.cx + 21, 2.4, fzIn + 0.35, 6, Math.PI)
  interactables.push({ x: FACTORY.cx + 21, z: fzIn, r: 2.4, zone: 'factory', prompt: () => player.hp >= 100 ? null : 'Full heal — $50', use: () => { if (spend(50, 'Health station')) { heal(100); audio.buy() } } })
  // factory console in office
  addSign('WAVE CONSOLE', '#ffb454', FACTORY.cx + 28, 2.6, FACTORY.cz + 20, 6, Math.PI)
  interactables.push({ x: FACTORY.cx + 28, z: FACTORY.cz + 20.5, r: 2.6, zone: 'factory', prompt: () => waveState === 'idle' ? 'Start Zombie Waves' : waveState === 'intermission' ? 'Start next wave now' : null, use: () => startNextWave() })
}
{ // gun shop racks
  WEAPONS.slice(1).forEach((w, i) => {
    const x = SHOP.cx - 4 + i * 2
    interactables.push({ x, z: SHOP.cz - SHOP.d / 2 + 1.6, r: 2.0, zone: 'guns', prompt: () => save.owned.includes(w.id) ? `${w.name} — owned` : `Buy ${w.name} — ${fmtCash(priceOf(w.id))}`, use: () => { if (!save.owned.includes(w.id)) buyWeapon(w.id) } })
  })
  interactables.push({ x: SHOP.cx, z: SHOP.cz + 2, r: 2.6, zone: 'guns', prompt: () => 'Ammo refill — $60', use: () => { if (spend(60, 'Ammo (shop)')) { refillAmmo(1); audio.buy(); subtitle('Shopkeeper: Pleasure doing business.') } } })
  interactables.push({ x: CLINIC.cx, z: CLINIC.cz + 2, r: 2.8, zone: 'clinic', prompt: () => player.hp >= 100 ? 'Clinic — you are fully healed (progress saved)' : 'Clinic heal — $50 (also saves progress)', use: () => { if (player.hp < 100) { if (!spend(50, 'Clinic heal')) return; heal(100) } persistSave(); audio.buy(); subtitle('Clinic: All patched up. Progress saved.') } })
}
function buyWeapon(id: string) {
  const w = weaponById(id)
  if (spend(priceOf(id), w.name)) {
    save.owned.push(id); save.boughtWeapon = true
    wstate[id] = { mag: w.mag, reserve: w.reserve }
    audio.buy(); subtitle(`${w.name} unlocked. Press ${WEAPONS.indexOf(w) + 1} to equip.`); persistSave()
    switchWeapon(id)
  }
}
function refillAmmo(frac: number) {
  for (const w of WEAPONS) { const s = wstate[w.id]; if (s.reserve !== Infinity) s.reserve = Math.min(w.reserve, s.reserve + Math.ceil(w.reserve * frac)) }
  updateAmmoHud()
}

// ---------------- pickups ----------------
interface Pickup { mesh: THREE.Mesh; kind: 'health' | 'ammo'; t: number }
const pickups: Pickup[] = []
const healthGeo = new THREE.BoxGeometry(0.42, 0.3, 0.42)
const healthMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, emissive: 0xcc2222, emissiveIntensity: 0.35 })
const ammoMat = new THREE.MeshStandardMaterial({ color: 0x4a5d23, emissive: 0x9db33c, emissiveIntensity: 0.3 })
function dropPickup(x: number, z: number, kind: 'health' | 'ammo') {
  const m = new THREE.Mesh(healthGeo, kind === 'health' ? healthMat : ammoMat)
  m.position.set(x, 0.35, z); scene.add(m); pickups.push({ mesh: m, kind, t: 40 })
}

// ---------------- zombies ----------------
interface Zombie {
  h: Humanoid; hp: number; maxHp: number; type: string; speed: number; dmg: number
  state: 'chase' | 'attack' | 'stagger' | 'die' | 'dead'; t: number; attackCd: number; spitCd: number
  path: THREE.Vector3[]; repathT: number; phase: number; groanT: number; deadT: number; flashT: number
}
const zombies: Zombie[] = []
const zombiePool: Zombie[] = []
function makeZombieMesh(type: string): Humanoid {
  const h = makeHumanoid({ zombie: true })
  h.group.traverse(o => { o.userData.zombieHit = true })
  return h
}
function spawnZombie(type: string, at: THREE.Vector3) {
  let z = zombiePool.pop()
  const specBase = ZOMBIE_TYPES[type]
  const hp = specBase.hp * waveHpMult(wave)
  if (!z) {
    z = { h: makeZombieMesh(type), hp: 0, maxHp: 0, type, speed: 0, dmg: 0, state: 'chase', t: 0, attackCd: 0, spitCd: rand(1, 2.5), path: [], repathT: Math.random() * 0.5, phase: Math.random() * 10, groanT: rand(1, 5), deadT: 0, flashT: 0 }
  }
  // reskin scale per type
  z.type = type; z.hp = z.maxHp = hp
  z.speed = specBase.speed * waveSpeedMult(wave) * rand(0.9, 1.1); z.dmg = specBase.dmg
  z.state = 'chase'; z.t = 0; z.attackCd = 0; z.path = []; z.deadT = 0
  const s = specBase.scale
  z.h.group.scale.setScalar(s)
  z.h.group.position.copy(at); z.h.group.rotation.set(0, Math.random() * 6, 0)
  z.h.torso.material = new THREE.MeshStandardMaterial({ color: type === 'brute' ? 0x5e2f26 : type === 'runner' ? 0x51603f : type === 'spitter' ? 0x39543a : 0x4a5240, roughness: 0.95 })
  if (!z.h.group.parent) scene.add(z.h.group)
  z.h.group.visible = true
  zombies.push(z)
}
function damageZombie(z: Zombie, dmg: number, crit: boolean, point: THREE.Vector3) {
  if (z.state === 'die' || z.state === 'dead') return
  z.hp -= dmg; z.flashT = 0.06
  burst(point, COL_BLOOD, crit ? 10 : 6, 2.2, 0.4)
  audio.zombieHit()
  stats.hits++
  if (z.hp <= 0) {
    z.state = 'die'; z.t = 0
    stats.kills++; if (crit) stats.headshots++
    const pay = crit ? 90 : 60
    save.score += crit ? 150 : 100
    earn(mode === 'waves' ? pay : 30, crit ? 'Headshot kill' : 'Kill')
    audio.zombieDie()
    if (Math.random() < 0.08) dropPickup(z.h.group.position.x, z.h.group.position.z, 'health')
    else if (Math.random() < 0.12) dropPickup(z.h.group.position.x, z.h.group.position.z, 'ammo')
    if (z.type === 'brute') hideBossBar()
    updateWaveHud()
  } else if (Math.random() < 0.3 && z.type !== 'brute') { z.state = 'stagger'; z.t = 0 }
}
const spitBalls: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = []
const spitGeo = new THREE.SphereGeometry(0.14, 8, 8)
const spitMat = new THREE.MeshBasicMaterial({ color: 0x9fe870 })

// wave controller
let wave = 0, waveState: 'idle' | 'active' | 'intermission' = 'idle'
let toSpawn = 0, spawnT = 0, interT = 0, killedThisWave = 0
function startNextWave() {
  if (waveState === 'active') return
  wave++; waveState = 'active'; killedThisWave = 0
  toSpawn = waveCount(wave); spawnT = 1.2
  save.bestWave = Math.max(save.bestWave, wave - 1)
  audio.waveStinger(false)
  showWaveBanner(`WAVE ${wave}`)
  pushMessage('Unknown', `Wave ${wave} incoming at the factory. ${waveCount(wave)} hostiles.`, 'factory')
  if (wave === 3 && !saleActive) { saleActive = true; pushMessage('Gun Shop', 'Sale on now: 20% off all weapons until the wave ends. — Ray', 'guns') }
  updateWaveHud()
}
function endWave() {
  waveState = 'intermission'; interT = 20
  const bonus = waveClearBonus(wave)
  earn(bonus, 'Wave clear'); save.score += 250 + wave * 50
  save.bestWave = Math.max(save.bestWave, wave)
  audio.waveStinger(true)
  if (saleActive) saleActive = false
  showWaveBanner(`WAVE ${wave} CLEARED — +${fmtCash(bonus)}`)
  persistSave()
  updateWaveHud()
}
function updateWaveHud() {
  const el = $('wave-banner')
  if (mode !== 'waves' && waveState === 'idle') { el.textContent = ''; return }
  if (waveState === 'active') el.textContent = `WAVE ${wave} — ${zombies.filter(z => z.state !== 'dead').length + toSpawn} LEFT`
  else if (waveState === 'intermission') el.textContent = `WAVE ${wave} CLEARED`
  else el.textContent = ''
  const im = $('intermission')
  if (waveState === 'intermission') { im.classList.remove('hidden'); im.textContent = `Next wave in ${Math.ceil(interT)}s — re-arm at the wall buys, or start it at the factory console.` }
  else im.classList.add('hidden')
}
let bannerT: any = null
function showWaveBanner(txt: string) {
  const el = $('wave-banner'); el.textContent = txt
  clearTimeout(bannerT); bannerT = setTimeout(updateWaveHud, 2600)
}

// ---------------- pedestrians ----------------
interface Ped { h: Humanoid; target: THREE.Vector3; state: 'walk' | 'idle' | 'flee'; t: number; phase: number; female: boolean }
const peds: Ped[] = []
const sidewalk = world.sidewalkNodes
function nearestNode(p: THREE.Vector3): THREE.Vector3 {
  let best = sidewalk[0], bd = Infinity
  for (const n of sidewalk) { const d = n.distanceToSquared(p); if (d < bd) { bd = d; best = n } }
  return best
}
function nextNode(from: THREE.Vector3, cur: THREE.Vector3): THREE.Vector3 {
  const opts = sidewalk.filter(n => n !== cur && (Math.abs(n.x - cur.x) < 1 || Math.abs(n.z - cur.z) < 1) && n.distanceTo(cur) < 30 && n.distanceTo(cur) > 5)
  return opts.length ? opts[Math.floor(Math.random() * opts.length)] : nearestNode(from)
}
function spawnPeds() {
  for (let i = 0; i < 24; i++) {
    const female = Math.random() < 0.5
    const h = makeHumanoid({ female })
    const node = sidewalk[Math.floor(Math.random() * sidewalk.length)]
    h.group.position.copy(node).add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3)))
    scene.add(h.group)
    peds.push({ h, target: nextNode(h.group.position, node), state: 'walk', t: rand(0, 4), phase: Math.random() * 10, female })
  }
}
spawnPeds()

// ---------------- club cast ----------------
interface ClubNpc { h: Humanoid; pose: Pose; phase: number }
const clubCast: ClubNpc[] = []
interface Dancer { h: Humanoid; spot: { x: number; z: number; pole?: boolean }; like: number }
const dancers: Dancer[] = []
let floorDancer: Dancer | null = null
let bookedDance = false
{
  for (const spot of world.clubDancerSpots) {
    const h = makeHumanoid({ female: true, dancer: true, reduced: settings.reduceClub })
    h.group.position.set(spot.x, spot.pole || true ? 0.8 : 0, spot.z)
    scene.add(h.group)
    dancers.push({ h, spot, like: 0 })
  }
  // floor dancer near the bar
  const fh = makeHumanoid({ female: true, dancer: true, reduced: settings.reduceClub, shirt: 0x26418f })
  fh.group.position.set(CLUB.cx - 8, 0, CLUB.cz - 6); scene.add(fh.group)
  floorDancer = { h: fh, spot: { x: CLUB.cx - 8, z: CLUB.cz - 6 }, like: 0 }
  // bartender
  const bt = makeHumanoid({ female: true, shirt: 0x222222 })
  bt.group.position.set(CLUB.cx - 16.8, 0, CLUB.cz); bt.group.rotation.y = Math.PI / 2; scene.add(bt.group)
  clubCast.push({ h: bt, pose: 'talk', phase: 1 })
  // bouncer at door
  const bc = makeHumanoid({ shirt: 0x111111, pants: 0x111111 })
  bc.group.scale.setScalar(1.12); bc.group.position.set(CLUB.cx - CLUB.w / 2 + 1.6, 0, CLUB.cz + 3.4); bc.group.rotation.y = -Math.PI / 2
  scene.add(bc.group); clubCast.push({ h: bc, pose: 'idle', phase: 3 })
  // DJ
  const dj = makeHumanoid({ shirt: 0x30343c })
  dj.group.position.set(CLUB.cx + 16.5, 0, CLUB.cz - 11); dj.group.rotation.y = -Math.PI / 2; scene.add(dj.group)
  clubCast.push({ h: dj, pose: 'dance', phase: 5 })
  // seated patrons
  for (let i = 0; i < 6; i++) {
    const p = makeHumanoid({ seated: true, female: i % 3 === 0 })
    p.group.position.set(CLUB.cx + 5.6, 0.1, CLUB.cz - 6 + i * 2.4); p.group.rotation.y = Math.PI / 2
    scene.add(p.group); clubCast.push({ h: p, pose: 'seated', phase: i * 1.3 })
  }
}
function clubAnimate(t: number) {
  for (const d of dancers) {
    animateHumanoid(d.h, 'dance', t, d.h.group.position.z)
    if (d.spot.pole) {
      const a = t * 0.5 + d.spot.z
      d.h.group.position.x = d.spot.x + Math.cos(a) * 0.34
      d.h.group.position.z = d.spot.z + Math.sin(a) * 0.34
      d.h.group.rotation.y = -a
    }
  }
  if (floorDancer && !danceState) {
    animateHumanoid(floorDancer.h, 'idle', t, 2)
    // face the player when close
    const d = floorDancer.h.group.position.distanceTo(player.pos)
    if (d < 4) floorDancer.h.group.lookAt(player.pos.x, 0, player.pos.z)
  }
  for (const n of clubCast) animateHumanoid(n.h, n.pose, t, n.phase, 0.3)
}

// club interactions
let likeMeter = 0, danceState: null | { t: number; booth: { x: number; z: number }; peekT: number; peeking: boolean; prevPos: THREE.Vector3 } = null
interactables.push({ x: CLUB.cx + 6.6, z: CLUB.cz, r: 3.4, zone: 'club', hold: true, prompt: () => danceState ? null : 'Hold E — Tip dancer $5', use: () => {} })
interactables.push({ x: CLUB.cx - 8, z: CLUB.cz - 6, r: 2.4, zone: 'club', prompt: () => danceState ? null : (settings.reduceClub ? 'Private booths are closed tonight' : bookedDance ? 'Private dance — booked (free)' : 'Private dance — $40'), use: () => startPrivateDance() })
interactables.push({ x: CLUB.cx - 14, z: CLUB.cz, r: 2.8, zone: 'club', prompt: () => 'Buy a drink — $10', use: () => {
  if (spend(10, 'Club drink')) { audio.buy(); const tips = ['Bartender: Ray at the gun shop runs sales during waves.', 'Bartender: Neon orbs around the district — someone pays $100 a piece for them.', 'Bartender: The factory mezzanine is the safest spot in a wave. Watch the stairs.', 'Bartender: Brutes hate the shotgun. Up close.']; subtitle(tips[Math.floor(Math.random() * tips.length)]); flashHeal() }
} })
const BAR_TIPS = ['Wave 6 in 30s — Runners']
void BAR_TIPS

function startPrivateDance() {
  if (danceState) return
  if (settings.reduceClub) { subtitle('The private booths are closed tonight.'); return }
  if (!bookedDance && !spend(40, 'Private dance')) return
  bookedDance = false
  const booth = world.clubBooths[1]
  fadeTo(() => {
    danceState = { t: 45, booth, peekT: 12, peeking: false, prevPos: player.pos.clone() }
    player.pos.set(booth.x, 0, booth.z - 0.1); player.yaw = Math.PI; player.pitch = 0 // face +z toward the dancer
    player.vel.set(0, 0, 0)
    if (floorDancer) { floorDancer.h.group.position.set(booth.x, 0, booth.z + 1.1); floorDancer.h.group.rotation.y = Math.PI }
    likeMeter = Math.max(likeMeter, 10)
    $('like-meter').classList.remove('hidden')
    subtitle('Dancer: Sit back. That is the only rule — the bouncer walks by, behave.')
    audio.ringtone()
  })
}
function endPrivateDance() {
  if (!danceState) return
  const like = likeMeter
  fadeTo(() => {
    player.pos.copy(danceState!.prevPos)
    if (floorDancer) floorDancer.h.group.position.set(floorDancer.spot.x, 0, floorDancer.spot.z)
    danceState = null
    $('like-meter').classList.add('hidden')
    if (like >= 100) {
      save.dancerContact = true; persistSave()
      pushMessage('Velvet Room', 'You left an impression. Next time: a double dance, on the big stage. Call the Club Booker.', 'club')
      subtitle('Dancer: Call the club. Ask for me.')
    } else subtitle(`Dancer: Thanks, hon. (Like ${Math.floor(like)}/100)`)
    likeMeter = 0
  })
}

// ---------------- cars ----------------
interface Car {
  cm: CarMesh; kind: string; spec: typeof CAR_SPECS.sedan
  vel: THREE.Vector3; heading: number; hp: number; traffic: boolean
  loop?: THREE.Vector3[]; wp: number; speed: number; steerVis: number; dead: boolean
}
const cars: Car[] = []
function addCar(kind: string, x: number, z: number, rotY: number, traffic = false, loop?: THREE.Vector3[]): Car {
  const cm = makeCar(kind)
  cm.group.position.set(x, 0, z); cm.group.rotation.y = rotY
  scene.add(cm.group)
  const car: Car = { cm, kind, spec: CAR_SPECS[kind], vel: new THREE.Vector3(), heading: rotY, hp: 100, traffic, loop, wp: 0, speed: 0, steerVis: 0, dead: false }
  cars.push(car); return car
}
for (const s of world.parkedSpots) addCar(s.kind, s.x, s.z, s.rotY)
const trafficCars: Car[] = []
world.trafficLoops.forEach((loop, li) => {
  for (let i = 0; i < 4; i++) {
    const wp = Math.floor(loop.length / 4 * i)
    const p = loop[wp]
    const nxt = loop[(wp + 1) % loop.length]
    const c = addCar(['sedan', 'sports', 'van'][Math.floor(Math.random() * 3)], p.x, p.z, Math.atan2(-(nxt.z - p.z), nxt.x - p.x) - Math.PI / 2 + Math.PI, true, loop)
    c.wp = (wp + 1) % loop.length
    // heading such that forward (-z of group after rotY) points to next waypoint: compute directly
    c.heading = Math.atan2(nxt.x - p.x, nxt.z - p.z) + Math.PI
    c.cm.group.rotation.y = c.heading
    trafficCars.push(c)
  }
})
let curCar: Car | null = null
let carCamMode: 'chase' | 'hood' = 'chase'
let flipCd = 0, mechanicCd = 0
const carLight = new THREE.SpotLight(0xffedb5, 0, 30, 0.52, 0.45, 1.1)
scene.add(carLight, carLight.target)
const carFwd = (c: Car) => new THREE.Vector3(Math.sin(c.heading), 0, Math.cos(c.heading)).multiplyScalar(-1) // group -z forward when rotY=heading? see below
// We define heading as group.rotation.y, and forward = (−sin, 0, −cos) applied: use standard three forward:
function fwdOf(heading: number) { return new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading)) }
void carFwd

function nearestCarForEntry(): Car | null {
  let best: Car | null = null, bd = 3.2
  for (const c of cars) {
    if (c.dead) continue
    const door = c.cm.group.position.clone().add(new THREE.Vector3(-Math.cos(c.heading), 0, Math.sin(c.heading)).multiplyScalar(1.0))
    const d = door.distanceTo(player.pos)
    if (d < bd) { bd = d; best = c }
  }
  return best
}
function enterCar(c: Car) {
  curCar = c; audio.door(); setTimeout(() => audio.engineStart(), 250)
  save.droveCar = true
  vm.visible = false
  if (c.traffic) { c.traffic = false; subtitle('Driver: Hey — !  (they bail out and run)') ; const i = trafficCars.indexOf(c); if (i >= 0) trafficCars.splice(i, 1) }
  toast('Driving — WASD drive · Space handbrake · C camera · E exit')
}
function exitCar() {
  if (!curCar) return
  audio.door(); audio.engineStop()
  const c = curCar; curCar = null
  const side = new THREE.Vector3(-Math.cos(c.heading), 0, Math.sin(c.heading))
  player.pos.copy(c.cm.group.position).add(side.multiplyScalar(2.0)); player.pos.y = 0
  player.yaw = c.heading; vm.visible = true
  carLight.intensity = 0
}
function damageCar(c: Car, n: number) {
  c.hp -= n
  if (c.hp <= 30 && c.hp > 0 && c === curCar) toast('Car is smoking — call the Mechanic from your phone')
  if (c.hp <= 0 && !c.dead) { c.dead = true; c.cm.bodyMat.color.multiplyScalar(0.3); if (c === curCar) { subtitle('The engine is dead. Get out and find another car.'); audio.engineStop() } }
}

// ---------------- combat ----------------
function rayHitZombie(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { z: Zombie; part: 'head' | 'body'; dist: number; point: THREE.Vector3 } | null {
  let best: { z: Zombie; part: 'head' | 'body'; dist: number; point: THREE.Vector3 } | null = null
  const tmp = new THREE.Vector3()
  for (const z of zombies) {
    if (z.state === 'die' || z.state === 'dead') continue
    const base = z.h.group.position, s = ZOMBIE_TYPES[z.type].scale
    // head sphere
    tmp.set(base.x, base.y + 1.72 * s, base.z)
    const toC = tmp.clone().sub(origin); const tc = toC.dot(dir)
    if (tc > 0 && tc < maxDist) {
      const d2 = toC.lengthSq() - tc * tc, r = 0.24 * s
      if (d2 < r * r && (!best || tc < best.dist)) best = { z, part: 'head', dist: tc, point: origin.clone().add(dir.clone().multiplyScalar(tc)) }
    }
    // torso capsule approx: sphere at chest + hips
    for (const hy of [1.15, 0.75]) {
      tmp.set(base.x, base.y + hy * s, base.z)
      const t2v = tmp.clone().sub(origin); const tc2 = t2v.dot(dir)
      if (tc2 > 0 && tc2 < maxDist) {
        const d2 = t2v.lengthSq() - tc2 * tc2, r = 0.42 * s
        if (d2 < r * r && (!best || tc2 < best.dist)) best = { z, part: 'body', dist: tc2, point: origin.clone().add(dir.clone().multiplyScalar(tc2)) }
      }
    }
  }
  return best
}
function rayHitWorld(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
  // ground
  let best = maxDist
  if (dir.y < -0.001) { const t = -origin.y / dir.y; if (t > 0 && t < best) best = t }
  // AABB colliders as 3D boxes [0..h]
  for (const c of colliders) {
    const tmin = rayBox(origin, dir, c.x0, 0, c.z0, c.x1, Math.max(c.h, 0.4), c.z1)
    if (tmin !== null && tmin < best) best = tmin
  }
  // barrels
  return best
}
function rayBox(o: THREE.Vector3, d: THREE.Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number | null {
  let tmin = 0, tmax = Infinity
  const axes: [number, number, number, number][] = [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-8) { if (oo < lo || oo > hi) return null }
    else {
      let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd
      if (t1 > t2) [t1, t2] = [t2, t1]
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
      if (tmin > tmax) return null
    }
  }
  return tmin
}
function explodeBarrel(b: { mesh: THREE.Mesh; pos: THREE.Vector3; alive: boolean }) {
  if (!b.alive) return
  b.alive = false; b.mesh.visible = false
  audio.explosion()
  burst(b.pos.clone().setY(1), new THREE.Color(0xff7a30), 42, 6, 0.7, 1.6)
  burst(b.pos.clone().setY(1), COL_DUST, 18, 3, 0.8)
  const R = 3.5
  for (const z of [...zombies]) {
    const d = z.h.group.position.distanceTo(b.pos)
    if (d < R + 1) damageZombie(z, 80 * (1 - d / (R + 2)), false, z.h.group.position.clone().setY(1.2))
  }
  if (player.pos.distanceTo(b.pos) < R) damagePlayer(30, b.pos)
  for (const o of world.barrels) if (o !== b && o.alive && o.pos.distanceTo(b.pos) < R) setTimeout(() => explodeBarrel(o), 120)
  setTimeout(() => { b.alive = true; b.mesh.visible = true }, 1000 * 20) // respawn next waves
}
function shoot() {
  const spec = weaponById(curWeapon), st = wstate[curWeapon]
  if (reloadT >= 0 || swapT > 0 || meleeT > 0 || fireCd > 0) return
  if (st.mag <= 0) { audio.dryFire(); fireCd = 0.3; startReload(); return }
  fireCd = 60 / spec.rpm
  st.mag--; stats.shots++
  audio.shoot(curWeapon)
  // recoil / kick
  player.pitch = clamp(player.pitch + spec.kick * 0.011, -1.5, 1.5)
  vm.position.z = -0.5 + 0.07; flashT = 0.04
  flashSprite.material && ((flashSprite.material as THREE.MeshBasicMaterial).opacity = 0.9)
  flashSprite.rotation.z = Math.random() * 6.28
  const mw = muzzleWorld()
  muzzleFlash.position.copy(mw); muzzleFlash.intensity = 26
  const origin = camera.position.clone()
  const spreadDeg = player.ads ? spec.spreadAds : spec.spreadHip
  const pellets = spec.pellets
  for (let p = 0; p < pellets; p++) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    const sp = THREE.MathUtils.degToRad(spreadDeg) * (pellets > 1 || !player.ads ? 1 : 0.4)
    dir.x += rand(-sp, sp); dir.y += rand(-sp, sp); dir.z += rand(-sp, sp) * 0.3; dir.normalize()
    const maxD = 160
    const zh = rayHitZombie(origin, dir, maxD)
    const wd = rayHitWorld(origin, dir, maxD)
    // barrel hit?
    let barrelHit: typeof world.barrels[0] | null = null, bd = Infinity
    for (const b of world.barrels) {
      if (!b.alive) continue
      const toC = b.pos.clone().setY(0.7).sub(origin); const tc = toC.dot(dir)
      if (tc > 0 && tc < bd && toC.lengthSq() - tc * tc < 0.5) { bd = tc; barrelHit = b }
    }
    if (zh && zh.dist < wd && (!barrelHit || zh.dist < bd)) {
      const crit = zh.part === 'head'
      const dmg = spec.dmg * (crit ? spec.headMult : 1) * falloff(spec, zh.dist)
      fireTracer(mw, zh.point)
      damageZombie(zh.z, dmg, crit, zh.point)
      showHitmarker(zh.z.hp <= 0, crit)
    } else if (barrelHit && bd < wd) {
      fireTracer(mw, origin.clone().add(dir.clone().multiplyScalar(bd)))
      explodeBarrel(barrelHit)
    } else {
      const end = origin.clone().add(dir.clone().multiplyScalar(wd))
      fireTracer(mw, end)
      if (wd < maxD) burst(end, Math.random() < 0.5 ? COL_SPARK : COL_DUST, 4, 1.4, 0.3)
    }
  }
  // gunshot noise frightens peds / draws groans
  for (const pd of peds) if (pd.h.group.position.distanceTo(player.pos) < 15 && pd.state !== 'flee') { pd.state = 'flee'; pd.t = rand(3, 5) }
  updateAmmoHud()
  if (st.mag === 0) startReload()
}
function startReload() {
  const spec = weaponById(curWeapon), st = wstate[curWeapon]
  if (reloadT >= 0 || st.mag >= spec.mag || st.reserve <= 0) return
  reloadT = 0; reloadCredited = false
  reloadDur = spec.id === 'shotgun' ? spec.reload : spec.reload * (st.mag === 0 ? 1 : 0.85) // tactical 15% faster
  audio.reload(curWeapon)
}
function switchWeapon(id: string) {
  if (id === curWeapon || !save.owned.includes(id) || swapT > 0) return
  reloadT = -1 // swap cancels reload; ammo only credited at 70% point
  swapT = 0.75; audio.swap()
  setTimeout(() => {
    curWeapon = id
    for (const [k, g] of vmGuns) g.visible = k === id
    updateAmmoHud(); updateSlotsHud()
  }, 300)
}
function heal(n: number) {
  player.hp = Math.min(100, player.hp + n)
  flashHeal(); updateHealthHud()
}
function damagePlayer(n: number, from?: THREE.Vector3) {
  if (player.dead || gstate !== 'playing') return
  const dmg = n * (settings.difficulty === 'hard' ? 1.6 : 1)
  player.hp -= dmg; player.lastDamageT = elapsed
  audio.hurt()
  const v = $('dmg-vignette'); v.style.opacity = String(0.35 + settings.vignette * 0.6)
  setTimeout(() => v.style.opacity = '0', 240)
  if (from) {
    const toA = Math.atan2(from.x - player.pos.x, from.z - player.pos.z)
    const rel = toA - player.yaw
    $('dmg-arc').style.transform = `rotate(${rel}rad)`; $('dmg-arc').style.opacity = '1'
    setTimeout(() => $('dmg-arc').style.opacity = '0', 500)
  }
  updateHealthHud()
  if (player.hp <= 0) { player.hp = 0; die() }
}
function die() {
  player.dead = true
  audio.waveStinger(false)
  document.exitPointerLock()
  setTimeout(() => {
    gstate = 'gameover'
    save.bestScore = Math.max(save.bestScore, save.score); persistSave()
    $('hud').classList.add('hidden'); $('gameover').classList.remove('hidden')
    $('go-stats').innerHTML =
      `Wave reached <b>${Math.max(wave, 1)}</b> · Kills <b>${stats.kills}</b> · Headshot kills <b>${stats.headshots}</b><br>` +
      `Accuracy <b>${stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0}%</b> · Cash earned this run <b>${fmtCash(stats.earned)}</b><br>` +
      `Best wave <b>${save.bestWave}</b> · Best score <b>${save.bestScore}</b>`
  }, 1200)
}
function flashHeal() { const h = $('heal-vignette'); h.style.opacity = '1'; setTimeout(() => h.style.opacity = '0', 350) }
function showHitmarker(kill: boolean, crit: boolean) {
  const hm = $('hitmarker')
  hm.className = 'show' + (kill ? ' kill' : crit ? ' crit' : '')
  hm.id = 'hitmarker'
  audio.hitmarker(kill, crit)
  setTimeout(() => { hm.className = ''; hm.id = 'hitmarker' }, 95)
}

// ---------------- HUD helpers ----------------
function toast(txt: string, ms = 2600) {
  const el = $('toast'); el.textContent = txt; el.classList.remove('hidden')
  clearTimeout((toast as any)._t); (toast as any)._t = setTimeout(() => el.classList.add('hidden'), ms)
}
let subT: any = null
function subtitle(txt: string, ms = 4200) {
  if (!settings.subtitles && txt.length > 60) return
  const el = $('subtitle'); el.textContent = txt; el.classList.remove('hidden')
  clearTimeout(subT); subT = setTimeout(() => el.classList.add('hidden'), ms)
}
function updateCashHud() { $('cash').textContent = fmtCash(save.cash); $('score').textContent = 'SCORE ' + save.score.toLocaleString() }
function updateHealthHud() {
  $('health-bar').style.width = clamp(player.hp, 0, 100) + '%'
  $('health-num').textContent = String(Math.ceil(player.hp))
  $('health-bar').style.background = player.hp < 30 ? '#ff5040' : '#c33c31'
}
function updateAmmoHud() {
  const st = wstate[curWeapon]
  $('weapon-name').textContent = weaponById(curWeapon).name + (reloadT >= 0 ? ' — RELOADING' : '')
  $('ammo-mag').textContent = String(st.mag)
  $('ammo-res').textContent = st.reserve === Infinity ? '∞' : String(st.reserve)
}
function updateSlotsHud() {
  $('weapon-slots').innerHTML = WEAPONS.map((w, i) =>
    `<span class="${w.id === curWeapon ? 'on' : ''} ${save.owned.includes(w.id) ? '' : 'locked'}">${i + 1} ${w.name.split(' ')[0]}</span>`).join('')
}
function fadeTo(fn: () => void) {
  const f = $('fade'); f.classList.remove('hidden'); f.style.opacity = '1'
  setTimeout(() => { fn(); f.style.opacity = '0'; setTimeout(() => f.classList.add('hidden'), 320) }, 310)
}

// ---------------- phone ----------------
interface Msg { from: string; text: string; unread: boolean; poi?: string }
const messages: Msg[] = [
  { from: 'Ray (Gun Shop)', text: 'Welcome to the district. Factory pays cash for cleared waves — I sell the tools. Come by.', unread: true, poi: 'guns' },
  { from: 'Velvet Room', text: 'Open all night. Stage shows, private booths, no weapons inside. First visit is on you.', unread: true, poi: 'club' },
  { from: 'Clinic', text: 'We patch walk-ins for $50 and keep your records (progress) safe.', unread: false, poi: 'clinic' }
]
let phoneApp: string = 'home'
function pushMessage(from: string, text: string, poi?: string) {
  messages.unshift({ from, text, unread: true, poi })
  audio.phoneMsg()
  if (!phoneOpen && gstate === 'playing') { const pt = $('phone-toast'); pt.classList.remove('hidden'); pt.textContent = `New message — ${from} (P)`; setTimeout(() => pt.classList.add('hidden'), 3500) }
  if (phoneOpen && phoneApp === 'messages') renderPhone()
}
function phoneTime() { const m = 22 * 60 + 40 + Math.floor(elapsed / 6); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
function openPhone() {
  if (gstate !== 'playing' || curCar) { if (curCar) toast('No phone while driving'); return }
  if (waveState === 'active' && zombies.some(z => z.state !== 'dead' && z.h.group.position.distanceTo(player.pos) < 12)) { toast("Can't use phone now — hostiles too close"); return }
  phoneOpen = true; phoneApp = 'home'
  document.exitPointerLock()
  $('phone').classList.remove('hidden')
  audio.init(); audio.phoneOpen()
  renderPhone()
}
function closePhone(relock = true) {
  phoneOpen = false; $('phone').classList.add('hidden'); audio.phoneOpen()
  if (relock && gstate === 'playing') lockPointer()
}
function renderPhone() {
  $('phone-clock').textContent = phoneTime()
  const scr = $('phone-screen')
  const unread = messages.filter(m => m.unread).length
  if (phoneApp === 'home') {
    scr.innerHTML = `<div class="p-home-title">${phoneTime()} · NIGHT DISTRICT</div><div class="p-apps">
      ${[['MAP', 'Map'], ['MSG', 'Messages' + (unread ? `<span class="bdg">${unread}</span>` : '')], ['TEL', 'Contacts'], ['BANK', 'Bank'], ['LIST', 'Checklist'], ['CAM', 'Camera'], ['SET', 'Settings']].map(([ic, lb]) =>
      `<div class="p-app" data-app="${lb.split(' ')[0].toLowerCase()}"><div class="ic">${ic}</div><div class="lb">${lb}</div></div>`).join('')}
      </div><div class="p-item" style="margin-top:12px"><b>${fmtCash(save.cash)}</b><div class="sub">Cash on hand · Score ${save.score}</div></div>
      <button class="p-btn ghost" id="p-close" style="width:100%">Put phone away (P)</button>`
    scr.querySelectorAll('.p-app').forEach(el => el.addEventListener('click', () => { audio.phoneTap(); phoneApp = (el as HTMLElement).dataset.app!; renderPhone() }))
    scr.querySelector('#p-close')?.addEventListener('click', () => closePhone())
    return
  }
  const head = `<div class="p-head"><button class="p-back" id="p-back">‹ Apps</button><span class="p-title">${phoneApp.toUpperCase()}</span></div>`
  if (phoneApp === 'map') {
    scr.innerHTML = head + `<div class="p-item">The district map opens full-screen — set a waypoint and the GPS draws your route on the minimap.</div><button class="p-btn" id="p-openmap">Open full map</button>`
    scr.querySelector('#p-openmap')?.addEventListener('click', () => { closePhone(false); openMap() })
  } else if (phoneApp === 'messages') {
    scr.innerHTML = head + (messages.length ? messages.map((m, i) => `<div class="p-item ${m.unread ? 'p-msg-unread' : ''} clickable" data-i="${i}"><b>${m.from}</b><div class="sub">${m.text}</div>${m.poi ? '<div class="sub" style="color:var(--teal)">Tap to set waypoint</div>' : ''}</div>`).join('') : '<div class="p-item">No messages.</div>')
    scr.querySelectorAll('.p-item.clickable').forEach(el => el.addEventListener('click', () => {
      const m = messages[Number((el as HTMLElement).dataset.i)]; m.unread = false
      if (m.poi) { const p = POIS.find(x => x.id === m.poi); if (p) setWaypoint(p.x, p.z, p.name) }
      renderPhone()
    }))
    messages.forEach(m => { if (!m.poi) m.unread = false })
  } else if (phoneApp === 'contacts') {
    const contacts = [
      { name: 'Downtown Cab Co.', desc: waypoint ? `Ride to waypoint — $25` : 'Set a waypoint first (Map)', act: callCab },
      { name: 'Ammo Drop', desc: 'Crate with 50% reserves at your feet — $150', act: callAmmo },
      { name: 'Clinic', desc: 'Waypoint to clinic · medic if you are critical', act: callClinic },
      { name: 'Club Booker', desc: save.dancerContact || true ? 'Reserve a private dance — $40 prepaid' : 'Visit the club first', act: callBooker },
      { name: 'Mechanic', desc: curCar ? 'Repair current car — $100 (stay parked 5s)' : 'Only while you have a car', act: callMechanic }
    ]
    scr.innerHTML = head + contacts.map((c, i) => `<div class="p-item clickable" data-i="${i}"><b>${c.name}</b><div class="sub">${c.desc}</div></div>`).join('')
    scr.querySelectorAll('.p-item.clickable').forEach(el => el.addEventListener('click', () => { audio.ringtone(); contacts[Number((el as HTMLElement).dataset.i)].act() }))
  } else if (phoneApp === 'bank') {
    scr.innerHTML = head + `<div class="p-item"><div class="sub">Balance</div><div class="p-big">${fmtCash(save.cash)}</div><div class="sub">Lifetime earned ${fmtCash(stats.earned)} · Best wave ${save.bestWave}</div></div>` +
      (ledger.length ? ledger.slice(0, 10).map(l => `<div class="p-item">${l.desc}<span class="price" style="color:${l.amt >= 0 ? '#8be89a' : '#ff8a7a'}">${l.amt >= 0 ? '+' : ''}${fmtCash(l.amt)}</span></div>`).join('') : '<div class="p-item">No transactions yet.</div>')
  } else if (phoneApp === 'checklist') {
    const rows: [string, boolean][] = [
      ['Enter the factory', save.bestWave > 0 || curZone === 'factory'],
      ['Clear wave 3', save.bestWave >= 3],
      [`Collect neon orbs (${save.orbs.length}/20)`, save.orbs.length >= 20],
      ['Visit the Velvet Room', save.visitedClub],
      ['Buy a second weapon', save.boughtWeapon],
      ['Drive a car', save.droveCar],
      ['Get a dancer to Like 100', save.dancerContact]
    ]
    scr.innerHTML = head + rows.map(([t, done]) => `<div class="p-item" style="opacity:${done ? 1 : 0.75}">${done ? '✓' : '○'} ${t}</div>`).join('')
  } else if (phoneApp === 'camera') {
    scr.innerHTML = head + `<div class="p-item">Snapmatic: saves the current view as a PNG download.</div><button class="p-btn" id="p-snap">Take photo</button>`
    scr.querySelector('#p-snap')?.addEventListener('click', () => {
      composer.render()
      renderer.domElement.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'dead-shift.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000) })
    })
  } else if (phoneApp === 'settings') {
    scr.innerHTML = head + `<div class="p-item">Full settings live in the pause menu (Esc). Quick toggles:</div>
      <div class="p-item clickable" id="p-mute">${settings.mute ? 'Unmute all sound' : 'Mute all sound'}</div>
      <div class="p-item clickable" id="p-sub">${settings.subtitles ? 'Subtitles: ON' : 'Subtitles: OFF'}</div>`
    scr.querySelector('#p-mute')?.addEventListener('click', () => { settings.mute = !settings.mute; persistSettings(); syncSettingsUi(); applyAudio(); renderPhone() })
    scr.querySelector('#p-sub')?.addEventListener('click', () => { settings.subtitles = !settings.subtitles; persistSettings(); syncSettingsUi(); renderPhone() })
  }
  scr.querySelector('#p-back')?.addEventListener('click', () => { audio.phoneTap(); phoneApp = 'home'; renderPhone() })
}
function callCab() {
  if (!waypoint) { toast('Set a waypoint on the map first'); pushMessage('Downtown Cab', 'No destination, no ride. Set a waypoint and call again.'); return }
  if (!spend(25, 'Cab ride')) return
  audio.cash(); pushMessage('Downtown Cab', 'Cab skipped the traffic. You are at your waypoint.')
  fadeTo(() => {
    player.pos.set(waypoint!.x + 2, 0, waypoint!.z + 2)
    player.pos.y = groundHeightAt(world, player.pos.x, player.pos.z, 0)
    closePhone()
    toast('Cab dropped you at your waypoint — $25')
  })
}
let ammoDropT = -1
function callAmmo() {
  if (waveState === 'active') { toast('Ammo Drop unavailable mid-wave'); return }
  if (!spend(150, 'Ammo drop')) return
  toast('Ammo crate inbound — 10 seconds'); audio.ringtone()
  ammoDropT = 10
}
function callClinic() {
  const p = POIS.find(x => x.id === 'clinic')!
  setWaypoint(p.x, p.z, p.name)
  if (player.hp < 25) { toast('Clinic dispatched a medic — healing over time'); medicT = 8 }
  else toast('Waypoint set: Clinic')
  closePhone()
}
function callBooker() {
  if (bookedDance) { toast('Already booked — dancer is waiting at the Velvet Room'); return }
  if (!spend(40, 'Club booking')) return
  bookedDance = true
  pushMessage('Velvet Room', 'Booked. Your dancer will be waiting by the bar. — Velvet Room')
  toast('Private dance booked — head to the Velvet Room')
}
let mechanicT = -1
function callMechanic() {
  if (!curCar) { toast('You need to be in a car'); return }
  if (!spend(100, 'Mechanic call-out')) return
  mechanicT = 5; toast('Mechanic on the way — stay parked for 5s')
}
let medicT = -1

// ---------------- map & minimap ----------------
let waypoint: { x: number; z: number; name: string } | null = null
function setWaypoint(x: number, z: number, name = 'Waypoint') {
  waypoint = { x, z, name }; audio.waypoint()
  toast(`Waypoint set — ${name}`)
  updateObjective()
}
function gpsRoute(): THREE.Vector2[] {
  if (!waypoint) return []
  const pts: THREE.Vector2[] = [new THREE.Vector2(player.pos.x, player.pos.z)]
  const nearRoad = (v: number) => ROADS.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a, ROADS[0])
  const rx = nearRoad(player.pos.x), rz = nearRoad(waypoint.z)
  pts.push(new THREE.Vector2(rx, player.pos.z))
  pts.push(new THREE.Vector2(rx, rz))
  pts.push(new THREE.Vector2(waypoint.x, rz))
  pts.push(new THREE.Vector2(waypoint.x, waypoint.z))
  return pts
}
const mapStatic = document.createElement('canvas'); mapStatic.width = mapStatic.height = 900
function drawStaticMap() {
  const g = mapStatic.getContext('2d')!
  const W = (x: number) => (x + 300) / 600 * 900, H = (z: number) => (z + 300) / 600 * 900
  g.fillStyle = '#12151b'; g.fillRect(0, 0, 900, 900)
  g.fillStyle = '#1d2129'
  for (const bx of [-150, -50, 50, 150]) for (const bz of [-150, -50, 50, 150]) g.fillRect(W(bx - 43), H(bz - 43), 86 * 1.5, 86 * 1.5)
  g.fillStyle = '#0d2033'; g.fillRect(W(243), 0, 57 * 1.5, 900); g.fillRect(0, H(243), 900, 57 * 1.5)
  g.strokeStyle = '#3a4150'; g.lineWidth = 10
  for (const r of ROADS) { g.beginPath(); g.moveTo(W(r), 0); g.lineTo(W(r), 900); g.stroke(); g.beginPath(); g.moveTo(0, H(r)); g.lineTo(900, H(r)); g.stroke() }
  g.strokeStyle = '#ffb454'; g.lineWidth = 2; g.strokeRect(W(FACTORY.cx - 38), H(FACTORY.cz - 28), 76 * 1.5, 56 * 1.5)
  for (const p of POIS) {
    g.fillStyle = p.color; g.beginPath(); g.arc(W(p.x), H(p.z), 8, 0, 7); g.fill()
    g.fillStyle = '#e8ecf1'; g.font = 'bold 17px Arial'; g.textAlign = 'center'
    g.fillText(p.name, W(p.x), H(p.z) - 14)
  }
}
drawStaticMap()
function drawMapFull() {
  const cv = $('mapcanvas') as HTMLCanvasElement, g = cv.getContext('2d')!
  g.drawImage(mapStatic, 0, 0)
  const W = (x: number) => (x + 300) / 600 * 900, H = (z: number) => (z + 300) / 600 * 900
  const route = gpsRoute()
  if (route.length > 1) {
    g.strokeStyle = waypoint ? '#b388ff' : '#ffd54f'; g.lineWidth = 4; g.beginPath()
    route.forEach((p, i) => i ? g.lineTo(W(p.x), H(p.y)) : g.moveTo(W(p.x), H(p.y))); g.stroke()
  }
  if (waypoint) { g.fillStyle = '#b388ff'; g.beginPath(); g.arc(W(waypoint.x), H(waypoint.z), 9, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 14px Arial'; g.textAlign = 'center'; g.fillText(waypoint.name, W(waypoint.x), H(waypoint.z) - 15) }
  for (const c of cars) { g.fillStyle = c === curCar ? '#38e8ff' : '#7a8593'; g.fillRect(W(c.cm.group.position.x) - 3, H(c.cm.group.position.z) - 3, 6, 6) }
  for (const z of zombies) if (z.state !== 'dead') { g.fillStyle = '#ff5040'; g.beginPath(); g.arc(W(z.h.group.position.x), H(z.h.group.position.z), 4, 0, 7); g.fill() }
  // player arrow
  const px = W(player.pos.x), py = H(player.pos.z), a = Math.atan2(-Math.cos(player.yaw), -Math.sin(player.yaw))
  g.save(); g.translate(px, py); g.rotate(a + Math.PI / 2)
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -10); g.lineTo(6, 7); g.lineTo(-6, 7); g.closePath(); g.fill(); g.restore()
  $('map-legend').innerHTML = POIS.map(p => `<span><i style="background:${p.color}"></i>${p.name}</span>`).join('') +
    `<span><i style="background:#b388ff"></i>${waypoint ? `${waypoint.name} — ${Math.round(player.pos.distanceTo(new THREE.Vector3(waypoint.x, 0, waypoint.z)))} m` : 'No waypoint'}</span>`
}
function openMap() {
  if (gstate !== 'playing') return
  mapOpen = true; document.exitPointerLock()
  $('fullmap').classList.remove('hidden'); drawMapFull()
}
function closeMap(relock = true) {
  mapOpen = false; $('fullmap').classList.add('hidden')
  if (mapFromPause) { mapFromPause = false; showPanel('pause'); return }
  if (relock && gstate === 'playing') lockPointer()
}
;($('mapcanvas') as HTMLCanvasElement).addEventListener('click', (e) => {
  const cv = e.target as HTMLCanvasElement, r = cv.getBoundingClientRect()
  const wx = (e.clientX - r.left) / r.width * 600 - 300, wz = (e.clientY - r.top) / r.height * 600 - 300
  if (waypoint && Math.hypot(wx - waypoint.x, wz - waypoint.z) < 14) { waypoint = null; toast('Waypoint cleared'); updateObjective() }
  else {
    const poi = POIS.find(p => Math.hypot(wx - p.x, wz - p.z) < 16)
    setWaypoint(wx, wz, poi ? poi.name : 'Waypoint')
  }
  drawMapFull()
})
let minimapT = 0
function drawMinimap() {
  const cv = $('minimap') as HTMLCanvasElement, g = cv.getContext('2d')!
  const S = 900 / 600 // static px per metre
  const R = 90 // metres visible radius
  const src = R * S
  let sx = (player.pos.x + 300) * S - src, sy = (player.pos.z + 300) * S - src
  g.fillStyle = '#0a0e13'; g.fillRect(0, 0, 190, 190)
  g.save(); g.beginPath(); g.arc(95, 95, 95, 0, 7); g.clip()
  g.drawImage(mapStatic, clamp(sx, 0, 900 - src * 2), clamp(sy, 0, 900 - src * 2), src * 2, src * 2, 0, 0, 190, 190)
  const px = (wx: number) => 95 + (wx - player.pos.x) / R * 95, py = (wz: number) => 95 + (wz - player.pos.z) / R * 95
  const route = gpsRoute()
  if (route.length > 1) { g.strokeStyle = '#b388ff'; g.lineWidth = 3; g.beginPath(); route.forEach((p, i) => i ? g.lineTo(px(p.x), py(p.y)) : g.moveTo(px(p.x), py(p.y))); g.stroke() }
  for (const p of POIS) {
    const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z)
    if (d < R) { g.fillStyle = p.color; g.beginPath(); g.arc(px(p.x), py(p.z), 4.5, 0, 7); g.fill() }
  }
  for (const z of zombies) if (z.state !== 'dead') { const d = z.h.group.position.distanceTo(player.pos); if (d < R) { g.fillStyle = '#ff5040'; g.beginPath(); g.arc(px(z.h.group.position.x), py(z.h.group.position.z), 3.4, 0, 7); g.fill() } }
  for (const c of cars) { const d = c.cm.group.position.distanceTo(player.pos); if (d < R && d > 2) { g.fillStyle = '#7a8593'; g.fillRect(px(c.cm.group.position.x) - 2.5, py(c.cm.group.position.z) - 2.5, 5, 5) } }
  if (waypoint) {
    const d = Math.hypot(waypoint.x - player.pos.x, waypoint.z - player.pos.z)
    if (d >= R) { // rim arrow
      const a = Math.atan2(waypoint.z - player.pos.z, waypoint.x - player.pos.x)
      g.fillStyle = '#b388ff'; g.beginPath(); g.arc(95 + Math.cos(a) * 84, 95 + Math.sin(a) * 84, 5, 0, 7); g.fill()
    }
  }
  // player arrow (rotates, north-up map)
  const a = Math.atan2(-Math.cos(player.yaw), -Math.sin(player.yaw))
  g.translate(95, 95); g.rotate(a + Math.PI / 2)
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(-5.5, 6); g.closePath(); g.fill()
  g.restore()
}
function updateObjective() {
  let txt = ''
  if (mode === 'waves') txt = waveState === 'active' ? `Survive wave ${wave}` : waveState === 'intermission' ? 'Re-arm — next wave soon' : 'Start waves at the factory console'
  else if (waypoint) txt = `${waypoint.name} — ${Math.round(player.pos.distanceTo(new THREE.Vector3(waypoint.x, 0, waypoint.z)))} m`
  else txt = 'Free roam — factory pays for waves'
  $('objective').textContent = txt
  $('waypoint-dist').textContent = waypoint ? `Waypoint ${Math.round(player.pos.distanceTo(new THREE.Vector3(waypoint.x, 0, waypoint.z)))} m` : ''
}

// ---------------- input ----------------
const keys = new Set<string>()
let firing = false, mouseClicked = false
function lockPointer() {
  const el = renderer.domElement as any
  const attempt = (opts?: any) => {
    try { const p = opts ? el.requestPointerLock(opts) : el.requestPointerLock(); if (p && p.catch) return p.catch(() => {}) } catch {}
    return Promise.resolve()
  }
  attempt({ unadjustedMovement: true }).then(() => {
    if (document.pointerLockElement !== renderer.domElement) attempt()
  })
}
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement
  if (!locked && gstate === 'playing' && !phoneOpen && !mapOpen && !player.dead) openPause()
})
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement || gstate !== 'playing') return
  const s = settings.sens * 0.0022 * (player.ads ? 0.6 : 1)
  player.yaw -= e.movementX * s
  player.pitch -= e.movementY * s * (settings.invertY ? -1 : 1)
  player.pitch = clamp(player.pitch, -1.55, 1.55)
  if (danceState) player.yaw = clamp(player.yaw, Math.PI - 0.65, Math.PI + 0.65)
})
renderer.domElement.addEventListener('mousedown', (e) => {
  if (gstate !== 'playing' || document.pointerLockElement !== renderer.domElement) return
  if (e.button === 0) { firing = true; mouseClicked = true }
  if (e.button === 2) player.ads = true
})
addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; if (e.button === 2) player.ads = false })
addEventListener('contextmenu', e => e.preventDefault())
addEventListener('wheel', (e) => {
  if (gstate !== 'playing' || curCar || phoneOpen || mapOpen) return
  const owned = WEAPONS.filter(w => save.owned.includes(w.id))
  if (owned.length < 2) return
  const i = owned.findIndex(w => w.id === curWeapon)
  const n = owned[(i + (e.deltaY > 0 ? 1 : -1) + owned.length) % owned.length]
  switchWeapon(n.id)
}, { passive: true })
document.addEventListener('keydown', (e) => {
  if (e.repeat) { keys.add(e.code); return }
  keys.add(e.code)
  if (mapOpen && (e.code === 'KeyM' || e.code === 'Escape')) { closeMap(); return }
  if (gstate !== 'playing') return
  if (phoneOpen) { if (e.code === 'KeyP' || e.code === 'Escape') closePhone(); return }
  switch (e.code) {
    case 'KeyP': openPhone(); break
    case 'KeyM': openMap(); break
    case 'KeyR': startReload(); break
    case 'KeyV': doMelee(); break
    case 'KeyH': if (curCar) audio.horn(); break
    case 'KeyF': if (curCar && flipCd <= 0) flipCar(); break
    case 'KeyC':
      if (curCar) { carCamMode = carCamMode === 'chase' ? 'hood' : 'chase'; toast(carCamMode === 'hood' ? 'Hood camera' : 'Chase camera') }
      else if (settings.crouchToggle) player.crouch = !player.crouch
      break
    case 'KeyQ': if (danceState) endPrivateDance(); break
    case 'KeyE': handleInteractPress(); break
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': {
      const w = WEAPONS[Number(e.code.slice(-1)) - 1]; if (w) switchWeapon(w.id); break
    }
  }
})
document.addEventListener('keyup', (e) => keys.delete(e.code))
function doMelee() {
  if (meleeT > 0 || curCar) return
  meleeT = 0.45; audio.melee()
  vm.position.z = -0.32
  const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw))
  for (const z of zombies) {
    const to = z.h.group.position.clone().sub(player.pos); to.y = 0
    if (to.length() < 2.3 && to.normalize().dot(fwd) > 0.4) { damageZombie(z, 50, false, z.h.group.position.clone().setY(1.2)); showHitmarker(z.hp <= 0, false); break }
  }
}
function flipCar() {
  if (!curCar) return
  flipCd = 3
  const rx = ROADS.reduce((a, b) => Math.abs(b - curCar!.cm.group.position.x) < Math.abs(a - curCar!.cm.group.position.x) ? b : a, ROADS[0])
  curCar.cm.group.position.x = rx; curCar.speed = 0; curCar.vel.set(0, 0, 0)
  curCar.cm.group.rotation.z = 0; audio.crash(0.2); toast('Car reset on the road')
}
let activeInteract: Interactable | null = null
function handleInteractPress() {
  if (curCar) { exitCar(); return }
  if (danceState) return
  if (activeInteract) { activeInteract.use(); return }
  const c = nearestCarForEntry()
  if (c) enterCar(c)
}

// ---------------- pause / menus ----------------
function openPause() {
  if (gstate !== 'playing') return
  gstate = 'paused'; $('pause').classList.remove('hidden')
}
function closePause() {
  $('pause').classList.add('hidden'); gstate = 'playing'; lockPointer()
}
function startGame(m: 'roam' | 'waves', fresh = false) {
  audio.init(); applyAudio()
  mode = m
  if (fresh) { save = { ...DEF_SAVE, owned: ['pistol'] }; stats = { kills: 0, headshots: 0, shots: 0, hits: 0, earned: 0 }; persistSave() }
  player.dead = false; player.hp = 100; player.stamina = 100
  curWeapon = 'pistol'
  for (const [k, g] of vmGuns) g.visible = k === 'pistol'
  if (curCar) exitCar()
  clearZombies()
  wave = 0; waveState = 'idle'; toSpawn = 0
  if (m === 'waves') {
    player.pos.set(FACTORY.cx, 0, FACTORY.cz + 18); player.yaw = 0; player.pitch = 0
    toast('Zombie Waves — survive the factory')
    setTimeout(() => { if (mode === 'waves' && waveState === 'idle') startNextWave() }, 1600)
  } else {
    player.pos.set(-50, 0, -96); player.yaw = 0; player.pitch = 0
    toast('Free Roam — the factory, club, gun shop and clinic are open')
  }
  player.vel.set(0, 0, 0)
  $('menu').classList.add('hidden'); $('gameover').classList.add('hidden'); $('pause').classList.add('hidden')
  $('hud').classList.remove('hidden')
  gstate = 'playing'
  updateCashHud(); updateHealthHud(); updateAmmoHud(); updateSlotsHud(); updateWaveHud(); updateObjective()
  lockPointer()
}
function clearZombies() {
  for (const z of zombies) { z.h.group.visible = false; zombiePool.push(z) }
  zombies.length = 0
  for (const b of spitBalls) scene.remove(b.mesh)
  spitBalls.length = 0
}
function restartWave() {
  clearZombies()
  player.dead = false; player.hp = 100
  const w = Math.max(1, wave)
  wave = w - 1; waveState = 'idle'
  player.pos.set(FACTORY.cx, 0, FACTORY.cz + 18); player.yaw = 0
  $('gameover').classList.add('hidden'); $('pause').classList.add('hidden'); $('hud').classList.remove('hidden')
  mode = 'waves'; gstate = 'playing'; updateHealthHud()
  startNextWave(); lockPointer()
}
function quitToMenu() {
  persistSave()
  if (curCar) exitCar()
  clearZombies(); waveState = 'idle'; wave = 0
  $('pause').classList.add('hidden'); $('gameover').classList.add('hidden'); $('hud').classList.add('hidden')
  $('menu').classList.remove('hidden')
  $('btn-continue').classList.toggle('hidden', !hasSave)
  $('menu-best').textContent = hasSave ? `Best wave ${save.bestWave} · Best score ${save.bestScore} · Cash ${fmtCash(save.cash)} · Orbs ${save.orbs.length}/20` : ''
  gstate = 'menu'
}

// settings UI
function syncSettingsUi() {
  ($('set-sens') as HTMLInputElement).value = String(settings.sens); $('val-sens').textContent = settings.sens.toFixed(2)
  ;($('set-invert') as HTMLInputElement).checked = settings.invertY
  ;($('set-fov') as HTMLInputElement).value = String(settings.fov); $('val-fov').textContent = String(settings.fov)
  ;($('set-quality') as HTMLSelectElement).value = settings.quality
  ;($('set-difficulty') as HTMLSelectElement).value = settings.difficulty
  const vols: [string, number][] = [['master', settings.volMaster], ['music', settings.volMusic], ['sfx', settings.volSfx], ['ui', settings.volUi]]
  for (const [k, v] of vols) { ($(`set-vol-${k}`) as HTMLInputElement).value = String(v); $(`val-vol-${k}`).textContent = Math.round(v * 100) + '%' }
  ;($('set-mute') as HTMLInputElement).checked = settings.mute
  ;($('set-subtitles') as HTMLInputElement).checked = settings.subtitles
  ;($('set-headbob') as HTMLInputElement).checked = settings.headbob
  ;($('set-vignette') as HTMLInputElement).value = String(settings.vignette); $('val-vignette').textContent = settings.vignette.toFixed(1)
  ;($('set-reduceclub') as HTMLInputElement).checked = settings.reduceClub
  ;($('set-crouchtoggle') as HTMLInputElement).checked = settings.crouchToggle
}
function applyQuality(forceLow = false) {
  const low = forceLow || settings.quality === 'low'
  renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, 1.5))
  moon.castShadow = !low
  bloom.enabled = !low
}
function bindSettings() {
  const on = (id: string, fn: (el: HTMLInputElement | HTMLSelectElement) => void) => {
    const el = $(id) as HTMLInputElement
    el.addEventListener('input', () => fn(el)); el.addEventListener('change', () => fn(el))
  }
  on('set-sens', el => { settings.sens = Number(el.value); $('val-sens').textContent = settings.sens.toFixed(2); persistSettings() })
  on('set-invert', el => { settings.invertY = (el as HTMLInputElement).checked; persistSettings() })
  on('set-fov', el => { settings.fov = Number(el.value); $('val-fov').textContent = el.value; camera.fov = settings.fov; camera.updateProjectionMatrix(); persistSettings() })
  on('set-quality', el => { settings.quality = el.value; applyQuality(); persistSettings() })
  on('set-difficulty', el => { settings.difficulty = el.value; persistSettings() })
  for (const k of ['master', 'music', 'sfx', 'ui']) on(`set-vol-${k}`, el => {
    const v = Number(el.value); $(`val-vol-${k}`).textContent = Math.round(v * 100) + '%'
    if (k === 'master') settings.volMaster = v; if (k === 'music') settings.volMusic = v; if (k === 'sfx') settings.volSfx = v; if (k === 'ui') settings.volUi = v
    persistSettings(); applyAudio()
  })
  on('set-mute', el => { settings.mute = (el as HTMLInputElement).checked; persistSettings(); applyAudio() })
  on('set-subtitles', el => { settings.subtitles = (el as HTMLInputElement).checked; persistSettings() })
  on('set-headbob', el => { settings.headbob = (el as HTMLInputElement).checked; persistSettings() })
  on('set-vignette', el => { settings.vignette = Number(el.value); $('val-vignette').textContent = settings.vignette.toFixed(1); persistSettings() })
  on('set-reduceclub', el => { settings.reduceClub = (el as HTMLInputElement).checked; persistSettings(); toast('Club content setting applies on next load') })
  on('set-crouchtoggle', el => { settings.crouchToggle = (el as HTMLInputElement).checked; persistSettings() })
  $('btn-reset-settings').addEventListener('click', () => { settings = { ...DEF_SETTINGS }; persistSettings(); syncSettingsUi(); applyAudio(); applyQuality(); camera.fov = settings.fov; camera.updateProjectionMatrix() })
}
function showPanel(id: string) { $(id).classList.remove('hidden') }
function hidePanel(id: string) { $(id).classList.add('hidden') }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
  audio.uiClick(); hidePanel((b as HTMLElement).dataset.close!)
  if ((b as HTMLElement).dataset.close === 'settings' && settingsFrom === 'pause' && gstate === 'paused') showPanel('pause')
}))
$('btn-howto').addEventListener('click', () => { audio.uiClick(); showPanel('howto') })
$('btn-credits').addEventListener('click', () => { audio.uiClick(); showPanel('credits') })
$('btn-settings').addEventListener('click', () => { audio.uiClick(); settingsFrom = 'menu'; syncSettingsUi(); showPanel('settings') })
$('btn-waves').addEventListener('click', () => startGame('waves', !hasSave))
$('btn-roam').addEventListener('click', () => startGame('roam', !hasSave))
$('btn-continue').addEventListener('click', () => startGame(save.bestWave > 0 ? 'roam' : 'roam'))
$('btn-resume').addEventListener('click', closePause)
$('btn-pause-map').addEventListener('click', () => { hidePanel('pause'); openMapFromPause() })
$('btn-pause-settings').addEventListener('click', () => { settingsFrom = 'pause'; syncSettingsUi(); showPanel('settings') })
$('btn-restart-wave').addEventListener('click', restartWave)
$('btn-quit-menu').addEventListener('click', quitToMenu)
$('btn-go-restart').addEventListener('click', restartWave)
$('btn-go-roam').addEventListener('click', () => startGame('roam'))
$('btn-go-menu').addEventListener('click', quitToMenu)
let mapFromPause = false
function openMapFromPause() { mapFromPause = true; mapOpen = true; $('fullmap').classList.remove('hidden'); drawMapFull() }
syncSettingsUi(); bindSettings(); applyQuality()

// ---------------- per-frame updates ----------------
const eyeV = new THREE.Vector3()
let coyote = 0, tipT = 0, stageLike = 0, fpsAcc = 0, fpsN = 0, fpsT = 0, autoLow = false, heartbeatT = 0, zoneCheckT = 0

function updatePlayer(dt: number) {
  if (player.dead) return
  if (danceState) { // seated in booth: no movement, camera fixed to booth view
    camera.position.set(player.pos.x, 1.25, player.pos.z)
    camera.rotation.order = 'YXZ'; camera.rotation.set(player.pitch * 0.3, player.yaw, 0)
    return
  }
  const crouchKey = keys.has('ControlLeft') || keys.has('ControlRight') || (settings.crouchToggle && player.crouch)
  const crouching = settings.crouchToggle ? player.crouch : crouchKey
  const wantSprint = keys.has('ShiftLeft') && !crouching && !player.ads
  let speed = crouching ? 2.2 : 4.5
  const moving = keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD')
  let sprinting = false
  if (wantSprint && moving && player.stamina > 1) {
    speed = 7.0; sprinting = true
    player.stamina = Math.max(0, player.stamina - 22 * dt)
  } else {
    const sinceMove = moving ? 0 : 1
    player.stamina = Math.min(100, player.stamina + (sinceMove ? 14 : 9) * dt)
  }
  $('stamina-bar').style.width = player.stamina + '%'
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw)
  const f = new THREE.Vector3(-sin, 0, -cos)
  const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)) // = (cos, 0, -sin)
  const wish = new THREE.Vector3()
  if (keys.has('KeyW')) wish.add(f)
  if (keys.has('KeyS')) wish.sub(f)
  if (keys.has('KeyD')) wish.add(right)
  if (keys.has('KeyA')) wish.sub(right)
  if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed)
  player.vel.x = wish.x; player.vel.z = wish.z
  // gravity / jump
  const groundY = groundHeightAt(world, player.pos.x, player.pos.z, player.pos.y)
  if (player.onGround) coyote = 0.1; else coyote -= dt
  if (keys.has('Space') && coyote > 0) { player.vel.y = 4.8; player.onGround = false; coyote = 0 }
  player.vel.y -= 14 * dt
  player.pos.addScaledVector(player.vel, dt)
  if (player.pos.y <= groundY) {
    if (!player.onGround && player.vel.y < -6) { /* landing */ }
    player.pos.y = groundY; player.vel.y = 0; player.onGround = true
  } else if (player.pos.y > groundY + 0.05) player.onGround = false
  collideAABB(colliders, player.pos, player.radius, player.pos.y)
  player.pos.x = clamp(player.pos.x, -295, 295); player.pos.z = clamp(player.pos.z, -295, 235)
  // head bob
  let bobY = 0
  if (settings.headbob && moving && player.onGround) {
    player.bobPhase += dt * (sprinting ? 11 : 8)
    bobY = Math.sin(player.bobPhase) * 0.028
  }
  const eyeH = crouching ? 1.12 : 1.66
  camera.position.set(player.pos.x, player.pos.y + eyeH + bobY, player.pos.z)
  camera.rotation.order = 'YXZ'
  camera.rotation.set(player.pitch, player.yaw, 0)
  // ADS / fov / viewmodel
  const spec = weaponById(curWeapon)
  const targetFov = player.ads ? settings.fov * (spec.scoped ? 0.42 : 0.75) : settings.fov + (sprinting ? 3 : 0)
  if (Math.abs(camera.fov - targetFov) > 0.2) { camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix() }
  $('scope').classList.toggle('hidden', !(player.ads && spec.scoped))
  vm.visible = curZone !== 'club'
  const vmTgt = player.ads ? new THREE.Vector3(0, -0.185, -0.42) : new THREE.Vector3(0.26, -0.24, -0.5)
  vm.position.lerp(vmTgt, Math.min(1, dt * 16))
  if (meleeT > 0) { meleeT -= dt; if (meleeT <= 0) vm.position.z = vmTgt.z }
  const ch = $('crosshair') as HTMLElement
  ch.style.setProperty('--sp', `${4 + (player.ads ? 1 : 5) + (moving ? 3 : 0)}px`)
  ch.style.opacity = player.ads && spec.scoped ? '0' : '1'
  // regen: last 25hp segment only, after 5s calm
  if (player.hp > 0 && player.hp < 100 && elapsed - player.lastDamageT > 5) {
    const cap = Math.min(100, (Math.floor(player.hp / 25) + 1) * 25)
    if (player.hp < cap) { player.hp = Math.min(cap, player.hp + 3 * dt); updateHealthHud() }
  }
  if (player.hp < 30 && player.hp > 0) { heartbeatT -= dt; if (heartbeatT <= 0) { audio.heartbeat(); heartbeatT = 1.05 } }
}

function updateWeapons(dt: number) {
  if (fireCd > 0) fireCd -= dt
  if (swapT > 0) swapT -= dt
  if (flashT > 0) { flashT -= dt; if (flashT <= 0) { (flashSprite.material as THREE.MeshBasicMaterial).opacity = 0; muzzleFlash.intensity = 0 } }
  if (reloadT >= 0) {
    reloadT += dt
    const spec = weaponById(curWeapon), st = wstate[curWeapon]
    const frac = reloadT / reloadDur
    if (spec.id === 'shotgun') {
      // per-shell: each reloadDur adds one shell
      if (frac >= 1) {
        if (st.reserve > 0 && st.mag < spec.mag) { st.mag++; st.reserve--; audio.reload('shotgun'); reloadT = 0; updateAmmoHud() }
        else reloadT = -1
        if (st.mag >= spec.mag || st.reserve <= 0) reloadT = -1
      }
    } else {
      if (!reloadCredited && frac >= 0.7) {
        reloadCredited = true
        const need = spec.mag - st.mag, take = st.reserve === Infinity ? need : Math.min(need, st.reserve)
        st.mag += take; if (st.reserve !== Infinity) st.reserve -= take
        updateAmmoHud()
      }
      if (frac >= 1) { reloadT = -1; updateAmmoHud() }
    }
    updateAmmoHud()
  }
  if (firing && !curCar && curZone !== 'club' && !danceState) {
    const spec = weaponById(curWeapon)
    if (spec.auto || mouseClicked) shoot()
  }
  mouseClicked = false
  // tracers + particles
  for (const t of tracers) if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.line.visible = false }
  const pa = pGeo.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    if (p.life > 0) {
      p.life -= dt; p.vel.y -= 3.5 * dt
      p.pos.addScaledVector(p.vel, dt)
      if (p.pos.y < 0.03) { p.pos.y = 0.03; p.vel.set(0, 0, 0) }
    }
    pa.setXYZ(i, p.pos.x, p.pos.y, p.pos.z)
  }
  pa.needsUpdate = true
}

function updateZombies(dt: number) {
  // spawner
  if (waveState === 'active') {
    if (toSpawn > 0) {
      spawnT -= dt
      const alive = zombies.filter(z => z.state !== 'dead').length
      if (spawnT <= 0 && alive < 24) {
        spawnT = spawnInterval(wave)
        toSpawn--
        const door = world.spawnDoors[Math.floor(Math.random() * world.spawnDoors.length)]
        spawnZombie(zombieTypeFor(wave, Math.random()), door.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1))))
        updateWaveHud()
      }
    } else if (zombies.every(z => z.state === 'dead')) endWave()
  } else if (waveState === 'intermission') {
    if (zoneAt(player.pos.x, player.pos.z) === 'factory') { interT -= dt; if (interT <= 0) startNextWave(); else if (Math.ceil(interT) !== Number(($('intermission').dataset.s || 0))) { $('intermission').dataset.s = String(Math.ceil(interT)); updateWaveHud() } }
  }
  const playerCell = toCell(player.pos.x, player.pos.z)
  let brute: Zombie | null = null
  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i], gp = z.h.group.position
    if (z.flashT > 0) z.flashT -= dt
    ;(z.h.torso.material as THREE.MeshStandardMaterial).emissive?.setHex(z.flashT > 0 ? 0x771111 : 0x000000)
    if (z.state === 'dead') continue
    if (z.state === 'die') {
      z.t += dt
      z.h.group.rotation.x = -Math.min(1, z.t / 0.4) * Math.PI / 2
      if (z.t > 2.6) gp.y -= dt * 0.5
      if (z.t > 3.4) { z.state = 'dead'; z.h.group.visible = false; z.h.group.rotation.x = 0; gp.y = 0; zombies.splice(i, 1); zombiePool.push(z); updateWaveHud() }
      continue
    }
    if (z.type === 'brute') brute = z
    const toPlayer = player.pos.clone().sub(gp); toPlayer.y = 0
    const dist = toPlayer.length()
    z.groanT -= dt; if (z.groanT <= 0) { audio.zombieGroan(dist); z.groanT = rand(3, 8) }
    if (z.attackCd > 0) z.attackCd -= dt
    let pose: Pose = z.type === 'runner' ? 'run' : 'zombie'
    if (z.state === 'stagger') { z.t += dt; if (z.t > 0.35) z.state = 'chase'; pose = 'idle' }
    else if (z.state === 'attack') {
      pose = 'attack'; z.t += dt
      if (z.t >= 0.8) {
        if (dist < 2.2 && !player.dead) damagePlayer(z.dmg * (curCar ? 0 : 1), gp)
        z.attackCd = 1.0; z.state = 'chase'; z.t = 0
      }
    } else if (dist < 1.7 && z.attackCd <= 0 && !curCar) { z.state = 'attack'; z.t = 0 }
    else {
      // spitter keeps range
      if (z.type === 'spitter') {
        z.spitCd -= dt
        if (dist < 16 && dist > 6 && z.spitCd <= 0) {
          z.spitCd = 2.5; audio.spit()
          const m = new THREE.Mesh(spitGeo, spitMat)
          m.position.copy(gp).setY(gp.y + 1.4); scene.add(m)
          const target = camera.position.clone()
          const vel = target.sub(m.position).normalize().multiplyScalar(15); vel.y += 1.2
          spitBalls.push({ mesh: m, vel, life: 4 })
        }
      }
      // movement: A* inside factory grid, else direct steering
      let target = player.pos
      const inGrid = gp.x > GRID.x0 && gp.x < GRID.x0 + GRID.cols * GRID.cell && gp.z > GRID.z0 && gp.z < GRID.z0 + GRID.rows * GRID.cell
      if (inGrid && dist > 2.2) {
        z.repathT -= dt
        if (z.repathT <= 0) {
          z.repathT = 0.7 + Math.random() * 0.3
          const path = astar(GRID.cols, GRID.rows, gridBlocked, toCell(gp.x, gp.z), playerCell)
          z.path = path.slice(0, 6).map(cellCenter)
        }
        if (z.path.length) {
          target = z.path[0]
          if (gp.distanceTo(new THREE.Vector3(target.x, gp.y, target.z)) < 1.1) z.path.shift()
        }
      }
      const dirv = new THREE.Vector3(target.x - gp.x, 0, target.z - gp.z)
      if (z.type === 'spitter' && dist < 7) dirv.multiplyScalar(-0.6)
      if (dirv.lengthSq() > 0.01) {
        dirv.normalize()
        // separation
        for (const o of zombies) if (o !== z && o.state !== 'dead' && o.state !== 'die') {
          const d = gp.distanceTo(o.h.group.position)
          if (d < 0.9 && d > 0.001) { const push = gp.clone().sub(o.h.group.position).normalize().multiplyScalar((0.9 - d) * 1.6); dirv.add(push) }
        }
        const sp = z.speed * ((z.state as string) === 'stagger' ? 0 : 1)
        gp.addScaledVector(dirv.normalize(), sp * dt)
        collideAABB(colliders, gp, 0.38, 0)
        z.h.group.rotation.y = Math.atan2(dirv.x, dirv.z) + Math.PI
        // note: humanoid faces +z when rotation 0; movement dir -> face along dir
        z.h.group.rotation.y = Math.atan2(dirv.x, dirv.z)
      }
    }
    animateHumanoid(z.h, pose, elapsed, z.phase, z.type === 'runner' ? 0.9 : 0.4)
  }
  // spitter projectiles
  for (let i = spitBalls.length - 1; i >= 0; i--) {
    const b = spitBalls[i]; b.life -= dt
    b.vel.y -= 2.5 * dt; b.mesh.position.addScaledVector(b.vel, dt)
    if (b.mesh.position.distanceTo(camera.position) < 0.75) { damagePlayer(8, b.mesh.position); burst(b.mesh.position, COL_GREEN, 8, 1.6, 0.35); scene.remove(b.mesh); spitBalls.splice(i, 1); continue }
    if (b.life <= 0 || b.mesh.position.y < 0) { scene.remove(b.mesh); spitBalls.splice(i, 1) }
  }
  // boss bar
  if (brute) { $('boss-hp').classList.remove('hidden'); $('boss-fill').style.width = (brute.hp / brute.maxHp * 100) + '%' }
  else $('boss-hp').classList.add('hidden')
}
function hideBossBar() { $('boss-hp').classList.add('hidden') }

function updatePeds(dt: number) {
  for (const pd of peds) {
    const gp = pd.h.group.position
    const dPlayer = gp.distanceTo(player.pos)
    if (dPlayer > 130) { // recycle near player
      const node = nearestNode(player.pos.clone().add(new THREE.Vector3(rand(-80, 80), 0, rand(-80, 80))))
      gp.copy(node); pd.target = nextNode(gp, node)
    }
    let pose: Pose = 'idle', spd = 0
    if (pd.state === 'flee') {
      pd.t -= dt
      const away = gp.clone().sub(player.pos); away.y = 0; away.normalize()
      gp.addScaledVector(away, 4.4 * dt); pose = 'flee'; spd = 0.9
      pd.h.group.rotation.y = Math.atan2(away.x, away.z)
      if (pd.t <= 0) pd.state = 'walk'
    } else if (pd.state === 'idle') {
      pd.t -= dt; pose = Math.random() < 0.002 ? 'talk' : 'idle'
      if (pd.t <= 0) { pd.state = 'walk'; pd.target = nextNode(gp, nearestNode(gp)) }
    } else {
      const to = pd.target.clone().sub(gp); to.y = 0
      if (to.length() < 1.2) { pd.state = Math.random() < 0.4 ? 'idle' : 'walk'; pd.t = rand(2, 7); if (pd.state === 'walk') pd.target = nextNode(gp, nearestNode(gp)) }
      else { to.normalize(); gp.addScaledVector(to, 1.55 * dt); pd.h.group.rotation.y = Math.atan2(to.x, to.z); pose = 'walk'; spd = 0.35 }
    }
    collideAABB(colliders, gp, 0.34, 0)
    if (gp.distanceTo(player.pos) < 40) animateHumanoid(pd.h, pose, elapsed, pd.phase, spd)
  }
}

function updateCars(dt: number) {
  flipCd -= dt
  // traffic
  for (const c of trafficCars) {
    const gp = c.cm.group.position
    const wp = c.loop![c.wp]
    const to = new THREE.Vector3(wp.x - gp.x, 0, wp.z - gp.z)
    if (to.length() < 5) { c.wp = (c.wp + 1) % c.loop!.length; continue }
    const targetHeading = Math.atan2(-to.x, -to.z)
    let dh = targetHeading - c.heading
    while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
    c.heading += clamp(dh, -1.6 * dt, 1.6 * dt)
    // obstacle ahead?
    const fwd = fwdOf(c.heading)
    let blocked = false
    const ahead = gp.clone().addScaledVector(fwd, 7)
    if (ahead.distanceTo(player.pos) < 2.4 && !curCar) blocked = true
    for (const o of cars) if (o !== c && o.cm.group.position.distanceTo(ahead) < 3.4) blocked = true
    const targetSpeed = blocked ? 0 : 10.5
    c.speed += clamp(targetSpeed - c.speed, -16 * dt, 4.5 * dt)
    gp.addScaledVector(fwd, c.speed * dt)
    c.cm.group.rotation.y = c.heading
    for (const w of c.cm.wheels) w.rotation.x += c.speed / 0.36 * dt
    c.cm.brakeMat.emissiveIntensity = blocked || c.speed < targetSpeed - 1 ? 1.6 : 0.3
    // hit pedestrian/player check handled by distance
    if (!curCar && gp.distanceTo(player.pos) < 1.9 && Math.abs(c.speed) > 3) { damagePlayer(12, gp); player.vel.x += fwd.x * 6; player.pos.addScaledVector(fwd, 1.2) }
  }
  // player car
  if (curCar) {
    const c = curCar, gp = c.cm.group.position
    const spec = c.spec
    const throttle = keys.has('KeyW') ? 1 : 0, brakeIn = keys.has('KeyS') ? 1 : 0
    const steerIn = (keys.has('KeyA') ? 1 : 0) + (keys.has('KeyD') ? -1 : 0)
    const maxSteer = steerAtSpeed(spec, c.speed)
    c.steerVis += clamp(steerIn * maxSteer - c.steerVis, -4 * dt * maxSteer * 2, 4 * dt * maxSteer * 2)
    let f = c.speed
    if (c.dead) { f += clamp(0 - f, -10 * dt, 10 * dt) }
    else if (throttle) f += (spec.topSpeed / spec.accelTime) * 2.1 * clamp(1 - f / spec.topSpeed, 0, 1) * dt
    else if (brakeIn) { if (f > 0.6) f += spec.brake * dt; else f = Math.max(-spec.reverse, f - 6 * dt) }
    f -= f * 0.32 * dt // drag / rolling resistance sets top speed with engine taper
    if (!throttle && !brakeIn) f += clamp(0 - f, -2.2 * dt, 2.2 * dt)
    if (keys.has('Space')) f += clamp(0 - f, -7 * dt, 7 * dt)
    // bicycle yaw
    if (Math.abs(f) > 0.05) c.heading += (f / 2.7) * Math.tan(c.steerVis) * dt * (keys.has('Space') ? 1.5 : 1)
    c.speed = f
    const fwd = fwdOf(c.heading)
    gp.addScaledVector(fwd, f * dt)
    gp.x = clamp(gp.x, -294, 294); gp.z = clamp(gp.z, -294, 234)
    // collisions: two probe points
    for (const off of [1.9, -1.9]) {
      const probe = gp.clone().addScaledVector(fwd, off)
      const before = probe.clone()
      collideAABB(colliders, probe, 1.02, 0)
      if (probe.distanceToSquared(before) > 0.0004) {
        const sev = Math.min(1, Math.abs(f) / 18)
        gp.add(probe.clone().sub(before))
        if (Math.abs(f) > 3) { audio.crash(sev); damageCar(c, 4 + sev * 20); burst(probe.clone().setY(0.8), COL_SPARK, 8, 2, 0.3) }
        c.speed *= (1 - sev * 0.75)
        f = c.speed
      }
    }
    c.cm.group.position.copy(gp); c.cm.group.rotation.y = c.heading
    c.cm.group.rotation.z = clamp(-c.steerVis * f * 0.006, -0.06, 0.06)
    for (const w of c.cm.wheels) w.rotation.x += f / 0.36 * dt
    for (const fw2 of c.cm.frontWheels) fw2.rotation.y = c.steerVis
    c.cm.brakeMat.emissiveIntensity = brakeIn ? 1.8 : 0.3
    c.cm.headMat.emissiveIntensity = 2.2
    if (keys.has('Space') && Math.abs(f) > 6) audio.skid(0.5)
    // run-overs
    for (const z of zombies) {
      const zd = z.h.group.position.distanceTo(gp)
      if (zd < 2.3 && z.state !== 'die' && z.state !== 'dead') {
        const dmg = runOverDamage(f)
        if (dmg > 0) { damageZombie(z, dmg, false, z.h.group.position.clone().setY(1)); audio.crash(0.3); if (z.type === 'brute') damageCar(c, 8) }
        else if (Math.abs(f) > 0.5) { z.h.group.position.addScaledVector(fwd, 1.4); z.state = 'stagger'; z.t = 0 }
      }
    }
    for (const pd of peds) {
      const pdDist = pd.h.group.position.distanceTo(gp)
      if (pdDist < 2.2) {
        if (Math.abs(f) < 5) { pd.state = 'flee'; pd.t = 4 } // dive away
        else { pd.state = 'flee'; pd.t = 5; pd.h.group.position.addScaledVector(fwd, 2.5); subtitle('You clipped a pedestrian — they scramble up and run. No police in this district tonight.') }
      }
    }
    // engine audio + headlights
    audio.engineUpdate(clamp(Math.abs(f) / spec.topSpeed, 0, 1), throttle)
    carLight.position.copy(gp).addScaledVector(fwd, 1.5).setY(1.0)
    carLight.target.position.copy(gp).addScaledVector(fwd, 24).setY(0.2)
    carLight.intensity = 260
    if (c.hp < 30 && Math.random() < dt * 2) burst(gp.clone().addScaledVector(fwd, -1.8).setY(1.2), COL_DUST, 2, 0.7, 0.7)
    // mechanic
    if (mechanicT > 0) {
      if (Math.abs(f) > 0.5) { mechanicT = -1; toast('Mechanic cancelled — you moved') }
      else { mechanicT -= dt; if (mechanicT <= 0) { c.hp = 100; c.dead = false; toast('Mechanic: good as new. -$100 already paid'); audio.buy() } }
    }
    $('car-hud').classList.remove('hidden')
    $('car-speed').textContent = `${Math.round(Math.abs(f) * 3.6)} km/h`
    $('car-hp').textContent = `Car HP ${Math.max(0, Math.round(c.hp))}`
  } else {
    $('car-hud').classList.add('hidden')
  }
}

function updateWorld(dt: number) {
  world.update(dt, elapsed)
  // pickups
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i]; p.t -= dt
    p.mesh.rotation.y += dt * 2; p.mesh.position.y = 0.35 + Math.sin(elapsed * 3 + i) * 0.08
    const d = p.mesh.position.distanceTo(player.pos)
    if (d < 1.5 && !curCar) {
      if (p.kind === 'health' && player.hp < 100) { heal(30); audio.pickup(); subtitle('+30 health'); scene.remove(p.mesh); pickups.splice(i, 1); continue }
      if (p.kind === 'ammo') { refillAmmo(0.5); audio.pickup(); subtitle('Ammo +50% reserves'); scene.remove(p.mesh); pickups.splice(i, 1); continue }
    }
    if (p.t <= 0) { scene.remove(p.mesh); pickups.splice(i, 1) }
  }
  // orbs
  world.collectibles.forEach((o, i) => {
    if (!o.visible) return
    if (o.position.distanceTo(player.pos) < 1.6) {
      o.visible = false; save.orbs.push(i)
      earn(100, 'Neon orb'); audio.pickup(); persistSave()
      toast(`Neon orb collected — ${save.orbs.length}/20`)
      if (save.orbs.length === 10) pushMessage('Unknown', 'Half the orbs gone. Whoever hides them is impressed. The rest glow brighter near water and rooftops.')
    }
  })
  // ammo drop / medic timers
  if (ammoDropT > 0) { ammoDropT -= dt; if (ammoDropT <= 0) { refillAmmo(0.5); dropPickup(player.pos.x + 1, player.pos.z + 1, 'ammo'); toast('Ammo crate landed at your position'); audio.pickup() } }
  if (medicT > 0) { medicT -= dt; player.hp = Math.min(60, player.hp + 4 * dt); updateHealthHud() }
  // barrels respawn check is time-based in explodeBarrel
  // zone changes
  zoneCheckT -= dt
  if (zoneCheckT <= 0) {
    zoneCheckT = 0.25
    const z = zoneAt(player.pos.x, player.pos.z)
    if (z !== curZone) {
      const wasClub = curZone === 'club'
      curZone = z
      $('zone-name').textContent = z === 'factory' ? 'Dead Shift Factory' : z === 'club' ? 'Velvet Room' : z === 'guns' ? 'Gun Shop' : z === 'clinic' ? 'Clinic' : 'Night District'
      audio.setClubZone(z === 'club')
      if (z === 'club' && !wasClub) {
        if (!save.visitedClub) { save.visitedClub = true; persistSave() }
        subtitle(settings.reduceClub ? 'Velvet Room. House rules: no weapons inside.' : 'Bouncer: No weapons inside. Coat check is free. Stage is straight ahead.')
      }
    }
    // club music audibility by distance when outside
    if (curZone !== 'club') {
      const dClub = Math.hypot(player.pos.x - CLUB.cx, player.pos.z - CLUB.cz)
      audio.setClubLevel(dClub < 30 ? 0.3 : dClub < 70 ? 0.12 : 0.03)
    }
  }
  // interact prompt
  activeInteract = null
  let promptText = ''
  if (curCar) promptText = '<b>E</b> — Exit car'
  else if (!danceState && gstate === 'playing') {
    let bd = Infinity
    for (const it of interactables) {
      if (it.zone && it.zone !== curZone) continue
      const d = Math.hypot(it.x - player.pos.x, it.z - player.pos.z)
      if (d < it.r && d < bd) { const p = it.prompt(); if (p) { bd = d; activeInteract = it; promptText = `<b>E</b> — ${p}` } }
    }
    if (!activeInteract) {
      const c = nearestCarForEntry()
      if (c) promptText = `<b>E</b> — Get in car (${c.kind})`
    }
  }
  if (promptText) { $('interact').innerHTML = promptText; $('interact').classList.remove('hidden') }
  else if (!danceState) $('interact').classList.add('hidden')
  // hold-to-tip at the club rail
  if (keys.has('KeyE') && curZone === 'club' && !danceState && Math.abs(player.pos.x - (CLUB.cx + 6.6)) < 3 && Math.abs(player.pos.z - CLUB.cz) < 8) {
    tipT += dt
    if (tipT > 0.45) {
      tipT = 0
      if (save.cash >= 5) {
        save.cash -= 5; updateCashHud(); audio.cash()
        stageLike += 8
        burst(new THREE.Vector3(CLUB.cx + 8.5, 1.6, player.pos.z + rand(-1, 1)), new THREE.Color(0x8be89a), 5, 1.2, 0.5)
        const d = dancers[0]; d.h.group.lookAt(player.pos.x, 0.8, player.pos.z)
        if (stageLike >= 50 && stageLike < 58) subtitle('The dancer moves to your section of the rail.')
        if (stageLike >= 100) { subtitle('Dancer: You should book a booth, hon.'); stageLike = 60 }
      } else toast('No cash to tip')
    }
  } else tipT = 0
  // dance state
  if (danceState) {
    danceState.t -= dt
    danceState.peekT -= dt
    if (floorDancer) animateHumanoid(floorDancer.h, 'dance', elapsed, 7)
    if (danceState.peekT <= 0) {
      danceState.peeking = !danceState.peeking
      danceState.peekT = danceState.peeking ? 2 : 12
      if (danceState.peeking) { subtitle('The bouncer peers in… flirting pauses itself.'); audio.door() }
    }
    if (keys.has('KeyE') && !danceState.peeking) {
      likeMeter = Math.min(120, likeMeter + 3 * dt)
    }
    $('like-fill').style.width = Math.min(100, likeMeter) + '%'
    $('interact').innerHTML = `<b>Hold E</b> — Flirt · <b>Q</b> — End dance (${Math.ceil(danceState.t)}s)`
    $('interact').classList.remove('hidden')
    if (danceState.t <= 0) endPrivateDance()
  }
  // HUD clocks + objective refresh
  $('clock').textContent = phoneTime()
  if (Math.random() < dt * 2) updateObjective()
}

// ---------------- main loop ----------------
let menuAngle = 0
function animate() {
  requestAnimationFrame(animate)
  const rawDt = Math.min(clockT.getDelta(), 0.05)
  const simRunning = gstate === 'playing' && !phoneOpen && !mapOpen
  const dt = simRunning ? rawDt : 0
  elapsed += rawDt
  // fps auto-quality
  if (settings.quality === 'auto' && !autoLow && gstate === 'playing') {
    fpsAcc += rawDt; fpsN++; fpsT += rawDt
    if (fpsT > 3) { const avg = fpsN / fpsAcc; if (avg < 50) { autoLow = true; applyQuality(true); toast('Auto quality: lowered for smoother frames') } fpsAcc = 0; fpsN = 0; fpsT = 0 }
  }
  world.update(rawDt, elapsed)
  if (gstate === 'menu') {
    menuAngle += rawDt * 0.045
    camera.position.set(Math.sin(menuAngle) * 150, 34, Math.cos(menuAngle) * 150)
    camera.lookAt(-20, 4, -60)
    vm.visible = false
    clubAnimate(elapsed)
    updatePeds(rawDt)
  } else if (gstate === 'playing' || gstate === 'paused' || gstate === 'gameover') {
    if (simRunning) {
      if (!curCar) { updatePlayer(dt); updateWeapons(dt) }
      else {
        // driving camera
        const c = curCar, gp = c.cm.group.position, fwd = fwdOf(c.heading)
        if (carCamMode === 'hood') {
          camera.position.copy(gp).addScaledVector(fwd, 1.9).setY(1.25)
          camera.lookAt(gp.clone().addScaledVector(fwd, 30).setY(1.0))
        } else {
          const dist = 8.5 + Math.abs(c.speed) * 0.06, h = 3.4
          const want = gp.clone().addScaledVector(fwd, -dist).setY(gp.y + h)
          want.x = clamp(want.x, -296, 296); want.z = clamp(want.z, -296, 240)
          camera.position.lerp(want, Math.min(1, rawDt * 5))
          camera.lookAt(gp.clone().addScaledVector(fwd, 5 + Math.abs(c.speed) * 0.25).setY(1.2))
          camera.fov += (((68 + Math.abs(c.speed) / c.spec.topSpeed * 12)) - camera.fov) * Math.min(1, rawDt * 4); camera.updateProjectionMatrix()
        }
        if (firing) { /* no shooting from cars */ }
        player.pos.copy(gp) // player rides with the car
        swapT = Math.max(0, swapT - dt); fireCd = Math.max(0, fireCd - dt)
      }
      updateZombies(dt)
      updatePeds(dt)
      updateCars(dt)
      updateWorld(dt)
      clubAnimate(elapsed)
      minimapT -= dt; if (minimapT <= 0) { minimapT = 1 / 15; drawMinimap() }
    }
    // moon shadow follows player
    moon.position.set(player.pos.x + 60, 90, player.pos.z - 40)
    moon.target.position.copy(player.pos)
  }
  composer.render()
}

// debug/testing hook (also handy for support): window.__deadshift
;(window as any).__deadshift = {
  player, zombies, cars, peds,
  get save() { return save }, get wave() { return wave }, get waveState() { return waveState },
  teleport: (x: number, z: number, yaw = 0) => { player.pos.set(x, 0, z); player.yaw = yaw },
  startGame, spawnZombie, damagePlayer
}

// boot
updateCashHud(); updateHealthHud(); updateAmmoHud(); updateSlotsHud()
$('btn-continue').classList.toggle('hidden', !hasSave)
$('menu-best').textContent = hasSave ? `Best wave ${save.bestWave} · Best score ${save.bestScore} · Cash ${fmtCash(save.cash)} · Orbs ${save.orbs.length}/20` : 'New game — you start with a pistol and $500.'
$('load-fill').style.width = '100%'
setTimeout(() => {
  $('loading').classList.add('hidden')
  $('fade').style.opacity = '0'
  setTimeout(() => $('fade').classList.add('hidden'), 350)
  gstate = 'menu'
}, 500)
animate()

// Pure game-design data + math, taken from the research report (sections 4, 5, 9, 11).
// Kept free of Three.js so it can be unit-tested.

export interface WeaponSpec {
  id: string
  name: string
  dmg: number
  headMult: number
  rpm: number
  mag: number
  reserve: number
  reload: number // seconds (shotgun: per shell)
  pellets: number
  spreadHip: number // degrees
  spreadAds: number
  falloffNear: number
  falloffFar: number
  falloffFloor: number // fraction of damage at falloffFar
  price: number
  auto: boolean
  scoped?: boolean
  kick: number // degrees of viewmodel/camera kick per shot
}

export const WEAPONS: WeaponSpec[] = [
  { id: 'pistol', name: 'P-9 Sidearm', dmg: 34, headMult: 2.0, rpm: 300, mag: 12, reserve: Infinity, reload: 1.4, pellets: 1, spreadHip: 1.6, spreadAds: 0.7, falloffNear: 15, falloffFar: 40, falloffFloor: 0.45, price: 0, auto: false, kick: 0.5 },
  { id: 'smg', name: 'VK-9 SMG', dmg: 16, headMult: 2.5, rpm: 900, mag: 32, reserve: 256, reload: 1.9, pellets: 1, spreadHip: 2.4, spreadAds: 1.2, falloffNear: 12, falloffFar: 30, falloffFloor: 0.4, price: 1500, auto: true, kick: 0.4 },
  { id: 'ar', name: 'AR-15 Carbine', dmg: 26, headMult: 2.0, rpm: 660, mag: 30, reserve: 240, reload: 2.1, pellets: 1, spreadHip: 1.8, spreadAds: 0.5, falloffNear: 20, falloffFar: 60, falloffFloor: 0.5, price: 2500, auto: true, kick: 0.7 },
  { id: 'shotgun', name: 'M870 Pump', dmg: 12, headMult: 1.5, rpm: 68, mag: 6, reserve: 48, reload: 0.55, pellets: 8, spreadHip: 5.0, spreadAds: 3.5, falloffNear: 6, falloffFar: 18, falloffFloor: 0.4, price: 2000, auto: false, kick: 1.2 },
  { id: 'sniper', name: 'Longshot DMR', dmg: 120, headMult: 3.0, rpm: 48, mag: 5, reserve: 30, reload: 2.8, pellets: 1, spreadHip: 4.0, spreadAds: 0.05, falloffNear: 120, falloffFar: 121, falloffFloor: 1.0, price: 4000, auto: false, scoped: true, kick: 1.1 }
]
export const weaponById = (id: string) => WEAPONS.find(w => w.id === id)!

export function falloff(spec: WeaponSpec, dist: number): number {
  if (dist <= spec.falloffNear) return 1
  if (dist >= spec.falloffFar) return spec.falloffFloor
  const t = (dist - spec.falloffNear) / (spec.falloffFar - spec.falloffNear)
  return 1 - t * (1 - spec.falloffFloor)
}

export interface ZombieSpec { hp: number; speed: number; dmg: number; scale: number }
export const ZOMBIE_TYPES: Record<string, ZombieSpec> = {
  walker: { hp: 100, speed: 2.6, dmg: 10, scale: 1.0 },
  runner: { hp: 70, speed: 4.6, dmg: 10, scale: 0.95 },
  brute: { hp: 450, speed: 1.9, dmg: 25, scale: 1.45 },
  spitter: { hp: 150, speed: 2.4, dmg: 8, scale: 1.05 }
}

export function waveCount(wave: number): number { return 6 + 4 * wave }
export function waveHpMult(wave: number): number { return Math.min(4, 1 + 0.18 * (wave - 1)) }
export function waveSpeedMult(wave: number): number { return Math.min(1.3, 1 + 0.02 * (wave - 1)) }
export function spawnInterval(wave: number): number { return Math.max(0.7, 2.0 - 0.09 * (wave - 1)) }
export function waveClearBonus(wave: number): number { return 250 + 50 * wave }
export function zombieTypeFor(wave: number, roll: number): string {
  if (wave >= 5 && roll < 0.07) return 'brute'
  if (wave >= 7 && roll < 0.2) return 'spitter'
  if (wave >= 3 && roll < 0.38) return 'runner'
  return 'walker'
}

export interface CarSpec { topSpeed: number; accelTime: number; brake: number; reverse: number; steerMax: number }
export const CAR_SPECS: Record<string, CarSpec> = {
  sedan: { topSpeed: 38, accelTime: 5.5, brake: -14, reverse: 8, steerMax: 32 },
  sports: { topSpeed: 52, accelTime: 3.6, brake: -16, reverse: 8, steerMax: 30 },
  van: { topSpeed: 32, accelTime: 7.0, brake: -11, reverse: 7, steerMax: 34 }
}
export function steerAtSpeed(spec: CarSpec, speed: number): number {
  const t = Math.min(1, Math.abs(speed) / spec.topSpeed)
  const minDeg = spec.steerMax - 18
  return (spec.steerMax + (minDeg - spec.steerMax) * t) * Math.PI / 180
}
export function runOverDamage(forwardSpeed: number): number {
  const s = Math.abs(forwardSpeed)
  if (s < 3) return 0
  return Math.min(130, Math.max(0, s * 9))
}

// Simple grid A* used by zombies (factory grid) and reusable elsewhere.
export interface GridCell { x: number; z: number }
export function astar(
  cols: number, rows: number, blocked: Uint8Array,
  start: GridCell, goal: GridCell
): GridCell[] {
  const key = (x: number, z: number) => z * cols + x
  const open = new Map<number, number>()
  const came = new Map<number, number>()
  const gScore = new Map<number, number>()
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < cols && z < rows
  if (!inside(start.x, start.z) || !inside(goal.x, goal.z)) return []
  const h = (x: number, z: number) => Math.abs(x - goal.x) + Math.abs(z - goal.z)
  gScore.set(key(start.x, start.z), 0)
  open.set(key(start.x, start.z), h(start.x, start.z))
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  let guard = 0
  while (open.size && guard++ < 20000) {
    let cur = -1, best = Infinity
    for (const [k, f] of open) if (f < best) { best = f; cur = k }
    if (cur === key(goal.x, goal.z)) {
      const path: GridCell[] = []
      let c = cur
      while (c !== key(start.x, start.z)) {
        path.push({ x: c % cols, z: Math.floor(c / cols) })
        c = came.get(c)!
      }
      path.reverse()
      return path
    }
    open.delete(cur)
    const cx = cur % cols, cz = Math.floor(cur / cols)
    for (const [dx, dz] of dirs) {
      const nx = cx + dx, nz = cz + dz
      if (!inside(nx, nz)) continue
      const nk = key(nx, nz)
      if (blocked[nk] && nk !== key(goal.x, goal.z)) continue
      const g = (gScore.get(cur) ?? Infinity) + 1
      if (g < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, g)
        came.set(nk, cur)
        open.set(nk, g + h(nx, nz))
      }
    }
  }
  return []
}

export const fmtCash = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

import { describe, it, expect } from 'vitest'
import { WEAPONS, weaponById, falloff, waveCount, waveHpMult, spawnInterval, zombieTypeFor, runOverDamage, steerAtSpeed, CAR_SPECS, astar } from '../src/data'

describe('weapons (report §5)', () => {
  it('has the five-weapon roster', () => {
    expect(WEAPONS.map(w => w.id)).toEqual(['pistol', 'smg', 'ar', 'shotgun', 'sniper'])
  })
  it('sniper one-body-shots a wave-1 walker', () => {
    expect(weaponById('sniper').dmg).toBeGreaterThanOrEqual(100)
  })
  it('shotgun fires 8 pellets', () => {
    expect(weaponById('shotgun').pellets).toBe(8)
  })
  it('falloff is 1 up close and floors at range', () => {
    const ar = weaponById('ar')
    expect(falloff(ar, 5)).toBe(1)
    expect(falloff(ar, 500)).toBeCloseTo(0.5)
    expect(falloff(ar, 40)).toBeGreaterThan(0.5)
    expect(falloff(ar, 40)).toBeLessThan(1)
  })
})

describe('waves (report §4)', () => {
  it('count and hp scale, hp capped at 4x', () => {
    expect(waveCount(1)).toBe(10)
    expect(waveCount(5)).toBe(26)
    expect(waveHpMult(1)).toBe(1)
    expect(waveHpMult(30)).toBe(4)
  })
  it('spawn interval shrinks but never below 0.7s', () => {
    expect(spawnInterval(1)).toBeCloseTo(2.0)
    expect(spawnInterval(50)).toBe(0.7)
  })
  it('brutes only appear from wave 5', () => {
    expect(zombieTypeFor(2, 0.01)).toBe('walker')
    expect(zombieTypeFor(6, 0.01)).toBe('brute')
  })
})

describe('cars (report §11)', () => {
  it('run-over damage is a shove below 3 m/s and lethal above 8', () => {
    expect(runOverDamage(2)).toBe(0)
    expect(runOverDamage(10)).toBe(90)
    expect(runOverDamage(50)).toBe(130)
  })
  it('steering shrinks with speed', () => {
    const slow = steerAtSpeed(CAR_SPECS.sedan, 0)
    const fast = steerAtSpeed(CAR_SPECS.sedan, 38)
    expect(fast).toBeLessThan(slow)
  })
})

describe('astar', () => {
  it('routes around a wall', () => {
    const cols = 5, rows = 5
    const blocked = new Uint8Array(cols * rows)
    for (let z = 0; z < 4; z++) blocked[z * cols + 2] = 1
    const path = astar(cols, rows, blocked, { x: 0, z: 2 }, { x: 4, z: 2 })
    expect(path.length).toBeGreaterThan(4)
    expect(path[path.length - 1]).toEqual({ x: 4, z: 2 })
    expect(path.some(p => p.x === 2 && p.z === 4)).toBe(true)
  })
  it('returns empty when start is out of bounds', () => {
    expect(astar(3, 3, new Uint8Array(9), { x: -1, z: 0 }, { x: 1, z: 1 })).toEqual([])
  })
})

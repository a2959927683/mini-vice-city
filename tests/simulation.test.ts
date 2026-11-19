import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/simulation'
import { Wanted } from '../src/sim/wanted'

let sim: Simulation

beforeEach(async () => {
  sim = await Simulation.create()
})

afterEach(() => sim.dispose())

describe('fixed-step district', () => {
  it('boots Rapier and settles the player on the road after 300 steps', () => {
    expect(sim.district.blocks).toHaveLength(16)
    expect(sim.district.graph.intersections.size).toBe(25)
    const start = sim.player.pose
    for (let i = 0; i < 300; i++) sim.step()

    const { frame, vehicles } = sim.snapshot()
    const player = vehicles[0]
    expect(frame).toBe(300)
    expect(vehicles.filter(({ kind }) => kind === 'police')).toHaveLength(2)
    expect(player.position.y).toBeGreaterThan(0.3)
    expect(player.position.y).toBeLessThan(0.66)
    expect(Math.abs(sim.player.body.linvel().y)).toBeLessThan(0.08)
    expect(player.position.x).toBeCloseTo(start.x, 1)
    expect(player.position.z).toBeCloseTo(start.z, 1)
  })

  it('keeps the average headless tick well under the 16 ms budget', () => {
    const drive = { throttle: 1, steer: 0, handbrake: false }
    for (let i = 0; i < 90; i++) sim.step(drive)
    const ticks = 600
    const start = performance.now()
    for (let i = 0; i < ticks; i++) {
      sim.step({ ...drive, steer: Math.sin(i * 0.035) * 0.7, handbrake: i % 120 > 100 })
    }
    const millisecondsPerTick = (performance.now() - start) / ticks
    expect(millisecondsPerTick).toBeLessThan(8)
  })

  it('gets moving quickly and responds to steering and the handbrake', () => {
    for (let i = 0; i < 75; i++) sim.step({ throttle: 1, steer: 0, handbrake: false })
    const straight = sim.player.pose
    expect(straight.speed).toBeGreaterThan(10)
    for (let i = 0; i < 24; i++) sim.step({ throttle: 1, steer: 0.8, handbrake: true })
    expect(sim.player.pose.heading).toBeGreaterThan(0.28)
    expect(sim.player.pose.speed).toBeLessThan(straight.speed)
  })
})

describe('wanted and police', () => {
  it('detects a real police contact, searches, cools down, and clears after evasion', () => {
    expect(sim.wanted.level).toBe(0)
    for (let i = 0; i < 10; i++) sim.step()
    sim.stagePoliceCollision()
    for (let i = 0; i < 12; i++) sim.step()
    expect(sim.wanted.level).toBeGreaterThanOrEqual(1)
    expect(sim.wanted.mode).toBe('PURSUIT')

    sim.teleportPlayer(sim.district.evadePoint)
    for (let i = 0; i < 50; i++) sim.step()
    expect(sim.wanted.mode).toBe('SEARCH')
    expect(sim.wanted.progress).toBeGreaterThan(0)

    for (let i = 0; i < 240; i++) sim.step()
    expect(sim.wanted.mode).toBe('COOLDOWN')
    expect(sim.wanted.level).toBeGreaterThan(0)
    for (let i = 0; i < 190; i++) sim.step()
    expect(sim.snapshot().wanted).toMatchObject({ level: 0, mode: 'PATROL', progress: 0, center: null })
  })

  it('requires continuous evasion and caps escalation at five stars', () => {
    const wanted = new Wanted()
    for (let i = 0; i < 8; i++) {
      wanted.offense()
      wanted.step(1, true, false)
    }
    expect(wanted.level).toBe(5)
    wanted.step(2, false, true)
    expect(wanted.progress).toBeGreaterThan(0)
    wanted.step(1, false, false)
    expect(wanted.progress).toBe(0)
    wanted.step(1, true, true)
    expect(wanted.mode).toBe('PURSUIT')
    expect(wanted.level).toBe(5)
  })
})

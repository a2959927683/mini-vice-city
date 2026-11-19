import RAPIER from '@dimforge/rapier3d-compat'
import { expect, it } from 'vitest'
import type { DriveInput } from '../src/sim/drivers'
import { FIXED_DT, initializeRapier } from '../src/sim/physics'
import { NEUTRAL, Vehicle } from '../src/sim/vehicle'

function slalomInput(tick: number): DriveInput {
  if (tick <= 100) return { throttle: 1, steer: 0, handbrake: false }
  if (tick <= 140) return { throttle: 1, steer: 1, handbrake: true }
  if (tick <= 200) return { throttle: 1, steer: -1, handbrake: false }
  return NEUTRAL
}

it('keeps the four-wheel chassis upright through a 300-tick handbrake slalom', async () => {
  await initializeRapier()
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  try {
    world.timestep = FIXED_DT
    world.createCollider(RAPIER.ColliderDesc.cuboid(150, 0.25, 150).setTranslation(0, -0.25, 0))
    const car = new Vehicle(world, 0, 'player', { x: 0, z: 0, yaw: 0, laneId: '' })
    world.step()

    let previousVelocity = car.body.linvel()
    let contactGap = 0
    let longestContactGap = 0
    let minUpY = 1
    let maxSpeed = 0
    let maxSpeedChange = 0
    let maxAngularSpeed = 0
    let milliseconds = 0
    let accelerateSpeed = 0
    let leftHeading = 0
    let rightHeading = 0

    for (let tick = 0; tick < 300; tick++) {
      const started = performance.now()
      car.drive(slalomInput(tick), FIXED_DT)
      world.step()
      milliseconds += performance.now() - started

      const q = car.body.rotation()
      const linear = car.body.linvel()
      const angular = car.body.angvel()
      expect([q.x, q.y, q.z, q.w, linear.x, linear.y, linear.z, angular.x, angular.y, angular.z].every(Number.isFinite))
        .toBe(true)
      minUpY = Math.min(minUpY, 1 - 2 * (q.x ** 2 + q.z ** 2))
      maxSpeed = Math.max(maxSpeed, Math.hypot(linear.x, linear.y, linear.z))
      maxSpeedChange = Math.max(maxSpeedChange, Math.hypot(
        linear.x - previousVelocity.x, linear.y - previousVelocity.y, linear.z - previousVelocity.z,
      ))
      maxAngularSpeed = Math.max(maxAngularSpeed, Math.hypot(angular.x, angular.y, angular.z))
      previousVelocity = linear

      contactGap = car.wheelContacts.every((wheel) => wheel.grounded) ? 0 : contactGap + 1
      longestContactGap = Math.max(longestContactGap, contactGap)
      if (tick === 100) accelerateSpeed = car.pose.speed
      if (tick === 140) leftHeading = car.pose.heading
      if (tick === 200) rightHeading = car.pose.heading
    }

    expect(car.wheelContacts).toHaveLength(4)
    expect(car.wheelContacts.every((wheel) => wheel.grounded)).toBe(true)
    expect(longestContactGap).toBeLessThanOrEqual(10)
    expect(minUpY).toBeGreaterThanOrEqual(Math.cos(Math.PI * 0.15))
    expect(maxSpeed).toBeLessThan(38)
    expect(maxSpeedChange).toBeLessThan(1.25)
    expect(maxAngularSpeed).toBeLessThan(7)
    expect(milliseconds / 300).toBeLessThan(16)
    expect(accelerateSpeed).toBeGreaterThan(10)
    expect(leftHeading).toBeGreaterThan(0.55)
    expect(rightHeading).toBeLessThan(leftHeading - 0.45)
  } finally {
    world.free()
  }
})

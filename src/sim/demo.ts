import RAPIER from '@dimforge/rapier3d-compat'
import type { DriveInput } from './drivers'
import { FIXED_DT, initializeRapier } from './physics'
import { Vehicle } from './vehicle'

export const RANGE_EDGE = 115
const SPAWN = { x: -2, z: -40, yaw: 0, laneId: '' }

export interface DemoSnapshot {
  position: RAPIER.Vector3
  rotation: RAPIER.Quaternion
  speed: number
  steer: number
  drifting: boolean
  tilt: number
}

export class DemoSimulation {
  private readonly world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  private readonly car: Vehicle
  private handbrake = false

  static async create(): Promise<DemoSimulation> {
    await initializeRapier()
    return new DemoSimulation()
  }

  private constructor() {
    const world = this.world
    world.timestep = FIXED_DT
    world.createCollider(RAPIER.ColliderDesc.cuboid(RANGE_EDGE + 1, 0.25, RANGE_EDGE + 1)
      .setTranslation(0, -0.25, 0))
    for (const side of [-1, 1]) {
      const edge = side * RANGE_EDGE
      world.createCollider(RAPIER.ColliderDesc.cuboid(RANGE_EDGE, 0.4, 0.35).setTranslation(0, 0.4, edge))
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.35, 0.4, RANGE_EDGE).setTranslation(edge, 0.4, 0))
    }
    this.car = new Vehicle(world, 0, 'player', SPAWN)
    world.step()
  }

  step(input: DriveInput): void {
    this.handbrake = input.handbrake
    this.car.drive(input, FIXED_DT)
    this.world.step()
  }

  reset(): void {
    this.handbrake = false
    this.car.place(SPAWN.x, SPAWN.z, SPAWN.yaw)
    this.world.propagateModifiedBodyPositionsToColliders()
  }

  snapshot(): DemoSnapshot {
    const rotation = this.car.body.rotation()
    const velocity = this.car.body.linvel()
    const speed = Math.hypot(velocity.x, velocity.z)
    const upY = 1 - 2 * (rotation.x ** 2 + rotation.z ** 2)
    return {
      position: this.car.body.translation(),
      rotation,
      speed,
      steer: this.car.steer,
      drifting: this.handbrake && speed > 1.5,
      tilt: Math.acos(Math.max(-1, Math.min(1, upY))),
    }
  }
}

import RAPIER from '@dimforge/rapier3d-compat'
import type { DriveInput, DrivePose } from './drivers'
import type { Spawn } from './district'

export type VehicleKind = 'player' | 'police' | 'traffic'
export const NEUTRAL: DriveInput = { throttle: 0, steer: 0, handbrake: false }
export const CAR_HEIGHT = 0.59

export function yawRotation(yaw: number) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }
}

export class Vehicle {
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  steer = 0
  braking = false
  private reverseHold = 0

  constructor(world: RAPIER.World, readonly id: number, readonly kind: VehicleKind, readonly spawn: Spawn) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, CAR_HEIGHT, spawn.z)
        .setRotation(yawRotation(spawn.yaw))
        .setLinearDamping(0.035)
        .setAngularDamping(2.7)
        .setCcdEnabled(true)
        .setCanSleep(false),
    )
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(0.79, 0.29, 1.79, 0.12)
        .setMass(1080)
        .setFriction(0.18)
        .setRestitution(0.08)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    )
  }

  get pose(): DrivePose {
    const { x, z } = this.body.translation()
    const q = this.body.rotation()
    const fx = 2 * (q.x * q.z + q.w * q.y)
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y)
    const heading = Math.atan2(fx, fz)
    const v = this.body.linvel()
    return { x, z, heading, speed: v.x * Math.sin(heading) + v.z * Math.cos(heading) }
  }

  place(x: number, z: number, yaw: number): void {
    this.body.setTranslation({ x, y: CAR_HEIGHT, z }, true)
    this.body.setRotation(yawRotation(yaw), true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.steer = 0
    this.braking = false
    this.reverseHold = 0
  }

  drive(input: DriveInput, dt: number): void {
    const { heading, speed } = this.pose
    const v = this.body.linvel()
    const q = this.body.rotation()
    const up = { x: 2 * (q.x * q.y - q.w * q.z), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.w * q.x) }
    const angular = this.body.angvel()
    const ground = this.body.translation().y < 0.83 && up.y > 0.2
    this.steer += (input.steer - this.steer) * (1 - Math.exp(-dt * 14))
    this.braking = input.handbrake || input.throttle * speed < -0.5
    if (!ground) return

    const fx = Math.sin(heading)
    const fz = Math.cos(heading)
    const lateral = v.x * fz - v.z * fx
    const max = this.kind === 'player' ? 36 : this.kind === 'police' ? 38 : 22
    const magnitude = Math.abs(speed)
    const braking = speed * input.throttle < -0.4
    this.reverseHold = input.throttle < -0.1 && !braking ? this.reverseHold + dt : 0
    const limit = input.throttle < 0 ? 11 : max
    const creep = this.kind === 'player' && input.throttle < 0 && this.reverseHold < 0.12
    const acceleration = this.kind === 'traffic' ? 10 : this.kind === 'police' ? 17.5 : 17
    const motor = braking ? 16 : creep ? 0 : acceleration * Math.max(0, 1 - magnitude / limit)
    const drag = (input.handbrake ? 2.2 : 0.21) * speed
    const forwardDelta = (input.throttle * motor - drag) * dt
    const grip = input.handbrake ? 1.75 : this.kind === 'player' ? 9.4 : 11
    const slideDelta = -lateral * (1 - Math.exp(-grip * dt))

    this.body.applyImpulse({
      x: 1080 * (fx * forwardDelta + fz * slideDelta),
      y: 0,
      z: 1080 * (fz * forwardDelta - fx * slideDelta),
    }, true)

    const speedGain = Math.min(magnitude / 3.2, 1)
    const steering = this.steer * Math.sign(speed) * speedGain * (2.65 / (1 + magnitude * 0.038))
    const yaw = steering * (input.handbrake ? 1.34 : 1)
    const stability = 1 - Math.exp(-dt * 7)
    this.body.setAngvel({
      x: angular.x + (-up.z * 10 - angular.x) * stability,
      y: angular.y + (yaw - angular.y) * (1 - Math.exp(-dt * 12)),
      z: angular.z + (up.x * 10 - angular.z) * stability,
    }, true)
  }
}

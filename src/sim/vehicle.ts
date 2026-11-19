import RAPIER from '@dimforge/rapier3d-compat'
import type { DriveInput, DrivePose } from './drivers'
import type { Spawn } from './district'

export type VehicleKind = 'player' | 'police' | 'traffic'
export const NEUTRAL: DriveInput = { throttle: 0, steer: 0, handbrake: false }
export const CAR_HEIGHT = 0.59

const MASS = 1080
const MOUNT_Y = 0.08
const CENTER_OF_MASS_Y = MOUNT_Y - 0.2
const WHEEL_RADIUS = 0.31
const REST_TRAVEL = 0.42
const DROOP = 0.12
const RAY_LENGTH = WHEEL_RADIUS + REST_TRAVEL + DROOP
const SPRING_RATE = 29_500
const DAMPER_RATE = 3_300
const ANTI_ROLL_RATE = 10_500
const MAX_SUPPORT = 16_000
const STABILIZE_ANGLE = Math.PI / 15
const MAX_STEER = Math.PI / 4
const ROAD_FILTER = RAPIER.QueryFilterFlags.ONLY_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS

const MOUNTS = [
  { x: 0.75, y: MOUNT_Y, z: 1.17 },
  { x: -0.75, y: MOUNT_Y, z: 1.17 },
  { x: 0.75, y: MOUNT_Y, z: -1.17 },
  { x: -0.75, y: MOUNT_Y, z: -1.17 },
] as const

export interface WheelContact {
  readonly grounded: boolean
  readonly point: RAPIER.Vector3 | null
  readonly compression: number
}

interface RoadContact {
  point: RAPIER.Vector3
  normal: RAPIER.Vector3
  velocity: RAPIER.Vector3
  compression: number
  support: number
}

function dot(a: RAPIER.Vector3, b: RAPIER.Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: RAPIER.Vector3, b: RAPIER.Vector3): RAPIER.Vector3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function rotate(v: RAPIER.Vector3, q: RAPIER.Quaternion): RAPIER.Vector3 {
  const t = cross(q, v)
  t.x *= 2
  t.y *= 2
  t.z *= 2
  const u = cross(q, t)
  return { x: v.x + q.w * t.x + u.x, y: v.y + q.w * t.y + u.y, z: v.z + q.w * t.z + u.z }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function emptyWheelContacts(): WheelContact[] {
  return MOUNTS.map(() => ({ grounded: false, point: null, compression: 0 }))
}

export function yawRotation(yaw: number) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }
}

export class Vehicle {
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  steer = 0
  braking = false
  private reverseHold = 0
  private wheels = emptyWheelContacts()

  constructor(
    private readonly world: RAPIER.World,
    readonly id: number,
    readonly kind: VehicleKind,
    readonly spawn: Spawn,
  ) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, CAR_HEIGHT, spawn.z)
        .setRotation(yawRotation(spawn.yaw))
        .setLinearDamping(0.035)
        .setAngularDamping(0.65)
        .setCcdEnabled(true)
        .setCanSleep(false)
        .setAdditionalMassProperties(
          MASS,
          { x: 0, y: CENTER_OF_MASS_Y, z: 0 },
          { x: 1380, y: 1600, z: 460 },
          yawRotation(0),
        ),
    )
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(0.79, 0.19, 1.79, 0.1)
        .setDensity(0)
        .setFriction(0.16)
        .setRestitution(0.06)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    )
  }

  /** Front left, front right, rear left, rear right in the last suspension update. */
  get wheelContacts(): readonly WheelContact[] {
    return this.wheels
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
    this.wheels = emptyWheelContacts()
  }

  drive(input: DriveInput, dt: number): void {
    const position = this.body.translation()
    const rotation = this.body.rotation()
    const up = rotate({ x: 0, y: 1, z: 0 }, rotation)
    const flatForward = rotate({ x: 0, y: 0, z: 1 }, rotation)
    const forwardLength = Math.hypot(flatForward.x, flatForward.z) || 1
    const linear = this.body.linvel()
    const speed = (linear.x * flatForward.x + linear.z * flatForward.z) / forwardLength
    const magnitude = Math.abs(speed)
    const throttle = clamp(input.throttle, -1, 1)
    const serviceBrake = speed * throttle < -0.4
    this.reverseHold = throttle < -0.1 && !serviceBrake ? this.reverseHold + dt : 0
    this.steer += (clamp(input.steer, -1, 1) - this.steer) * (1 - Math.exp(-dt * 17))
    this.braking = input.handbrake || serviceBrake

    const contacts = MOUNTS.map((mount) => this.suspension(mount, position, rotation, up))
    this.wheels = contacts.map((contact) => contact
      ? { grounded: true, point: contact.point, compression: contact.compression }
      : { grounded: false, point: null, compression: 0 })
    this.transferAxleLoad(contacts[0], contacts[1])
    this.transferAxleLoad(contacts[2], contacts[3])

    const limit = throttle < 0 ? 11 : this.kind === 'player' ? 36 : this.kind === 'police' ? 38 : 22
    const acceleration = this.kind === 'traffic' ? 11 : this.kind === 'police' ? 20 : 19.5
    const delayingReverse = this.kind === 'player' && throttle < 0 && this.reverseHold < 0.12
    const motorForce = delayingReverse && !serviceBrake ? 0
      : throttle * MASS * (serviceBrake ? 16 : acceleration * Math.max(0, 1 - magnitude / limit))
    const steeringRatio = input.handbrake ? 1 : 1 + magnitude * 0.072
    const steerAngle = this.steer * MAX_STEER / steeringRatio
    const frontDirection = rotate({ x: Math.sin(steerAngle), y: 0, z: Math.cos(steerAngle) }, rotation)

    contacts.forEach((contact, index) => {
      if (!contact) return
      const front = index < 2
      const handbrake = input.handbrake && !front
      const drive = input.handbrake ? (front ? motorForce * 0.045 : 0) : motorForce * 0.25
      this.applyWheelImpulse(contact, front ? frontDirection : flatForward, drive, handbrake, dt)
    })
    this.stabilizeAttitude(up, dt)
  }

  private suspension(
    mount: RAPIER.Vector3,
    position: RAPIER.Vector3,
    rotation: RAPIER.Quaternion,
    up: RAPIER.Vector3,
  ): RoadContact | null {
    const offset = rotate(mount, rotation)
    const origin = { x: position.x + offset.x, y: position.y + offset.y, z: position.z + offset.z }
    const ray = new RAPIER.Ray(origin, { x: -up.x, y: -up.y, z: -up.z })
    const hit = this.world.castRayAndGetNormal(ray, RAY_LENGTH, true, ROAD_FILTER, undefined, this.collider, this.body)
    if (!hit || hit.normal.y < 0.5) return null

    const point = ray.pointAt(hit.timeOfImpact)
    const normal = hit.normal
    const velocity = this.body.velocityAtPoint(point)
    const compression = clamp(WHEEL_RADIUS + REST_TRAVEL - hit.timeOfImpact, -DROOP, REST_TRAVEL)
    const support = clamp(SPRING_RATE * Math.max(0, compression) - DAMPER_RATE * dot(velocity, normal), 0, MAX_SUPPORT)
    return { point, normal, velocity, compression, support }
  }

  private transferAxleLoad(left: RoadContact | null, right: RoadContact | null): void {
    if (!left || !right) return
    const force = ANTI_ROLL_RATE * (left.compression - right.compression)
    const transfer = clamp(force, -left.support, right.support)
    left.support += transfer
    right.support -= transfer
  }

  private applyWheelImpulse(
    { normal, point, support, velocity }: RoadContact,
    direction: RAPIER.Vector3,
    driveForce: number,
    handbrake: boolean,
    dt: number,
  ): void {
    if (support <= 0) return
    const inclination = dot(direction, normal)
    const tangent = {
      x: direction.x - normal.x * inclination,
      y: direction.y - normal.y * inclination,
      z: direction.z - normal.z * inclination,
    }
    const tangentLength = Math.hypot(tangent.x, tangent.y, tangent.z) || 1
    const forward = { x: tangent.x / tangentLength, y: tangent.y / tangentLength, z: tangent.z / tangentLength }
    const sideways = cross(normal, forward)
    const longitudinal = dot(velocity, forward)
    const lateral = dot(velocity, sideways)
    const slip = clamp(Math.atan2(lateral, Math.max(1.8, Math.abs(longitudinal))), -0.85, 0.85)

    const grip = support * (handbrake ? 0.58 : 1.65)
    const brakeForce = handbrake ? longitudinal * 950 : 0
    const drag = longitudinal * (55 + 1.7 * Math.abs(longitudinal))
    const drive = clamp(driveForce - drag - brakeForce, -grip * 0.88, grip * 0.88)
    const availableLateral = Math.sqrt(Math.max(0, grip * grip - drive * drive))
    const tire = clamp(-slip * (handbrake ? 2_900 : 13_000), -availableLateral, availableLateral)

    this.body.applyImpulseAtPoint({
      x: (normal.x * support + forward.x * drive + sideways.x * tire) * dt,
      y: (normal.y * support + forward.y * drive + sideways.y * tire) * dt,
      z: (normal.z * support + forward.z * drive + sideways.z * tire) * dt,
    }, point, true)
  }

  private stabilizeAttitude(up: RAPIER.Vector3, dt: number): void {
    const angle = Math.acos(clamp(up.y, -1, 1))
    if (angle <= STABILIZE_ANGLE) return

    const angular = this.body.angvel()
    const damping = Math.exp(-dt * 13)
    const correction = Math.min(1.8, (angle - STABILIZE_ANGLE) * 22) * (1 - damping)
    const horizontalLength = Math.hypot(up.x, up.z) || 1
    this.body.setAngvel({
      x: angular.x * damping - (up.z / horizontalLength) * correction,
      y: angular.y,
      z: angular.z * damping + (up.x / horizontalLength) * correction,
    }, true)
  }
}

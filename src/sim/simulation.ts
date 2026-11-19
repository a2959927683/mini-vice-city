import RAPIER from '@dimforge/rapier3d-compat'
import { createDistrict, type District, type Point2, type Prop } from './district'
import { Driver, type DriveInput, type DrivePose } from './drivers'
import { Pedestrians, type PedestrianSnapshot } from './pedestrians'
import { CAR_HEIGHT, NEUTRAL, Vehicle, type VehicleKind } from './vehicle'
import { SEARCH_RADIUS, SIGHT_RADIUS, Wanted, type PoliceMode } from './wanted'

export const FIXED_DT = 1 / 60

export const PROP_HALF_SIZE = {
  hydrant: { x: 0.29, y: 0.45, z: 0.29 },
  pole: { x: 0.16, y: 1.48, z: 0.16 },
  bollard: { x: 0.19, y: 0.52, z: 0.19 },
} satisfies Record<Prop['kind'], { x: number; y: number; z: number }>

interface PropBody {
  data: Prop
  collider: RAPIER.Collider
  debris?: RAPIER.RigidBody
  removeAt: number
}

export interface Snapshot {
  frame: number
  vehicles: {
    id: number
    kind: VehicleKind
    position: RAPIER.Vector3
    rotation: RAPIER.Quaternion
    speed: number
    steer: number
    braking: boolean
  }[]
  pedestrians: PedestrianSnapshot[]
  props: {
    id: string
    position: RAPIER.Vector3
    rotation: RAPIER.Quaternion
    broken: boolean
    visible: boolean
  }[]
  wanted: {
    level: number
    mode: PoliceMode
    progress: number
    radius: number
    center: Point2 | null
  }
}

interface AutonomousVehicle {
  vehicle: Vehicle
  driver: Driver
}

let rapierReady: Promise<void> | undefined
const identity = { x: 0, y: 0, z: 0, w: 1 }

export class Simulation {
  readonly world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  readonly player: Vehicle
  readonly wanted = new Wanted()
  private readonly vehicles: Vehicle[] = []
  private readonly ai: AutonomousVehicle[] = []
  private readonly police: Vehicle[] = []
  private readonly colliders = new Map<number, Vehicle>()
  private readonly obstacles = new Set<number>()
  private readonly eventQueue = new RAPIER.EventQueue(true)
  private readonly props = new Map<number, PropBody>()
  private readonly propBodies: PropBody[] = []
  private readonly pedestrians: Pedestrians
  private lastSeen: Point2 | null = null
  frame = 0

  static async create(district = createDistrict()): Promise<Simulation> {
    await (rapierReady ??= RAPIER.init())
    return new Simulation(district)
  }

  private constructor(readonly district: District) {
    this.world.timestep = FIXED_DT
    this.buildColliders()
    this.player = this.addVehicle('player', district.playerSpawn)
    for (const kind of ['police', 'traffic'] as const) {
      const spawns = kind === 'police' ? district.policeSpawns : district.trafficSpawns
      for (const spawn of spawns) {
        const vehicle = this.addVehicle(kind, spawn)
        const driver = new Driver(district.graph, spawn, 5109 + vehicle.id * 50777, { police: kind === 'police' })
        this.ai.push({ vehicle, driver })
        if (kind === 'police') this.police.push(vehicle)
      }
    }
    this.pedestrians = new Pedestrians(district)
  }

  step(input: DriveInput = NEUTRAL): void {
    const playerPose = this.player.pose
    const mode = this.wanted.mode
    this.player.drive(input, FIXED_DT)
    for (const { vehicle, driver } of this.ai) {
      const pose = vehicle.pose
      const police = vehicle.kind === 'police'
      const closeIntercept = police && mode === 'PURSUIT' && this.hasSight(pose, playerPose, 24)
      vehicle.drive(driver.update({
        pose,
        player: playerPose,
        mode: police ? mode : 'PATROL',
        target: this.lastSeen ?? undefined,
        closeIntercept,
        forwardDistance: this.forwardDistance(vehicle, pose),
        dt: FIXED_DT,
      }), FIXED_DT)
    }

    const velocity = this.player.body.linvel()
    const speed = Math.hypot(velocity.x, velocity.z)
    this.world.step(this.eventQueue)
    this.frame++
    const impacts = this.processContacts(speed, velocity)
    const player = this.player.pose
    const visible = this.police.some((vehicle) => this.hasSight(vehicle.pose, player, SIGHT_RADIUS))
    if (this.wanted.level > 0 && visible) this.lastSeen = { x: player.x, z: player.z }
    const outsideSearch = this.lastSeen === null
      || Math.hypot(player.x - this.lastSeen.x, player.z - this.lastSeen.z) > SEARCH_RADIUS
    this.wanted.step(FIXED_DT, visible, outsideSearch)
    if (this.wanted.level === 0) this.lastSeen = null
    this.pedestrians.update(FIXED_DT, this.vehicles.map((vehicle) => vehicle.pose), impacts)
  }

  snapshot(): Snapshot {
    return {
      frame: this.frame,
      vehicles: this.vehicles.map((vehicle) => {
        const v = vehicle.body.linvel()
        return {
          id: vehicle.id,
          kind: vehicle.kind,
          position: vehicle.body.translation(),
          rotation: vehicle.body.rotation(),
          speed: Math.hypot(v.x, v.z),
          steer: vehicle.steer,
          braking: vehicle.braking,
        }
      }),
      pedestrians: this.pedestrians.snapshot(),
      props: this.propBodies.map(({ data, debris, removeAt }) => ({
        id: data.id,
        position: debris?.translation() ?? { x: data.x, y: PROP_HALF_SIZE[data.kind].y + 0.08, z: data.z },
        rotation: debris?.rotation() ?? identity,
        broken: removeAt !== Infinity,
        visible: this.frame < removeAt,
      })),
      wanted: {
        level: this.wanted.level,
        mode: this.wanted.mode,
        progress: this.wanted.progress,
        radius: SEARCH_RADIUS,
        center: this.lastSeen ? { ...this.lastSeen } : null,
      },
    }
  }

  resetPlayer(): void {
    const { x, z, heading } = this.player.pose
    const tilt = this.player.body.rotation()
    if (1 - 2 * (tilt.x * tilt.x + tilt.z * tilt.z) < 0.65) {
      this.player.place(x, z, heading)
    } else {
      const spawn = this.district.playerSpawn
      this.player.place(spawn.x, spawn.z, spawn.yaw)
    }
    this.world.propagateModifiedBodyPositionsToColliders()
  }

  teleportPlayer(point: Point2, yaw = 0): void {
    this.player.place(point.x, point.z, yaw)
    this.world.propagateModifiedBodyPositionsToColliders()
  }

  stagePoliceCollision(): void {
    const pose = this.player.pose
    const fx = Math.sin(pose.heading)
    const fz = Math.cos(pose.heading)
    this.police[0].place(pose.x + fx * 3.9, pose.z + fz * 3.9, pose.heading)
    this.player.body.setLinvel({ x: fx * 15, y: 0, z: fz * 15 }, true)
    this.world.propagateModifiedBodyPositionsToColliders()
  }

  dispose(): void {
    this.eventQueue.free()
    this.world.free()
  }

  private addVehicle(kind: VehicleKind, spawn: District['playerSpawn']): Vehicle {
    const vehicle = new Vehicle(this.world, this.vehicles.length, kind, spawn)
    this.vehicles.push(vehicle)
    this.colliders.set(vehicle.collider.handle, vehicle)
    return vehicle
  }

  private buildColliders(): void {
    const edge = this.district.halfExtent
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(edge + 3, 0.25, edge + 3).setTranslation(0, -0.25, 0))
    for (const sign of [-1, 1]) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(edge, 1, 0.45).setTranslation(0, 1, sign * edge))
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.45, 1, edge).setTranslation(sign * edge, 1, 0))
    }
    for (const b of this.district.buildings) {
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.width / 2, b.height / 2, b.depth / 2).setTranslation(b.x, b.height / 2, b.z),
      )
      this.obstacles.add(collider.handle)
    }
    for (const data of this.district.props) {
      const { x, y, z } = PROP_HALF_SIZE[data.kind]
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(x, y, z)
          .setTranslation(data.x, y + 0.08, data.z)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      )
      const prop = { data, collider, removeAt: Infinity }
      this.props.set(collider.handle, prop)
      this.propBodies.push(prop)
    }
  }

  private forwardDistance(vehicle: Vehicle, pose: DrivePose): number {
    const x = Math.sin(pose.heading)
    const z = Math.cos(pose.heading)
    const ray = new RAPIER.Ray({ x: pose.x + x * 1.75, y: CAR_HEIGHT, z: pose.z + z * 1.75 }, { x, y: 0, z })
    const hit = this.world.castRay(ray, 21, true, undefined, undefined, vehicle.collider)
    return hit?.timeOfImpact ?? 21
  }

  private hasSight(from: Point2, to: Point2, range: number): boolean {
    const x = to.x - from.x
    const z = to.z - from.z
    const distance = Math.hypot(x, z)
    if (distance > range) return false
    if (distance < 0.01) return true
    const ray = new RAPIER.Ray({ x: from.x, y: 0.86, z: from.z }, { x: x / distance, y: 0, z: z / distance })
    return !this.world.castRay(ray, distance, true, undefined, undefined, undefined, undefined,
      (collider) => this.obstacles.has(collider.handle))
  }

  private processContacts(speed: number, velocity: RAPIER.Vector3): Point2[] {
    const impacts: Point2[] = []
    const broken: { prop: PropBody; velocity: RAPIER.Vector3 }[] = []
    const playerHandle = this.player.collider.handle
    this.eventQueue.drainCollisionEvents((a, b, started) => {
      if (!started) return
      const other = a === playerHandle ? b : b === playerHandle ? a : undefined
      const vehicle = other === undefined ? undefined : this.colliders.get(other)
      const prop = this.props.get(a) ?? this.props.get(b)
      const rammer = this.colliders.get(a) ?? this.colliders.get(b)
      if (prop && rammer) {
        const v = rammer === this.player ? velocity : rammer.body.linvel()
        if (Math.hypot(v.x, v.z) >= 5) {
          broken.push({ prop, velocity: v })
          impacts.push(prop.data)
          if (rammer === this.player) this.recordOffense()
        }
      }
      if (other === undefined) {
        const first = this.colliders.get(a)
        const second = this.colliders.get(b)
        if (first && second) impacts.push(first.pose)
        return
      }
      if (vehicle?.kind === 'police' || (vehicle?.kind === 'traffic' && speed > 6)) this.recordOffense()
      if (vehicle || speed > 5) impacts.push(this.player.pose)
    })
    for (const entry of broken) this.breakProp(entry.prop, entry.velocity)
    for (const prop of this.propBodies) {
      if (prop.debris && this.frame >= prop.removeAt) {
        this.world.removeRigidBody(prop.debris)
        prop.debris = undefined
      }
    }
    return impacts
  }

  private recordOffense(): void {
    this.wanted.offense()
    const { x, z } = this.player.pose
    this.lastSeen = { x, z }
  }

  private breakProp(prop: PropBody, velocity: RAPIER.Vector3): void {
    if (prop.debris) return
    const { data, collider } = prop
    const { x, y, z } = PROP_HALF_SIZE[data.kind]
    this.props.delete(collider.handle)
    this.world.removeCollider(collider, true)
    prop.debris = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(data.x, y + 0.1, data.z)
        .setLinvel(velocity.x * 0.3, 2.2, velocity.z * 0.3)
        .setAngvel({ x: velocity.z * 0.24, y: 1, z: -velocity.x * 0.24 }),
    )
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(x, y, z).setDensity(0.09).setFriction(0.7).setRestitution(0.25),
      prop.debris,
    )
    prop.removeAt = this.frame + 360
  }
}

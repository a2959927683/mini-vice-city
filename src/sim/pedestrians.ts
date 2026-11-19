import type { District, Point2 } from './district'
import type { DrivePose } from './drivers'
import { SpatialHash } from './spatialHash'

interface SidewalkLoop {
  corners: Point2[]
  lengths: number[]
  perimeter: number
}

interface Pedestrian {
  id: number
  style: number
  path: SidewalkLoop
  distance: number
  x: number
  z: number
  heading: number
  direction: 1 | -1
  pace: number
  nextTurn: number
  fleeTime: number
  steerTime: number
}

export interface PedestrianSnapshot extends Point2 {
  id: number
  style: number
  heading: number
  fleeing: boolean
}

function sidewalkLoop(corners: Point2[]): SidewalkLoop {
  const lengths = corners.map((corner, i) => {
    const next = corners[(i + 1) % corners.length]
    return Math.hypot(next.x - corner.x, next.z - corner.z)
  })
  return { corners, lengths, perimeter: lengths.reduce((sum, length) => sum + length, 0) }
}

function positionAt(path: SidewalkLoop, distance: number): Point2 {
  let remaining = (distance % path.perimeter + path.perimeter) % path.perimeter
  for (let i = 0; i < path.corners.length; i++) {
    if (remaining < path.lengths[i]) {
      const a = path.corners[i]
      const b = path.corners[(i + 1) % path.corners.length]
      const t = remaining / path.lengths[i]
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
    }
    remaining -= path.lengths[i]
  }
  return path.corners[0]
}

export class Pedestrians {
  private readonly people: Pedestrian[] = []
  private readonly traffic = new SpatialHash<DrivePose>(10)
  private randomState: number

  constructor(district: District, seed = 8203) {
    this.randomState = seed >>> 0
    for (const block of district.blocks) {
      const path = sidewalkLoop(block.sidewalks)
      for (let i = 0; i < 2; i++) {
        const distance = path.perimeter * (i + this.random()) / 2
        const direction = i === 0 ? 1 : -1
        const pose = positionAt(path, distance)
        const ahead = positionAt(path, distance + direction * 0.4)
        this.people.push({
          id: this.people.length,
          style: Math.floor(this.random() * 6),
          path,
          distance,
          ...pose,
          heading: Math.atan2(ahead.x - pose.x, ahead.z - pose.z),
          direction,
          pace: 1.1 + this.random() * 0.65,
          nextTurn: 7 + this.random() * 15,
          fleeTime: 0,
          steerTime: 0,
        })
      }
    }
  }

  update(dt: number, vehicles: readonly DrivePose[], impacts: readonly Point2[]): void {
    this.traffic.clear()
    for (const vehicle of vehicles) {
      if (Math.abs(vehicle.speed) >= 7) this.traffic.insert(vehicle.x, vehicle.z, vehicle)
    }

    for (const person of this.people) {
      const danger = this.closestThreat(person, impacts)
      person.fleeTime = danger ? 1.6 : Math.max(0, person.fleeTime - dt)
      person.steerTime = Math.max(0, person.steerTime - dt)
      if (danger && person.steerTime <= 0) {
        const forward = positionAt(person.path, person.distance + 3)
        const backward = positionAt(person.path, person.distance - 3)
        const aheadDistance = Math.hypot(forward.x - danger.x, forward.z - danger.z)
        const behindDistance = Math.hypot(backward.x - danger.x, backward.z - danger.z)
        person.direction = aheadDistance >= behindDistance ? 1 : -1
        person.steerTime = 0.4
      }

      if (person.fleeTime <= 0) {
        person.nextTurn -= dt
        if (person.nextTurn <= 0) {
          person.direction = person.direction === 1 ? -1 : 1
          person.nextTurn = 7 + this.random() * 15
        }
      }

      const pace = person.fleeTime > 0 ? 4.8 : person.pace
      person.distance = (person.distance + person.direction * pace * dt + person.path.perimeter) % person.path.perimeter
      const pose = positionAt(person.path, person.distance)
      const ahead = positionAt(person.path, person.distance + person.direction * 0.35)
      person.x = pose.x
      person.z = pose.z
      person.heading = Math.atan2(ahead.x - pose.x, ahead.z - pose.z)
    }
  }

  snapshot(): PedestrianSnapshot[] {
    return this.people.map(({ id, x, z, heading, style, fleeTime }) => ({
      id, x, z, heading, style, fleeing: fleeTime > 0,
    }))
  }

  private closestThreat(person: Point2, impacts: readonly Point2[]): Point2 | undefined {
    let closest: Point2 | undefined
    let minDistance = 12
    for (const impact of impacts) {
      const distance = Math.hypot(impact.x - person.x, impact.z - person.z)
      if (distance < minDistance) {
        closest = impact
        minDistance = distance
      }
    }

    for (const vehicle of this.traffic.query(person.x, person.z, 11)) {
      const dx = person.x - vehicle.x
      const dz = person.z - vehicle.z
      const distance = Math.hypot(dx, dz)
      const forward = (dx * Math.sin(vehicle.heading) + dz * Math.cos(vehicle.heading)) * Math.sign(vehicle.speed)
      if (distance < minDistance && (distance < 4.2 || forward > distance * 0.48)) {
        closest = vehicle
        minDistance = distance
      }
    }
    return closest
  }

  private random(): number {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0
    return this.randomState / 4294967296
  }
}

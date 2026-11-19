import { nearestLane, pointOnLane, routeLanes, type Lane, type Point2, type RoadGraph, type Spawn } from './district'

export interface DriveInput {
  throttle: number
  steer: number
  handbrake: boolean
}

export interface DrivePose extends Point2 {
  heading: number
  /** Signed longitudinal speed in meters per second. */
  speed: number
}

interface DriverContext {
  pose: DrivePose
  player: DrivePose
  mode: 'PATROL' | 'PURSUIT' | 'SEARCH' | 'COOLDOWN'
  target?: Point2
  closeIntercept?: boolean
  forwardDistance: number
  dt: number
}

interface DriverOptions {
  police?: boolean
  patrolSpeed?: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const distance = (a: Point2, b: Point2) => Math.hypot(b.x - a.x, b.z - a.z)
const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

function laneProgress(lane: Lane, pose: Point2): number {
  const dx = lane.to.x - lane.from.x
  const dz = lane.to.z - lane.from.z
  return ((pose.x - lane.from.x) * dx + (pose.z - lane.from.z) * dz) / lane.length ** 2
}

export class Driver {
  private lane: Lane
  private nextLane: Lane | undefined
  private route: Lane[] = []
  private routeTarget: string | undefined
  private mode: DriverContext['mode'] = 'PATROL'
  private seed: number
  private stoppedTime = 0
  private reverseTime = 0
  private recoverySteering = 0
  private intercepting = false
  private interceptSide = 1
  private readonly police: boolean
  private readonly patrolSpeed: number

  constructor(private readonly graph: RoadGraph, spawn: Spawn, seed: number, options: DriverOptions = {}) {
    this.seed = seed >>> 0
    this.lane = graph.lanes.get(spawn.laneId) ?? nearestLane(graph, spawn, spawn.yaw)
    this.police = options.police ?? false
    this.patrolSpeed = options.patrolSpeed ?? 9 + this.random() * 3
  }

  update(context: DriverContext): DriveInput {
    const { pose, player, mode, target, closeIntercept, forwardDistance, dt } = context
    if (this.reverseTime > 0) {
      this.reverseTime -= dt
      if (this.reverseTime <= 0) this.rejoinRoad(pose)
      return { throttle: pose.speed < -5 ? 0 : -0.72, steer: this.recoverySteering, handbrake: false }
    }

    const pursuit = mode === 'PURSUIT'
    const chasing = this.police && pursuit && closeIntercept === true && distance(pose, player) < 24
    if (mode !== this.mode || (this.intercepting && !chasing)) {
      this.rejoinRoad(pose)
      this.mode = mode
    }

    if (chasing && !this.intercepting) {
      const side = (pose.x - player.x) * Math.cos(player.heading) - (pose.z - player.z) * Math.sin(player.heading)
      this.interceptSide = side < 0 ? -1 : 1
    }
    this.intercepting = chasing

    const goal = this.police && (pursuit || mode === 'SEARCH') ? target ?? (pursuit ? player : undefined) : undefined
    const road = chasing ? undefined : this.followRoad(pose, goal)
    const aim = road?.aim ?? this.interceptPoint(pose, player)
    const headingError = angleDifference(Math.atan2(aim.x - pose.x, aim.z - pose.z), pose.heading)
    const steer = clamp(headingError * 1.7, -1, 1)

    const cruise = pursuit && this.police ? 35 : this.patrolSpeed
    const turnSpeed = Math.max(6, cruise * Math.cos(Math.min(Math.abs(headingError), Math.PI / 2)))
    let desiredSpeed = Math.min(cruise, turnSpeed, road?.turnSpeed ?? cruise)
    if (chasing) {
      const closingSpeed = Math.max(10, player.speed + 3.5 + distance(pose, player) * 0.75)
      desiredSpeed = Math.min(desiredSpeed, closingSpeed)
    } else {
      const spacingSpeed = Math.sqrt(Math.max(0, forwardDistance - 2.7) * 8)
      desiredSpeed = Math.min(desiredSpeed, spacingSpeed)
    }

    const throttle = clamp((desiredSpeed - pose.speed) / 3.2, -1, 1)
    this.detectStuck(pose, throttle, steer, forwardDistance, dt)
    return { throttle, steer, handbrake: this.police && pursuit && pose.speed > 12 && Math.abs(headingError) > 0.72 }
  }

  private followRoad(pose: DrivePose, goal?: Point2): { aim: Point2; turnSpeed: number } {
    if (distance(pose, this.lane.to) < 3 || laneProgress(this.lane, pose) > 1.07) {
      this.chooseNextLane(goal)
      if (this.nextLane) {
        this.lane = this.nextLane
        this.nextLane = undefined
        this.routeTarget = undefined
      }
    }

    this.chooseNextLane(goal)
    const progress = clamp(laneProgress(this.lane, pose), 0, 1)
    const onLane = pointOnLane(this.lane, progress)
    const lookAhead = clamp(5 + Math.abs(pose.speed) * 0.46, 5, 15)
    if (distance(pose, onLane) > lookAhead * 0.75) return { aim: onLane, turnSpeed: 10 }

    const remaining = this.lane.length * (1 - progress)
    const turnAngle = this.nextLane ? Math.abs(angleDifference(this.nextLane.yaw, this.lane.yaw)) : 0
    const turnSpeed = turnAngle > 0.6 ? Math.sqrt(7 ** 2 + remaining * 9) : Infinity
    if (remaining >= lookAhead || !this.nextLane) {
      return { aim: pointOnLane(this.lane, Math.min(1, progress + lookAhead / this.lane.length)), turnSpeed }
    }

    const connectorLength = distance(this.lane.to, this.nextLane.from)
    const connectorProgress = (lookAhead - remaining) / Math.max(1, connectorLength)
    if (connectorProgress < 1) {
      return {
        aim: {
          x: this.lane.to.x + (this.nextLane.from.x - this.lane.to.x) * connectorProgress,
          z: this.lane.to.z + (this.nextLane.from.z - this.lane.to.z) * connectorProgress,
        },
        turnSpeed,
      }
    }

    const nextProgress = (lookAhead - remaining - connectorLength) / this.nextLane.length
    return { aim: pointOnLane(this.nextLane, clamp(nextProgress, 0, 1)), turnSpeed }
  }

  private chooseNextLane(goal?: Point2): void {
    const goalLane = goal ? nearestLane(this.graph, goal).id : undefined
    if (this.nextLane && this.routeTarget === goalLane) return

    if (goalLane !== this.routeTarget || (goalLane && !this.route.includes(this.lane))) {
      this.routeTarget = goalLane
      this.route = goalLane ? routeLanes(this.graph, this.lane.id, goalLane) : []
      this.nextLane = undefined
    }

    const routeNext = this.route[this.route.indexOf(this.lane) + 1]
    if (routeNext && this.lane.next.includes(routeNext.id)) {
      this.nextLane = routeNext
    } else {
      const exits = this.lane.next
      const sameLane = exits.filter((id) => this.graph.lanes.get(id)?.index === this.lane.index)
      const choices = sameLane.length ? sameLane : exits
      this.nextLane = this.graph.lanes.get(choices[Math.floor(this.random() * choices.length)])
    }
  }

  private interceptPoint(pose: DrivePose, player: DrivePose): Point2 {
    const lead = clamp(distance(pose, player) * 0.045, 0, 0.65)
    const offset = clamp(player.speed, -4, 24) * lead - 1.55
    return {
      x: player.x + Math.sin(player.heading) * offset + Math.cos(player.heading) * this.interceptSide * 1.2,
      z: player.z + Math.cos(player.heading) * offset - Math.sin(player.heading) * this.interceptSide * 1.2,
    }
  }

  private detectStuck(pose: DrivePose, throttle: number, steer: number, forwardDistance: number, dt: number): void {
    if (!this.police) return
    const blocked = Math.abs(pose.speed) < 1.1 && (throttle > 0.32 || forwardDistance < 2.1)
    this.stoppedTime = blocked ? this.stoppedTime + dt : 0
    if (this.stoppedTime > 1.55) {
      this.stoppedTime = 0
      this.reverseTime = 0.8
      this.recoverySteering = Math.abs(steer) > 0.2 ? -Math.sign(steer) * 0.8 : (this.random() < 0.5 ? -0.8 : 0.8)
    }
  }

  private rejoinRoad(pose: DrivePose): void {
    this.lane = nearestLane(this.graph, pose, pose.heading)
    this.nextLane = undefined
    this.route = []
    this.routeTarget = undefined
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
    return this.seed / 4294967296
  }
}

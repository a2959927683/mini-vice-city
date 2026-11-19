export interface Point2 {
  x: number
  z: number
}

export interface Lane {
  id: string
  from: Point2
  to: Point2
  fromNode: string
  toNode: string
  yaw: number
  length: number
  index: number
  next: string[]
}

export interface Intersection extends Point2 {
  id: string
  outgoing: string[]
}

export interface RoadGraph {
  intersections: Map<string, Intersection>
  lanes: Map<string, Lane>
}

export interface Block extends Point2 {
  id: string
  width: number
  depth: number
  sidewalks: Point2[]
}

export type BuildingStyle = 'hotel' | 'tower' | 'apartments' | 'shop'

export interface Building extends Point2 {
  id: string
  width: number
  depth: number
  height: number
  style: BuildingStyle
  color: number
}

export interface Prop extends Point2 {
  id: string
  kind: 'hydrant' | 'pole' | 'bollard'
}

export interface Spawn extends Point2 {
  yaw: number
  laneId: string
}

export interface District {
  axes: readonly number[]
  roadWidth: number
  halfExtent: number
  blocks: Block[]
  buildings: Building[]
  props: Prop[]
  graph: RoadGraph
  playerSpawn: Spawn
  policeSpawns: Spawn[]
  trafficSpawns: Spawn[]
  evadePoint: Point2
}

export const ROAD_AXES = [-88, -44, 0, 44, 88] as const
export const ROAD_WIDTH = 16
export const BLOCK_SIZE = 44
export const HALF_EXTENT = 103

const DIRECTIONS = [
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
]
const INTERSECTION_MARGIN = 7
const LANE_OFFSETS = [2, 6]
const BUILDING_STYLES = ['hotel', 'tower', 'apartments', 'shop'] as const
const BUILDING_COLORS = [0xf4b0a9, 0xe7bb91, 0x8bb8bc, 0xd58b9c, 0x868cbb, 0xf1cead, 0x9eac99]
const BUILDING_HEIGHTS: Record<BuildingStyle, readonly [number, number]> = {
  hotel: [12, 21],
  tower: [18, 31],
  apartments: [8, 14],
  shop: [4, 7],
}

const nodeId = (column: number, row: number) => `${column},${row}`
const laneId = (from: string, to: string, index: number) => `${from}>${to}:${index}`

function createGraph(): RoadGraph {
  const intersections = new Map<string, Intersection>()
  const lanes = new Map<string, Lane>()

  ROAD_AXES.forEach((z, row) => {
    ROAD_AXES.forEach((x, column) => {
      const id = nodeId(column, row)
      intersections.set(id, { id, x, z, outgoing: [] })
    })
  })

  ROAD_AXES.forEach((_, row) => {
    ROAD_AXES.forEach((_, column) => {
      const origin = intersections.get(nodeId(column, row))!
      for (const direction of DIRECTIONS) {
        const destination = intersections.get(nodeId(column + direction.x, row + direction.z))
        if (!destination) continue

        LANE_OFFSETS.forEach((offset, index) => {
          const id = laneId(origin.id, destination.id, index)
          const lateralX = -direction.z * offset
          const lateralZ = direction.x * offset
          lanes.set(id, {
            id,
            from: {
              x: origin.x + lateralX + direction.x * INTERSECTION_MARGIN,
              z: origin.z + lateralZ + direction.z * INTERSECTION_MARGIN,
            },
            to: {
              x: destination.x + lateralX - direction.x * INTERSECTION_MARGIN,
              z: destination.z + lateralZ - direction.z * INTERSECTION_MARGIN,
            },
            fromNode: origin.id,
            toNode: destination.id,
            yaw: Math.atan2(direction.x, direction.z),
            length: BLOCK_SIZE - 2 * INTERSECTION_MARGIN,
            index,
            next: [],
          })
          origin.outgoing.push(id)
        })
      }
    })
  })

  for (const lane of lanes.values()) {
    const intersection = intersections.get(lane.toNode)!
    const outgoing = intersection.outgoing.map((id) => lanes.get(id)!)
    const continues = outgoing.some((candidate) => candidate.yaw === lane.yaw)
    for (const candidate of outgoing) {
      if (candidate.toNode === lane.fromNode) continue

      const turn = Math.sin(lane.yaw - candidate.yaw)
      const turnLane = turn > 0 ? 1 : 0
      if (candidate.yaw === lane.yaw || !continues || (lane.index === turnLane && candidate.index === turnLane)) {
        lane.next.push(candidate.id)
      }
    }
  }

  return { intersections, lanes }
}

export function pointOnLane(lane: Lane, t: number): Point2 {
  return {
    x: lane.from.x + (lane.to.x - lane.from.x) * t,
    z: lane.from.z + (lane.to.z - lane.from.z) * t,
  }
}

export function nearestLane(graph: RoadGraph, point: Point2, heading?: number): Lane {
  let nearest: Lane | undefined
  let bestCost = Infinity
  for (const lane of graph.lanes.values()) {
    const dx = lane.to.x - lane.from.x
    const dz = lane.to.z - lane.from.z
    const fraction = ((point.x - lane.from.x) * dx + (point.z - lane.from.z) * dz) / (lane.length * lane.length)
    const projected = pointOnLane(lane, Math.min(1, Math.max(0, fraction)))
    const distance = Math.hypot(point.x - projected.x, point.z - projected.z)
    const headingCost = heading === undefined ? 0 : 12 * (1 - Math.cos(lane.yaw - heading))
    if (distance + headingCost < bestCost) {
      bestCost = distance + headingCost
      nearest = lane
    }
  }

  if (!nearest) throw new Error('Road graph must contain at least one lane.')
  return nearest
}

export function routeLanes(graph: RoadGraph, fromId: string, toId: string): Lane[] {
  if (!graph.lanes.has(fromId) || !graph.lanes.has(toId)) return []

  // All segments have equal length, so breadth-first search finds a shortest route.
  const queue = [fromId]
  const previous = new Map<string, string | undefined>([[fromId, undefined]])
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]
    if (current === toId) {
      const route: Lane[] = []
      for (let id: string | undefined = current; id !== undefined; id = previous.get(id)) {
        route.push(graph.lanes.get(id)!)
      }
      return route.reverse()
    }
    for (const next of graph.lanes.get(current)!.next) {
      if (previous.has(next)) continue
      previous.set(next, current)
      queue.push(next)
    }
  }

  return []
}

function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

interface SpawnLane {
  column: number
  row: number
  dx: number
  dz: number
  index: number
  position: number
}

function spawn(graph: RoadGraph, { column, row, dx, dz, index, position }: SpawnLane): Spawn {
  const lane = graph.lanes.get(laneId(nodeId(column, row), nodeId(column + dx, row + dz), index))!
  return { ...pointOnLane(lane, position), yaw: lane.yaw, laneId: lane.id }
}

export function createDistrict(seed = 4107): District {
  const random = generator(seed)
  const graph = createGraph()
  const blocks: Block[] = []
  const buildings: Building[] = []
  const props: Prop[] = []
  const width = BLOCK_SIZE - ROAD_WIDTH
  const sidewalkOffset = width / 2 - 1.45

  for (let row = 0; row < ROAD_AXES.length - 1; row++) {
    for (let column = 0; column < ROAD_AXES.length - 1; column++) {
      const id = `block-${column}-${row}`
      const x = ROAD_AXES[column] + BLOCK_SIZE / 2
      const z = ROAD_AXES[row] + BLOCK_SIZE / 2
      blocks.push({
        id, x, z, width, depth: width,
        sidewalks: [
          { x: x - sidewalkOffset, z: z - sidewalkOffset },
          { x: x + sidewalkOffset, z: z - sidewalkOffset },
          { x: x + sidewalkOffset, z: z + sidewalkOffset },
          { x: x - sidewalkOffset, z: z + sidewalkOffset },
        ],
      })

      for (let lot = 0; lot < 4; lot++) {
        // Leave occasional sunny courtyards among the taller buildings.
        if (lot === 3 && (row + column * 2) % 5 === 0) continue
        const style = BUILDING_STYLES[Math.floor(random() * BUILDING_STYLES.length)]
        const [minimumHeight, maximumHeight] = BUILDING_HEIGHTS[style]
        buildings.push({
          id: `${id}-building-${lot}`,
          x: x + (lot % 2 === 0 ? -6 : 6),
          z: z + (lot < 2 ? -6 : 6),
          width: 7.5 + random() * 3.4,
          depth: 7.5 + random() * 3.4,
          height: minimumHeight + random() * (maximumHeight - minimumHeight),
          style,
          color: BUILDING_COLORS[(row * 3 + column + lot) % BUILDING_COLORS.length],
        })
      }

      const propOffset = width / 2 - 0.65
      props.push(
        { id: `${id}-pole-0`, x: x - 8, z: z - propOffset, kind: 'pole' },
        { id: `${id}-pole-1`, x: x + 8, z: z + propOffset, kind: 'pole' },
        { id: `${id}-hydrant`, x: x + propOffset, z: z - 8, kind: 'hydrant' },
        { id: `${id}-bollard`, x: x - propOffset, z: z + 8, kind: 'bollard' },
      )
    }
  }

  const playerSpawn = spawn(graph, { column: 2, row: 1, dx: 0, dz: 1, index: 0, position: 0.3 })
  const policeSpawns = [
    spawn(graph, { column: 2, row: 2, dx: 0, dz: 1, index: 1, position: 0.46 }),
    spawn(graph, { column: 1, row: 2, dx: 0, dz: -1, index: 0, position: 0.55 }),
  ]
  const trafficSpawns = [
    { column: 1, row: 1, dx: 1, dz: 0, index: 1 },
    { column: 2, row: 1, dx: 0, dz: 1, index: 1 },
    { column: 2, row: 2, dx: -1, dz: 0, index: 0 },
    { column: 2, row: 1, dx: 1, dz: 0, index: 0 },
    { column: 2, row: 2, dx: 0, dz: -1, index: 0 },
    { column: 0, row: 1, dx: 0, dz: 1, index: 1 },
    { column: 3, row: 0, dx: 0, dz: 1, index: 0 },
    { column: 3, row: 2, dx: 1, dz: 0, index: 1 },
    { column: 1, row: 4, dx: 0, dz: -1, index: 0 },
    { column: 1, row: 3, dx: 1, dz: 0, index: 1 },
    { column: 4, row: 1, dx: 0, dz: -1, index: 0 },
    { column: 2, row: 4, dx: -1, dz: 0, index: 0 },
  ].map((lane) => spawn(graph, { ...lane, position: 0.28 + random() * 0.44 }))

  return {
    axes: ROAD_AXES,
    roadWidth: ROAD_WIDTH,
    halfExtent: HALF_EXTENT,
    blocks,
    buildings,
    props,
    graph,
    playerSpawn,
    policeSpawns,
    trafficSpawns,
    evadePoint: { x: 86, z: 67 },
  }
}

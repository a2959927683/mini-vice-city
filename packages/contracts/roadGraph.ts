export const ROAD_GRAPH_SCHEMA_VERSION = 1

export interface RoadPoint {
  readonly x: number
  readonly z: number
}

export interface LaneCenterline {
  readonly id: string
  readonly fromIntersectionId: string
  readonly toIntersectionId: string
  readonly points: readonly RoadPoint[]
  readonly nextLaneIds: readonly string[]
}

export interface IntersectionNode {
  readonly id: string
  readonly position: RoadPoint
  readonly outgoingLaneIds: readonly string[]
}

export interface RoadGraphQuery {
  readonly getLaneCenterline: (id: string) => LaneCenterline | undefined
  readonly getIntersection: (id: string) => IntersectionNode | undefined
}

export interface RoadGraphData {
  readonly schemaVersion: typeof ROAD_GRAPH_SCHEMA_VERSION
  readonly intersections: readonly IntersectionNode[]
  readonly lanes: readonly LaneCenterline[]
}

function invalid(path: string, reason: string): never {
  throw new TypeError(`Road graph ${path}: ${reason}`)
}

function parseObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(path, 'expected an object')
  }
  return value as Record<string, unknown>
}

function parseArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) return invalid(path, 'expected an array')
  return value
}

function parseId(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid(path, 'expected a non-empty ID')
  }
  return value
}

function parseIds(value: unknown, path: string): readonly string[] {
  const seen = new Set<string>()
  const ids = Array.from(parseArray(value, path), (entry, index) => {
    const entryPath = `${path}[${index}]`
    const id = parseId(entry, entryPath)
    if (seen.has(id)) invalid(entryPath, `duplicate ID "${id}"`)
    seen.add(id)
    return id
  })
  return Object.freeze(ids)
}

function parsePoint(value: unknown, path: string): RoadPoint {
  const { x, z } = parseObject(value, path)
  if (typeof x !== 'number' || !Number.isFinite(x)) invalid(`${path}.x`, 'expected a finite number')
  if (typeof z !== 'number' || !Number.isFinite(z)) invalid(`${path}.z`, 'expected a finite number')
  return Object.freeze({ x, z })
}

function parseIntersection(value: unknown, path: string): IntersectionNode {
  const node = parseObject(value, path)
  return Object.freeze({
    id: parseId(node.id, `${path}.id`),
    position: parsePoint(node.position, `${path}.position`),
    outgoingLaneIds: parseIds(node.outgoingLaneIds, `${path}.outgoingLaneIds`),
  })
}

function parseLane(value: unknown, path: string): LaneCenterline {
  const lane = parseObject(value, path)
  const points = Array.from(parseArray(lane.points, `${path}.points`), (point, index) =>
    parsePoint(point, `${path}.points[${index}]`),
  )
  if (points.length < 2) invalid(`${path}.points`, 'expected at least two points')
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]
    const point = points[index]
    if (previous.x === point.x && previous.z === point.z) {
      invalid(`${path}.points[${index}]`, 'repeats the preceding point')
    }
  }
  return Object.freeze({
    id: parseId(lane.id, `${path}.id`),
    fromIntersectionId: parseId(lane.fromIntersectionId, `${path}.fromIntersectionId`),
    toIntersectionId: parseId(lane.toIntersectionId, `${path}.toIntersectionId`),
    points: Object.freeze(points),
    nextLaneIds: parseIds(lane.nextLaneIds, `${path}.nextLaneIds`),
  })
}

function indexById<T extends { readonly id: string }>(items: readonly T[], path: string): Map<string, T> {
  const indexed = new Map<string, T>()
  items.forEach((item, index) => {
    if (indexed.has(item.id)) invalid(`${path}[${index}].id`, `duplicate ID "${item.id}"`)
    indexed.set(item.id, item)
  })
  return indexed
}

function requireReference<T>(index: Map<string, T>, id: string, path: string): T {
  const item = index.get(id)
  if (item === undefined) return invalid(path, `unknown ID "${id}"`)
  return item
}

/** Validate a versioned payload and return a frozen copy of its contract fields. */
export function validateRoadGraph(value: unknown): RoadGraphData {
  const graph = parseObject(value, 'payload')
  if (graph.schemaVersion !== ROAD_GRAPH_SCHEMA_VERSION) {
    invalid('schemaVersion', `expected ${ROAD_GRAPH_SCHEMA_VERSION}`)
  }
  const intersections = Array.from(parseArray(graph.intersections, 'intersections'), (node, index) =>
    parseIntersection(node, `intersections[${index}]`),
  )
  const lanes = Array.from(parseArray(graph.lanes, 'lanes'), (lane, index) => parseLane(lane, `lanes[${index}]`))
  const nodesById = indexById(intersections, 'intersections')
  const lanesById = indexById(lanes, 'lanes')

  intersections.forEach((node, index) => {
    node.outgoingLaneIds.forEach((id, position) => {
      const path = `intersections[${index}].outgoingLaneIds[${position}]`
      const lane = requireReference(lanesById, id, path)
      if (lane.fromIntersectionId !== node.id) invalid(path, `lane "${id}" starts at a different intersection`)
    })
  })

  lanes.forEach((lane, index) => {
    const path = `lanes[${index}]`
    const origin = requireReference(nodesById, lane.fromIntersectionId, `${path}.fromIntersectionId`)
    requireReference(nodesById, lane.toIntersectionId, `${path}.toIntersectionId`)
    if (!origin.outgoingLaneIds.includes(lane.id)) {
      invalid(`${path}.fromIntersectionId`, `intersection "${origin.id}" is missing outgoing lane "${lane.id}"`)
    }
    lane.nextLaneIds.forEach((id, position) => {
      const nextPath = `${path}.nextLaneIds[${position}]`
      const next = requireReference(lanesById, id, nextPath)
      if (next.fromIntersectionId !== lane.toIntersectionId) {
        invalid(nextPath, `lane "${id}" starts at a different intersection`)
      }
    })
  })

  return Object.freeze({
    schemaVersion: ROAD_GRAPH_SCHEMA_VERSION,
    intersections: Object.freeze(intersections),
    lanes: Object.freeze(lanes),
  })
}

export function createRoadGraphQuery(value: unknown): RoadGraphQuery {
  const graph = validateRoadGraph(value)
  const intersections = new Map(graph.intersections.map((node) => [node.id, node]))
  const lanes = new Map(graph.lanes.map((lane) => [lane.id, lane]))
  return Object.freeze({
    getLaneCenterline: (id: string) => lanes.get(id),
    getIntersection: (id: string) => intersections.get(id),
  })
}

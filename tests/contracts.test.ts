import { describe, expect, it } from 'vitest'
import testDistrict from '../packages/contracts/fixtures/test-district.json'
import { createRoadGraphQuery, validateRoadGraph } from '../packages/contracts/roadGraph'

describe('the frozen road graph fixture', () => {
  it('validates a 2×2 district and answers directed lane and intersection queries', () => {
    const graph = validateRoadGraph(testDistrict)
    const query = createRoadGraphQuery(testDistrict)
    expect(graph.schemaVersion).toBe(1)
    expect(graph.intersections).toHaveLength(9)
    expect(graph.lanes).toHaveLength(24)
    expect(query.getIntersection('I00')).toEqual({
      id: 'I00',
      position: { x: -32, z: -32 },
      outgoingLaneIds: ['I00>I10', 'I00>I01'],
    })
    expect(query.getLaneCenterline('I00>I10')).toMatchObject({
      fromIntersectionId: 'I00',
      toIntersectionId: 'I10',
      points: [{ x: -27, z: -30 }, { x: -5, z: -30 }],
      nextLaneIds: ['I10>I20', 'I10>I11'],
    })
    expect(query.getIntersection('missing')).toBeUndefined()
    expect(query.getLaneCenterline('missing')).toBeUndefined()
  })

  it('freezes nested contract data and keeps it independent of the source payload', () => {
    const input = structuredClone(testDistrict)
    const graph = validateRoadGraph(input)
    const node = graph.intersections[0]
    const lane = graph.lanes[0]
    const query = createRoadGraphQuery(input)
    input.intersections[0].position.x = 99
    input.lanes[0].points[0].x = 99
    input.lanes[0].nextLaneIds.length = 0

    expect(node.position.x).toBe(-32)
    expect(query.getLaneCenterline(lane.id)?.points[0].x).toBe(-27)
    expect(lane.nextLaneIds).toHaveLength(2)
    for (const value of [
      graph, graph.intersections, node, node.position, node.outgoingLaneIds,
      graph.lanes, lane, lane.points, lane.points[0], lane.nextLaneIds, query,
    ]) {
      expect(Object.isFrozen(value)).toBe(true)
    }
  })
})

const invalidFixtures = [
  {
    reason: 'unknown schema version',
    change: (graph) => { graph.schemaVersion = 2 },
    error: 'schemaVersion: expected 1',
  },
  {
    reason: 'duplicate lane ID',
    change: (graph) => { graph.lanes[1].id = graph.lanes[0].id },
    error: 'lanes[1].id: duplicate ID',
  },
  {
    reason: 'invalid position',
    change: (graph) => { graph.intersections[0].position.z = Infinity },
    error: 'intersections[0].position.z: expected a finite number',
  },
  {
    reason: 'degenerate centerline',
    change: (graph) => { graph.lanes[0].points[1] = graph.lanes[0].points[0] },
    error: 'lanes[0].points[1]: repeats the preceding point',
  },
  {
    reason: 'missing intersection',
    change: (graph) => { graph.lanes[0].toIntersectionId = 'missing' },
    error: 'lanes[0].toIntersectionId: unknown ID',
  },
  {
    reason: 'missing outgoing lane registration',
    change: (graph) => { graph.intersections[0].outgoingLaneIds.shift() },
    error: 'lanes[0].fromIntersectionId: intersection "I00" is missing outgoing lane "I00>I10"',
  },
  {
    reason: 'disconnected lane transition',
    change: (graph) => { graph.lanes[0].nextLaneIds[0] = graph.lanes[1].id },
    error: 'lanes[0].nextLaneIds[0]: lane "I00>I01" starts at a different intersection',
  },
] satisfies { reason: string; change: (fixture: typeof testDistrict) => void; error: string }[]

it.each(invalidFixtures)('rejects $reason with the field path', ({ change, error }) => {
  const district = structuredClone(testDistrict)
  change(district)
  expect(() => validateRoadGraph(district)).toThrow(error)
})

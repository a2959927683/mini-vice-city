import * as THREE from 'three'
import type { District, Prop } from '../sim/district'
import type { Snapshot } from '../sim/simulation'

const meshKinds = [
  'body', 'cab', 'sedan', 'sedanCab', 'wagonCab', 'box', 'cylinder',
  'tyre', 'rim', 'head', 'lamp', 'shadow',
] as const

type MeshKind = typeof meshKinds[number]
type Paint = number | THREE.Color

interface Part {
  kind: MeshKind
  matrix: THREE.Matrix4
  color: THREE.Color
}

interface Ring {
  z: number
  width: number
  bottom: number
  top: number
  bevel: number
}

function loft(rings: Ring[]): THREE.BufferGeometry {
  const vertices: number[] = []
  const indices: number[] = []
  for (const { z, width: w, bottom, top, bevel: b } of rings) {
    vertices.push(
      -w + b, bottom, z, w - b, bottom, z, w, bottom + b, z, w, top - b, z,
      w - b, top, z, -w + b, top, z, -w, top - b, z, -w, bottom + b, z,
    )
  }

  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let edge = 0; edge < 8; edge++) {
      const a = ring * 8 + edge
      const b = ring * 8 + (edge + 1) % 8
      indices.push(a, b, b + 8, a, b + 8, a + 8)
    }
  }

  const end = (rings.length - 1) * 8
  for (let edge = 1; edge < 7; edge++) {
    indices.push(0, edge + 1, edge, end, end + edge, end + edge + 1)
  }

  const indexed = new THREE.BufferGeometry()
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  indexed.setIndex(indices)
  const geometry = indexed.toNonIndexed()
  geometry.computeVertexNormals()
  indexed.dispose()
  return geometry
}

function makeMeshes(scene: THREE.Scene, capacity: Record<MeshKind, number>) {
  const paint = new THREE.MeshStandardMaterial({ roughness: 0.66, metalness: 0.04, flatShading: true })
  const glass = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.16, flatShading: true })
  const emissive = new THREE.MeshBasicMaterial({ toneMapped: false })
  const shadow = new THREE.MeshBasicMaterial({
    color: 0x0f0a1b, transparent: true, opacity: 0.34, depthWrite: false,
  })

  const coupe = loft([
    { z: -1.94, width: 0.8, bottom: -0.22, top: 0.23, bevel: 0.08 },
    { z: -1.32, width: 0.95, bottom: -0.23, top: 0.31, bevel: 0.09 },
    { z: 0.91, width: 0.9, bottom: -0.23, top: 0.24, bevel: 0.09 },
    { z: 1.46, width: 0.84, bottom: -0.21, top: 0.15, bevel: 0.08 },
    { z: 1.91, width: 0.76, bottom: -0.19, top: 0.07, bevel: 0.07 },
  ])
  const coupeCab = loft([
    { z: -1.27, width: 0.72, bottom: 0.22, top: 0.35, bevel: 0.04 },
    { z: -0.73, width: 0.67, bottom: 0.19, top: 0.69, bevel: 0.05 },
    { z: 0.25, width: 0.64, bottom: 0.16, top: 0.69, bevel: 0.05 },
    { z: 0.91, width: 0.76, bottom: 0.14, top: 0.26, bevel: 0.04 },
  ])
  const sedan = loft([
    { z: -1.95, width: 0.79, bottom: -0.22, top: 0.27, bevel: 0.08 },
    { z: -1.69, width: 0.93, bottom: -0.23, top: 0.32, bevel: 0.1 },
    { z: 1.67, width: 0.91, bottom: -0.23, top: 0.28, bevel: 0.1 },
    { z: 1.95, width: 0.77, bottom: -0.21, top: 0.21, bevel: 0.08 },
  ])
  const sedanCab = loft([
    { z: -1.26, width: 0.75, bottom: 0.24, top: 0.35, bevel: 0.04 },
    { z: -0.84, width: 0.67, bottom: 0.21, top: 0.76, bevel: 0.06 },
    { z: 0.34, width: 0.66, bottom: 0.19, top: 0.76, bevel: 0.06 },
    { z: 0.93, width: 0.76, bottom: 0.18, top: 0.32, bevel: 0.05 },
  ])
  const wagonCab = loft([
    { z: -1.77, width: 0.72, bottom: 0.24, top: 0.36, bevel: 0.05 },
    { z: -1.57, width: 0.67, bottom: 0.21, top: 0.83, bevel: 0.06 },
    { z: 0.43, width: 0.65, bottom: 0.19, top: 0.83, bevel: 0.06 },
    { z: 0.94, width: 0.76, bottom: 0.18, top: 0.33, bevel: 0.05 },
  ])
  const box = new THREE.BoxGeometry(1, 1, 1)
  const disc = new THREE.CircleGeometry(0.5, 16)
  disc.rotateX(-Math.PI / 2)
  const definitions: Record<MeshKind, [THREE.BufferGeometry, THREE.Material]> = {
    body: [coupe, paint],
    cab: [coupeCab, glass],
    sedan: [sedan, paint],
    sedanCab: [sedanCab, glass],
    wagonCab: [wagonCab, glass],
    box: [box, paint],
    cylinder: [new THREE.CylinderGeometry(0.5, 0.5, 1, 10), paint],
    tyre: [new THREE.CylinderGeometry(0.5, 0.5, 1, 14), paint],
    rim: [new THREE.CylinderGeometry(0.5, 0.5, 1, 8), paint],
    head: [new THREE.IcosahedronGeometry(0.5, 0), paint],
    lamp: [box, emissive],
    shadow: [disc, shadow],
  }

  return Object.fromEntries(meshKinds.map(kind => {
    const mesh = new THREE.InstancedMesh(...definitions[kind], capacity[kind])
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.name = 'Actors ' + kind
    scene.add(mesh)
    return [kind, mesh]
  })) as Record<MeshKind, THREE.InstancedMesh>
}

const transform = new THREE.Object3D()
function part(
  kind: MeshKind, color: Paint, x: number, y: number, z: number,
  sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0,
): Part {
  transform.position.set(x, y, z)
  transform.scale.set(sx, sy, sz)
  transform.rotation.set(rx, ry, rz)
  transform.updateMatrix()
  return { kind, matrix: transform.matrix.clone(), color: new THREE.Color(color) }
}

const VEHICLE_COLORS = [0x84c9c2, 0xf4c189, 0xb4a0de, 0xc2cc86, 0xd692ab, 0x90b6e1, 0xffdfb7, 0xaf7778]
const TIRE = 0x211f2d
const WINDOW = 0x29263d
const FASCIA = 0x362435
const POLICE_BLUE = 0x242841
const POLICE_IVORY = 0xf6ebdf
const CORAL = 0xe96058
const CORAL_LIGHT = 0xff9a7d
const BRAKE_IDLE = new THREE.Color(0xc74b53)
const BRAKE_ON = new THREE.Color(0xff454c)
const BLUE_OFF = new THREE.Color(0x3d6b95)
const BLUE_ON = new THREE.Color(0x6bdbff)
const RED_OFF = new THREE.Color(0x924254)
const RED_ON = new THREE.Color(0xff426b)
const WHITE = new THREE.Color(0xffffff)

type Car = Snapshot['vehicles'][number]
type Person = Snapshot['pedestrians'][number]

interface VehicleVisual {
  body: Part[]
  brakes: Part[]
  beacons: Part[]
  wheelRim: number
  wheelSpin: number
  lastX: number
  lastZ: number
}

function makeVehicle({ id, kind, position }: Car): VehicleVisual {
  const coupe = kind === 'player'
  const police = kind === 'police'
  const wagon = kind === 'traffic' && id % 3 === 1
  const color = coupe ? CORAL : police ? POLICE_BLUE : VEHICLE_COLORS[id % VEHICLE_COLORS.length]
  const trim = coupe ? CORAL_LIGHT : police ? POLICE_IVORY : new THREE.Color(color).lerp(WHITE, 0.25)
  const all = [
    part(coupe ? 'body' : 'sedan', color, 0, 0, 0),
    part(coupe ? 'cab' : wagon ? 'wagonCab' : 'sedanCab', WINDOW, 0, 0, 0),
    part('box', police ? POLICE_IVORY : color, 0, wagon ? 0.817 : coupe ? 0.679 : 0.751, wagon ? -0.55 : -0.24,
      coupe ? 1.22 : 1.24, 0.048, wagon ? 1.92 : coupe ? 0.94 : 1.15),
    part('box', FASCIA, 0, -0.128, -1.924, 1.59, 0.174, 0.17),
    part('box', trim, 0, -0.214, -1.949, 1.55, 0.043, 0.143),
    part('box', TIRE, 0, -0.105, coupe ? 1.866 : 1.939, 1.55, 0.14, 0.153),
    part('box', POLICE_IVORY, 0, -0.105, -2.016, 0.287, 0.115, 0.029),
    part('box', FASCIA, 0, -0.107, -2.033, 0.157, 0.027, 0.013),
  ]
  const brakes: Part[] = []
  for (const side of [-1, 1]) {
    all.push(
      part('box', trim, side * 0.899, -0.042, -0.04, 0.06, 0.091, 2.13),
      part('box', FASCIA, side * 0.898, -0.216, -0.06, 0.07, 0.086, 1.70),
      part('box', FASCIA, side * 0.58, 0.107, coupe ? -1.945 : -1.957, 0.4, 0.175, 0.07),
      part('lamp', 0xffcc9b, side * 0.541, coupe ? 0.048 : 0.143, coupe ? 1.902 : 1.961, 0.34, 0.089, 0.026),
      part('cylinder', 0x777085, side * 0.57, -0.242, -1.961, 0.106, 0.152, 0.105, Math.PI / 2),
      part('box', trim, side * 0.70, 0.57, coupe ? -0.43 : -0.49, 0.045, 0.26, 0.079, 0, 0, -side * 0.09),
      part('box', color, side * 0.867, 0.35, 0.39, 0.24, 0.093, 0.169),
    )
    brakes.push(part('lamp', BRAKE_IDLE, side * (coupe ? 0.547 : 0.58), 0.12,
      coupe ? -1.984 : -1.997, coupe ? 0.256 : 0.322, 0.112, 0.018))
    if (coupe) all.push(part('lamp', 0xf7a477, side * 0.722, 0.12, -1.984, 0.062, 0.082, 0.018))
  }

  if (coupe) {
    all.push(
      part('box', FASCIA, 0, 0.369, -1.67, 1.61, 0.035, 0.119),
      part('box', CORAL_LIGHT, 0, 0.456, -1.729, 1.85, 0.091, 0.273, -0.06),
      part('box', CORAL, -0.62, 0.348, -1.72, 0.091, 0.171, 0.071, -0.23),
      part('box', CORAL, 0.62, 0.348, -1.72, 0.091, 0.171, 0.071, -0.23),
      part('box', 0x4c293a, 0, 0.12, -1.986, 0.284, 0.117, 0.033),
      part('lamp', 0xf5a467, 0, 0.123, -2.004, 0.213, 0.025, 0.01),
    )
    for (let slat = 0; slat < 4; slat++) {
      all.push(part('box', FASCIA, 0, 0.399 + slat * 0.071, -1.226 + slat * 0.077, 1.289, 0.037, 0.109, -0.41))
    }
  }

  const beacons: Part[] = []
  if (police) {
    all.push(
      part('box', 0xbab2ad, 0, 0.823, -0.19, 1.24, 0.1, 0.35),
      part('box', POLICE_IVORY, 0, 0.283, -1.55, 1.5, 0.065, 0.63),
    )
    for (const side of [-1, 1]) {
      all.push(
        part('box', POLICE_IVORY, side * 0.919, 0.083, 0.01, 0.054, 0.221, 1.53),
        part('box', 0x587395, side * 0.951, 0.046, -0.01, 0.02, 0.048, 1.23),
        part('box', 0xd6aa62, side * 0.956, 0.123, 0.0, 0.016, 0.116, 0.116, Math.PI / 4),
      )
      beacons.push(part('lamp', side < 0 ? BLUE_OFF : RED_OFF, side * 0.37, 0.907, -0.19, 0.43, 0.146, 0.302))
    }
  }

  return {
    body: all,
    brakes,
    beacons,
    wheelRim: coupe ? 0xdfbc9f : 0xa5a5b8,
    wheelSpin: 0,
    lastX: position.x,
    lastZ: position.z,
  }
}

function makeProp(prop: Prop): Part[] {
  if (prop.kind === 'hydrant') {
    return [
      part('cylinder', 0xb94c51, 0, -0.386, 0, 0.59, 0.132, 0.59),
      part('cylinder', 0xda5654, 0, -0.073, 0, 0.398, 0.598, 0.398),
      part('head', 0xe47760, 0, 0.265, 0, 0.52, 0.34, 0.52),
      part('cylinder', 0xbc5355, 0.193, 0.043, 0, 0.248, 0.169, 0.248, 0, 0, Math.PI / 2),
      part('cylinder', 0xbc5355, -0.193, 0.043, 0, 0.248, 0.169, 0.248, 0, 0, Math.PI / 2),
      part('cylinder', 0xf3a970, 0, 0.013, 0.206, 0.221, 0.111, 0.221, Math.PI / 2),
    ]
  }
  if (prop.kind === 'pole') {
    return [
      part('cylinder', 0x44364d, 0, -1.318, 0, 0.33, 0.32, 0.33),
      part('cylinder', 0x64627b, 0, -0.075, 0, 0.128, 2.75, 0.128),
      part('box', 0x64627b, 0.238, 1.285, 0, 0.533, 0.066, 0.094),
      part('box', 0x414459, 0.491, 1.276, 0, 0.373, 0.157, 0.251),
      part('lamp', 0xffd6a4, 0.491, 1.193, 0, 0.296, 0.029, 0.199),
    ]
  }
  return [
    part('cylinder', 0x555166, 0, -0.469, 0, 0.38, 0.101, 0.38),
    part('cylinder', 0x39364f, 0, -0.028, 0, 0.267, 0.879, 0.267),
    part('cylinder', 0xe5a470, 0, 0.252, 0, 0.275, 0.123, 0.275),
    part('head', 0x5b566e, 0, 0.386, 0, 0.29, 0.261, 0.29),
  ]
}

interface PersonVisual {
  body: Part[]
  trousers: THREE.Color
  complexion: THREE.Color
  shirt: THREE.Color
  shoes: THREE.Color
}

const SHIRTS = [0x70c5b4, 0xe78e84, 0xb3a6df, 0xebad72, 0x6ca5ce, 0xe19bb4]
const SKIN = [0xe2b48f, 0x986042, 0xc8916e, 0xdfa784, 0x9f6c4f, 0xf2c9a8]
const PANTS = [0x4d405e, 0x6d647e, 0x433d60, 0x776054, 0x5d516e, 0x584e61]

function makePerson(style: number): PersonVisual {
  const shirt = new THREE.Color(SHIRTS[style])
  const complexion = new THREE.Color(SKIN[style])
  const trousers = new THREE.Color(PANTS[style])
  const shoes = new THREE.Color(style % 2 === 0 ? 0xe8dad2 : 0x373242)
  return {
    shirt, complexion, trousers, shoes,
    body: [
      part('box', shirt, 0, 1.148, 0, 0.405, 0.43, 0.258),
      part('cylinder', complexion, 0, 1.406, 0.001, 0.137, 0.135, 0.147),
      part('head', complexion, 0, 1.552, 0.004, 0.285, 0.334, 0.291),
      part('head', style === 3 ? 0xf4c58c : 0x47323e, 0, 1.644, -0.035, 0.29, 0.202, 0.276),
    ],
  }
}

export class Actors {
  private readonly meshes: ReturnType<typeof makeMeshes>
  private readonly fleet = new Map<number, VehicleVisual>()
  private readonly props: Map<string, Part[]>
  private readonly people = SHIRTS.map((_, index) => makePerson(index))
  private readonly pose = new THREE.Object3D()
  private readonly local = new THREE.Object3D()
  private readonly matrix = new THREE.Matrix4()
  private readonly limb = new THREE.Matrix4()
  private readonly animation = new THREE.Matrix4()
  private readonly tint = new THREE.Color()

  constructor(scene: THREE.Scene, district: District) {
    const cars = 1 + district.policeSpawns.length + district.trafficSpawns.length
    const props = district.props.length
    const people = district.blocks.length * 2
    this.meshes = makeMeshes(scene, {
      body: cars, cab: cars, sedan: cars, sedanCab: cars, wagonCab: cars,
      box: cars * 32 + props * 3 + people * 9,
      cylinder: cars * 2 + props * 6 + people,
      tyre: cars * 4, rim: cars * 4, head: props + people * 2,
      lamp: cars * 8 + props, shadow: cars + people,
    })
    this.props = new Map(district.props.map(prop => [prop.id, makeProp(prop)]))
  }

  update(snapshot: Snapshot, time: number): void {
    for (const kind of meshKinds) this.meshes[kind].count = 0
    for (const car of snapshot.vehicles) this.drawVehicle(car, snapshot.wanted.level > 0, time)
    for (const person of snapshot.pedestrians) this.drawPerson(person, time)
    for (const prop of snapshot.props) {
      const pieces = this.props.get(prop.id)
      if (!prop.visible || !pieces) continue
      this.setPose(prop.position, prop.rotation)
      for (const piece of pieces) {
        this.drawPart(piece, prop.broken ? this.tint.copy(piece.color).multiplyScalar(0.64) : piece.color)
      }
    }
    for (const kind of meshKinds) {
      const mesh = this.meshes[kind]
      if (!mesh.count) continue
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  private drawVehicle(car: Car, sirens: boolean, time: number): void {
    let visual = this.fleet.get(car.id)
    if (!visual) {
      visual = makeVehicle(car)
      this.fleet.set(car.id, visual)
    }
    this.setPose(car.position, car.rotation)
    for (const piece of visual.body) this.drawPart(piece)
    for (const brake of visual.brakes) this.drawPart(brake, car.braking ? BRAKE_ON : BRAKE_IDLE)

    const pulse = Math.floor(time * 9) % 4
    for (let i = 0; i < visual.beacons.length; i++) {
      const color = i === 0
        ? (sirens && pulse < 2 ? BLUE_ON : BLUE_OFF)
        : (sirens && pulse >= 2 ? RED_ON : RED_OFF)
      this.drawPart(visual.beacons[i], color)
    }

    const { x, z } = car.position
    const { x: qx, y: qy, z: qz, w: qw } = car.rotation
    const heading = Math.atan2(2 * (qx * qz + qw * qy), 1 - 2 * (qx * qx + qy * qy))
    const dx = x - visual.lastX
    const dz = z - visual.lastZ
    if (Math.hypot(dx, dz) < 5) {
      const distance = dx * Math.sin(heading) + dz * Math.cos(heading)
      visual.wheelSpin = (visual.wheelSpin + distance / 0.307) % (Math.PI * 2)
    }
    visual.lastX = x
    visual.lastZ = z

    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) {
        const turn = end === 1 ? car.steer * 0.42 : 0
        const wheelX = side * 0.827
        const wheelZ = end * 1.238
        this.drawShape('tyre', TIRE, wheelX, -0.127, wheelZ, 0.614, 0.281, 0.614, 0, turn, Math.PI / 2)
        this.drawShape('rim', visual.wheelRim,
          wheelX + side * Math.cos(turn) * 0.137, -0.127, wheelZ - side * Math.sin(turn) * 0.137,
          0.401, 0.028, 0.401, visual.wheelSpin, turn, Math.PI / 2)
      }
    }
    this.drawShadow(x, 0.021, z, 2.22, 4.31, heading)
  }

  private drawPerson(person: Person, time: number): void {
    const visual = this.people[person.style]
    const stride = time * (person.fleeing ? 13 : 6) + person.id * 1.93
    const swing = Math.sin(stride) * (person.fleeing ? 0.78 : 0.29)
    const bounce = Math.abs(Math.cos(stride)) * (person.fleeing ? 0.106 : 0.025)
    this.pose.position.set(person.x, 0.13 + bounce, person.z)
    this.pose.rotation.set(person.fleeing ? 0.13 : 0, person.heading, 0, 'YXZ')
    this.pose.updateMatrix()
    for (const piece of visual.body) this.drawPart(piece)

    for (const side of [-1, 1]) {
      this.animation.makeRotationX(side * swing)
      this.animation.setPosition(side * 0.11, 0.95, 0)
      this.limb.multiplyMatrices(this.pose.matrix, this.animation)
      this.drawShape('box', visual.trousers, 0, -0.393, 0, 0.158, 0.833, 0.161, 0, 0, 0, this.limb)
      this.drawShape('box', visual.shoes, 0, -0.854, 0.049, 0.171, 0.147, 0.276, 0, 0, 0, this.limb)

      this.animation.makeRotationX(-side * swing * 0.75)
      this.animation.setPosition(side * 0.255, 1.294, 0)
      this.limb.multiplyMatrices(this.pose.matrix, this.animation)
      this.drawShape('box', visual.shirt, 0, -0.129, 0, 0.136, 0.31, 0.147, 0, 0, 0, this.limb)
      this.drawShape('box', visual.complexion, 0, -0.389, 0, 0.105, 0.296, 0.109, 0, 0, 0, this.limb)
    }
    this.drawShadow(person.x, 0.139, person.z, 0.73, 0.7, person.heading)
  }

  private setPose(position: Car['position'], rotation: Car['rotation']): void {
    this.pose.position.set(position.x, position.y, position.z)
    this.pose.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
    this.pose.updateMatrix()
  }

  private drawPart(part: Part, color = part.color): void {
    this.matrix.multiplyMatrices(this.pose.matrix, part.matrix)
    this.write(part.kind, this.matrix, color)
  }

  private drawShape(
    kind: MeshKind, color: Paint, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0, parent = this.pose.matrix,
  ): void {
    this.local.position.set(x, y, z)
    this.local.scale.set(sx, sy, sz)
    this.local.rotation.set(rx, ry, rz, 'YXZ')
    this.local.updateMatrix()
    this.matrix.multiplyMatrices(parent, this.local.matrix)
    this.write(kind, this.matrix, typeof color === 'number' ? this.tint.setHex(color) : color)
  }

  private drawShadow(x: number, y: number, z: number, width: number, depth: number, heading: number): void {
    this.local.position.set(x, y, z)
    this.local.rotation.set(0, heading, 0)
    this.local.scale.set(width, 1, depth)
    this.local.updateMatrix()
    this.write('shadow', this.local.matrix, WHITE)
  }

  private write(kind: MeshKind, matrix: THREE.Matrix4, color: THREE.Color): void {
    const mesh = this.meshes[kind]
    mesh.setMatrixAt(mesh.count, matrix)
    mesh.setColorAt(mesh.count, color)
    mesh.count++
  }
}

import * as THREE from 'three'
import { RANGE_EDGE, type DemoSnapshot } from '../sim/demo'
import { buildSky } from './city'

const LANE_X = -2
const FORWARD = new THREE.Vector3(0, 0, 1)
const BOX = new THREE.BoxGeometry(1, 1, 1)

interface Mark {
  x: number
  z: number
  width: number
  depth: number
  color: number
  yaw?: number
  height?: number
}

function strip(scene: THREE.Scene, marks: Mark[], raised = false): void {
  const material = new THREE.MeshBasicMaterial({ toneMapped: false })
  const mesh = new THREE.InstancedMesh(BOX, material, marks.length)
  const transform = new THREE.Object3D()
  const color = new THREE.Color()
  marks.forEach(({ x, z, width, depth, color: tint, yaw = 0, height = 0.004 }, i) => {
    transform.position.set(x, (raised ? height / 2 : 0.013), z)
    transform.rotation.y = yaw
    transform.scale.set(width, height, depth)
    transform.updateMatrix()
    mesh.setMatrixAt(i, transform.matrix)
    mesh.setColorAt(i, color.setHex(tint))
  })
  scene.add(mesh)
}

function ground(scene: THREE.Scene, size: number, color: number, y: number): void {
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ color, toneMapped: false }))
  surface.rotation.x = -Math.PI / 2
  surface.position.y = y
  scene.add(surface)
}

function buildPad(scene: THREE.Scene): void {
  ground(scene, 760, 0x52425d, -0.045)
  ground(scene, RANGE_EDGE * 2, 0x2d293d, -0.003)
  const straight = new THREE.Mesh(new THREE.PlaneGeometry(16, 198),
    new THREE.MeshBasicMaterial({ color: 0x353044, toneMapped: false }))
  straight.rotation.x = -Math.PI / 2
  straight.position.set(LANE_X, 0.001, 0)
  scene.add(straight)

  const grid: Mark[] = []
  const lane: Mark[] = []
  const curbs: Mark[] = []
  for (let i = -108; i <= 108; i += 12) {
    grid.push(
      { x: i, z: 0, width: 0.055, depth: 228, color: 0x433a53 },
      { x: 0, z: i, width: 228, depth: 0.055, color: 0x433a53 },
    )
  }
  for (const direction of [-1, 1]) {
    lane.push(
      { x: LANE_X + direction * 8, z: 0, width: 0.09, depth: 198, color: 0x8ed9de },
      { x: LANE_X, z: direction * 99, width: 16, depth: 0.13, color: 0x8ed9de },
    )
    for (let segment = 3; segment < RANGE_EDGE * 2; segment += 6) {
      const i = segment - RANGE_EDGE
      const rim = direction * RANGE_EDGE
      const size = Math.min(5.98, (RANGE_EDGE - Math.abs(i)) * 2)
      const color = segment % 12 === 3 ? 0xed8a7a : 0x755068
      curbs.push(
        { x: rim, z: i, width: 0.70, depth: size, color, height: 0.8 },
        { x: i, z: rim, width: size, depth: 0.70, color, height: 0.8 },
      )
    }
  }
  for (let z = -92; z <= 92; z += 8) {
    lane.push({ x: LANE_X, z, width: 0.1, depth: 3.6, color: 0xe5a680 })
  }
  for (let step = 0; step < 20; step++) {
    for (let row = 0; row < 2; row++) {
      if ((step + row) % 2 === 0) {
        lane.push({ x: LANE_X - 7.6 + step * 0.8, z: -27 + row * 0.75, width: 0.8, depth: 0.75, color: 0xa997ad })
      }
    }
  }

  strip(scene, grid)
  strip(scene, lane)
  strip(scene, curbs, true)
  for (const [x, z] of [[-36, 0], [34, 29]]) {
    for (const radius of [12, 16.5]) {
      const circle = new THREE.Mesh(new THREE.RingGeometry(radius - 0.07, radius, 72),
        new THREE.MeshBasicMaterial({ color: 0x98718c, toneMapped: false }))
      circle.rotation.x = -Math.PI / 2
      circle.position.set(x, 0.018, z)
      scene.add(circle)
    }
  }

  const peaks: number[] = []
  const radius = 310
  for (let sector = 0; sector < 112; sector++) {
    const angle = sector * Math.PI * 2 / 112
    const next = (sector + 1) * Math.PI * 2 / 112
    const ridge = (a: number) => 8 + 13 * Math.abs(Math.sin(a * 2.5 + 0.3))
      + 6 * Math.abs(Math.sin(a * 10.5)) + 4 * Math.abs(Math.cos(a * 17.5))
    const x = Math.sin(angle) * radius
    const z = Math.cos(angle) * radius
    const nextX = Math.sin(next) * radius
    const nextZ = Math.cos(next) * radius
    peaks.push(x, -1, z, x, ridge(angle), z, nextX, ridge(next), nextZ,
      x, -1, z, nextX, ridge(next), nextZ, nextX, -1, nextZ)
  }
  const horizon = new THREE.BufferGeometry()
  horizon.setAttribute('position', new THREE.Float32BufferAttribute(peaks, 3))
  scene.add(new THREE.Mesh(horizon, new THREE.MeshBasicMaterial({ color: 0x926685, fog: false, side: THREE.DoubleSide })))
}

function box(parent: THREE.Group, material: THREE.Material, x: number, y: number, z: number,
  width: number, height: number, depth: number): THREE.Mesh {
  const mesh = new THREE.Mesh(BOX, material)
  mesh.position.set(x, y, z)
  mesh.scale.set(width, height, depth)
  parent.add(mesh)
  return mesh
}

function createCar(scene: THREE.Scene) {
  const car = new THREE.Group()
  const body = new THREE.Group()
  body.scale.z = 1.31
  car.add(body)
  scene.add(car)
  const paint = new THREE.MeshStandardMaterial({ color: 0xf15c52, roughness: 0.72 })
  const highlight = new THREE.MeshStandardMaterial({ color: 0xfdb395, roughness: 0.6 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x222035, roughness: 0.62 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x444969, roughness: 0.35 })
  const brakeLight = new THREE.MeshBasicMaterial({ color: 0xe6677f, toneMapped: false })
  const headlight = new THREE.MeshBasicMaterial({ color: 0xffddb5, toneMapped: false })

  box(body, dark, 0, -0.21, 0, 1.49, 0.14, 2.53)
  box(body, paint, 0, 0.03, 0, 1.59, 0.38, 2.77)
  box(body, highlight, 0, 0.045, -1.40, 1.60, 0.09, 0.075)
  box(body, paint, 0, 0.257, 0.78, 1.52, 0.095, 0.91)
  const cab = new THREE.BufferGeometry()
  const bottom = [-0.66, 0.13, -0.85, 0.66, 0.13, -0.85, 0.66, 0.13, 0.59, -0.66, 0.13, 0.59]
  const top = [-0.56, 0.568, -0.57, 0.56, 0.568, -0.57, 0.56, 0.568, 0.23, -0.56, 0.568, 0.23]
  cab.setAttribute('position', new THREE.Float32BufferAttribute([...bottom, ...top], 3))
  cab.setIndex([0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0, 4, 7, 6, 4, 6, 5])
  const flatCab = cab.toNonIndexed()
  flatCab.computeVertexNormals()
  body.add(new THREE.Mesh(flatCab, glass))
  cab.dispose()
  box(body, paint, 0, 0.574, -0.17, 1.16, 0.07, 0.84)
  box(body, dark, 0, -0.063, -1.408, 1.4, 0.125, 0.08)
  box(body, highlight, 0, -0.092, -1.455, 0.24, 0.07, 0.019)

  const wheelGeometry = new THREE.CylinderGeometry(0.31, 0.31, 0.185, 14)
  wheelGeometry.rotateZ(Math.PI / 2)
  const rimGeometry = new THREE.CylinderGeometry(0.158, 0.158, 0.028, 10)
  rimGeometry.rotateZ(Math.PI / 2)
  const wheels: Array<{ axle: THREE.Group; hub: THREE.Group; front: boolean }> = []
  for (const side of [-1, 1]) {
    box(body, highlight, side * 0.799, 0.075, -0.10, 0.04, 0.069, 1.78)
    box(body, dark, side * 0.56, 0.134, -1.39, 0.34, 0.114, 0.034)
    box(body, brakeLight, side * 0.56, 0.134, -1.412, 0.27, 0.068, 0.018)
    box(body, headlight, side * 0.56, 0.12, 1.391, 0.30, 0.09, 0.027)
    for (const front of [false, true]) {
      const axle = new THREE.Group()
      const hub = new THREE.Group()
      axle.position.set(side * 0.75, -0.25, front ? 1.17 : -1.17)
      axle.add(hub)
      hub.add(new THREE.Mesh(wheelGeometry, dark))
      const rim = new THREE.Mesh(rimGeometry, highlight)
      rim.position.x = side * 0.092
      hub.add(rim)
      box(hub, dark, side * 0.109, 0, 0, 0.009, 0.239, 0.032)
      box(hub, dark, side * 0.109, 0, 0, 0.009, 0.032, 0.239)
      car.add(axle)
      wheels.push({ axle, hub, front })
    }
  }

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 18), new THREE.MeshBasicMaterial({
    color: 0x151225, transparent: true, opacity: 0.42, depthWrite: false,
  }))
  shadow.geometry.rotateX(-Math.PI / 2)
  shadow.scale.set(1.03, 1, 2.0)
  scene.add(shadow)
  return { car, brakeLight, wheels, shadow }
}

export class DemoRenderer {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(53, 1, 0.12, 435)
  private readonly renderer: THREE.WebGLRenderer
  private readonly vehicle = createCar(this.scene)
  private readonly forward = new THREE.Vector3()
  private readonly targetPosition = new THREE.Vector3()
  private readonly targetFocus = new THREE.Vector3()
  private readonly focus = new THREE.Vector3()
  private snapCamera = true

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.13
    this.scene.fog = new THREE.Fog(0xb37c9a, 48, 245)
    const sunlight = new THREE.DirectionalLight(0xffc295, 2.35)
    sunlight.position.set(-4, 8, 10)
    this.scene.add(sunlight, new THREE.HemisphereLight(0xffdfec, 0x716ea1, 2.25))
    buildSky(this.scene)
    buildPad(this.scene)
  }

  resetCamera(): void {
    this.snapCamera = true
  }

  render(snapshot: DemoSnapshot, dt: number): void {
    const { position, rotation, speed, steer, drifting } = snapshot
    const { car, brakeLight, wheels, shadow } = this.vehicle
    car.position.set(position.x, position.y, position.z)
    car.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
    this.forward.copy(FORWARD).applyQuaternion(car.quaternion)
    this.forward.y = 0
    if (this.forward.lengthSq() < 0.01) this.forward.copy(FORWARD)
    this.forward.normalize()

    const elapsed = THREE.MathUtils.clamp(dt, 0, 0.08)
    brakeLight.color.setHex(drifting ? 0xff4667 : 0xe6677f)
    for (const { axle, hub, front } of wheels) {
      axle.rotation.y = front ? steer * 0.46 : 0
      hub.rotation.x += speed * elapsed / 0.31
    }
    shadow.position.set(position.x, 0.022, position.z)
    shadow.rotation.y = Math.atan2(this.forward.x, this.forward.z)

    const speedFraction = THREE.MathUtils.clamp(Math.abs(speed) / 30, 0, 1)
    this.targetPosition.copy(car.position).addScaledVector(this.forward, -8.6 - 1.9 * speedFraction)
    this.targetPosition.y += 3.55 + 0.43 * speedFraction
    this.targetFocus.copy(car.position).addScaledVector(this.forward, 8.2 + 2.3 * speedFraction)
    this.targetFocus.y += 0.66
    this.camera.position.lerp(this.targetPosition, this.snapCamera ? 1 : 1 - Math.exp(-9 * elapsed))
    this.focus.lerp(this.targetFocus, this.snapCamera ? 1 : 1 - Math.exp(-12 * elapsed))
    this.snapCamera = false
    this.camera.lookAt(this.focus)

    const width = Math.max(1, this.canvas.clientWidth)
    const height = Math.max(1, this.canvas.clientHeight)
    const ratio = Math.min(window.devicePixelRatio, 1.5, Math.sqrt(2_400_000 / (width * height)))
    const fov = 53 + 6 * speedFraction
    if (this.renderer.domElement.width !== Math.floor(width * ratio)
      || this.renderer.domElement.height !== Math.floor(height * ratio)) {
      this.renderer.setPixelRatio(ratio)
      this.renderer.setSize(width, height, false)
    }
    if (this.camera.aspect !== width / height || Math.abs(this.camera.fov - fov) > 0.04) {
      this.camera.aspect = width / height
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    this.renderer.render(this.scene, this.camera)
  }
}

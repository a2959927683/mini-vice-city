import * as THREE from 'three'
import type { Building, District } from '../sim/district'

interface Instance {
  matrix: THREE.Matrix4
  color: number | THREE.Color
}

class Batch {
  private readonly chunks = new Map<string, Instance[]>()
  private readonly transform = new THREE.Object3D()

  constructor(private readonly geometry: THREE.BufferGeometry, private readonly material: THREE.Material) {}

  add(x: number, y: number, z: number, width: number, height: number, depth: number,
    color: number | THREE.Color, yaw = 0, pitch = 0, roll = 0): void {
    this.transform.position.set(x, y, z)
    this.transform.scale.set(width, height, depth)
    this.transform.rotation.set(pitch, yaw, roll, 'YXZ')
    this.transform.updateMatrix()
    const local = Math.abs(x) <= 104 && Math.abs(z) <= 104 && width <= 44 && depth <= 44
    const key = local ? `${Math.floor(x / 44)},${Math.floor(z / 44)}` : 'coast'
    let chunk = this.chunks.get(key)
    if (!chunk) {
      chunk = []
      this.chunks.set(key, chunk)
    }
    chunk.push({ matrix: this.transform.matrix.clone(), color })
  }

  mount(scene: THREE.Scene): void {
    const color = new THREE.Color()
    for (const instances of this.chunks.values()) {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, instances.length)
      instances.forEach((instance, index) => {
        mesh.setMatrixAt(index, instance.matrix)
        mesh.setColorAt(index, color.set(instance.color))
      })
      mesh.computeBoundingSphere()
      scene.add(mesh)
    }
  }
}

interface CityBatches {
  solid: Batch
  neon: Batch
  cylinders: Batch
  leaves: Batch
}

export function buildSky(scene: THREE.Scene): void {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        vec4 projected = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = projected.xyww;
      }
    `,
    fragmentShader: `
      varying vec3 skyDirection;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(13.17, 72.29))) * 37459.23);
      }

      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
      }

      void main() {
        vec3 direction = normalize(skyDirection);
        vec3 sunDirection = normalize(vec3(-0.047, 0.115, 1.0));
        float altitude = direction.y;
        float toSun = length(direction - sunDirection);
        float horizon = smoothstep(-0.09, 0.36, altitude);
        float overhead = smoothstep(0.21, 0.86, altitude);
        vec3 sky = mix(vec3(0.96, 0.47, 0.33), vec3(0.50, 0.13, 0.38), horizon);
        sky = mix(sky, vec3(0.092, 0.034, 0.22), overhead);
        sky += vec3(0.33, 0.16, 0.055) * exp(-toSun * 5.6);

        float angle = atan(direction.x, direction.z);
        vec2 cloudPosition = vec2(angle * 3.2, altitude * 35.0);
        float clouds = noise2(cloudPosition) * 0.7 + noise2(cloudPosition * 2.16) * 0.3;
        float wisps = smoothstep(0.59, 0.8, clouds)
          * smoothstep(0.055, 0.19, altitude) * (1.0 - smoothstep(0.25, 0.57, altitude));
        sky = mix(sky, vec3(0.48, 0.16, 0.32), wisps * 0.42);
        float cloudRim = smoothstep(0.57, 0.63, clouds) - smoothstep(0.63, 0.72, clouds);
        sky += vec3(0.13, 0.055, 0.07) * cloudRim * wisps;

        float sun = 1.0 - smoothstep(0.054, 0.0557, toSun);
        float stripe = smoothstep(0.58, 0.81, fract((altitude - sunDirection.y + 0.056) * 176.0));
        float lowerSun = 1.0 - smoothstep(sunDirection.y - 0.024, sunDirection.y - 0.01, altitude);
        vec3 solar = mix(vec3(1.0, 0.58, 0.22), vec3(1.0, 0.92, 0.62),
          smoothstep(sunDirection.y - 0.056, sunDirection.y + 0.05, altitude));
        sky = mix(sky, solar, sun * (1.0 - stripe * lowerSun * 0.9));
        sky += (hash(gl_FragCoord.xy) - 0.5) * 0.008;
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }
    `,
  }))
  sky.frustumCulled = false
  // Geometry fills the depth buffer first, leaving only visible sky fragments to shade.
  sky.renderOrder = 100
  scene.add(sky)
}

function lightCity(scene: THREE.Scene): void {
  scene.fog = new THREE.Fog(0xd490a8, 76, 235)
  const hemisphere = new THREE.HemisphereLight(0xffdeed, 0x4d5a91, 1.92)
  const key = new THREE.DirectionalLight(0xffc6a2, 2.28)
  key.position.set(-25, 26, 66)
  const fill = new THREE.DirectionalLight(0x8aa8ff, 0.56)
  fill.position.set(20, 10, -46)
  scene.add(hemisphere, key, fill)
}

function buildCoast({ solid, neon }: CityBatches, district: District, random: () => number): void {
  const extent = district.halfExtent
  solid.add(0, -1.82, 0, 620, 0.4, 620, 0x49345c)
  solid.add(0, -0.805, 0, extent * 2 + 1, 1.6, extent * 2 + 1, 0x76617c)
  solid.add(0, -0.075, 0, extent * 2, 0.15, extent * 2, 0x423746)
  for (let i = 0; i < 210; i++) {
    const across = (random() - 0.5) * 520
    const distance = 108 + random() * 150
    const color = [0x65415f, 0x81506d, 0x594365, 0xa56278][i % 4]
    const length = 3 + random() * 17
    const edge = i % 4
    const x = edge < 2 ? across : distance * (edge === 2 ? 1 : -1)
    const z = edge >= 2 ? across : distance * (edge === 0 ? 1 : -1)
    neon.add(x, -1.61, z, length, 0.007, 0.1 + random() * 0.36, color)
  }
  for (let i = -extent + 1; i < extent; i += 4) {
    for (const sign of [-1, 1]) {
      solid.add(i, 0.38, sign * (extent - 0.22), 0.2, 0.76, 0.22, 0x786b8d)
      solid.add(sign * (extent - 0.22), 0.38, i, 0.22, 0.76, 0.2, 0x786b8d)
    }
  }
  for (const sign of [-1, 1]) {
    for (const y of [0.31, 0.73]) {
      solid.add(0, y, sign * (extent - 0.22), extent * 2, 0.09, 0.11, 0x8b7d95)
      solid.add(sign * (extent - 0.22), y, 0, 0.11, 0.09, extent * 2, 0x8b7d95)
    }
  }

  for (let i = 0; i < 43; i++) {
    const angle = i * (Math.PI * 2 / 43) + random() * 0.08
    const distance = 154 + random() * 67
    const width = 7 + random() * 14
    const height = 9 + random() * random() * 35
    const x = Math.sin(angle) * distance
    const z = Math.cos(angle) * distance
    const color = [0x625072, 0x755778, 0x634d70, 0x866183][i % 4]
    if (z > 110 && x > -24 && x < 15) continue
    solid.add(x, height / 2 - 2, z, width, height, width * 0.78, color, angle)
    if (i % 3 !== 0) {
      solid.add(x, height - 0.3, z, width * 0.65, 3.5, width * 0.54, color, angle)
    }
    if (i % 4 === 0) {
      solid.add(x, height + 2.6, z, 0.18, 3.1, 0.18, 0x675473)
      neon.add(x, height + 4.2, z, 0.27, 0.27, 0.27, 0xff8ab0)
    }
    for (let band = 4; band < height - 3; band += 3.5) {
      const spread = width * 0.395
      neon.add(x - Math.sin(angle) * spread, band, z - Math.cos(angle) * spread,
        width * 0.78, 0.21, 0.037, i % 2 === 0 ? 0x9e868c : 0x867790, angle)
    }
  }
}

function buildRoads({ solid, neon }: CityBatches, district: District, random: () => number): void {
  const { axes, halfExtent, roadWidth } = district
  for (const axis of axes) {
    solid.add(axis, 0.001, 0, roadWidth, 0.002, halfExtent * 2, 0x483d52)
    solid.add(0, 0.002, axis, halfExtent * 2, 0.002, roadWidth, 0x483d52)
  }
  for (let i = 0; i < axes.length - 1; i++) {
    const begin = axes[i] + 8.5
    const end = axes[i + 1] - 8.5
    const midpoint = (begin + end) / 2
    const length = end - begin
    for (const axis of axes) {
      const mark = (offset: number, at: number, width: number, depth: number, color: number) => {
        neon.add(axis + offset, 0.009, at, width, 0.005, depth, color)
        neon.add(at, 0.009, axis + offset, depth, 0.005, width, color)
      }
      for (const off of [-0.16, 0.16]) mark(off, midpoint, 0.12, length, 0xeab67a)
      for (const off of [-4, 4]) {
        for (let pos = begin + 2.4; pos < end; pos += 5.5) mark(off, pos, 0.11, 2.45, 0xc5b8bf)
      }
      for (const sign of [-1, 1]) {
        mark(sign * 7.7, midpoint, 0.08, length, 0x887183)
        for (let j = 0; j < 4; j++) {
          const position = begin + random() * length
          mark(sign * (6.93 + random() * 0.37), position, 0.05, 0.2 + random() * 2, 0x554a60)
        }
      }
    }
  }

  for (const x of axes) {
    for (const z of axes) {
      solid.add(x, 0.004, z, roadWidth, 0.003, roadWidth, 0x4e4051)
      for (const sign of [-1, 1]) {
        for (let line = -6.75; line <= 6.75; line += 1.35) {
          neon.add(x + line, 0.013, z + sign * 6.24, 0.72, 0.007, 1.45, 0xb4a4af)
          neon.add(x + sign * 6.24, 0.013, z + line, 1.45, 0.007, 0.72, 0xb4a4af)
        }
        neon.add(x - sign * 3.95, 0.013, z - sign * 7.85, 7.1, 0.007, 0.17, 0xb4a4af)
        neon.add(x - sign * 7.85, 0.013, z + sign * 3.95, 0.17, 0.007, 7.1, 0xb4a4af)
      }
    }
  }
}

function leafGeometry(): THREE.BufferGeometry {
  const distances = [0, 0.22, 0.46, 0.72, 1]
  const heights = [0, 0.145, 0.16, 0.08, -0.13]
  const widths = [0, 0.10, 0.15, 0.11, 0]
  const points: number[] = []
  const append = (i: number, side: number) => points.push(
    widths[i] * side, heights[i] - (side === 0 ? 0 : widths[i] * 0.5), distances[i],
  )
  for (let i = 0; i < distances.length - 1; i++) {
    for (const side of [-1, 1]) {
      append(i, 0)
      append(i + 1, 0)
      append(i, side)
      append(i, side)
      append(i + 1, 0)
      append(i + 1, side)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  geometry.computeVertexNormals()
  return geometry
}

function palm({ cylinders, leaves }: CityBatches, x: number, z: number, scale: number, phase: number): void {
  const height = 6.9 * scale
  const bend = 0.71 * scale
  const leanX = Math.sin(phase) * bend
  const leanZ = Math.cos(phase) * bend
  for (let i = 0; i < 5; i++) {
    const fraction = (i + 0.5) / 5
    const drift = fraction * fraction
    const thickness = (0.39 - fraction * 0.18) * scale
    cylinders.add(x + leanX * drift, 0.13 + height * fraction, z + leanZ * drift,
      thickness, height / 5 + 0.11, thickness, i % 2 === 0 ? 0x947168 : 0xa57e76,
      phase, fraction * 0.17)
  }
  for (let i = 0; i < 9; i++) {
    const wide = i < 6
    leaves.add(x + leanX, height + 0.16, z + leanZ, (wide ? 3.1 : 2.8) * scale, height * 0.41,
      (wide ? 3.5 + (i % 2) * 0.64 : 2.3) * scale,
      [0x347d70, 0x28836c, 0x429486, 0x4e9e7f, 0x407466][i % 5],
      phase + i * (wide ? 1.047 : 2.094), wide ? 0.02 : -0.25, 0.13 * ((i % 3) - 1))
  }
}

function buildBlocks(batch: CityBatches, district: District, random: () => number): void {
  const { solid, neon, cylinders } = batch
  district.blocks.forEach(({ x, z, width, depth }, index) => {
    solid.add(x, 0.06, z, width, 0.13, depth, 0xa49199)
    solid.add(x, 0.115, z, width - 0.29, 0.03, depth - 0.29, 0xaa949b)
    solid.add(x, 0.12, z, width - 4.25, 0.029, depth - 4.25, 0x8b778e)
    for (let i = -12; i < 13; i += 2.4) {
      for (const sign of [-1, 1]) {
        solid.add(x + i, 0.133, z + sign * 12.83, 0.035, 0.005, 2.1, 0x847682)
        solid.add(x + sign * 12.83, 0.133, z + i, 2.1, 0.005, 0.035, 0x847682)
      }
    }

    for (const sign of [-1, 1]) {
      const px = x + sign * 11.4
      const pz = z + sign * (index % 2 === 0 ? 10.75 : -10.75)
      solid.add(px, 0.148, pz, 1.58, 0.03, 1.58, 0x937a7d, 0.07)
      solid.add(px, 0.176, pz, 1.35, 0.026, 1.35, 0x6b6161, 0.07)
      palm(batch, px, pz, 0.76 + random() * 0.42, random() * Math.PI * 2)
    }

    const side = index % 2 === 0 ? 1 : -1
    const px = x + side * 12.55
    const pz = z - side * 12.5
    const yaw = side === 1 ? 0 : Math.PI
    cylinders.add(px, 1.85, pz, 0.135, 3.5, 0.135, 0x60576e)
    solid.add(px, 3.58, pz, 0.42, 0.91, 0.44, 0x342d46, yaw)
    for (let lamp = 0; lamp < 3; lamp++) {
      const lampColor = [0xf7a0ab, 0x735751, 0x537d70][lamp]
      cylinders.add(px, 3.87 - lamp * 0.29, pz + 0.229 * side, 0.124, 0.017, 0.124, lampColor, yaw, Math.PI / 2)
    }
    neon.add(px, 3.87, pz + 0.242 * side, 0.075, 0.075, 0.013, 0xff9a91)
  })
}

interface Face {
  x: number
  z: number
  yaw: number
  span: number
  sideX: number
  sideZ: number
  normalX: number
  normalZ: number
}

function faceBox(batch: Batch, face: Face, across: number, y: number, out: number,
  width: number, height: number, depth: number, color: number | THREE.Color): void {
  batch.add(face.x + face.sideX * across + face.normalX * out, y,
    face.z + face.sideZ * across + face.normalZ * out, width, height, depth, color, face.yaw)
}

function buildFacade({ solid, neon }: CityBatches, b: Building, face: Face, index: number, tint: THREE.Color): void {
  const isShop = b.style === 'shop'
  const isTower = b.style === 'tower'
  const levels = isShop ? 1 : Math.max(2, Math.floor((b.height - 2) / 2.6))
  const bays = isTower ? 4 : 3
  const opening = face.span / (bays + 0.9)
  const trim = tint.clone().lerp(new THREE.Color(0xf6d4c3), 0.46)
  const signage = [0xfa85bd, 0x90edf0, 0xffbf8b][index % 3]
  const levelHeight = (b.height - 2.55) / levels

  faceBox(solid, face, 0, 0.37, 0.025, face.span, 0.47, 0.09, 0x695365)
  faceBox(solid, face, 0, b.height - 0.36, 0.06, face.span + 0.12, 0.28, 0.19, trim)
  for (let bay = 0; bay < bays; bay++) {
    const across = (bay - (bays - 1) / 2) * opening
    const storefront = isShop || b.style === 'hotel'
    const glass = storefront ? 0x586982 : 0x635469
    faceBox(solid, face, across, storefront ? 1.26 : 1.13, 0.04,
      opening * 0.74, storefront ? 1.81 : 1.59, 0.12, glass)
    faceBox(neon, face, across, storefront ? 1.92 : 1.77, 0.105, opening * 0.64, 0.08, 0.016, 0xc998a0)
    faceBox(solid, face, across, 1.24, 0.115, 0.064, 1.76, 0.05, 0x70617e)

    if (!isShop) {
      for (let level = 0; level < levels; level++) {
        const y = 2.75 + levelHeight * (level + 0.43)
        const lit = (level * 7 + bay * 11 + index * 5) % 13 < 3
        const base = b.style === 'apartments' ? 0x685870 : 0x5e6080
        faceBox(solid, face, across, y, 0.05, opening * 0.69, levelHeight * 0.49, 0.14, trim)
        faceBox(lit ? neon : solid, face, across, y + 0.02, 0.131, opening * 0.59, levelHeight * 0.40, 0.04,
          lit ? 0xf0bb8d : base)
        faceBox(solid, face, across + (bay % 2 ? -0.22 : 0.22), y, 0.164, 0.05, levelHeight * 0.41, 0.038, trim)
        if (b.style === 'apartments' && level % 2 === 0) {
          faceBox(solid, face, across, y - levelHeight * 0.23, 0.28,
            opening * 0.87, 0.13, 0.64, trim)
        }
      }
    }
  }

  if (isShop) {
    const canopy = index % 2 === 0 ? 0xb76488 : 0x548d96
    faceBox(solid, face, 0, 2.38, 0.39, face.span * 0.88, 0.21, 0.82, canopy)
    faceBox(neon, face, 0, 2.30, 0.82, face.span * 0.87, 0.055, 0.039, signage)
    faceBox(solid, face, 0, b.height - 0.81, 0.031, face.span, 0.19, 0.096, canopy)
    faceBox(solid, face, 0, b.height - 1.08, 0.048, face.span, 0.068, 0.094, trim)
  }
  if (b.style === 'hotel' || isTower) {
    for (const edge of [-1, 1]) {
      faceBox(solid, face, edge * face.span * 0.43, b.height * 0.52, 0.065,
        0.27, b.height * 0.88, 0.17, trim)
      faceBox(neon, face, edge * face.span * 0.43, b.height * 0.57, 0.158,
        0.048, b.height * 0.66, 0.027, signage)
    }
    faceBox(neon, face, 0, b.height - 0.16, 0.07, face.span * 0.86, 0.085, 0.038, signage)
  }
}

function buildingFaces(b: Building): Face[] {
  return [
    { x: b.x, z: b.z + b.depth / 2, yaw: 0, span: b.width, sideX: 1, sideZ: 0, normalX: 0, normalZ: 1 },
    { x: b.x + b.width / 2, z: b.z, yaw: Math.PI / 2, span: b.depth, sideX: 0, sideZ: -1, normalX: 1, normalZ: 0 },
    { x: b.x, z: b.z - b.depth / 2, yaw: Math.PI, span: b.width, sideX: -1, sideZ: 0, normalX: 0, normalZ: -1 },
    { x: b.x - b.width / 2, z: b.z, yaw: -Math.PI / 2, span: b.depth, sideX: 0, sideZ: 1, normalX: -1, normalZ: 0 },
  ]
}

function buildBuildings(batch: CityBatches, district: District): void {
  const { solid, neon } = batch
  district.buildings.forEach((b, index) => {
    const tint = new THREE.Color(b.color).lerp(new THREE.Color(0xab6f88), 0.21)
    const band = tint.clone().lerp(new THREE.Color(0xf4c5bd), 0.54)
    solid.add(b.x, b.height / 2, b.z, b.width, b.height, b.depth, tint)
    buildingFaces(b).forEach((face, faceIndex) => buildFacade(batch, b, face, index + faceIndex, tint))
    if (b.style === 'tower' || b.style === 'hotel') {
      solid.add(b.x, b.height + 0.21, b.z, b.width * 0.83, 0.43, b.depth * 0.83, band)
      solid.add(b.x, b.height + 0.84, b.z, b.width * 0.67, 0.84, b.depth * 0.66, tint)
      solid.add(b.x, b.height + 1.51, b.z, b.width * 0.34, 0.50, b.depth * 0.38, band)
      if (index % 2 === 0) {
        solid.add(b.x, b.height + 2.35, b.z, 0.11, 1.18, 0.11, 0x6b536b)
        neon.add(b.x, b.height + 2.95, b.z, 0.15, 0.16, 0.15, 0xf990bf)
      }
    } else {
      solid.add(b.x, b.height + 0.16, b.z, b.width * 0.95, 0.31, b.depth * 0.95, band)
      solid.add(b.x - b.width * 0.24, b.height + 0.46, b.z, 1.31, 0.73, 1.2, 0x7e7186)
    }
  })
}

function makeSign(scene: THREE.Scene, name: string, style: 'pink' | 'blue', x: number, y: number, z: number,
  width: number, height: number, yaw: number, vertical = false): void {
  const canvas = document.createElement('canvas')
  canvas.width = vertical ? 128 : 512
  canvas.height = vertical ? 512 : 144
  const context = canvas.getContext('2d')
  if (!context) return
  const glow = style === 'pink' ? '#ff78ad' : '#66e4e9'
  const paper = style === 'pink' ? '#ffe5ed' : '#dbfbff'
  context.fillStyle = style === 'pink' ? '#39233e' : '#23364e'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = glow
  context.lineWidth = 3
  context.strokeRect(7, 7, canvas.width - 14, canvas.height - 14)
  context.lineWidth = 1
  context.strokeRect(14, 14, canvas.width - 28, canvas.height - 28)
  context.fillStyle = paper
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.shadowColor = glow
  context.shadowBlur = 13
  if (vertical) {
    const rows = [...name]
    context.font = 'bold 59px Georgia, serif'
    rows.forEach((letter, index) => context.fillText(letter, 64, 36 + (index + 0.5) * 440 / rows.length, 83))
  } else {
    context.font = 'bold 69px Georgia, serif'
    context.fillText(name, 256, 74, 442)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }))
  panel.position.set(x, y, z)
  panel.rotation.y = yaw
  scene.add(panel)
}

function buildLandmarks(scene: THREE.Scene, batch: CityBatches, district: District): void {
  const signs = [
    { id: 'block-1-1-building-3', name: 'MIRAGE', style: 'pink', size: 7.2 },
    { id: 'block-2-1-building-2', name: 'SEA GLASS', style: 'blue', size: 6.6 },
    { id: 'block-2-2-building-2', name: 'CORAL BAY', style: 'pink', size: 6.4 },
    { id: 'block-1-2-building-3', name: 'PALM ARCADE', style: 'blue', size: 6.7 },
  ] as const
  for (const detail of signs) {
    const building = district.buildings.find((candidate) => candidate.id === detail.id)
    if (!building) continue
    const front = building.z - building.depth / 2
    const accent = detail.style === 'pink' ? 0xfa88bd : 0x81edf1
    const y = building.style === 'shop' ? building.height - 0.45 : 3.14
    batch.solid.add(building.x, y, front - 0.08, detail.size + 0.16, 1.55, 0.24, 0x554259)
    makeSign(scene, detail.name, detail.style, building.x, y, front - 0.207, detail.size, 1.44, Math.PI)
    batch.neon.add(building.x, y - 0.79, front - 0.16, detail.size + 0.12, 0.055, 0.09, accent)
  }

  const blades = [
    { id: 'block-1-1-building-3', name: 'MIRAGE', color: 'pink', side: 1, offset: -0.7, height: 4.8 },
    { id: 'block-2-2-building-0', name: 'OASIS', color: 'blue', side: -1, offset: -1.1, height: 7.6 },
  ] as const
  for (const blade of blades) {
    const building = district.buildings.find((candidate) => candidate.id === blade.id)
    if (!building) continue
    const edge = building.x + blade.side * building.width / 2
    const x = edge + blade.side * 0.67
    const z = building.z + blade.offset
    const shade = blade.color === 'pink' ? 0x743e5f : 0x38626f
    batch.solid.add(x, blade.height, z, 1.03, 3.85, 0.26, shade)
    for (const y of [blade.height - 1.17, blade.height + 1.17]) {
      batch.solid.add(edge + blade.side * 0.18, y, z, 0.47, 0.10, 0.14, 0x61516c)
    }
    makeSign(scene, blade.name, blade.color, x, blade.height, z - 0.138, 1, 3.75, Math.PI, true)
    makeSign(scene, blade.name, blade.color, x, blade.height, z + 0.138, 1, 3.75, 0, true)
  }

  for (const block of district.blocks) {
    const x = block.x + 6
    const z = block.z + 6
    if (district.buildings.some((building) => building.x === x && building.z === z)) continue
    batch.solid.add(x, 0.145, z, 8.2, 0.03, 8.4, 0xc1908e)
    batch.solid.add(x, 0.151, z, 5.9, 0.02, 3, 0x5b849a)
    batch.neon.add(x, 0.164, z, 5.8, 0.015, 2.9, 0x6299a5)
    for (let ripple = 0; ripple < 6; ripple++) {
      batch.neon.add(x - 1.65 + ripple * 0.66, 0.177, z - 0.94 + (ripple % 3) * 1.01,
        0.86, 0.005, 0.033, 0xbfe1d4)
    }
  }
}

export function buildCity(scene: THREE.Scene, district: District): void {
  const standard = new THREE.MeshStandardMaterial({ roughness: 0.92 })
  const basic = new THREE.MeshBasicMaterial({ toneMapped: false })
  const cube = new THREE.BoxGeometry(1, 1, 1)
  const batch: CityBatches = {
    solid: new Batch(cube, standard),
    neon: new Batch(cube, basic),
    cylinders: new Batch(new THREE.CylinderGeometry(0.42, 0.5, 1, 7), standard),
    leaves: new Batch(leafGeometry(), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.92 })),
  }
  let seed = 2159
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  buildSky(scene)
  lightCity(scene)
  buildCoast(batch, district, random)
  buildRoads(batch, district, random)
  buildBlocks(batch, district, random)
  buildBuildings(batch, district)
  buildLandmarks(scene, batch, district)
  Object.values(batch).forEach((group) => group.mount(scene))
}

import * as THREE from 'three'
import type { District } from '../sim/district'
import { FIXED_DT, type Snapshot } from '../sim/simulation'
import { Actors } from './actors'
import { buildCity } from './city'

const PLAYER_FORWARD = new THREE.Vector3(0, 0, 1)

/** Critically damped spring with an analytic step, so damping survives frame hitches. */
function spring(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  target: THREE.Vector3,
  offset: THREE.Vector3,
  stiffness: number,
  dt: number,
): void {
  const decay = Math.exp(-stiffness * dt)
  offset.subVectors(position, target)
  position.copy(target)
    .addScaledVector(offset, (1 + stiffness * dt) * decay)
    .addScaledVector(velocity, dt * decay)
  velocity.multiplyScalar((1 - stiffness * dt) * decay)
    .addScaledVector(offset, -(stiffness ** 2) * dt * decay)
}

export class GameRenderer {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(56, 1, 0.18, 500)
  private readonly actors: Actors
  private readonly buildings: THREE.Box3[]

  private readonly rotation = new THREE.Quaternion()
  private readonly forward = new THREE.Vector3()
  private readonly playerPosition = new THREE.Vector3()
  private readonly previousPosition = new THREE.Vector3()
  private readonly movement = new THREE.Vector3()
  private readonly pivot = new THREE.Vector3()
  private readonly desiredPosition = new THREE.Vector3()
  private readonly desiredFocus = new THREE.Vector3()
  private readonly focus = new THREE.Vector3()
  private readonly cameraVelocity = new THREE.Vector3()
  private readonly focusVelocity = new THREE.Vector3()
  private readonly offset = new THREE.Vector3()
  private readonly cameraRay = new THREE.Ray()
  private readonly intersection = new THREE.Vector3()

  private previousFrame = -1
  private viewportWidth = 0
  private viewportHeight = 0
  private drift = 0

  constructor(private readonly canvas: HTMLCanvasElement, district: District) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    buildCity(this.scene, district)
    this.actors = new Actors(this.scene, district)
    this.buildings = district.buildings.map(({ x, z, width, depth, height }) => new THREE.Box3(
      new THREE.Vector3(x - width / 2 - 0.36, 0, z - depth / 2 - 0.36),
      new THREE.Vector3(x + width / 2 + 0.36, height + 0.36, z + depth / 2 + 0.36),
    ))
    this.resize()
  }

  resetCamera(): void {
    this.previousFrame = -1
  }

  render(snapshot: Snapshot, dt: number): void {
    this.resize()
    this.actors.update(snapshot, snapshot.frame * FIXED_DT)
    this.updateCamera(snapshot, THREE.MathUtils.clamp(dt, 0, 0.075))
    this.renderer.render(this.scene, this.camera)
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth)
    const height = Math.max(1, this.canvas.clientHeight)
    const pixelRatio = Math.min(window.devicePixelRatio, 1.5, Math.sqrt(2_400_000 / (width * height)))
    if (width === this.viewportWidth && height === this.viewportHeight && pixelRatio === this.renderer.getPixelRatio()) return
    if (pixelRatio !== this.renderer.getPixelRatio()) this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.viewportWidth = width
    this.viewportHeight = height
  }

  private updateCamera(snapshot: Snapshot, dt: number): void {
    const player = snapshot.vehicles.find((vehicle) => vehicle.kind === 'player')
    if (!player) return

    const { x, y, z } = player.position
    this.playerPosition.set(x, y, z)
    this.rotation.set(player.rotation.x, player.rotation.y, player.rotation.z, player.rotation.w)
    this.forward.copy(PLAYER_FORWARD).applyQuaternion(this.rotation)
    this.forward.y = 0
    if (this.forward.lengthSq() < 0.01) this.forward.copy(PLAYER_FORWARD)
    this.forward.normalize()

    const elapsedFrames = snapshot.frame - this.previousFrame
    const moved = this.movement.subVectors(this.playerPosition, this.previousPosition)
    const snap = this.previousFrame < 0 || elapsedFrames < 0 || moved.lengthSq() > 25 ** 2
    if (snap) {
      this.drift = 0
    } else if (elapsedFrames > 0) {
      const lateralSpeed = (moved.x * this.forward.z - moved.z * this.forward.x) / (elapsedFrames * FIXED_DT)
      this.drift = THREE.MathUtils.damp(this.drift, THREE.MathUtils.clamp(lateralSpeed, -14, 14), 7, dt)
    }
    this.previousFrame = snapshot.frame
    this.previousPosition.copy(this.playerPosition)

    const speed = THREE.MathUtils.clamp(player.speed / 27, 0, 1)
    const followDistance = 10.4 + speed * 1.7
    const sway = this.drift * 0.065
    this.pivot.set(x, y + 1.25, z)
    const cameraX = x - this.forward.x * followDistance - this.forward.z * sway
    const cameraY = y + 4.55 + speed * 0.7
    const cameraZ = z - this.forward.z * followDistance + this.forward.x * sway
    this.desiredPosition.set(cameraX, cameraY, cameraZ)
    let lookAhead = 7.5 + speed * 3.8
    if (this.avoidBuildings(this.desiredPosition)) {
      this.desiredPosition.set(cameraX, cameraY + 1.55, cameraZ)
      if (this.avoidBuildings(this.desiredPosition)) {
        const compression = Math.min(1, this.pivot.distanceTo(this.desiredPosition) / followDistance)
        lookAhead *= compression ** 2
      }
    }
    this.desiredFocus.set(
      x + this.forward.x * lookAhead + this.forward.z * sway,
      y + 0.48,
      z + this.forward.z * lookAhead - this.forward.x * sway,
    )

    if (snap) {
      this.camera.position.copy(this.desiredPosition)
      this.focus.copy(this.desiredFocus)
      this.cameraVelocity.set(0, 0, 0)
      this.focusVelocity.set(0, 0, 0)
    } else {
      spring(this.camera.position, this.cameraVelocity, this.desiredPosition, this.offset, 12.5, dt)
      spring(this.focus, this.focusVelocity, this.desiredFocus, this.offset, 16, dt)
      if (this.avoidBuildings(this.camera.position)) this.cameraVelocity.set(0, 0, 0)
    }

    const fov = snap ? 56 + speed * 7 : THREE.MathUtils.damp(this.camera.fov, 56 + speed * 7, 5.5, dt)
    if (Math.abs(fov - this.camera.fov) > 0.015) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    this.camera.lookAt(this.focus)
  }

  private avoidBuildings(position: THREE.Vector3): boolean {
    const direction = this.cameraRay.direction.subVectors(position, this.pivot)
    const length = direction.length()
    if (length < 0.05) return false

    this.cameraRay.origin.copy(this.pivot)
    direction.divideScalar(length)
    let distance = length
    for (const box of this.buildings) {
      const hit = this.cameraRay.intersectBox(box, this.intersection)
      if (hit) distance = Math.min(distance, this.pivot.distanceTo(hit))
    }
    if (distance === length) return false
    position.copy(this.pivot).addScaledVector(direction, Math.max(0.1, distance - 0.24))
    return true
  }
}

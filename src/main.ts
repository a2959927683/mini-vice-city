import './ui/styles.css'
import { GameRenderer } from './render/renderer'
import { FIXED_DT, Simulation } from './sim/simulation'
import type { DriveInput } from './sim/drivers'
import { installTestHook } from './testHook'
import { element, Hud } from './ui/hud'

const canvas = element<HTMLCanvasElement>('world')
const loading = element('loading')
const driveCodes = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'KeyR',
])

async function start(): Promise<void> {
  let sim = await Simulation.create()
  const renderer = new GameRenderer(canvas, sim.district)
  const hud = new Hud(sim.district, () => { void reset() })
  const keys = new Set<string>()
  let renderFrame = 0
  let lastTime = performance.now()
  let accumulated = 0
  let paused = false
  let resetting: Promise<void> | undefined

  const currentInput = (): DriveInput => {
    const held = (a: string, b: string) => Number(keys.has(a) || keys.has(b))
    return {
      throttle: held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown'),
      steer: held('KeyA', 'ArrowLeft') - held('KeyD', 'ArrowRight'),
      handbrake: keys.has('Space'),
    }
  }

  function paint(dt: number): void {
    const snapshot = sim.snapshot()
    renderer.render(snapshot, dt)
    hud.update(snapshot)
    renderFrame++
  }

  function reset(): Promise<void> {
    resetting ??= Simulation.create(sim.district).then((next) => {
      sim.dispose()
      sim = next
      keys.clear()
      accumulated = 0
      renderer.resetCamera()
      paint(FIXED_DT)
      canvas.focus()
    }).finally(() => { resetting = undefined })
    return resetting
  }

  window.addEventListener('keydown', (event) => {
    if (!driveCodes.has(event.code) || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return
    event.preventDefault()
    if (event.code === 'KeyR' && !event.repeat && !paused) {
      sim.resetPlayer()
      renderer.resetCamera()
    }
    keys.add(event.code)
  })
  window.addEventListener('keyup', (event) => keys.delete(event.code))
  window.addEventListener('blur', () => keys.clear())
  document.addEventListener('visibilitychange', () => {
    keys.clear()
    accumulated = 0
    lastTime = performance.now()
  })
  canvas.addEventListener('pointerdown', () => canvas.focus())

  const readState = () => ({ ...sim.snapshot(), renderFrame })
  const pause = () => {
    paused = true
    accumulated = 0
    keys.clear()
  }
  const step = (frames = 1) => {
    pause()
    const count = Number.isFinite(frames) ? Math.min(3600, Math.max(0, Math.floor(frames))) : 0
    for (let i = 0; i < count; i++) sim.step()
    paint(FIXED_DT)
    return readState()
  }
  installTestHook({
    readState,
    pause,
    resume: () => {
      paused = false
      lastTime = performance.now()
    },
    step,
    triggerPoliceCollision: () => {
      sim.stagePoliceCollision()
      return step(12)
    },
    teleportOutOfLOS: () => {
      sim.teleportPlayer(sim.district.evadePoint)
      renderer.resetCamera()
      return step(0)
    },
    reset: async () => {
      await reset()
      return readState()
    },
  })

  function frame(time: number): void {
    const dt = Math.max(0, Math.min((time - lastTime) / 1000, 0.1))
    lastTime = time
    if (!paused && !resetting) {
      accumulated += dt
      const input = currentInput()
      while (accumulated >= FIXED_DT) {
        sim.step(input)
        accumulated -= FIXED_DT
      }
      paint(dt)
    }
    requestAnimationFrame(frame)
  }

  paint(FIXED_DT)
  loading.hidden = true
  element('hud').hidden = false
  requestAnimationFrame(frame)
}

void start().catch((error: unknown) => {
  loading.textContent = 'Engine could not start. Check WebGL 2 support and reload.'
  console.error(error)
})

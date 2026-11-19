import './ui/styles.css'
import { DemoRenderer } from './render/demo'
import { DemoSimulation } from './sim/demo'
import { FIXED_DT } from './sim/physics'
import { bindDrivingKeys } from './ui/drivingKeys'
import { element } from './ui/hud'

const canvas = element<HTMLCanvasElement>('world')
const loading = element('loading')

async function startDemo(): Promise<void> {
  const sim = await DemoSimulation.create()
  const renderer = new DemoRenderer(canvas)
  const speed = element('demo-speed')
  const tilt = element('demo-tilt')
  const drift = element('demo-drift')
  let lastTime = performance.now()
  let accumulated = 0

  const keys = bindDrivingKeys(canvas, () => {
    sim.reset()
    renderer.resetCamera()
    accumulated = 0
  }, () => {
    accumulated = 0
    lastTime = performance.now()
  })

  function paint(dt: number): void {
    const snapshot = sim.snapshot()
    renderer.render(snapshot, dt)
    speed.textContent = String(Math.round(snapshot.speed * 3.6)).padStart(3, '0')
    tilt.textContent = `${(snapshot.tilt * 180 / Math.PI).toFixed(1)}°`
    const isDrifting = String(snapshot.drifting)
    if (drift.dataset.active !== isDrifting) {
      drift.dataset.active = isDrifting
      drift.textContent = snapshot.drifting ? 'DRIFTING' : 'GRIP'
    }
  }

  function frame(time: number): void {
    const dt = Math.max(0, Math.min((time - lastTime) / 1000, 0.1))
    lastTime = time
    accumulated += dt
    const input = keys.read()
    while (accumulated >= FIXED_DT) {
      sim.step(input)
      accumulated -= FIXED_DT
    }
    paint(dt)
    requestAnimationFrame(frame)
  }

  paint(FIXED_DT)
  element('demo-hud').hidden = false
  requestAnimationFrame(frame)
}

async function start(): Promise<void> {
  if (new URLSearchParams(location.search).get('mode') === 'district') {
    const { startDistrict } = await import('./districtApp')
    await startDistrict(canvas)
  } else {
    await startDemo()
  }
  loading.hidden = true
}

void start().catch((error: unknown) => {
  loading.textContent = 'Engine could not start. Check WebGL 2 support and reload.'
  console.error(error)
})

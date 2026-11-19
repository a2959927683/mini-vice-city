import type { DriveInput } from '../sim/drivers'

const driveCodes = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'KeyR',
])

export function bindDrivingKeys(canvas: HTMLCanvasElement, reset: () => void, onVisibility: () => void) {
  const keys = new Set<string>()
  const clear = () => keys.clear()

  window.addEventListener('keydown', (event) => {
    if (!driveCodes.has(event.code) || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.code === 'Space' && (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement)) return
    event.preventDefault()
    if (event.code === 'KeyR' && !event.repeat) reset()
    keys.add(event.code)
  })
  window.addEventListener('keyup', (event) => { keys.delete(event.code) })
  window.addEventListener('blur', clear)
  document.addEventListener('visibilitychange', () => {
    clear()
    onVisibility()
  })
  canvas.addEventListener('pointerdown', () => canvas.focus())

  return {
    clear,
    read(): DriveInput {
      const held = (code: string, arrow: string) => Number(keys.has(code) || keys.has(arrow))
      return {
        throttle: held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown'),
        steer: held('KeyA', 'ArrowLeft') - held('KeyD', 'ArrowRight'),
        handbrake: keys.has('Space'),
      }
    },
  }
}

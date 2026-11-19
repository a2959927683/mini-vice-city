import type { District } from '../sim/district'
import type { Snapshot } from '../sim/simulation'

const MODE_LABELS = {
  PATROL: 'CLEAR',
  PURSUIT: 'IN PURSUIT',
  SEARCH: 'SEARCHING',
  COOLDOWN: 'COOLDOWN',
} as const

export function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as T
}

export class Hud {
  private readonly panel = element('police-mode').closest<HTMLElement>('.wanted-panel')!
  private readonly status = element('police-mode')
  private readonly stars = element('wanted-stars')
  private readonly evade = element('evade')
  private readonly evadeFill = this.evade.querySelector('span')!
  private readonly speed = element('speed')
  private readonly speedFill = element('speed-track').querySelector('span')!
  private readonly radar = element<HTMLCanvasElement>('radar')
  private readonly paint = this.radar.getContext('2d')!
  private lastRadarTick = -10

  constructor(private readonly district: District, reset: () => void) {
    element('reset').addEventListener('click', reset)
  }

  update(state: Snapshot): void {
    const { wanted, frame, vehicles } = state
    const kmh = Math.round(vehicles[0].speed * 3.6)
    const speed = String(kmh).padStart(3, '0')
    if (this.speed.textContent !== speed) this.speed.textContent = speed
    this.speedFill.style.transform = `scaleX(${Math.min(kmh / 125, 1)})`

    if (this.panel.dataset.mode !== wanted.mode) {
      this.panel.dataset.mode = wanted.mode
      this.status.textContent = MODE_LABELS[wanted.mode]
    }
    const level = String(wanted.level)
    if (this.stars.dataset.level !== level) {
      this.stars.dataset.level = level
      this.stars.setAttribute('aria-label', `${level} of 5 wanted stars`)
      Array.from(this.stars.children).forEach((star, i) => star.classList.toggle('active', i < wanted.level))
    }
    const percent = Math.round(wanted.progress * 100)
    this.evade.setAttribute('aria-valuenow', String(percent))
    this.evadeFill.style.transform = `scaleX(${wanted.progress})`
    if (frame < this.lastRadarTick || frame >= this.lastRadarTick + 5) {
      this.lastRadarTick = frame
      this.drawRadar(state)
    }
  }

  private drawRadar(state: Snapshot): void {
    const ctx = this.paint
    const size = this.radar.width
    const half = size / 2
    const scale = size / 115
    const player = state.vehicles[0]
    const x = (world: number) => half - (world - player.position.x) * scale
    const y = (world: number) => half - (world - player.position.z) * scale
    const road = this.district.roadWidth * scale
    const end = this.district.halfExtent
    const reach = end * 2 * scale

    ctx.fillStyle = '#171824'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = '#202532'
    ctx.fillRect(x(end), y(end), reach, reach)
    ctx.fillStyle = '#434050'
    for (const axis of this.district.axes) {
      ctx.fillRect(x(axis) - road / 2, y(end), road, reach)
      ctx.fillRect(x(end), y(axis) - road / 2, reach, road)
    }
    ctx.fillStyle = '#323044'
    for (const building of this.district.buildings) {
      ctx.fillRect(x(building.x + building.width / 2), y(building.z + building.depth / 2),
        building.width * scale, building.depth * scale)
    }
    ctx.strokeStyle = '#877a9640'
    ctx.lineWidth = 1.5
    ctx.setLineDash([2, 6])
    ctx.beginPath()
    ctx.moveTo(half, 0)
    ctx.lineTo(half, size)
    ctx.moveTo(0, half)
    ctx.lineTo(size, half)
    ctx.stroke()

    if (state.wanted.center) {
      const { center, radius } = state.wanted
      ctx.beginPath()
      ctx.arc(x(center.x), y(center.z), radius * scale, 0, 2 * Math.PI)
      ctx.fillStyle = '#ff9d852b'
      ctx.fill()
      ctx.strokeStyle = '#ffab95cd'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 4])
      ctx.stroke()
    }
    ctx.setLineDash([])
    for (const vehicle of state.vehicles) {
      if (vehicle.kind !== 'police') continue
      const dx = x(vehicle.position.x) - half
      const dy = y(vehicle.position.z) - half
      const clamp = Math.max(1, Math.max(Math.abs(dx), Math.abs(dy)) / (half - 11))
      ctx.save()
      ctx.translate(half + dx / clamp, half + dy / clamp)
      ctx.rotate(Math.PI / 4)
      ctx.fillStyle = state.wanted.level ? '#ff9d85' : '#79efed'
      ctx.globalAlpha = clamp === 1 ? 1 : 0.52
      ctx.fillRect(-4, -4, 8, 8)
      ctx.restore()
    }
    const q = player.rotation
    const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y))
    ctx.save()
    ctx.translate(half, half)
    ctx.rotate(-heading)
    ctx.beginPath()
    ctx.moveTo(0, -13)
    ctx.lineTo(8, 9)
    ctx.lineTo(0, 5)
    ctx.lineTo(-8, 9)
    ctx.closePath()
    ctx.fillStyle = '#fff4ea'
    ctx.strokeStyle = '#3b283c'
    ctx.lineWidth = 2
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
}

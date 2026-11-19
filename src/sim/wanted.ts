export type PoliceMode = 'PATROL' | 'PURSUIT' | 'SEARCH' | 'COOLDOWN'

export const SEARCH_RADIUS = 31
export const SIGHT_RADIUS = 48
export const SEARCH_SECONDS = 4
export const COOLDOWN_SECONDS = 3

export class Wanted {
  level = 0
  mode: PoliceMode = 'PATROL'
  private elapsed = 0
  private sinceOffense = Infinity

  get progress(): number {
    if (this.mode === 'SEARCH') return 0.65 * this.elapsed / SEARCH_SECONDS
    if (this.mode === 'COOLDOWN') return 0.65 + 0.35 * this.elapsed / COOLDOWN_SECONDS
    return 0
  }

  offense(): void {
    if (this.sinceOffense >= 0.85) this.level = Math.min(this.level + 1, 5)
    this.sinceOffense = 0
    this.enter('PURSUIT')
  }

  step(dt: number, visible: boolean, outsideSearch: boolean): void {
    this.sinceOffense += dt
    if (this.level === 0) return
    if (visible || this.sinceOffense < 0.32) {
      this.enter('PURSUIT')
      return
    }
    if (this.mode === 'PURSUIT') this.enter('SEARCH')
    if (!outsideSearch) {
      this.enter('SEARCH')
      this.elapsed = 0
      return
    }
    this.elapsed += dt
    if (this.mode === 'SEARCH' && this.elapsed >= SEARCH_SECONDS) {
      this.enter('COOLDOWN')
    } else if (this.mode === 'COOLDOWN' && this.elapsed >= COOLDOWN_SECONDS) {
      this.level = 0
      this.enter('PATROL')
    }
  }

  private enter(mode: PoliceMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.elapsed = 0
  }
}

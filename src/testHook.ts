import type { Snapshot } from './sim/simulation'

export interface GameTestState extends Snapshot {
  renderFrame: number
}

export interface GameTestHook {
  readState(): GameTestState
  pause(): void
  resume(): void
  step(frames?: number): GameTestState
  triggerPoliceCollision(): GameTestState
  teleportOutOfLOS(): GameTestState
  reset(): Promise<GameTestState>
}

declare global {
  interface Window {
    __GAME_TEST__?: GameTestHook
  }
}

export function installTestHook(hook: GameTestHook): void {
  window.__GAME_TEST__ = hook
}

import RAPIER from '@dimforge/rapier3d-compat'

export const FIXED_DT = 1 / 60
let ready: Promise<void> | undefined

export function initializeRapier(): Promise<void> {
  return (ready ??= RAPIER.init())
}

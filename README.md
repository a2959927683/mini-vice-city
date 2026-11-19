# Mini Vice City

A browser arcade driving sandbox set in a procedural 4×4 sunset district. Cruise with traffic, drift through intersections, and use buildings and side streets to shake the two patrolling police cars.

## Play locally

Use Node.js 24, npm, and a browser with WebGL 2.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite.

| Control | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ | Brake, then reverse |
| A or D / ← or → | Steer |
| Space | Handbrake drift |
| R | Recover the car. A flipped car rights itself on the spot. |
| Reset button | Restart the district, traffic, props, and Wanted state |

Hitting a police car, ramming traffic, or breaking street props can raise your Wanted level. Break police line of sight, leave the search circle shown on the radar, and stay clear for the search and cooldown countdowns.

## Architecture

- `src/sim/` owns the fixed 60 Hz Rapier3D world, car dynamics, directed lanes, spatial queries, traffic, pedestrians, and the Wanted and police state machines. It runs headlessly in Node.
- `src/render/` takes simulation snapshots and renders the procedural Three.js district, vehicles, props, police lights, and spring-damped chase camera.
- `src/ui/` renders the speedometer, radar, and Wanted HUD. `src/testHook.ts` exposes `window.__GAME_TEST__` for deterministic stepping, real scripted contacts, and evasion checks.

## Verify

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest checks road settling after 300 ticks, headless tick cost, driving response, and the Wanted state machine. Playwright checks browser errors, rendered WebGL pixels, and a scripted police chase through evasion. GitHub Actions runs both suites and the production build. Browser assertions work with software WebGL.

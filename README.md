# Mini Vice City

A browser arcade driving sandbox with a procedural sunset driving range and a separate 4×4 city district. The range lets you try the four-ray suspension and handbrake without traffic.

## Play locally

Use Node.js 24, npm, and a browser with WebGL 2.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Choose **Explore district** to switch to the city sandbox with traffic, pedestrians and police pursuits.

| Control | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ | Brake, then reverse |
| A or D / ← or → | Steer |
| Space | Handbrake drift |
| R | Reset the range car or recover the district car |
| Reset button in the district | Restart traffic, props, and Wanted state |

## Architecture and verification

- `src/sim/` owns the headless 60 Hz Rapier3D world, four-ray vehicle physics, and district behavior. `packages/contracts/` contains the immutable road-graph contract and its frozen fixture.
- `src/render/` renders simulation snapshots with Three.js. The game loop and HUD handle keyboard input, speed, drift, and live chassis tilt.
- [PLAYBOOK.md](PLAYBOOK.md) records fixture ownership, schema changes, and the replay quarantine process.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest validates the road graph and checks the headless vehicle's quaternion tilt, wheel contact recovery, velocity, and tick duration across a 300-tick slalom. Playwright verifies keyboard driving and the district's police-chase flow. GitHub Actions checks pull requests and pushes to `main`. The Pages workflow builds and publishes `dist/` on pushes to `main`.

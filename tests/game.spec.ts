import { expect, test } from '@playwright/test'

test('renders the district and clears wanted stars after a police collision', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  const view = page.locator('#world')
  const stars = page.locator('#wanted-stars')
  const status = page.locator('#police-mode')
  const evade = page.getByRole('progressbar', { name: 'Evade progress' })

  await test.step('start the game and read rendered WebGL pixels', async () => {
    await page.goto('/')
    await expect(view).toBeVisible()
    await expect(page.locator('#loading')).toBeHidden()
    await expect(stars).toHaveAttribute('data-level', '0')

    const rendered = await view.evaluate((element: HTMLCanvasElement) => {
      const hook = window.__GAME_TEST__!
      const gl = element.getContext('webgl2')
      if (!gl) throw new Error('The renderer did not initialize WebGL 2')

      const before = hook.readState()
      const after = hook.step(1)
      const sample = new Uint8Array(4)
      const colors = new Set<string>()
      // Read in the render task before the browser clears the drawing buffer.
      for (let y = 1; y <= 6; y++) {
        for (let x = 1; x <= 8; x++) {
          gl.readPixels(
            Math.floor(gl.drawingBufferWidth * x / 9),
            Math.floor(gl.drawingBufferHeight * y / 7),
            1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sample,
          )
          if (sample[3] > 0) colors.add(sample.join(','))
        }
      }
      return {
        tickAdvance: after.frame - before.frame,
        renderAdvance: after.renderFrame - before.renderFrame,
        colors: colors.size,
        error: gl.getError(),
      }
    })
    expect(rendered).toMatchObject({ tickAdvance: 1, renderAdvance: 1, error: 0 })
    expect(rendered.colors).toBeGreaterThan(8)
  })

  await test.step('trigger a police collision and show wanted stars', async () => {
    const wanted = await page.evaluate(() => window.__GAME_TEST__!.triggerPoliceCollision().wanted)
    expect(wanted.mode).toBe('PURSUIT')
    expect(wanted.level).toBeGreaterThanOrEqual(1)
    await expect(status).toHaveText('IN PURSUIT')
    await expect(stars).toHaveAttribute('aria-label', `${wanted.level} of 5 wanted stars`)
    await expect(stars.locator('.active')).toHaveCount(wanted.level)
  })

  await test.step('break sight, leave the search radius and evade the patrol', async () => {
    const distanceOutsideRadius = await page.evaluate(() => {
      const { vehicles: [player], wanted } = window.__GAME_TEST__!.teleportOutOfLOS()
      if (!wanted.center) throw new Error('The police did not record a last known position')
      return Math.hypot(player.position.x - wanted.center.x, player.position.z - wanted.center.z)
        - wanted.radius
    })
    expect(distanceOutsideRadius).toBeGreaterThan(0)

    const search = await page.evaluate(() => window.__GAME_TEST__!.step(50).wanted)
    expect(search.mode).toBe('SEARCH')
    expect(search.progress).toBeGreaterThan(0)
    await expect(status).toHaveText('SEARCHING')
    await expect(evade).toHaveAttribute('aria-valuenow', /^[1-9]\d*$/)

    const cooldown = await page.evaluate(() => window.__GAME_TEST__!.step(240).wanted)
    expect(cooldown.mode).toBe('COOLDOWN')
    expect(cooldown.level).toBeGreaterThanOrEqual(1)
    await expect(status).toHaveText('COOLDOWN')

    const clear = await page.evaluate(() => window.__GAME_TEST__!.step(190).wanted)
    expect(clear).toMatchObject({ mode: 'PATROL', level: 0, progress: 0 })
    await expect(status).toHaveText('CLEAR')
    await expect(stars).toHaveAttribute('data-level', '0')
    await expect(stars.locator('.active')).toHaveCount(0)
    await expect(evade).toHaveAttribute('aria-valuenow', '0')
  })

  await test.step('reset an active pursuit with the HUD button', async () => {
    await page.evaluate(() => window.__GAME_TEST__!.triggerPoliceCollision())
    await expect(status).toHaveText('IN PURSUIT')
    await page.getByRole('button', { name: 'Reset' }).click()
    await expect(status).toHaveText('CLEAR')
    await expect(stars).toHaveAttribute('data-level', '0')
    expect(await page.evaluate(() => window.__GAME_TEST__!.readState().frame)).toBe(0)
  })

  expect(errors).toEqual([])
})

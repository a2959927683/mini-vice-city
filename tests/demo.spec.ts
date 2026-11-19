import { expect, test } from '@playwright/test'

test('drives, drifts and resets in the default WebGL driving range', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')
  await expect(page.locator('#demo-hud')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#demo-tilt')).toHaveText(/^\d+\.\d°$/)
  const webglReady = await page.locator('#world').evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2')
    return gl !== null && gl.drawingBufferWidth > 0 && gl.drawingBufferHeight > 0
  })
  expect(webglReady).toBe(true)

  const speed = page.locator('#demo-speed')
  const drift = page.locator('#demo-drift')
  await page.keyboard.down('w')
  await expect.poll(async () => Number(await speed.textContent()), { timeout: 12_000 }).toBeGreaterThan(16)
  await page.keyboard.down('a')
  await page.keyboard.down('Space')
  await expect(drift).toHaveText('DRIFTING')
  await page.keyboard.up('Space')
  await page.keyboard.up('a')
  await page.keyboard.up('w')

  await page.keyboard.press('r')
  await expect(speed).toHaveText('000')
  await expect(drift).toHaveText('GRIP')
  expect(errors).toEqual([])
})

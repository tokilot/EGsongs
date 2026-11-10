// Live regression check, isolated from the user's library and song cache.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { createApp } from '../server/src/app.ts'

const temp = mkdtempSync(path.join(tmpdir(), 'tabs-online-'))
const makeApp = (mode: string) => {
  const dataDir = path.join(temp, mode)
  mkdirSync(dataDir)
  return createApp({ dataDir, soundFontDir: path.resolve('data/soundfonts') })
}
let active = makeApp('link')
const backend = serve({ fetch: (request) => active.app.fetch(request), port: 5186, hostname: '127.0.0.1' })
const vite = await createServer({
  root: path.resolve('web'), configFile: path.resolve('web/vite.config.ts'),
  server: { port: 5185, strictPort: true, host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:5186' } },
})
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  await vite.listen()
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  for (const mode of ['link', 'name']) {
    if (mode === 'name') { active.library.close(); active = makeApp(mode) }
    const context = await browser.newContext({ locale: 'zh-CN' })
    const page = await context.newPage()
    page.on('response', (r) => {
      if (r.url().includes('/api/songsterr/')) console.log(mode, r.status(), r.url())
    })
    await page.goto('http://127.0.0.1:5185', { waitUntil: 'domcontentloaded' })
    await page.locator('header').getByRole('button', { name: '搜索曲谱', exact: true }).click()
    await page.locator('#song-search').fill(mode === 'link'
      ? 'https://www.songsterr.com/a/wsa/katsuo-ono-detective-conan-theme-guitar-tab-s680113'
      : 'Detective Conan Theme')
    if (mode === 'link') await page.getByRole('button', { name: /导入这个链接/ }).click()
    else await page.getByRole('button').filter({ hasText: 'Detective Conan Theme 名探偵コナン GUITAR' }).click({ timeout: 30000 })
    await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-status') === 'ready', undefined, { timeout: 60000 })
    await page.locator('main svg').first().waitFor({ state: 'visible', timeout: 30000 })
    const info = await page.evaluate(() => ({
      title: document.querySelector('header')?.innerText,
      svg: document.querySelectorAll('main svg').length,
    }))
    assert(info.svg > 0)
    assert.match(info.title ?? '', /Detective Conan/)
    await page.locator('footer button[aria-label="播放"]:not([disabled])').waitFor({ timeout: 60000 })
    console.log(JSON.stringify({ mode, ...info, status: 'rendered and ready to play' }))
    await context.close()
  }
} finally {
  await browser?.close()
  await vite.close()
  await new Promise<void>((resolve) => backend.close(() => resolve()))
  active.library.close()
  assert.equal(path.dirname(temp), path.resolve(tmpdir()))
  assert(path.basename(temp).startsWith('tabs-online-'))
  rmSync(temp, { recursive: true, force: true, maxRetries: 5 })
}

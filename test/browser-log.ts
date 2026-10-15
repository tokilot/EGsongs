// Loads a page in headless Edge and prints what the browser console and network report. Diagnostic helper.
//   node test/browser-log.ts http://localhost:5173/ [waitMs]
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:5173/'
const waitMs = Number(process.argv[3] ?? 6000)

const browser = await chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } })
page.on('console', (message) => console.log(`[console.${message.type()}] ${message.text().slice(0, 400)}`))
page.on('pageerror', (error) => console.log(`[pageerror] ${error.message.slice(0, 600)}`))
page.on('requestfailed', (request) => console.log(`[requestfailed] ${request.url()} ${request.failure()?.errorText}`))
page.on('response', (response) => {
  if (response.status() >= 400) console.log(`[http ${response.status()}] ${response.url()}`)
})
await page.goto(url)
await page.waitForTimeout(waitMs)
console.log('regions:', await page.evaluate(() => ['header', 'main', 'footer'].map((tag) => `${tag}=${!!document.querySelector(tag)}`).join(' ')))
console.log('root html length:', await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? -1))
await browser.close()

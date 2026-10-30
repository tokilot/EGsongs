// Renders every track of the 10 test songs (CLAUDE.md, "测试案例") in a real browser and reports anything that
// fails to draw or logs an error. Uses the pinned revisions from the local Songsterr cache, so it makes no
// Songsterr requests; run `npm run fixtures` first.
//
//   npm run e2e:songs            all songs, all tracks
//   npm run e2e:songs -- 2 7     only songs #2 and #7
//   npm run e2e:songs -- --shots also write a screenshot of each default track to test/shots/
import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { FIXTURES } from '../web/src/fixtures.ts'

const root = path.resolve(import.meta.dirname, '..')
const API_PORT = 5186
const WEB_PORT = 5185
const BASE = `http://localhost:${WEB_PORT}`
const args = process.argv.slice(2)
const shots = args.includes('--shots')
const only = new Set(args.filter((arg) => /^\d+$/.test(arg)).map(Number))
const shotDir = path.join(root, 'test', 'shots')

const cache = path.join(root, 'data/songs')
if (!FIXTURES.every((fixture) => existsSync(path.join(cache, String(fixture.songId), String(fixture.revisionId), 'meta.json')))) {
  console.error('Songsterr fixtures are missing; run `npm run fixtures` first.')
  process.exit(1)
}
const dataDir = mkdtempSync(path.join(tmpdir(), 'tabs-songs-'))
cpSync(cache, path.join(dataDir, 'songs'), { recursive: true })

const children: ChildProcess[] = []
function start(command: string, commandArgs: string[], cwd: string, env: Record<string, string>) {
  children.push(spawn(command, commandArgs, { cwd, env: { ...process.env, ...env }, stdio: 'ignore', shell: process.platform === 'win32' }))
}

async function waitFor(url: string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`${url} did not come up`)
}

interface Summary {
  title: string
  tracks: number
  bars: number
  systems: number
  milliseconds: number
}

const problems: string[] = []

async function main() {
  start('node', ['src/index.ts'], path.join(root, 'server'), { TABS_PORT: String(API_PORT), TABS_DATA_DIR: dataDir })
  start('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], path.join(root, 'web'), { TABS_PORT: String(API_PORT) })
  await waitFor(`http://127.0.0.1:${API_PORT}/api/songs`)
  await waitFor(BASE)

  const browser = await chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } })
  page.setDefaultTimeout(20_000)
  let current = ''
  page.on('pageerror', (error) => problems.push(`${current}: ${error.message.split('\n')[0]}`))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('Songsterr converter')) problems.push(`${current}: ${message.text().slice(0, 200)}`)
  })

  for (const fixture of FIXTURES) {
    if (only.size > 0 && !only.has(fixture.no)) continue
    current = `#${fixture.no}`
    const response = await fetch(`http://127.0.0.1:${API_PORT}/api/songsterr/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: String(fixture.songId), revisionId: fixture.revisionId }),
    })
    const song = (await response.json()) as { id: number; title: string; trackCount: number; defaultTrack: number; error?: string }
    if (!response.ok) {
      problems.push(`${current}: import failed: ${song.error}`)
      continue
    }

    const started = Date.now()
    await page.goto(`${BASE}/#/song/${song.id}`)
    try {
      // Switching songs does not reload the page, so "ready" alone could still describe the previous song.
      await page.waitForFunction(
        (title) => {
          const player = (window as unknown as { __tabsPlayer?: { getSnapshot(): { status: string; title: string; canPlay: boolean } } }).__tabsPlayer
          const state = player?.getSnapshot()
          return !!state && state.status === 'ready' && state.canPlay && state.title === title
        },
        song.title,
        { timeout: 60_000 },
      )
    } catch {
      problems.push(`${current}: the default track did not finish rendering`)
      continue
    }
    const milliseconds = Date.now() - started

    // alphaTab reports the render as finished slightly before the drawn chunks are in the page (they are
    // inserted lazily as they come into view), so give the first one a moment to appear.
    const read = async () => {
      await page.waitForFunction(() => document.querySelectorAll('main svg').length > 0, undefined, { timeout: 8000 }).catch(() => undefined)
      return page.evaluate(() => {
        const player = (window as unknown as { __tabsPlayer: { getSnapshot(): { tracks: unknown[]; barCount: number; trackIndex: number; status: string } } }).__tabsPlayer
        const state = player.getSnapshot()
        const main = document.querySelector('main')!
        return {
          tracks: state.tracks.length,
          bars: state.barCount,
          trackIndex: state.trackIndex,
          status: state.status,
          // One <svg> per rendered chunk; a blank score has none.
          systems: main.querySelectorAll('svg').length,
          overflow: main.scrollWidth > main.clientWidth + 2,
        }
      })
    }

    const first = await read()
    if (first.tracks !== fixture.tracks) problems.push(`${current}: ${first.tracks} tracks, expected ${fixture.tracks}`)
    if (first.bars !== fixture.bars) problems.push(`${current}: ${first.bars} bars, expected ${fixture.bars}`)
    if (first.trackIndex !== fixture.defaultTrack) problems.push(`${current}: opened on track ${first.trackIndex}, expected ${fixture.defaultTrack}`)
    if (first.systems === 0) problems.push(`${current}: the default track drew nothing`)
    if (first.overflow) problems.push(`${current}: the score is wider than the score area`)
    if (shots) {
      mkdirSync(shotDir, { recursive: true })
      await page.screenshot({ path: path.join(shotDir, `song-${String(fixture.no).padStart(2, '0')}.png`) })
    }

    // Every other track in turn. The controller renders it and reports "ready" again through the same status.
    for (let index = 0; index < first.tracks; index++) {
      if (index === fixture.defaultTrack) continue
      current = `#${fixture.no} track ${index}`
      const before = problems.length
      await page.evaluate((trackIndex) => {
        const main = document.querySelector('main')!
        main.scrollTo(0, 0)
        main.querySelectorAll('svg').forEach((svg) => svg.setAttribute('data-stale', ''))
        main.setAttribute('data-rendered', 'pending')
        const player = (window as unknown as { __tabsPlayer: { selectTrack(index: number): void; api: { renderFinished: { on(handler: () => void): void } } } }).__tabsPlayer
        player.api.renderFinished.on(() => main.setAttribute('data-rendered', 'done'))
        player.selectTrack(trackIndex)
      }, index)
      try {
        await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-rendered') === 'done', undefined, { timeout: 30_000 })
      } catch {
        problems.push(`${current}: did not finish rendering`)
        continue
      }
      const state = await read()
      if (state.trackIndex !== index) problems.push(`${current}: the player is on track ${state.trackIndex}`)
      if (state.systems === 0) problems.push(`${current}: drew nothing`)
      if (state.overflow) problems.push(`${current}: wider than the score area`)
      if (problems.length > before) console.log(`  FAIL ${current}`)
    }

    current = `#${fixture.no}`
    const summary: Summary = { title: song.title, tracks: first.tracks, bars: first.bars, systems: first.systems, milliseconds }
    const failed = problems.some((problem) => problem.startsWith(`#${fixture.no}:`) || problem.startsWith(`#${fixture.no} `))
    console.log(`  ${failed ? 'FAIL' : 'ok  '} #${fixture.no} ${summary.title}: ${summary.tracks} tracks, ${summary.bars} bars, first render ${summary.milliseconds} ms`)
  }
  await browser.close()
}

try {
  await main()
} catch (error) {
  problems.push(`run aborted: ${(error as Error).message}`)
} finally {
  for (const child of children) {
    if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill()
  }
  await new Promise((resolve) => setTimeout(resolve, 800))
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 })
}

if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`)
  for (const problem of problems) console.log(`  - ${problem}`)
  process.exit(1)
}
console.log('\nall songs rendered cleanly')

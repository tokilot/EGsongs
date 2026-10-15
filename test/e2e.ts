// End-to-end check in a real browser (the installed Microsoft Edge, headless).
// Starts its own backend and dev server on spare ports with a throwaway data directory, so the real library in
// data/ is never touched. The Songsterr cache for the test songs is copied in to avoid re-downloading them.
//
//   npm run e2e            run all checks
//   npm run e2e -- --shots also write screenshots to test/shots/
import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, type Page } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const API_PORT = 5184
const WEB_PORT = 5183
const BASE = `http://localhost:${WEB_PORT}`
const SONG_LINK = 'https://www.songsterr.com/a/wsa/akira-yamaoka-promise-tab-s34008'
const shots = process.argv.includes('--shots')
const shotDir = path.join(root, 'test', 'shots')

const dataDir = mkdtempSync(path.join(tmpdir(), 'tabs-e2e-'))
if (existsSync(path.join(root, 'data/songsterr'))) {
  cpSync(path.join(root, 'data/songsterr'), path.join(dataDir, 'songsterr'), { recursive: true })
}

const children: ChildProcess[] = []
function start(command: string, args: string[], cwd: string, env: Record<string, string>) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'ignore', shell: process.platform === 'win32' })
  children.push(child)
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

let passed = 0
const failures: string[] = []
async function check(name: string, run: () => Promise<void>) {
  try {
    await run()
    passed++
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push(name)
    // Point at the line of this script that failed.
    const where = (error as Error).stack?.split('\n').find((line) => line.includes('e2e.ts:'))?.match(/e2e\.ts:(\d+)/)?.[1]
    console.log(`  FAIL ${name}\n       ${(error as Error).message.split('\n')[0]}${where ? `  (test/e2e.ts:${where})` : ''}`)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function shot(page: Page, name: string) {
  if (!shots) return
  mkdirSync(shotDir, { recursive: true })
  await page.screenshot({ path: path.join(shotDir, `${name}.png`) })
}

const control = (page: Page, label: string) => page.locator('footer').getByRole('button', { name: label, exact: true })
const pressed = async (page: Page, label: string) => (await control(page, label).getAttribute('aria-pressed')) === 'true'
/** Waits until the track with this name is the one shown. */
const shownTrack = (page: Page, name: string) =>
  page.waitForFunction((wanted) => {
    const player = (window as unknown as { __tabsPlayer?: { getSnapshot(): { trackIndex: number; tracks: Array<{ index: number; name: string }> } } }).__tabsPlayer
    const state = player?.getSnapshot()
    return state?.tracks.find((track) => track.index === state.trackIndex)?.name.trim() === wanted
  }, name)
const scoreStatus = (page: Page) => page.locator('main').getAttribute('data-status')

async function waitReady(page: Page) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-status') === 'ready', undefined, { timeout: 60_000 })
  // The play button enables once the sound font is in.
  await page.locator('footer button[aria-label="播放"]:not([disabled])').waitFor({ timeout: 60_000 })
}

/** Playback position in MIDI ticks, read from the controller that development builds expose. */
async function tick(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __tabsPlayer: { tickPosition: number } }).__tabsPlayer.tickPosition)
}

/** Horizontal/vertical position of the playback cursor inside the score. */
async function cursorPosition(page: Page): Promise<string> {
  return page.evaluate(() => {
    const cursor = document.querySelector('.at-cursor-beat') as HTMLElement | null
    if (!cursor) return 'none'
    const box = cursor.getBoundingClientRect()
    const main = document.querySelector('main')!
    return `${Math.round(box.left)},${Math.round(box.top + main.scrollTop)}`
  })
}

async function main() {
  start('node', ['src/index.ts'], path.join(root, 'server'), { TABS_PORT: String(API_PORT), TABS_DATA_DIR: dataDir })
  start('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], path.join(root, 'web'), { TABS_PORT: String(API_PORT) })
  await waitFor(`http://127.0.0.1:${API_PORT}/api/songs`)
  await waitFor(BASE)

  const browser = await chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true, locale: 'zh-CN' })
  const page = await context.newPage()
  page.setDefaultTimeout(12_000)
  const pageErrors: string[] = []
  // With where it happened, so a failure can be traced from this log alone.
  page.on('pageerror', (error) => {
    const where = (error.stack ?? '').split('\n').slice(1, 4).map((line) => line.trim().replace(/https?:\/\/localhost:\d+/, '')).join(' < ')
    pageErrors.push(`${error.message} @ ${where}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text())
  })
  page.on('dialog', (dialog) => void dialog.accept())

  console.log('layout')
  await page.goto(BASE)
  await check('home shows an empty library', async () => {
    await page.getByText('曲库是空的').waitFor()
    await shot(page, '01-home')
  })
  await check('the page has three regions and does not scroll', async () => {
    const info = await page.evaluate(() => ({
      header: !!document.querySelector('header'),
      main: !!document.querySelector('main'),
      footer: !!document.querySelector('footer'),
      scrolls: document.documentElement.scrollHeight > window.innerHeight,
    }))
    assert(info.header && info.main && info.footer, 'missing a region')
    assert(!info.scrolls, 'the page itself scrolls')
  })
  await check('control bar has 13 buttons plus the source switch, on one row', async () => {
    const rows = await page.evaluate(() => {
      const footer = document.querySelector('footer')!
      const buttons = [...footer.querySelectorAll(':scope > button, :scope > div > button:not([role="radio"])')]
      const radios = footer.querySelectorAll('[role="radio"]').length
      const centers = buttons.map((button) => {
        const box = button.getBoundingClientRect()
        return Math.round(box.top + box.height / 2)
      })
      return { count: buttons.length, radios, spread: Math.max(...centers) - Math.min(...centers) }
    })
    assert(rows.count === 13, `expected 13 buttons, found ${rows.count}`)
    assert(rows.radios === 2, 'source switch missing')
    assert(rows.spread <= 2, `buttons are not on one row (spread ${rows.spread}px)`)
    assert(await page.getByRole('radio', { name: '原声' }).isDisabled(), '原声 should be disabled')
    assert((await page.getByRole('radio', { name: '合成' }).getAttribute('aria-checked')) === 'true', '合成 should be selected')
  })

  console.log('import and render')
  await check('importing a Songsterr link opens the song', async () => {
    await page.getByRole('button', { name: '新建' }).click()
    await page.getByLabel('Songsterr 链接').fill(SONG_LINK)
    await page.getByRole('button', { name: '导入', exact: true }).click()
    await waitReady(page)
    assert(/#\/song\/\d+$/.test(page.url()), `unexpected url ${page.url()}`)
  })
  await check('top bar: home, song, star, my tabs, new, search, help, each with its icon above the label', async () => {
    const header = page.locator('header')
    await header.getByText('Promise', { exact: true }).waitFor()
    await header.getByText('Akira Yamaoka').waitFor()
    await shownTrack(page, 'Rhythm Guitar')
    assert(await header.getByRole('link', { name: '在 Songsterr 上打开' }).isVisible(), 'source link missing')
    const layout = await page.evaluate(() => {
      const header = document.querySelector('header')!
      const items = [...header.querySelectorAll('a[href="#/"], button, [class*="songTitle"]')].map((element) => {
        const box = element.getBoundingClientRect()
        const icon = element.querySelector('svg')?.getBoundingClientRect()
        const label = element.querySelector('span')?.getBoundingClientRect()
        const name = element.className.includes('songTitle') ? 'song' : (element.textContent ?? '').trim() || (element.getAttribute('aria-label') ?? '')
        // Icon above label: the icon ends before the label starts.
        return { name, left: box.left, stacked: !icon || !label || element.className.includes('songTitle') || icon.bottom <= label.top + 1 }
      })
      return { order: items.sort((a, b) => a.left - b.left).map((item) => item.name), stacked: items.every((item) => item.stacked) }
    })
    assert(layout.order.join(' | ') === 'Tabs | song | 收藏 | 编辑曲谱 | 我的曲谱 | 新建 | 搜索曲谱 | 帮助', `order is ${layout.order.join(' | ')}`)
    assert(layout.stacked, 'a top bar button does not have its icon above its label')
    const placement = await page.evaluate(() => {
      const header = document.querySelector('header')!.getBoundingClientRect()
      const nav = document.querySelector('header nav')!.getBoundingClientRect()
      const star = document.querySelector('header button[aria-pressed]')!
      return { navRightGap: header.right - nav.right, navLeft: nav.left - header.left, width: header.width, starText: (star.textContent ?? '').trim() }
    })
    assert(placement.navRightGap < 24 && placement.navLeft > placement.width / 2, `my tabs … help are not at the right end (${JSON.stringify(placement)})`)
    assert(placement.starText === '', 'the star button still has a label')
    assert((await header.getByRole('button', { name: /Guitar|乐器/ }).count()) === 0, 'the instrument button is still in the top bar')
  })
  await check('a switched-on control keeps its colour under the mouse; icons are 24px', async () => {
    const loop = control(page, '循环')
    const colour = () => loop.evaluate((element) => getComputedStyle(element).backgroundColor)
    const off = await colour()
    await loop.click()
    await page.mouse.move(5, 300)
    const on = await colour()
    await loop.hover()
    const hovered = await colour()
    await loop.click()
    await page.mouse.move(5, 300)
    assert(on !== off, 'switching on did not change the colour')
    assert(hovered === on, `the colour changes on hover (${on} -> ${hovered})`)
    assert((await loop.locator('svg').evaluate((icon) => icon.getBoundingClientRect().width)) === 24, 'control icons are not 24px')
  })
  await check('zoom 100% is the size that used to be 120%', async () => {
    const scale = await page.evaluate(() => {
      const player = (window as unknown as { __tabsPlayer: { api: { settings: { display: { scale: number } } }; getSnapshot(): { zoom: number } } }).__tabsPlayer
      return { scale: player.api.settings.display.scale, zoom: player.getSnapshot().zoom }
    })
    assert(scale.zoom === 1 && Math.abs(scale.scale - 1.2) < 1e-6, `zoom ${scale.zoom} gives scale ${scale.scale}`)
  })
  await check('the score is drawn as tablature and wraps into several systems', async () => {
    const info = await page.evaluate(() => {
      const main = document.querySelector('main')!
      return {
        svgs: main.querySelectorAll('svg').length,
        text: main.textContent ?? '',
        scrollable: main.scrollHeight > main.clientHeight + 200,
        horizontal: main.scrollWidth > main.clientWidth + 2,
      }
    })
    assert(info.svgs > 0, 'nothing rendered')
    assert(info.scrollable, 'the score does not extend below the fold')
    assert(!info.horizontal, 'the score overflows horizontally')
    assert(info.text.includes('Intro'), 'section marker "Intro" not found')
    await shot(page, '02-score')
  })
  await check('the score fills the width, starts with string names and has no TAB clef', async () => {
    const info = await page.evaluate(() => {
      const main = document.querySelector('main')!
      const svgs = [...main.querySelectorAll('svg')]
      const texts = svgs.flatMap((svg) => [...svg.querySelectorAll('text')].map((text) => text.textContent ?? ''))
      return {
        main: main.clientWidth,
        widest: Math.max(...svgs.map((svg) => svg.getBoundingClientRect().width)),
        // SMuFL code points of the 4- and 6-string TAB clefs.
        clefs: texts.filter((text) => text.includes('\uE06D') || text.includes('\uE06E')).length,
        names: texts.filter((text) => ['E', 'B', 'G', 'D', 'A'].includes(text.trim())).length,
        trackName: texts.some((text) => text.includes('Rhythm Gui')),
        tuningHeader: texts.some((text) => text.includes('Standard Tuning')),
      }
    })
    assert(info.widest > info.main * 0.85, `the score is only ${Math.round(info.widest)} of ${info.main}px wide`)
    assert(info.clefs === 0, `${info.clefs} TAB clefs drawn`)
    assert(info.names >= 6, `expected the six string names, found ${info.names}`)
    assert(!info.trackName && !info.tuningHeader, 'track name or tuning header still drawn')
  })
  await check('theme follows the system and can be forced to day or night', async () => {
    const look = async () => {
      await page.waitForTimeout(1200)
      return page.evaluate(() => {
        const main = document.querySelector('main')!
        // Computed colours: alphaTab writes #rrggbb, rgba(...) or nothing at all for black.
        const glyphs = [...main.querySelectorAll('svg path, svg text, svg rect')]
          .slice(0, 600)
          .map((element) => getComputedStyle(element).fill)
          .filter((fill) => fill.startsWith('rgb'))
        const rgb = (value: string) => (value.match(/\d+/g) ?? []).slice(0, 3).map(Number)
        const brightness = (value: string) => rgb(value).reduce((sum, part) => sum + part, 0) / 3
        return {
          theme: document.documentElement.dataset.theme,
          page: brightness(getComputedStyle(main).backgroundColor),
          bar: brightness(getComputedStyle(document.querySelector('header')!).backgroundColor),
          // Notation colours in use; the tests look at the brightest and darkest.
          glyphs: [...new Set(glyphs)].map(brightness),
        }
      })
    }
    const isNight = (state: Awaited<ReturnType<typeof look>>) =>
      state.theme === 'dark' && state.page < 60 && state.bar < 80 && Math.max(...state.glyphs) > 180
    const isDay = (state: Awaited<ReturnType<typeof look>>) =>
      state.theme === 'light' && state.page > 220 && state.bar > 220 && Math.min(...state.glyphs) < 40 && Math.max(...state.glyphs) < 215

    assert(isDay(await look()), `should start in the day theme with a light system: ${JSON.stringify(await look())}`)
    await page.emulateMedia({ colorScheme: 'dark' })
    assert(isNight(await look()), `did not follow the system to night: ${JSON.stringify(await look())}`)
    await shot(page, '02b-night')

    await control(page, '设置').click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('radio', { name: '白天' }).click()
    assert(isDay(await look()), 'forcing the day theme did not work while the system is dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await dialog.getByRole('radio', { name: '夜间' }).click()
    assert(isNight(await look()), 'forcing the night theme did not work while the system is light')
    await page.reload()
    await waitReady(page)
    assert(isNight(await look()), 'the chosen theme did not survive a reload')

    await control(page, '设置').click()
    await page.getByRole('dialog', { name: '设置' }).getByRole('radio', { name: '跟随系统' }).click()
    assert(isDay(await look()), 'going back to "follow the system" did not return to day')
    await page.keyboard.press('Escape')
  })
  await check('nothing the converter did not understand', async () => {
    assert(!pageErrors.some((message) => message.includes('Songsterr converter')), 'converter warnings were logged')
  })

  console.log('playback and controls')
  await check('play moves the cursor, pause stops it', async () => {
    const before = await cursorPosition(page)
    await page.locator('footer button[aria-label="播放"]').click()
    await page.locator('footer button[aria-label="暂停"]').waitFor({ timeout: 15_000 })
    await page.waitForTimeout(2500)
    const during = await cursorPosition(page)
    assert(during !== 'none' && during !== before, `cursor did not move (${before} -> ${during})`)
    await shot(page, '03-playing')
    await page.locator('footer button[aria-label="暂停"]').click()
    await page.locator('footer button[aria-label="播放"]').waitFor()
    await page.waitForTimeout(800)
    const paused = await tick(page)
    await page.waitForTimeout(900)
    assert((await tick(page)) === paused, 'playback position kept moving after pause')
  })
  await check('Space toggles playback, Home returns to the start', async () => {
    await page.locator('main').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Space')
    await page.locator('footer button[aria-label="暂停"]').waitFor({ timeout: 15_000 })
    await page.keyboard.press('Space')
    await page.locator('footer button[aria-label="播放"]').waitFor()
    await page.keyboard.press('Home')
    await page.waitForTimeout(400)
  })
  await check('arrow keys step by bars', async () => {
    const start = await cursorPosition(page)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(400)
    const one = await cursorPosition(page)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(400)
    const two = await cursorPosition(page)
    assert(one !== start && two !== one, `cursor did not advance (${start} -> ${one} -> ${two})`)
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(400)
    assert((await cursorPosition(page)) === one, 'ArrowLeft did not go back one bar')
  })
  await check('speed popover and +/- keys change the speed', async () => {
    await control(page, '速度').click()
    await page.getByRole('dialog', { name: '速度' }).getByRole('button', { name: '50%' }).click()
    assert((await control(page, '速度').textContent())?.includes('50%'), 'speed label did not change')
    await page.keyboard.press('Escape')
    await page.locator('main').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('+')
    assert((await control(page, '速度').textContent())?.includes('55%'), '+ did not raise the speed')
    await page.keyboard.press('-')
    assert((await control(page, '速度').textContent())?.includes('50%'), '- did not lower the speed')
  })
  await check('loop and count-in toggle by button and key; M switches the click that follows the song', async () => {
    for (const [label, key] of [['循环', 'l'], ['预备拍', 'c']] as const) {
      assert(!(await pressed(page, label)), `${label} starts on`)
      await control(page, label).click()
      assert(await pressed(page, label), `${label} did not turn on`)
      await page.locator('main').click({ position: { x: 5, y: 5 } })
      await page.keyboard.press(key)
      assert(!(await pressed(page, label)), `${key} did not turn ${label} off`)
      await page.keyboard.press(key)
      assert(await pressed(page, label), `${key} did not turn ${label} on`)
    }
    assert(!(await pressed(page, '节拍器')), 'metronome starts on')
    await page.keyboard.press('m')
    assert(await pressed(page, '节拍器'), 'M did not light the metronome button')
    await control(page, '节拍器').click()
    assert(await page.getByRole('dialog', { name: '节拍器' }).getByLabel('播放时跟随曲谱打拍').isChecked(), 'panel does not show the click as on')
    await page.keyboard.press('Escape')
  })
  await check('the count-in clicks while the song stays put and silent', async () => {
    // At half speed one 4/4 bar of count-in lasts about 5.6 s.
    await page.locator('main').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(400)
    const start = await tick(page)
    assert(start > 0, 'did not move off the first bar')
    await page.locator('footer button[aria-label="播放"]').click()
    await page.locator('footer button[aria-label="暂停"][data-counting-in]').waitFor({ timeout: 5000 })
    const during: number[] = []
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(500)
      during.push(await tick(page))
    }
    assert(during.every((value) => value === start), `the position moved during the count-in (${start} -> ${during.join(' ')})`)
    // The synthesizer itself is paused, so no note of the song can sound yet.
    const synthState = await page.evaluate(() => (window as unknown as { __tabsPlayer: { api: { playerState: number } } }).__tabsPlayer.api.playerState)
    assert(synthState === 0, 'the song was already playing during the count-in')
    await page.locator('footer button[aria-label="暂停"]:not([data-counting-in])').waitFor({ timeout: 10_000 })
    await page.waitForTimeout(1500)
    const after = await tick(page)
    await page.locator('footer button[aria-label="暂停"]').click()
    await page.locator('footer button[aria-label="播放"]').waitFor()
    assert(after > start + 100, `the song did not start after the count-in (${start} -> ${after})`)
  })
  await check('pausing during the count-in cancels it; without a count-in the song starts at once', async () => {
    await page.waitForTimeout(600)
    const start = await tick(page)
    await page.locator('footer button[aria-label="播放"]').click()
    await page.locator('footer button[aria-label="暂停"][data-counting-in]').waitFor({ timeout: 5000 })
    await page.waitForTimeout(800)
    await page.locator('footer button[aria-label="暂停"]').click()
    await page.locator('footer button[aria-label="播放"]').waitFor()
    // Longer than the rest of the count-in would have taken: nothing may start by itself.
    await page.waitForTimeout(6000)
    assert(await page.locator('footer button[aria-label="播放"]').isVisible(), 'playback started although the count-in was cancelled')
    assert((await tick(page)) === start, 'the position moved although the count-in was cancelled')

    await page.locator('main').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('c')
    await page.locator('footer button[aria-label="播放"]').click()
    await page.locator('footer button[aria-label="暂停"]:not([data-counting-in])').waitFor({ timeout: 5000 })
    await page.waitForTimeout(1500)
    const after = await tick(page)
    await page.locator('footer button[aria-label="暂停"]').click()
    await page.locator('footer button[aria-label="播放"]').waitFor()
    assert(after > start + 100, `playback did not start (${start} -> ${after})`)
    await page.keyboard.press('c')
    assert(await pressed(page, '预备拍'), 'count-in was not switched back on')
  })
  await check('solo and mute act on the shown track', async () => {
    await control(page, '独奏').click()
    assert(await pressed(page, '独奏'), 'solo did not turn on')
    await control(page, '乐器').click()
    const mixer = page.getByRole('dialog', { name: '乐器与混音' })
    assert((await mixer.getByRole('button', { name: 'Rhythm Guitar 独奏' }).getAttribute('aria-pressed')) === 'true', 'mixer does not show solo')
    await page.keyboard.press('Escape')
    await control(page, '独奏').click()
    await control(page, '静音').click()
    assert(await pressed(page, '静音'), 'mute did not turn on')
    await control(page, '静音').click()
  })
  await check('transposing moves the pitch and rewrites the frets, keeping position and mixer', async () => {
    const read = () =>
      page.evaluate(() => {
        type Note = { realValue: number; string: number; fret: number }
        const player = (window as unknown as {
          __tabsPlayer: {
            tickPosition: number
            getSnapshot(): { trackIndex: number; transpose: number }
            api: { score: { tracks: Array<{ staves: Array<{ bars: Array<{ voices: Array<{ beats: Array<{ notes: Note[] }> }> }> }> }> } }
          }
        }).__tabsPlayer
        const track = player.api.score.tracks[player.getSnapshot().trackIndex]
        const notes = track.staves[0].bars.flatMap((bar) => bar.voices[0].beats.flatMap((beat) => beat.notes)).slice(0, 60)
        return {
          transpose: player.getSnapshot().transpose,
          pitches: notes.map((note) => note.realValue),
          frets: notes.map((note) => `${note.string}:${note.fret}`).join(' '),
          tick: Math.round(player.tickPosition),
        }
      })
    const settled = async (transpose: number) => {
      await page.waitForFunction(
        (value) => (window as unknown as { __tabsPlayer: { getSnapshot(): { transpose: number } } }).__tabsPlayer.getSnapshot().transpose === value,
        transpose,
      )
      await page.waitForTimeout(1500)
    }
    await control(page, '独奏').click()
    const before = await read()
    assert(before.pitches.length > 10 && before.tick > 0, 'nothing to compare')

    await control(page, '移调').click()
    const dialog = page.getByRole('dialog', { name: '移调' })
    await dialog.getByRole('button', { name: '升半音' }).click()
    await dialog.getByRole('button', { name: '升半音' }).click()
    await settled(2)
    assert((await control(page, '移调').textContent())?.includes('+2'), 'transpose label missing')
    const up = await read()
    assert(up.pitches.every((pitch, index) => pitch === before.pitches[index] + 2), 'pitches did not all rise by two semitones')
    assert(up.frets !== before.frets, 'the fret numbers did not change')
    assert(Math.abs(up.tick - before.tick) <= 2, `the position was lost (${before.tick} -> ${up.tick})`)
    assert(await pressed(page, '独奏'), 'solo was lost')
    assert((await page.locator('main svg').count()) > 0, 'nothing rendered after transposing')

    await dialog.getByRole('button', { name: '还原' }).click()
    await settled(0)
    const back = await read()
    assert(back.frets === before.frets && back.pitches.join() === before.pitches.join(), 'reset did not restore the tab')
    assert(!(await control(page, '移调').textContent())?.includes('+'), 'transpose label did not reset')
    await page.keyboard.press('Escape')
    await control(page, '独奏').click()
  })
  await check('the free metronome takes a tempo and a time signature', async () => {
    const state = () =>
      page.evaluate(() => JSON.stringify((window as unknown as { __tabsPlayer: { getSnapshot(): { freeMetronome: unknown } } }).__tabsPlayer.getSnapshot().freeMetronome))
    await control(page, '节拍器').click()
    const dialog = page.getByRole('dialog', { name: '节拍器' })
    await dialog.getByLabel('节拍器 BPM', { exact: true }).fill('140')
    await dialog.getByLabel('每小节拍数').fill('3')
    await dialog.getByLabel('以几分音符为一拍').selectOption('8')
    await dialog.getByRole('button', { name: '开始' }).click()
    await dialog.getByText('运行中').waitFor()
    assert((await state()) === JSON.stringify({ bpm: 140, numerator: 3, denominator: 8, running: true }), `unexpected state ${await state()}`)
    await page.waitForTimeout(1200)
    await dialog.getByRole('button', { name: '停止' }).click()
    await dialog.getByText('已停止').waitFor()
    // The song is 86 bpm in 4/4 and the practice speed is 50%.
    await dialog.getByRole('button', { name: '取当前曲速' }).click()
    assert((await state()) === JSON.stringify({ bpm: 43, numerator: 4, denominator: 4, running: false }), `unexpected state ${await state()}`)
    await page.keyboard.press('Escape')
    assert(await pressed(page, '节拍器'), 'the button should still be lit by the click that follows the song')
  })
  await check('switching to bass and drums re-renders without errors', async () => {
    const errorsBefore = pageErrors.length
    for (const name of ['Bass Guitar', 'Percussion']) {
      await control(page, '乐器').click()
      await page.getByRole('dialog', { name: '乐器与混音' }).getByRole('button', { name, exact: true }).click()
      await page.keyboard.press('Escape')
      await shownTrack(page, name)
      await page.waitForTimeout(1500)
      assert((await scoreStatus(page)) === 'ready', `status after switching to ${name}`)
      assert((await page.locator('main svg').count()) > 0, `nothing rendered for ${name}`)
      await shot(page, name === 'Percussion' ? '05-drums' : '04-bass')
    }
    assert(pageErrors.length === errorsBefore, `errors: ${pageErrors.slice(errorsBefore).join(' | ')}`)
    await control(page, '乐器').click()
    await page.getByRole('dialog', { name: '乐器与混音' }).getByRole('button', { name: 'Bass Guitar', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1200)
  })
  await check('dragging across the score selects a loop range', async () => {
    await page.locator('main').evaluate((main) => main.scrollTo(0, 0))
    const boxes = await page.evaluate(() => {
      const svgs = [...document.querySelectorAll('main svg')].map((svg) => svg.getBoundingClientRect())
      return svgs.filter((box) => box.height > 60 && box.top > 120).slice(0, 1).map((box) => ({ x: box.left, y: box.top, w: box.width, h: box.height }))
    })
    assert(boxes.length === 1, 'no system found to drag on')
    const box = boxes[0]
    const y = box.y + box.h * 0.45
    await page.mouse.move(box.x + box.w * 0.3, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.w * 0.5, y, { steps: 8 })
    await page.mouse.move(box.x + box.w * 0.7, y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    await control(page, '设置').click()
    await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '清除循环选区' }).waitFor({ timeout: 5000 })
    assert((await page.locator('main .at-selection div').count()) > 0, 'no selection highlight')
    await shot(page, '06-selection')
    await page.keyboard.press('Escape')
  })
  await check('looping a selected range keeps playing inside it', async () => {
    // Full speed and no count-in, so several passes fit into a few seconds; both are put back afterwards.
    await page.locator('main').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('c')
    await control(page, '速度').click()
    await page.getByRole('dialog', { name: '速度' }).getByLabel('速度百分比').fill('200')
    await page.keyboard.press('Escape')
    await page.locator('footer button[aria-label="播放"]').click()
    await page.locator('footer button[aria-label="暂停"]').waitFor({ timeout: 15_000 })
    const ticks: number[] = []
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(400)
      ticks.push(await tick(page))
    }
    await page.locator('footer button[aria-label="暂停"]').click()
    await page.locator('footer button[aria-label="播放"]').waitFor()
    const span = Math.max(...ticks) - Math.min(...ticks)
    const seen = await page.evaluate(() => {
      const player = (window as unknown as { __tabsPlayer: { getSnapshot(): Record<string, unknown> } }).__tabsPlayer
      const { speed, countIn, metronome, looping, range, playing, trackIndex } = player.getSnapshot()
      return JSON.stringify({ speed, countIn, metronome, looping, range, playing, trackIndex })
    })
    assert(span > 0, `playback did not advance (${ticks.join(' ')}) state ${seen}`)
    assert(span < 3840 * 4, `playback left the selected range (${ticks.join(' ')})`)
    assert(ticks.some((value, index) => index > 0 && value < ticks[index - 1]), `never jumped back to the loop start (${ticks.join(' ')})`)
    await control(page, '速度').click()
    await page.getByRole('dialog', { name: '速度' }).getByRole('button', { name: '50%' }).click()
    await page.keyboard.press('Escape')
    await page.locator('main').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('c')
    assert(await pressed(page, '预备拍'), 'count-in was not switched back on')
  })

  console.log('persistence')
  await check('practice settings come back after a reload', async () => {
    await page.waitForTimeout(900)
    await page.reload()
    await waitReady(page)
    await shownTrack(page, 'Bass Guitar')
    assert((await control(page, '速度').textContent())?.includes('50%'), 'speed was not restored')
    for (const label of ['循环', '预备拍', '节拍器']) assert(await pressed(page, label), `${label} was not restored`)
    await control(page, '设置').click()
    await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '清除循环选区' }).waitFor({ timeout: 5000 })
    await page.keyboard.press('Escape')
  })
  await check('the mixer has a master volume and blinking dots for the tracks that sound', async () => {
    const player = () => page.evaluate(() => (window as unknown as { __tabsPlayer: { api: { masterVolume: number } } }).__tabsPlayer.api.masterVolume)
    await page.locator('main').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('c')
    await control(page, '乐器').click()
    const mixer = page.getByRole('dialog', { name: '乐器与混音' })
    const families = await mixer.locator('[data-family]').evaluateAll((icons) => icons.map((icon) => icon.getAttribute('data-family')))
    assert(new Set(families).size >= 4, `instrument icons are not told apart: ${families.join(' ')}`)
    assert(families.includes('bass') && families.includes('drums') && families.includes('distortion'), `unexpected families ${families.join(' ')}`)
    const levels = await page.evaluate(() => {
      const player = (window as unknown as { __tabsPlayer: { effectiveTrackVolume(index: number): number; getSnapshot(): { trackIndex: number; tracks: Array<{ index: number }> } } }).__tabsPlayer
      const state = player.getSnapshot()
      return state.tracks.map((track) => ({ shown: track.index === state.trackIndex, level: player.effectiveTrackVolume(track.index) }))
    })
    assert(levels.every((item) => (item.shown ? item.level === 1 : item.level < 1 && item.level > 0.5)), `levels: ${JSON.stringify(levels)}`)
    await mixer.getByLabel('主音量').fill('0.6')
    assert(Math.abs((await player()) - 0.6) < 0.01, `master volume not applied (${await player()})`)
    assert((await mixer.locator('[data-sounding]').count()) === 0, 'dots lit while stopped')
    // Space, so the popover stays open (a click on the play button is a click outside it). The slider has
    // the focus, and shortcuts ignore inputs, so let go of it first.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Space')
    await page.locator('footer button[aria-label="暂停"]').waitFor({ timeout: 10_000 })
    await mixer.locator('[data-sounding]').first().waitFor({ timeout: 8000 })
    const lit = await mixer.locator('[data-sounding]').count()
    await shot(page, '12-mixer')
    await mixer.getByRole('button', { name: 'Bass Guitar 静音' }).click()
    await page.waitForTimeout(1500)
    const bassRow = mixer.locator('li').filter({ hasText: 'Bass Guitar' })
    assert((await bassRow.locator('[data-sounding]').count()) === 0, 'a muted track still shows as sounding')
    await mixer.getByRole('button', { name: 'Bass Guitar 静音' }).click()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Space')
    await page.locator('footer button[aria-label="播放"]').waitFor()
    await page.waitForTimeout(300)
    assert((await mixer.locator('[data-sounding]').count()) === 0, 'dots still lit after pausing')
    assert(lit >= 1, 'no track showed as sounding')
    await mixer.getByLabel('主音量').fill('1')
    await page.keyboard.press('Escape')
    await page.locator('main').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('c')
  })
  await check('settings: four bars per line, dynamics, count-in between loops, language', async () => {
    const evaluate = <T,>(body: string) =>
      page.evaluate((code) => new Function('api', code)((window as unknown as { __tabsPlayer: { api: unknown } }).__tabsPlayer.api), body) as Promise<T>
    const firstLineBars = () => evaluate<number>('return api.boundsLookup?.staveGroups?.[0]?.bars?.length ?? api.boundsLookup?.staffSystems?.[0]?.bars?.length ?? -1')
    await control(page, '设置').click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    const before = await firstLineBars()
    await dialog.getByRole('switch', { name: '每行显示4小节' }).check()
    await page.waitForTimeout(1500)
    assert((await firstLineBars()) === 4, `first line has ${await firstLineBars()} bars (was ${before})`)
    await dialog.getByRole('switch', { name: '每行显示4小节' }).uncheck()
    await dialog.getByRole('switch', { name: '显示强弱' }).check()
    assert(await evaluate<boolean>('return api.settings.notation.elements.get(18)'), 'dynamics not switched on')
    await dialog.getByRole('switch', { name: '显示强弱' }).uncheck()

    // A loop restart with the count-in between loops: the play button shows the count-in again.
    await dialog.getByRole('switch', { name: '循环间计数' }).check()
    await page.keyboard.press('Escape')
    await page.locator('main').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('c')
    await control(page, '速度').click()
    await page.getByRole('dialog', { name: '速度' }).getByLabel('速度百分比').fill('200')
    await page.keyboard.press('Escape')
    await page.locator('footer button[aria-label="播放"]').click()
    await page.locator('footer button[data-counting-in]').waitFor({ timeout: 15_000 })
    await page.locator('footer button[aria-label="暂停"]:not([data-counting-in])').waitFor({ timeout: 10_000 })
    await page.locator('footer button[aria-label="暂停"]').click()
    await page.locator('footer button[aria-label="播放"]').waitFor()
    await control(page, '速度').click()
    await page.getByRole('dialog', { name: '速度' }).getByRole('button', { name: '50%' }).click()
    await page.keyboard.press('Escape')
    await page.locator('main').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('c')
    await control(page, '设置').click()
    await page.getByRole('dialog', { name: '设置' }).getByRole('switch', { name: '循环间计数' }).uncheck()

    await page.getByRole('dialog', { name: '设置' }).getByLabel('语言').selectOption('en')
    await page.locator('footer').getByRole('button', { name: 'Settings', exact: true }).waitFor()
    assert(await page.locator('header').getByRole('button', { name: 'My tabs' }).isVisible(), 'top bar not translated')
    await shot(page, '13-english')
    await page.getByRole('dialog', { name: 'Settings' }).getByLabel('Language').selectOption('auto')
    await control(page, '设置').waitFor()
    await shot(page, '14-settings')
    await page.keyboard.press('Escape')
  })
  await check('track editor: rename, Drop D keeping the pitch, saved with the song, and restore', async () => {
    type Info = { name: string; tuning: number[]; pitches: number[]; frets: string; program: number }
    const read = () =>
      page.evaluate(() => {
        const player = (window as unknown as {
          __tabsPlayer: { getSnapshot(): { trackIndex: number }; api: { score: { tracks: Array<{ name: string; playbackInfo: { program: number }; staves: Array<{ tuning: number[]; bars: Array<{ voices: Array<{ beats: Array<{ notes: Array<{ realValue: number; string: number; fret: number }> }> }> }> }> }> } } }
        }).__tabsPlayer
        const track = player.api.score.tracks[player.getSnapshot().trackIndex]
        const notes = track.staves[0].bars.flatMap((bar) => bar.voices[0].beats.flatMap((beat) => beat.notes))
        return {
          name: track.name,
          program: track.playbackInfo.program,
          tuning: [...track.staves[0].tuning],
          pitches: notes.map((note) => note.realValue),
          frets: notes.map((note) => `${note.string}:${note.fret}`).join(' '),
        }
      }) as Promise<Info>
    const before = await read()
    await control(page, '乐器').click()
    await page.getByRole('dialog', { name: '乐器与混音' }).getByRole('button', { name: '编辑 Bass Guitar' }).click()
    const editor = page.getByRole('dialog', { name: '编辑音轨' })
    await editor.waitFor()
    await editor.getByLabel('名称（可选）').fill('My Bass')
    await editor.getByLabel('调弦').selectOption('Drop D')
    assert(await editor.getByLabel('调整指法（保持音高，重新排品）').isChecked(), 'adjust fingerings should default to on')
    await editor.getByRole('button', { name: '无品贝斯' }).click()
    assert((await editor.getByRole('button', { name: 'Fretless Bass' }).count()) === 0, 'instrument names are not translated')
    await shot(page, '15-track-editor')
    await editor.getByRole('button', { name: '应用' }).click()
    await editor.waitFor({ state: 'hidden' })
    await page.waitForTimeout(1500)
    const after = await read()
    assert(after.name === 'My Bass', `name is ${after.name}`)
    assert(after.program === 35, `program is ${after.program}`)
    assert(after.tuning.join() === '43,38,33,26', `tuning is ${after.tuning}`)
    assert(after.pitches.join() === before.pitches.join(), 'the notes changed pitch')
    assert(after.frets !== before.frets, 'no note was re-fretted')
    await shownTrack(page, 'My Bass')

    await page.waitForTimeout(900)
    await page.reload()
    await waitReady(page)
    const reloaded = await read()
    assert(reloaded.name === 'My Bass' && reloaded.tuning.join() === '43,38,33,26', 'the edit was not saved with the song')

    await control(page, '乐器').click()
    await page.getByRole('dialog', { name: '乐器与混音' }).getByRole('button', { name: '编辑 My Bass' }).click()
    await page.getByRole('dialog', { name: '编辑音轨' }).getByRole('button', { name: '恢复原样' }).click()
    await page.waitForTimeout(1500)
    const restored = await read()
    assert(restored.name === before.name && restored.frets === before.frets, 'restore did not bring back the original track')
    await page.keyboard.press('Escape')
  })
  await check('the top bar panels stay inside the window', async () => {
    for (const name of ['我的曲谱', '新建', '搜索曲谱', '帮助']) {
      await page.locator('header').getByRole('button', { name, exact: true }).click()
      const box = await page.getByRole('dialog', { name }).boundingBox()
      const width = await page.evaluate(() => document.documentElement.clientWidth)
      assert(box && box.x >= 0 && box.x + box.width <= width, `${name} panel sticks out: ${JSON.stringify(box)} in ${width}px`)
      await page.keyboard.press('Escape')
    }
  })
  await check('tab editor: edit, play, undo, save, reopen, restore', async () => {
    type Probe = { editing: boolean; bar: number; beat: number; string: number; fret: number | null; frets: string; canUndo: boolean; dirty: boolean }
    const probe = () =>
      page.evaluate(() => {
        const player = (window as unknown as {
          __tabsPlayer: { getSnapshot(): { editing: null | { cursor: { bar: number; beat: number; string: number }; note: { fret: number } | null; canUndo: boolean; dirty: boolean }; trackIndex: number }; api: { score: { tracks: Array<{ staves: Array<{ bars: Array<{ voices: Array<{ beats: Array<{ notes: Array<{ string: number; fret: number }> }> }> }> }> }> } } }
        }).__tabsPlayer
        const state = player.getSnapshot()
        const bar = player.api.score.tracks[state.trackIndex].staves[0].bars[4]
        const frets = bar.voices[0].beats.map((beat) => beat.notes.map((note) => `${note.string}:${note.fret}`).sort().join(',')).join(' ')
        const edit = state.editing
        return { editing: !!edit, bar: edit?.cursor.bar ?? -1, beat: edit?.cursor.beat ?? -1, string: edit?.cursor.string ?? -1, fret: edit?.note?.fret ?? null, frets, canUndo: edit?.canUndo ?? false, dirty: edit?.dirty ?? false }
      }) as Promise<Probe>
    const editButton = page.locator('header').getByRole('button', { name: '编辑曲谱' })
    await editButton.click()
    const panel = page.getByRole('dialog', { name: '曲谱编辑' })
    await page.waitForFunction(() => (window as unknown as { __tabsPlayer: { getSnapshot(): { editing: unknown } } }).__tabsPlayer.getSnapshot().editing)
    await page.waitForTimeout(400)
    const before = await probe()
    assert(before.editing, 'the editor did not open')
    // Nothing floats over the tab until a position is picked.
    assert((await panel.count()) === 0 && (await page.locator('main [class*="editNote"]').count()) === 0, 'the edit panel showed before anything was picked')

    // Click on the third beat of bar 5 on the top string, then type a two-digit fret there.
    const target = await page.evaluate(() => {
      const player = (window as unknown as { __tabsPlayer: { getSnapshot(): { trackIndex: number }; api: { score: { tracks: Array<{ staves: Array<{ bars: Array<{ voices: Array<{ beats: unknown[] }> }> }> }> }; boundsLookup: { findBeat(beat: unknown): { visualBounds: { x: number; w: number }; barBounds: { visualBounds: { y: number } } } | null }; container: { element: HTMLElement } } } }).__tabsPlayer
      const beat = player.api.score.tracks[player.getSnapshot().trackIndex].staves[0].bars[4].voices[0].beats[2]
      const bounds = player.api.boundsLookup.findBeat(beat)!
      const origin = player.api.container.element.getBoundingClientRect()
      return { x: origin.left + bounds.visualBounds.x + bounds.visualBounds.w / 2, y: origin.top + bounds.barBounds.visualBounds.y }
    })
    await page.mouse.click(target.x, target.y)
    await panel.waitFor()
    await page.locator('main [class*="editNote"]').waitFor()
    const placed = await probe()
    assert(placed.bar === 4 && placed.beat === 2, `the click put the cursor at bar ${placed.bar + 1}, beat ${placed.beat + 1}`)
    const box = (await panel.boundingBox())!
    const view = page.viewportSize()!
    assert(box.x >= 0 && box.x + box.width <= view.width, 'the edit panel runs off the window')
    await page.keyboard.press('1')
    await page.keyboard.press('2')
    await page.waitForTimeout(800)
    const typed = await probe()
    assert(typed.fret === 12, `typed fret is ${typed.fret}`)
    assert(typed.frets !== before.frets && typed.dirty, 'the tab did not change')
    await page.keyboard.press('h')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Insert')
    await page.keyboard.press('7')
    await page.waitForTimeout(600)
    // Techniques from the panel: a whole-beat one and a note one.
    await panel.getByRole('tab', { name: '效果' }).click()
    await panel.getByRole('button', { name: '手掌闷音', exact: true }).click()
    await page.waitForTimeout(400)
    assert((await panel.getByRole('button', { name: '手掌闷音', exact: true }).getAttribute('aria-pressed')) === 'true', 'palm mute did not switch on')
    await panel.getByRole('tab', { name: '音符' }).click()
    await panel.getByRole('button', { name: '推弦: 全音' }).click()
    await page.waitForTimeout(400)
    assert((await panel.getByRole('button', { name: '推弦: 全音' }).getAttribute('aria-pressed')) === 'true', 'the bend was not set')
    // The fret box shows the fret at the cursor and takes a new one.
    const fretBox = panel.getByRole('textbox', { name: '品位' })
    assert((await fretBox.inputValue()) === '7', `the fret box shows ${await fretBox.inputValue()}`)
    await fretBox.fill('9')
    await fretBox.press('Enter')
    await page.waitForTimeout(400)
    assert((await probe()).fret === 9, 'typing in the fret box did not change the fret')
    // Lyrics and a chord from the lists.
    type BeatText = { lyrics: string; chord: string; program: number; editing: boolean }
    const beatText = () =>
      page.evaluate(() => {
        const state = (window as unknown as { __tabsPlayer: { getSnapshot(): { editing: null | { beat: { lyrics: string; chord: string } }; trackIndex: number; tracks: Array<{ index: number; program: number }> } } }).__tabsPlayer.getSnapshot()
        return { lyrics: state.editing?.beat.lyrics ?? '', chord: state.editing?.beat.chord ?? '', program: state.tracks.find((track) => track.index === state.trackIndex)?.program ?? -1, editing: !!state.editing }
      }) as Promise<BeatText>
    await panel.getByRole('tab', { name: '文字' }).click()
    const lyricsBox = panel.getByRole('textbox', { name: '拍下的歌词' })
    await lyricsBox.fill('la')
    await lyricsBox.press('Enter')
    await panel.getByLabel('和弦根音').selectOption('A')
    await panel.getByLabel('和弦类型').selectOption('m7')
    await page.waitForTimeout(400)
    const texts = await beatText()
    assert(texts.lyrics === 'la' && texts.chord === 'Am7', `lyrics "${texts.lyrics}", chord "${texts.chord}"`)
    // The track's instrument can be changed without leaving the editor.
    const programBefore = texts.program
    await control(page, '乐器').click()
    const trackName = await page.evaluate(() => {
      const state = (window as unknown as { __tabsPlayer: { getSnapshot(): { trackIndex: number; tracks: Array<{ index: number; name: string }> } } }).__tabsPlayer.getSnapshot()
      return state.tracks.find((track) => track.index === state.trackIndex)!.name
    })
    await page.getByRole('dialog', { name: '乐器与混音' }).getByRole('button', { name: `编辑 ${trackName}` }).click()
    const trackDialog = page.getByRole('dialog', { name: '编辑音轨' })
    await trackDialog.getByRole('tab', { name: '钢琴' }).click()
    await trackDialog.getByRole('button', { name: '原声大钢琴', exact: true }).click()
    await trackDialog.getByRole('button', { name: '应用' }).click()
    await trackDialog.waitFor({ state: 'hidden' })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const changed = await beatText()
    assert(changed.editing && changed.program === 0 && programBefore !== 0, `the instrument is ${changed.program} (was ${programBefore}) while editing`)
    await shot(page, '16-editor-text')
    await page.mouse.click(target.x, target.y)
    await panel.waitFor()
    await shot(page, '16-editor')
    // Escape folds the panel away; the editor stays open.
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'detached' })
    assert((await probe()).editing, 'Escape closed the editor')

    // Playing while editing plays the edited tab and leaves the editor open.
    await page.keyboard.press('Space')
    await page.locator('footer button[aria-label="暂停"]').waitFor({ timeout: 10_000 })
    await page.waitForTimeout(1200)
    await page.keyboard.press('Space')
    await page.locator('footer button[aria-label="播放"]').waitFor()
    assert((await probe()).editing, 'playing closed the editor')

    // Undo everything, then redo it.
    const edited = (await probe()).frets
    for (let i = 0; i < 20; i++) await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)
    assert((await probe()).frets === before.frets, 'undo did not return to the original bar')
    assert((await beatText()).program === programBefore, 'undo did not bring the instrument back')
    for (let i = 0; i < 20; i++) await page.keyboard.press('Control+y')
    await page.waitForTimeout(600)
    assert((await probe()).frets === edited, 'redo did not bring the edits back')

    // Save with the same button; the song now opens as its edited copy.
    await page.locator('header').getByRole('button', { name: '保存修改' }).click()
    await editButton.waitFor({ timeout: 15_000 })
    const songs = (await (await fetch(`http://127.0.0.1:${API_PORT}/api/songs`)).json()) as Array<{ edited: boolean }>
    assert(songs[0]?.edited === true, 'the song was not marked as edited')
    await page.reload()
    await waitReady(page)
    await page.waitForTimeout(800)
    const reopened = await probe()
    assert(reopened.frets === edited, `the saved edits did not come back after reloading (${reopened.frets} vs ${edited})`)

    // Restore the original tab from the edit panel.
    await editButton.click()
    await page.waitForTimeout(400)
    await page.mouse.click(target.x, target.y)
    await panel.getByRole('button', { name: '恢复原谱' }).click()
    await waitReady(page)
    await page.waitForTimeout(800)
    const restored = await probe()
    assert(!restored.editing && restored.frets === before.frets, 'restoring did not bring back the original tab')
  })
  await check('reopening the song makes no Songsterr request', async () => {
    const before = await (await fetch(`http://127.0.0.1:${API_PORT}/api/songs`)).json()
    assert(Array.isArray(before) && before.length === 1, 'library should hold one song')
    assert(before[0].lastOpenedAt, 'lastOpenedAt not set')
  })

  console.log('library')
  await check('favourite from the top bar shows in the favourites filter', async () => {
    await page.locator('header').getByRole('button', { name: '收藏', exact: true }).click()
    await page.locator('header').getByRole('button', { name: '取消收藏' }).waitFor()
    await page.getByRole('button', { name: '我的曲谱' }).click()
    const panel = page.getByRole('dialog', { name: '我的曲谱' })
    await panel.getByRole('tab', { name: '收藏' }).click()
    await panel.getByText('Promise', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
  })
  let exported: { path: string; name: string } | null = null
  await check('download exports a Guitar Pro file', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), control(page, '下载').click()])
    const file = path.join(dataDir, 'exported.gp')
    await download.saveAs(file)
    exported = { path: file, name: download.suggestedFilename() }
    assert(exported.name.endsWith('.gp') && exported.name.includes('Promise'), `unexpected file name ${exported.name}`)
  })
  await check('uploading that file opens it as a local song', async () => {
    assert(exported, 'no exported file')
    // Solo the shown track of this song, and watch what the player tells the synthesizer when the next one opens.
    await control(page, '独奏').click()
    assert(await pressed(page, '独奏'), 'solo did not turn on')
    await page.evaluate(() => {
      const api = (window as unknown as { __tabsPlayer: { api: { changeTrackSolo(tracks: unknown[], solo: boolean): void } } }).__tabsPlayer.api
      const calls: Array<{ count: number; solo: boolean }> = []
      ;(window as unknown as { __soloCalls: typeof calls }).__soloCalls = calls
      const original = api.changeTrackSolo.bind(api)
      api.changeTrackSolo = (tracks, solo) => {
        calls.push({ count: tracks.length, solo })
        original(tracks, solo)
      }
    })
    await page.getByRole('button', { name: '新建' }).click()
    await page.getByLabel('曲谱文件').setInputFiles(exported.path)
    await page.waitForFunction((previous) => window.location.hash !== previous, new URL(page.url()).hash, { timeout: 20_000 })
    await waitReady(page)
    await page.locator('header').getByText('Promise', { exact: true }).waitFor()
    assert(!(await control(page, '修订历史').isEnabled()), 'revision history should be disabled for local files')
    const soloCalls = await page.evaluate(() => (window as unknown as { __soloCalls: Array<{ count: number; solo: boolean }> }).__soloCalls)
    assert(soloCalls.some((call) => !call.solo && call.count >= 7), `the previous song's solo was not cleared (${JSON.stringify(soloCalls)})`)
    assert(soloCalls.every((call) => !call.solo), 'something was soloed in the new song')
    assert(!(await pressed(page, '独奏')), 'solo is shown as on in the new song')
    // The drawn chunks are inserted a moment after the render is reported as finished.
    await page.locator('main svg').first().waitFor({ state: 'attached', timeout: 8000 }).catch(() => undefined)
    assert((await page.locator('main svg').count()) > 0, 'uploaded file did not render')
    await shot(page, '07-uploaded-file')
  })
  await check('search finds local songs and Songsterr results', async () => {
    await page.locator('main').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('/')
    await page.waitForFunction(() => document.activeElement?.id === 'song-search', undefined, { timeout: 5000 })
    await page.keyboard.type('promise')
    const results = page.getByRole('dialog', { name: '搜索曲谱' }).getByRole('region', { name: '搜索结果' })
    await results.getByText('Promise', { exact: true }).first().waitFor()
    await results.getByText(/条音轨/).first().waitFor({ timeout: 20_000 })
    await shot(page, '08-search')
    await page.keyboard.press('Escape')
  })
  await check('logo returns to the library, which lists both songs', async () => {
    await page.getByRole('link', { name: '曲库首页' }).click()
    await page.getByRole('heading', { name: '我的曲谱' }).waitFor()
    assert((await page.locator('main li').count()) === 2, 'expected two songs in the library')
    await shot(page, '09-library')
  })
  await check('revision history lists revisions for a Songsterr song', async () => {
    await page.locator('main li').filter({ hasNotText: '本地文件' }).getByRole('button').first().click()
    await waitReady(page)
    const badge = await control(page, '修订历史').textContent()
    assert(/\d\d\/\d\d\/\d\d/.test(badge ?? ''), `no date badge (${badge})`)
    await control(page, '修订历史').click()
    const dialog = page.getByRole('dialog', { name: '修订历史' })
    await dialog.getByText('（当前）').waitFor({ timeout: 20_000 })
    assert((await dialog.getByRole('button').count()) > 1, 'expected more than one revision')
    await shot(page, '10-revisions')
    await page.keyboard.press('Escape')
  })
  await check('deleting a song removes it from the library', async () => {
    await page.getByRole('link', { name: '曲库首页' }).click()
    await page.getByRole('heading', { name: '我的曲谱' }).waitFor()
    await page.locator('main li').filter({ hasText: '本地文件' }).getByRole('button', { name: '删除' }).click()
    await page.waitForFunction(() => document.querySelectorAll('main li').length === 1)
  })

  console.log('narrow window')
  await check('at 900px the control bar is still one row and nothing overflows', async () => {
    const left = (await (await fetch(`http://127.0.0.1:${API_PORT}/api/songs`)).json()) as Array<{ source: string }>
    assert(left.length === 1 && left[0].source === 'songsterr', 'the library should hold only the Songsterr song by now')
    await page.setViewportSize({ width: 900, height: 700 })
    await page.locator('main li button').first().click()
    await waitReady(page)
    const info = await page.evaluate(() => {
      const footer = document.querySelector('footer')!
      const tops = [...footer.querySelectorAll('button')].filter((b) => b.getAttribute('role') !== 'radio').map((b) => {
        const box = b.getBoundingClientRect()
        return Math.round(box.top + box.height / 2)
      })
      return {
        spread: Math.max(...tops) - Math.min(...tops),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        footerOverflow: footer.scrollWidth > footer.clientWidth,
      }
    })
    assert(info.spread <= 2, 'control bar wrapped')
    const widths = await page.evaluate(() => {
      const width = (selector: string) => {
        const element = document.querySelector(selector)!
        return `${selector} ${element.scrollWidth}/${element.clientWidth}`
      }
      return [width('html'), width('header'), width('main'), width('footer')].join(', ')
    })
    assert(!info.overflow && !info.footerOverflow, `horizontal overflow (${widths})`)
    await shot(page, '11-narrow')
  })

  await check('no uncaught errors in the page', async () => {
    assert(pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '))
  })

  await browser.close()
}

try {
  await main()
} catch (error) {
  failures.push('run aborted')
  console.error(error)
} finally {
  for (const child of children) {
    if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill()
  }
  await new Promise((resolve) => setTimeout(resolve, 800))
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 })
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log(failures.map((name) => `  - ${name}`).join('\n'))
  process.exit(1)
}

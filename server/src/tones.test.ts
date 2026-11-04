import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'

let dataDir: string
let close: (() => void) | null = null
beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'tabs-tones-'))
})
afterEach(() => {
  close?.()
  close = null
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 })
})

function setup() {
  const { app, library } = createApp({ dataDir, separator: { check: () => null, modelFiles: () => ({ available: true, bytes: 0 }), devices: async () => ({ gpus: [], torch: null, cuda: null }), run: () => ({ done: Promise.resolve(), cancel: () => {} }) } })
  close = () => library.close()
  return app
}

describe('tone library', () => {
  it('is null until saved, then kept in data/user.db', async () => {
    const app = setup()
    expect(await (await app.request('/api/tones')).json()).toEqual({ library: null })
    const library = { version: 5, custom: [{ id: 'mine', name: 'Mine' }] }
    const saved = await app.request('/api/tones', { method: 'PUT', body: JSON.stringify(library) })
    expect(saved.status).toBe(200)
    expect(await (await app.request('/api/tones')).json()).toEqual({ library })
    expect(existsSync(path.join(dataDir, 'user.db'))).toBe(true)
    expect(existsSync(path.join(dataDir, 'tones.json'))).toBe(false)
    // A new server reads it back.
    close?.()
    expect(await (await setup().request('/api/tones')).json()).toEqual({ library })
  })

  it('takes in the tones.json and the library.db of before, once', async () => {
    // A library.db as the old version left it (with a song in it), and its tones.json.
    const first = createApp({ dataDir })
    await first.library.addFile('kept.gp', new Uint8Array([1]))
    first.library.close()
    renameSync(path.join(dataDir, 'user.db'), path.join(dataDir, 'library.db'))
    const library = { custom: [{ id: 'old', name: 'Old' }], presetVersion: 5 }
    writeFileSync(path.join(dataDir, 'tones.json'), JSON.stringify(library))
    const app = setup()
    expect(await (await app.request('/api/tones')).json()).toEqual({ library })
    expect(((await (await app.request('/api/songs')).json()) as Array<{ title: string }>).map((song) => song.title)).toEqual(['kept'])
    expect(existsSync(path.join(dataDir, 'library.db'))).toBe(false)
    expect(existsSync(path.join(dataDir, 'tones.json'))).toBe(false)
  })

  it('keeps the last of quick saves', async () => {
    const app = setup()
    await Promise.all([1, 2, 3].map((n) => app.request('/api/tones', { method: 'PUT', body: JSON.stringify({ n }) })))
    expect(await (await app.request('/api/tones')).json()).toEqual({ library: { n: 3 } })
  })

  it('turns down what is not a library', async () => {
    const app = setup()
    expect((await app.request('/api/tones', { method: 'PUT', body: 'not json' })).status).toBe(400)
    expect((await app.request('/api/tones', { method: 'PUT', body: '[1, 2]' })).status).toBe(400)
    expect((await app.request('/api/tones', { method: 'PUT', body: JSON.stringify({ big: 'x'.repeat(3 * 1024 * 1024) }) })).status).toBe(413)
    expect(await (await app.request('/api/tones')).json()).toEqual({ library: null })
  })
})

describe('online tab cache', () => {
  it('moves the old songsterr/ cache to songs/', () => {
    mkdirSync(path.join(dataDir, 'songsterr', '34008'), { recursive: true })
    writeFileSync(path.join(dataDir, 'songsterr', '34008', 'meta.json'), '{}')
    setup()
    expect(existsSync(path.join(dataDir, 'songsterr'))).toBe(false)
    expect(existsSync(path.join(dataDir, 'songs', '34008', 'meta.json'))).toBe(true)
  })
})

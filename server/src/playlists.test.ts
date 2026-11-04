import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'

let dataDir: string
let close: (() => void) | null = null
beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'tabs-playlists-'))
})
afterEach(() => {
  close?.()
  close = null
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 })
})

function setup(forgetHistory = false) {
  const { app, library, ready } = createApp({ dataDir, forgetHistory })
  close = () => library.close()
  const call = async (method: string, url: string, body?: unknown) => {
    const response = await app.request(url, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: (await response.json()) as any }
  }
  const song = async (name: string, favorite: boolean) => {
    const response = await app.request(`/api/songs/upload?name=${name}.gp`, { method: 'POST', body: new Uint8Array([1, 2, 3]) })
    const { id } = (await response.json()) as { id: number }
    if (favorite) await call('PATCH', `/api/songs/${id}`, { favorite: true })
    return id
  }
  return { call, song, ready }
}

describe('playlists', () => {
  it('are made, named, filled with favourites in order, reordered and deleted', async () => {
    const { call, song } = setup()
    const [a, b, c, browsed] = [await song('A', true), await song('B', true), await song('C', true), await song('D', false)]
    const made = await call('POST', '/api/playlists', { name: '  Warm-up  ' })
    expect(made.body).toEqual({ id: expect.any(Number), name: 'Warm-up', songIds: [] })
    expect((await call('POST', '/api/playlists', { name: ' ' })).status).toBe(400)
    const id = made.body.id
    // Only favourites, each once, in the order given.
    expect((await call('PATCH', `/api/playlists/${id}`, { songIds: [c, a, browsed, c, 999] })).body.songIds).toEqual([c, a])
    expect((await call('PATCH', `/api/playlists/${id}`, { songIds: [a, b, c], name: 'Set 1' })).body).toMatchObject({ name: 'Set 1', songIds: [a, b, c] })
    expect((await call('PATCH', `/api/playlists/${id}`, { songIds: [c, b, a] })).body.songIds).toEqual([c, b, a])
    expect((await call('GET', '/api/playlists')).body).toEqual([{ id, name: 'Set 1', songIds: [c, b, a] }])
    expect((await call('DELETE', `/api/playlists/${id}`)).body).toEqual({ ok: true })
    expect((await call('GET', '/api/playlists')).body).toEqual([])
    expect((await call('PATCH', `/api/playlists/${id}`, { name: 'x' })).status).toBe(404)
  })

  it('lose a song that stops being a favourite or is deleted, and keep the rest across a restart', async () => {
    const first = setup()
    const [a, b, c] = [await first.song('A', true), await first.song('B', true), await first.song('C', true)]
    const { body } = await first.call('POST', '/api/playlists', { name: 'Set' })
    await first.call('PATCH', `/api/playlists/${body.id}`, { songIds: [a, b, c] })
    await first.call('PATCH', `/api/songs/${b}`, { favorite: false })
    await first.call('DELETE', `/api/songs/${c}`)
    expect((await first.call('GET', '/api/playlists')).body[0].songIds).toEqual([a])
    // Favourite again: not back in by itself.
    await first.call('PATCH', `/api/songs/${b}`, { favorite: true })
    expect((await first.call('GET', '/api/playlists')).body[0].songIds).toEqual([a])
    close?.()
    const second = setup(true)
    await second.ready
    expect((await second.call('GET', '/api/playlists')).body).toEqual([{ id: body.id, name: 'Set', songIds: [a] }])
  })
})

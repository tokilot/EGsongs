import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { parseSongId, SongsterrClient, songUrl } from './songs/client.ts'

const META = {
  songId: 34008,
  revisionId: 7221665,
  title: 'Promise',
  artist: 'Akira Yamaoka',
  image: 'v0-test',
  createdAt: '2026-06-06T09:10:06.886Z',
  restriction: '',
  defaultTrack: 1,
  tracks: [
    { instrumentId: 30, instrument: 'Distortion Guitar', name: 'Lead' },
    { instrumentId: 27, instrument: 'Electric Guitar (clean)', name: 'Rhythm' },
  ],
}

/** Stands in for Songsterr and records every upstream request. */
function fakeUpstream(overrides: Record<string, unknown> = {}) {
  const requests: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    requests.push(url)
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/api/songs?')) return json([{ songId: 34008, title: 'Promise', artist: 'Akira Yamaoka', tracks: [{}, {}] }])
    if (url.endsWith('/revisions')) {
      return json([
        { revisionId: 7221665, createdAt: '2026-06-06T09:10:06.886Z', author: { name: 'someone' }, description: 'latest' },
        { revisionId: 6383873, createdAt: '2025-07-19T00:00:00.000Z', author: { name: 'someone' }, description: 'older' },
      ])
    }
    const meta = /\/api\/meta\/(\d+)(?:\/(\d+))?$/.exec(url)
    if (meta) {
      if (meta[1] !== '34008') return json({ error: 'not found' }, 404)
      return json({ ...META, revisionId: meta[2] ? Number(meta[2]) : META.revisionId, ...overrides })
    }
    const track = /\/(\d+)\/(\d+)\/[^/]+\/(\d+)\.json$/.exec(url)
    if (track) return json({ name: `track ${track[3]}`, revisionId: Number(track[2]), measures: [] })
    return json({ error: 'unexpected' }, 500)
  }) as typeof fetch
  return { requests, fetchImpl }
}

let dataDir: string
beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'tabs-test-'))
})
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 })
})

describe('parseSongId', () => {
  it('reads the id from a song link', () => {
    expect(parseSongId('https://www.songsterr.com/a/wsa/akira-yamaoka-promise-tab-s34008')).toBe(34008)
    expect(parseSongId('https://www.songsterr.com/a/wsa/eagles-hotel-california-tab-s447')).toBe(447)
  })

  it('ignores the words before the id and anything after it', () => {
    expect(parseSongId('https://www.songsterr.com/a/wsa/the-eagles-hotel-california-tab-s447')).toBe(447)
    expect(parseSongId('songsterr.com/a/wsa/whatever-tab-s23t3')).toBe(23)
    expect(parseSongId(' https://www.songsterr.com/a/wsa/x-tab-s6700?inst=bass#top ')).toBe(6700)
  })

  it('accepts a bare id and rejects everything else', () => {
    expect(parseSongId('34008')).toBe(34008)
    expect(parseSongId('https://example.com/a/wsa/x-tab-s34008')).toBeNull()
    expect(parseSongId('https://www.songsterr.com/a/wsa/akira-yamaoka-tabs-a5839')).toBeNull()
    expect(parseSongId('promise')).toBeNull()
  })

  it('builds a link that parses back', () => {
    expect(parseSongId(songUrl({ songId: 447, artist: 'Eagles', title: 'Hotel California' }))).toBe(447)
  })
})

describe('SongsterrClient', () => {
  it('fetches a pinned revision once and then reads the disk cache', async () => {
    const { requests, fetchImpl } = fakeUpstream()
    const client = new SongsterrClient({ cacheDir: dataDir, fetch: fetchImpl, minIntervalMs: 0 })
    const meta = await client.getMeta(34008, 7221665)
    await client.getAllTracks(meta)
    expect(requests).toHaveLength(3)

    const again = new SongsterrClient({ cacheDir: dataDir, fetch: fetchImpl, minIntervalMs: 0 })
    const cached = await again.getMeta(34008, 7221665)
    expect(cached).toEqual(meta)
    expect(await again.getAllTracks(cached)).toHaveLength(2)
    expect(requests).toHaveLength(3)
  })

  it('sends upstream requests one at a time', async () => {
    let active = 0
    let peak = 0
    const { fetchImpl } = fakeUpstream()
    const slow = (async (...args: Parameters<typeof fetch>) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return fetchImpl(...args)
    }) as typeof fetch
    const client = new SongsterrClient({ cacheDir: dataDir, fetch: slow, minIntervalMs: 0 })
    const meta = await client.getMeta(34008)
    await Promise.all([client.getTrack(meta, 0), client.getTrack(meta, 1), client.search('promise')])
    expect(peak).toBe(1)
  })

  it('refuses restricted tabs', async () => {
    for (const overrides of [{ restriction: 'license' }, { isRestricted: true }]) {
      const { fetchImpl } = fakeUpstream(overrides)
      const client = new SongsterrClient({ cacheDir: dataDir, fetch: fetchImpl, minIntervalMs: 0 })
      await expect(client.getMeta(34008)).rejects.toMatchObject({ status: 403 })
    }
  })

  it('reports a missing song as 404', async () => {
    const { fetchImpl } = fakeUpstream()
    const client = new SongsterrClient({ cacheDir: dataDir, fetch: fetchImpl, minIntervalMs: 0 })
    await expect(client.getMeta(1)).rejects.toMatchObject({ status: 404 })
  })
})

describe('API', () => {
  function setup(overrides: Record<string, unknown> = {}) {
    const upstream = fakeUpstream(overrides)
    const { app, library } = createApp({ dataDir, fetch: upstream.fetchImpl, songsterrIntervalMs: 0 })
    const call = async (method: string, url: string, body?: unknown) => {
      const init: RequestInit = { method }
      if (body instanceof Uint8Array) init.body = body as unknown as RequestInit['body']
      else if (body !== undefined) {
        init.body = JSON.stringify(body)
        init.headers = { 'Content-Type': 'application/json' }
      }
      const response = await app.request(url, init)
      return { status: response.status, response }
    }
    const json = async (method: string, url: string, body?: unknown) => {
      const { status, response } = await call(method, url, body)
      return { status, body: (await response.json()) as any }
    }
    return { ...upstream, library, call, json }
  }

  const LINK = 'https://www.songsterr.com/a/wsa/akira-yamaoka-promise-tab-s34008'

  it('imports a Songsterr song and serves it without further network requests', async () => {
    const api = setup()
    const imported = await api.json('POST', '/api/songsterr/import', { url: LINK })
    expect(imported.status).toBe(201)
    expect(imported.body).toMatchObject({
      source: 'songsterr',
      title: 'Promise',
      artist: 'Akira Yamaoka',
      songsterrId: 34008,
      revisionId: 7221665,
      trackCount: 2,
      defaultTrack: 1,
      sourceUrl: LINK,
      favorite: false,
    })
    const afterImport = api.requests.length
    expect(afterImport).toBe(3)

    const tracks = await api.json('GET', `/api/songs/${imported.body.id}/tracks`)
    expect(tracks.body.tracks).toHaveLength(2)
    expect(api.requests).toHaveLength(afterImport)
    api.library.close()
  })

  it('imports a pinned revision straight from the cache', async () => {
    const warm = setup()
    const first = (await warm.json('POST', '/api/songsterr/import', { url: LINK, revisionId: 6383873 })).body
    expect(first.revisionId).toBe(6383873)
    await warm.json('DELETE', `/api/songs/${first.id}`)
    warm.library.close()

    const cached = setup()
    const again = await cached.json('POST', '/api/songsterr/import', { url: LINK, revisionId: 6383873 })
    expect(again.status).toBe(201)
    expect(again.body.revisionId).toBe(6383873)
    expect(cached.requests).toHaveLength(0)
    cached.library.close()
  })

  it('does not import the same song twice', async () => {
    const api = setup()
    const first = await api.json('POST', '/api/songsterr/import', { url: LINK })
    const second = await api.json('POST', '/api/songsterr/import', { url: 'https://www.songsterr.com/a/wsa/wrong-words-tab-s34008' })
    expect(second.status).toBe(200)
    expect(second.body.id).toBe(first.body.id)
    expect((await api.json('GET', '/api/songs')).body).toHaveLength(1)
    api.library.close()
  })

  it('rejects links that are not songs, and restricted songs', async () => {
    const api = setup({ restriction: 'license' })
    expect((await api.json('POST', '/api/songsterr/import', { url: 'https://example.com' })).status).toBe(400)
    expect((await api.json('POST', '/api/songsterr/import', { url: LINK })).status).toBe(403)
    expect((await api.json('GET', '/api/songs')).body).toHaveLength(0)
    api.library.close()
  })

  it('stores uploads, serves them back and deletes them', async () => {
    const api = setup()
    const bytes = new Uint8Array([1, 2, 3, 250])
    const uploaded = await api.json('POST', `/api/songs/upload?name=${encodeURIComponent('..\\..\\My Song.GP5')}`, bytes)
    expect(uploaded.status).toBe(201)
    expect(uploaded.body).toMatchObject({ source: 'file', title: 'My Song', fileName: 'My Song.GP5' })

    const file = await api.call('GET', `/api/songs/${uploaded.body.id}/file`)
    expect(new Uint8Array(await file.response.arrayBuffer())).toEqual(bytes)

    expect((await api.json('POST', '/api/songs/upload?name=notes.exe', bytes)).status).toBe(400)
    expect((await api.json('POST', '/api/songs/upload?name=empty.gp', new Uint8Array())).status).toBe(400)

    expect((await api.json('DELETE', `/api/songs/${uploaded.body.id}`)).status).toBe(200)
    expect((await api.call('GET', `/api/songs/${uploaded.body.id}/file`)).status).toBe(404)
    api.library.close()
  })

  it('searches, favourites and orders by last opened', async () => {
    const api = setup()
    const promise = (await api.json('POST', '/api/songsterr/import', { url: LINK })).body
    const file = (await api.json('POST', '/api/songs/upload?name=Scales%20100%25.gp', new Uint8Array([1]))).body

    expect((await api.json('GET', '/api/songs?q=yamaoka')).body.map((song: any) => song.id)).toEqual([promise.id])
    expect((await api.json('GET', '/api/songs?q=100%25')).body.map((song: any) => song.id)).toEqual([file.id])
    expect((await api.json('GET', '/api/songs?q=%25')).body.map((song: any) => song.id)).toEqual([file.id])

    await api.json('PATCH', `/api/songs/${file.id}`, { favorite: true })
    expect((await api.json('GET', '/api/songs?favorite=1')).body.map((song: any) => song.id)).toEqual([file.id])

    await api.json('POST', `/api/songs/${promise.id}/open`)
    const ordered = (await api.json('GET', '/api/songs')).body
    expect(ordered.map((song: any) => song.id)).toEqual([promise.id, file.id])
    expect(ordered[0].lastOpenedAt).not.toBeNull()
    api.library.close()
  })

  it('keeps practice settings per song across restarts', async () => {
    const first = setup()
    const song = (await first.json('POST', '/api/songsterr/import', { url: LINK })).body
    const settings = { speed: 0.75, trackIndex: 1, loop: { startTick: 3840, endTick: 7680 }, countIn: true, metronome: false }
    expect((await first.json('PATCH', `/api/songs/${song.id}`, { settings })).body.settings).toEqual(settings)
    first.library.close()

    const second = setup()
    expect((await second.json('GET', `/api/songs/${song.id}`)).body.settings).toEqual(settings)
    second.library.close()
  })

  it('keeps an edited copy of a song and can drop it again', async () => {
    const api = setup()
    const song = (await api.json('POST', '/api/songsterr/import', { url: LINK })).body
    expect(song.edited).toBe(false)
    expect((await api.call('GET', `/api/songs/${song.id}/edited`)).status).toBe(404)

    const bytes = new Uint8Array([80, 75, 3, 4, 9, 9])
    const saved = await api.json('PUT', `/api/songs/${song.id}/edited`, bytes)
    expect(saved.body.edited).toBe(true)
    const read = await api.call('GET', `/api/songs/${song.id}/edited`)
    expect(new Uint8Array(await read.response.arrayBuffer())).toEqual(bytes)

    // Switching revision drops the edits made to the old one.
    const switched = await api.json('POST', `/api/songs/${song.id}/revision`, { revisionId: 6383873 })
    expect(switched.body.edited).toBe(false)
    await api.json('PUT', `/api/songs/${song.id}/edited`, bytes)
    expect((await api.json('DELETE', `/api/songs/${song.id}/edited`)).body.edited).toBe(false)
    expect((await api.call('GET', `/api/songs/${song.id}/edited`)).status).toBe(404)
    api.library.close()
  })

  it('lists revisions and switches to another one', async () => {
    const api = setup()
    const song = (await api.json('POST', '/api/songsterr/import', { url: LINK })).body
    const revisions = (await api.json('GET', `/api/songs/${song.id}/revisions`)).body
    expect(revisions.map((revision: any) => revision.revisionId)).toEqual([7221665, 6383873])
    expect(revisions[0]).toMatchObject({ author: 'someone', description: 'latest' })

    const switched = await api.json('POST', `/api/songs/${song.id}/revision`, { revisionId: 6383873 })
    expect(switched.body.revisionId).toBe(6383873)
    const tracks = (await api.json('GET', `/api/songs/${song.id}/tracks`)).body.tracks
    expect(tracks.every((track: any) => track.revisionId === 6383873)).toBe(true)
    api.library.close()
  })

  it('proxies search and answers 404 for unknown songs', async () => {
    const api = setup()
    expect((await api.json('GET', '/api/songsterr/search?q=promise')).body).toEqual([
      { songId: 34008, title: 'Promise', artist: 'Akira Yamaoka', trackCount: 2 },
    ])
    expect((await api.json('GET', '/api/songsterr/search?q=')).body).toEqual([])
    expect((await api.json('GET', '/api/songs/999')).status).toBe(404)
    expect((await api.json('GET', '/api/songs/abc')).status).toBe(404)
    api.library.close()
  })
})

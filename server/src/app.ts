import path from 'node:path'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { Library, type Song } from './db/library.ts'
import { parseSongId, SongsterrClient, SongsterrError, songUrl, type SongsterrMeta } from './songsterr/client.ts'

export interface AppOptions {
  /** Holds library.db, tabs/ and songsterr/. */
  dataDir: string
  fetch?: typeof fetch
  songsterrIntervalMs?: number
}

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

export function createApp(options: AppOptions) {
  const library = new Library(options.dataDir)
  const songsterr = new SongsterrClient({
    cacheDir: path.join(options.dataDir, 'songsterr'),
    fetch: options.fetch,
    minIntervalMs: options.songsterrIntervalMs,
  })
  const app = new Hono()

  app.onError((error, c) => {
    if (error instanceof SongsterrError) return c.json({ error: error.message }, error.status as 403 | 404 | 502)
    console.error(error)
    return c.json({ error: 'Internal server error.' }, 500)
  })

  const songFrom = (c: Context): Song | null => {
    const id = Number(c.req.param('id'))
    return Number.isInteger(id) ? library.get(id) : null
  }
  const notFound = (c: Context) => c.json({ error: 'Song not found.' }, 404)

  const metaInput = (meta: SongsterrMeta) => ({
    revisionId: meta.revisionId,
    revisionDate: meta.createdAt ?? null,
    trackCount: meta.tracks.length,
    defaultTrack: meta.defaultTrack,
  })

  app.get('/api/songs', (c) => {
    return c.json(library.list({ query: c.req.query('q'), favorite: c.req.query('favorite') === '1' }))
  })

  app.get('/api/songs/:id', (c) => {
    const song = songFrom(c)
    return song ? c.json(song) : notFound(c)
  })

  app.patch('/api/songs/:id', async (c) => {
    const song = songFrom(c)
    if (!song) return notFound(c)
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const changes: Parameters<Library['update']>[1] = {}
    if (typeof body.favorite === 'boolean') changes.favorite = body.favorite
    if (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
      changes.settings = body.settings as Record<string, unknown>
    }
    if (typeof body.title === 'string' && body.title.trim()) changes.title = body.title.trim()
    if (typeof body.artist === 'string') changes.artist = body.artist.trim()
    if (typeof body.trackCount === 'number' && Number.isInteger(body.trackCount)) changes.trackCount = body.trackCount
    return c.json(library.update(song.id, changes))
  })

  app.post('/api/songs/:id/open', (c) => {
    const song = songFrom(c)
    return song ? c.json(library.touch(song.id)) : notFound(c)
  })

  app.delete('/api/songs/:id', async (c) => {
    const song = songFrom(c)
    if (!song) return notFound(c)
    await library.remove(song.id)
    return c.json({ ok: true })
  })

  // Local tab file, to be parsed by alphaTab in the browser.
  app.get('/api/songs/:id/file', async (c) => {
    const song = songFrom(c)
    if (!song) return notFound(c)
    const bytes = await library.readFile(song)
    if (!bytes) return c.json({ error: 'This song has no file.' }, 404)
    return c.body(new Uint8Array(bytes).buffer, 200, { 'Content-Type': 'application/octet-stream' })
  })

  // The tab as changed in the editor (Guitar Pro 7). Saving replaces it; deleting goes back to the source.
  app.get('/api/songs/:id/edited', async (c) => {
    const song = songFrom(c)
    if (!song) return notFound(c)
    const bytes = await library.readEdited(song)
    if (!bytes) return c.json({ error: 'This song has not been edited.' }, 404)
    return c.body(new Uint8Array(bytes).buffer, 200, { 'Content-Type': 'application/octet-stream' })
  })

  app.put('/api/songs/:id/edited', async (c) => {
    const song = songFrom(c)
    if (!song) return notFound(c)
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.length === 0) return c.json({ error: 'The file is empty.' }, 400)
    if (bytes.length > MAX_UPLOAD_BYTES) return c.json({ error: 'The file is too large.' }, 413)
    return c.json(await library.saveEdited(song.id, bytes))
  })

  app.delete('/api/songs/:id/edited', async (c) => {
    const song = songFrom(c)
    if (!song) return notFound(c)
    return c.json(await library.discardEdited(song.id))
  })

  // Raw Songsterr track documents of the pinned revision, to be converted in the browser.
  app.get('/api/songs/:id/tracks', async (c) => {
    const song = songFrom(c)
    if (!song) return notFound(c)
    if (song.source !== 'songsterr' || song.songsterrId === null || song.revisionId === null) {
      return c.json({ error: 'This song did not come from Songsterr.' }, 400)
    }
    const meta = await songsterr.getMeta(song.songsterrId, song.revisionId)
    return c.json({ tracks: await songsterr.getAllTracks(meta) })
  })

  app.post('/api/songs/upload', async (c) => {
    const name = c.req.query('name') ?? ''
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.length === 0) return c.json({ error: 'The file is empty.' }, 400)
    if (bytes.length > MAX_UPLOAD_BYTES) return c.json({ error: 'The file is too large.' }, 413)
    try {
      return c.json(await library.addFile(name, bytes), 201)
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  app.post('/api/songsterr/import', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const songsterrId = parseSongId(String(body.url ?? body.songId ?? ''))
    if (songsterrId === null) return c.json({ error: 'That is not a Songsterr song link.' }, 400)
    const existing = library.findBySongsterrId(songsterrId)
    if (existing) return c.json(existing)

    // Without a revision the latest one is imported, which always asks Songsterr; a pinned revision that is
    // already cached needs no network at all.
    const revisionId = Number(body.revisionId)
    const meta = await songsterr.getMeta(songsterrId, Number.isInteger(revisionId) && revisionId > 0 ? revisionId : undefined)
    // Fetch everything now so opening the song later needs no network.
    await songsterr.getAllTracks(meta)
    const song = library.addSongsterr({
      songsterrId: meta.songId,
      title: meta.title,
      artist: meta.artist,
      sourceUrl: songUrl(meta),
      ...metaInput(meta),
    })
    return c.json(song, 201)
  })

  app.get('/api/songsterr/search', async (c) => {
    const query = (c.req.query('q') ?? '').trim()
    if (!query) return c.json([])
    return c.json(await songsterr.search(query))
  })

  app.get('/api/songs/:id/revisions', async (c) => {
    const song = songFrom(c)
    if (!song) return notFound(c)
    if (song.songsterrId === null) return c.json([])
    return c.json(await songsterr.getRevisions(song.songsterrId))
  })

  app.post('/api/songs/:id/revision', async (c) => {
    const song = songFrom(c)
    if (!song) return notFound(c)
    if (song.songsterrId === null) return c.json({ error: 'This song did not come from Songsterr.' }, 400)
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const revisionId = Number(body.revisionId)
    if (!Number.isInteger(revisionId) || revisionId <= 0) return c.json({ error: 'Invalid revision.' }, 400)
    const meta = await songsterr.getMeta(song.songsterrId, revisionId)
    await songsterr.getAllTracks(meta)
    await library.discardEdited(song.id)
    return c.json(library.setRevision(song.id, metaInput(meta)))
  })

  return { app, library }
}

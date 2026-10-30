import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { Library, type Song } from './db/library.ts'
import { parseSongId, SongsterrClient, SongsterrError, songUrl, type SongsterrMeta } from './songsterr/client.ts'
import { pythonRunner, StemError, StemStore, type SeparationRunner } from './stems.ts'

export interface AppOptions {
  /** Holds library.db, tabs/, songsterr/ and stems/. */
  dataDir: string
  fetch?: typeof fetch
  songsterrIntervalMs?: number
  /** Splits recordings into stems; by default the Python script, run by TABS_PYTHON with the model in TABS_SEPARATOR_MODELS. */
  separator?: SeparationRunner
}

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024
// A recording, decoded to 16-bit WAV by the page: about 10 MB a minute.
const MAX_RECORDING_BYTES = 400 * 1024 * 1024
// The Python environment next to the repository (E:\Code\.venv), which has audio-separator and PyTorch.
const DEFAULT_PYTHON = path.resolve(import.meta.dirname, '../../../.venv/Scripts/python.exe')

export function createApp(options: AppOptions) {
  const library = new Library(options.dataDir)
  const songsterr = new SongsterrClient({
    cacheDir: path.join(options.dataDir, 'songsterr'),
    fetch: options.fetch,
    minIntervalMs: options.songsterrIntervalMs,
  })
  const stems = new StemStore(
    options.dataDir,
    options.separator ??
      pythonRunner(process.env.TABS_PYTHON ?? DEFAULT_PYTHON, process.env.TABS_SEPARATOR_MODELS ?? path.join(options.dataDir, 'models', 'separator')),
  )
  const app = new Hono()

  app.onError((error, c) => {
    if (error instanceof SongsterrError) return c.json({ error: error.message }, error.status as 403 | 404 | 502)
    if (error instanceof StemError) return c.json({ error: error.message }, error.status)
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
      return c.json({ error: 'This song was not imported from a link.' }, 400)
    }
    const meta = await songsterr.getMeta(song.songsterrId, song.revisionId)
    return c.json({ tracks: await songsterr.getAllTracks(meta) })
  })

  // Stems: recordings split into vocals, drums, bass, guitar, piano and other (see stems.ts), on their own,
  // not tied to a song.
  app.get('/api/stems', async (c) => c.json(await stems.list()))

  app.get('/api/stems/devices', async (c) => c.json(await stems.devices()))

  app.post('/api/stems', async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.length === 0) return c.json({ error: 'The file is empty.' }, 400)
    if (bytes.length > MAX_RECORDING_BYTES) return c.json({ error: 'The recording is too long.' }, 413)
    const device = c.req.query('device') === 'cpu' ? 'cpu' : 'cuda'
    return c.json(await stems.start(c.req.query('name') ?? '', bytes, device), 202)
  })

  app.delete('/api/stems/:id', async (c) => {
    return (await stems.remove(c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'No such separation.' }, 404)
  })

  // One stem as FLAC. Answers byte ranges, so the page's audio player can seek without loading all of it.
  app.get('/api/stems/:id/:name', async (c) => {
    const file = await stems.stemFile(c.req.param('id'), c.req.param('name'))
    if (!file) return c.json({ error: 'No such stem.' }, 404)
    const size = (await stat(file)).size
    const headers: Record<string, string> = { 'Content-Type': 'audio/flac', 'Accept-Ranges': 'bytes' }
    let start = 0
    let end = size - 1
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('Range') ?? '')
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1])
        if (range[2]) end = Math.min(Number(range[2]), size - 1)
      } else {
        start = Math.max(size - Number(range[2]), 0)
      }
      if (start > end) return c.body(null, 416, { 'Content-Range': `bytes */${size}` })
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    }
    const bytes = new Uint8Array(end - start + 1)
    const handle = await open(file)
    try {
      await handle.read(bytes, 0, bytes.length, start)
    } finally {
      await handle.close()
    }
    return c.body(bytes.buffer, headers['Content-Range'] ? 206 : 200, headers)
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
    if (songsterrId === null) return c.json({ error: 'That is not a tab link that can be imported.' }, 400)
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
    if (song.songsterrId === null) return c.json({ error: 'This song was not imported from a link.' }, 400)
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const revisionId = Number(body.revisionId)
    if (!Number.isInteger(revisionId) || revisionId <= 0) return c.json({ error: 'Invalid revision.' }, 400)
    const meta = await songsterr.getMeta(song.songsterrId, revisionId)
    await songsterr.getAllTracks(meta)
    await library.discardEdited(song.id)
    return c.json(library.setRevision(song.id, metaInput(meta)))
  })

  return { app, library, stems }
}

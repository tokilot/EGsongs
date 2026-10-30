import type { Hono } from 'hono'
import type { Library } from '../db/library.ts'
import { parseSongId, songUrl, type SongsterrClient, type SongsterrMeta } from '../songs/client.ts'
import { songFrom, songNotFound } from './library.ts'

const metaInput = (meta: SongsterrMeta) => ({
  revisionId: meta.revisionId,
  revisionDate: meta.createdAt ?? null,
  trackCount: meta.tracks.length,
  defaultTrack: meta.defaultTrack,
})

/** Online tabs (Songsterr): search, import by link, their tracks and revisions, fetched once and cached. */
export function songRoutes(app: Hono, library: Library, songsterr: SongsterrClient) {
  // Raw Songsterr track documents of the pinned revision, to be converted in the browser.
  app.get('/api/songs/:id/tracks', async (c) => {
    const song = songFrom(library, c)
    if (!song) return songNotFound(c)
    if (song.source !== 'songsterr' || song.songsterrId === null || song.revisionId === null) {
      return c.json({ error: 'This song was not imported from a link.' }, 400)
    }
    const meta = await songsterr.getMeta(song.songsterrId, song.revisionId)
    return c.json({ tracks: await songsterr.getAllTracks(meta) })
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
    const song = songFrom(library, c)
    if (!song) return songNotFound(c)
    if (song.songsterrId === null) return c.json([])
    return c.json(await songsterr.getRevisions(song.songsterrId))
  })

  app.post('/api/songs/:id/revision', async (c) => {
    const song = songFrom(library, c)
    if (!song) return songNotFound(c)
    if (song.songsterrId === null) return c.json({ error: 'This song was not imported from a link.' }, 400)
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const revisionId = Number(body.revisionId)
    if (!Number.isInteger(revisionId) || revisionId <= 0) return c.json({ error: 'Invalid revision.' }, 400)
    const meta = await songsterr.getMeta(song.songsterrId, revisionId)
    await songsterr.getAllTracks(meta)
    await library.discardEdited(song.id)
    return c.json(library.setRevision(song.id, metaInput(meta)))
  })
}

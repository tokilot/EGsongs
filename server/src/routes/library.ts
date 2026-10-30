import type { Context, Hono } from 'hono'
import type { Library, Song } from '../db/library.ts'

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

/** The song named by the route's `:id`, or null. */
export function songFrom(library: Library, c: Context): Song | null {
  const id = Number(c.req.param('id'))
  return Number.isInteger(id) ? library.get(id) : null
}

export const songNotFound = (c: Context) => c.json({ error: 'Song not found.' }, 404)

/** The library of tabs: listing, practice settings, local files and their edited copies. */
export function libraryRoutes(app: Hono, library: Library) {
  const songOf = (c: Context) => songFrom(library, c)

  app.get('/api/songs', (c) => {
    return c.json(library.list({ query: c.req.query('q'), favorite: c.req.query('favorite') === '1' }))
  })

  app.get('/api/songs/:id', (c) => {
    const song = songOf(c)
    return song ? c.json(song) : songNotFound(c)
  })

  app.patch('/api/songs/:id', async (c) => {
    const song = songOf(c)
    if (!song) return songNotFound(c)
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
    const song = songOf(c)
    return song ? c.json(library.touch(song.id)) : songNotFound(c)
  })

  app.delete('/api/songs/:id', async (c) => {
    const song = songOf(c)
    if (!song) return songNotFound(c)
    await library.remove(song.id)
    return c.json({ ok: true })
  })

  // Local tab file, to be parsed by alphaTab in the browser.
  app.get('/api/songs/:id/file', async (c) => {
    const song = songOf(c)
    if (!song) return songNotFound(c)
    const bytes = await library.readFile(song)
    if (!bytes) return c.json({ error: 'This song has no file.' }, 404)
    return c.body(new Uint8Array(bytes).buffer, 200, { 'Content-Type': 'application/octet-stream' })
  })

  // The tab as changed in the editor (Guitar Pro 7). Saving replaces it; deleting goes back to the source.
  app.get('/api/songs/:id/edited', async (c) => {
    const song = songOf(c)
    if (!song) return songNotFound(c)
    const bytes = await library.readEdited(song)
    if (!bytes) return c.json({ error: 'This song has not been edited.' }, 404)
    return c.body(new Uint8Array(bytes).buffer, 200, { 'Content-Type': 'application/octet-stream' })
  })

  app.put('/api/songs/:id/edited', async (c) => {
    const song = songOf(c)
    if (!song) return songNotFound(c)
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.length === 0) return c.json({ error: 'The file is empty.' }, 400)
    if (bytes.length > MAX_UPLOAD_BYTES) return c.json({ error: 'The file is too large.' }, 413)
    return c.json(await library.saveEdited(song.id, bytes))
  })

  app.delete('/api/songs/:id/edited', async (c) => {
    const song = songOf(c)
    if (!song) return songNotFound(c)
    return c.json(await library.discardEdited(song.id))
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
}

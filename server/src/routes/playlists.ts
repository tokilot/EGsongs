import type { Hono } from 'hono'
import type { Playlists } from '../db/playlists.ts'

const notFound = { error: 'Playlist not found.' }

/** Playlists of favourite songs (see db/playlists.ts). */
export function playlistRoutes(app: Hono, playlists: Playlists) {
  const idOf = (param: string) => {
    const id = Number(param)
    return Number.isInteger(id) ? id : -1
  }
  const nameOf = (body: Record<string, unknown>) => (typeof body.name === 'string' && body.name.trim() ? body.name : null)

  app.get('/api/playlists', (c) => c.json(playlists.list()))

  app.post('/api/playlists', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const name = nameOf(body)
    if (!name) return c.json({ error: 'A playlist needs a name.' }, 400)
    return c.json(playlists.create(name))
  })

  // A new name and/or the songs in their new order.
  app.patch('/api/playlists/:id', async (c) => {
    const id = idOf(c.req.param('id'))
    if (!playlists.get(id)) return c.json(notFound, 404)
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const name = nameOf(body)
    if (name) playlists.rename(id, name)
    if (Array.isArray(body.songIds)) playlists.setSongs(id, body.songIds.filter((songId): songId is number => Number.isInteger(songId)))
    return c.json(playlists.get(id))
  })

  app.delete('/api/playlists/:id', (c) => {
    return playlists.remove(idOf(c.req.param('id'))) ? c.json({ ok: true }) : c.json(notFound, 404)
  })
}

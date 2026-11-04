import { stat } from 'node:fs/promises'
import type { Hono } from 'hono'
import type { SoundFonts } from '../soundFonts.ts'

/** The player's sample sets (see soundFonts.ts). */
export function soundFontRoutes(app: Hono, soundFonts: SoundFonts) {
  app.get('/api/soundfonts', (c) => c.json(soundFonts.list()))

  // Tens of megabytes: the browser keeps it and only asks whether it changed (by size, time and, for an extra set,
  // the bank it is served in).
  app.get('/api/soundfonts/:name', async (c) => {
    const name = c.req.param('name')
    const file = soundFonts.file(name)
    if (!file) return c.json({ error: 'No such sound font.' }, 404)
    const info = await stat(file)
    const bank = soundFonts.list().find((font) => font.name === name)?.bank
    const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}${bank === undefined ? '' : `-b${bank}`}"`
    const headers = { ETag: etag, 'Cache-Control': 'no-cache' }
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304, headers)
    const served = soundFonts.bytes(name)
    if (!served) return c.json({ error: 'No such sound font.' }, 404)
    return c.body(new Uint8Array(served.bytes).buffer, 200, { ...headers, 'Content-Type': 'application/octet-stream' })
  })
}

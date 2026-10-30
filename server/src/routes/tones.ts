import type { Hono } from 'hono'
import type { ToneFile } from '../tones.ts'

// A library is a few kilobytes per tone.
const MAX_LIBRARY_BYTES = 2 * 1024 * 1024

/** The guitar tone library, one for all songs (see tones.ts). */
export function toneRoutes(app: Hono, tones: ToneFile) {
  // Null before the library was ever saved here (the page then brings over what the browser had).
  app.get('/api/tones', (c) => c.json({ library: tones.read() }))

  app.put('/api/tones', async (c) => {
    const text = await c.req.text()
    if (text.length > MAX_LIBRARY_BYTES) return c.json({ error: 'The tone library is too large.' }, 413)
    let library: unknown
    try {
      library = JSON.parse(text)
    } catch {
      return c.json({ error: 'The tone library is not JSON.' }, 400)
    }
    if (!library || typeof library !== 'object' || Array.isArray(library)) return c.json({ error: 'The tone library must be an object.' }, 400)
    await tones.save(library)
    return c.json({ ok: true })
  })
}

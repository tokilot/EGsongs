import { open, stat } from 'node:fs/promises'
import type { Hono } from 'hono'
import type { StemStore } from '../stems.ts'

// A recording, decoded to 16-bit WAV by the page: about 10 MB a minute.
const MAX_RECORDING_BYTES = 400 * 1024 * 1024

/** Stems: recordings split into vocals, drums, bass, guitar, piano and other (see stems.ts), not tied to a song. */
export function stemRoutes(app: Hono, stems: StemStore) {
  app.get('/api/stems', async (c) => c.json(await stems.list()))

  app.get('/api/stems/devices', async (c) => c.json(await stems.devices()))

  app.get('/api/stems/models', (c) => c.json(stems.models()))

  app.post('/api/stems', async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.length === 0) return c.json({ error: 'The file is empty.' }, 400)
    if (bytes.length > MAX_RECORDING_BYTES) return c.json({ error: 'The recording is too long.' }, 413)
    const device = c.req.query('device') === 'cpu' ? 'cpu' : 'cuda'
    return c.json(await stems.start(c.req.query('name') ?? '', bytes, device, c.req.query('model') || undefined), 202)
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
}

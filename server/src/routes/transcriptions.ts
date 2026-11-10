import { readFile } from 'node:fs/promises'
import type { Hono } from 'hono'
import type { TranscriptionStore } from '../transcribe.ts'

// A recording, decoded to 16-bit WAV by the page: about 10 MB a minute (as for the stems).
const MAX_RECORDING_BYTES = 400 * 1024 * 1024

/** Audio to MIDI: recordings transcribed by MuScriptor (see transcribe.ts), not tied to a song. */
export function transcriptionRoutes(app: Hono, transcriptions: TranscriptionStore) {
  app.get('/api/transcriptions', async (c) => c.json(await transcriptions.list()))

  app.get('/api/transcriptions/models', (c) => c.json(transcriptions.models()))

  app.get('/api/transcriptions/beat-models', (c) => c.json(transcriptions.beatModels()))

  app.post('/api/transcriptions', async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.length === 0) return c.json({ error: 'The file is empty.' }, 400)
    if (bytes.length > MAX_RECORDING_BYTES) return c.json({ error: 'The recording is too long.' }, 413)
    const device = c.req.query('device') === 'cpu' ? 'cpu' : 'cuda'
    const bpm = c.req.query('bpm')
    const item = await transcriptions.start(
      c.req.query('name') ?? '',
      bytes,
      device,
      c.req.query('model') || undefined,
      c.req.query('instruments') || undefined,
      c.req.query('beat') || null,
      bpm === undefined ? undefined : Number(bpm),
    )
    return c.json(item, 202)
  })

  app.delete('/api/transcriptions/:id', async (c) => {
    return (await transcriptions.remove(c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'No such transcription.' }, 404)
  })

  app.get('/api/transcriptions/:id/midi', async (c) => {
    const file = await transcriptions.midiFile(c.req.param('id'))
    if (!file) return c.json({ error: 'No such MIDI file.' }, 404)
    return c.body(new Uint8Array(await readFile(file)).buffer, 200, { 'Content-Type': 'audio/midi' })
  })
}

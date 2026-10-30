import { existsSync, renameSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { Library } from './db/library.ts'
import { libraryRoutes } from './routes/library.ts'
import { songRoutes } from './routes/songs.ts'
import { stemRoutes } from './routes/stems.ts'
import { toneRoutes } from './routes/tones.ts'
import { SongsterrClient, SongsterrError } from './songs/client.ts'
import { pythonRunner, StemError, StemStore, type SeparationRunner } from './stems.ts'
import { ToneFile } from './tones.ts'

export interface AppOptions {
  /** Holds library.db, tabs/, songs/ (the online tabs' cache), stems/ and tones.json. */
  dataDir: string
  fetch?: typeof fetch
  songsterrIntervalMs?: number
  /** Splits recordings into stems; by default the Python script, run by TABS_PYTHON with the model in TABS_SEPARATOR_MODELS. */
  separator?: SeparationRunner
  /** Forget what was only browsed (songs that are not favorites, every separation): done when the server starts. */
  forgetHistory?: boolean
}

// The Python environment next to the repository (E:\Code\.venv), which has audio-separator and PyTorch.
const DEFAULT_PYTHON = path.resolve(import.meta.dirname, '../../../.venv/Scripts/python.exe')

/** Where the online tabs are cached: songs/, which was songsterr/ until 2026-10-30 (moved over on first start). */
function songCacheDir(dataDir: string) {
  const dir = path.join(dataDir, 'songs')
  const old = path.join(dataDir, 'songsterr')
  if (existsSync(old) && !existsSync(dir)) renameSync(old, dir)
  return dir
}

/** The three parts, each with its own routes: the tabs (library and online tabs), the stems, the guitar tones. */
export function createApp(options: AppOptions) {
  const library = new Library(options.dataDir)
  const songsterr = new SongsterrClient({
    cacheDir: songCacheDir(options.dataDir),
    fetch: options.fetch,
    minIntervalMs: options.songsterrIntervalMs,
  })
  const stems = new StemStore(
    options.dataDir,
    options.separator ??
      pythonRunner(process.env.TABS_PYTHON ?? DEFAULT_PYTHON, process.env.TABS_SEPARATOR_MODELS ?? path.join(options.dataDir, 'models', 'separator')),
  )
  const tones = new ToneFile(options.dataDir)
  const app = new Hono()

  app.onError((error, c) => {
    if (error instanceof SongsterrError) return c.json({ error: error.message }, error.status as 403 | 404 | 502)
    if (error instanceof StemError) return c.json({ error: error.message }, error.status)
    console.error(error)
    return c.json({ error: 'Internal server error.' }, 500)
  })

  libraryRoutes(app, library)
  songRoutes(app, library, songsterr)
  stemRoutes(app, stems)
  toneRoutes(app, tones)

  // The server waits for this before it takes requests (see index.ts).
  const ready = options.forgetHistory
    ? Promise.all([library.forgetBrowsing(), stems.clear()]).then(([songs, separations]) => ({ songs, separations }))
    : Promise.resolve({ songs: 0, separations: 0 })

  return { app, library, stems, ready }
}

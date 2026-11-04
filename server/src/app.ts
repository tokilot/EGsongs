import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { Library } from './db/library.ts'
import { Playlists } from './db/playlists.ts'
import { libraryRoutes } from './routes/library.ts'
import { playlistRoutes } from './routes/playlists.ts'
import { songRoutes } from './routes/songs.ts'
import { stemRoutes } from './routes/stems.ts'
import { toneRoutes } from './routes/tones.ts'
import { soundFontRoutes } from './routes/soundFonts.ts'
import { SongsterrClient, SongsterrError } from './songs/client.ts'
import { pythonRunner, StemError, StemStore, type SeparationRunner } from './stems.ts'
import { ToneStore } from './tones.ts'
import { openUserDb } from './db/userDb.ts'
import { SoundFonts } from './soundFonts.ts'

export interface AppOptions {
  /** Holds user.db (songs, settings, tab files, playlists and the tone library), songs/ (the online tabs' cache), soundfonts/, models/ and tmps/. */
  dataDir: string
  fetch?: typeof fetch
  songsterrIntervalMs?: number
  /** Splits recordings into stems; by default the Python script, run by TABS_PYTHON with the model in TABS_SEPARATOR_MODELS. */
  separator?: SeparationRunner
  /** Where the player's sample sets are; by default TABS_SOUNDFONTS, else data/soundfonts/. */
  soundFontDir?: string
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
  const userDb = openUserDb(options.dataDir)
  const library = new Library(userDb, options.dataDir)
  const playlists = new Playlists(userDb)
  const songsterr = new SongsterrClient({
    cacheDir: songCacheDir(options.dataDir),
    fetch: options.fetch,
    minIntervalMs: options.songsterrIntervalMs,
  })
  // data/tmps/: results that only last while the server runs (the separations). Emptied when the server starts.
  const tmpDir = path.join(options.dataDir, 'tmps')
  const stemDir = path.join(tmpDir, 'stems')
  // Until 2026-10-31 the separations were in data/stems/; they were never kept between runs either.
  rmSync(path.join(options.dataDir, 'stems'), { recursive: true, force: true })
  const separationsBefore = existsSync(stemDir) ? readdirSync(stemDir).filter((entry) => !entry.endsWith('.work')).length : 0
  if (options.forgetHistory) rmSync(tmpDir, { recursive: true, force: true })
  const stems = new StemStore(
    stemDir,
    options.separator ??
      pythonRunner(process.env.TABS_PYTHON ?? DEFAULT_PYTHON, process.env.TABS_SEPARATOR_MODELS ?? path.join(options.dataDir, 'models', 'separator')),
  )
  const tones = new ToneStore(userDb, options.dataDir)
  const soundFonts = new SoundFonts(options.soundFontDir ?? process.env.TABS_SOUNDFONTS ?? path.join(options.dataDir, 'soundfonts'))
  const app = new Hono()

  app.onError((error, c) => {
    if (error instanceof SongsterrError) return c.json({ error: error.message }, error.status as 403 | 404 | 502)
    if (error instanceof StemError) return c.json({ error: error.message }, error.status)
    console.error(error)
    return c.json({ error: 'Internal server error.' }, 500)
  })

  libraryRoutes(app, library, playlists)
  playlistRoutes(app, playlists)
  songRoutes(app, library, songsterr)
  stemRoutes(app, stems)
  toneRoutes(app, tones)
  soundFontRoutes(app, soundFonts)

  // The server waits for this before it takes requests (see index.ts).
  const ready = options.forgetHistory
    ? library.forgetBrowsing().then((songs) => ({ songs, separations: separationsBefore }))
    : Promise.resolve({ songs: 0, separations: 0 })

  return { app, library, stems, ready }
}

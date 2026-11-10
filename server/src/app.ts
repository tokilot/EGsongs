import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { Library } from './db/library.ts'
import { Playlists } from './db/playlists.ts'
import { libraryRoutes } from './routes/library.ts'
import { playlistRoutes } from './routes/playlists.ts'
import { songRoutes } from './routes/songs.ts'
import { stemRoutes } from './routes/stems.ts'
import { transcriptionRoutes } from './routes/transcriptions.ts'
import { toneRoutes } from './routes/tones.ts'
import { soundFontRoutes } from './routes/soundFonts.ts'
import { SongsterrClient, SongsterrError } from './songs/client.ts'
import { SongFolders } from './songs/songFolders.ts'
import { pythonRunner, StemError, StemStore, type SeparationRunner } from './stems.ts'
import { Exclusive } from './tasks.ts'
import { transcriptionRunner, TranscriptionStore, type TranscriptionRunner } from './transcribe.ts'
import { ToneStore } from './tones.ts'
import { openUserDb } from './db/userDb.ts'
import { SoundFonts } from './soundFonts.ts'

export interface AppOptions {
  /**
   * The user's own data: user.db (songs, settings, favourites' tabs, playlists, the tone library), songs/ (the tabs of
   * the other songs), soundfonts/ and models/ (put there by hand), tmps/. Made, with those folders, when missing.
   */
  dataDir: string
  fetch?: typeof fetch
  songsterrIntervalMs?: number
  /** Splits recordings into stems; by default the Python script, run by TABS_PYTHON with the model in TABS_SEPARATOR_MODELS. */
  separator?: SeparationRunner
  /** Transcribes recordings to MIDI; by default the Python script, with the models in TABS_TRANSCRIBER_MODELS. */
  transcriber?: TranscriptionRunner
  /** Where the user's sample sets are; by default TABS_SOUNDFONTS, else data/soundfonts/ (the app's own are in resources/soundfonts/). */
  soundFontDir?: string
  /** What comes with the app; by default the repository's resources/ (tests use their own). */
  resourcesDir?: string
  /** The tabs put in a new library on its first start; by default TABS_DEMO_SONGS, else resources/songs/demo/. */
  demoSongsDir?: string
  /**
   * What the server does when it starts: put the library's tabs where they belong, drop the songs whose tab is gone
   * from data/songs/, and empty data/tmps/ (separations, transcriptions). Not in the tests that make apps over and over.
   */
  atStartup?: boolean
}

// The Python environment next to the repository (E:\Code\.venv), which has audio-separator, MuScriptor and PyTorch.
const DEFAULT_PYTHON = path.resolve(import.meta.dirname, '../../../.venv/Scripts/python.exe')

/** What comes with the app (2026-11-11), apart from the user's data: the main sample set, the demo tab. */
export const RESOURCES_DIR = path.resolve(import.meta.dirname, '../../resources')

/** Where the online tabs are cached: songs/, which was songsterr/ until 2026-10-30 (moved over on first start). */
function songCacheDir(dataDir: string) {
  const dir = path.join(dataDir, 'songs')
  const old = path.join(dataDir, 'songsterr')
  if (existsSync(old) && !existsSync(dir)) renameSync(old, dir)
  return dir
}

/** The three parts, each with its own routes: the tabs (library and online tabs), the stems and MIDI transcriptions, the guitar tones. */
export function createApp(options: AppOptions) {
  const separatorModels = process.env.TABS_SEPARATOR_MODELS ?? path.join(options.dataDir, 'models', 'separator')
  const transcriberModels = process.env.TABS_TRANSCRIBER_MODELS ?? path.join(options.dataDir, 'models', 'transcriber')
  const userSoundFonts = options.soundFontDir ?? process.env.TABS_SOUNDFONTS ?? path.join(options.dataDir, 'soundfonts')
  // The data folder and the folders the user fills by hand, there from the first start on (2026-11-11), so it is
  // clear where things go; user.db is made by openUserDb, songs/ and tmps/ as they are needed.
  for (const dir of [options.dataDir, userSoundFonts, separatorModels, transcriberModels]) {
    mkdirSync(dir, { recursive: true })
  }
  const userDb = openUserDb(options.dataDir)
  // data/songs/: numbered folders, shared by the online cache and the uploaded songs that are not favourites.
  const songDir = songCacheDir(options.dataDir)
  const songsterr = new SongsterrClient({
    cacheDir: songDir,
    fetch: options.fetch,
    minIntervalMs: options.songsterrIntervalMs,
  })
  const library = new Library(userDb, options.dataDir, new SongFolders(songDir), songsterr)
  const playlists = new Playlists(userDb)
  // data/tmps/: results that only last while the server runs (separations, transcriptions). Emptied when the server starts.
  const tmpDir = path.join(options.dataDir, 'tmps')
  const stemDir = path.join(tmpDir, 'stems')
  // Until 2026-10-31 the separations were in data/stems/; they were never kept between runs either.
  rmSync(path.join(options.dataDir, 'stems'), { recursive: true, force: true })
  const separationsBefore = existsSync(stemDir) ? readdirSync(stemDir).filter((entry) => !entry.endsWith('.work')).length : 0
  if (options.atStartup) rmSync(tmpDir, { recursive: true, force: true })
  const python = process.env.TABS_PYTHON ?? DEFAULT_PYTHON
  // Separating and transcribing both take the whole graphics card: one job at a time between them.
  const lock = new Exclusive()
  const stems = new StemStore(
    stemDir,
    options.separator ?? pythonRunner(python, separatorModels),
    lock,
  )
  const transcriptions = new TranscriptionStore(
    path.join(tmpDir, 'transcriptions'),
    options.transcriber ?? transcriptionRunner(python, transcriberModels),
    lock,
  )
  const tones = new ToneStore(userDb, options.dataDir)
  const soundFonts = new SoundFonts([userSoundFonts, path.join(options.resourcesDir ?? RESOURCES_DIR, 'soundfonts')])
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
  transcriptionRoutes(app, transcriptions)
  toneRoutes(app, tones)
  soundFontRoutes(app, soundFonts)

  // The server waits for this before it takes requests (see index.ts).
  const ready = options.atStartup
    ? (async () => {
        const moved = await library.bringIntoPlace()
        const dropped = await library.dropMissing()
        const demos = await library.addDemos(options.demoSongsDir ?? process.env.TABS_DEMO_SONGS ?? path.join(options.resourcesDir ?? RESOURCES_DIR, 'songs', 'demo'))
        return { renumbered: songsterr.renumbered, moved, dropped, demos, separations: separationsBefore }
      })()
    : Promise.resolve({ renumbered: songsterr.renumbered, moved: 0, dropped: 0, demos: 0, separations: 0 })

  return { app, library, stems, ready }
}

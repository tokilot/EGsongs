import { mkdirSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type SongSource = 'songsterr' | 'file'

/** Per-song practice settings; the web app owns the shape, the server only stores it. */
export type SongSettings = Record<string, unknown>

export interface Song {
  id: number
  source: SongSource
  title: string
  artist: string
  sourceUrl: string | null
  songsterrId: number | null
  revisionId: number | null
  revisionDate: string | null
  fileName: string | null
  trackCount: number
  defaultTrack: number
  favorite: boolean
  /** The tab has been changed in the editor; the edited copy is loaded instead of the source. */
  edited: boolean
  settings: SongSettings
  createdAt: string
  lastOpenedAt: string | null
}

export interface SongsterrSongInput {
  songsterrId: number
  revisionId: number
  revisionDate: string | null
  title: string
  artist: string
  sourceUrl: string
  trackCount: number
  defaultTrack: number
}

export interface ListOptions {
  query?: string
  favorite?: boolean
}

interface SongRow {
  id: number
  source: SongSource
  title: string
  artist: string
  source_url: string | null
  songsterr_id: number | null
  revision_id: number | null
  revision_date: string | null
  file_name: string | null
  track_count: number
  default_track: number
  favorite: number
  edited: number
  settings: string
  created_at: string
  last_opened_at: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  source_url TEXT,
  songsterr_id INTEGER UNIQUE,
  revision_id INTEGER,
  revision_date TEXT,
  file_name TEXT,
  track_count INTEGER NOT NULL DEFAULT 0,
  default_track INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  last_opened_at TEXT
);
`

/** Formats alphaTab can open directly. */
export const TAB_EXTENSIONS = ['gp', 'gp3', 'gp4', 'gp5', 'gpx', 'xml', 'musicxml', 'mxl', 'atex', 'alphatex']

function toSong(row: SongRow): Song {
  let settings: SongSettings = {}
  try {
    settings = JSON.parse(row.settings) as SongSettings
  } catch {
    // A corrupt settings blob only costs the saved practice state.
  }
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    artist: row.artist,
    sourceUrl: row.source_url,
    songsterrId: row.songsterr_id,
    revisionId: row.revision_id,
    revisionDate: row.revision_date,
    fileName: row.file_name,
    trackCount: row.track_count,
    defaultTrack: row.default_track,
    favorite: row.favorite === 1,
    edited: row.edited === 1,
    settings,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
  }
}

export class Library {
  private readonly db: DatabaseSync
  private readonly tabsDir: string

  constructor(dataDir: string) {
    this.tabsDir = path.join(dataDir, 'tabs')
    mkdirSync(this.tabsDir, { recursive: true })
    this.db = new DatabaseSync(path.join(dataDir, 'library.db'))
    this.db.exec(SCHEMA)
    // Added after the first release; older libraries get the column on first start.
    const columns = this.db.prepare('PRAGMA table_info(songs)').all() as unknown as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'edited')) this.db.exec('ALTER TABLE songs ADD COLUMN edited INTEGER NOT NULL DEFAULT 0')
  }

  /** The tab as changed in the editor (a Guitar Pro 7 file), or null when it has not been edited. */
  async readEdited(song: Song): Promise<Uint8Array | null> {
    if (!song.edited) return null
    try {
      return await readFile(this.editedPath(song.id))
    } catch {
      return null
    }
  }

  async saveEdited(id: number, bytes: Uint8Array): Promise<Song | null> {
    if (!this.get(id)) return null
    await writeFile(this.editedPath(id), bytes)
    this.db.prepare('UPDATE songs SET edited = 1 WHERE id = ?').run(id)
    return this.get(id)
  }

  /** Back to the tab as imported. */
  async discardEdited(id: number): Promise<Song | null> {
    await rm(this.editedPath(id), { force: true })
    this.db.prepare('UPDATE songs SET edited = 0 WHERE id = ?').run(id)
    return this.get(id)
  }

  private editedPath(id: number): string {
    return path.join(this.tabsDir, `${id}.edited.gp`)
  }

  close() {
    this.db.close()
  }

  /** Most recently opened first, then newest. */
  list(options: ListOptions = {}): Song[] {
    const where: string[] = []
    const params: Array<string | number> = []
    const query = options.query?.trim()
    if (query) {
      where.push("(title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\')")
      const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`
      params.push(pattern, pattern)
    }
    if (options.favorite) where.push('favorite = 1')
    const sql = `SELECT * FROM songs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY last_opened_at IS NULL, last_opened_at DESC, created_at DESC, id DESC`
    return (this.db.prepare(sql).all(...params) as unknown as SongRow[]).map(toSong)
  }

  get(id: number): Song | null {
    const row = this.db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as unknown as SongRow | undefined
    return row ? toSong(row) : null
  }

  findBySongsterrId(songsterrId: number): Song | null {
    const row = this.db.prepare('SELECT * FROM songs WHERE songsterr_id = ?').get(songsterrId) as unknown as SongRow | undefined
    return row ? toSong(row) : null
  }

  addSongsterr(input: SongsterrSongInput): Song {
    const result = this.db
      .prepare(
        `INSERT INTO songs (source, title, artist, source_url, songsterr_id, revision_id, revision_date, track_count, default_track, created_at)
         VALUES ('songsterr', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.title,
        input.artist,
        input.sourceUrl,
        input.songsterrId,
        input.revisionId,
        input.revisionDate,
        input.trackCount,
        input.defaultTrack,
        new Date().toISOString(),
      )
    return this.get(Number(result.lastInsertRowid))!
  }

  /** Points a Songsterr song at another revision of itself. */
  setRevision(id: number, input: Pick<SongsterrSongInput, 'revisionId' | 'revisionDate' | 'trackCount' | 'defaultTrack'>): Song | null {
    this.db
      .prepare('UPDATE songs SET revision_id = ?, revision_date = ?, track_count = ?, default_track = ? WHERE id = ?')
      .run(input.revisionId, input.revisionDate, input.trackCount, input.defaultTrack, id)
    return this.get(id)
  }

  async addFile(originalName: string, bytes: Uint8Array): Promise<Song> {
    const baseName = path.basename(originalName.replace(/\\/g, '/'))
    const extension = path.extname(baseName).slice(1).toLowerCase()
    if (!TAB_EXTENSIONS.includes(extension)) {
      throw new Error(`Unsupported file type ".${extension}". Supported: ${TAB_EXTENSIONS.join(', ')}.`)
    }
    const title = path.basename(baseName, path.extname(baseName)).trim() || 'Untitled'
    const result = this.db
      .prepare("INSERT INTO songs (source, title, artist, file_name, created_at) VALUES ('file', ?, '', ?, ?)")
      .run(title, baseName, new Date().toISOString())
    const id = Number(result.lastInsertRowid)
    await writeFile(this.filePath(id, extension), bytes)
    return this.get(id)!
  }

  async readFile(song: Song): Promise<Uint8Array | null> {
    if (song.source !== 'file' || !song.fileName) return null
    try {
      return await readFile(this.filePath(song.id, path.extname(song.fileName).slice(1).toLowerCase()))
    } catch {
      return null
    }
  }

  update(id: number, changes: { favorite?: boolean; settings?: SongSettings; title?: string; artist?: string; trackCount?: number }): Song | null {
    const sets: string[] = []
    const params: Array<string | number> = []
    if (changes.favorite !== undefined) {
      sets.push('favorite = ?')
      params.push(changes.favorite ? 1 : 0)
    }
    if (changes.settings !== undefined) {
      sets.push('settings = ?')
      params.push(JSON.stringify(changes.settings))
    }
    if (changes.title !== undefined) {
      sets.push('title = ?')
      params.push(changes.title)
    }
    if (changes.artist !== undefined) {
      sets.push('artist = ?')
      params.push(changes.artist)
    }
    if (changes.trackCount !== undefined) {
      sets.push('track_count = ?')
      params.push(changes.trackCount)
    }
    if (sets.length > 0) this.db.prepare(`UPDATE songs SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
    return this.get(id)
  }

  /** Marks the song as opened now, which moves it to the top of the list. */
  touch(id: number): Song | null {
    this.db.prepare('UPDATE songs SET last_opened_at = ? WHERE id = ?').run(new Date().toISOString(), id)
    return this.get(id)
  }

  async remove(id: number): Promise<boolean> {
    const song = this.get(id)
    if (!song) return false
    this.db.prepare('DELETE FROM songs WHERE id = ?').run(id)
    await rm(this.editedPath(id), { force: true })
    if (song.source === 'file' && song.fileName) {
      await rm(this.filePath(id, path.extname(song.fileName).slice(1).toLowerCase()), { force: true })
    }
    return true
  }

  /**
   * Forgets what was only browsed: every song that is not a favorite goes (with its file, edited copy and practice
   * settings), and no song keeps a "last opened" time. Run when the server starts (user's choice, 2026-10-31).
   */
  async forgetBrowsing(): Promise<number> {
    const passing = (this.db.prepare('SELECT id FROM songs WHERE favorite = 0').all() as unknown as Array<{ id: number }>).map((row) => row.id)
    for (const id of passing) await this.remove(id)
    this.db.exec('UPDATE songs SET last_opened_at = NULL')
    return passing.length
  }

  // Files are stored under the song id so user-supplied names never reach the file system.
  private filePath(id: number, extension: string): string {
    return path.join(this.tabsDir, `${id}.${extension}`)
  }
}

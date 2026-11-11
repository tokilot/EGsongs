import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { CachedRevision } from '../songs/client.ts'
import type { SongFolders } from '../songs/songFolders.ts'

import type { Song, SongSettings, SongSource } from '../../../contracts/library.ts'

/** The songs as the page sees them, defined with it in contracts/library.ts. */
export type { Song, SongSettings, SongSource } from '../../../contracts/library.ts'

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
  folder: string | null
  track_count: number
  default_track: number
  favorite: number
  edited: number
  settings: string
  created_at: string
  last_opened_at: string | null
}

/**
 * A favourite's tab content in user.db: what was uploaded, the online revision (its meta and tracks, as JSON), or
 * the copy changed in the editor (Guitar Pro 7).
 */
type FileKind = 'source' | 'online' | 'edited'

/** The tab changed in the editor, next to the content of a song that is not a favourite. */
const EDITED_FILE = 'edited.gp'

/** The online cache (songs/client.ts), where the tabs of songs imported by link are, unless they are favourites. */
export interface OnlineCache {
  cached(songId: number, revisionId: number): Promise<CachedRevision | null>
  store(revision: CachedRevision): Promise<void>
  /** The folder a revision is cached in, or null when it is not cached. */
  cacheFolder(songId: number, revisionId: number): string | null
}

const FILES_SCHEMA = `
CREATE TABLE IF NOT EXISTS song_files (
  song_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (song_id, kind)
)`

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

/**
 * The library: every song's details and practice settings in data/user.db. Where its tab is depends on whether it is
 * a favourite (user's choice, 2026-11-10): a favourite's tab (uploaded file, online revision, edited copy) is kept in
 * user.db; any other song's is only in data/songs/ (its own numbered folder for an uploaded file, the online cache
 * for a link), so it goes when that folder does. Starring and unstarring move it.
 */
export class Library {
  private readonly db: DatabaseSync
  private readonly folders: SongFolders
  private readonly online: OnlineCache
  private readonly dataDir: string

  /** `db`: data/user.db (openUserDb), which it closes with close(). `folders`: data/songs/. */
  constructor(db: DatabaseSync, dataDir: string, folders: SongFolders, online: OnlineCache) {
    this.db = db
    this.dataDir = dataDir
    this.folders = folders
    this.online = online
    this.db.exec(SCHEMA)
    this.db.exec(FILES_SCHEMA)
    // Added after the first release; older libraries get the columns on first start.
    const columns = this.db.prepare('PRAGMA table_info(songs)').all() as unknown as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'edited')) this.db.exec('ALTER TABLE songs ADD COLUMN edited INTEGER NOT NULL DEFAULT 0')
    if (!columns.some((column) => column.name === 'folder')) this.db.exec('ALTER TABLE songs ADD COLUMN folder TEXT')
    this.bringInTabFiles(path.join(dataDir, 'tabs'))
  }

  // Until 2026-10-31 the files were kept in data/tabs/ ({id}.{extension}, {id}.edited.gp): taken in once, then gone.
  private bringInTabFiles(dir: string) {
    if (!existsSync(dir)) return
    const rows = this.db.prepare('SELECT * FROM songs').all() as unknown as SongRow[]
    for (const song of rows.map(toSong)) {
      const take = (name: string, kind: 'source' | 'edited') => {
        const old = path.join(dir, name)
        if (existsSync(old)) this.place(song, kind, new Uint8Array(readFileSync(old)))
      }
      if (song.source === 'file' && song.fileName) take(`${song.id}.${extensionOf(song.fileName)}`, 'source')
      if (song.edited) take(`${song.id}.edited.gp`, 'edited')
    }
    rmSync(dir, { recursive: true, force: true })
  }

  /** Puts one of a song's files where it belongs now: user.db for a favourite, else its folder in data/songs/. */
  private place(song: Song, kind: 'source' | 'edited', bytes: Uint8Array) {
    if (song.favorite) return this.putFile(song.id, kind, bytes)
    let folder = this.contentFolder(song)
    if (!folder && song.source === 'file' && song.fileName) {
      const made = this.folders.create({ kind: 'file', fileName: song.fileName })
      this.db.prepare('UPDATE songs SET folder = ? WHERE id = ?').run(made, song.id)
      folder = this.folders.path(made)
    }
    // An online song's edited copy with its revision not cached: kept in user.db rather than lost.
    if (!folder) return this.putFile(song.id, kind, bytes)
    writeFileSync(path.join(folder, kind === 'edited' ? EDITED_FILE : song.fileName!), bytes)
    this.dropFile(song.id, kind)
  }

  private putFile(id: number, kind: FileKind, bytes: Uint8Array) {
    this.db.prepare('INSERT OR REPLACE INTO song_files (song_id, kind, bytes) VALUES (?, ?, ?)').run(id, kind, bytes)
  }

  private getFile(id: number, kind: FileKind): Uint8Array | null {
    const row = this.db.prepare('SELECT bytes FROM song_files WHERE song_id = ? AND kind = ?').get(id, kind) as { bytes: Uint8Array } | undefined
    return row ? new Uint8Array(row.bytes) : null
  }

  private dropFile(id: number, kind: FileKind) {
    this.db.prepare('DELETE FROM song_files WHERE song_id = ? AND kind = ?').run(id, kind)
  }

  /** Where a song that is not a favourite has its tab: its own folder (uploaded) or its revision's cache folder (link). */
  private contentFolder(song: Song & { folder?: string | null }): string | null {
    if (song.source === 'file') {
      const folder = this.folderOf(song.id)
      return folder ? this.folders.path(folder) : null
    }
    return song.songsterrId !== null && song.revisionId !== null ? this.online.cacheFolder(song.songsterrId, song.revisionId) : null
  }

  private folderOf(id: number): string | null {
    const row = this.db.prepare('SELECT folder FROM songs WHERE id = ?').get(id) as { folder: string | null } | undefined
    return row?.folder ?? null
  }

  /**
   * Puts what was kept the old way where it now belongs (2026-11-10), after a copy of user.db: the files of uploaded
   * songs that are not favourites go to their folders, the online tabs of favourites into user.db. Run when the
   * server starts; returns how many songs moved.
   */
  async bringIntoPlace(): Promise<number> {
    const rows = (this.db.prepare('SELECT * FROM songs').all() as unknown as SongRow[]).map((row) => ({ ...toSong(row), folder: row.folder }))
    const has = (id: number, kind: FileKind) => this.db.prepare('SELECT 1 FROM song_files WHERE song_id = ? AND kind = ?').get(id, kind) !== undefined
    const moving = rows.filter((song) =>
      song.favorite ? song.source === 'songsterr' && !has(song.id, 'online') : has(song.id, 'source') || has(song.id, 'edited'),
    )
    if (moving.length === 0) return 0
    const backup = path.join(this.dataDir, `user.db.before-2026-11-10.bak`)
    if (!existsSync(backup)) this.db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`)
    let moved = 0
    for (const song of moving) {
      if (song.favorite) {
        const revision = song.songsterrId !== null && song.revisionId !== null ? await this.online.cached(song.songsterrId, song.revisionId) : null
        if (!revision) continue
        this.putFile(song.id, 'online', new TextEncoder().encode(JSON.stringify(revision)))
      } else {
        await this.moveOut(song)
      }
      moved++
    }
    return moved
  }

  /** The tab as changed in the editor (a Guitar Pro 7 file), or null when it has not been edited. */
  async readEdited(song: Song): Promise<Uint8Array | null> {
    if (!song.edited) return null
    const folder = song.favorite ? null : this.contentFolder(song)
    if (folder && existsSync(path.join(folder, EDITED_FILE))) return new Uint8Array(readFileSync(path.join(folder, EDITED_FILE)))
    return this.getFile(song.id, 'edited')
  }

  async saveEdited(id: number, bytes: Uint8Array): Promise<Song | null> {
    const song = this.get(id)
    if (!song) return null
    const folder = song.favorite ? null : this.contentFolder(song)
    if (folder) {
      writeFileSync(path.join(folder, EDITED_FILE), bytes)
      this.dropFile(id, 'edited')
    } else {
      // A favourite's, or (should its folder be gone) kept with the song rather than lost.
      this.putFile(id, 'edited', bytes)
    }
    this.db.prepare('UPDATE songs SET edited = 1 WHERE id = ?').run(id)
    return this.get(id)
  }

  /** Back to the tab as imported. */
  async discardEdited(id: number): Promise<Song | null> {
    const song = this.get(id)
    if (!song) return null
    this.dropFile(id, 'edited')
    const folder = this.contentFolder(song)
    if (folder) rmSync(path.join(folder, EDITED_FILE), { force: true })
    this.db.prepare('UPDATE songs SET edited = 0 WHERE id = ?').run(id)
    return this.get(id)
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

  /** A song imported by link; its tab stays in the online cache until it is starred. */
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

  /** Points a Songsterr song at another revision of itself (already cached); a favourite keeps the new one in user.db. */
  async setRevision(id: number, input: Pick<SongsterrSongInput, 'revisionId' | 'revisionDate' | 'trackCount' | 'defaultTrack'>): Promise<Song | null> {
    this.db
      .prepare('UPDATE songs SET revision_id = ?, revision_date = ?, track_count = ?, default_track = ? WHERE id = ?')
      .run(input.revisionId, input.revisionDate, input.trackCount, input.defaultTrack, id)
    const song = this.get(id)
    if (song?.favorite && song.songsterrId !== null) {
      const revision = await this.online.cached(song.songsterrId, input.revisionId)
      if (revision) this.putFile(id, 'online', new TextEncoder().encode(JSON.stringify(revision)))
    }
    return song
  }

  /** An uploaded tab, in a new numbered folder of data/songs/ until it is starred. */
  async addFile(originalName: string, bytes: Uint8Array): Promise<Song> {
    const baseName = path.basename(originalName.replace(/\\/g, '/'))
    const extension = extensionOf(baseName)
    if (!TAB_EXTENSIONS.includes(extension)) {
      throw new Error(`Unsupported file type ".${extension}". Supported: ${TAB_EXTENSIONS.join(', ')}.`)
    }
    const title = path.basename(baseName, path.extname(baseName)).trim() || 'Untitled'
    const folder = this.folders.create({ kind: 'file', fileName: baseName })
    writeFileSync(this.folders.path(folder, baseName), bytes)
    const result = this.db
      .prepare("INSERT INTO songs (source, title, artist, file_name, folder, created_at) VALUES ('file', ?, '', ?, ?, ?)")
      .run(title, baseName, folder, new Date().toISOString())
    return this.get(Number(result.lastInsertRowid))!
  }

  /** The uploaded tab file, or null (songs imported by link have none: see readOnline). */
  async readFile(song: Song): Promise<Uint8Array | null> {
    if (song.source !== 'file') return null
    if (song.favorite) return this.getFile(song.id, 'source')
    const folder = this.contentFolder(song)
    const file = folder && song.fileName ? path.join(folder, song.fileName) : null
    return file && existsSync(file) ? new Uint8Array(readFileSync(file)) : null
  }

  /** A favourite's online revision as kept in user.db, or null (any other song: the online cache). */
  readOnline(song: Song): CachedRevision | null {
    if (!song.favorite || song.source !== 'songsterr') return null
    const bytes = this.getFile(song.id, 'online')
    return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as CachedRevision) : null
  }

  async update(id: number, changes: { favorite?: boolean; settings?: SongSettings; title?: string; artist?: string; trackCount?: number }): Promise<Song | null> {
    const song = this.get(id)
    if (!song) return null
    if (changes.favorite !== undefined && changes.favorite !== song.favorite) {
      if (changes.favorite) await this.moveIn(song)
      else await this.moveOut(song)
    }
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

  /** Starred: the tab (and its edited copy) from data/songs/ into user.db; an uploaded song's folder goes. */
  private async moveIn(song: Song) {
    const folder = this.contentFolder(song)
    if (song.source === 'file') {
      const bytes = await this.readFile(song)
      if (bytes) this.putFile(song.id, 'source', bytes)
    } else if (song.songsterrId !== null && song.revisionId !== null) {
      const revision = await this.online.cached(song.songsterrId, song.revisionId)
      if (revision) this.putFile(song.id, 'online', new TextEncoder().encode(JSON.stringify(revision)))
    }
    const edited = folder ? path.join(folder, EDITED_FILE) : null
    if (edited && existsSync(edited)) {
      this.putFile(song.id, 'edited', new Uint8Array(readFileSync(edited)))
      rmSync(edited, { force: true })
    }
    if (song.source === 'file') {
      const own = this.folderOf(song.id)
      if (own) this.folders.remove(own)
      this.db.prepare('UPDATE songs SET folder = NULL WHERE id = ?').run(song.id)
    }
  }

  /** Unstarred (or moved the new way): the tab and its edited copy from user.db into data/songs/. */
  private async moveOut(song: Song) {
    let folder: string | null = null
    if (song.source === 'file') {
      const bytes = this.getFile(song.id, 'source')
      if (bytes && song.fileName) {
        const made = this.folders.create({ kind: 'file', fileName: song.fileName })
        writeFileSync(this.folders.path(made, song.fileName), bytes)
        this.db.prepare('UPDATE songs SET folder = ? WHERE id = ?').run(made, song.id)
        folder = this.folders.path(made)
      }
      this.dropFile(song.id, 'source')
    } else if (song.songsterrId !== null && song.revisionId !== null) {
      const kept = this.readOnline({ ...song, favorite: true })
      if (kept && !(await this.online.cached(song.songsterrId, song.revisionId))) await this.online.store(kept)
      this.dropFile(song.id, 'online')
      folder = this.online.cacheFolder(song.songsterrId, song.revisionId)
    }
    const edited = this.getFile(song.id, 'edited')
    if (edited && folder) {
      writeFileSync(path.join(folder, EDITED_FILE), edited)
      this.dropFile(song.id, 'edited')
    }
  }

  /** Marks the song as opened now, which moves it to the top of the list. */
  touch(id: number): Song | null {
    this.db.prepare('UPDATE songs SET last_opened_at = ? WHERE id = ?').run(new Date().toISOString(), id)
    return this.get(id)
  }

  /** Deletes a song: its row, what user.db keeps of it, and its own folder (the online cache stays a cache). */
  async remove(id: number): Promise<boolean> {
    const song = this.get(id)
    if (!song) return false
    const own = song.source === 'file' ? this.folderOf(id) : null
    const cache = song.source === 'songsterr' && !song.favorite ? this.contentFolder(song) : null
    this.db.prepare('DELETE FROM songs WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM song_files WHERE song_id = ?').run(id)
    if (own) this.folders.remove(own)
    if (cache) rmSync(path.join(cache, EDITED_FILE), { force: true })
    return true
  }

  /**
   * The tabs that come with the app (resources/songs/demo/, 2026-11-11), put in a library that has never had a song,
   * as favourites: on the first start only, so one the user deletes does not come back. Returns how many came in.
   */
  async addDemos(dir: string): Promise<number> {
    const sequence = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'").get()
    const used = sequence && this.db.prepare("SELECT 1 FROM sqlite_sequence WHERE name = 'songs'").get()
    if (used || !existsSync(dir)) return 0
    const files = readdirSync(dir).filter((name) => TAB_EXTENSIONS.includes(extensionOf(name))).sort((a, b) => a.localeCompare(b))
    for (const name of files) {
      const song = await this.addFile(name, new Uint8Array(readFileSync(path.join(dir, name))))
      await this.update(song.id, { favorite: true })
    }
    return files.length
  }

  /**
   * Songs that are not favourites stay between runs, last opened times too (user's choice, 2026-11-10), unless their
   * tab is gone from data/songs/: those are dropped. Run when the server starts; returns how many went.
   */
  async dropMissing(): Promise<number> {
    let dropped = 0
    for (const song of this.list().filter((entry) => !entry.favorite)) {
      const folder = this.contentFolder(song)
      const there = song.source === 'file' ? folder !== null && song.fileName !== null && existsSync(path.join(folder, song.fileName)) : folder !== null && existsSync(path.join(folder, 'meta.json'))
      if (!there && (await this.remove(song.id))) dropped++
    }
    return dropped
  }
}

function extensionOf(fileName: string): string {
  return path.extname(fileName).slice(1).toLowerCase()
}

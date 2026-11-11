import type { DatabaseSync } from 'node:sqlite'
import type { Playlist } from '../../../contracts/library.ts'

/** A playlist as the page sees it, defined with it in contracts/library.ts. */
export type { Playlist } from '../../../contracts/library.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id INTEGER NOT NULL,
  song_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, song_id)
);
`

export const MAX_PLAYLIST_NAME = 60

/**
 * Playlists ("播放列表", 2026-11-05), in data/user.db next to the songs. Any song of the library goes in (favourites
 * only until 2026-11-12, when songs that are not favourites started staying between runs); a song that is deleted, or
 * dropped at a start because its tab is gone, leaves every playlist.
 */
export class Playlists {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
    this.db.exec(SCHEMA)
  }

  /** Every playlist, oldest first, with its songs in order (only songs that are still in the library). */
  list(): Playlist[] {
    const playlists = this.db.prepare('SELECT id, name FROM playlists ORDER BY id').all() as unknown as Array<{ id: number; name: string }>
    const entries = this.db
      .prepare(
        `SELECT playlist_songs.playlist_id AS playlistId, playlist_songs.song_id AS songId FROM playlist_songs
         JOIN songs ON songs.id = playlist_songs.song_id
         ORDER BY playlist_songs.position`,
      )
      .all() as unknown as Array<{ playlistId: number; songId: number }>
    return playlists.map(({ id, name }) => ({ id, name, songIds: entries.filter((entry) => entry.playlistId === id).map((entry) => entry.songId) }))
  }

  get(id: number): Playlist | null {
    return this.list().find((playlist) => playlist.id === id) ?? null
  }

  create(name: string): Playlist {
    const result = this.db.prepare('INSERT INTO playlists (name, created_at) VALUES (?, ?)').run(cleanName(name), new Date().toISOString())
    return this.get(Number(result.lastInsertRowid))!
  }

  rename(id: number, name: string): Playlist | null {
    this.db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(cleanName(name), id)
    return this.get(id)
  }

  /** The playlist's songs, in this order: songs of the library only, each once. */
  setSongs(id: number, songIds: number[]): Playlist | null {
    if (!this.get(id)) return null
    const known = new Set((this.db.prepare('SELECT id FROM songs').all() as unknown as Array<{ id: number }>).map((row) => row.id))
    const kept = [...new Set(songIds)].filter((songId) => known.has(songId))
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ?').run(id)
      const insert = this.db.prepare('INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)')
      kept.forEach((songId, position) => insert.run(id, songId, position))
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.get(id)
  }

  remove(id: number): boolean {
    const found = this.get(id) !== null
    this.db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ?').run(id)
    this.db.prepare('DELETE FROM playlists WHERE id = ?').run(id)
    return found
  }

  /** Takes a song out of every playlist (deleted). */
  removeSong(songId: number) {
    this.db.prepare('DELETE FROM playlist_songs WHERE song_id = ?').run(songId)
  }
}

function cleanName(name: string): string {
  return name.trim().slice(0, MAX_PLAYLIST_NAME)
}

// The library and the online tabs (server/src/db/, server/src/songs/client.ts, web/src/tabs/api.ts).

export type SongSource = 'songsterr' | 'file'

/** Per-song practice settings as the server keeps them: the page owns the shape (its PracticeSettings). */
export type SongSettings = Record<string, unknown>

/** A song of the library; `Settings` is how the side looking at it reads its practice settings. */
export interface Song<Settings = SongSettings> {
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
  settings: Settings
  createdAt: string
  lastOpenedAt: string | null
}

/** A playlist: a named group of favourite songs, in the order they are played. */
export interface Playlist {
  id: number
  name: string
  /** The songs, in playing order. */
  songIds: number[]
}

/** A song found by searching the online tabs. */
export interface SongsterrSearchHit {
  songId: number
  title: string
  artist: string
  trackCount: number
}

/** One revision of an online tab. */
export interface SongsterrRevision {
  revisionId: number
  createdAt: string
  author: string
  description: string
}

// The tabs' calls to the local server: the library, local files and online tabs (server/src/routes/library.ts, songs.ts).
import type { Playlist, Song as LibrarySong, SongsterrRevision, SongsterrSearchHit } from '../../../contracts/library.ts'
import { json, request } from '../shared/http.ts'
import { translate } from '../shared/ui/i18n.ts'
import type { TrackEdits } from './player/trackEdits.ts'

/** Per-song practice state, restored the next time the song is opened. */
export interface PracticeSettings {
  speed?: number
  trackIndex?: number
  looping?: boolean
  range?: { startTick: number; endTick: number } | null
  countIn?: boolean
  metronome?: boolean
  transpose?: number
  /** Track name, instrument, tuning and capo changes, keyed by track index. */
  trackEdits?: TrackEdits
  /** Tones from the library given to tracks, per kind of section: track index -> { clean, overdrive, distortion, bass } -> tone id. */
  /** Track index -> the id of its tone in the library. Older settings had one per kind of section. */
  trackTones?: Record<string, string | Record<string, string>>
  /** Track index -> a preset of an extra sound font: its file and program. */
  trackSounds?: Record<string, { font: string; program: number }>
  /** The key the note names are read in, picked by hand (a key signature); null or missing follows the tab. */
  key?: number | null
  /** Master bar index -> the track shown from it on, while playing. */
  trackSwitchesFrom?: Record<string, number>
  /** Before 2026-11-05: master bar index -> the track shown after it (read once, then saved as trackSwitchesFrom). */
  trackSwitches?: Record<string, number>
}

/** A song of the library (contracts/library.ts), its practice settings read as the page keeps them. */
export type Song = LibrarySong<PracticeSettings>

export type SongsterrHit = SongsterrSearchHit
export type Revision = SongsterrRevision

export function listSongs(options: { query?: string; favorite?: boolean } = {}): Promise<Song[]> {
  const params = new URLSearchParams()
  if (options.query) params.set('q', options.query)
  if (options.favorite) params.set('favorite', '1')
  const suffix = params.size > 0 ? `?${params}` : ''
  return request(`/api/songs${suffix}`)
}

export function getSong(id: number): Promise<Song> {
  return request(`/api/songs/${id}`)
}

/** Marks the song as opened now. */
export function openSong(id: number): Promise<Song> {
  return request(`/api/songs/${id}/open`, { method: 'POST' })
}

export function updateSong(
  id: number,
  changes: { favorite?: boolean; settings?: PracticeSettings; title?: string; artist?: string; trackCount?: number },
): Promise<Song> {
  return request(`/api/songs/${id}`, json('PATCH', changes))
}

export function deleteSong(id: number): Promise<{ ok: boolean }> {
  return request(`/api/songs/${id}`, { method: 'DELETE' })
}

/** A playlist of favourite songs, in playing order (contracts/library.ts). */
export type { Playlist }

export function listPlaylists(): Promise<Playlist[]> {
  return request('/api/playlists')
}

export function createPlaylist(name: string): Promise<Playlist> {
  return request('/api/playlists', json('POST', { name }))
}

/** A new name and/or the songs in their new order (favourites only; the server leaves out the rest). */
export function updatePlaylist(id: number, changes: { name?: string; songIds?: number[] }): Promise<Playlist> {
  return request(`/api/playlists/${id}`, json('PATCH', changes))
}

export function deletePlaylist(id: number): Promise<{ ok: boolean }> {
  return request(`/api/playlists/${id}`, { method: 'DELETE' })
}

export async function getSongFile(id: number): Promise<Uint8Array> {
  const response = await fetch(`/api/songs/${id}/file`)
  if (!response.ok) throw new Error(translate('读取曲谱文件失败。'))
  return new Uint8Array(await response.arrayBuffer())
}

export async function getEditedSong(id: number): Promise<Uint8Array> {
  const response = await fetch(`/api/songs/${id}/edited`)
  if (!response.ok) throw new Error(translate('读取曲谱文件失败。'))
  return new Uint8Array(await response.arrayBuffer())
}

export function saveEditedSong(id: number, bytes: Uint8Array): Promise<Song> {
  return request(`/api/songs/${id}/edited`, { method: 'PUT', body: bytes as unknown as BodyInit })
}

export function discardEditedSong(id: number): Promise<Song> {
  return request(`/api/songs/${id}/edited`, { method: 'DELETE' })
}

export async function getSongTracks(id: number): Promise<unknown[]> {
  return (await request<{ tracks: unknown[] }>(`/api/songs/${id}/tracks`)).tracks
}

export function uploadSong(file: File): Promise<Song> {
  return request(`/api/songs/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })
}

export function importSongsterr(urlOrId: string): Promise<Song> {
  return request('/api/songsterr/import', json('POST', { url: urlOrId }))
}

export function searchSongsterr(query: string, signal?: AbortSignal): Promise<SongsterrHit[]> {
  return request(`/api/songsterr/search?q=${encodeURIComponent(query)}`, { signal })
}

export function getRevisions(id: number): Promise<Revision[]> {
  return request(`/api/songs/${id}/revisions`)
}

export function switchRevision(id: number, revisionId: number): Promise<Song> {
  return request(`/api/songs/${id}/revision`, json('POST', { revisionId }))
}

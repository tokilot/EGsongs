// Thin wrappers around the local API (server/src/app.ts).
import type { TrackEdits } from '../player/trackEdits.ts'
import { translate } from '../ui/i18n.ts'

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
  /** The key the note names are read in, picked by hand (a key signature); null or missing follows the tab. */
  key?: number | null
}

export interface Song {
  id: number
  source: 'songsterr' | 'file'
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
  /** Changed in the tab editor: open the edited copy instead of the source. */
  edited: boolean
  settings: PracticeSettings
  createdAt: string
  lastOpenedAt: string | null
}

export interface SongsterrHit {
  songId: number
  title: string
  artist: string
  trackCount: number
}

export interface Revision {
  revisionId: number
  createdAt: string
  author: string
  description: string
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new Error(translate('无法连接本地服务，请确认后端已启动。'))
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? translate('请求失败（{status}）', { status: response.status }))
  }
  return (await response.json()) as T
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

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

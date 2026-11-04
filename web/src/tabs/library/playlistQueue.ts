import { useSyncExternalStore } from 'react'
import * as api from '../api.ts'
import { translate } from '../../shared/ui/i18n.ts'

// The playlist being played through (2026-11-05): when a song of it ends, the next one opens and plays (see
// SongContext.tsx). Opening any other song leaves it: the song shown no longer matches the queue's.

export interface PlaylistQueue {
  playlistId: number
  songIds: number[]
  /** The song of the playlist that is open. */
  index: number
}

let queue: PlaylistQueue | null = null
const listeners = new Set<() => void>()

export function setPlaylistQueue(next: PlaylistQueue | null) {
  queue = next
  for (const listener of listeners) listener()
}

export function playlistQueue(): PlaylistQueue | null {
  return queue
}

export function usePlaylistQueue(): PlaylistQueue | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => queue,
  )
}

/**
 * Before taking the star off a song: a song that stops being a favourite leaves every playlist, so ask first when it
 * is in one. True when it may go ahead.
 */
export async function confirmUnfavorite(songId: number): Promise<boolean> {
  const playlists = await api.listPlaylists().catch(() => [])
  const count = playlists.filter((playlist) => playlist.songIds.includes(songId)).length
  return count === 0 || window.confirm(translate('取消收藏后，它也会从 {n} 个播放集里移除。确认吗？', { n: count }))
}

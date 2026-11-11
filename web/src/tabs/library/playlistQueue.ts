import { useSyncExternalStore } from 'react'

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

import { createContext, useContext } from 'react'
import type { Song } from '../api.ts'

export interface SongContextValue {
  /** The song shown in the score area, or null on the library home. */
  song: Song | null
  /** Set while a song is being fetched. */
  opening: boolean
  error: string | null
  open: (id: number) => Promise<void>
  /** Back to the library home. */
  close: () => void
  /** Replaces the current song after the server changed it (favourite, revision). */
  replace: (song: Song) => void
  /** Bumped whenever the library changed, so lists know to reload. */
  libraryVersion: number
  libraryChanged: () => void
}

export const SongContext = createContext<SongContextValue | null>(null)

export function useSong(): SongContextValue {
  const value = useContext(SongContext)
  if (!value) throw new Error('useSong must be used inside <SongProvider>')
  return value
}

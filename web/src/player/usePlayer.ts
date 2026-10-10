import { createContext, useContext, useSyncExternalStore } from 'react'
import type { PlayerController, PlayerSnapshot } from './controller.ts'

export const PlayerContext = createContext<PlayerController | null>(null)

/** The current player state (a mirror of what alphaTab reports) plus the controller to act on it. */
export function usePlayer(): { state: PlayerSnapshot; player: PlayerController } {
  const player = useContext(PlayerContext)
  if (!player) throw new Error('usePlayer must be used inside <PlayerProvider>')
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot)
  return { state, player }
}

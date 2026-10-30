import { useEffect, useState, type ReactNode } from 'react'
import { PlayerController } from './controller.ts'
import { PlayerContext } from './usePlayer.ts'

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new PlayerController())

  // Development builds expose the controller so the scripts in scripts/ can read the player state.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const target = window as unknown as { __tabsPlayer?: PlayerController }
    target.__tabsPlayer = controller
    return () => {
      delete target.__tabsPlayer
    }
  }, [controller])

  return <PlayerContext.Provider value={controller}>{children}</PlayerContext.Provider>
}

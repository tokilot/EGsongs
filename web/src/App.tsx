import { useEffect } from 'react'
import styles from './App.module.css'
import { ControlBar } from './layout/ControlBar.tsx'
import { ScoreView } from './layout/ScoreView.tsx'
import { useShortcuts } from './layout/shortcuts.ts'
import { TopBar } from './layout/TopBar.tsx'
import { SongProvider } from './library/SongContext.tsx'
import { PlayerProvider } from './player/PlayerContext.tsx'
import { usePlayer } from './player/usePlayer.ts'
import { useTheme } from './ui/theme.ts'

function Layout() {
  useShortcuts()
  const { player } = usePlayer()
  const { resolved } = useTheme()
  // The notation is drawn by alphaTab, which needs to be told the colours.
  useEffect(() => player.setDarkScore(resolved === 'dark'), [player, resolved])
  return (
    <div className={styles.app}>
      <TopBar />
      <ScoreView />
      <ControlBar />
    </div>
  )
}

export default function App() {
  return (
    <PlayerProvider>
      <SongProvider>
        <Layout />
      </SongProvider>
    </PlayerProvider>
  )
}

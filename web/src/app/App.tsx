import { useEffect } from 'react'
import styles from './App.module.css'
import { TopBar } from './TopBar.tsx'
import { useView } from '../shared/useView.ts'
import { useTheme } from '../shared/ui/theme.ts'
import { StemsPage } from '../stems/StemsPage.tsx'
import { ControlBar } from '../tabs/layout/ControlBar.tsx'
import { ScoreView } from '../tabs/layout/ScoreView.tsx'
import { useShortcuts } from '../tabs/layout/shortcuts.ts'
import { SongProvider } from '../tabs/library/SongContext.tsx'
import { PlayerProvider } from '../tabs/player/PlayerContext.tsx'
import { TrackEditor } from '../tabs/player/TrackEditor.tsx'
import { usePlayer } from '../tabs/player/usePlayer.ts'
import { toneStore } from '../tones/toneStore.ts'
import { TonePage } from '../tones/TonePage.tsx'

// The shell: the three parts side by side (the tabs, the guitar tones, the stems), each on its own; only here are
// they put together.
function Layout() {
  useShortcuts()
  const { player } = usePlayer()
  const { resolved } = useTheme()
  const view = useView()
  // The notation is drawn by alphaTab, which needs to be told the colours.
  useEffect(() => player.setDarkScore(resolved === 'dark'), [player, resolved])
  // The player plays the tones the tone library has, as it has them now.
  useEffect(() => {
    const tell = () => player.setToneLibrary(toneStore.getState().library)
    tell()
    void toneStore.load()
    return toneStore.subscribe(tell)
  }, [player])
  return (
    <div className={styles.app}>
      <TopBar />
      <ScoreView />
      {view === 'tones' && <TonePage />}
      {view === 'stems' && <StemsPage />}
      <ControlBar />
      <TrackEditor />
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

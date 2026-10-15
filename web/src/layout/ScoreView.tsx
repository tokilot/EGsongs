import { useEffect, useRef } from 'react'
import { SongList } from '../library/SongList.tsx'
import { useSong } from '../library/useSong.ts'
import { usePlayer } from '../player/usePlayer.ts'
import { useLanguage } from '../ui/i18n.ts'
import { EditPanel } from './EditPanel.tsx'
import styles from './ScoreView.module.css'

export function ScoreView() {
  const { state, player } = usePlayer()
  const { song, opening, error } = useSong()
  const { t } = useLanguage()
  const scroller = useRef<HTMLElement>(null)
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!host.current || !scroller.current) return
    player.mount(host.current, scroller.current)
    return () => player.unmount()
  }, [player])

  const showHome = !song && !opening
  // Player errors are Chinese keys; server errors pass through untranslated.
  const message = error ?? (state.error ? t(state.error) : null)
  const busy = opening || state.status === 'loading'
  const editing = state.editing

  return (
    <main className={styles.scoreView} ref={scroller} data-status={state.status} data-editing={editing ? '' : undefined}>
      {showHome && (
        <section className={styles.home}>
          <h1>{t('我的曲谱')}</h1>
          {message && <p className={styles.error}>{message}</p>}
          <SongList />
        </section>
      )}
      {!showHome && message && <p className={styles.error}>{message}</p>}
      {!showHome && !message && busy && <p className={styles.status}>{t('正在加载曲谱…')}</p>}
      <div className={styles.sheet} hidden={showHome}>
        <div
          className={styles.stage}
          // While editing, a click on the score puts the edit cursor there (alphaTab still moves its own cursor).
          onPointerDown={editing ? (event) => player.editClickAt(event.clientX, event.clientY) : undefined}
        >
          {/* alphaTab owns this element; it stays mounted so the player survives switching songs. */}
          <div ref={host} />
          {editing?.beatBox && (
            <div
              className={styles.editBeat}
              style={{ left: editing.beatBox.x, top: editing.beatBox.y, width: editing.beatBox.w, height: editing.beatBox.h }}
              aria-hidden
            />
          )}
          {editing?.noteBox && editing.editable && (
            <div
              className={styles.editNote}
              data-has-note={editing.note ? '' : undefined}
              style={{ left: editing.noteBox.x, top: editing.noteBox.y, width: editing.noteBox.w, height: editing.noteBox.h }}
              aria-hidden
            />
          )}
          <EditPanel />
        </div>
      </div>
    </main>
  )
}

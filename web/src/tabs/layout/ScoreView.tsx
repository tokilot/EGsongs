import { MoreHorizontal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SongList } from '../library/SongList.tsx'
import { useSong } from '../library/useSong.ts'
import { usePlayer } from '../player/usePlayer.ts'
import { useLanguage } from '../../shared/ui/i18n.ts'
import { EditPanel } from './EditPanel.tsx'
import styles from './ScoreView.module.css'
import { TrackSwitchMenu, type TrackSwitchMenuPlace } from './TrackSwitchMenu.tsx'

export function ScoreView() {
  const { state, player } = usePlayer()
  const { song, opening, error } = useSong()
  const { t } = useLanguage()
  const scroller = useRef<HTMLElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [switchMenu, setSwitchMenu] = useState<TrackSwitchMenuPlace | null>(null)
  const closeSwitchMenu = useCallback(() => setSwitchMenu(null), [])
  // The bar under the mouse: a "..." button at its start opens the track switch menu (practice mode only).
  const [hoverBar, setHoverBar] = useState<number | null>(null)

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
  const switching = state.practiceMode && !editing && state.status === 'ready'
  const hoverBox = switching && hoverBar !== null ? player.barBox(hoverBar) : null
  const menuBar = switchMenu?.bar ?? null

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
          ref={stage}
          className={styles.stage}
          // While editing, a click on the score puts the edit cursor there (alphaTab still moves its own cursor).
          onPointerDown={editing ? (event) => player.editClickAt(event.clientX, event.clientY) : undefined}
          onPointerMove={
            switching
              ? (event) => {
                  const bar = player.barAt(event.clientX, event.clientY)
                  // Over the button itself it stays; while the menu is open it stays on the menu's bar.
                  if (bar !== null && bar !== hoverBar && menuBar === null) setHoverBar(bar)
                }
              : undefined
          }
          onPointerLeave={() => menuBar === null && setHoverBar(null)}
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
          {/* Where the shown track switches while playing, at the start of its bar. */}
          {switching &&
            state.switchMarks.map((mark) => (
              <div key={mark.bar} className={styles.switchMark} style={{ left: mark.x, top: mark.y }} aria-hidden>
                → {state.tracks[mark.track]?.name ?? ''}
              </div>
            ))}
          {hoverBox && hoverBar !== null && (
            <button
              type="button"
              className={styles.barMore}
              style={{ left: hoverBox.x, top: hoverBox.y + hoverBox.h }}
              aria-label={t('从第 {n} 小节开始切换音轨', { n: hoverBar + 1 })}
              title={t('自动切换音轨')}
              aria-expanded={menuBar === hoverBar}
              onClick={() => setSwitchMenu(menuBar === hoverBar ? null : { bar: hoverBar, x: hoverBox.x, y: hoverBox.y + hoverBox.h })}
            >
              <MoreHorizontal size={16} aria-hidden />
            </button>
          )}
          {switchMenu && switching && <TrackSwitchMenu place={switchMenu} onClose={closeSwitchMenu} />}
          <EditPanel />
        </div>
      </div>
    </main>
  )
}

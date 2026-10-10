import { useEffect, useRef } from 'react'
import { SongList } from '../library/SongList.tsx'
import { useSong } from '../library/useSong.ts'
import { usePlayer } from '../player/usePlayer.ts'
import styles from './ScoreView.module.css'

export function ScoreView() {
  const { state, player } = usePlayer()
  const { song, opening, error } = useSong()
  const scroller = useRef<HTMLElement>(null)
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!host.current || !scroller.current) return
    player.mount(host.current, scroller.current)
    return () => player.unmount()
  }, [player])

  const showHome = !song && !opening
  const message = error ?? state.error
  const busy = opening || state.status === 'loading'

  return (
    <main className={styles.scoreView} ref={scroller} data-status={state.status}>
      {showHome && (
        <section className={styles.home}>
          <h1>我的曲谱</h1>
          {message && <p className={styles.error}>{message}</p>}
          <SongList />
        </section>
      )}
      {!showHome && message && <p className={styles.error}>{message}</p>}
      {!showHome && !message && busy && <p className={styles.status}>正在加载曲谱…</p>}
      {/* alphaTab owns this element; it stays mounted so the player survives switching songs. */}
      <div className={styles.sheet} hidden={showHome}>
        <div ref={host} />
      </div>
    </main>
  )
}

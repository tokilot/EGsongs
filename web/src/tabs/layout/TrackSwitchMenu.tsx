import { Check } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePlayer } from '../player/usePlayer.ts'
import { sortByName } from '../../shared/alphabetical.ts'
import { useLanguage } from '../../shared/ui/i18n.ts'
import styles from './TrackSwitchMenu.module.css'

export interface TrackSwitchMenuPlace {
  /** Master bar index. */
  bar: number
  /** Where it was opened, in the score stage's coordinates. */
  x: number
  y: number
}

/**
 * The menu the "..." button at the start of a bar opens: from this bar on, switch to which track (while playing). A
 * tick marks the switch set there; it can be taken away.
 */
export function TrackSwitchMenu({ place, onClose }: { place: TrackSwitchMenuPlace; onClose: () => void }) {
  const { state, player } = usePlayer()
  const { t } = useLanguage()
  const menu = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(place.x)
  const current = state.trackSwitches[place.bar]

  // Kept inside the score: moved left when it would run off the right edge.
  useLayoutEffect(() => {
    const element = menu.current
    const room = element?.parentElement?.clientWidth ?? 0
    if (element && room) setLeft(Math.max(0, Math.min(place.x, room - element.offsetWidth - 4)))
  }, [place.x])

  // Any click elsewhere, or Escape, closes it.
  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [onClose])

  const pick = (track: number | null) => {
    player.setTrackSwitch(place.bar, track)
    onClose()
  }

  return (
    <div ref={menu} className={styles.menu} role="menu" aria-label={t('音轨切换')} style={{ left, top: place.y }} onContextMenu={(event) => event.preventDefault()}>
      <h3>{t('从第 {n} 小节开始切换到：', { n: place.bar + 1 })}</h3>
      {sortByName(state.tracks, (track) => track.name).map((track) => (
        <button key={track.index} type="button" role="menuitemradio" aria-checked={current === track.index} onClick={() => pick(track.index)}>
          <span className={styles.tick}>{current === track.index && <Check size={14} aria-hidden />}</span>
          {track.name}
        </button>
      ))}
      {current !== undefined && (
        <>
          <hr />
          <button type="button" role="menuitem" onClick={() => pick(null)}>
            <span className={styles.tick} />
            {t('取消这里的切换')}
          </button>
        </>
      )}
    </div>
  )
}

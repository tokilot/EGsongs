import { Drum, Guitar, Headphones, VolumeX } from 'lucide-react'
import { usePlayer } from './usePlayer.ts'
import styles from './TrackList.module.css'

/** Track picker and mixer: choose which track is shown, and set each track's volume, mute and solo. */
export function TrackList() {
  const { state, player } = usePlayer()
  if (state.tracks.length === 0) return <p className={styles.empty}>还没有打开曲谱。</p>

  return (
    <ul className={styles.tracks}>
      {state.tracks.map((track) => {
        const Icon = track.isPercussion ? Drum : Guitar
        const selected = track.index === state.trackIndex
        return (
          <li key={track.index} className={selected ? styles.selected : undefined}>
            <button
              type="button"
              className={styles.name}
              aria-current={selected ? 'true' : undefined}
              onClick={() => player.selectTrack(track.index)}
            >
              <Icon size={16} aria-hidden />
              <span>{track.name}</span>
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={track.volume}
              aria-label={`${track.name} 音量`}
              onChange={(event) => player.setTrackVolume(track.index, Number(event.target.value))}
            />
            <button
              type="button"
              className={styles.toggle}
              aria-label={`${track.name} 独奏`}
              aria-pressed={track.solo}
              title="独奏"
              onClick={() => player.setTrackSolo(track.index, !track.solo)}
            >
              <Headphones size={15} aria-hidden />
            </button>
            <button
              type="button"
              className={styles.toggle}
              aria-label={`${track.name} 静音`}
              aria-pressed={track.mute}
              title="静音"
              onClick={() => player.setTrackMute(track.index, !track.mute)}
            >
              <VolumeX size={15} aria-hidden />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

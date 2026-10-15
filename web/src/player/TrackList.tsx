import { Headphones, Pencil, Volume2, VolumeX } from 'lucide-react'
import { useLanguage } from '../ui/i18n.ts'
import { programName } from './gmPrograms.ts'
import { InstrumentIcon } from './InstrumentIcon.tsx'
import { openTrackEditor } from './trackEditorStore.ts'
import { usePlayer } from './usePlayer.ts'
import styles from './TrackList.module.css'

/**
 * Track picker and mixer: the master volume, then each track with a dot that blinks while it is sounding,
 * its volume, solo, mute and the track editor.
 */
export function TrackList() {
  const { state, player } = usePlayer()
  const { t, language } = useLanguage()
  if (state.tracks.length === 0) return <p className={styles.empty}>{t('还没有打开曲谱。')}</p>
  const sounding = new Set(state.sounding)

  return (
    <div className={styles.mixer}>
      <label className={styles.master}>
        <Volume2 size={16} aria-hidden />
        <span>{t('主音量')}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={state.masterVolume}
          aria-label={t('主音量')}
          onChange={(event) => player.setMasterVolume(Number(event.target.value))}
        />
        <output>{Math.round(state.masterVolume * 100)}%</output>
      </label>

      <ul className={styles.tracks}>
        {state.tracks.map((track) => {
          const selected = track.index === state.trackIndex
          const isSounding = sounding.has(track.index)
          return (
            <li key={track.index} className={selected ? styles.selected : undefined}>
              <span
                className={styles.dot}
                data-sounding={isSounding || undefined}
                title={isSounding ? t('正在发声') : undefined}
                aria-label={isSounding ? t('正在发声') : undefined}
              />
              <button
                type="button"
                className={styles.name}
                aria-current={selected ? 'true' : undefined}
                title={track.isPercussion ? undefined : programName(track.program, language)}
                onClick={() => player.selectTrack(track.index)}
              >
                <InstrumentIcon program={track.program} isPercussion={track.isPercussion} />
                <span>{track.name}</span>
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={track.volume}
                aria-label={t('{name} 音量', { name: track.name })}
                onChange={(event) => player.setTrackVolume(track.index, Number(event.target.value))}
              />
              <button
                type="button"
                className={styles.toggle}
                aria-label={t('{name} 独奏', { name: track.name })}
                aria-pressed={track.solo}
                title={t('独奏')}
                onClick={() => player.setTrackSolo(track.index, !track.solo)}
              >
                <Headphones size={15} aria-hidden />
              </button>
              <button
                type="button"
                className={styles.toggle}
                aria-label={t('{name} 静音', { name: track.name })}
                aria-pressed={track.mute}
                title={t('静音')}
                onClick={() => player.setTrackMute(track.index, !track.mute)}
              >
                <VolumeX size={15} aria-hidden />
              </button>
              <button
                type="button"
                className={styles.toggle}
                aria-label={t('编辑 {name}', { name: track.name })}
                aria-pressed={state.trackEdits[track.index] ? true : undefined}
                title={t('编辑音轨')}
                onClick={() => openTrackEditor(track.index)}
              >
                <Pencil size={14} aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

import { Play, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLanguage } from '../ui/i18n.ts'
import { GM_PROGRAMS_EN, GM_PROGRAMS_ZH, programName } from './gmPrograms.ts'
import { InstrumentIcon } from './InstrumentIcon.tsx'
import { openTrackEditor, useTrackEditor } from './trackEditorStore.ts'
import {
  INSTRUMENT_GROUPS,
  isBassTuning,
  MAX_CAPO,
  MAX_STRINGS,
  MIN_STRINGS,
  pitchName,
  resizeTuning,
  tuningPresets,
  type TrackEdit,
  type TrackSetup,
} from './trackEdits.ts'
import { usePlayer } from './usePlayer.ts'
import styles from './TrackEditor.module.css'

// Pitches offered for each string: C1 up to C6.
const PITCHES = Array.from({ length: 61 }, (_, index) => 24 + index)

function sameTuning(a: number[], b: number[]) {
  return a.length === b.length && a.every((pitch, index) => pitch === b[index])
}

/** "Edit track": name, instrument, strings, tuning and capo of one track, modelled on the site's dialog. */
export function TrackEditor() {
  const index = useTrackEditor()
  const { player, state } = usePlayer()
  const current = index === null ? null : player.currentTrackSetup(index)
  // Close when the song changes underneath.
  useEffect(() => {
    if (index !== null && state.status !== 'ready') openTrackEditor(null)
  }, [index, state.status])
  if (index === null || !current) return null
  return <EditorDialog key={index} index={index} current={current} />
}

function EditorDialog({ index, current }: { index: number; current: TrackSetup }) {
  const { player, state } = usePlayer()
  const { t, language } = useLanguage()
  const original = player.originalTrackSetup(index) ?? current
  const [name, setName] = useState(current.name)
  const [program, setProgram] = useState(current.program)
  const [tuning, setTuning] = useState(current.tuning)
  const [capo, setCapo] = useState(current.capo)
  const [adjust, setAdjust] = useState(state.trackEdits[index]?.adjustFingering ?? true)
  const [group, setGroup] = useState(() => INSTRUMENT_GROUPS.findIndex((item) => item.programs.includes(current.program)))
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const close = () => openTrackEditor(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') openTrackEditor(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const bass = isBassTuning(tuning)
  const presets = tuningPresets(tuning.length, bass)
  const preset = presets.find((item) => sameTuning(item.tuning, tuning))
  const stringsChanged = tuning.length !== current.tuning.length
  const tuningChanged = !sameTuning(tuning, current.tuning) || capo !== current.capo
  const programs = useMemo(() => {
    const query = search.trim().toLowerCase()
    const pool = query ? GM_PROGRAMS_EN.map((_, program) => program) : (INSTRUMENT_GROUPS[group]?.programs ?? [])
    // Either language matches, whatever the interface shows.
    return pool.filter((program) => !query || GM_PROGRAMS_EN[program].toLowerCase().includes(query) || GM_PROGRAMS_ZH[program].includes(query))
  }, [group, search])

  // While the tab is being edited, a change is made to the track as it stands (and saved with the tab);
  // otherwise the edit is kept against the song as loaded.
  const editingTab = state.editing !== null
  const base = editingTab ? current : original
  const differs = (target: TrackSetup) =>
    target.name !== current.name || target.program !== current.program || !sameTuning(target.tuning, current.tuning) || target.capo !== current.capo

  const apply = () => {
    const edit: TrackEdit = {}
    if (name.trim() && name.trim() !== base.name) edit.name = name.trim()
    if (!current.isPercussion) {
      if (program !== base.program) edit.program = program
      if (!sameTuning(tuning, base.tuning)) edit.tuning = tuning
      if (capo !== base.capo) edit.capo = capo
      // Fingerings are always adjusted when strings come or go; otherwise it is the user's choice.
      if (edit.tuning || edit.capo !== undefined) edit.adjustFingering = stringsChanged || adjust
    }
    if (editingTab && Object.keys(edit).length === 0) {
      close()
      return
    }
    const moved = player.setTrackEdit(index, Object.keys(edit).length > 0 ? edit : null)
    if (moved > 0) setMessage(t('已应用；{n} 个音超出音域或无弦可放，已移动八度或删除。', { n: moved }))
    else close()
  }

  return (
    <div className={styles.backdrop} onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={t('编辑音轨')}>
        <header className={styles.header}>
          <h2>{t('编辑音轨')}</h2>
          <button type="button" className={styles.close} aria-label={t('取消')} onClick={close}>
            <X size={18} aria-hidden />
          </button>
        </header>

        <label className={styles.field}>
          <span>{t('名称（可选）')}</span>
          <input type="text" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
        </label>

        {current.isPercussion ? (
          <p className={styles.hint}>{t('鼓轨只能修改名称。')}</p>
        ) : (
          <>
            <section className={styles.section}>
              <h3>{t('乐器')}</h3>
              <div className={styles.groups} role="tablist" aria-label={t('乐器分组')}>
                {INSTRUMENT_GROUPS.map((item, position) => (
                  <button
                    key={item.label}
                    type="button"
                    role="tab"
                    aria-selected={!search && group === position}
                    onClick={() => {
                      setGroup(position)
                      setSearch('')
                    }}
                  >
                    {t(item.label)}
                  </button>
                ))}
              </div>
              <div className={styles.searchRow}>
                <input
                  type="search"
                  placeholder={t('搜索乐器…')}
                  aria-label={t('搜索乐器…')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button type="button" className={styles.preview} disabled={!state.canPlay} onClick={() => player.previewInstrument(program, tuning)}>
                  <Play size={14} aria-hidden />
                  {t('试听')}
                </button>
              </div>
              <ul className={styles.programs} aria-label={t('乐器')}>
                {programs.length === 0 && <li className={styles.hint}>{t('没有找到乐器。')}</li>}
                {programs.map((value) => (
                  <li key={value}>
                    <button type="button" aria-pressed={value === program} onClick={() => setProgram(value)}>
                      <InstrumentIcon program={value} size={15} />
                      <span>{programName(value, language)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.section}>
              <h3>{t('乐器选项')}</h3>
              <div className={styles.row}>
                <label className={styles.inline}>
                  <span>{t('弦数')}</span>
                  <select
                    aria-label={t('弦数')}
                    value={tuning.length}
                    onChange={(event) => setTuning(resizeTuning(tuning, Number(event.target.value), bass))}
                  >
                    {Array.from({ length: MAX_STRINGS - MIN_STRINGS + 1 }, (_, offset) => MIN_STRINGS + offset).map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.inline}>
                  <span>{t('调弦')}</span>
                  <select
                    aria-label={t('调弦')}
                    value={preset ? preset.name : ''}
                    onChange={(event) => {
                      const chosen = presets.find((item) => item.name === event.target.value)
                      if (chosen) setTuning(chosen.tuning)
                    }}
                  >
                    {!preset && <option value="">{t('自定义调弦')}</option>}
                    {presets.map((item) => (
                      <option key={item.name} value={item.name}>
                        {t(item.name)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.inline}>
                  <span>{t('变调夹')}</span>
                  <select aria-label={t('变调夹')} value={capo} onChange={(event) => setCapo(Number(event.target.value))}>
                    {Array.from({ length: MAX_CAPO + 1 }, (_, fret) => fret).map((fret) => (
                      <option key={fret} value={fret}>
                        {fret === 0 ? t('无') : fret}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className={styles.strings}>
                {tuning.map((pitch, string) => (
                  <label key={string} className={styles.string}>
                    <span>{string + 1}</span>
                    <select
                      aria-label={t('第 {n} 弦', { n: string + 1 })}
                      value={pitch}
                      onChange={(event) => setTuning(tuning.map((value, position) => (position === string ? Number(event.target.value) : value)))}
                    >
                      {PITCHES.map((value) => (
                        <option key={value} value={value}>
                          {pitchName(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={stringsChanged || adjust}
                  disabled={!tuningChanged || stringsChanged}
                  onChange={(event) => setAdjust(event.target.checked)}
                />
                {t('调整指法（保持音高，重新排品）')}
              </label>
              <p className={styles.hint}>
                {!tuningChanged
                  ? t('先修改调弦或变调夹才能调整指法。')
                  : stringsChanged
                    ? t('改变弦数时必须调整指法。')
                    : t('不勾选时保留谱上的品位，音高随调弦改变。')}
              </p>
            </section>
          </>
        )}

        {message && <p className={styles.message}>{message}</p>}

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.secondary}
            disabled={editingTab ? !differs(original) : !state.trackEdits[index]}
            onClick={() => {
              if (editingTab) {
                // Back to the track as loaded, keeping the pitches.
                const tuningBack = !sameTuning(original.tuning, current.tuning) || original.capo !== current.capo
                player.setTrackEdit(index, {
                  name: original.name,
                  ...(current.isPercussion || original.program === current.program ? {} : { program: original.program }),
                  ...(current.isPercussion || !tuningBack ? {} : { tuning: original.tuning, capo: original.capo, adjustFingering: true }),
                })
              } else {
                player.setTrackEdit(index, null)
              }
              close()
            }}
          >
            {t('恢复原样')}
          </button>
          <span className={styles.spacer} />
          <button type="button" className={styles.secondary} onClick={close}>
            {message ? t('关闭') : t('取消')}
          </button>
          {!message && (
            <button type="button" className={styles.primary} onClick={apply}>
              {t('应用')}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

import { AudioWaveform, Play, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLanguage } from '../../shared/ui/i18n.ts'
import { GM_PROGRAMS_EN, GM_PROGRAMS_ZH, programName } from './gmPrograms.ts'
import { toneFamilyOf, toneProgram, type Tone } from '../../audio/tone.ts'
import { allTones, findTone } from '../../tones/library.ts'
import { useTones } from '../../tones/toneStore.ts'
import { InstrumentIcon } from './InstrumentIcon.tsx'
import { openTrackEditor, useTrackEditor } from './trackEditorStore.ts'
import { findPreset, presetPlace, sameSound, type TrackSound } from './trackSounds.ts'
import {
  INSTRUMENT_CATEGORIES,
  instrumentPlace,
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
import panel from '../../shared/panel.module.css'
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
  // Opens on the category and kind of the track's own instrument (or of the extra preset it plays).
  const [place, setPlace] = useState(() => {
    const given = state.trackSounds[index]
    const found = findPreset(state.extraSoundFonts, given)
    return found && given ? presetPlace(found.font.name, { name: found.name, program: given.program }, found.font.kind) : instrumentPlace(current.program)
  })
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  // A tone from the library, picked among the instruments of its kind; none means the sound font's samples.
  const { library: toneLibrary } = useTones()
  const savedTone = findTone(toneLibrary, state.trackTones[index])?.id ?? null
  const [toneId, setToneId] = useState<string | null>(savedTone)
  const tone = findTone(toneLibrary, toneId ?? undefined)
  // Or a preset of an extra sound font (data/soundfonts/), offered with the kind of instrument it is.
  const savedSound = findPreset(state.extraSoundFonts, state.trackSounds[index]) ? state.trackSounds[index] : null
  const [sound, setSound] = useState<TrackSound | null>(savedSound)

  const close = () => openTrackEditor(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') openTrackEditor(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const bass = isBassTuning(tuning)
  const tunings = tuningPresets(tuning.length, bass)
  const preset = tunings.find((item) => sameTuning(item.tuning, tuning))
  const stringsChanged = tuning.length !== current.tuning.length
  const tuningChanged = !sameTuning(tuning, current.tuning) || capo !== current.capo
  const programs = useMemo(() => {
    const query = search.trim().toLowerCase()
    const pool = query ? GM_PROGRAMS_EN.map((_, program) => program) : (INSTRUMENT_CATEGORIES[place.category]?.subs[place.sub]?.programs ?? [])
    // Either language matches, whatever the interface shows.
    return pool.filter((program) => !query || GM_PROGRAMS_EN[program].toLowerCase().includes(query) || GM_PROGRAMS_ZH[program].includes(query))
  }, [place, search])
  // The library's tones go with the electric guitars and the basses, by what each tone is for.
  const toneLabel = (item: Tone) => item.name
  const query = search.trim().toLowerCase()
  const toneFamily = query ? null : toneFamilyOf(INSTRUMENT_CATEGORIES[place.category]?.subs[place.sub]?.programs[0] ?? -1)
  const tones =
    query || toneFamily
      ? allTones(toneLibrary).filter((item) => (query ? toneLabel(item).toLowerCase().includes(query) : item.family === toneFamily))
      : []
  const presets = state.extraSoundFonts.flatMap((font) =>
    font.presets
      .filter((preset) => {
        if (query) return preset.name.toLowerCase().includes(query) || font.name.toLowerCase().includes(query)
        const at = presetPlace(font.name, preset, font.kind)
        return at.category === place.category && at.sub === place.sub
      })
      .map((preset) => ({ font: font.name, kind: font.kind, ...preset })),
  )
  // The picked tone plays the preview (and stands in for itself, unchanged, on the tracks that use it).
  useEffect(() => {
    player.setEditedTone(tone)
    return () => player.setEditedTone(null)
  }, [player, tone])

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
    const toneChanged = toneId !== savedTone
    if (toneChanged) player.setTrackTone(index, toneId)
    const soundChanged = !sameSound(sound, savedSound)
    if (soundChanged) player.setTrackSound(index, sound)
    if (Object.keys(edit).length === 0 && (editingTab || ((toneChanged || soundChanged) && !state.trackEdits[index]))) {
      close()
      return
    }
    const moved = player.setTrackEdit(index, Object.keys(edit).length > 0 ? edit : null)
    if (moved > 0)
      setMessage(
        t('已应用；{n} 个音超出音域或无弦可放，已移动八度或删除。', {
          n: moved,
        }),
      )
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
          <p className={panel.hint}>{t('鼓轨只能修改名称。')}</p>
        ) : (
          <>
            <section className={panel.section}>
              <h3>{t('乐器')}</h3>
              <div className={styles.groups} role="tablist" aria-label={t('乐器大类')}>
                {INSTRUMENT_CATEGORIES.map((item, position) => (
                  <button
                    key={item.label}
                    type="button"
                    role="tab"
                    aria-selected={!search && place.category === position}
                    onClick={() => {
                      setPlace({ category: position, sub: 0 })
                      setSearch('')
                    }}
                  >
                    {t(item.label)}
                  </button>
                ))}
              </div>
              {!search && (
                <div className={styles.subGroups} role="tablist" aria-label={t('乐器小类')}>
                  {INSTRUMENT_CATEGORIES[place.category].subs.map((item, position) => (
                    <button
                      key={item.label}
                      type="button"
                      role="tab"
                      aria-selected={place.sub === position}
                      onClick={() => setPlace({ ...place, sub: position })}
                    >
                      {t(item.label)}
                    </button>
                  ))}
                </div>
              )}
              <div className={styles.searchRow}>
                <input
                  type="search"
                  placeholder={t('搜索乐器…')}
                  aria-label={t('搜索乐器…')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button
                  type="button"
                  className={panel.preview}
                  disabled={!state.canPlay}
                  onClick={() => (tone ? player.previewEditedTone() : player.previewInstrument(program, tuning, sound))}
                >
                  <Play size={14} aria-hidden />
                  {t('试听')}
                </button>
              </div>
              <ul className={styles.programs} aria-label={t('乐器')}>
                {programs.length === 0 && tones.length === 0 && presets.length === 0 && <li className={panel.hint}>{t('未找到相应乐器。')}</li>}
                {programs.map((value) => (
                  <li key={value}>
                    <button
                      type="button"
                      aria-pressed={!tone && !sound && value === program}
                      onClick={() => {
                        setProgram(value)
                        setToneId(null)
                        setSound(null)
                      }}
                    >
                      <InstrumentIcon program={value} size={15} />
                      <span>{programName(value, language)}</span>
                    </button>
                  </li>
                ))}
                {tones.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={tone?.id === item.id}
                      onClick={() => {
                        setProgram(toneProgram(item.family, program))
                        setToneId(item.id)
                        setSound(null)
                      }}
                    >
                      <SlidersHorizontal size={15} aria-hidden className={styles.toneIcon} />
                      <span>{toneLabel(item)}</span>
                    </button>
                  </li>
                ))}
                {presets.map((item) => (
                  <li key={`${item.font}/${item.program}`}>
                    <button
                      type="button"
                      title={item.font}
                      aria-pressed={sameSound(sound, item)}
                      onClick={() => {
                        // Its samples carry their own sound, without a tone; the track takes a program of the
                        // preset's kind (a distortion guitar for the electric guitars) unless it has one already.
                        const at = presetPlace(item.font, item, item.kind)
                        const kind = INSTRUMENT_CATEGORIES[at.category].subs[at.sub].programs
                        if (!kind.includes(program)) setProgram(kind.includes(30) ? 30 : kind[0])
                        setToneId(null)
                        setSound({ font: item.font, program: item.program })
                      }}
                    >
                      <AudioWaveform size={15} aria-hidden className={styles.toneIcon} />
                      <span>{item.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className={panel.section}>
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
                      const chosen = tunings.find((item) => item.name === event.target.value)
                      if (chosen) setTuning(chosen.tuning)
                    }}
                  >
                    {!preset && <option value="">{t('自定义调弦')}</option>}
                    {tunings.map((item) => (
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
              <label className={panel.check}>
                <input
                  type="checkbox"
                  checked={stringsChanged || adjust}
                  disabled={!tuningChanged || stringsChanged}
                  onChange={(event) => setAdjust(event.target.checked)}
                />
                {t('调整指法（保持音高，重新排品）')}
              </label>
              {tuningChanged && <p className={panel.hint}>{stringsChanged ? t('改变弦数时必须调整指法。') : t('不勾选时保留谱上的品位，音高随调弦改变。')}</p>}
            </section>
          </>
        )}

        {message && <p className={panel.message}>{message}</p>}

        <footer className={panel.footer}>
          <button
            type="button"
            className={panel.secondary}
            disabled={(editingTab ? !differs(original) : !state.trackEdits[index]) && !savedTone && !savedSound}
            onClick={() => {
              if (savedTone) player.setTrackTone(index, null)
              if (savedSound) player.setTrackSound(index, null)
              if (editingTab) {
                // Back to the track as loaded, keeping the pitches.
                const tuningBack = !sameTuning(original.tuning, current.tuning) || original.capo !== current.capo
                player.setTrackEdit(index, {
                  name: original.name,
                  ...(current.isPercussion || original.program === current.program ? {} : { program: original.program }),
                  ...(current.isPercussion || !tuningBack
                    ? {}
                    : {
                        tuning: original.tuning,
                        capo: original.capo,
                        adjustFingering: true,
                      }),
                })
              } else {
                player.setTrackEdit(index, null)
              }
              close()
            }}
          >
            {t('恢复原样')}
          </button>
          <span className={panel.spacer} />
          <button type="button" className={panel.secondary} onClick={close}>
            {message ? t('关闭') : t('取消')}
          </button>
          {!message && (
            <button type="button" className={panel.primary} onClick={apply}>
              {t('应用')}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

// Track edits ("编辑音轨"): name, instrument, number of strings, tuning and capo of a track, with an
// option to re-fret the notes so they keep sounding the same. Edits are stored per song and applied to the
// score as loaded, before transposition.
import { model, type Settings } from '@coderline/alphatab'
import { refretStaff } from './transpose.ts'

type Json = Record<string, any>

export interface TrackEdit {
  name?: string
  /** General MIDI program 0–127. */
  program?: number
  /** Open-string pitches, highest string first. Its length is the number of strings. */
  tuning?: number[]
  capo?: number
  /**
   * When the tuning or number of strings changes: true re-frets every note so it keeps its pitch ("adjust
   * fingerings"); false keeps the written frets, so the notes sound at the new tuning.
   */
  adjustFingering?: boolean
}

/** Keyed by track index. */
export type TrackEdits = Record<string, TrackEdit>

export interface TrackSetup {
  name: string
  program: number
  isPercussion: boolean
  tuning: number[]
  capo: number
}

export const MIN_STRINGS = 4
export const MAX_STRINGS = 8
export const MAX_CAPO = 12

/** General MIDI program names in English, by program number (Chinese: gmPrograms.ts). */
export { GM_PROGRAMS_EN as GM_PROGRAMS } from './gmPrograms.ts'

export interface InstrumentGroup {
  /** Chinese label; the UI translates it. */
  label: string
  programs: number[]
}

export interface InstrumentCategory {
  /** Chinese label; the UI translates it. */
  label: string
  subs: InstrumentGroup[]
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index)

/** The instrument picker: category, then kind, then the General MIDI sound. Every program appears once. */
export const INSTRUMENT_CATEGORIES: InstrumentCategory[] = [
  {
    label: '吉他',
    subs: [
      { label: '电吉他', programs: range(26, 31) },
      { label: '木吉他', programs: range(24, 25) },
      { label: '贝斯', programs: range(32, 39) },
      { label: '民族弹拨', programs: range(104, 107) },
    ],
  },
  {
    label: '弦乐',
    subs: [
      { label: '提琴', programs: range(40, 44) },
      { label: '拨奏与竖琴', programs: range(45, 46) },
      { label: '弦乐合奏', programs: range(48, 51) },
      { label: '民族弦乐', programs: [110] },
    ],
  },
  {
    label: '管乐',
    subs: [
      { label: '铜管', programs: range(56, 63) },
      { label: '簧管', programs: range(64, 71) },
      { label: '吹管', programs: range(72, 79) },
      { label: '民族管', programs: [109, 111] },
    ],
  },
  {
    label: '打击乐',
    subs: [
      { label: '有音高打击乐', programs: range(8, 15) },
      { label: '定音鼓', programs: [47] },
      { label: '打击乐器', programs: range(112, 119) },
    ],
  },
  {
    label: '键盘乐',
    subs: [
      { label: '钢琴', programs: range(0, 7) },
      { label: '风琴', programs: range(16, 23) },
      { label: '卡林巴', programs: [108] },
    ],
  },
  {
    label: '其他',
    subs: [
      { label: '人声', programs: range(52, 54) },
      { label: '管弦乐打击', programs: [55] },
      { label: '合成主音', programs: range(80, 87) },
      { label: '合成铺底', programs: range(88, 95) },
      { label: '合成效果', programs: range(96, 103) },
      { label: '音效', programs: range(120, 127) },
    ],
  },
]

/** Where a program sits in the picker: category and kind, by position. */
export function instrumentPlace(program: number): { category: number; sub: number } {
  for (const [category, item] of INSTRUMENT_CATEGORIES.entries()) {
    const sub = item.subs.findIndex((group) => group.programs.includes(program))
    if (sub >= 0) return { category, sub }
  }
  return { category: 0, sub: 0 }
}

export interface TuningPreset {
  /** Chinese key for descriptive names ("标准"); note-based names ("Drop D") are the same in every language. */
  name: string
  /** Highest string first. */
  tuning: number[]
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** "E2" for MIDI 40. */
export function pitchName(pitch: number): string {
  return `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`
}

const down = (tuning: number[], semitones: number) => tuning.map((pitch) => pitch - semitones)
const GUITAR_6 = [64, 59, 55, 50, 45, 40]
const GUITAR_7 = [64, 59, 55, 50, 45, 40, 35]
const GUITAR_8 = [64, 59, 55, 50, 45, 40, 35, 30]
const BASS_4 = [43, 38, 33, 28]
const BASS_5 = [43, 38, 33, 28, 23]
const BASS_6 = [48, 43, 38, 33, 28, 23]

/** Common tunings for an instrument with `strings` strings; `bass` picks the bass family. */
export function tuningPresets(strings: number, bass: boolean): TuningPreset[] {
  if (bass) {
    if (strings === 4) {
      return [
        { name: '标准', tuning: BASS_4 },
        { name: 'Drop D', tuning: [43, 38, 33, 26] },
        { name: '降半音调弦', tuning: down(BASS_4, 1) },
        { name: '降全音调弦', tuning: down(BASS_4, 2) },
        { name: 'Drop C', tuning: [41, 36, 31, 24] },
      ]
    }
    if (strings === 5) return [{ name: '标准', tuning: BASS_5 }, { name: '降半音调弦', tuning: down(BASS_5, 1) }]
    if (strings === 6) return [{ name: '标准', tuning: BASS_6 }]
  }
  if (strings === 6) {
    return [
      { name: '标准', tuning: GUITAR_6 },
      { name: 'Drop D', tuning: [64, 59, 55, 50, 45, 38] },
      { name: '降半音调弦', tuning: down(GUITAR_6, 1) },
      { name: '降全音调弦', tuning: down(GUITAR_6, 2) },
      { name: 'Drop C#', tuning: [63, 58, 54, 49, 44, 37] },
      { name: 'Drop C', tuning: [62, 57, 53, 48, 43, 36] },
      { name: 'Open G', tuning: [62, 59, 55, 50, 43, 38] },
      { name: 'Open D', tuning: [62, 57, 54, 50, 45, 38] },
      { name: 'DADGAD', tuning: [62, 57, 55, 50, 45, 38] },
    ]
  }
  if (strings === 7) {
    return [
      { name: '标准', tuning: GUITAR_7 },
      { name: 'Drop A', tuning: [64, 59, 55, 50, 45, 40, 33] },
      { name: '降半音调弦', tuning: down(GUITAR_7, 1) },
    ]
  }
  if (strings === 8) return [{ name: '标准', tuning: GUITAR_8 }, { name: 'Drop E', tuning: [64, 59, 55, 50, 45, 40, 35, 28] }]
  if (strings === 4) return [{ name: '标准', tuning: BASS_4 }]
  if (strings === 5) return [{ name: '标准', tuning: BASS_5 }]
  return []
}

/** A tuning for a new string count: keep the existing strings, add or remove at the low end. */
export function resizeTuning(tuning: number[], strings: number, bass: boolean): number[] {
  const preset = tuningPresets(strings, bass)[0]?.tuning
  if (strings <= tuning.length) return tuning.slice(0, strings)
  const next = [...tuning]
  while (next.length < strings) {
    const fromPreset = preset?.[next.length]
    next.push(fromPreset !== undefined && fromPreset < next[next.length - 1] ? fromPreset : next[next.length - 1] - 5)
  }
  return next
}

export function isBassTuning(tuning: number[]): boolean {
  return tuning.length > 0 && Math.min(...tuning) < 36 && Math.max(...tuning) <= 48
}

/** What a track currently looks like, for filling in the edit form. */
export function trackSetup(score: model.Score, index: number): TrackSetup | null {
  const track = score.tracks[index]
  if (!track) return null
  const staff = track.staves[0]
  return {
    name: track.name,
    program: track.playbackInfo.program,
    isPercussion: staff.isPercussion,
    tuning: [...staff.tuning],
    capo: staff.capo,
  }
}

export interface ApplyResult {
  score: model.Score
  /** Notes that had to move by an octave, or were dropped, while adjusting fingerings. */
  notesMoved: number
}

export function applyTrackEdits(score: model.Score, edits: TrackEdits, settings: Settings): ApplyResult {
  const indexes = Object.keys(edits).map(Number).filter((index) => Number.isInteger(index) && score.tracks[index])
  if (indexes.length === 0) return { score, notesMoved: 0 }
  // A deep copy through alphaTab's own serializer (plain JSON: keys are lower-case).
  const object = JSON.parse(model.JsonConverter.scoreToJson(score)) as Json
  let notesMoved = 0

  for (const index of indexes) {
    const edit = edits[index]
    const track = object.tracks[index] as Json
    if (typeof edit.name === 'string' && edit.name.trim()) {
      track.name = edit.name.trim()
      track.shortname = track.name.slice(0, 10)
    }
    for (const staff of track.staves as Json[]) {
      if (staff.ispercussion) continue
      if (typeof edit.program === 'number' && edit.program >= 0 && edit.program <= 127) {
        track.playbackinfo.program = edit.program
        // Songsterr parts carry their own sound switches (clean at bar 1, distortion at the chorus…) as
        // instrument automations on the beats. They come after the track's program in the MIDI and would put
        // the old sound straight back, so a chosen instrument replaces them for the whole track.
        removeInstrumentAutomations(staff)
      }
      const oldTuning: number[] = staff.stringtuning?.tunings ?? []
      if (oldTuning.length === 0) continue
      const oldCapo = Number(staff.capo ?? 0)
      const tuning = Array.isArray(edit.tuning) && edit.tuning.length >= MIN_STRINGS && edit.tuning.length <= MAX_STRINGS ? edit.tuning : oldTuning
      const capo = typeof edit.capo === 'number' ? Math.min(MAX_CAPO, Math.max(0, Math.round(edit.capo))) : oldCapo
      const tuningChanged = tuning.length !== oldTuning.length || tuning.some((pitch, string) => pitch !== oldTuning[string])

      if (tuningChanged || capo !== oldCapo) {
        if (edit.adjustFingering) {
          notesMoved += refretStaff(staff, { tunings: oldTuning, capo: oldCapo }, { tunings: tuning, capo }, 0)
        } else if (tuning.length !== oldTuning.length) {
          // Keep the written frets, string by string from the top; notes on strings that are gone are dropped.
          notesMoved += keepFrets(staff, oldTuning.length, tuning.length)
        }
        staff.stringtuning = { isstandard: false, name: '', tunings: tuning }
        staff.capo = capo
      }
    }
  }
  return { score: model.JsonConverter.jsonToScore(JSON.stringify(object), settings), notesMoved }
}

const INSTRUMENT_AUTOMATION = 2

function removeInstrumentAutomations(staff: Json) {
  for (const bar of staff.bars as Json[]) {
    for (const voice of bar.voices as Json[]) {
      for (const beat of voice.beats as Json[]) {
        if (Array.isArray(beat.automations)) beat.automations = beat.automations.filter((automation: Json) => automation.type !== INSTRUMENT_AUTOMATION)
      }
    }
  }
}

function keepFrets(staff: Json, oldCount: number, newCount: number): number {
  let dropped = 0
  for (const bar of staff.bars as Json[]) {
    for (const voice of bar.voices as Json[]) {
      for (const beat of voice.beats as Json[]) {
        const kept = (beat.notes as Json[]).filter((note) => {
          if (typeof note.string !== 'number' || note.string < 1) return true
          note.string += newCount - oldCount
          return note.string >= 1
        })
        dropped += beat.notes.length - kept.length
        beat.notes = kept
      }
    }
  }
  return dropped
}

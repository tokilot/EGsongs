// The tab editor: a cursor on one beat and string of one track, and edits made in place on the alphaTab model.
// The commands follow the Songsterr editor's command set (note, beat and bar commands). Every edit records a
// snapshot of what it touches before and after, so undo and redo put back exactly what was there; after each
// one the score is finished again so alphaTab recomputes ties, slides and timing. No DOM and no player: the
// controller renders and plays.
import { model, type Settings } from '@coderline/alphatab'
import {
  cloneBeat,
  relink,
  restoreBar,
  restoreMasterBar,
  restoreStructure,
  restoreTrack,
  snapshotBar,
  snapshotMasterBar,
  snapshotStructure,
  snapshotTrack,
} from './modelClone.ts'

export const MAX_FRET = 24
/** Two digits typed this close together form one fret number ("1", "2" -> 12). */
const SECOND_DIGIT_MS = 800
const TICKS_PER_WHOLE = 3840

export interface EditCursor {
  bar: number
  beat: number
  /** alphaTab numbering: 1 is the lowest string. */
  string: number
}

/** On/off techniques. The first group belongs to the note under the cursor, the second to the whole beat. */
export type NoteFlag = 'hammer' | 'dead' | 'ghost' | 'tie' | 'staccato' | 'pickScrape' | 'leftHandTap'
export type BeatFlag = 'palmMute' | 'letRing' | 'tap' | 'slap' | 'pop' | 'fermata' | 'deadSlapped'
export type Flag = NoteFlag | BeatFlag

const BEAT_FLAGS = new Set<Flag>(['palmMute', 'letRing', 'tap', 'slap', 'pop', 'fermata', 'deadSlapped'])

export type SlideKind = 'none' | 'legato' | 'shift' | 'inBelow' | 'inAbove' | 'outDown' | 'outUp'
export type BendKind = 'none' | 'half' | 'full' | 'oneAndHalf' | 'bendRelease' | 'preBend' | 'preBendRelease' | 'custom'
export type WhammyKind = 'none' | 'dive' | 'deepDive' | 'dip' | 'preDive' | 'custom'
export type StrokeKind = 'none' | 'brushDown' | 'brushUp' | 'arpeggioDown' | 'arpeggioUp'
export type GraceKind = 'none' | 'before' | 'onBeat'

/** Durations offered, longest first. */
export const DURATIONS = [model.Duration.Whole, model.Duration.Half, model.Duration.Quarter, model.Duration.Eighth, model.Duration.Sixteenth, model.Duration.ThirtySecond, model.Duration.SixtyFourth]
/** Tuplets offered: notes in the time of. */
export const TUPLETS: Record<number, number> = { 3: 2, 5: 4, 6: 4, 7: 4, 9: 8 }
/** Tremolo picking is written as slashes through the stem; how fast that is depends on the note value. */
export const TREMOLO_MARKS = [1, 2, 3]

// Bend shapes in alphaTab's units: position 0..60 over the note, value in quarter tones.
const BENDS: Record<Exclude<BendKind, 'none' | 'custom'>, Array<[number, number]>> = {
  half: [[0, 0], [15, 2], [60, 2]],
  full: [[0, 0], [15, 4], [60, 4]],
  oneAndHalf: [[0, 0], [15, 6], [60, 6]],
  bendRelease: [[0, 0], [15, 4], [30, 4], [45, 0]],
  preBend: [[0, 4], [60, 4]],
  preBendRelease: [[0, 4], [30, 4], [60, 0]],
}
const WHAMMIES: Record<Exclude<WhammyKind, 'none' | 'custom'>, Array<[number, number]>> = {
  dive: [[0, 0], [60, -4]],
  deepDive: [[0, 0], [60, -8]],
  dip: [[0, 0], [30, -4], [60, 0]],
  preDive: [[0, -4], [60, -4]],
}

export interface NoteState {
  fret: number
  flags: Record<NoteFlag, boolean>
  slide: SlideKind
  bend: BendKind
  vibrato: model.VibratoType
  harmonic: model.HarmonicType
  accent: model.AccentuationType
  /** Fret of the trill's other note, or null when there is no trill. */
  trill: number | null
}

export interface BeatState {
  duration: number
  dots: number
  /** Notes of the tuplet, or 0 when there is none. */
  tuplet: number
  grace: GraceKind
  isRest: boolean
  flags: Record<BeatFlag, boolean>
  tremolo: number | null
  whammy: WhammyKind
  vibrato: model.VibratoType
  wah: model.WahPedal
  stroke: StrokeKind
  pickStroke: model.PickStroke
  dynamics: model.DynamicValue
  crescendo: model.CrescendoType
  text: string
  /** The lyric under this beat (the first line of lyrics). */
  lyrics: string
  chord: string
}

export interface BarState {
  numerator: number
  denominator: number
  /** Tempo set at this bar, or null when it keeps the one before. */
  tempo: number | null
  /** Tempo in force at this bar. */
  currentTempo: number
  section: string
  repeatStart: boolean
  /** How often the repeat ending at this bar plays in all (0 = no repeat end). */
  repeatCount: number
  /** Alternate ending numbers (1-based) this bar belongs to. */
  endings: number[]
  doubleBar: boolean
  tripletFeel: model.TripletFeel
  keySignature: model.KeySignature
  minor: boolean
}

export interface EditorState {
  cursor: EditCursor
  barCount: number
  beatCount: number
  stringCount: number
  /** The note on the cursor string, if any. */
  note: NoteState | null
  beat: BeatState
  bar: BarState
  /** How full the bar is: its notes against its time signature. */
  barFill: 'full' | 'short' | 'over'
  canUndo: boolean
  canRedo: boolean
  /** Edits since the last save. */
  dirty: boolean
}

interface Operation {
  undo(): void
  redo(): void
}

// 'masterBars' is the bar-wide settings of every bar, for changes that run on until the next change.
// 'track' is a track's setup and all of its bars, for a track edit.
type Scope = 'bar' | 'masterBar' | 'masterBars' | 'structure' | 'track'

export class TabEditor {
  private readonly undoStack: Operation[] = []
  private readonly redoStack: Operation[] = []
  private savedAt = 0
  private changes = 0
  private edits = 0
  private lastDigit: { at: number; cursor: string; value: number } | null = null
  readonly score: model.Score
  readonly trackIndex: number
  private readonly settings: Settings
  cursor: EditCursor

  constructor(score: model.Score, trackIndex: number, settings: Settings, start?: Partial<EditCursor>) {
    this.score = score
    this.trackIndex = trackIndex
    this.settings = settings
    const bar = clampInt(start?.bar ?? 0, 0, score.masterBars.length - 1)
    this.cursor = { bar, beat: 0, string: this.stringCount }
    this.cursor = { bar, beat: clampInt(start?.beat ?? 0, 0, this.voice(bar).beats.length - 1), string: clampInt(start?.string ?? this.stringCount, 1, this.stringCount) }
  }

  /** Goes up with every change to the tab, including undo and redo; cursor moves leave it alone. */
  get revision(): number {
    return this.edits
  }

  get staff(): model.Staff {
    return this.score.tracks[this.trackIndex].staves[0]
  }

  get stringCount(): number {
    return Math.max(1, this.staff.tuning.length)
  }

  /** Percussion is not edited: its "frets" are drum sounds and its lines are not strings. */
  get editable(): boolean {
    return !this.staff.isPercussion && this.staff.tuning.length > 0
  }

  private voice(bar: number): model.Voice {
    return this.staff.bars[bar].voices[0]
  }

  private get masterBar(): model.MasterBar {
    return this.score.masterBars[this.cursor.bar]
  }

  get beat(): model.Beat {
    return this.voice(this.cursor.bar).beats[this.cursor.beat]
  }

  get note(): model.Note | null {
    return this.beat.notes.find((note) => note.string === this.cursor.string) ?? null
  }

  state(): EditorState {
    const beat = this.beat
    const note = this.note
    const voice = this.voice(this.cursor.bar)
    const masterBar = this.masterBar
    const expected = masterBar.calculateDuration(false)
    const actual = voice.beats.filter((item) => item.graceType === model.GraceType.None).reduce((sum, item) => sum + item.displayDuration, 0)
    const staffBar = this.staff.bars[this.cursor.bar]
    return {
      cursor: { ...this.cursor },
      barCount: this.staff.bars.length,
      beatCount: voice.beats.length,
      stringCount: this.stringCount,
      note: note ? noteState(note) : null,
      beat: {
        duration: beat.duration,
        dots: beat.dots,
        tuplet: beat.hasTuplet ? beat.tupletNumerator : 0,
        grace: beat.graceType === model.GraceType.BeforeBeat ? 'before' : beat.graceType === model.GraceType.OnBeat ? 'onBeat' : 'none',
        isRest: beat.notes.length === 0,
        flags: {
          palmMute: beat.notes.length > 0 && beat.notes.every((item) => item.isPalmMute),
          letRing: beat.notes.length > 0 && beat.notes.every((item) => item.isLetRing),
          tap: beat.tap,
          slap: beat.slap,
          pop: beat.pop,
          fermata: masterBar.getFermata(beat) !== null,
          deadSlapped: beat.deadSlapped,
        },
        tremolo: beat.tremoloPicking?.marks || null,
        whammy: whammyKind(beat),
        vibrato: beat.vibrato,
        wah: beat.wahPedal,
        stroke: strokeKind(beat.brushType),
        pickStroke: beat.pickStroke,
        dynamics: beat.dynamics,
        crescendo: beat.crescendo,
        text: beat.text ?? '',
        lyrics: beat.lyrics?.[0] ?? '',
        chord: beat.chordId ? (this.staff.getChord(beat.chordId)?.name ?? beat.chordId) : '',
      },
      bar: {
        numerator: masterBar.timeSignatureNumerator,
        denominator: masterBar.timeSignatureDenominator,
        tempo: masterBar.tempoAutomations[0]?.value ?? null,
        currentTempo: this.tempoAt(this.cursor.bar),
        section: masterBar.section?.text ?? '',
        repeatStart: masterBar.isRepeatStart,
        repeatCount: masterBar.repeatCount,
        endings: Array.from({ length: model.MasterBar.MaxAlternateEndings }, (_, index) => index + 1).filter((ending) => (masterBar.alternateEndings & (1 << (ending - 1))) !== 0),
        doubleBar: masterBar.isDoubleBar,
        tripletFeel: masterBar.tripletFeel,
        keySignature: staffBar.keySignature,
        minor: staffBar.keySignatureType === model.KeySignatureType.Minor,
      },
      barFill: masterBar.isAnacrusis || Math.abs(actual - expected) <= 8 ? 'full' : actual < expected ? 'short' : 'over',
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      dirty: this.changes !== this.savedAt,
    }
  }

  private tempoAt(bar: number): number {
    for (let index = bar; index >= 0; index--) {
      const tempo = this.score.masterBars[index].tempoAutomations[0]
      if (tempo) return tempo.value
    }
    return this.score.tempo || 120
  }

  /** After a save: the current state is the saved one. */
  markSaved() {
    this.savedAt = this.changes
  }

  // ---- cursor ----

  moveTo(cursor: Partial<EditCursor>) {
    const bar = clampInt(cursor.bar ?? this.cursor.bar, 0, this.staff.bars.length - 1)
    const beat = clampInt(cursor.beat ?? (bar === this.cursor.bar ? this.cursor.beat : 0), 0, this.voice(bar).beats.length - 1)
    this.cursor = { bar, beat, string: clampInt(cursor.string ?? this.cursor.string, 1, this.stringCount) }
    this.lastDigit = null
  }

  /** One beat left or right, into the neighbouring bar at the ends. */
  stepBeat(delta: number) {
    let { bar, beat } = this.cursor
    beat += delta
    while (beat < 0 && bar > 0) {
      bar--
      beat += this.voice(bar).beats.length
    }
    while (beat >= this.voice(bar).beats.length && bar < this.staff.bars.length - 1) {
      beat -= this.voice(bar).beats.length
      bar++
    }
    this.moveTo({ bar, beat })
  }

  stepBar(delta: number) {
    this.moveTo({ bar: this.cursor.bar + delta, beat: 0 })
  }

  /** Up the screen is a higher string number (the thinner strings are drawn on top). */
  stepString(delta: number) {
    this.moveTo({ string: this.cursor.string + delta })
  }

  // ---- history ----

  // Runs one edit: snapshot what it touches, change it, snapshot again, and finish the score.
  private change(scope: Scope, mutate: () => void) {
    const score = this.score
    const barIndex = this.cursor.bar
    const take = () => {
      if (scope === 'bar') return snapshotBar(this.staff.bars[barIndex])
      if (scope === 'masterBar') return snapshotMasterBar(score, barIndex)
      if (scope === 'masterBars') return score.masterBars.map((_, index) => snapshotMasterBar(score, index))
      if (scope === 'track') return snapshotTrack(score.tracks[this.trackIndex])
      return snapshotStructure(score)
    }
    const put = (content: ReturnType<typeof take>) => {
      if (scope === 'bar') restoreBar(this.staff.bars[barIndex], content as ReturnType<typeof snapshotBar>)
      else if (scope === 'masterBar') restoreMasterBar(score, barIndex, content as ReturnType<typeof snapshotMasterBar>)
      else if (scope === 'masterBars') (content as ReturnType<typeof snapshotMasterBar>[]).forEach((bar, index) => restoreMasterBar(score, index, bar))
      else if (scope === 'track') restoreTrack(score.tracks[this.trackIndex], content as ReturnType<typeof snapshotTrack>)
      else restoreStructure(score, content as ReturnType<typeof snapshotStructure>)
    }
    const before = take()
    mutate()
    if (scope === 'structure') relink(score)
    const after = take()
    this.finish()
    this.undoStack.push({ undo: () => put(before), redo: () => put(after) })
    this.redoStack.length = 0
    this.changes++
    this.edits++
  }

  // Ties are linked note to note and score.finish() trusts an existing link (copying the fret over), so a link
  // to a note that was deleted or untied would stick. Cleared here, finish() finds the right ones again.
  private finish() {
    for (const bar of this.staff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          for (const note of beat.notes) {
            note.tieOrigin = null
            note.tieDestination = null
          }
        }
      }
    }
    this.score.finish(this.settings)
  }

  undo(): boolean {
    const operation = this.undoStack.pop()
    if (!operation) return false
    operation.undo()
    this.finish()
    this.redoStack.push(operation)
    this.changes--
    this.edits++
    this.moveTo({})
    return true
  }

  redo(): boolean {
    const operation = this.redoStack.pop()
    if (!operation) return false
    operation.redo()
    this.finish()
    this.undoStack.push(operation)
    this.changes++
    this.edits++
    this.moveTo({})
    return true
  }

  // ---- notes ----

  /**
   * Types a digit at the cursor. A second digit soon after on the same spot makes a two-digit fret when that
   * is still playable ("1" then "2" is fret 12); otherwise it starts over.
   */
  typeDigit(digit: number, now = Date.now()) {
    if (!this.editable) return
    const key = `${this.cursor.bar}:${this.cursor.beat}:${this.cursor.string}`
    let fret = digit
    const previous = this.lastDigit
    if (previous && previous.cursor === key && now - previous.at < SECOND_DIGIT_MS && previous.value * 10 + digit <= MAX_FRET && previous.value > 0) {
      fret = previous.value * 10 + digit
    }
    this.setFret(fret)
    this.lastDigit = { at: now, cursor: key, value: fret }
  }

  setFret(fret: number) {
    if (!this.editable) return
    const value = clampInt(fret, 0, MAX_FRET)
    const existing = this.note
    if (existing && existing.fret === value && !existing.isTieDestination && !existing.isDead) return
    this.change('bar', () => {
      const beat = this.beat
      const note = this.note
      if (note) {
        untie(note)
        note.fret = value
        note.isDead = false
        return
      }
      const created = new model.Note()
      created.string = this.cursor.string
      created.fret = value
      // A beat that was a rest becomes a note; an empty placeholder beat becomes real.
      beat.isEmpty = false
      // Palm mute and let ring belong to the beat: a new note joins them.
      if (beat.notes.length > 0 && beat.notes.every((item) => item.isPalmMute)) created.isPalmMute = true
      if (beat.notes.length > 0 && beat.notes.every((item) => item.isLetRing)) created.isLetRing = true
      beat.addNote(created)
    })
  }

  removeNote() {
    if (!this.note) return
    this.change('bar', () => {
      const note = this.note
      if (note) this.beat.removeNote(note)
    })
  }

  /**
   * Moves the note to the next string up or down, keeping its pitch (the fret changes accordingly). Does
   * nothing when that string is taken or the pitch cannot be fretted there.
   */
  moveNote(delta: number) {
    const note = this.note
    if (!note || !this.editable) return
    const target = this.cursor.string + delta
    if (target < 1 || target > this.stringCount || this.beat.notes.some((item) => item.string === target)) return
    const tuning = this.staff.tuning
    const fret = note.fret + tuning[tuning.length - this.cursor.string] - tuning[tuning.length - target]
    if (fret < 0 || fret > MAX_FRET) return
    this.change('bar', () => {
      const moved = this.note
      if (!moved) return
      this.beat.removeNote(moved)
      moved.string = target
      moved.fret = fret
      this.beat.addNote(moved)
    })
    this.moveTo({ string: target })
  }

  /** Turns the beat into a rest. */
  clearBeat() {
    if (this.beat.notes.length === 0) return
    this.change('bar', () => {
      const beat = this.beat
      for (const note of [...beat.notes]) beat.removeNote(note)
    })
  }

  toggle(flag: Flag) {
    if (!this.editable) return
    if (BEAT_FLAGS.has(flag)) {
      this.toggleBeatFlag(flag as BeatFlag)
      return
    }
    if (!this.note) return
    const on = !noteState(this.note).flags[flag as NoteFlag]
    const previous = this.previousOnString()
    this.change('bar', () => {
      const note = this.note!
      switch (flag as NoteFlag) {
        case 'hammer':
          note.isHammerPullOrigin = on
          break
        case 'dead':
          note.isDead = on
          break
        case 'ghost':
          note.isGhost = on
          break
        case 'staccato':
          note.isStaccato = on
          break
        case 'leftHandTap':
          note.isLeftHandTapped = on
          break
        case 'pickScrape':
          note.slideOutType = on ? model.SlideOutType.PickSlideDown : model.SlideOutType.None
          break
        case 'tie':
          if (!on) untie(note)
          note.isTieDestination = on
          // A tied note continues the one before it, so it takes its fret.
          if (on && previous) note.fret = previous.fret
          break
      }
    })
  }

  private toggleBeatFlag(flag: BeatFlag) {
    const state = this.state().beat.flags
    const on = !state[flag]
    if ((flag === 'palmMute' || flag === 'letRing') && this.beat.notes.length === 0) return
    if (flag === 'fermata') {
      this.change('masterBar', () => {
        const masterBar = this.masterBar
        const offset = this.beat.playbackStart
        if (on) {
          const fermata = new model.Fermata()
          fermata.type = model.FermataType.Medium
          fermata.length = 1
          masterBar.addFermata(offset, fermata)
        } else {
          masterBar.fermata?.delete(offset)
          if (this.beat.index === 0) masterBar.fermata?.delete(0)
          // Otherwise score.finish() puts the beat's own copy back into the bar.
          for (const track of this.score.tracks) {
            for (const staff of track.staves) for (const voice of staff.bars[this.cursor.bar].voices) for (const beat of voice.beats) if (beat.playbackStart === offset) beat.fermata = null
          }
        }
      })
      return
    }
    this.change('bar', () => {
      const beat = this.beat
      if (flag === 'palmMute') for (const note of beat.notes) note.isPalmMute = on
      else if (flag === 'letRing') for (const note of beat.notes) note.isLetRing = on
      else if (flag === 'tap') beat.tap = on
      else if (flag === 'slap') beat.slap = on
      else if (flag === 'pop') beat.pop = on
      else if (flag === 'deadSlapped') beat.deadSlapped = on
    })
  }

  /** The note on the cursor string in the beat before, for ties. */
  private previousOnString(): model.Note | null {
    let previous = this.beat.previousBeat
    while (previous) {
      const note = previous.notes.find((item) => item.string === this.cursor.string)
      if (note) return note
      if (previous.notes.length > 0) return null
      previous = previous.previousBeat
    }
    return null
  }

  private editNote(apply: (note: model.Note) => void) {
    if (!this.note || !this.editable) return
    this.change('bar', () => {
      const note = this.note
      if (note) apply(note)
    })
  }

  setSlide(kind: SlideKind) {
    this.editNote((note) => {
      const isIn = kind === 'inBelow' || kind === 'inAbove'
      if (kind === 'none') {
        note.slideInType = model.SlideInType.None
        note.slideOutType = model.SlideOutType.None
      } else if (isIn) {
        note.slideInType = kind === 'inBelow' ? model.SlideInType.IntoFromBelow : model.SlideInType.IntoFromAbove
      } else {
        note.slideOutType = {
          legato: model.SlideOutType.Legato,
          shift: model.SlideOutType.Shift,
          outDown: model.SlideOutType.OutDown,
          outUp: model.SlideOutType.OutUp,
        }[kind]
      }
    })
  }

  setBend(kind: Exclude<BendKind, 'custom'>) {
    this.editNote((note) => {
      note.bendPoints = null
      note.maxBendPoint = null
      note.bendType = model.BendType.None
      if (kind !== 'none') for (const [offset, value] of BENDS[kind]) note.addBendPoint(new model.BendPoint(offset, value))
    })
  }

  setVibrato(vibrato: model.VibratoType) {
    this.editNote((note) => (note.vibrato = vibrato))
  }

  /** Natural harmonics sound at their fret's node; the others an octave over the fretted note. */
  setHarmonic(type: model.HarmonicType) {
    this.editNote((note) => {
      note.harmonicType = type
      note.harmonicValue = type === model.HarmonicType.None ? 0 : type === model.HarmonicType.Natural ? note.fret : note.fret + 12
    })
  }

  setAccent(accent: model.AccentuationType) {
    this.editNote((note) => (note.accentuated = accent))
  }

  /** A trill between the note and another fret on the same string; null removes it. */
  setTrill(fret: number | null) {
    this.editNote((note) => {
      if (fret === null) {
        note.trillValue = -1
        return
      }
      note.trillValue = clampInt(fret, 0, MAX_FRET) + model.Note.getStringTuning(this.staff, note.string) + this.staff.capo
      note.trillSpeed = model.Duration.Sixteenth
    })
  }

  // ---- beats ----

  private editBeat(apply: (beat: model.Beat) => void) {
    this.change('bar', () => apply(this.beat))
  }

  setDuration(duration: model.Duration) {
    if (this.beat.duration === duration) return
    this.editBeat((beat) => (beat.duration = duration))
  }

  /** Twice as long or half as long, within the offered range. */
  stepDuration(longer: boolean) {
    const position = DURATIONS.indexOf(this.beat.duration)
    this.setDuration(DURATIONS[clampInt((position < 0 ? 2 : position) + (longer ? -1 : 1), 0, DURATIONS.length - 1)])
  }

  setDots(dots: number) {
    if (this.beat.dots === dots) return
    this.editBeat((beat) => (beat.dots = clampInt(dots, 0, 2)))
  }

  /** Single dot on or off (the "." key). */
  toggleDot() {
    this.setDots(this.beat.dots > 0 ? 0 : 1)
  }

  /** n notes in the time of TUPLETS[n]; 0 removes the tuplet. */
  setTuplet(notes: number) {
    this.editBeat((beat) => {
      const denominator = TUPLETS[notes]
      beat.tupletNumerator = denominator ? notes : -1
      beat.tupletDenominator = denominator ?? -1
    })
  }

  setGrace(kind: GraceKind) {
    this.editBeat((beat) => {
      beat.graceType = kind === 'before' ? model.GraceType.BeforeBeat : kind === 'onBeat' ? model.GraceType.OnBeat : model.GraceType.None
      // Grace notes are short by nature.
      if (kind !== 'none' && beat.duration < model.Duration.ThirtySecond) beat.duration = model.Duration.ThirtySecond
    })
  }

  /** Tremolo picking with this many slashes; null removes it. */
  setTremolo(marks: number | null) {
    this.editBeat((beat) => {
      if (!marks) {
        beat.tremoloPicking = undefined
        return
      }
      const effect = new model.TremoloPickingEffect()
      effect.marks = clampInt(marks, 1, 5)
      beat.tremoloPicking = effect
    })
  }

  setWhammy(kind: Exclude<WhammyKind, 'custom'>) {
    this.editBeat((beat) => {
      beat.whammyBarPoints = null
      beat.maxWhammyPoint = null
      beat.minWhammyPoint = null
      beat.whammyBarType = model.WhammyType.None
      if (kind !== 'none') for (const [offset, value] of WHAMMIES[kind]) beat.addWhammyBarPoint(new model.BendPoint(offset, value))
    })
  }

  /** Vibrato with the tremolo bar, for the whole beat. */
  setBeatVibrato(vibrato: model.VibratoType) {
    this.editBeat((beat) => (beat.vibrato = vibrato))
  }

  setWah(wah: model.WahPedal) {
    this.editBeat((beat) => (beat.wahPedal = wah))
  }

  setStroke(kind: StrokeKind) {
    this.editBeat((beat) => {
      beat.brushType = {
        none: model.BrushType.None,
        brushDown: model.BrushType.BrushDown,
        brushUp: model.BrushType.BrushUp,
        arpeggioDown: model.BrushType.ArpeggioDown,
        arpeggioUp: model.BrushType.ArpeggioUp,
      }[kind]
      beat.brushDuration = kind.startsWith('arpeggio') ? 240 : 60
    })
  }

  setPickStroke(stroke: model.PickStroke) {
    this.editBeat((beat) => (beat.pickStroke = stroke))
  }

  setDynamics(dynamics: model.DynamicValue) {
    this.editBeat((beat) => {
      beat.dynamics = dynamics
      for (const note of beat.notes) note.dynamics = dynamics
    })
  }

  setCrescendo(crescendo: model.CrescendoType) {
    this.editBeat((beat) => (beat.crescendo = crescendo))
  }

  setText(text: string) {
    const value = text.trim()
    if ((this.beat.text ?? '') === value) return
    this.editBeat((beat) => (beat.text = value || null))
  }

  /** The lyric sung on this beat, shown under the tab; empty removes it. */
  setLyrics(text: string) {
    const value = text.trim()
    if ((this.beat.lyrics?.[0] ?? '') === value) return
    this.editBeat((beat) => {
      const lines = [...(beat.lyrics ?? [])]
      lines[0] = value
      // Further lines (other verses) stay; with none left the beat has no lyrics.
      beat.lyrics = lines.some((line) => line) ? lines : null
    })
  }

  /** A chord name over the beat; empty removes it. */
  setChord(name: string) {
    const value = name.trim()
    this.editBeat((beat) => {
      if (!value) {
        beat.chordId = null
        return
      }
      if (!this.staff.hasChord(value)) {
        const chord = new model.Chord()
        chord.name = value
        chord.showDiagram = false
        chord.showFingering = false
        this.staff.addChord(value, chord)
      }
      beat.chordId = value
    })
  }

  /** A rest of the same length right after the cursor beat, and the cursor moves onto it. */
  insertBeat() {
    const at = this.cursor.beat + 1
    this.change('bar', () => {
      const voice = this.voice(this.cursor.bar)
      const beat = new model.Beat()
      beat.duration = this.beat.duration
      beat.dots = this.beat.dots
      beat.voice = voice
      voice.beats.splice(at, 0, beat)
    })
    this.moveTo({ beat: at })
  }

  /** Removes the cursor beat. The last beat of a bar is cleared instead, a bar always keeps one. */
  deleteBeat() {
    const voice = this.voice(this.cursor.bar)
    if (voice.beats.length <= 1) {
      this.clearBeat()
      return
    }
    const at = this.cursor.beat
    this.change('bar', () => voice.beats.splice(at, 1))
    this.moveTo({ beat: Math.min(at, voice.beats.length - 1) })
  }

  // ---- bars ----

  private editMasterBar(apply: (bar: model.MasterBar) => void) {
    this.change('masterBar', () => apply(this.masterBar))
  }

  /** From this bar on (until the next change), as in the score itself. */
  setTimeSignature(numerator: number, denominator: number) {
    const num = clampInt(numerator, 1, 32)
    const den = [1, 2, 4, 8, 16, 32].includes(denominator) ? denominator : 4
    // Every later bar that had the old signature takes the new one, up to the next change.
    const start = this.cursor.bar
    const old = [this.masterBar.timeSignatureNumerator, this.masterBar.timeSignatureDenominator]
    this.change('masterBars', () => {
      for (let index = start; index < this.score.masterBars.length; index++) {
        const bar = this.score.masterBars[index]
        if (index > start && (bar.timeSignatureNumerator !== old[0] || bar.timeSignatureDenominator !== old[1])) break
        bar.timeSignatureNumerator = num
        bar.timeSignatureDenominator = den
        bar.timeSignatureCommon = false
      }
    })
  }

  /** A tempo change at the start of this bar; null removes it (the previous tempo carries on). */
  setTempo(bpm: number | null) {
    this.editMasterBar((bar) => {
      bar.tempoAutomations = bpm === null ? [] : [model.Automation.buildTempoAutomation(false, 0, clampInt(bpm, 10, 400), 2)]
    })
  }

  setSection(text: string) {
    const value = text.trim()
    this.editMasterBar((bar) => {
      if (!value) {
        bar.section = null
        return
      }
      const section = new model.Section()
      section.text = value
      bar.section = section
    })
  }

  toggleRepeatStart() {
    this.editMasterBar((bar) => (bar.isRepeatStart = !bar.isRepeatStart))
  }

  /** The repeat that ends with this bar plays `count` times in all; 0 removes it. */
  setRepeatEnd(count: number) {
    this.editMasterBar((bar) => (bar.repeatCount = count <= 1 ? 0 : clampInt(count, 2, 16)))
  }

  /** Which alternate endings (1-based) this bar belongs to. */
  setEndings(endings: number[]) {
    this.editMasterBar((bar) => {
      bar.alternateEndings = endings.filter((ending) => ending >= 1 && ending <= model.MasterBar.MaxAlternateEndings).reduce((mask, ending) => mask | (1 << (ending - 1)), 0)
    })
  }

  toggleDoubleBar() {
    this.editMasterBar((bar) => (bar.isDoubleBar = !bar.isDoubleBar))
  }

  setTripletFeel(feel: model.TripletFeel) {
    this.editMasterBar((bar) => (bar.tripletFeel = feel))
  }

  /** For every track, from this bar until the next change of key. */
  setKeySignature(key: model.KeySignature, minor: boolean) {
    const start = this.cursor.bar
    this.change('masterBars', () => {
      for (const track of this.score.tracks) {
        for (const staff of track.staves) {
          const old = staff.bars[start]?.keySignature
          for (let index = start; index < staff.bars.length; index++) {
            const bar = staff.bars[index]
            if (index > start && bar.keySignature !== old) break
            bar.keySignature = key
            bar.keySignatureType = minor ? model.KeySignatureType.Minor : model.KeySignatureType.Major
          }
        }
      }
    })
  }

  // ---- track ----

  /**
   * Takes over this track's setup (name, instrument, tuning, capo) and notes from `source`: a copy of the
   * score with a track edit applied (trackEdits.ts). One step in the history, like any other edit.
   */
  replaceTrack(source: model.Score) {
    const from = source.tracks[this.trackIndex]
    if (!from || from.staves.length !== this.score.tracks[this.trackIndex].staves.length) return
    this.change('track', () => restoreTrack(this.score.tracks[this.trackIndex], snapshotTrack(from)))
    // The number of strings may have changed.
    this.moveTo({})
  }

  /** An empty bar (rests) after the cursor bar, in every track; the cursor moves into it. */
  insertBar() {
    const at = this.cursor.bar + 1
    this.change('structure', () => this.insertBarAt(at, null))
    this.moveTo({ bar: at, beat: 0 })
  }

  /** A copy of the cursor bar right after it, in every track. */
  duplicateBar() {
    const from = this.cursor.bar
    this.change('structure', () => this.insertBarAt(from + 1, from))
    this.moveTo({ bar: from + 1, beat: 0 })
  }

  private insertBarAt(at: number, copyOf: number | null) {
    const template = this.score.masterBars[Math.min(at - 1, this.score.masterBars.length - 1)]
    const masterBar = new model.MasterBar()
    masterBar.timeSignatureNumerator = template.timeSignatureNumerator
    masterBar.timeSignatureDenominator = template.timeSignatureDenominator
    masterBar.tripletFeel = template.tripletFeel
    this.score.masterBars.splice(at, 0, masterBar)
    masterBar.score = this.score
    for (const track of this.score.tracks) {
      for (const staff of track.staves) {
        const reference = staff.bars[Math.min(at - 1, staff.bars.length - 1)]
        const bar = new model.Bar()
        bar.clef = reference.clef
        bar.keySignature = reference.keySignature
        bar.keySignatureType = reference.keySignatureType
        staff.bars.splice(at, 0, bar)
        bar.staff = staff
        reference.voices.forEach((_, index) => {
          const voice = new model.Voice()
          bar.addVoice(voice)
          if (copyOf !== null) {
            for (const beat of staff.bars[copyOf].voices[index].beats) voice.addBeat(cloneBeat(beat))
            return
          }
          // The first voice gets rests filling the bar, the others an empty placeholder.
          if (index === 0) for (const rest of restsFor(masterBar.calculateDuration(false))) voice.addBeat(rest)
          else {
            const empty = new model.Beat()
            empty.isEmpty = true
            voice.addBeat(empty)
          }
        })
      }
    }
  }

  /** Removes the cursor bar from every track. The last bar of the song stays. */
  deleteBar() {
    if (this.score.masterBars.length <= 1) return
    const at = this.cursor.bar
    this.change('structure', () => {
      this.score.masterBars.splice(at, 1)
      for (const track of this.score.tracks) for (const staff of track.staves) staff.bars.splice(at, 1)
    })
    this.moveTo({ bar: Math.min(at, this.score.masterBars.length - 1), beat: 0 })
  }

  /** Adds rests at the end of a bar that is shorter than its time signature. */
  fillBarWithRests() {
    const voice = this.voice(this.cursor.bar)
    const expected = this.masterBar.calculateDuration(false)
    const actual = voice.beats.filter((beat) => beat.graceType === model.GraceType.None && !beat.isEmpty).reduce((sum, beat) => sum + beat.displayDuration, 0)
    if (actual >= expected - 8) return
    this.change('bar', () => {
      const target = this.voice(this.cursor.bar)
      // An empty placeholder beat gives way to the rests.
      target.beats = target.beats.filter((beat) => !beat.isEmpty)
      for (const rest of restsFor(expected - actual)) {
        rest.voice = target
        target.beats.push(rest)
      }
    })
  }
}

/** The fewest plain rests that add up to `ticks`, longest first. */
function restsFor(ticks: number): model.Beat[] {
  const rests: model.Beat[] = []
  let left = ticks
  for (const duration of DURATIONS) {
    const length = TICKS_PER_WHOLE / duration
    while (left >= length - 1) {
      const rest = new model.Beat()
      rest.duration = duration
      rests.push(rest)
      left -= length
    }
  }
  if (rests.length === 0) {
    const rest = new model.Beat()
    rest.duration = model.Duration.Quarter
    rests.push(rest)
  }
  return rests
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)))
}

// Clearing the flag is not enough: while the note still links to the one it was tied to, score.finish() keeps
// copying that note's fret onto it.
function untie(note: model.Note) {
  if (note.tieOrigin && note.tieOrigin.tieDestination === note) note.tieOrigin.tieDestination = null
  note.tieOrigin = null
  note.isTieDestination = false
}

function sameShape(points: model.BendPoint[] | null, shape: Array<[number, number]>): boolean {
  return !!points && points.length === shape.length && points.every((point, index) => point.offset === shape[index][0] && point.value === shape[index][1])
}

// score.finish() simplifies the bend points and names the shape, so read the shape from that.
function bendKind(note: model.Note): BendKind {
  if (!note.hasBend) return 'none'
  const peak = Math.max(...(note.bendPoints ?? []).map((point) => point.value))
  switch (note.bendType) {
    case model.BendType.Bend:
      return peak === 2 ? 'half' : peak === 4 ? 'full' : peak === 6 ? 'oneAndHalf' : 'custom'
    case model.BendType.BendRelease:
      return peak === 4 ? 'bendRelease' : 'custom'
    case model.BendType.Prebend:
      return peak === 4 ? 'preBend' : 'custom'
    case model.BendType.PrebendRelease:
      return peak === 4 ? 'preBendRelease' : 'custom'
    default:
      return 'custom'
  }
}

function noteState(note: model.Note): NoteState {
  const bend = bendKind(note)
  const slide: SlideKind =
    note.slideOutType === model.SlideOutType.Legato
      ? 'legato'
      : note.slideOutType === model.SlideOutType.Shift
        ? 'shift'
        : note.slideOutType === model.SlideOutType.OutDown
          ? 'outDown'
          : note.slideOutType === model.SlideOutType.OutUp
            ? 'outUp'
            : note.slideInType === model.SlideInType.IntoFromBelow
              ? 'inBelow'
              : note.slideInType === model.SlideInType.IntoFromAbove
                ? 'inAbove'
                : 'none'
  return {
    fret: note.fret,
    flags: {
      hammer: note.isHammerPullOrigin,
      dead: note.isDead,
      ghost: note.isGhost,
      tie: note.isTieDestination,
      staccato: note.isStaccato,
      pickScrape: note.slideOutType === model.SlideOutType.PickSlideDown || note.slideOutType === model.SlideOutType.PickSlideUp,
      leftHandTap: note.isLeftHandTapped,
    },
    slide,
    bend,
    vibrato: note.vibrato,
    harmonic: note.harmonicType,
    accent: note.accentuated,
    trill: note.isTrill ? note.trillFret : null,
  }
}

function whammyKind(beat: model.Beat): WhammyKind {
  if (!beat.hasWhammyBar) return 'none'
  for (const [kind, shape] of Object.entries(WHAMMIES)) if (sameShape(beat.whammyBarPoints, shape)) return kind as WhammyKind
  return 'custom'
}

function strokeKind(brush: model.BrushType): StrokeKind {
  switch (brush) {
    case model.BrushType.BrushDown:
      return 'brushDown'
    case model.BrushType.BrushUp:
      return 'brushUp'
    case model.BrushType.ArpeggioDown:
      return 'arpeggioDown'
    case model.BrushType.ArpeggioUp:
      return 'arpeggioUp'
    default:
      return 'none'
  }
}

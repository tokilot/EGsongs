// "Import a MIDI file": the notes of a .mid (from a transcription model, a DAW, anywhere) turned into a tab. The
// file only has notes with start and end times, so this does what a person writing the tab would:
// - lays bars over the ticks by the file's time signatures (4/4 when it has none) and takes its tempo per bar;
// - snaps each beat's onsets to the grid that fits them best (16ths, 32nds, 8th or 16th triplets), notes that start
//   together being one chord, and cuts a note where the next one starts (one voice per track);
// - writes each note as the note values that fill its time, tied where it crosses a beat or bar it cannot span;
// - picks a string and fret for every note of guitars and basses, keeping the hand where it is (fewest jumps, no
//   stretches), with a tuning low enough for the lowest note (drop D, 7 or 8 strings; 5-string bass);
// - drums (channel 10) become a drum track; every other part gets a guitar or bass tab, whatever its sound
//   (transcriptions often get the sound wrong, or leave it at piano). The sound stays the file's; standard
//   notation can be shown next to the tab as for any song.
// The result goes into the library as a Guitar Pro 7 file, like a blank tab (blankScore.ts).
import * as alphaTab from '@coderline/alphatab'
import { translate } from '../../shared/ui/i18n.ts'
import { programName } from '../player/gmPrograms.ts'
import { readMidiFile, type MidiFile, type MidiPart } from './midiFile.ts'

type Score = alphaTab.model.Score
const { model } = alphaTab

/** alphaTab's ticks per quarter note; the file's ticks are scaled to these. */
const QUARTER = 960
const WHOLE = QUARTER * 4
/** Onsets this close together (a 64th) are played as one chord. */
const CHORD_SPREAD = 60
/** A rest shorter than a 16th after a note is given to the note instead: readable, and nobody plays that rest. */
const SHORTEST_REST = 240
const MAX_FRET = 24
const MAX_BARS = 3000
const PERCUSSION_CHANNEL = 9

export const MIDI_EXTENSIONS = /\.(mid|midi)$/i

type Kind = 'guitar' | 'bass' | 'drums'

/** A part with no guitar or bass sound is a bass when its middle note is below this (A2). */
const BASS_BELOW = 45

interface Bar {
  start: number
  length: number
  numerator: number
  denominator: number
  /** The beat the grid is chosen per: the time signature's note value. */
  beat: number
}

/** The grid a beat's onsets were snapped to; triplet beats are written in equal triplet notes. */
interface Grid {
  step: number
  triplet: boolean
}

/** A chord (or single note) after snapping, from its start to where the next one starts or it ends. */
interface Chord {
  start: number
  end: number
  pitches: number[]
}

/** One written note value of a chord or rest. */
interface Piece {
  ticks: number
  duration: alphaTab.model.Duration
  dots: number
  triplet: boolean
}

interface Fingering {
  notes: Array<{ string: number; fret: number }>
  cost: number
  /** Middle of the fretted notes, or null when all are open strings. */
  position: number | null
}

/** The tunings a part can get (highest string first): the one whose lowest string is closest below its lowest note,
 * the earlier of two with the same lowest string. A MIDI file does not say how the instrument was tuned. */
const GUITAR_TUNINGS = [
  [64, 59, 55, 50, 45, 40],
  [63, 58, 54, 49, 44, 39],
  [64, 59, 55, 50, 45, 38],
  [63, 58, 54, 49, 44, 37],
  [62, 57, 53, 48, 43, 36],
  [64, 59, 55, 50, 45, 40, 35],
  [64, 59, 55, 50, 45, 40, 33],
  [64, 59, 55, 50, 45, 40, 35, 30],
]
const BASS_TUNINGS = [
  [43, 38, 33, 28],
  [42, 37, 32, 27],
  [43, 38, 33, 26],
  [43, 38, 33, 28, 23],
]

/** A MIDI file as a Guitar Pro 7 file for the library. */
export function midiTabFile(bytes: Uint8Array, title: string): Uint8Array {
  return new alphaTab.exporter.Gp7Exporter().export(midiToScore(bytes, title), new alphaTab.Settings())
}

export function midiToScore(bytes: Uint8Array, title: string): Score {
  const file = readMidiFile(bytes)
  if (file.parts.length === 0) throw new Error(translate('这个 MIDI 文件里没有音符。'))
  const scale = QUARTER / file.ticksPerQuarter
  const toTicks = (tick: number) => Math.round(tick * scale)
  const end = Math.max(...file.parts.flatMap((part) => part.notes.map((note) => toTicks(note.end))))
  const bars = layBars(file, toTicks, end)

  const score = new model.Score()
  score.title = title
  for (const bar of bars) {
    const masterBar = new model.MasterBar()
    masterBar.timeSignatureNumerator = bar.numerator
    masterBar.timeSignatureDenominator = bar.denominator
    score.addMasterBar(masterBar)
  }
  applyTempos(score, file, toTicks, bars)

  let nextChannel = 0
  const takeChannel = () => {
    if (nextChannel === PERCUSSION_CHANNEL) nextChannel++
    return Math.min(nextChannel++, 15)
  }
  const parts = mergeParts(file.parts)
  const sharedNames = new Set(parts.filter((part, _, all) => all.some((other) => other !== part && other.track === part.track)).map((part) => part.track))
  for (const part of parts) {
    const kind = kindOf(part)
    const track = new model.Track()
    track.ensureStaveCount(1)
    // A name shared by several channels (a type 0 file) names none of them.
    track.name = (!sharedNames.has(part.track) && part.name) || (kind === 'drums' ? 'Drums' : programName(part.program, 'en'))
    track.shortName = track.name.slice(0, 10)
    if (kind === 'drums') {
      track.playbackInfo.program = 0
      track.playbackInfo.primaryChannel = PERCUSSION_CHANNEL
      track.playbackInfo.secondaryChannel = PERCUSSION_CHANNEL
    } else {
      track.playbackInfo.program = part.program
      track.playbackInfo.primaryChannel = takeChannel()
      track.playbackInfo.secondaryChannel = takeChannel()
    }
    score.addTrack(track)
    buildStaff(track.staves[0], part, kind, toTicks, bars, file)
  }

  score.finish(new alphaTab.Settings())
  return score
}

/**
 * One instrument per track of the file: channels of one track with the same sound are one part (Guitar Pro and
 * alphaTab put bent notes on a second channel). Drums stay apart.
 */
function mergeParts(parts: MidiPart[]): MidiPart[] {
  const merged = new Map<string, MidiPart>()
  for (const part of parts) {
    const key = part.channel === PERCUSSION_CHANNEL ? `${part.track}:${part.channel}` : `${part.track}:program ${part.program}`
    const known = merged.get(key)
    if (known) known.notes = [...known.notes, ...part.notes].sort((a, b) => a.start - b.start || b.pitch - a.pitch)
    else merged.set(key, { ...part, notes: [...part.notes] })
  }
  return [...merged.values()]
}

function kindOf(part: MidiPart): Kind {
  if (part.channel === PERCUSSION_CHANNEL) return 'drums'
  if (part.program >= 24 && part.program <= 31) return 'guitar'
  if (part.program >= 32 && part.program <= 39) return 'bass'
  const pitches = part.notes.map((note) => note.pitch).sort((a, b) => a - b)
  return pitches[pitches.length >> 1] < BASS_BELOW ? 'bass' : 'guitar'
}

/** Bars over the whole file: a time signature change takes effect at the first bar line at or after it. */
function layBars(file: MidiFile, toTicks: (tick: number) => number, end: number): Bar[] {
  const changes = file.timeSignatures.map((change) => ({ ...change, tick: toTicks(change.tick) }))
  const bars: Bar[] = []
  let numerator = 4
  let denominator = 4
  let next = 0
  for (let tick = 0; tick < end || bars.length === 0; ) {
    while (next < changes.length && changes[next].tick <= tick + CHORD_SPREAD) {
      numerator = Math.min(changes[next].numerator, 32)
      denominator = changes[next].denominator
      next++
    }
    const beat = WHOLE / denominator
    bars.push({ start: tick, length: numerator * beat, numerator, denominator, beat })
    if (bars.length > MAX_BARS) throw new Error(translate('这个 MIDI 文件太长了。'))
    tick += numerator * beat
  }
  return bars
}

/** One tempo per bar (the average over it, to the nearest BPM), written where it changes. */
function applyTempos(score: Score, file: MidiFile, toTicks: (tick: number) => number, bars: Bar[]) {
  const tempos = file.tempos.map((tempo) => ({ tick: toTicks(tempo.tick), bpm: tempo.bpm }))
  if (tempos.length === 0 || tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: tempos[0]?.bpm ?? 120 })
  let last = 0
  for (const [index, bar] of bars.entries()) {
    const barEnd = bar.start + bar.length
    let sum = 0
    for (const [at, tempo] of tempos.entries()) {
      const from = Math.max(tempo.tick, bar.start)
      const to = Math.min(tempos[at + 1]?.tick ?? Infinity, barEnd)
      if (to > from) sum += tempo.bpm * (to - from)
    }
    const bpm = Math.min(Math.max(Math.round(sum / bar.length), 20), 400)
    if (bpm !== last) score.masterBars[index].tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0, bpm, 2))
    last = bpm
  }
}

function barIndexAt(bars: Bar[], tick: number) {
  let low = 0
  let high = bars.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (bars[middle].start <= tick) low = middle
    else high = middle - 1
  }
  return low
}

/** The bar and beat a tick falls in, and where that beat starts. */
function beatAt(bars: Bar[], tick: number) {
  const barIndex = barIndexAt(bars, tick)
  const bar = bars[barIndex]
  const beatIndex = Math.max(0, Math.min(Math.floor((tick - bar.start) / bar.beat), bar.numerator - 1))
  return { key: barIndex * 64 + beatIndex, bar, start: bar.start + beatIndex * bar.beat }
}

function gridsFor(beat: number): Array<Grid & { penalty: number }> {
  const grids: Array<Grid & { penalty: number }> = []
  if (beat % 240 === 0) grids.push({ step: 240, triplet: false, penalty: 0 })
  if (beat >= QUARTER) grids.push({ step: beat / 3, triplet: true, penalty: 60 })
  if (beat % 120 === 0) grids.push({ step: 120, triplet: false, penalty: 100 })
  if (beat >= QUARTER) grids.push({ step: beat / 6, triplet: true, penalty: 140 })
  return grids.length > 0 ? grids : [{ step: beat, triplet: false, penalty: 0 }]
}

const STRAIGHT = { step: 240, triplet: false }

/** The part's notes as chords on a grid, one after another; plus the grid each beat with onsets was given. */
function quantize(part: MidiPart, kind: Kind, toTicks: (tick: number) => number, bars: Bar[]) {
  const notes = part.notes.map((note) => ({ start: toTicks(note.start), end: toTicks(note.end), pitch: note.pitch }))
  // Onsets close together are one chord, at their average time.
  const clusters: Array<{ tick: number; notes: typeof notes }> = []
  for (const note of notes) {
    const last = clusters.at(-1)
    if (last && note.start - last.notes[0].start <= CHORD_SPREAD) last.notes.push(note)
    else clusters.push({ tick: note.start, notes: [note] })
  }
  for (const cluster of clusters) cluster.tick = cluster.notes.reduce((sum, note) => sum + note.start, 0) / cluster.notes.length

  // An onset just before a beat belongs to that beat (it is snapped onto it).
  const byBeat = new Map<number, typeof clusters>()
  for (const cluster of clusters) {
    const { key } = beatAt(bars, cluster.tick + CHORD_SPREAD)
    let list = byBeat.get(key)
    if (!list) byBeat.set(key, (list = []))
    list.push(cluster)
  }
  const grids = new Map<number, Grid>()
  const snapped = new Map<number, { pitches: Set<number>; end: number }>()
  for (const [key, list] of byBeat) {
    const { bar, start } = beatAt(bars, list[0].tick + CHORD_SPREAD)
    const snap = (tick: number, step: number) => start + Math.min(Math.max(Math.round((tick - start) / step), 0), bar.beat / step) * step
    let best: (Grid & { cost: number }) | null = null
    for (const grid of gridsFor(bar.beat)) {
      let cost = grid.penalty
      let previous = -1
      for (const cluster of list) {
        const tick = snap(cluster.tick, grid.step)
        cost += Math.abs(tick - cluster.tick)
        // Two onsets on one grid point would become one chord: the grid is too coarse for them.
        if (tick === previous) cost += 400
        previous = tick
      }
      if (!best || cost < best.cost) best = { step: grid.step, triplet: grid.triplet, cost }
    }
    grids.set(key, { step: best!.step, triplet: best!.triplet })
    for (const cluster of list) {
      const tick = snap(cluster.tick, best!.step)
      let chord = snapped.get(tick)
      if (!chord) snapped.set(tick, (chord = { pitches: new Set(), end: 0 }))
      for (const note of cluster.notes) {
        chord.pitches.add(note.pitch)
        chord.end = Math.max(chord.end, note.end)
      }
    }
  }

  const lastBar = bars.at(-1)!
  const songEnd = lastBar.start + lastBar.length
  const starts = [...snapped.keys()].sort((a, b) => a - b)
  const chords: Chord[] = []
  for (const [index, start] of starts.entries()) {
    const chord = snapped.get(start)!
    const next = starts[index + 1] ?? songEnd
    let end: number
    if (kind === 'drums') {
      // A drum hit has no length: it lasts until the next one, within its bar.
      const bar = bars[barIndexAt(bars, start)]
      end = Math.min(next, bar.start + bar.length)
    } else {
      const at = beatAt(bars, chord.end)
      const grid = grids.get(at.key) ?? STRAIGHT
      const step = Math.min(grid.step, at.bar.beat)
      end = at.start + Math.round((chord.end - at.start) / step) * step
      const own = beatAt(bars, start)
      end = Math.max(end, start + Math.min((grids.get(own.key) ?? STRAIGHT).step, own.bar.beat))
      end = Math.min(end, next)
      if (next - end < SHORTEST_REST) end = next
    }
    chords.push({ start, end: Math.min(end, songEnd), pitches: [...chord.pitches].sort((a, b) => a - b) })
  }
  return { chords, grids }
}

const PLAIN = [3840, 1920, 960, 480, 240, 120, 60]
const VALUES = [...PLAIN.map((ticks) => ({ ticks, plain: ticks, dots: 0 })), ...PLAIN.slice(0, -1).map((ticks) => ({ ticks: ticks * 1.5, plain: ticks, dots: 1 }))].sort(
  (a, b) => b.ticks - a.ticks,
)

const piece = (ticks: number, plain: number, dots: number, triplet: boolean): Piece => ({ ticks, duration: (WHOLE / plain) as alphaTab.model.Duration, dots, triplet })

/**
 * The note values that fill [start, end) of one bar. Whole beats from a beat line are one value where one fits;
 * the rest is written within each beat, in that beat's grid.
 */
function splitInBar(bar: Bar, barIndex: number, start: number, end: number, grids: Map<number, Grid>): Piece[] {
  const pieces: Piece[] = []
  let position = start
  while (position < end) {
    const beatIndex = Math.min(Math.floor((position - bar.start) / bar.beat), bar.numerator - 1)
    const beatStart = bar.start + beatIndex * bar.beat
    if (position === beatStart && end - position >= bar.beat) {
      const span = end - position
      const value = VALUES.find((entry) => entry.ticks <= span && entry.ticks % bar.beat === 0)!
      pieces.push(piece(value.ticks, value.plain, value.dots, false))
      position += value.ticks
      continue
    }
    const stop = Math.min(end, beatStart + bar.beat)
    const grid = grids.get(barIndex * 64 + beatIndex)
    if (grid?.triplet && (stop - position) % grid.step === 0 && (position - beatStart) % grid.step === 0) {
      // Equal triplet notes only: alphaTab groups mixed lengths unreliably.
      for (let at = position; at < stop; at += grid.step) pieces.push(piece(grid.step, grid.step * 1.5, 0, true))
    } else {
      let left = stop - position
      while (left > 0) {
        const value = VALUES.find((entry) => entry.ticks <= left && entry.ticks < bar.beat) ?? VALUES.find((entry) => entry.ticks <= left)
        // Below the shortest value: cannot happen on these grids, but never loop forever.
        if (!value) break
        pieces.push(piece(value.ticks, value.plain, value.dots, false))
        left -= value.ticks
      }
    }
    position = stop
  }
  return pieces
}

/** The open string pitches by alphaTab string number (1 = lowest), and the lowest and highest playable pitch. */
function pickTuning(kind: 'guitar' | 'bass', pitches: number[]) {
  const lowest = Math.min(...pitches)
  let best: number[] | null = null
  for (const option of kind === 'guitar' ? GUITAR_TUNINGS : BASS_TUNINGS) {
    const bottom = Math.min(...option)
    if (bottom <= lowest && (!best || bottom > Math.min(...best))) best = option
  }
  // Lower than any of them: the lowest, and the notes below it go up an octave.
  return best ?? (kind === 'guitar' ? GUITAR_TUNINGS : BASS_TUNINGS).reduce((low, option) => (Math.min(...option) < Math.min(...low) ? option : low))
}

/** Into the instrument's range by whole octaves. */
function fold(pitch: number, low: number, high: number) {
  while (pitch < low) pitch += 12
  while (pitch > high) pitch -= 12
  return pitch
}

function fingerings(pitches: number[], open: number[]): Fingering[] {
  const strings = open.length - 1
  // More notes than strings: the lowest and the highest ones stay.
  const notes = pitches.length > strings ? [pitches[0], ...pitches.slice(pitches.length - strings + 1)] : pitches
  const found: Fingering[] = []
  const search = (allowDrop: boolean) => {
    const chosen: Array<{ string: number; fret: number }> = []
    const used = new Set<number>()
    let dropped = 0
    const walk = (index: number) => {
      if (index === notes.length) {
        if (chosen.length > 0) found.push(rate(chosen, dropped))
        return
      }
      for (let string = 1; string <= strings; string++) {
        const fret = notes[index] - open[string]
        if (used.has(string) || fret < 0 || fret > MAX_FRET) continue
        used.add(string)
        chosen.push({ string, fret })
        walk(index + 1)
        chosen.pop()
        used.delete(string)
      }
      if (allowDrop) {
        dropped++
        walk(index + 1)
        dropped--
      }
    }
    walk(0)
  }
  search(false)
  if (found.length === 0) search(true)
  // Nothing playable at all: a rest rather than notes without a string.
  if (found.length === 0) return [{ notes: [], cost: 1000, position: null }]
  return found.sort((a, b) => a.cost - b.cost).slice(0, 40)
}

function rate(notes: Array<{ string: number; fret: number }>, dropped: number): Fingering {
  const fretted = notes.filter((note) => note.fret > 0).map((note) => note.fret)
  const low = Math.min(...fretted)
  const high = Math.max(...fretted)
  const span = fretted.length > 1 ? high - low : 0
  const stretch = span <= 3 ? span * 0.3 : span === 4 ? 2 : span === 5 ? 5 : 15 + (span - 5) * 5
  const height = fretted.length > 0 ? (fretted.reduce((sum, fret) => sum + fret, 0) / fretted.length) * 0.05 : 0
  return { notes: [...notes], cost: stretch + height + dropped * 100, position: fretted.length > 0 ? (low + high) / 2 : null }
}

function move(from: Fingering, to: Fingering) {
  if (from.position === null || to.position === null) return 0
  const distance = Math.abs(from.position - to.position)
  return distance * 0.5 + (distance > 5 ? 3 : 0)
}

/** The fingering of every chord, the cheapest way through them all (Viterbi over each chord's best options). */
function fingerAll(chords: Chord[], open: number[]): Fingering[] {
  const options = chords.map((chord) => fingerings(chord.pitches, open))
  const costs: number[][] = []
  const back: number[][] = []
  for (const [index, list] of options.entries()) {
    costs.push([])
    back.push([])
    for (const [at, option] of list.entries()) {
      let best = 0
      let from = -1
      if (index > 0) {
        best = Infinity
        for (const [previous, before] of options[index - 1].entries()) {
          const cost = costs[index - 1][previous] + move(before, option)
          if (cost < best) {
            best = cost
            from = previous
          }
        }
      }
      costs[index][at] = best + option.cost
      back[index][at] = from
    }
  }
  const result: Fingering[] = new Array(chords.length)
  let at = costs.length > 0 ? costs.at(-1)!.indexOf(Math.min(...costs.at(-1)!)) : -1
  for (let index = chords.length - 1; index >= 0; index--) {
    result[index] = options[index][at]
    at = back[index][at]
  }
  return result
}

function buildStaff(staff: alphaTab.model.Staff, part: MidiPart, kind: Kind, toTicks: (tick: number) => number, bars: Bar[], file: MidiFile) {
  let open: number[] = []
  let shown = { low: 0, high: 127 }
  if (kind === 'drums') {
    staff.isPercussion = true
    staff.showTablature = false
    staff.showStandardNotation = true
  } else {
    const tuning = pickTuning(
      kind,
      part.notes.map((note) => note.pitch),
    )
    staff.stringTuning = model.Tuning.findTuning(tuning) ?? new model.Tuning('', tuning, false)
    staff.showTablature = true
    staff.showStandardNotation = false
    open = [0, ...[...tuning].reverse()]
    shown = { low: Math.min(...tuning), high: Math.max(...tuning) + MAX_FRET }
  }
  const folded: MidiPart = { ...part, notes: part.notes.map((note) => ({ ...note, pitch: kind === 'drums' ? note.pitch : fold(note.pitch, shown.low, shown.high) })) }
  const { chords, grids } = quantize(folded, kind, toTicks, bars)
  const fingered = open.length > 0 ? fingerAll(chords, open) : []
  const clef = kind === 'drums' ? model.Clef.Neutral : kind === 'bass' ? model.Clef.F4 : model.Clef.G2
  const keys = file.keySignatures.map((key) => ({ ...key, tick: toTicks(key.tick) }))

  let chordIndex = 0
  for (const [barIndex, bar] of bars.entries()) {
    const written = new model.Bar()
    written.clef = clef
    const key = keys.filter((change) => change.tick <= bar.start + CHORD_SPREAD).at(-1)
    if (key && kind !== 'drums') {
      written.keySignature = key.sharps as alphaTab.model.KeySignature
      written.keySignatureType = key.minor ? model.KeySignatureType.Minor : model.KeySignatureType.Major
    }
    staff.addBar(written)
    const voice = new model.Voice()
    written.addVoice(voice)

    const barEnd = bar.start + bar.length
    let position = bar.start
    const add = (end: number, chord: Chord | null, fingering: Fingering | undefined, continued: boolean) => {
      for (const [index, value] of splitInBar(bar, barIndex, position, end, grids).entries()) {
        voice.addBeat(buildBeat(value, chord, fingering, kind, continued || index > 0))
      }
      position = end
    }
    while (position < barEnd) {
      while (chordIndex < chords.length && chords[chordIndex].end <= position) chordIndex++
      const chord = chords[chordIndex]
      if (!chord || chord.start >= barEnd) {
        add(barEnd, null, undefined, false)
      } else if (chord.start > position) {
        add(chord.start, null, undefined, false)
      } else {
        add(Math.min(chord.end, barEnd), chord, fingered[chordIndex], chord.start < position)
      }
    }
  }
}

function buildBeat(value: Piece, chord: Chord | null, fingering: Fingering | undefined, kind: Kind, tied: boolean) {
  const beat = new model.Beat()
  beat.isEmpty = false
  beat.duration = value.duration
  beat.dots = value.dots
  if (value.triplet) {
    beat.tupletNumerator = 3
    beat.tupletDenominator = 2
  }
  // A drum hit is not held: what is left of its time is rest.
  if (!chord || (kind === 'drums' && tied)) return beat
  if (fingering) {
    for (const placed of fingering.notes) {
      const note = new model.Note()
      note.string = placed.string
      note.fret = placed.fret
      note.isTieDestination = tied
      beat.addNote(note)
    }
  } else {
    // Drums: the General MIDI drum note is the articulation id, as in the online tabs (songs/convert.ts).
    for (const pitch of chord.pitches) {
      const note = new model.Note()
      note.percussionArticulation = pitch
      note.isTieDestination = tied
      beat.addNote(note)
    }
  }
  return beat
}

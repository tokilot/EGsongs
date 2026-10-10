// Transposition that rewrites the tablature: every note gets the fret (and if needed the string) that sounds
// the new pitch, so the numbers on screen and the sound always agree. Works on a serialized copy of the score;
// the original is never touched.
import { model, type Settings } from '@coderline/alphatab'

/** Highest fret we are willing to write. */
export const MAX_FRET = 24
const MAX_CAPO = 12

type Json = Record<string, any>


export interface TransposeResult {
  score: model.Score
  /** Notes that have no fretting on their instrument at the new pitch; they were moved by an octave. */
  outOfRange: number
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

/** "F#m7/C#" up 2 -> "G#m7/D#". Names that do not start with a note letter are left alone. */
export function transposeChordName(name: string, semitones: number): string {
  const shift = (letter: string, accidental: string) => {
    const flat = accidental === 'b' || accidental === '♭'
    const pitch = NOTE_INDEX[letter] + (accidental === '#' || accidental === '♯' ? 1 : flat ? -1 : 0)
    const names = flat || (accidental === '' && semitones < 0) ? FLAT_NAMES : SHARP_NAMES
    return names[mod(pitch + semitones, 12)]
  }
  return name
    .replace(/^([A-G])([#b♯♭]?)/, (_, letter: string, accidental: string) => shift(letter, accidental))
    .replace(/\/([A-G])([#b♯♭]?)/, (_, letter: string, accidental: string) => `/${shift(letter, accidental)}`)
}

/** Key signatures move around the circle of fifths: one semitone is seven fifths. */
function transposeKey(key: number, semitones: number): number {
  const value = mod(key + 7 * semitones, 12)
  return value > 6 ? value - 12 : value
}

export function transposeScore(score: model.Score, semitones: number, settings: Settings): TransposeResult {
  // A deep copy through alphaTab's own serializer (plain JSON: keys are lower-case, maps become objects).
  const object = JSON.parse(model.JsonConverter.scoreToJson(score)) as Json
  let outOfRange = 0

  for (const track of object.tracks as Json[]) {
    for (const staff of track.staves as Json[]) {
      if (staff.ispercussion) continue
      transposeChords(staff, semitones)
      for (const bar of staff.bars as Json[]) bar.keysignature = transposeKey(Number(bar.keysignature ?? 0), semitones)

      const tunings: number[] = staff.stringtuning?.tunings ?? []
      if (tunings.length === 0) {
        // Keyboard-style staves store pitch as octave + tone.
        for (const note of allNotes(staff)) {
          if (note.octave < 0 || note.tone < 0) continue
          const pitch = note.octave * 12 + note.tone + semitones
          note.octave = Math.floor(pitch / 12)
          note.tone = mod(pitch, 12)
        }
        continue
      }
      // With a capo on, do what a player would: move the capo and keep the fingering. Only what the capo
      // cannot cover (it cannot go below the nut) is taken up by the frets.
      const capo = Number(staff.capo ?? 0)
      let remaining = semitones
      if (capo > 0) {
        const moved = Math.min(MAX_CAPO, Math.max(0, capo + semitones))
        remaining = semitones - (moved - capo)
        staff.capo = moved
      }
      if (remaining !== 0) outOfRange += transposeStringed(staff, tunings, Number(staff.capo ?? 0), remaining)
    }
  }
  return { score: model.JsonConverter.jsonToScore(JSON.stringify(object), settings), outOfRange }
}

function allNotes(staff: Json): Json[] {
  return (staff.bars as Json[]).flatMap((bar) => (bar.voices as Json[]).flatMap((voice) => (voice.beats as Json[]).flatMap((beat) => beat.notes as Json[])))
}

function transposeChords(staff: Json, semitones: number) {
  const chords = staff.chords
  if (!chords) return
  const entries: Json[] = chords instanceof Map ? [...chords.values()] : Object.values(chords)
  for (const chord of entries) if (typeof chord.name === 'string') chord.name = transposeChordName(chord.name, semitones)
}

/** Returns how many notes could not be placed at their exact new pitch. */
function transposeStringed(staff: Json, tunings: number[], capo: number, semitones: number): number {
  const stringCount = tunings.length
  // alphaTab strings count from 1 at the lowest; `tunings` lists the highest string first.
  const openPitch = (string: number) => tunings[stringCount - string] + capo
  const fretFor = (pitch: number, string: number) => pitch - openPitch(string)
  const playable = (fret: number) => fret >= 0 && fret <= MAX_FRET
  let outOfRange = 0

  type Placement = { string: number; fret: number }
  const allStrings = Array.from({ length: stringCount }, (_, index) => index + 1)

  // Per voice: where the last note written on each original string went. A tied note must land exactly on the
  // note it continues, and a run on one string should stay on one string where it can.
  const moved = new Map<number, Map<number, Placement>>()

  for (const bar of staff.bars as Json[]) {
    ;(bar.voices as Json[]).forEach((voice, voiceIndex) => {
      const lines = moved.get(voiceIndex) ?? new Map<number, Placement>()
      moved.set(voiceIndex, lines)
      for (const beat of voice.beats as Json[]) {
        const notes = beat.notes as Json[]
        if (notes.length === 0) continue
        const taken = new Set<number>()
        const placements = new Map<Json, Placement>()
        const place = (note: Json, placement: Placement) => {
          placements.set(note, placement)
          taken.add(placement.string)
        }

        // First the notes whose string is not ours to choose.
        for (const note of notes) {
          const original = note.string as number
          const origin = note.istiedestination ? lines.get(original) : undefined
          if (origin && !taken.has(origin.string)) {
            // A tie continues the previous note: same string, same fret.
            place(note, origin)
          } else if ((note.harmonictype === 1 || note.isdead) && !taken.has(original)) {
            // A natural harmonic sounds at a node of the open string, so it stays as written. A dead note has
            // no pitch; it keeps its string and follows the hand position when the fret allows.
            const fret = note.isdead && playable(note.fret + semitones) ? note.fret + semitones : note.fret
            place(note, { string: original, fret })
          }
        }

        // Then everything else, lowest string first.
        const free = notes.filter((note) => !placements.has(note)).sort((a, b) => a.string - b.string)
        for (const note of free) {
          const original = note.string as number
          const target = note.fret + openPitch(original) + semitones
          const preferred = lines.get(original)?.string ?? original
          const candidates = allStrings
            .filter((string) => !taken.has(string))
            .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || Math.abs(a - original) - Math.abs(b - original) || a - b)

          const exact = candidates.find((string) => playable(fretFor(target, string)))
          if (exact !== undefined) {
            place(note, { string: exact, fret: fretFor(target, exact) })
            continue
          }
          // The pitch is below or above what this instrument can reach: play it in the nearest octave that fits.
          outOfRange++
          const string = candidates[0] ?? original
          let fret = fretFor(target, string)
          while (fret < 0) fret += 12
          while (fret > MAX_FRET) fret -= 12
          place(note, { string, fret: playable(fret) ? fret : note.fret })
        }

        for (const note of notes) {
          const placement = placements.get(note)!
          lines.set(note.string, placement)
          note.string = placement.string
          note.fret = placement.fret
          if (typeof note.trillvalue === 'number' && note.trillvalue >= 0) note.trillvalue += semitones
        }
      }
    })
  }
  return outOfRange
}

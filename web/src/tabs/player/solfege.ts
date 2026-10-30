// Solfège ("唱名") for the note-name box in the control bar: movable do, so do is the tonic of the major key
// the key signature stands for. Minor keys read with la as their tonic, as is usual in Chinese teaching
// (A minor and C major both have do on C). A tab without a key signature reads in C; the key can also be
// picked by hand.
import type { model } from '@coderline/alphatab'

const SYLLABLES = ['do', '#do', 're', '♭mi', 'mi', 'fa', '#fa', 'sol', '#sol', 'la', '♭si', 'si']
const SHARP_NAMES = ['C', '#C', 'D', '#D', 'E', 'F', '#F', 'G', '#G', 'A', '#A', 'B']
const FLAT_NAMES = ['C', '♭D', 'D', '♭E', 'E', 'F', '♭G', 'G', '♭A', 'A', '♭B', 'B']

const pitchClass = (value: number) => ((value % 12) + 12) % 12

/** The pitch class of do for a key signature given as sharps (positive) or flats (negative), -7 to 7. */
export function tonicOf(keySignature: number): number {
  return pitchClass(keySignature * 7)
}

/** "1=G", "1=♭B": where do is, written the way numbered notation does. */
export function keyLabel(keySignature: number): string {
  const tonic = tonicOf(keySignature)
  return `1=${(keySignature < 0 ? FLAT_NAMES : SHARP_NAMES)[tonic]}`
}

/** The syllable of a sounding pitch (MIDI number) in the given key. */
export function syllable(pitch: number, keySignature: number): string {
  return SYLLABLES[pitchClass(pitch - tonicOf(keySignature))]
}

// The usual spelling of each major key, by the pitch class of its tonic: F# rather than G♭, B♭ rather than A#.
const MAJOR_KEYS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]

/** The twelve major keys to pick from, as key signatures, in the order of their tonic from C. */
export const KEY_CHOICES = MAJOR_KEYS

/** A key signature moved by some semitones (with the tab's transposition), spelled the usual way. */
export function transposeKey(keySignature: number, semitones: number): number {
  return MAJOR_KEYS[pitchClass(tonicOf(keySignature) + semitones)]
}

/** What the note-name box shows for one beat. */
export interface NoteNames {
  /** "1=G": the key it reads in; empty for drums. */
  key: string
  /** The key the tab itself has at this beat, for the key menu. */
  tabKey: string
  /** True when the key was picked by hand rather than taken from the tab. */
  manual: boolean
  /** Syllables from the lowest note up; empty for a rest. */
  names: string[]
  percussion: boolean
}

/**
 * The syllables of everything struck at this beat's moment in its bar, all voices, lowest first. The key is
 * the tab's own (C when it has none), or `manualKey` (picked for the untransposed tab) moved by `transpose`.
 */
export function beatSolfege(beat: model.Beat, manualKey: number | null = null, transpose = 0): NoteNames {
  const bar = beat.voice.bar
  const tabKey = bar.keySignature as number
  if (bar.staff.isPercussion) return { key: '', tabKey: '', manual: false, names: [], percussion: true }
  const key = manualKey === null ? tabKey : transposeKey(manualKey, transpose)
  const pitches = bar.voices
    .flatMap((voice) => voice.beats.filter((other) => other.playbackStart === beat.playbackStart && !other.isEmpty))
    .flatMap((other) => other.notes.filter((note) => !note.isDead).map((note) => note.realValue))
    .sort((a, b) => a - b)
  return { key: keyLabel(key), tabKey: keyLabel(tabKey), manual: manualKey !== null, names: pitches.map((pitch) => syllable(pitch, key)), percussion: false }
}

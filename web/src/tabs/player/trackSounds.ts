// Presets of other sample sets given to tracks in "edit track": the sets the server keeps in data/soundfonts/
// besides the main General MIDI one (server/src/soundFonts.ts), say one guitar sampled several ways. They are loaded
// by hand on the tone page, each in a bank of its own; a track given one of their presets plays it through the
// routing table (audio/ampRouting.ts), the tab itself is not changed.
import type { TrackPresets } from '../../audio/ampRouting.ts'
import { INSTRUMENT_CATEGORIES, instrumentPlace } from './trackEdits.ts'

/** What is kept with a song: the file of the sound font and the preset's program in it. */
export interface TrackSound {
  font: string
  program: number
}

/** Track index -> its preset. */
export type TrackSounds = Record<string, TrackSound>

/** A sample set as the server lists it (server/src/soundFonts.ts). */
export interface SoundFontEntry {
  name: string
  bytes: number
  kind: 'gm' | 'extra'
  /** Loaded at the start; the tabs' instruments play from it. */
  main: boolean
  /** Every other set: the bank it is loaded in. */
  bank?: number
  presets: Array<{ program: number; name: string }>
  /** The main set: presets added to it from other files, in a bank of their own (Bread's guitars in Default.sf2, see server/src/soundFonts.ts ADDED_BANK). */
  added?: { bank: number; presets: Array<{ program: number; name: string }> }
}

/** A sample set loaded after the main one, or (`main`) the presets added to the main set. */
export interface ExtraSoundFont {
  name: string
  bank: number
  kind: 'gm' | 'extra'
  presets: Array<{ program: number; name: string }>
  /** The main set's added presets: loaded with it, nothing more to fetch. */
  main?: boolean
}

/** Stored presets made safe: track indexes to a font name and a program 0–127. */
export function cleanTrackSounds(raw: unknown): TrackSounds {
  const result: TrackSounds = {}
  if (!raw || typeof raw !== 'object') return result
  for (const [index, given] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(index) || !given || typeof given !== 'object') continue
    const { font, program } = given as Record<string, unknown>
    if (typeof font === 'string' && font && Number.isInteger(program) && (program as number) >= 0 && (program as number) <= 127) {
      result[index] = { font, program: program as number }
    }
  }
  return result
}

/** The preset a track was given, among the fonts loaded; null when its font or preset is gone. */
export function findPreset(fonts: ExtraSoundFont[], sound: TrackSound | undefined): { font: ExtraSoundFont; name: string } | null {
  if (!sound) return null
  const font = fonts.find((item) => item.name === sound.font)
  const preset = font?.presets.find((item) => item.program === sound.program)
  return font && preset ? { font, name: preset.name } : null
}

/** The banks and programs the tracks' presets play, for the routing table; tracks whose preset is gone play as before. */
export function trackPresets(fonts: ExtraSoundFont[], sounds: TrackSounds): TrackPresets {
  const result: TrackPresets = {}
  for (const [index, sound] of Object.entries(sounds)) {
    const found = findPreset(fonts, sound)
    if (found) result[index] = { bank: found.font.bank, program: sound.program }
  }
  return result
}

export function sameSound(a: TrackSound | null | undefined, b: TrackSound | null | undefined): boolean {
  return (a ?? null) === (b ?? null) || (!!a && !!b && a.font === b.font && a.program === b.program)
}

// Words in a preset's or a file's name, and the kind of instrument (a label in INSTRUMENT_CATEGORIES) they say.
// Checked in order: "bassoon" before "bass", "bass guitar" and "acoustic guitar" before "guitar".
const KINDS: Array<[RegExp, string]> = [
  [/bassoon|clarinet|oboe|sax/, '簧管'],
  [/contrabass|double ?bass|upright ?bass|violin|viola|cello|fiddle/, '提琴'],
  [/bass/, '贝斯'],
  [/acoustic|nylon|steel|classical|folk/, '木吉他'],
  [/guitar|gtr|dist|overdrive|drive|crunch|clean|strat|tele|les ?paul/, '电吉他'],
  [/piano|rhodes|wurli|e\.? ?piano|keys/, '钢琴'],
  [/organ/, '风琴'],
  [/strings|ensemble/, '弦乐合奏'],
  [/harp|pizz/, '拨奏与竖琴'],
  [/trumpet|trombone|horn|brass|tuba/, '铜管'],
  [/flute|piccolo|recorder|pan ?pipe/, '吹管'],
  [/choir|voice|vocal|aah|ooh/, '人声'],
  [/pad/, '合成铺底'],
  [/synth|lead/, '合成主音'],
]

function kindOf(name: string): { category: number; sub: number } | null {
  const text = name.toLowerCase()
  const label = KINDS.find(([words]) => words.test(text))?.[1]
  if (!label) return null
  for (const [category, item] of INSTRUMENT_CATEGORIES.entries()) {
    const sub = item.subs.findIndex((group) => group.label === label)
    if (sub >= 0) return { category, sub }
  }
  return null
}

/**
 * Where a preset of a sample set goes in the instrument picker. A General MIDI set's by its program number; another's
 * by its own name, else by the file's name (a set of one instrument often names only it, its presets just the way it
 * is played), else by its program number too.
 */
export function presetPlace(font: string, preset: { name: string; program: number }, kind: 'gm' | 'extra' = 'extra'): { category: number; sub: number } {
  if (kind === 'gm') return instrumentPlace(preset.program)
  return kindOf(preset.name) ?? kindOf(font.replace(/\.sf[23]$/i, '')) ?? instrumentPlace(preset.program)
}

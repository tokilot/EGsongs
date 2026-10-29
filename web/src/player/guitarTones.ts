// The personal tone library ("音色库"): signal chains (toneModules.ts) kept in this browser, plus built-in
// templates to start from. A tone is for electric guitar or bass, and is picked in "edit track" among the
// instruments of its kind; a track has one tone at most, kept with the song (`trackTones` in its practice
// settings). From them comes the routing table that tells the synthesizer which channels and programs
// go to which amp bus (see the amp bus patches in web/alphatab-patches.ts).
import { chainWith, cleanChain, defaultChain, sameChain, scaleOldKnobs, type ToneChain } from './toneModules.ts'

/** What a tone is for: electric guitar or bass. */
export type ToneFamily = 'guitar' | 'bass'

export const TONE_FAMILIES: ToneFamily[] = ['guitar', 'bass']

export interface Tone {
  id: string
  /** Built-in templates have Chinese names (translated in the UI); the user's are shown as typed. */
  name: string
  family: ToneFamily
  builtIn: boolean
  chain: ToneChain
}

export interface ToneLibrary {
  custom: Tone[]
  /** Tracks starter tones and storage formats, so a deleted starter stays deleted after a reload. */
  presetVersion?: number
}

// 5: a library, tones given per track (2026-10-27); 4: knobs 0–100; 3: signal chains with 0–10 knobs; 1–2: six
// knobs. Before 5 there was one global tone per bus and an on/off switch; both are gone.
const STORAGE_VERSION = 5

export const BUILT_IN_TONES: Tone[] = [
  {
    id: 'clean',
    name: '清音',
    family: 'guitar',
    builtIn: true,
    chain: chainWith({
      dyna: { type: 'smooth', params: { sustain: 30, attack: 50, level: 50 } },
      amp: {
        type: 'clean',
        params: {
          gain: 30,
          bass: 50,
          mid: 50,
          treble: 60,
          presence: 55,
          master: 50,
          gate: 0,
        },
      },
      cab: { type: '2x12' },
      reverb: { type: 'room', params: { decay: 1.6, predelay: 15, mix: 30 } },
    }),
  },
  {
    id: 'distortion',
    name: '失真',
    family: 'guitar',
    builtIn: true,
    chain: chainWith({
      amp: {
        type: 'highgain',
        params: {
          gain: 65,
          bass: 55,
          mid: 45,
          treble: 55,
          presence: 60,
          master: 50,
          gate: 30,
        },
      },
      cab: { type: '4x12' },
      reverb: { type: 'room', params: { decay: 1.3, predelay: 10, mix: 15 } },
    }),
  },
  {
    id: 'bass-clean',
    name: '贝斯',
    family: 'bass',
    builtIn: true,
    chain: chainWith({
      dyna: { type: 'smooth', params: { sustain: 50, attack: 40, level: 50 } },
      amp: {
        type: 'bass',
        params: {
          gain: 20,
          bass: 55,
          mid: 50,
          treble: 50,
          presence: 45,
          master: 50,
          gate: 0,
        },
      },
      cab: { type: '4x10', params: { lowcut: 30, highcut: 6000 } },
    }),
  },
]

// A starting point for 長坂の戦い<flying cloud> (Dynasty Warriors Origins; Songsterr s1866166, revision 2484748):
// two distortion guitars, one a lead line (single notes, bends and vibrato, E3–G5) and one a rhythm part (power
// chords, 29% palm muted) at 163 bpm. The amp, presence and EQ were fitted (2026-10-24) to the average spectrum
// of the record's lead passages (0:48–0:55, 1:30–2:10, 2:24–2:35, picked by the user) between 300 Hz and
// 6.4 kHz, measured off this chain playing the tab: 1.7 dB apart on average (the one-stage amp before got to
// 2.3). Still a little thin at 400 Hz, full at 800 Hz and bright around 5 kHz. Not judged by ear.
export const FLYING_CLOUD_TONE: Tone = {
  id: 'custom-flying-cloud',
  name: '長坂の戦い〈Flying Cloud〉',
  family: 'guitar',
  builtIn: false,
  chain: chainWith({
    od: { type: 'overdrive', params: { gain: 10, tone: 60, level: 80 } },
    amp: {
      type: 'metal',
      params: {
        gain: 75,
        bass: 45,
        mid: 40,
        treble: 35,
        presence: 55,
        master: 50,
        gate: 30,
      },
    },
    cab: { type: '4x12' },
    eq: {
      type: 'five',
      params: { b100: 0, b400: 2, b800: -2, b1600: 2, b4000: -1.5, level: 0 },
    },
    reverb: { type: 'room', params: { decay: 1.4, predelay: 15, mix: 25 } },
  }),
}

export const DEFAULT_TONE_LIBRARY: ToneLibrary = {
  custom: [FLYING_CLOUD_TONE],
  presetVersion: STORAGE_VERSION,
}

/** Every tone there is to pick from: built-in first, then the user's. */
export function allTones(library: ToneLibrary): Tone[] {
  return [...BUILT_IN_TONES, ...library.custom]
}

export function findTone(library: ToneLibrary, id: string | undefined): Tone | null {
  return id ? (allTones(library).find((tone) => tone.id === id) ?? null) : null
}

// ---- tones given to tracks ----

/** Per track index, the id of its tone; a track without one plays the sound font's samples. */
export type TrackTones = Record<string, string>

/** The family of tones a GM program can be given: the electric guitars, the basses; others none. */
export function toneFamilyOf(program: number): ToneFamily | null {
  if (program >= 26 && program <= 31) return 'guitar'
  if (program >= 32 && program <= 39) return 'bass'
  return null
}

/**
 * The instrument a track gets with a tone of the family: guitars play the clean electric guitar samples and get
 * their drive from the chain; a bass keeps its own bass samples.
 */
export function toneProgram(family: ToneFamily, program: number): number {
  if (family === 'guitar') return 27
  return toneFamilyOf(program) === 'bass' ? program : 33
}

/**
 * What a program plays when it goes through a tone: overdriven and distortion guitar play the clean electric
 * guitar samples; the rest (muted and harmonics guitar, basses) keep theirs.
 */
export function routedProgram(program: number): number {
  return program === 29 || program === 30 ? 27 : program
}

/** Channel -> program -> [amp bus, program to play]: what the synthesizer is told. */
export type AmpRouting = Record<number, Record<number, [number, number]>>

export interface TrackChannels {
  index: number
  channels: number[]
  isPercussion: boolean
}

export interface AmpPlan {
  routing: AmpRouting
  /** The tone of each bus, bus 1 first. */
  buses: Tone[]
}

/** The amp buses there are (the worklet has this many outputs besides the main one). */
export const MAX_AMP_BUSES = 8

/** The channels the tone page's preview plays on: well above any a song uses, so it never takes a track's. */
export const PREVIEW_CHANNELS = [60, 61]

/** What the preview plays for a tone of each family. */
export const PREVIEW_PROGRAM: Record<ToneFamily, number> = {
  guitar: 30,
  bass: 33,
}

// Every program of the tone's family on the channel goes through the bus.
function route(routing: AmpRouting, channel: number, family: ToneFamily, bus: number) {
  const programs = (routing[channel] ??= {})
  for (let program = 0; program < 128; program++) if (toneFamilyOf(program) === family) programs[program] = [bus, routedProgram(program)]
}

/**
 * The routing table and buses for the tones given to the tracks, and the tone being previewed (if any). Tracks
 * using the same tone share its bus; past the buses there are, a tone is left out (its tracks play the samples).
 * The preview gets a bus of its own.
 */
export function planAmpBuses(tracks: TrackChannels[], trackTones: TrackTones, library: ToneLibrary, preview: Tone | null = null): AmpPlan {
  const routing: AmpRouting = {}
  const buses: Tone[] = []
  const busOf = new Map<string, number>()
  const room = preview ? MAX_AMP_BUSES - 1 : MAX_AMP_BUSES
  for (const track of tracks) {
    if (track.isPercussion) continue
    const tone = findTone(library, trackTones[track.index])
    if (!tone) continue
    let bus = busOf.get(tone.id)
    if (bus === undefined) {
      if (buses.length >= room) continue
      buses.push(tone)
      bus = buses.length
      busOf.set(tone.id, bus)
    }
    for (const channel of track.channels) route(routing, channel, tone.family, bus)
  }
  if (preview) {
    buses.push(preview)
    for (const channel of PREVIEW_CHANNELS) route(routing, channel, preview.family, buses.length)
  }
  return { routing, buses }
}

// Until 2026-10-28 a track had a tone per kind of section; the one for its distorted parts is the likeliest
// to be the sound it was given them for.
const OLD_SLOTS = ['distortion', 'overdrive', 'clean', 'bass']

/** Given tones made safe: track indexes to string ids; the older per-section form keeps one of its tones. */
export function cleanTrackTones(raw: unknown): TrackTones {
  const result: TrackTones = {}
  if (!raw || typeof raw !== 'object') return result
  for (const [index, given] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(index)) continue
    if (typeof given === 'string' && given) result[index] = given
    else if (given && typeof given === 'object') {
      const old = OLD_SLOTS.map((slot) => (given as Record<string, unknown>)[slot]).find((id) => typeof id === 'string' && id)
      if (typeof old === 'string') result[index] = old
    }
  }
  return result
}

// ---- storage ----

interface LegacyParams {
  gain: number
  bass: number
  mid: number
  treble: number
  reverb: number
  level: number
}

const LEGACY_KNOBS: Array<keyof LegacyParams> = ['gain', 'bass', 'mid', 'treble', 'reverb', 'level']
const OLD_TYPES = ['clean', 'overdrive', 'distortion']

function isLegacyParams(value: unknown): value is LegacyParams {
  return !!value && typeof value === 'object' && LEGACY_KNOBS.every((key) => typeof (value as Record<string, unknown>)[key] === 'number')
}

/** An old six-knob tone (0–10) as a chain: the knobs go to the amp, the reverb knob to a room reverb. */
export function legacyChain(params: LegacyParams, type: string): ToneChain {
  const chain = defaultChain()
  chain.amp = {
    on: true,
    type: type === 'clean' ? 'clean' : type === 'overdrive' ? 'crunch' : 'highgain',
    params: {
      ...chain.amp.params,
      gain: params.gain * 10,
      bass: params.bass * 10,
      mid: params.mid * 10,
      treble: params.treble * 10,
      master: params.level * 10,
    },
  }
  chain.reverb = {
    on: params.reverb > 0,
    type: 'room',
    params: { ...chain.reverb.params, mix: params.reverb * 10 },
  }
  return chain
}

// The Flying Cloud knobs as first guessed (version 1) and as fitted to the old one-stage amp (version 2): a stored
// copy still exactly like one of them has not been touched, and gets the current tone.
const FLYING_CLOUD_OLD: LegacyParams[] = [
  { gain: 7, bass: 4.5, mid: 6.5, treble: 5.5, reverb: 2.5, level: 5 },
  { gain: 9, bass: 4.5, mid: 4.5, treble: 2.5, reverb: 2.5, level: 5 },
]
const sameLegacy = (a: LegacyParams, b: LegacyParams) => LEGACY_KNOBS.every((key) => a[key] === b[key])

function readTone(raw: unknown, version: number): Tone | null {
  if (!raw || typeof raw !== 'object') return null
  const tone = raw as Record<string, unknown>
  if (typeof tone.id !== 'string' || typeof tone.name !== 'string') return null
  // Before version 5 every tone was a guitar tone, with a bus type instead of a family.
  const family: ToneFamily | null = TONE_FAMILIES.includes(tone.family as ToneFamily)
    ? (tone.family as ToneFamily)
    : OLD_TYPES.includes(tone.type as string)
      ? 'guitar'
      : null
  if (!family) return null
  let chain: ToneChain
  if (tone.chain && typeof tone.chain === 'object') chain = cleanChain(version < 4 ? scaleOldKnobs(tone.chain) : tone.chain)
  else if (isLegacyParams(tone.params)) {
    const params = tone.params
    chain =
      tone.id === FLYING_CLOUD_TONE.id && FLYING_CLOUD_OLD.some((old) => sameLegacy(old, params))
        ? FLYING_CLOUD_TONE.chain
        : legacyChain(params, tone.type as string)
  } else return null
  return { id: tone.id, name: tone.name, family, builtIn: false, chain }
}

/** Reads the stored library, dropping anything malformed rather than failing. */
export function parseToneLibrary(raw: unknown): ToneLibrary {
  if (!raw || typeof raw !== 'object') return DEFAULT_TONE_LIBRARY
  const value = raw as Partial<ToneLibrary>
  const version = typeof value.presetVersion === 'number' ? value.presetVersion : 0
  const custom = (Array.isArray(value.custom) ? value.custom : [])
    .map((tone) => readTone(tone, version))
    .filter((tone): tone is Tone => tone !== null)
  // Add the first custom tone to existing browsers too, once. Saved edits and a deletion are kept: after the
  // first time presetVersion says it was already added.
  if (version < 1 && !custom.some((tone) => tone.id === FLYING_CLOUD_TONE.id)) custom.unshift({ ...FLYING_CLOUD_TONE })
  return { custom, presetVersion: STORAGE_VERSION }
}

/** True when the tone is still exactly the starter Flying Cloud. */
export function isStarterFlyingCloud(tone: Tone): boolean {
  return tone.id === FLYING_CLOUD_TONE.id && sameChain(tone.chain, FLYING_CLOUD_TONE.chain)
}

/** A new id for a tone of the user's. */
export function newToneId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** The library without one of the user's tones (tracks that had it play the samples again). */
export function withoutTone(library: ToneLibrary, id: string): ToneLibrary {
  return {
    ...library,
    custom: library.custom.filter((tone) => tone.id !== id),
  }
}

/** The library with one of the user's tones added or replaced. */
export function withTone(library: ToneLibrary, tone: Tone): ToneLibrary {
  const custom = library.custom.some((item) => item.id === tone.id)
    ? library.custom.map((item) => (item.id === tone.id ? { ...tone, builtIn: false } : item))
    : [...library.custom, { ...tone, builtIn: false }]
  return { ...library, custom }
}

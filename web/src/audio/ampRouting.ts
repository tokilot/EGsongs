// Which tracks go through which amp bus: the routing table the synthesizer is told (see the amp bus patches in
// web/alphatab-patches.ts), from the tones given to the tracks (`trackTones` in a song's practice settings).
import { toneFamilyOf, type Tone, type ToneFamily } from './tone.ts'

/** Per track index, the id of its tone; a track without one plays the sound font's samples. */
export type TrackTones = Record<string, string>

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
export function planAmpBuses(tracks: TrackChannels[], trackTones: TrackTones, findTone: (id: string | undefined) => Tone | null, preview: Tone | null = null): AmpPlan {
  const routing: AmpRouting = {}
  const buses: Tone[] = []
  const busOf = new Map<string, number>()
  const room = preview ? MAX_AMP_BUSES - 1 : MAX_AMP_BUSES
  for (const track of tracks) {
    if (track.isPercussion) continue
    const tone = findTone(trackTones[track.index])
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

// Audio to MIDI: the models, the beat trackers and the transcriptions (server/src/transcribe.ts, web/src/stems/).
import type { Task } from './tasks.ts'

/** A transcription model found in the model directory (data/models/transcriber/), and what the page shows of it. */
export interface TranscriptionModel {
  /** Its folder's name (or its file's, without the extension). */
  id: string
  name: string
  /** Its weights, relative to the model directory, and their config.json if there is one (MuScriptor knows its
   * published models without it). */
  weights: string
  config: string | null
  /** Millions of parameters, from the file's size (float32 weights). */
  parameters: number
  /** 'unknown' when it is not a MuScriptor model. */
  license: string
  /** The licence forbids commercial use: personal use only. */
  nonCommercial: boolean
  source: string
}

/** A model as the page lists it: whether its files are there, and how big they are. */
export interface TranscriptionModelInfo extends TranscriptionModel {
  available: boolean
  bytes: number
}

/**
 * A beat tracker's checkpoint (beat_this, MIT): finds the beats and bar lines the MIDI is written on. Optional
 * (2026-11-11): without one, or with none picked, the MIDI is written at a steady tempo given on the page.
 */
export interface BeatModel {
  /** `beat_this/<file name without .ckpt>`. */
  id: string
  name: string
  /** Relative to the model directory. */
  file: string
  bytes: number
}

/** Which instruments the model may hear: all of them, or only guitars and/or basses (for a separated stem). */
export type InstrumentChoice = 'auto' | 'guitar' | 'bass' | 'guitar-bass'

/** The MIDI a transcription wrote, and what is in it. */
export interface MidiResult {
  file: string
  notes: number
  /** MuScriptor's instrument groups heard (e.g. 'distorted_electric_guitar'), the most notes first. */
  parts: string[]
  /** The tempo the MIDI is written in; null when no beat was found. */
  bpm: number | null
  /** The tempo and bar lines came from the beat tracker; false: the steady tempo asked for. */
  detected: boolean
  seconds: number
}

/** What a transcription adds to a job: its model, choice of instruments and of beat tracker, and (once done) the MIDI. */
export interface TranscriptionResult {
  model: string
  instruments: InstrumentChoice
  /** The beat tracker picked, or null for the steady `bpm`. */
  beat: string | null
  bpm: number
  midi: MidiResult | null
}

export type TranscriptionItem = Task<TranscriptionResult>

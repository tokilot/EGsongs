// The stems' calls to the local server (server/src/routes/stems.ts).
import { request } from '../shared/http.ts'

/** Recordings split into stems, on their own (server/src/stems.ts). A stem's name is its model's, e.g. 'guitar'. */
export type StemName = string
export type StemDevice = 'cuda' | 'cpu'

export interface StemItem {
  id: string
  name: string
  sourceName: string
  createdAt: string
  device: StemDevice | null
  model?: string
  stems: Array<{ name: StemName; file: string; rmsDb: number }>
  status: 'queued' | 'running' | 'failed' | 'done'
  progress: number
  error: string | null
}

export interface StemDevices {
  cpu: { name: string; threads: number }
  memoryGb: number
  gpus: Array<{ name: string; memoryGb: number }>
  torch: string | null
  cuda: string | null
  /** Why separating cannot work here at all, or null. */
  problem: string | null
}

/** A separation model (server/src/stems.ts MODELS), with whether its files are there. */
export interface StemModel {
  id: string
  name: string
  architecture: string
  stems: StemName[]
  checkpoint: string
  config: string
  /** 'unknown' when the weights' licence is not stated. */
  license: string
  source: string
  available: boolean
  bytes: number
}

export function getStemModels(): Promise<StemModel[]> {
  return request('/api/stems/models')
}

export function listStems(): Promise<StemItem[]> {
  return request('/api/stems')
}

export function getStemDevices(): Promise<StemDevices> {
  return request('/api/stems/devices')
}

/** Starts separating a recording, already decoded to WAV. */
export function separateStems(sourceName: string, wav: Blob, device: StemDevice, model: string): Promise<StemItem> {
  return request(`/api/stems?name=${encodeURIComponent(sourceName)}&device=${device}&model=${encodeURIComponent(model)}`, { method: 'POST', body: wav })
}

/** Deletes a separation, or stops it while it is still under way. */
export function deleteStems(id: string): Promise<{ ok: boolean }> {
  return request(`/api/stems/${id}`, { method: 'DELETE' })
}

export function stemUrl(id: string, name: StemName): string {
  return `/api/stems/${id}/${encodeURIComponent(name)}`
}

/** Recordings transcribed to MIDI by MuScriptor (server/src/transcribe.ts). */
export type InstrumentChoice = 'auto' | 'guitar' | 'bass' | 'guitar-bass'

export interface MidiResult {
  file: string
  notes: number
  /** MuScriptor's instrument groups heard (e.g. 'distorted_electric_guitar'), the most notes first. */
  parts: string[]
  /** The tempo the MIDI is written in; null when no beat was found. */
  bpm: number | null
  /** The tempo and bar lines came from the beat tracker; false: the steady tempo asked for. Missing before 2026-11-11. */
  detected?: boolean
  seconds: number
}

export interface TranscriptionItem {
  id: string
  name: string
  sourceName: string
  createdAt: string
  device: StemDevice | null
  model: string
  instruments: InstrumentChoice
  /** The beat tracker picked, or null for the steady `bpm`. */
  beat?: string | null
  bpm?: number
  midi: MidiResult | null
  status: 'queued' | 'running' | 'failed' | 'done'
  progress: number
  error: string | null
}

/** A model found in data/models/transcriber/ (server/src/transcribe.ts findTranscriptionModels). */
export interface TranscriptionModel {
  id: string
  name: string
  /** Millions of parameters, estimated from the file's size. */
  parameters: number
  /** 'unknown' when it is not a MuScriptor model. */
  license: string
  /** The licence forbids commercial use. */
  nonCommercial: boolean
  source: string
  available: boolean
  bytes: number
}

export function getTranscriptionModels(): Promise<TranscriptionModel[]> {
  return request('/api/transcriptions/models')
}

/** A beat tracker checkpoint in data/models/transcriber/beat_this/ (optional). */
export interface BeatModel {
  id: string
  name: string
  bytes: number
}

export function getBeatModels(): Promise<BeatModel[]> {
  return request('/api/transcriptions/beat-models')
}

export function listTranscriptions(): Promise<TranscriptionItem[]> {
  return request('/api/transcriptions')
}

/** Starts transcribing a recording, already decoded to WAV; `beat` null writes the MIDI at a steady `bpm`. */
export function transcribe(sourceName: string, wav: Blob, device: StemDevice, model: string, instruments: InstrumentChoice, beat: string | null, bpm: number): Promise<TranscriptionItem> {
  const query = `name=${encodeURIComponent(sourceName)}&device=${device}&model=${encodeURIComponent(model)}&instruments=${instruments}&beat=${encodeURIComponent(beat ?? 'none')}&bpm=${bpm}`
  return request(`/api/transcriptions?${query}`, { method: 'POST', body: wav })
}

/** Deletes a transcription, or stops it while it is still under way. */
export function deleteTranscription(id: string): Promise<{ ok: boolean }> {
  return request(`/api/transcriptions/${id}`, { method: 'DELETE' })
}

export function midiUrl(id: string): string {
  return `/api/transcriptions/${id}/midi`
}

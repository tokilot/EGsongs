// The stems' calls to the local server (server/src/routes/stems.ts, transcriptions.ts). What they send and get back
// is defined once, with the server, in contracts/; the names the page uses for them are kept here.
import type { Device } from '../../../contracts/tasks.ts'
import type { DeviceInfo, ModelInfo, StemItem, StemName } from '../../../contracts/stems.ts'
import type { BeatModel, InstrumentChoice, MidiResult, TranscriptionItem, TranscriptionModelInfo } from '../../../contracts/transcriptions.ts'
import { request } from '../shared/http.ts'

export type { BeatModel, InstrumentChoice, MidiResult, StemItem, StemName, TranscriptionItem }
export type StemDevice = Device
export type StemDevices = DeviceInfo
/** A separation model found in data/models/separator/, with whether its files are there. */
export type StemModel = ModelInfo
/** A model found in data/models/transcriber/, with whether its files are there. */
export type TranscriptionModel = TranscriptionModelInfo

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

export function getTranscriptionModels(): Promise<TranscriptionModel[]> {
  return request('/api/transcriptions/models')
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

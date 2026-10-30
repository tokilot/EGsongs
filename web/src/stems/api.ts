// The stems' calls to the local server (server/src/routes/stems.ts).
import { request } from '../shared/http.ts'

/** Recordings split into stems, on their own (server/src/stems.ts). */
export type StemName = 'vocals' | 'drums' | 'bass' | 'guitar' | 'piano' | 'other'
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
  return `/api/stems/${id}/${name}`
}

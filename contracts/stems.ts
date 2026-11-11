// Stem separation: the models and the separations (server/src/stems.ts, web/src/stems/).
import type { Task } from './tasks.ts'

/** A stem's name as its model calls it (`training.instruments` in the model's YAML), e.g. 'guitar'. */
export type StemName = string

/** A separation model found in the model directory (data/models/separator/), and what the page shows of it. */
export interface SeparationModel {
  /** Its folder's name (or its file's, without the extension). */
  id: string
  name: string
  architecture: string
  /** The stems it gives (its YAML's `training.instruments`), in the order the page lists them. */
  stems: StemName[]
  /** Its checkpoint and config, relative to the model directory. */
  checkpoint: string
  config: string
  /** 'unknown' when the weights' licence is not stated; the page leaves it out. */
  license: string
  source: string
}

/** A model as the page lists it: whether its files are there, and how big they are. */
export interface ModelInfo extends SeparationModel {
  available: boolean
  bytes: number
}

export interface Stem {
  name: StemName
  file: string
  /** Loudness of the whole stem; a stem the model found (almost) nothing for is far below the others. */
  rmsDb: number
}

/** What a separation adds to a job: its model, and (once done) the stems, as FLAC files next to stems.json. */
export interface StemResult {
  /** The model's id; separations made before models could be picked have none (they used the first). */
  model?: string
  stems: Stem[]
}

/** A separation as the page lists it: finished, or still on its way (or failed). */
export type StemItem = Task<StemResult>

/** The computer the jobs run on, for the page to show and to pick from (the stems and the MIDI share it). */
export interface DeviceInfo {
  cpu: { name: string; threads: number }
  memoryGb: number
  gpus: Array<{ name: string; memoryGb: number }>
  torch: string | null
  cuda: string | null
  /** Why nothing can run at all (no Python, PyTorch does not start), or null. */
  problem: string | null
}

// "Audio to MIDI": recordings transcribed by MuScriptor (Kyutai x Mirelo), queued with the separations.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { BeatModel, InstrumentChoice, MidiResult, TranscriptionItem, TranscriptionModel, TranscriptionModelInfo, TranscriptionResult } from '../../contracts/transcriptions.ts'
import { runScript, TaskError, TaskStore, type Device, type Exclusive } from './tasks.ts'

/** The models, beat trackers and transcriptions as the page sees them, defined with it in contracts/transcriptions.ts. */
export type {
  BeatModel,
  InstrumentChoice,
  MidiResult,
  TranscriptionItem,
  TranscriptionModel,
  TranscriptionModelInfo,
  TranscriptionResult,
} from '../../contracts/transcriptions.ts'

/** The folder of the beat tracker's checkpoint, which is not a transcription model. */
const BEAT_FOLDER = 'beat_this'

/**
 * The models in `dir`, smallest first: every folder with a model.safetensors (and maybe a config.json) in it, and
 * every .safetensors file lying in `dir` itself (its config next to it as <name>.json or <name>-config.json, a
 * "-model" at the end of the file's name left out). Looked for each time: models come and go while the server runs.
 */
export function findTranscriptionModels(dir: string): TranscriptionModel[] {
  if (!existsSync(dir)) return []
  const found = new Map<string, TranscriptionModel>()
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && entry.name !== BEAT_FOLDER) {
      const weights = path.join(entry.name, 'model.safetensors')
      const config = path.join(entry.name, 'config.json')
      if (existsSync(path.join(dir, weights))) found.set(entry.name, describe(dir, entry.name, weights, existsSync(path.join(dir, config)) ? config : null))
    } else if (entry.isFile() && entry.name.endsWith('.safetensors')) {
      const base = entry.name.slice(0, -'.safetensors'.length)
      const id = base.replace(/[-_.]model$/i, '') || base
      if (found.has(id)) continue
      const config = [`${base}.json`, `${id}-config.json`, `${id}.json`].find((file) => existsSync(path.join(dir, file))) ?? null
      found.set(id, describe(dir, id, entry.name, config))
    }
  }
  const size = (model: TranscriptionModel) => statSync(path.join(dir, model.weights)).size
  return [...found.values()].sort((a, b) => size(a) - size(b) || a.name.localeCompare(b.name))
}

function describe(dir: string, id: string, weights: string, config: string | null): TranscriptionModel {
  let info: { model_type?: unknown; variant?: unknown } = {}
  try {
    if (config) info = JSON.parse(readFileSync(path.join(dir, config), 'utf8')) as typeof info
  } catch {
    // Not readable: named by its folder.
  }
  const variant = typeof info.variant === 'string' ? info.variant : null
  const muscriptor = info.model_type === 'muscriptor' || /muscriptor/i.test(id)
  return {
    id,
    name: muscriptor && variant ? `MuScriptor ${variant}` : id,
    weights,
    config,
    parameters: Math.round(statSync(path.join(dir, weights)).size / 4 / 1e6),
    license: muscriptor ? 'CC BY-NC 4.0' : 'unknown',
    nonCommercial: muscriptor,
    source: muscriptor && variant ? `https://huggingface.co/MuScriptor/muscriptor-${variant}` : '',
  }
}

/** The beat_this checkpoints in `dir`/beat_this/ (final0.ckpt and the like), by name. */
export function findBeatModels(dir: string): BeatModel[] {
  const folder = path.join(dir, BEAT_FOLDER)
  if (!existsSync(folder)) return []
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ckpt'))
    .map((entry) => {
      const base = entry.name.slice(0, -'.ckpt'.length)
      const file = path.join(BEAT_FOLDER, entry.name)
      return { id: `${BEAT_FOLDER}/${base}`, name: `beat_this ${base}`, file, bytes: statSync(path.join(dir, file)).size }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The steady tempo used without a beat tracker, and what the page may ask for. */
export const DEFAULT_BPM = 120
export const MIN_BPM = 20
export const MAX_BPM = 300

/** MuScriptor's instrument groups for each choice (`muscriptor list-instruments`). */
export const INSTRUMENT_GROUPS: Record<InstrumentChoice, string[]> = {
  auto: [],
  guitar: ['acoustic_guitar', 'clean_electric_guitar', 'distorted_electric_guitar'],
  bass: ['acoustic_bass', 'electric_bass'],
  'guitar-bass': ['acoustic_guitar', 'clean_electric_guitar', 'distorted_electric_guitar', 'acoustic_bass', 'electric_bass'],
}

export type TranscriptionMessage = { device: Device } | { progress: number } | { midi: MidiResult }

/** How one transcription is to be run, besides its recording. */
export interface TranscriptionRun {
  model: TranscriptionModel
  device: Device
  /** MuScriptor's instrument groups allowed; empty for all. */
  instruments: string[]
  /** The beat tracker, or null to write the MIDI at a steady `bpm`. */
  beat: BeatModel | null
  bpm: number
}

/** Runs the transcription; replaced in tests. */
export interface TranscriptionRunner {
  /** The models in the model directory now, with their size. */
  models(): TranscriptionModelInfo[]
  /** The beat tracker checkpoints there now. */
  beatModels(): BeatModel[]
  /** Why transcribing cannot work with this model (no Python, files missing), or null. */
  check(model: TranscriptionModel): string | null
  run(input: string, outputDir: string, job: TranscriptionRun, onMessage: (message: TranscriptionMessage) => void): { done: Promise<void>; cancel: () => void }
}

const SCRIPT = path.join(import.meta.dirname, '../separator/transcribe.py')

/** server/separator/transcribe.py, in the environment that has MuScriptor and PyTorch installed. */
export function transcriptionRunner(python: string, modelDir: string): TranscriptionRunner {
  // Only the weights; config.json is optional, and so is a beat tracker.
  const required = (model: TranscriptionModel) => [path.join(modelDir, model.weights)]
  return {
    beatModels() {
      return findBeatModels(modelDir)
    },
    check(model) {
      if (!existsSync(python)) return `Python was not found at ${python} (set TABS_PYTHON).`
      const missing = required(model).filter((file) => !existsSync(file))
      return missing.length > 0 ? `The transcription model is missing: ${missing.join(', ')}.` : null
    },
    models() {
      return findTranscriptionModels(modelDir).map((model) => {
        const files = required(model)
        const available = files.every((file) => existsSync(file))
        return { ...model, available, bytes: available ? files.reduce((sum, file) => sum + statSync(file).size, 0) : 0 }
      })
    },
    run(input, outputDir, job, onMessage) {
      const beat = job.beat ? path.join(modelDir, job.beat.file) : '-'
      const args = [input, outputDir, path.join(modelDir, job.model.weights), beat, job.device, job.instruments.join(','), String(job.bpm)]
      return runScript(python, SCRIPT, args, onMessage)
    },
  }
}

/** Transcriptions of recordings to MIDI, on their own like the separations, and sharing their turn (`lock`). */
export class TranscriptionStore {
  private readonly tasks: TaskStore<TranscriptionResult>
  private readonly runner: TranscriptionRunner

  /** `dir`: where the transcriptions go (data/tmps/transcriptions/, emptied when the server starts). */
  constructor(dir: string, runner: TranscriptionRunner, lock: Exclusive) {
    this.runner = runner
    this.tasks = new TaskStore<TranscriptionResult>(dir, 'transcription.json', lock, (input, work, item) => {
      // Picked when the job was queued; gone since then, it fails with the reason.
      const model = runner.models().find((entry) => entry.id === item.model)
      if (!model) return { done: Promise.reject(new Error(`The model "${item.model}" is no longer in the model directory.`)), cancel: () => {} }
      // A beat tracker gone since the job was queued: the steady tempo instead.
      const beat = item.beat === null ? null : (runner.beatModels().find((entry) => entry.id === item.beat) ?? null)
      let midi: MidiResult | null = null
      const job = { model, device: item.device ?? 'cuda', instruments: INSTRUMENT_GROUPS[item.instruments] ?? [], beat, bpm: item.bpm }
      const run = runner.run(input, work, job, (message) => {
        if ('device' in message) item.device = message.device
        else if ('progress' in message) item.progress = Math.min(Math.max(message.progress, 0), 1)
        else if ('midi' in message) midi = message.midi
      })
      return {
        done: run.done.then(() => {
          if (!midi) throw new Error('The transcription gave no MIDI.')
          return { midi }
        }),
        cancel: run.cancel,
      }
    })
  }

  list(): Promise<TranscriptionItem[]> {
    return this.tasks.list()
  }

  /** The models in the model directory, smallest first. */
  models(): TranscriptionModelInfo[] {
    return this.runner.models()
  }

  beatModels(): BeatModel[] {
    return this.runner.beatModels()
  }

  /**
   * Queues a transcription of `wav` (decoded by the page) with a model (the smallest there is by default). `beat`:
   * a beat tracker's id, or null (or 'none') for the steady `bpm`.
   */
  async start(
    sourceName: string,
    wav: Uint8Array,
    device: Device,
    modelId?: string,
    instruments: string = 'auto',
    beatId: string | null = null,
    bpm: number = DEFAULT_BPM,
  ): Promise<TranscriptionItem> {
    if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) throw new TaskError(`The tempo must be ${MIN_BPM}–${MAX_BPM} BPM.`, 400)
    const beat = beatId === null || beatId === 'none' ? null : (this.runner.beatModels().find((entry) => entry.id === beatId) ?? null)
    if (beatId !== null && beatId !== 'none' && !beat) throw new TaskError(`There is no beat tracker "${beatId}".`, 400)
    const models = this.runner.models()
    if (models.length === 0) throw new TaskError('There is no transcription model in the model directory.', 503)
    const model = modelId === undefined ? models[0] : models.find((entry) => entry.id === modelId)
    if (!model) throw new TaskError(`There is no model "${modelId}".`, 400)
    if (!Object.hasOwn(INSTRUMENT_GROUPS, instruments)) throw new TaskError(`There is no instrument choice "${instruments}".`, 400)
    const problem = this.runner.check(model)
    if (problem) throw new TaskError(problem, 503)
    return this.tasks.start(sourceName, wav, device, { model: model.id, instruments: instruments as InstrumentChoice, beat: beat?.id ?? null, bpm, midi: null })
  }

  remove(id: string): Promise<boolean> {
    return this.tasks.remove(id)
  }

  /** The MIDI file of a finished transcription, or null. */
  async midiFile(id: string): Promise<string | null> {
    const item = await this.tasks.get(id)
    return item?.status === 'done' && item.midi ? this.tasks.file(id, item.midi.file) : null
  }
}

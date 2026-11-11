import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DeviceInfo, ModelInfo, SeparationModel, Stem, StemResult, StemItem } from '../../contracts/stems.ts'
import { Exclusive, runScript, TaskError, TaskStore, type Device } from './tasks.ts'

export type { Device } from './tasks.ts'
/** Errors the routes answer with their status (an unknown model, a missing model file). */
export { TaskError as StemError } from './tasks.ts'

/** The models and separations as the page sees them, defined with it in contracts/stems.ts. */
export type { DeviceInfo, ModelInfo, SeparationModel, Stem, StemName, StemResult, StemItem } from '../../contracts/stems.ts'

/** The usual stems first, in this order; any other stem a model has comes after them, in its config's order. */
const STEM_ORDER = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']

/**
 * The models in `dir`, smallest first (2026-11-10: like the transcription models, whatever the folder holds):
 * every folder with a model.ckpt and a config.yaml in it, and every <name>.ckpt lying in `dir` next to a
 * <name>.yaml. Looked for each time: models come and go while the server runs. A config without a list of
 * instruments is not a model this page can run.
 */
export function findSeparationModels(dir: string): SeparationModel[] {
  if (!existsSync(dir)) return []
  const found = new Map<string, { model: SeparationModel; size: number }>()
  const add = (id: string, checkpoint: string, config: string) => {
    if (found.has(id) || !existsSync(path.join(dir, checkpoint)) || !existsSync(path.join(dir, config))) return
    const stems = orderStems(configInstruments(readFileSync(path.join(dir, config), 'utf8')))
    if (stems.length === 0) return
    const model = { id, name: id, architecture: 'BS-RoFormer', stems, checkpoint, config, license: 'unknown', source: '' }
    found.set(id, { model, size: statSync(path.join(dir, checkpoint)).size })
  }
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) add(entry.name, path.join(entry.name, 'model.ckpt'), path.join(entry.name, 'config.yaml'))
    else if (entry.isFile() && entry.name.endsWith('.ckpt')) {
      const base = entry.name.slice(0, -'.ckpt'.length)
      add(base, entry.name, `${base}.yaml`)
    }
  }
  return [...found.values()].sort((a, b) => a.size - b.size || a.model.name.localeCompare(b.model.name)).map((entry) => entry.model)
}

/**
 * The instruments a model's YAML lists under `training:` (`instruments: ['bass', 'drums']`, or one `- name` per
 * line). Read here without a YAML library: the configs write them in one of these two ways.
 */
export function configInstruments(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/)
  const at = lines.findIndex((line) => /^\s+instruments\s*:/.test(line))
  if (at < 0) return []
  const unquote = (value: string) => value.trim().replace(/^['"]|['"]$/g, '').trim()
  const inline = lines[at].replace(/^\s+instruments\s*:/, '').replace(/#.*$/, '').trim()
  if (inline.startsWith('[')) {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(unquote)
      .filter(Boolean)
  }
  const result: string[] = []
  for (const line of lines.slice(at + 1)) {
    const item = /^\s*-\s*(.+?)\s*$/.exec(line)
    if (!item) break
    result.push(unquote(item[1]))
  }
  return result
}

function orderStems(stems: string[]): string[] {
  const known = STEM_ORDER.filter((name) => stems.includes(name))
  return [...known, ...stems.filter((name) => !STEM_ORDER.includes(name))]
}

/** One message printed by the separation script, see server/separator/separate.py. */
export type SeparationMessage = { device: Device } | { progress: number } | { stems: Stem[] }

/** Runs the separation; replaced in tests. */
export interface SeparationRunner {
  /** The models in the model directory now, with their size. */
  models(): ModelInfo[]
  /** Why separating cannot work at all (no Python), or with this model (its files are missing); null if it can. */
  check(model?: SeparationModel): string | null
  /** The graphics cards PyTorch can use, and its version. */
  devices(): Promise<{ gpus: DeviceInfo['gpus']; torch: string | null; cuda: string | null }>
  run(input: string, outputDir: string, model: SeparationModel, device: Device, onMessage: (message: SeparationMessage) => void): { done: Promise<void>; cancel: () => void }
}

const SCRIPT = path.join(import.meta.dirname, '../separator/separate.py')

/** The Python script, in the environment that has audio-separator and PyTorch installed. */
export function pythonRunner(python: string, modelDir: string): SeparationRunner {
  let devices: ReturnType<SeparationRunner['devices']> | null = null
  return {
    check(model) {
      if (!existsSync(python)) return `Python was not found at ${python} (set TABS_PYTHON).`
      if (!model) return null
      const missing = [model.checkpoint, model.config].filter((file) => !existsSync(path.join(modelDir, file)))
      return missing.length > 0 ? `The separation model is missing from ${modelDir}: ${missing.join(', ')}.` : null
    },
    models() {
      return findSeparationModels(modelDir).map((model) => {
        const files = [model.checkpoint, model.config].map((file) => path.join(modelDir, file))
        const available = files.every((file) => existsSync(file))
        return { ...model, available, bytes: available ? files.reduce((sum, file) => sum + statSync(file).size, 0) : 0 }
      })
    },
    // Asked once: loading PyTorch takes a few seconds, and the cards do not change while the server runs.
    devices() {
      devices ??= new Promise((resolve, reject) => {
        const child = spawn(python, ['-I', SCRIPT, '--devices'], { windowsHide: true })
        let output = ''
        child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
        child.on('error', reject)
        child.on('close', (code) => {
          try {
            if (code !== 0) throw new Error(`exit code ${code}`)
            resolve(JSON.parse(output.trim().split('\n').at(-1) ?? ''))
          } catch (error) {
            reject(error as Error)
          }
        })
      })
      devices.catch(() => (devices = null))
      return devices
    },
    run(input, outputDir, model, device, onMessage) {
      return runScript(python, SCRIPT, [input, outputDir, modelDir, device, model.checkpoint, model.config, model.stems.join(',')], onMessage)
    },
  }
}

/**
 * Separations of recordings into stems, on their own (not tied to a song), queued with the MIDI transcriptions:
 * one job at a time (`lock`), since each takes the whole graphics card.
 */
export class StemStore {
  private readonly tasks: TaskStore<StemResult>
  private readonly runner: SeparationRunner

  /** `dir`: where the separations go (data/tmps/stems/, emptied when the server starts). */
  constructor(dir: string, runner: SeparationRunner, lock = new Exclusive()) {
    this.runner = runner
    this.tasks = new TaskStore<StemResult>(dir, 'stems.json', lock, (input, work, item) => {
      // Picked when the job was queued; gone since then, it fails with the reason.
      const model = runner.models().find((entry) => entry.id === item.model)
      if (!model) return { done: Promise.reject(new Error(`The model "${item.model}" is no longer in the model directory.`)), cancel: () => {} }
      let stems: Stem[] | null = null
      const run = runner.run(input, work, model, item.device ?? 'cuda', (message) => {
        if ('device' in message) item.device = message.device
        else if ('progress' in message) item.progress = Math.min(Math.max(message.progress, 0), 1)
        else if ('stems' in message) stems = message.stems
      })
      return {
        done: run.done.then(() => {
          if (!stems) throw new Error('The separation gave no stems.')
          return { model: model.id, stems }
        }),
        cancel: run.cancel,
      }
    })
  }

  /** Newest first: what is still being separated, then what is done. */
  list(): Promise<StemItem[]> {
    return this.tasks.list()
  }

  get(id: string): Promise<StemItem | null> {
    return this.tasks.get(id)
  }

  async devices(): Promise<DeviceInfo> {
    const cpus = os.cpus()
    const machine = {
      cpu: { name: cpus[0]?.model.trim() ?? '', threads: cpus.length },
      memoryGb: round(os.totalmem() / 1024 ** 3),
    }
    const problem = this.runner.check()
    if (problem) return { ...machine, gpus: [], torch: null, cuda: null, problem }
    try {
      return { ...machine, ...(await this.runner.devices()), problem: null }
    } catch (error) {
      return { ...machine, gpus: [], torch: null, cuda: null, problem: `PyTorch could not be started: ${(error as Error).message}` }
    }
  }

  /** The models in the model directory, smallest first. */
  models(): ModelInfo[] {
    return this.runner.models()
  }

  /** Queues a separation of `wav` (the recording, decoded by the page) with a model (the smallest there is by default). */
  async start(sourceName: string, wav: Uint8Array, device: Device, modelId?: string): Promise<StemItem> {
    const models = this.runner.models()
    if (models.length === 0) throw new TaskError('There is no separation model in the model directory.', 503)
    const model = modelId === undefined ? models[0] : models.find((entry) => entry.id === modelId)
    if (!model) throw new TaskError(`There is no model "${modelId}".`, 400)
    const problem = this.runner.check(model)
    if (problem) throw new TaskError(problem, 503)
    return this.tasks.start(sourceName, wav, device, { model: model.id, stems: [] })
  }

  /** Stops a separation that is queued or running, and forgets it (or a failed one). */
  cancel(id: string) {
    return this.tasks.cancel(id)
  }

  remove(id: string): Promise<boolean> {
    return this.tasks.remove(id)
  }

  /** The FLAC file of one stem, or null. */
  async stemFile(id: string, name: string): Promise<string | null> {
    const item = await this.tasks.get(id)
    const stem = item?.status === 'done' ? item.stems.find((entry) => entry.name === name) : undefined
    return stem ? this.tasks.file(id, stem.file) : null
  }
}

function round(value: number) {
  return Math.round(value * 10) / 10
}

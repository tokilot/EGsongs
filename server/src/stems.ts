import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'

/** What the six-stem model gives, in the order the page lists them. */
export const STEM_NAMES = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const
export type StemName = (typeof STEM_NAMES)[number]

export type Device = 'cuda' | 'cpu'

export interface Stem {
  name: StemName
  file: string
  /** Loudness of the whole stem; a stem the model found (almost) nothing for is far below the others. */
  rmsDb: number
}

/** A finished separation, kept in data/stems/{id}/stems.json next to its FLAC files. */
export interface StemSet {
  id: string
  /** The recording's file name without its extension. */
  name: string
  sourceName: string
  createdAt: string
  device: Device | null
  stems: Stem[]
}

/** A separation as the page lists it: finished, or still on its way (or failed). */
export interface StemItem extends StemSet {
  status: 'queued' | 'running' | 'failed' | 'done'
  /** 0–1, over the model's passes through the recording. */
  progress: number
  error: string | null
}

/** The computer the separation runs on, for the page to show and to pick from. */
export interface DeviceInfo {
  cpu: { name: string; threads: number }
  memoryGb: number
  gpus: Array<{ name: string; memoryGb: number }>
  torch: string | null
  cuda: string | null
  /** Why separating cannot work at all (no Python, no model), or null. */
  problem: string | null
}

export class StemError extends Error {
  readonly status: 400 | 404 | 409 | 503

  constructor(message: string, status: 400 | 404 | 409 | 503) {
    super(message)
    this.status = status
  }
}

/** One message printed by the separation script, see server/separator/separate.py. */
export type SeparationMessage = { device: Device } | { progress: number } | { stems: Stem[] }

/** Runs the separation; replaced in tests. */
export interface SeparationRunner {
  /** Why separating cannot work at all, or null. */
  check(): string | null
  /** The graphics cards PyTorch can use, and its version. */
  devices(): Promise<{ gpus: DeviceInfo['gpus']; torch: string | null; cuda: string | null }>
  run(input: string, outputDir: string, device: Device, onMessage: (message: SeparationMessage) => void): { done: Promise<void>; cancel: () => void }
}

const SCRIPT = path.join(import.meta.dirname, '../separator/separate.py')
const MODEL_FILES = ['BS-Roformer-SW.ckpt', 'BS-Roformer-SW.yaml']

/** The Python script, in the environment that has audio-separator and PyTorch installed. */
export function pythonRunner(python: string, modelDir: string): SeparationRunner {
  // -I: nothing from the current directory or the user's site-packages is imported.
  const start = (args: string[]) => spawn(python, ['-I', SCRIPT, ...args], { windowsHide: true })
  let devices: ReturnType<SeparationRunner['devices']> | null = null
  return {
    check() {
      if (!existsSync(python)) return `Python was not found at ${python} (set TABS_PYTHON).`
      const missing = MODEL_FILES.filter((file) => !existsSync(path.join(modelDir, file)))
      return missing.length > 0 ? `The separation model is missing from ${modelDir}: ${missing.join(', ')}.` : null
    },
    // Asked once: loading PyTorch takes a few seconds, and the cards do not change while the server runs.
    devices() {
      devices ??= new Promise((resolve, reject) => {
        const child = start(['--devices'])
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
    run(input, outputDir, device, onMessage) {
      const child = start([input, outputDir, modelDir, device])
      const errors: string[] = []
      createInterface({ input: child.stdout }).on('line', (line) => {
        try {
          onMessage(JSON.parse(line) as SeparationMessage)
        } catch {
          // Not one of ours (a library printing to stdout).
        }
      })
      createInterface({ input: child.stderr }).on('line', (line) => {
        errors.push(line)
        if (errors.length > 20) errors.shift()
      })
      let cancelled = false
      const done = new Promise<void>((resolve, reject) => {
        child.on('error', reject)
        child.on('close', (code) => {
          if (cancelled) reject(new Error('Cancelled.'))
          else if (code === 0) resolve()
          // The script's last line is the error; before it come the library's warnings.
          else reject(new Error(errors.at(-1) ?? `The separation stopped (exit code ${code}).`))
        })
      })
      return {
        done,
        cancel: () => {
          cancelled = true
          child.kill()
        },
      }
    },
  }
}

interface Job {
  item: StemItem
  work: string
  cancel: (() => void) | null
}

const ID = /^[a-z0-9]+$/

/**
 * Separations of recordings into stems, on their own (not tied to a song). One runs at a time (it takes the
 * whole graphics card). Jobs live in memory: a restart drops them, and the half-done work with them.
 */
export class StemStore {
  private readonly dir: string
  private readonly runner: SeparationRunner
  private readonly jobs = new Map<string, Job>()
  private readonly queue: string[] = []
  private running = false
  private lastId = ''

  constructor(dataDir: string, runner: SeparationRunner) {
    this.dir = path.join(dataDir, 'stems')
    this.runner = runner
    if (!existsSync(this.dir)) return
    for (const entry of readdirSync(this.dir)) {
      const dir = path.join(this.dir, entry)
      if (entry.endsWith('.work')) {
        rmSync(dir, { recursive: true, force: true })
        continue
      }
      // The first version kept one separation per song, in a directory named after the song, without an id.
      const file = path.join(dir, 'stems.json')
      try {
        const set = JSON.parse(readFileSync(file, 'utf8')) as Partial<StemSet>
        if (!set.id && ID.test(entry)) writeFileSync(file, JSON.stringify({ ...set, id: entry, name: baseName(set.sourceName ?? entry), device: set.device ?? null }, null, 2))
      } catch {
        // Not a separation.
      }
    }
  }

  private resultDir(id: string) {
    return path.join(this.dir, id)
  }

  private newId() {
    // Time-ordered, and never the same twice even within one millisecond.
    let id = Date.now().toString(36)
    while (id <= this.lastId) id = (parseInt(this.lastId, 36) + 1).toString(36)
    this.lastId = id
    return id
  }

  /** Newest first: what is still being separated, then what is done. */
  async list(): Promise<StemItem[]> {
    const done: StemItem[] = []
    if (existsSync(this.dir)) {
      for (const entry of readdirSync(this.dir)) {
        if (!ID.test(entry) || this.jobs.has(entry)) continue
        const set = await this.result(entry)
        if (set) done.push(asItem(set))
      }
    }
    const pending = [...this.jobs.values()].map((job) => ({ ...job.item }))
    return [...pending, ...done].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async get(id: string): Promise<StemItem | null> {
    const job = this.jobs.get(id)
    if (job) return { ...job.item }
    const set = ID.test(id) ? await this.result(id) : null
    return set ? asItem(set) : null
  }

  private async result(id: string): Promise<StemSet | null> {
    try {
      return JSON.parse(await readFile(path.join(this.resultDir(id), 'stems.json'), 'utf8')) as StemSet
    } catch {
      return null
    }
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

  /** Queues a separation of `wav` (the recording, decoded by the page). */
  async start(sourceName: string, wav: Uint8Array, device: Device): Promise<StemItem> {
    const problem = this.runner.check()
    if (problem) throw new StemError(problem, 503)
    const id = this.newId()
    const work = path.join(this.dir, `${id}.work`)
    await mkdir(work, { recursive: true })
    await writeFile(path.join(work, 'input.wav'), wav)
    const item: StemItem = {
      id,
      name: baseName(sourceName) || id,
      sourceName,
      createdAt: new Date().toISOString(),
      device,
      stems: [],
      status: 'queued',
      progress: 0,
      error: null,
    }
    this.jobs.set(id, { item, work, cancel: null })
    this.queue.push(id)
    void this.next()
    return { ...item }
  }

  /** Stops a separation that is queued or running, and forgets it (or a failed one). */
  async cancel(id: string) {
    const job = this.jobs.get(id)
    if (!job) return
    this.jobs.delete(id)
    const queued = this.queue.indexOf(id)
    if (queued >= 0) this.queue.splice(queued, 1)
    job.cancel?.()
    // A running one cleans up after itself when it stops.
    if (!job.cancel) await rm(job.work, { recursive: true, force: true })
  }

  async remove(id: string): Promise<boolean> {
    const known = (await this.get(id)) !== null
    await this.cancel(id)
    if (ID.test(id)) await rm(this.resultDir(id), { recursive: true, force: true })
    return known
  }

  /** The FLAC file of one stem, or null. */
  async stemFile(id: string, name: string): Promise<string | null> {
    if (!ID.test(id) || this.jobs.has(id)) return null
    const stem = (await this.result(id))?.stems.find((item) => item.name === name)
    return stem ? path.join(this.resultDir(id), stem.file) : null
  }

  private async next() {
    if (this.running) return
    const id = this.queue.shift()
    if (id === undefined) return
    const job = this.jobs.get(id)
    if (!job) return void this.next()
    this.running = true
    const { item, work } = job
    const input = path.join(work, 'input.wav')
    const found: { stems: Stem[] | null } = { stems: null }
    try {
      item.status = 'running'
      const run = this.runner.run(input, work, item.device ?? 'cuda', (message) => {
        if ('device' in message) item.device = message.device
        else if ('progress' in message) item.progress = Math.min(Math.max(message.progress, 0), 1)
        else if ('stems' in message) found.stems = message.stems
      })
      job.cancel = run.cancel
      await run.done
      const { stems } = found
      if (!stems) throw new Error('The separation gave no stems.')
      await rm(input, { force: true })
      const set: StemSet = { id, name: item.name, sourceName: item.sourceName, createdAt: item.createdAt, device: item.device, stems }
      await writeFile(path.join(work, 'stems.json'), JSON.stringify(set, null, 2))
      await rename(work, this.resultDir(id))
      if (this.jobs.get(id) === job) this.jobs.delete(id)
    } catch (error) {
      await rm(work, { recursive: true, force: true }).catch(() => {})
      // Cancelled jobs are gone from the map already; anything else stays listed as failed until deleted.
      if (this.jobs.get(id) === job) {
        Object.assign(item, { status: 'failed', error: (error as Error).message })
        job.cancel = null
      }
    } finally {
      this.running = false
      void this.next()
    }
  }
}

function asItem(set: StemSet): StemItem {
  return { ...set, status: 'done', progress: 1, error: null }
}

function baseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').trim()
}

function round(value: number) {
  return Math.round(value * 10) / 10
}

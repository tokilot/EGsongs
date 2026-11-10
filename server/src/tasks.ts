// A queue of jobs that run a Python script on a recording (separating it into stems, transcribing it to MIDI):
// what the stems page lists, follows and downloads. Each job's work goes into data/tmps/ (emptied when the server
// starts); jobs live in memory, so a restart drops the ones still queued or running, with their half-done work.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'

export type Device = 'cuda' | 'cpu'

/** What every job has, from the moment it is queued. */
export interface TaskBase {
  id: string
  /** The recording's file name without its extension. */
  name: string
  sourceName: string
  createdAt: string
  device: Device | null
}

export interface TaskState {
  status: 'queued' | 'running' | 'failed' | 'done'
  /** 0–1. */
  progress: number
  error: string | null
}

/** A job as the page lists it; `Extra` is what one kind of job adds (its model, its results). */
export type Task<Extra> = TaskBase & Extra & TaskState

/** One run of the script. `done` resolves with what the job found, which is kept with it. */
export interface TaskRun<Extra> {
  done: Promise<Partial<Extra>>
  cancel: () => void
}

export class TaskError extends Error {
  readonly status: 400 | 404 | 409 | 503

  constructor(message: string, status: 400 | 404 | 409 | 503) {
    super(message)
    this.status = status
  }
}

/**
 * One job at a time, across every queue that shares it: each takes the whole graphics card (or every CPU core).
 * `acquire` resolves, in the order asked, with the function that hands the turn on.
 */
export class Exclusive {
  private tail: Promise<void> = Promise.resolve()

  acquire(): Promise<() => void> {
    let release!: () => void
    const turn = new Promise<void>((resolve) => (release = resolve))
    const ready = this.tail.then(() => release)
    this.tail = this.tail.then(() => turn)
    return ready
  }
}

interface Job<Extra> {
  item: Task<Extra>
  work: string
  cancel: (() => void) | null
}

const ID = /^[a-z0-9]+$/
const INPUT = 'input.wav'

export class TaskStore<Extra extends object> {
  private readonly dir: string
  private readonly resultFile: string
  private readonly lock: Exclusive
  private readonly execute: (input: string, work: string, item: Task<Extra>) => TaskRun<Extra>
  private readonly jobs = new Map<string, Job<Extra>>()
  private readonly queue: string[] = []
  private running = false
  private lastId = ''

  /**
   * `dir`: where the finished jobs go, one folder each with `resultFile` (the job as JSON) next to the files the
   * script wrote. `execute` starts the script on a job's recording in its work folder; it updates the job's device
   * and progress as it goes.
   */
  constructor(dir: string, resultFile: string, lock: Exclusive, execute: (input: string, work: string, item: Task<Extra>) => TaskRun<Extra>) {
    this.dir = dir
    this.resultFile = resultFile
    this.lock = lock
    this.execute = execute
    if (!existsSync(this.dir)) return
    // Half-done work of a run that stopped.
    for (const entry of readdirSync(this.dir)) if (entry.endsWith('.work')) rmSync(path.join(this.dir, entry), { recursive: true, force: true })
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

  /** Newest first: what is still under way, then what is done. */
  async list(): Promise<Array<Task<Extra>>> {
    const done: Array<Task<Extra>> = []
    if (existsSync(this.dir)) {
      for (const entry of readdirSync(this.dir)) {
        if (!ID.test(entry) || this.jobs.has(entry)) continue
        const finished = await this.finished(entry)
        if (finished) done.push(asDone(finished))
      }
    }
    const pending = [...this.jobs.values()].map((job) => ({ ...job.item }))
    return [...pending, ...done].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async get(id: string): Promise<Task<Extra> | null> {
    const job = this.jobs.get(id)
    if (job) return { ...job.item }
    const finished = ID.test(id) ? await this.finished(id) : null
    return finished ? asDone(finished) : null
  }

  private async finished(id: string): Promise<(TaskBase & Extra) | null> {
    try {
      return JSON.parse(await readFile(path.join(this.resultDir(id), this.resultFile), 'utf8')) as TaskBase & Extra
    } catch {
      return null
    }
  }

  /** Queues a job on `recording` (WAV, decoded by the page). */
  async start(sourceName: string, recording: Uint8Array, device: Device, extra: Extra): Promise<Task<Extra>> {
    const id = this.newId()
    const work = path.join(this.dir, `${id}.work`)
    await mkdir(work, { recursive: true })
    await writeFile(path.join(work, INPUT), recording)
    const item = {
      id,
      name: baseName(sourceName) || id,
      sourceName,
      createdAt: new Date().toISOString(),
      device,
      ...extra,
      status: 'queued',
      progress: 0,
      error: null,
    } as Task<Extra>
    this.jobs.set(id, { item, work, cancel: null })
    this.queue.push(id)
    void this.next()
    return { ...item }
  }

  /** Stops a job that is queued or running, and forgets it (or a failed one). */
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

  /** A file a finished job wrote, by the name its result gives it; null while the job is not done. */
  async file(id: string, file: string): Promise<string | null> {
    if (!ID.test(id) || this.jobs.has(id) || path.basename(file) !== file) return null
    if (!(await this.finished(id))) return null
    const full = path.join(this.resultDir(id), file)
    return existsSync(full) ? full : null
  }

  private async next() {
    if (this.running) return
    const id = this.queue.shift()
    if (id === undefined) return
    const job = this.jobs.get(id)
    if (!job) return void this.next()
    this.running = true
    const release = await this.lock.acquire()
    const { item, work } = job
    try {
      // Cancelled while waiting for its turn: its work is gone already.
      if (this.jobs.get(id) !== job) return
      item.status = 'running'
      const run = this.execute(path.join(work, INPUT), work, item)
      job.cancel = run.cancel
      const found = await run.done
      await rm(path.join(work, INPUT), { force: true })
      const { status: _status, progress: _progress, error: _error, ...kept } = item
      await writeFile(path.join(work, this.resultFile), JSON.stringify({ ...kept, ...found }, null, 2))
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
      release()
      this.running = false
      void this.next()
    }
  }
}

function asDone<Extra>(finished: TaskBase & Extra): Task<Extra> {
  return { ...finished, status: 'done', progress: 1, error: null }
}

function baseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').trim()
}

/**
 * Runs one of the Python scripts in server/separator/ (with -I: nothing from the current directory or the user's
 * site-packages is imported). They print one JSON object per line; their last line on stderr is the error.
 */
export function runScript<Message>(python: string, script: string, args: string[], onMessage: (message: Message) => void): { done: Promise<void>; cancel: () => void } {
  const child = spawn(python, ['-I', script, ...args], { windowsHide: true })
  const errors: string[] = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      onMessage(JSON.parse(line) as Message)
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
      // The script's last line is the error; before it come the libraries' warnings.
      else reject(new Error(errors.at(-1) ?? `The script stopped (exit code ${code}).`))
    })
  })
  return {
    done,
    cancel: () => {
      cancelled = true
      child.kill()
    },
  }
}

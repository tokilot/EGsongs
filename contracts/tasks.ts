// What the server and the page exchange, defined once for both (2026-11-11): the server's modules re-export these,
// the page's api.ts files import them. Only types: `import type` leaves nothing in either build.

/** A processing device of the transcribe page. */
export type Device = 'cuda' | 'cpu'

/** What every job of the transcribe page has, from the moment it is queued. */
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

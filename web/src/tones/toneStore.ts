// The tone library as the page holds it: read from the server (data/tones.json), changed by the tone page, and
// offered to the tabs, whose player plays the tones given to tracks. The tabs only read it.
import { useSyncExternalStore } from 'react'
import type { Tone } from '../audio/tone.ts'
import * as api from './api.ts'
import { DEFAULT_TONE_LIBRARY, parseToneLibrary, withTone, withoutTone, type ToneLibrary } from './library.ts'

// Where the library was kept before it moved to the server (2026-10-30); brought over once, then left alone.
const BROWSER_KEY = 'tabs.guitarTones'

export interface ToneState {
  library: ToneLibrary
  /** Why the library could not be read or saved, or null. */
  error: string | null
}

export interface ToneServer {
  load(): Promise<unknown>
  save(library: ToneLibrary): Promise<unknown>
}

function readBrowserLibrary(): unknown {
  try {
    const raw = localStorage.getItem(BROWSER_KEY)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

export class ToneStore {
  private state: ToneState = { library: DEFAULT_TONE_LIBRARY, error: null }
  private readonly listeners = new Set<() => void>()
  private readonly server: ToneServer
  private readonly browserLibrary: () => unknown
  /** True once the server's library (or the lack of one) is known: saving before that could overwrite it. */
  private loaded = false
  private loading: Promise<void> | null = null

  constructor(server: ToneServer, browserLibrary: () => unknown = readBrowserLibrary) {
    this.server = server
    this.browserLibrary = browserLibrary
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = () => this.state

  private update(change: Partial<ToneState>) {
    this.state = { ...this.state, ...change }
    for (const listener of this.listeners) listener()
  }

  /** Reads the library from the server; before it ever had one, the one this browser kept is brought over. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const stored = await this.server.load()
        if (stored !== null) {
          this.loaded = true
          this.update({ library: parseToneLibrary(stored), error: null })
          return
        }
        const brought = this.browserLibrary()
        const library = brought === null ? DEFAULT_TONE_LIBRARY : parseToneLibrary(brought)
        this.loaded = true
        this.update({ library, error: null })
        if (brought !== null) await this.server.save(library)
      } catch (error) {
        this.update({ error: (error as Error).message })
      } finally {
        this.loading = null
      }
    })()
    return this.loading
  }

  /** Adds or replaces one of the user's tones. */
  save(tone: Tone): Promise<void> {
    return this.change((library) => withTone(library, tone))
  }

  /** Removes one of the user's tones; tracks that had it play the samples again. */
  remove(id: string): Promise<void> {
    return this.change((library) => withoutTone(library, id))
  }

  private async change(apply: (library: ToneLibrary) => ToneLibrary) {
    // Not read yet (the server was not reachable): read it first rather than save over it.
    if (!this.loaded) await this.load()
    if (!this.loaded) return
    const library = apply(this.state.library)
    this.update({ library })
    try {
      await this.server.save(library)
      if (this.state.error) this.update({ error: null })
    } catch (error) {
      this.update({ error: (error as Error).message })
    }
  }
}

export const toneStore = new ToneStore({ load: api.getToneLibrary, save: api.saveToneLibrary })

export function useTones(): ToneState {
  return useSyncExternalStore(toneStore.subscribe, toneStore.getState)
}

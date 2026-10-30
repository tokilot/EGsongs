// Plays the stems of one separation together, sample-locked: all of them are decoded and started on one audio
// clock, so any mix of them (or one alone) lines up exactly. A stem is heard when it is switched on, unless some
// stems are soloed: then only those are heard.

export interface StemSource {
  name: string
  url: string
}

export interface MixerState {
  /** Stems decoded so far, of `total`. */
  loaded: number
  total: number
  error: string | null
  playing: boolean
  /** Seconds. */
  time: number
  duration: number
  enabled: ReadonlySet<string>
  soloed: ReadonlySet<string>
}

// Fades instead of switching, so turning a stem on or off does not click.
const FADE_SECONDS = 0.015

// One for the page, however many separations are looked at (browsers limit how many can be open).
let sharedContext: AudioContext | null = null
const audioContext = () => (sharedContext ??= new AudioContext())

/**
 * `open()` connects it and loads what is missing, `close()` stops and disconnects it; both may be called again
 * (React runs effects twice in development).
 */
export class StemMixer {
  private readonly stems: StemSource[]
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly gains = new Map<string, GainNode>()
  private sources: AudioBufferSourceNode[] = []
  private readonly listeners = new Set<() => void>()
  private state: MixerState
  /** Where playback stands while paused, and where it started from while playing. */
  private offset = 0
  /** The context's time at which the recording's second 0 played (while playing). */
  private startedAt = 0
  private frame = 0
  /** Bumped by open() and close(), so a load still under way from before knows to stop. */
  private generation = 0

  constructor(stems: StemSource[], enabled: string[]) {
    this.stems = stems
    this.state = { loaded: 0, total: stems.length, error: null, playing: false, time: 0, duration: 0, enabled: new Set(enabled), soloed: new Set() }
  }

  private get context() {
    return audioContext()
  }

  open() {
    const generation = ++this.generation
    for (const stem of this.stems) {
      const gain = this.gains.get(stem.name) ?? this.context.createGain()
      gain.connect(this.context.destination)
      this.gains.set(stem.name, gain)
    }
    this.applyGains(true)
    void this.load(generation)
  }

  close() {
    this.generation++
    this.pause()
    for (const gain of this.gains.values()) gain.disconnect()
  }

  private async load(generation: number) {
    try {
      // One after another: decoding all at once would hold every compressed file and its decoding at the same time.
      for (const stem of this.stems) {
        if (this.buffers.has(stem.name)) continue
        const response = await fetch(stem.url)
        if (!response.ok) throw new Error(`${stem.name}: ${response.status}`)
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer())
        if (generation !== this.generation) return
        this.buffers.set(stem.name, buffer)
        this.update({ loaded: this.buffers.size, duration: Math.max(this.state.duration, buffer.duration) })
      }
    } catch (error) {
      if (generation === this.generation) this.update({ error: (error as Error).message })
    }
  }

  get ready() {
    return this.state.loaded === this.state.total && this.state.total > 0
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = () => this.state

  private update(change: Partial<MixerState>) {
    this.state = { ...this.state, ...change }
    for (const listener of this.listeners) listener()
  }

  private now() {
    // Until the stems start (a moment after play), the position stays where playing started from.
    return this.state.playing ? Math.min(Math.max(this.context.currentTime - this.startedAt, this.offset), this.state.duration) : this.offset
  }

  play() {
    if (this.state.playing || !this.ready) return
    if (this.offset >= this.state.duration) this.offset = 0
    void this.context.resume()
    // A moment ahead, so that every stem starts on the same sample.
    const at = this.context.currentTime + 0.05
    this.sources = [...this.buffers].map(([name, buffer]) => {
      const source = this.context.createBufferSource()
      source.buffer = buffer
      source.connect(this.gains.get(name)!)
      source.start(at, Math.min(this.offset, buffer.duration))
      return source
    })
    this.startedAt = at - this.offset
    this.update({ playing: true })
    this.tick()
  }

  pause() {
    if (!this.state.playing) return
    this.offset = this.now()
    this.stopSources()
    this.update({ playing: false, time: this.offset })
  }

  toggle() {
    if (this.state.playing) this.pause()
    else this.play()
  }

  seek(seconds: number) {
    const playing = this.state.playing
    if (playing) this.stopSources()
    this.offset = Math.min(Math.max(seconds, 0), this.state.duration)
    this.update({ playing: false, time: this.offset })
    if (playing) this.play()
  }

  setEnabled(name: string, on: boolean) {
    const enabled = new Set(this.state.enabled)
    if (on) enabled.add(name)
    else enabled.delete(name)
    this.update({ enabled })
    this.applyGains()
  }

  setSolo(name: string, on: boolean) {
    const soloed = new Set(this.state.soloed)
    if (on) soloed.add(name)
    else soloed.delete(name)
    this.update({ soloed })
    this.applyGains()
  }

  /** Whether a stem is heard now. */
  audible(name: string) {
    return this.state.soloed.size > 0 ? this.state.soloed.has(name) : this.state.enabled.has(name)
  }

  private applyGains(immediately = false) {
    for (const [name, gain] of this.gains) {
      const level = this.audible(name) ? 1 : 0
      if (immediately) gain.gain.value = level
      else gain.gain.setTargetAtTime(level, this.context.currentTime, FADE_SECONDS)
    }
  }

  private stopSources() {
    cancelAnimationFrame(this.frame)
    for (const source of this.sources) {
      try {
        source.stop()
      } catch {
        // Never started.
      }
      source.disconnect()
    }
    this.sources = []
  }

  // Moves the shown time along while playing, and stops at the end.
  private tick = () => {
    if (!this.state.playing) return
    const time = this.now()
    if (time >= this.state.duration) {
      this.stopSources()
      this.offset = 0
      this.update({ playing: false, time: 0 })
      return
    }
    this.update({ time })
    this.frame = requestAnimationFrame(this.tick)
  }
}

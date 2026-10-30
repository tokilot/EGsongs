// Click sounds made with Web Audio, independent of alphaTab's synthesizer. Used for the count-in (so the song
// position does not move and no music plays while it runs) and for the free-running metronome.

let shared: AudioContext | null = null

function audio(): AudioContext {
  shared ??= new AudioContext()
  // Browsers keep a context suspended until a user gesture; both callers run from one.
  if (shared.state === 'suspended') void shared.resume()
  return shared
}

/** One short blip at audio time `when`; the first beat of a bar is higher and louder. */
function scheduleClick(context: AudioContext, when: number, accent: boolean, volume: number): OscillatorNode {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'square'
  oscillator.frequency.value = accent ? 1568 : 1047
  const peak = Math.max(0.0001, volume * (accent ? 0.5 : 0.32))
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(peak, when + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.06)
  oscillator.connect(gain).connect(context.destination)
  oscillator.start(when)
  oscillator.stop(when + 0.08)
  return oscillator
}

export interface CountIn {
  /** Resolves true when the last beat has passed, false when it was cancelled. */
  done: Promise<boolean>
  cancel(): void
}

/** Plays `beats` clicks `secondsPerBeat` apart, starting now. */
export function playCountIn(beats: number, secondsPerBeat: number, volume = 1): CountIn {
  const context = audio()
  const start = context.currentTime + 0.05
  const oscillators: OscillatorNode[] = []
  for (let beat = 0; beat < beats; beat++) oscillators.push(scheduleClick(context, start + beat * secondsPerBeat, beat === 0, volume))

  let finish: (completed: boolean) => void = () => undefined
  const done = new Promise<boolean>((resolve) => {
    finish = resolve
  })
  const timer = setTimeout(() => finish(true), (0.05 + beats * secondsPerBeat) * 1000)
  return {
    done,
    cancel() {
      clearTimeout(timer)
      for (const oscillator of oscillators) {
        try {
          oscillator.stop()
        } catch {
          // already finished
        }
        oscillator.disconnect()
      }
      finish(false)
    },
  }
}

export interface MetronomeSettings {
  /** Quarter notes per minute. */
  bpm: number
  /** Beats per bar. */
  numerator: number
  /** The note value that gets the beat: 2, 4, 8 or 16. */
  denominator: number
}

export const BPM_MIN = 30
export const BPM_MAX = 300
export const DENOMINATORS = [2, 4, 8, 16]

/** Seconds between two clicks: the tempo counts quarter notes, the denominator says what one beat is. */
export function secondsPerBeat(bpm: number, denominator: number): number {
  return (60 / bpm) * (4 / denominator)
}

const LOOKAHEAD_SECONDS = 0.12
const TICK_MS = 25

/** A metronome that runs on its own, whatever the player is doing. */
export class FreeMetronome {
  private timer: ReturnType<typeof setInterval> | null = null
  private nextTime = 0
  private beat = 0
  private settings: MetronomeSettings = { bpm: 100, numerator: 4, denominator: 4 }

  get running(): boolean {
    return this.timer !== null
  }

  /** Takes effect from the next click, also while running. */
  configure(settings: MetronomeSettings) {
    if (settings.numerator !== this.settings.numerator) this.beat = 0
    this.settings = settings
  }

  start() {
    if (this.timer !== null) return
    const context = audio()
    this.beat = 0
    this.nextTime = context.currentTime + 0.06
    // Schedule a little ahead on the audio clock so timer jitter is not heard.
    const schedule = () => {
      while (this.nextTime < context.currentTime + LOOKAHEAD_SECONDS) {
        scheduleClick(context, this.nextTime, this.beat === 0, 1)
        this.beat = (this.beat + 1) % this.settings.numerator
        this.nextTime += secondsPerBeat(this.settings.bpm, this.settings.denominator)
      }
    }
    schedule()
    this.timer = setInterval(schedule, TICK_MS)
  }

  stop() {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
  }
}

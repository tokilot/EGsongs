// Amp simulation for the electric guitar and bass tracks given a tone. The synthesizer renders those into up to
// eight extra outputs of its audio worklet ("amp buses", one per tone in use; see the amp bus patches in web/alphatab-patches.ts).
// Each bus runs through the signal chain of its tone (toneModules.ts): dynamics, filter, pedal, amp, cabinet, EQ,
// modulation, delay and reverb, all plain Web Audio plus two small worklet processors (ampWorklet.ts).
//
// The amp has two preamp stages with a slightly asymmetric tube-like curve between filters, a tone stack, a
// power stage that saturates with the master and a presence control after it; the input is low-passed first so
// the clipping does not fizz. The cabinets are filter models of 1x12, 2x12 and 4x12 boxes, and the reverbs use
// impulse responses generated on the spot. Gains are set on gain nodes around fixed curves, so turning a knob
// never rebuilds anything; switching a module on or off or changing its type rebuilds the chain with a short
// crossfade.
import { AMP_WORKLET_CODE } from './ampWorklet.ts'
import { engineModule, MODULE_ORDER, type ModuleId, type ToneChain, type ToneModule } from './toneModules.ts'

// ---- pure helpers (tested) ----

export const dbToGain = (db: number) => 10 ** (db / 20)

const clampKnob = (value: number) => Math.min(10, Math.max(0, Number.isFinite(value) ? value : 5))

/** Tone control knob to decibels: 5 is flat, 0 and 10 are -12 and +12 dB. */
export function toneDb(knob: number): number {
  return (clampKnob(knob) - 5) * 2.4
}

/** Level knob to a gain factor: 5 is unity, each step 2 dB. */
export function levelGain(knob: number): number {
  return dbToGain((clampKnob(knob) - 5) * 2)
}

/** Peak level of a guitar note coming out of the synthesizer, roughly; the makeup gains keep notes there. */
export const INPUT_PEAK = 0.35

/** The range of input a curve covers; louder input stays at the curve's ends. */
const CURVE_RANGE = 6

export type CurveKind = 'tube' | 'soft' | 'hard' | 'fuzz'

/** The transfer function of a clipping stage; slope 1 at zero, so small signals pass as they are. */
export function saturate(kind: CurveKind, x: number): number {
  switch (kind) {
    case 'tube': {
      // A biased tanh: the two half waves clip differently, which adds the even harmonics of a tube stage.
      const bias = 0.3
      return (Math.tanh(x + bias) - Math.tanh(bias)) / (1 - Math.tanh(bias) ** 2)
    }
    case 'soft':
      return Math.tanh(x)
    case 'hard':
      return x / (1 + Math.abs(x) ** 4) ** 0.25
    case 'fuzz': {
      // Hard and lopsided: the positive side flattens early, the negative side late.
      const y = x > 0 ? x / (1 + (x * 1.6) ** 6) ** (1 / 6) : x / (1 + (x * 0.6) ** 2) ** 0.5
      return y
    }
  }
}

/** A WaveShaper curve for a kind; the input is scaled by 1/CURVE_RANGE in front of it. Odd length, so 0 maps to 0. */
export function curveFor(kind: CurveKind, points = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points)
  for (let i = 0; i < points; i++) curve[i] = saturate(kind, ((i / (points - 1)) * 2 - 1) * CURVE_RANGE)
  return curve
}

/** The gain after a stage so a typical note comes out about as loud as it went in. */
export function makeupFor(kind: CurveKind, drive: number): number {
  const out = Math.abs(saturate(kind, Math.min(CURVE_RANGE, INPUT_PEAK * drive)))
  return out > 1e-6 ? INPUT_PEAK / out : 1
}

/** How the four amp types are built: filters around the stages and how far the gain knob drives them. */
export const AMP_VOICINGS = {
  clean: { inLowCut: 60, inHighCut: 9000, stage1: [0, 18], interLowCut: 40, interHighCut: 9000, stage2: [0, 4], bassHz: 100, midHz: 500, trebleHz: 2800 },
  crunch: { inLowCut: 90, inHighCut: 7500, stage1: [6, 26], interLowCut: 80, interHighCut: 7000, stage2: [0, 12], bassHz: 110, midHz: 700, trebleHz: 3000 },
  highgain: { inLowCut: 110, inHighCut: 7000, stage1: [12, 32], interLowCut: 140, interHighCut: 6000, stage2: [6, 20], bassHz: 110, midHz: 750, trebleHz: 3200 },
  metal: { inLowCut: 140, inHighCut: 6500, stage1: [16, 36], interLowCut: 180, interHighCut: 5500, stage2: [10, 26], bassHz: 120, midHz: 800, trebleHz: 3300 },
  // A bass amp keeps the lows a guitar amp cuts before its clipping (a bass's E is 41 Hz) and drives gently.
  bass: { inLowCut: 25, inHighCut: 6000, stage1: [0, 20], interLowCut: 20, interHighCut: 6000, stage2: [0, 10], bassHz: 80, midHz: 500, trebleHz: 2500 },
} satisfies Record<string, { stage1: number[]; stage2: number[]; [key: string]: unknown }>

type AmpType = keyof typeof AMP_VOICINGS

/** The gains in front of the two preamp stages for a type and gain knob, in dB. */
export function ampStageDb(type: string, gain: number): [number, number] {
  const voicing = AMP_VOICINGS[(type in AMP_VOICINGS ? type : 'clean') as AmpType]
  const share = clampKnob(gain) / 10
  return [voicing.stage1[0] + share * (voicing.stage1[1] - voicing.stage1[0]), voicing.stage2[0] + share * (voicing.stage2[1] - voicing.stage2[0])]
}

// The cabinets: [type, frequency, Q, gain dB]. Built from what makes a guitar speaker sound like one: no deep lows,
// the box resonance, fewer boxy low mids, the cone's presence peak and break-up ripples, and a steep top end. The
// 4x12 is the one measured against a metal recording (Flying Cloud, 2026-10-22).
const CABINETS: Record<string, Array<[BiquadFilterType, number, number, number]>> = {
  '1x12': [
    ['highpass', 85, 0.7, 0],
    ['peaking', 130, 1.2, 2.5],
    ['peaking', 420, 1, -2],
    ['peaking', 1900, 1.4, 3],
    ['peaking', 3300, 3, -3],
    ['lowpass', 5200, 1, 0],
    ['lowpass', 7200, 0.7, 0],
  ],
  '2x12': [
    ['highpass', 75, 0.7, 0],
    ['peaking', 110, 1.2, 3.5],
    ['peaking', 320, 1, -2],
    ['peaking', 1700, 1.6, 1.5],
    ['peaking', 2500, 1.4, 2],
    ['peaking', 3700, 3, -3],
    ['lowpass', 4800, 1, 0],
    ['lowpass', 6500, 0.7, 0],
  ],
  '4x10': [
    ['highpass', 35, 0.7, 0],
    ['peaking', 70, 1, 3],
    ['peaking', 250, 1, -1.5],
    ['peaking', 900, 1.2, 1.5],
    ['peaking', 2800, 2, 1],
    ['lowpass', 4500, 0.9, 0],
    ['lowpass', 6500, 0.7, 0],
  ],
  '4x12': [
    ['highpass', 70, 0.7, 0],
    ['peaking', 95, 1.1, 5],
    ['peaking', 330, 1, -2.5],
    ['peaking', 2200, 1.2, 2.5],
    ['peaking', 3400, 3, -2],
    ['lowpass', 4200, 1, 0],
    ['lowpass', 5600, 0.7, 0],
  ],
}

// A small seeded random generator, so the generated reverbs are the same every time (and in the tests).
function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A stereo impulse response for a reverb type: decaying noise shaped per type. Room: early reflections and a
 * darker tail; hall: a slow build-up and a tail that darkens as it goes; plate: dense and bright from the start;
 * spring: repeats every 33 ms over a mid-range band (the "boing"). `decay` is the time to fall by 60 dB.
 */
export function reverbImpulse(type: string, decay: number, sampleRate: number): [Float32Array, Float32Array] {
  const seconds = Math.min(9, decay * 1.1 + 0.05)
  const length = Math.max(1, Math.floor(seconds * sampleRate))
  const channels: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)]
  channels.forEach((data, channel) => {
    const next = random(1234 + channel * 777 + type.length * 31)
    const k = 6.91 / Math.max(0.05, decay)
    let smooth = 0
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate
      const noise = next() * 2 - 1
      let envelope = Math.exp(-k * t)
      if (type === 'hall') envelope *= Math.min(1, t / 0.03)
      // Darkening: a one-pole low-pass whose cut-off falls with time (none for the plate).
      const darkening = type === 'plate' ? 0 : type === 'hall' ? Math.min(0.9, 0.2 + t * 0.35) : type === 'spring' ? 0.5 : Math.min(0.85, 0.35 + t * 0.6)
      smooth = smooth * darkening + noise * (1 - darkening)
      data[i] = smooth * envelope
    }
    if (type === 'room') {
      // A few discrete early reflections.
      for (const [ms, gain] of [[7, 0.6], [13, 0.45], [19, 0.4], [29, 0.3], [37, 0.25]]) {
        const at = Math.floor((ms / 1000) * sampleRate) + channel * 11
        if (at < length) data[at] += (channel ? -gain : gain) * 0.8
      }
    }
    if (type === 'spring') {
      const gap = Math.floor(0.033 * sampleRate)
      for (let i = gap; i < length; i++) data[i] += data[i - gap] * 0.55
    }
    // Same energy for every type and decay, so the mix knob means the same thing.
    let energy = 0
    for (let i = 0; i < length; i++) energy += data[i] * data[i]
    const scale = energy > 0 ? Math.sqrt(0.5 / energy) : 0
    for (let i = 0; i < length; i++) data[i] *= scale
  })
  return channels
}

// ---- the audio graph ----

// How quickly knob changes are followed, in seconds: fast, but without clicks.
const GLIDE = 0.03
const CROSSFADE = 0.02

interface Unit {
  input: AudioNode
  output: AudioNode
  set(module: ToneModule): void
  dispose(): void
}

// The nodes of one unit, so they can all be disconnected (and oscillators stopped) when it goes.
class Parts {
  readonly nodes: AudioNode[] = []
  readonly oscillators: OscillatorNode[] = []
  readonly ctx: AudioContext
  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }
  add<T extends AudioNode>(node: T): T {
    this.nodes.push(node)
    return node
  }
  gain(value = 1) {
    const node = this.add(this.ctx.createGain())
    node.gain.value = value
    return node
  }
  filter(type: BiquadFilterType, frequency: number, q = 0.7, gain = 0) {
    const node = this.add(this.ctx.createBiquadFilter())
    node.type = type
    node.frequency.value = frequency
    node.Q.value = q
    node.gain.value = gain
    return node
  }
  shaper(kind: CurveKind) {
    const node = this.add(this.ctx.createWaveShaper())
    node.curve = curveFor(kind)
    node.oversample = '4x'
    return node
  }
  lfo(rate: number) {
    const osc = this.add(this.ctx.createOscillator())
    osc.frequency.value = rate
    osc.start()
    this.oscillators.push(osc)
    return osc
  }
  dispose() {
    for (const osc of this.oscillators) {
      try {
        osc.stop()
      } catch {
        // already stopped
      }
    }
    for (const node of this.nodes) node.disconnect()
  }
}

const series = (...nodes: AudioNode[]) => nodes.reduce((from, to) => from.connect(to))
const glide = (param: AudioParam, value: number, ctx: AudioContext, time = GLIDE) => param.setTargetAtTime(value, ctx.currentTime, time)

// A clipping stage: input gain (the drive), the curve, and the makeup that brings the level back.
function stage(parts: Parts, kind: CurveKind) {
  const drive = parts.gain(1 / CURVE_RANGE)
  const shaper = parts.shaper(kind)
  const makeup = parts.gain(1)
  series(drive, shaper, makeup)
  return {
    input: drive,
    output: makeup,
    set(gain: number) {
      glide(drive.gain, gain / CURVE_RANGE, parts.ctx)
      glide(makeup.gain, makeupFor(kind, gain), parts.ctx)
    },
  }
}

function dynaUnit(parts: Parts, type: string): Unit {
  const ctx = parts.ctx
  const comp = parts.add(ctx.createDynamicsCompressor())
  const out = parts.gain()
  comp.connect(out)
  return {
    input: comp,
    output: out,
    set: ({ params }) => {
      const fast = type === 'fast'
      glide(comp.threshold, -8 - params.sustain * 4, ctx)
      comp.ratio.value = fast ? 10 : 4
      comp.knee.value = fast ? 4 : 18
      comp.attack.value = fast ? 0.0005 + params.attack * 0.002 : 0.004 + params.attack * 0.004
      comp.release.value = fast ? 0.12 : 0.3
      glide(out.gain, dbToGain(params.sustain * 1.8 + (params.level - 5) * 1.6), ctx)
    },
    dispose: () => parts.dispose(),
  }
}

function filterUnit(parts: Parts, type: string, worklets: boolean): Unit {
  const ctx = parts.ctx
  const input = parts.gain()
  const band = parts.filter('bandpass', 900, 4)
  const wet = parts.gain(2.5)
  const dry = parts.gain(0.2)
  const out = parts.gain()
  series(input, band, wet, out)
  series(input, dry, out)
  // The auto-wah opens with the playing: the envelope of the input, scaled, is added to the filter frequency.
  const sweep = parts.gain(0)
  if (type === 'autowah' && worklets) {
    const envelope = parts.add(new AudioWorkletNode(ctx, 'tabs-envelope', { numberOfOutputs: 1, outputChannelCount: [1] }))
    series(input, envelope, sweep)
    sweep.connect(band.frequency)
  }
  return {
    input,
    output: out,
    set: ({ params }) => {
      glide(band.Q, 2 + params.q * 1.2, ctx)
      if (type === 'wah') glide(band.frequency, 380 * 6 ** (params.position / 10), ctx)
      else {
        glide(band.frequency, 350, ctx)
        glide(sweep.gain, (300 + params.range * 220) * (0.5 + params.sens / 4) * (worklets ? 1 : 0), ctx)
        if (!worklets) glide(band.frequency, 900, ctx)
      }
    },
    dispose: () => parts.dispose(),
  }
}

const OD_VOICINGS: Record<string, { kind: CurveKind; lowCut: number; pushDb: number; driveDb: [number, number] }> = {
  boost: { kind: 'soft', lowCut: 40, pushDb: 0, driveDb: [0, 8] },
  overdrive: { kind: 'soft', lowCut: 220, pushDb: 6, driveDb: [6, 32] },
  distortion: { kind: 'hard', lowCut: 90, pushDb: 0, driveDb: [14, 44] },
  fuzz: { kind: 'fuzz', lowCut: 60, pushDb: 0, driveDb: [18, 48] },
}

function odUnit(parts: Parts, type: string): Unit {
  const ctx = parts.ctx
  const voicing = OD_VOICINGS[type] ?? OD_VOICINGS.overdrive
  const lowCut = parts.filter('highpass', voicing.lowCut)
  const push = parts.filter('peaking', 720, 0.7, voicing.pushDb)
  const clip = stage(parts, voicing.kind)
  const dcBlock = parts.filter('highpass', 15)
  // The boost has a treble shelf for its tone knob; the others a low-pass, like their pedals.
  const tone = type === 'boost' ? parts.filter('highshelf', 2500) : parts.filter('lowpass', 3000, 0.7)
  const level = parts.gain()
  series(lowCut, push, clip.input)
  series(clip.output, dcBlock, tone, level)
  return {
    input: lowCut,
    output: level,
    set: ({ params }) => {
      clip.set(dbToGain(voicing.driveDb[0] + (params.gain / 10) * (voicing.driveDb[1] - voicing.driveDb[0])))
      if (type === 'boost') glide(tone.gain, (params.tone - 5) * 1.6, ctx)
      else {
        const range: Record<string, [number, number]> = { overdrive: [1500, 6500], distortion: [800, 7200], fuzz: [600, 7200] }
        const [low, high] = range[type] ?? range.overdrive
        glide(tone.frequency, low * (high / low) ** (params.tone / 10), ctx)
      }
      glide(level.gain, levelGain(params.level), ctx)
    },
    dispose: () => parts.dispose(),
  }
}

function ampUnit(parts: Parts, type: string, worklets: boolean): Unit {
  const ctx = parts.ctx
  const voicing = AMP_VOICINGS[(type in AMP_VOICINGS ? type : 'clean') as AmpType]
  const input = parts.gain()
  // A noise gate in front, as on the amps of the app this is modelled on: it also makes palm mutes stop short.
  const gate = worklets ? parts.add(new AudioWorkletNode(ctx, 'tabs-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })) : null
  const inLowCut = parts.filter('highpass', voicing.inLowCut)
  const inHighCut = parts.filter('lowpass', voicing.inHighCut)
  const first = stage(parts, 'tube')
  const dcBlock = parts.filter('highpass', 20)
  const interLowCut = parts.filter('highpass', voicing.interLowCut)
  const interHighCut = parts.filter('lowpass', voicing.interHighCut)
  const second = stage(parts, 'soft')
  const bass = parts.filter('lowshelf', voicing.bassHz)
  const mid = parts.filter('peaking', voicing.midHz, 0.7)
  const treble = parts.filter('highshelf', voicing.trebleHz)
  const power = stage(parts, 'soft')
  const presence = parts.filter('highshelf', 3500)
  const out = parts.gain()
  if (gate) series(input, gate, inLowCut)
  else series(input, inLowCut)
  series(inLowCut, inHighCut, first.input)
  series(first.output, dcBlock, interLowCut, interHighCut, second.input)
  series(second.output, bass, mid, treble, power.input)
  series(power.output, presence, out)
  return {
    input,
    output: out,
    set: ({ params }) => {
      const [db1, db2] = ampStageDb(type, params.gain)
      first.set(dbToGain(db1))
      second.set(dbToGain(db2))
      glide(bass.gain, toneDb(params.bass), ctx)
      glide(mid.gain, toneDb(params.mid), ctx)
      glide(treble.gain, toneDb(params.treble), ctx)
      // The master both drives the power stage harder and sets the level.
      power.set(dbToGain(params.master * 1.6))
      glide(presence.gain, toneDb(params.presence), ctx)
      glide(out.gain, levelGain(params.master), ctx)
      gate?.parameters.get('threshold')?.setValueAtTime(params.gate > 0 ? -78 + params.gate * 5 : -140, ctx.currentTime)
    },
    dispose: () => parts.dispose(),
  }
}

function cabUnit(parts: Parts, type: string): Unit {
  const ctx = parts.ctx
  const lowCut = parts.filter('highpass', 60)
  const shape = (CABINETS[type] ?? CABINETS['4x12']).map(([kind, frequency, q, gain]) => parts.filter(kind, frequency, q, gain))
  const highCut = parts.filter('lowpass', 9000)
  series(lowCut, ...shape, highCut)
  return {
    input: lowCut,
    output: highCut,
    set: ({ params }) => {
      glide(lowCut.frequency, params.lowcut, ctx)
      glide(highCut.frequency, params.highcut, ctx)
    },
    dispose: () => parts.dispose(),
  }
}

const EQ_BANDS: Array<[string, number]> = [
  ['b100', 100],
  ['b400', 400],
  ['b800', 800],
  ['b1600', 1600],
  ['b4000', 4000],
]

function eqUnit(parts: Parts): Unit {
  const ctx = parts.ctx
  const bands = EQ_BANDS.map(([, frequency]) => parts.filter('peaking', frequency, 1))
  const level = parts.gain()
  series(...bands, level)
  return {
    input: bands[0],
    output: level,
    set: ({ params }) => {
      EQ_BANDS.forEach(([key], index) => glide(bands[index].gain, params[key], ctx))
      glide(level.gain, dbToGain(params.level), ctx)
    },
    dispose: () => parts.dispose(),
  }
}

function modUnit(parts: Parts, type: string): Unit {
  const ctx = parts.ctx
  const input = parts.gain()
  const out = parts.gain()
  const lfo = parts.lfo(1)
  const depth = parts.gain(0)
  lfo.connect(depth)
  if (type === 'tremolo') {
    const amp = parts.gain(1)
    series(input, amp, out)
    depth.connect(amp.gain)
    return {
      input,
      output: out,
      set: ({ params }) => {
        glide(lfo.frequency, params.rate, ctx)
        glide(amp.gain, 1 - (params.depth / 10) * 0.5, ctx)
        glide(depth.gain, (params.depth / 10) * 0.5, ctx)
      },
      dispose: () => parts.dispose(),
    }
  }
  const dry = parts.gain(1)
  const wet = parts.gain(0.5)
  series(input, dry, out)
  if (type === 'phaser') {
    const stages = [0, 1, 2, 3].map(() => parts.filter('allpass', 700, 0.6))
    series(input, ...stages, wet, out)
    for (const item of stages) depth.connect(item.frequency)
    return {
      input,
      output: out,
      set: ({ params }) => {
        glide(lfo.frequency, params.rate, ctx)
        glide(depth.gain, (params.depth / 10) * 600, ctx)
        glide(wet.gain, params.mix / 10, ctx)
      },
      dispose: () => parts.dispose(),
    }
  }
  // Chorus, flanger and vibrato: a short delay whose time the LFO sweeps.
  const shape = { chorus: [0.012, 0.005], flanger: [0.003, 0.0025], vibrato: [0.006, 0.004] }[type as 'chorus'] ?? [0.012, 0.005]
  const delay = parts.add(ctx.createDelay(0.05))
  delay.delayTime.value = shape[0]
  depth.connect(delay.delayTime)
  series(input, delay, wet, out)
  const feedback = parts.gain(0)
  if (type === 'flanger') series(delay, feedback, delay)
  return {
    input,
    output: out,
    set: ({ params }) => {
      glide(lfo.frequency, params.rate, ctx)
      glide(depth.gain, (params.depth / 10) * shape[1], ctx)
      if (type === 'vibrato') {
        glide(dry.gain, 0, ctx)
        glide(wet.gain, 1, ctx)
      } else {
        glide(wet.gain, (params.mix / 10) * 0.9, ctx)
        glide(feedback.gain, type === 'flanger' ? 0.4 + params.depth * 0.04 : 0, ctx)
      }
    },
    dispose: () => parts.dispose(),
  }
}

function delayUnit(parts: Parts, type: string): Unit {
  const ctx = parts.ctx
  const input = parts.gain()
  const out = parts.gain()
  const dry = parts.gain(1)
  const line = parts.add(ctx.createDelay(2))
  const tone = parts.filter('lowpass', type === 'analog' ? 2800 : type === 'tape' ? 4500 : 12000, 0.6)
  const feedback = parts.gain(0.3)
  const wet = parts.gain(0.3)
  series(input, dry, out)
  series(input, line, tone, wet, out)
  series(tone, feedback, line)
  if (type === 'tape') {
    // Wow: the tape speed drifts a little, so the repeats waver in pitch.
    const wow = parts.lfo(0.6)
    const amount = parts.gain(0.0015)
    series(wow, amount)
    amount.connect(line.delayTime)
  }
  return {
    input,
    output: out,
    set: ({ params }) => {
      glide(line.delayTime, params.time / 1000, ctx, 0.08)
      glide(feedback.gain, (params.feedback / 10) * 0.85, ctx)
      glide(wet.gain, (params.mix / 10) * 0.8, ctx)
    },
    dispose: () => parts.dispose(),
  }
}

function reverbUnit(parts: Parts, type: string): Unit {
  const ctx = parts.ctx
  const input = parts.gain()
  const out = parts.gain()
  const dry = parts.gain(1)
  const predelay = parts.add(ctx.createDelay(0.5))
  const convolver = parts.add(ctx.createConvolver())
  const wet = parts.gain(0.25)
  series(input, dry, out)
  series(input, predelay, convolver, wet, out)
  let decay = -1
  return {
    input,
    output: out,
    set: ({ params }) => {
      glide(predelay.delayTime, params.predelay / 1000, ctx)
      glide(wet.gain, (params.mix / 10) * 0.7, ctx)
      // A new impulse response only when the decay really changed (it restarts the tail).
      if (Math.abs(params.decay - decay) >= 0.05) {
        decay = params.decay
        const [left, right] = reverbImpulse(type, decay, ctx.sampleRate)
        const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate)
        buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0)
        buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1)
        convolver.buffer = buffer
      }
    },
    dispose: () => parts.dispose(),
  }
}

function makeUnit(ctx: AudioContext, id: ModuleId, type: string, worklets: boolean): Unit {
  const parts = new Parts(ctx)
  switch (id) {
    case 'dyna':
      return dynaUnit(parts, type)
    case 'filter':
      return filterUnit(parts, type, worklets)
    case 'od':
      return odUnit(parts, type)
    case 'amp':
      return ampUnit(parts, type, worklets)
    case 'cab':
      return cabUnit(parts, type)
    case 'eq':
      return eqUnit(parts)
    case 'mod':
      return modUnit(parts, type)
    case 'delay':
      return delayUnit(parts, type)
    case 'reverb':
      return reverbUnit(parts, type)
  }
}

// The modules that are on, with their types: when this changes, the chain is rebuilt.
const layoutOf = (chain: ToneChain, worklets: boolean) => `${worklets}|${MODULE_ORDER.map((id) => (chain[id].on ? chain[id].type : '-')).join(',')}`

/** One built chain: its modules in order between an entry and an exit gain (for the crossfade). */
class Chain {
  readonly entry: GainNode
  readonly exit: GainNode
  readonly units = new Map<ModuleId, Unit>()
  constructor(ctx: AudioContext, chain: ToneChain, worklets: boolean) {
    this.entry = ctx.createGain()
    this.exit = ctx.createGain()
    let previous: AudioNode = this.entry
    for (const id of MODULE_ORDER) {
      if (!chain[id].on) continue
      const unit = makeUnit(ctx, id, chain[id].type, worklets)
      unit.set(engineModule(id, chain[id]))
      previous.connect(unit.input)
      previous = unit.output
      this.units.set(id, unit)
    }
    previous.connect(this.exit)
  }
  set(chain: ToneChain) {
    for (const [id, unit] of this.units) unit.set(engineModule(id, chain[id]))
  }
  dispose() {
    for (const unit of this.units.values()) unit.dispose()
    this.entry.disconnect()
    this.exit.disconnect()
  }
}

class Bus {
  readonly input: GainNode
  private readonly output: AudioNode
  private readonly ctx: AudioContext
  private current: Chain | null = null
  private layout = ''

  constructor(ctx: AudioContext, output: AudioNode) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = output
  }

  /** An empty bus (no tone on it) has no chain: whatever reaches it goes nowhere. */
  clear() {
    const old = this.current
    if (!old) return
    this.input.disconnect(old.entry)
    old.dispose()
    this.current = null
    this.layout = ''
  }

  apply(chain: ToneChain, worklets: boolean) {
    const layout = layoutOf(chain, worklets)
    if (this.current && layout === this.layout) {
      this.current.set(chain)
      return
    }
    // Rebuild: the new chain fades in while the old one fades out, then the old one goes.
    const now = this.ctx.currentTime
    const next = new Chain(this.ctx, chain, worklets)
    this.input.connect(next.entry)
    next.exit.connect(this.output)
    next.exit.gain.setValueAtTime(0, now)
    next.exit.gain.linearRampToValueAtTime(1, now + CROSSFADE)
    const old = this.current
    if (old) {
      old.exit.gain.setValueAtTime(old.exit.gain.value, now)
      old.exit.gain.linearRampToValueAtTime(0, now + CROSSFADE)
      setTimeout(() => {
        this.input.disconnect(old.entry)
        old.dispose()
      }, CROSSFADE * 1000 + 60)
    }
    this.current = next
    this.layout = layout
  }
}

/** The amp buses (eight, see MAX_AMP_BUSES) and their chains, built on the synthesizer's audio context the first time it plays. */
export class AmpSim {
  private ctx: AudioContext | null = null
  private buses: Bus[] = []
  private analyser: AnalyserNode | null = null
  private worklets = false
  private readonly chains: Array<ToneChain | null> = Array.from({ length: 8 }, () => null)

  /** Called by the patched worklet output whenever it creates its node (every time playback starts). */
  attach(ctx: AudioContext, node: AudioNode) {
    if (ctx !== this.ctx) {
      this.ctx = ctx
      this.worklets = false
      // Everything the amps put out also goes past an analyser, so the checks can see the guitars sound here.
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 8192
      this.analyser.smoothingTimeConstant = 0
      const mix = ctx.createGain()
      mix.connect(ctx.destination)
      mix.connect(this.analyser)
      this.buses = this.chains.map(() => new Bus(ctx, mix))
      this.applyAll()
      // The gate and the auto-wah need the worklet processors; until they are in, those two do without.
      const url = URL.createObjectURL(new Blob([AMP_WORKLET_CODE], { type: 'application/javascript' }))
      ctx.audioWorklet
        .addModule(url)
        .then(() => {
          if (this.ctx !== ctx) return
          this.worklets = true
          this.applyAll()
        })
        .catch((error) => console.warn('amp worklet', error))
        .finally(() => URL.revokeObjectURL(url))
    }
    this.buses.forEach((bus, index) => node.connect(bus.input, index + 1, 0))
  }

  private applyAll() {
    this.chains.forEach((chain, index) => (chain ? this.buses[index]?.apply(chain, this.worklets) : this.buses[index]?.clear()))
  }

  /** The tone of bus 1–8 (null: none). Applies at once, also while playing. */
  setTone(bus: number, chain: ToneChain | null) {
    this.chains[bus - 1] = chain
    if (chain) this.buses[bus - 1]?.apply(chain, this.worklets)
    else this.buses[bus - 1]?.clear()
  }

  /**
   * The spectrum of what the amps put out right now: dB per FFT bin, with the sample rate to place the bins.
   * Null before they are connected. For tools that match a tone against a recording.
   */
  spectrum(): { db: Float32Array<ArrayBuffer>; sampleRate: number } | null {
    const analyser = this.analyser
    if (!analyser || !this.ctx) return null
    const db = new Float32Array(analyser.frequencyBinCount)
    analyser.getFloatFrequencyData(db)
    return { db, sampleRate: this.ctx.sampleRate }
  }

  /** How loud the amps are right now (RMS of the last few milliseconds); -1 before they are connected. For the checks. */
  level(): number {
    const analyser = this.analyser
    if (!analyser) return -1
    const data = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(data)
    return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length)
  }
}

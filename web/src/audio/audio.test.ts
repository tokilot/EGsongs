import { describe, expect, it } from 'vitest'
import { AMP_VOICINGS, INPUT_PEAK, ampStageDb, curveFor, levelGain, makeupFor, reverbImpulse, saturate, toneDb } from './ampSim.ts'
import { MODULE_ORDER, MODULES, cleanChain, defaultChain, paramsFor } from './toneChain.ts'


describe('tone chains', () => {
  it('has every module in order with defaults inside their ranges', () => {
    const chain = defaultChain()
    expect(Object.keys(chain).sort()).toEqual([...MODULE_ORDER].sort())
    for (const id of MODULE_ORDER) {
      for (const param of MODULES[id].params) {
        const value = chain[id].params[param.key]
        expect(value, `${id}.${param.key}`).toBeGreaterThanOrEqual(param.min)
        expect(value, `${id}.${param.key}`).toBeLessThanOrEqual(param.max)
      }
    }
    // Only the amp and the cabinet are on to begin with.
    expect(MODULE_ORDER.filter((id) => chain[id].on)).toEqual(['amp', 'cab'])
  })

  it('cleans a stored chain: unknown types, missing and out-of-range knobs', () => {
    const chain = cleanChain({ amp: { on: true, type: 'nonsense', params: { gain: 999, bass: 'x' } }, delay: { on: true, type: 'tape', params: { time: 5 } } })
    expect(chain.amp.type).toBe('clean')
    expect(chain.amp.params.gain).toBe(100)
    expect(chain.amp.params.bass).toBe(50)
    expect(chain.delay).toMatchObject({ on: true, type: 'tape' })
    expect(chain.delay.params.time).toBe(20)
    expect(chain.reverb.on).toBe(false)
  })

  it('shows each type only its own knobs', () => {
    expect(paramsFor('filter', 'wah').map((param) => param.key)).toEqual(['position', 'q'])
    expect(paramsFor('filter', 'autowah').map((param) => param.key)).toEqual(['sens', 'range', 'q'])
    expect(paramsFor('mod', 'tremolo').map((param) => param.key)).toEqual(['rate', 'depth'])
  })
})

describe('amp engine', () => {
  it('maps the knobs like a pedal: 5 is neutral, 0 and 10 the ends', () => {
    expect(toneDb(5)).toBe(0)
    expect(toneDb(0)).toBe(-12)
    expect(toneDb(10)).toBe(12)
    expect(levelGain(5)).toBe(1)
    expect(toneDb(42)).toBe(12)
    expect(toneDb(Number.NaN)).toBe(0)
  })

  it('has curves that pass small signals and keep a typical note at its level', () => {
    for (const kind of ['tube', 'soft', 'hard', 'fuzz'] as const) {
      expect(saturate(kind, 0)).toBeCloseTo(0, 6)
      // Slope 1 at zero.
      expect(saturate(kind, 0.001) / 0.001).toBeCloseTo(1, 1)
      // Within the range the curve covers (louder input is held at its ends, and so is the makeup).
      for (const drive of [1, 5, 15]) expect(Math.abs(saturate(kind, INPUT_PEAK * drive) * makeupFor(kind, drive))).toBeCloseTo(INPUT_PEAK, 5)
      const curve = curveFor(kind)
      expect(curve.length % 2).toBe(1)
      expect(curve[(curve.length - 1) / 2]).toBeCloseTo(0, 6)
    }
    // The tube stage is lopsided (even harmonics); tanh is not.
    expect(saturate('tube', 2) + saturate('tube', -2)).not.toBeCloseTo(0, 2)
    expect(saturate('soft', 2) + saturate('soft', -2)).toBeCloseTo(0, 6)
  })

  it('drives the higher-gain amps harder at the same knob', () => {
    const total = (type: string) => ampStageDb(type, 5).reduce((a, b) => a + b, 0)
    expect(total('clean')).toBeLessThan(total('crunch'))
    expect(total('crunch')).toBeLessThan(total('highgain'))
    expect(total('highgain')).toBeLessThan(total('metal'))
    expect(ampStageDb('clean', 0)).toEqual([AMP_VOICINGS.clean.stage1[0], AMP_VOICINGS.clean.stage2[0]])
  })

  it('generates reverbs of the asked length, decaying, with the same energy for every type', () => {
    for (const type of ['room', 'hall', 'plate', 'spring']) {
      const [left, right] = reverbImpulse(type, 2, 8000)
      expect(left.length).toBeGreaterThan(8000 * 2)
      const energy = (data: Float32Array, from: number, to: number) => data.slice(from, to).reduce((sum, value) => sum + value * value, 0)
      expect(energy(left, 0, left.length)).toBeCloseTo(0.5, 3)
      // The first half second has much more in it than the last.
      expect(energy(left, 0, 4000)).toBeGreaterThan(energy(left, left.length - 4000, left.length) * 20)
      // The two sides differ (a stereo room), and the same call gives the same response.
      expect(left).not.toEqual(right)
      expect(reverbImpulse(type, 2, 8000)[0]).toEqual(left)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { AMP_VOICINGS, INPUT_PEAK, ampStageDb, curveFor, levelGain, makeupFor, reverbImpulse, saturate, toneDb } from './ampSim.ts'
import { BUILT_IN_TONES, DEFAULT_TONE_LIBRARY, FLYING_CLOUD_TONE, MAX_AMP_BUSES, PREVIEW_CHANNELS, allTones, cleanTrackTones, findTone, isStarterFlyingCloud, legacyChain, parseToneLibrary, planAmpBuses, routedProgram, toneFamilyOf, toneProgram, withTone, withoutTone, type Tone, type ToneLibrary } from './guitarTones.ts'
import { MODULE_ORDER, MODULES, chainWith, cleanChain, defaultChain, engineModule, paramsFor, sameChain } from './toneModules.ts'

const mine: Tone = { id: 'custom-1', name: 'My lead', family: 'guitar', builtIn: false, chain: chainWith({ amp: { type: 'metal', params: { gain: 80 } } }) }
const oldParams = { gain: 8, bass: 6, mid: 7, treble: 5, reverb: 3, level: 6 }

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

describe('tone library', () => {
  it('reads the stored library and drops anything malformed', () => {
    expect(parseToneLibrary(null)).toEqual(DEFAULT_TONE_LIBRARY)
    const parsed = parseToneLibrary({
      presetVersion: 5,
      custom: [mine, { id: 'broken', name: 'x', family: 'guitar' }, { ...mine, id: 'custom-2', builtIn: true }, { ...mine, id: 'odd', family: 'piano' }],
    })
    expect(parsed.custom.map((tone) => tone.id)).toEqual(['custom-1', 'custom-2'])
    // Only the built-in list makes a tone built in.
    expect(parsed.custom.every((tone) => !tone.builtIn)).toBe(true)
  })

  it('keeps the tones of before (bus types) as guitar tones', () => {
    const parsed = parseToneLibrary({ presetVersion: 4, enabled: true, assign: { distortion: 'old' }, custom: [{ id: 'old', name: 'Old', type: 'overdrive', builtIn: false, chain: mine.chain }] })
    expect(parsed.custom[0]).toMatchObject({ id: 'old', family: 'guitar' })
    expect(parsed.custom[0].chain).toEqual(mine.chain)
  })

  it('turns the six-knob tones of before into chains', () => {
    const parsed = parseToneLibrary({ presetVersion: 2, custom: [{ id: 'old', name: 'Old', type: 'distortion', params: oldParams }] })
    const tone = parsed.custom.find((item) => item.id === 'old')!
    expect(tone.chain.amp).toMatchObject({ on: true, type: 'highgain', params: { gain: 80, bass: 60, mid: 70, treble: 50, master: 60 } })
    expect(tone.chain.reverb).toMatchObject({ on: true, type: 'room', params: { mix: 30 } })
    expect(sameChain(tone.chain, legacyChain(oldParams, 'distortion'))).toBe(true)
  })

  it('adds, replaces and removes tones', () => {
    let library = withTone({ custom: [] }, mine)
    expect(allTones(library)).toHaveLength(BUILT_IN_TONES.length + 1)
    library = withTone(library, { ...mine, name: 'Solo' })
    expect(library.custom).toHaveLength(1)
    expect(findTone(library, mine.id)?.name).toBe('Solo')
    library = withoutTone(library, mine.id)
    expect(findTone(library, mine.id)).toBeNull()
    // Built-in templates for both families.
    expect(new Set(BUILT_IN_TONES.map((tone) => tone.family))).toEqual(new Set(['guitar', 'bass']))
  })

  it('offers Flying Cloud once, and keeps edits and deletion', () => {
    expect(isStarterFlyingCloud(parseToneLibrary({ custom: [] }).custom[0])).toBe(true)
    const untouched = { id: FLYING_CLOUD_TONE.id, name: FLYING_CLOUD_TONE.name, type: 'distortion', params: { gain: 9, bass: 4.5, mid: 4.5, treble: 2.5, reverb: 2.5, level: 5 } }
    expect(isStarterFlyingCloud(parseToneLibrary({ presetVersion: 2, custom: [untouched] }).custom[0])).toBe(true)
    const kept = parseToneLibrary({ presetVersion: 2, custom: [{ ...untouched, params: { ...untouched.params, gain: 6 } }] }).custom[0]
    expect(kept.chain.amp.params.gain).toBe(60)
    expect(parseToneLibrary({ presetVersion: 5, custom: [] }).custom).toEqual([])
    const saved = withTone(DEFAULT_TONE_LIBRARY, mine)
    expect(parseToneLibrary(JSON.parse(JSON.stringify(saved))).custom.find((tone) => tone.id === mine.id)?.chain).toEqual(mine.chain)
  })

  it('reads the 0–10 knobs of storage version 3 as 0–100, and leaves units alone', () => {
    const v3 = { id: 'v3', name: 'V3', type: 'distortion', chain: { amp: { on: true, type: 'metal', params: { gain: 7.5, bass: 4 } }, delay: { on: true, type: 'digital', params: { time: 400, mix: 3 } } } }
    const tone = parseToneLibrary({ presetVersion: 3, custom: [v3] }).custom.find((item) => item.id === 'v3')!
    expect(tone.chain.amp.params).toMatchObject({ gain: 75, bass: 40 })
    expect(tone.chain.delay.params).toMatchObject({ time: 400, mix: 30 })
    expect(parseToneLibrary({ presetVersion: 5, custom: [{ ...tone }] }).custom[0].chain.amp.params.gain).toBe(75)
  })

  it('gives the engine its 0–10 scale back', () => {
    expect(engineModule('amp', FLYING_CLOUD_TONE.chain.amp).params.gain).toBe(7.5)
    expect(engineModule('delay', { on: true, type: 'digital', params: { time: 400, feedback: 40, mix: 30 } }).params).toEqual({ time: 400, feedback: 4, mix: 3 })
  })
})

describe('tones given to tracks', () => {
  it('tells which programs can be given a tone, and what they play through one', () => {
    expect([27, 29, 30, 31, 33, 24, 0].map(toneFamilyOf)).toEqual(['guitar', 'guitar', 'guitar', 'guitar', 'bass', null, null])
    expect(routedProgram(29)).toBe(27)
    expect(routedProgram(30)).toBe(27)
    expect(routedProgram(28)).toBe(28)
    expect(routedProgram(34)).toBe(34)
    // Picking a tone also sets the instrument: a guitar tone plays the clean electric samples; a bass keeps its own.
    expect(toneProgram('guitar', 25)).toBe(27)
    expect(toneProgram('bass', 34)).toBe(34)
    expect(toneProgram('bass', 30)).toBe(33)
  })

  it('routes a track to the bus of its tone, sharing buses between tracks', () => {
    const library = withTone(DEFAULT_TONE_LIBRARY, mine)
    const tracks = [
      { index: 0, channels: [0, 1], isPercussion: false },
      { index: 1, channels: [2, 3], isPercussion: false },
      { index: 2, channels: [4, 5], isPercussion: false },
      { index: 3, channels: [9, 9], isPercussion: true },
    ]
    const plan = planAmpBuses(tracks, { 0: 'clean', 1: mine.id, 2: 'bass-clean', 3: 'clean' }, library)
    expect(plan.buses.map((tone) => tone.id)).toEqual(['clean', mine.id, 'bass-clean'])
    // Every electric guitar program of the track goes through the bus, the driven ones on the clean samples.
    expect(plan.routing[0][27]).toEqual([1, 27])
    expect(plan.routing[0][30]).toEqual([1, 27])
    expect(plan.routing[1][30]).toEqual([1, 27])
    expect(plan.routing[2][30]).toEqual([2, 27])
    // A bass tone takes the bass programs, not the guitars'.
    expect(plan.routing[4][33]).toEqual([3, 33])
    expect(plan.routing[4][30]).toBeUndefined()
    // A drum track is never routed.
    expect(plan.routing[9]).toBeUndefined()
  })

  it('leaves out unknown tones and what does not fit, and gives the preview its own bus', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ ...mine, id: `t${index}` }))
    const library = many.reduce((all, tone) => withTone(all, tone), { custom: [] } as ToneLibrary)
    const tracks = many.map((_, index) => ({ index, channels: [index * 2, index * 2 + 1], isPercussion: false }))
    const given = Object.fromEntries(many.map((tone, index) => [index, tone.id]))
    const plan = planAmpBuses(tracks, { ...given, 0: 'gone' }, library, mine)
    expect(plan.buses).toHaveLength(MAX_AMP_BUSES)
    expect(plan.buses[MAX_AMP_BUSES - 1]).toBe(mine)
    expect(plan.routing[0]).toBeUndefined()
    for (const channel of PREVIEW_CHANNELS) expect(plan.routing[channel][30]).toEqual([MAX_AMP_BUSES, 27])
  })

  it('cleans stored track tones, keeping one from the older per-section form', () => {
    expect(cleanTrackTones({ 0: 'a', x: 'c', 2: 5 })).toEqual({ 0: 'a' })
    expect(cleanTrackTones({ 0: { clean: 'a', distortion: 'b' }, 1: { clean: 'c' }, 2: {} })).toEqual({ 0: 'b', 1: 'c' })
    expect(cleanTrackTones(null)).toEqual({})
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

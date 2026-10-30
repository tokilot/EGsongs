import { describe, expect, it } from 'vitest'
import { MAX_AMP_BUSES, PREVIEW_CHANNELS, cleanTrackTones, planAmpBuses, routedProgram } from '../audio/ampRouting.ts'
import { toneFamilyOf, toneProgram, type Tone } from '../audio/tone.ts'
import { BUILT_IN_TONES, DEFAULT_TONE_LIBRARY, FLYING_CLOUD_TONE, allTones, findTone, isStarterFlyingCloud, legacyChain, parseToneLibrary, withTone, withoutTone, type ToneLibrary } from './library.ts'
import { chainWith, engineModule, sameChain } from '../audio/toneChain.ts'

const mine: Tone = { id: 'custom-1', name: 'My lead', family: 'guitar', builtIn: false, chain: chainWith({ amp: { type: 'metal', params: { gain: 80 } } }) }
const oldParams = { gain: 8, bass: 6, mid: 7, treble: 5, reverb: 3, level: 6 }

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
    const plan = planAmpBuses(tracks, { 0: 'clean', 1: mine.id, 2: 'bass-clean', 3: 'clean' }, (id) => findTone(library, id))
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
    const plan = planAmpBuses(tracks, { ...given, 0: 'gone' }, (id) => findTone(library, id), mine)
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

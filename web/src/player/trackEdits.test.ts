import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { midi, model, Settings } from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../fixtures.ts'
import { convertToScore } from '../songsterr/convert.ts'
import { applyTrackEdits, INSTRUMENT_CATEGORIES, instrumentPlace, isBassTuning, MAX_STRINGS, resizeTuning, trackSetup, tuningPresets } from './trackEdits.ts'
import { MAX_FRET } from './transpose.ts'

const cacheDir = path.resolve(import.meta.dirname, '../../../data/songsterr')
const available = FIXTURES.every((fixture) => existsSync(path.join(cacheDir, String(fixture.songId), String(fixture.revisionId), 'meta.json')))

function load(no: number): model.Score {
  const fixture = FIXTURES.find((item) => item.no === no)!
  const dir = path.join(cacheDir, String(fixture.songId), String(fixture.revisionId))
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { title: string; artist: string; tracks: unknown[] }
  const tracks = meta.tracks.map((_, index) => JSON.parse(readFileSync(path.join(dir, `${index}.json`), 'utf8')))
  return convertToScore(meta, tracks, new Settings()).score
}

function notes(score: model.Score, track: number) {
  return score.tracks[track].staves[0].bars.flatMap((bar) => bar.voices.flatMap((voice) => voice.beats.flatMap((beat) => beat.notes)))
}

describe('tuning helpers', () => {
  it('offers presets for guitars and basses', () => {
    expect(tuningPresets(6, false).map((preset) => preset.name)).toContain('Drop D')
    expect(tuningPresets(4, true)[0].tuning).toEqual([43, 38, 33, 28])
    for (const strings of [4, 5, 6, 7, 8]) {
      for (const preset of tuningPresets(strings, strings <= 5)) expect(preset.tuning).toHaveLength(strings)
    }
  })

  it('adds and removes strings at the low end', () => {
    expect(resizeTuning([64, 59, 55, 50, 45, 40], 7, false)).toEqual([64, 59, 55, 50, 45, 40, 35])
    expect(resizeTuning([64, 59, 55, 50, 45, 40], 4, false)).toEqual([64, 59, 55, 50])
    expect(resizeTuning([43, 38, 33, 28], 5, true)).toEqual([43, 38, 33, 28, 23])
    expect(resizeTuning([64, 59, 55, 50, 45, 40], MAX_STRINGS, false)).toHaveLength(MAX_STRINGS)
    expect(isBassTuning([43, 38, 33, 28])).toBe(true)
    expect(isBassTuning([64, 59, 55, 50, 45, 40])).toBe(false)
  })
})

describe.skipIf(!available)('applyTrackEdits', () => {
  it('renames a track and changes its instrument', () => {
    const original = load(1)
    const { score } = applyTrackEdits(original, { 3: { name: 'My part', program: 29 } }, new Settings())
    expect(score.tracks[3].name).toBe('My part')
    expect(score.tracks[3].playbackInfo.program).toBe(29)
    expect(original.tracks[3].name).not.toBe('My part')
  })

  it('makes the chosen instrument the only sound of the track', () => {
    // This part switches between clean and distorted on its own; those switches must not undo the choice.
    const original = load(3)
    const { score } = applyTrackEdits(original, { 3: { program: 25 } }, new Settings())
    const programs = (target: model.Score) => {
      const file = new midi.MidiFile()
      new midi.MidiFileGenerator(target, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate()
      const { primaryChannel, secondaryChannel } = target.tracks[3].playbackInfo
      const events = file.tracks.flatMap((track) => track.events) as unknown as Array<{ channel: number; program?: number }>
      return new Set(events.filter((event) => event.program !== undefined && [primaryChannel, secondaryChannel].includes(event.channel)).map((event) => event.program))
    }
    expect(programs(original).size).toBeGreaterThan(1)
    expect(programs(score)).toEqual(new Set([25]))
  })

  it('keeps the pitch when adjusting fingerings for Drop D', () => {
    const original = load(1)
    const dropD = [64, 59, 55, 50, 45, 38]
    const { score, notesMoved } = applyTrackEdits(original, { 3: { tuning: dropD, adjustFingering: true } }, new Settings())
    expect(score.tracks[3].staves[0].tuning).toEqual(dropD)
    expect(notesMoved).toBe(0)
    expect(notes(score, 3).map((note) => note.realValue)).toEqual(notes(original, 3).map((note) => note.realValue))
    expect(notes(score, 3).every((note) => note.fret >= 0 && note.fret <= MAX_FRET)).toBe(true)
  })

  it('keeps the written frets when not adjusting', () => {
    const original = load(1)
    const halfDown = [63, 58, 54, 49, 44, 39]
    const { score } = applyTrackEdits(original, { 3: { tuning: halfDown, adjustFingering: false } }, new Settings())
    const before = notes(original, 3)
    const after = notes(score, 3)
    expect(after.map((note) => `${note.string}:${note.fret}`)).toEqual(before.map((note) => `${note.string}:${note.fret}`))
    after.forEach((note, index) => expect(note.realValue).toBe(before[index].realValue - 1))
  })

  it('moves a part onto a 7-string guitar without changing a note', () => {
    const original = load(2)
    const seven = resizeTuning(original.tracks[0].staves[0].tuning, 7, false)
    const { score, notesMoved } = applyTrackEdits(original, { 0: { tuning: seven, adjustFingering: true } }, new Settings())
    expect(score.tracks[0].staves[0].tuning).toHaveLength(7)
    expect(notesMoved).toBe(0)
    const pitch = (note: model.Note) => (note.isDead || note.harmonicType === model.HarmonicType.Natural ? null : note.realValueWithoutHarmonic)
    expect(notes(score, 0).map(pitch)).toEqual(notes(original, 0).map(pitch))
  })

  it('applies a capo and leaves drum tracks alone', () => {
    const original = load(1)
    const drums = original.tracks.findIndex((track) => track.isPercussion)
    const { score, notesMoved } = applyTrackEdits(original, { 3: { capo: 2, adjustFingering: true }, [drums]: { name: 'Kit', program: 30, tuning: [64] } }, new Settings())
    expect(score.tracks[3].staves[0].capo).toBe(2)
    // Notes below the capo (this part rings the open low E a lot) cannot keep their pitch and move up an octave,
    // and notes tied to them follow; nothing else changes.
    const before = notes(original, 3).map((note) => note.realValue)
    const after = notes(score, 3).map((note) => note.realValue)
    const changed = after.filter((pitch, index) => pitch !== before[index])
    expect(notesMoved).toBeGreaterThan(0)
    expect(changed.length).toBeGreaterThanOrEqual(notesMoved)
    after.forEach((pitch, index) => expect((pitch - before[index]) % 12).toBe(0))
    expect(score.tracks[drums].name).toBe('Kit')
    expect(score.tracks[drums].staves[0].isPercussion).toBe(true)
    expect(trackSetup(score, drums)?.isPercussion).toBe(true)
  })
})

describe('instrument picker', () => {
  it('lists every General MIDI program exactly once', () => {
    const programs = INSTRUMENT_CATEGORIES.flatMap((category) => category.subs.flatMap((sub) => sub.programs)).sort((a, b) => a - b)
    expect(programs).toEqual(Array.from({ length: 128 }, (_, index) => index))
  })

  it('opens where a program sits', () => {
    expect(instrumentPlace(30)).toEqual({ category: 0, sub: 0 })
    expect(instrumentPlace(33)).toEqual({ category: 0, sub: 2 })
    expect(instrumentPlace(0)).toEqual({ category: 4, sub: 0 })
    expect(instrumentPlace(127)).toEqual({ category: 5, sub: 5 })
  })
})

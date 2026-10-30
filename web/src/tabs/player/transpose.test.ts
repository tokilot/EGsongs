// Transposition against the 10 test songs: the pitch moves, the tablature is still playable and coherent.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { model, Settings } from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../../fixtures.ts'
import { convertToScore } from '../songs/convert.ts'
import { MAX_FRET, transposeChordName, transposeScore } from './transpose.ts'

const cacheDir = path.resolve(import.meta.dirname, '../../../../data/songs')
const available = FIXTURES.every((fixture) => existsSync(path.join(cacheDir, String(fixture.songId), String(fixture.revisionId), 'meta.json')))

function load(no: number): model.Score {
  const fixture = FIXTURES.find((item) => item.no === no)!
  const dir = path.join(cacheDir, String(fixture.songId), String(fixture.revisionId))
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { title: string; artist: string; tracks: unknown[] }
  const tracks = meta.tracks.map((_, index) => JSON.parse(readFileSync(path.join(dir, `${index}.json`), 'utf8')))
  return convertToScore(meta, tracks, new Settings()).score
}

function notesOf(score: model.Score) {
  return score.tracks.flatMap((track) =>
    track.staves.flatMap((staff) =>
      staff.bars.flatMap((bar) => bar.voices.flatMap((voice) => voice.beats.flatMap((beat) => beat.notes.map((note) => ({ note, staff, beat }))))),
    ),
  )
}

describe('transposeChordName', () => {
  it('moves the root and the bass note', () => {
    expect(transposeChordName('Em', 2)).toBe('F#m')
    expect(transposeChordName('F#m7/C#', 1)).toBe('Gm7/D')
    expect(transposeChordName('Bb', 2)).toBe('C')
    expect(transposeChordName('C', -1)).toBe('B')
    expect(transposeChordName('D', -1)).toBe('Db')
    expect(transposeChordName('Cadd9', 12)).toBe('Cadd9')
    expect(transposeChordName('N.C.', 3)).toBe('N.C.')
  })
})

describe.skipIf(!available)('transposeScore', () => {
  it.each([
    [1, 2],
    [2, -3],
    [4, 5],
    [5, -2],
    [7, 1],
    [10, -5],
  ])('song #%i by %i semitones', (no, semitones) => {
    const original = load(no)
    const { score, outOfRange } = transposeScore(original, semitones, new Settings())
    const before = notesOf(original)
    const after = notesOf(score)
    expect(after).toHaveLength(before.length)

    let exact = 0
    let tied = 0
    let pitched = 0
    after.forEach(({ note, staff, beat }, index) => {
      const source = before[index].note
      if (staff.isPercussion) {
        expect(note.percussionArticulation).toBe(source.percussionArticulation)
        return
      }
      // Every fret is playable and no two notes of a chord share a string.
      expect(note.fret).toBeGreaterThanOrEqual(0)
      expect(note.fret).toBeLessThanOrEqual(MAX_FRET)
      expect(beat.notes.filter((other) => other.string === note.string)).toHaveLength(1)
      if (note.isTieDestination && note.tieOrigin) {
        // A tied note is its origin held on; it follows wherever that went.
        tied++
        expect(note.string).toBe(note.tieOrigin.string)
        expect(note.fret).toBe(note.tieOrigin.fret)
        return
      }
      if (note.harmonicType === model.HarmonicType.Natural || note.isDead) return
      pitched++
      const shift = note.realValueWithoutHarmonic - source.realValueWithoutHarmonic
      if (shift === semitones) exact++
      else expect(Math.abs(shift - semitones) % 12, `note ${index}`).toBe(0)
    })
    expect(exact).toBe(pitched - outOfRange)
    // Going up there is always room. Going down, notes on the lowest open strings have nowhere lower to go
    // and are played an octave up; #5 is tuned low and riffs on its open strings, so it has many of those.
    expect(outOfRange).toBeLessThanOrEqual(pitched * (semitones > 0 ? 0.01 : 0.25))
    if (no === 2) expect(tied).toBeGreaterThan(0)
  })

  it('moves the capo instead of the fingering when there is one', () => {
    const original = load(10)
    const index = original.tracks.findIndex((track) => track.staves[0].capo === 7)
    const down = transposeScore(original, -5, new Settings())
    expect(down.score.tracks[index].staves[0].capo).toBe(2)
    const frets = (score: model.Score) => notesOf(score).filter(({ staff }) => staff.track.index === index).map(({ note }) => `${note.string}:${note.fret}`)
    expect(frets(down.score)).toEqual(frets(original))

    // Past the nut the capo comes off and the frets take the rest.
    const far = transposeScore(original, -9, new Settings())
    expect(far.score.tracks[index].staves[0].capo).toBe(0)
    expect(frets(far.score)).not.toEqual(frets(original))
  })

  it('leaves the original score untouched', () => {
    const original = load(1)
    const frets = notesOf(original).map(({ note }) => `${note.string}:${note.fret}`)
    transposeScore(original, 4, new Settings())
    expect(notesOf(original).map(({ note }) => `${note.string}:${note.fret}`)).toEqual(frets)
  })

  it('renames chords and moves the key signature', () => {
    const original = load(10)
    const { score } = transposeScore(original, 2, new Settings())
    const names = (staff: model.Staff) => [...(staff.chords?.values() ?? [])].map((chord) => chord.name)
    const index = original.tracks.findIndex((track) => (track.staves[0].chords?.size ?? 0) > 0)
    expect(names(score.tracks[index].staves[0])).toEqual(names(original.tracks[index].staves[0]).map((name) => transposeChordName(name, 2)))
    const keyed = original.tracks[index].staves[0].bars.findIndex((bar) => bar.keySignature !== model.KeySignature.C)
    if (keyed >= 0) {
      const from = original.tracks[index].staves[0].bars[keyed].keySignature as number
      const to = score.tracks[index].staves[0].bars[keyed].keySignature as number
      expect(((to - from - 14) % 12 + 12) % 12).toBe(0)
    }
  })

  it('round trips with zero semitones', () => {
    const original = load(7)
    const { score, outOfRange } = transposeScore(original, 0, new Settings())
    expect(outOfRange).toBe(0)
    expect(notesOf(score).map(({ note }) => note.realValue)).toEqual(notesOf(original).map(({ note }) => note.realValue))
  })
})

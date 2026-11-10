import { importer, model, Settings } from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { midiTabFile, midiToScore } from './midiScore.ts'
import { writeMidi, type TestFile, type TestNote } from './midiTestFile.ts'

const convert = (file: TestFile) => midiToScore(writeMidi(file), 'Test')

/** Every beat of a staff with what it plays: [start tick, pitches] for beats that start notes (not tied ones). */
function onsets(staff: model.Staff): Array<[number, number[]]> {
  const result: Array<[number, number[]]> = []
  for (const bar of staff.bars) {
    for (const beat of bar.voices[0].beats) {
      const fresh = beat.notes.filter((note) => !note.isTieDestination)
      if (fresh.length === 0) continue
      const pitches = fresh.map((note) => (staff.isPercussion ? note.percussionArticulation : note.realValue)).sort((a, b) => a - b)
      result.push([bar.masterBar.start + beat.playbackStart, pitches])
    }
  }
  return result
}

function expectBarsFilled(score: model.Score) {
  for (const track of score.tracks) {
    for (const bar of track.staves[0].bars) {
      const ticks = bar.voices[0].beats.reduce((sum, beat) => sum + beat.playbackDuration, 0)
      expect(ticks, `bar ${bar.index + 1} of ${track.name}`).toBe(bar.masterBar.calculateDuration())
    }
  }
}

function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
}

describe('MIDI to tab', () => {
  it('snaps a slightly loose riff onto 8ths and keeps every pitch', () => {
    const pitches = [40, 43, 45, 40, 47, 45, 43, 40]
    const notes: TestNote[] = pitches.map((pitch, index) => ({ at: index * 0.5 + (index % 2 ? 0.03 : -0.02) + 0.02, length: 0.45, pitch }))
    const score = convert({ tempos: [[0, 100]], tracks: [{ program: 29, notes }] })
    expect(score.tempo).toBe(100)
    const staff = score.tracks[0].staves[0]
    expect(staff.tuning).toEqual([64, 59, 55, 50, 45, 40])
    expect(onsets(staff)).toEqual(pitches.map((pitch, index) => [index * 480, [pitch]]))
    expect(staff.bars[0].voices[0].beats.map((beat) => beat.duration)).toEqual(new Array(8).fill(model.Duration.Eighth))
    expectBarsFilled(score)
  })

  it('writes three onsets in a beat as a triplet', () => {
    const notes: TestNote[] = [0, 1 / 3, 2 / 3, 1].map((at, index) => ({ at, length: index === 3 ? 1 : 1 / 3, pitch: 52 + index }))
    const score = convert({ tracks: [{ program: 25, notes }] })
    const beats = score.tracks[0].staves[0].bars[0].voices[0].beats
    expect(beats.slice(0, 3).map((beat) => [beat.duration, beat.tupletNumerator, beat.tupletDenominator])).toEqual(new Array(3).fill([model.Duration.Eighth, 3, 2]))
    expect(beats[3].hasTuplet).toBe(false)
    expectBarsFilled(score)
  })

  it('ties a note across the bar line', () => {
    const score = convert({ tracks: [{ program: 27, notes: [{ at: 3, length: 2, pitch: 52 }] }] })
    const [first, second] = score.tracks[0].staves[0].bars
    const last = first.voices[0].beats.at(-1)!
    const next = second.voices[0].beats[0]
    expect(last.notes[0].tieDestination).toBe(next.notes[0])
    expect(next.notes[0].isTieDestination).toBe(true)
    expect(next.notes[0].fret).toBe(last.notes[0].fret)
    expectBarsFilled(score)
  })

  it('plays a chord on separate strings with a playable hand span', () => {
    // An open-position E major and a barred A major (5th fret).
    const chords = [[40, 47, 52, 56, 59, 64], [45, 52, 57, 61, 64, 69]]
    const notes = chords.flatMap((chord, index) => chord.map((pitch, at) => ({ at: index * 2 + at * 0.005, length: 2, pitch })))
    const score = convert({ tracks: [{ program: 25, notes }] })
    const staff = score.tracks[0].staves[0]
    expect(onsets(staff)).toEqual([[0, chords[0]], [1920, chords[1]]])
    for (const beat of staff.bars[0].voices[0].beats) {
      expect(new Set(beat.notes.map((note) => note.string)).size).toBe(beat.notes.length)
      const fretted = beat.notes.map((note) => note.fret).filter((fret) => fret > 0)
      expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(4)
    }
  })

  it('keeps a scale run in one position', () => {
    // G major from G2 up two octaves and back: one position (2nd to 5th fret) holds it all.
    const up = [43, 45, 47, 48, 50, 52, 54, 55, 57, 59, 60, 62, 64, 66, 67]
    const run = [...up, ...up.slice(0, -1).reverse()]
    const score = convert({ tracks: [{ program: 27, notes: run.map((pitch, index) => ({ at: index * 0.25, length: 0.25, pitch })) }] })
    const frets = score.tracks[0].staves[0].bars.flatMap((bar) => bar.voices[0].beats.flatMap((beat) => beat.notes.map((note) => note.fret)))
    expect(frets).toHaveLength(run.length)
    const fretted = frets.filter((fret) => fret > 0)
    expect(Math.max(...fretted) - Math.min(...fretted), frets.join(' ')).toBeLessThanOrEqual(4)
  })

  it('tunes down for low notes and folds what is out of range', () => {
    const dropD = convert({ tracks: [{ program: 30, notes: [{ at: 0, length: 1, pitch: 38 }] }] })
    expect(dropD.tracks[0].staves[0].tuning).toEqual([64, 59, 55, 50, 45, 38])
    const halfDown = convert({ tracks: [{ program: 30, notes: [{ at: 0, length: 1, pitch: 39 }] }] })
    expect(halfDown.tracks[0].staves[0].tuning).toEqual([63, 58, 54, 49, 44, 39])
    const seven = convert({ tracks: [{ program: 30, notes: [{ at: 0, length: 1, pitch: 35 }] }] })
    expect(seven.tracks[0].staves[0].tuning).toHaveLength(7)
    const bass = convert({ tracks: [{ program: 33, notes: [{ at: 0, length: 1, pitch: 28 }, { at: 1, length: 1, pitch: 23 }] }] })
    expect(bass.tracks[0].staves[0].tuning).toEqual([43, 38, 33, 28, 23])
    // Above the 24th fret of the top string: an octave down.
    const high = convert({ tracks: [{ program: 27, notes: [{ at: 0, length: 1, pitch: 100 }] }] })
    expect(onsets(high.tracks[0].staves[0])).toEqual([[0, [88]]])
  })

  it('makes drums a drum track, and every other part a guitar or bass tab', () => {
    const score = convert({
      tracks: [
        { channel: 9, notes: [{ at: 0, length: 0.1, pitch: 36 }, { at: 0, length: 0.1, pitch: 42 }, { at: 1, length: 0.1, pitch: 38 }] },
        // A transcription that left the sound at piano, and a low line with an organ sound.
        { program: 0, channel: 1, notes: [{ at: 0, length: 2, pitch: 72 }, { at: 0, length: 2, pitch: 76 }] },
        { program: 19, channel: 2, notes: [{ at: 0, length: 1, pitch: 33 }, { at: 1, length: 1, pitch: 40 }] },
      ],
    })
    const [drums, guitar, bass] = score.tracks
    expect(drums.staves[0].isPercussion).toBe(true)
    expect(drums.playbackInfo.primaryChannel).toBe(9)
    expect(onsets(drums.staves[0])).toEqual([[0, [36, 42]], [960, [38]]])
    expect(guitar.staves[0].showTablature).toBe(true)
    expect(guitar.staves[0].tuning).toEqual([64, 59, 55, 50, 45, 40])
    // The tab is new; the sound stays the file's.
    expect(guitar.playbackInfo.program).toBe(0)
    expect(guitar.name).toBe('Acoustic Grand Piano')
    expect(onsets(guitar.staves[0])).toEqual([[0, [72, 76]]])
    expect(guitar.staves[0].bars[0].voices[0].beats[0].notes.every((note) => note.string > 0)).toBe(true)
    expect(bass.staves[0].tuning).toEqual([43, 38, 33, 28])
    expect(bass.playbackInfo.program).toBe(19)
    expect(onsets(bass.staves[0])).toEqual([[0, [33]], [960, [40]]])
    expectBarsFilled(score)
  })

  it('follows time signature and tempo changes', () => {
    const score = convert({
      tempos: [[0, 80], [6, 140]],
      signatures: [[0, 3, 4], [6, 6, 8]],
      tracks: [{ program: 27, notes: [{ at: 0, length: 1, pitch: 50 }, { at: 8.5, length: 0.5, pitch: 52 }] }],
    })
    expect(score.masterBars.map((bar) => `${bar.timeSignatureNumerator}/${bar.timeSignatureDenominator}`)).toEqual(['3/4', '3/4', '6/8'])
    expect(score.masterBars.map((bar) => bar.tempoAutomations[0]?.value)).toEqual([80, undefined, 140])
    expect(onsets(score.tracks[0].staves[0])).toEqual([[0, [50]], [8.5 * 960, [52]]])
    expectBarsFilled(score)
  })

  it('fills every bar exactly whatever the notes', () => {
    const next = random(7)
    for (let round = 0; round < 30; round++) {
      const notes: TestNote[] = []
      for (let at = next() * 2; at < 24; at += 0.05 + next() * 1.5) {
        const chord = 1 + Math.floor(next() * 3)
        for (let index = 0; index < chord; index++) notes.push({ at: at + next() * 0.04, length: 0.05 + next() * 3, pitch: 30 + Math.floor(next() * 60) })
      }
      const [numerator, denominator] = [[4, 4], [3, 4], [7, 8], [6, 8], [5, 4], [2, 2]][round % 6]
      const score = convert({ signatures: [[0, numerator, denominator]], tempos: [[0, 60 + next() * 120]], tracks: [{ program: 24 + (round % 16), notes }, { channel: 9, notes: notes.map((note) => ({ ...note, pitch: 36 + (note.pitch % 20) })) }] })
      expectBarsFilled(score)
    }
  })

  it('is a Guitar Pro file that reads back with the same notes', () => {
    const file: TestFile = {
      tempos: [[0, 132]],
      tracks: [
        { name: 'Riff', program: 30, notes: [0, 0.5, 1, 1.5, 2 / 3 + 2, 4 / 3 + 2, 3].map((at, index) => ({ at, length: 0.5, pitch: 40 + index * 2 })) },
        { name: 'Kit', channel: 9, notes: [{ at: 0, length: 0.1, pitch: 36 }, { at: 1, length: 0.1, pitch: 38 }] },
      ],
    }
    const direct = convert(file)
    const read = importer.ScoreLoader.loadScoreFromBytes(midiTabFile(writeMidi(file), 'Test'), new Settings())
    expect(read.tempo).toBe(132)
    expect(read.tracks.map((track) => track.name)).toEqual(['Riff', 'Kit'])
    expect(read.tracks[0].playbackInfo.program).toBe(30)
    for (const [index, track] of read.tracks.entries()) expect(onsets(track.staves[0])).toEqual(onsets(direct.tracks[index].staves[0]))
    expectBarsFilled(read)
  })

  it('keeps the channels of one track with one sound together', () => {
    // As Guitar Pro and alphaTab write it: bent notes on the track's second channel.
    const score = convert({ tracks: [{ program: 29, notes: [{ at: 0, length: 1, pitch: 52 }, { at: 1, length: 1, pitch: 55, channel: 1 }], extra: [[0, 0xc1, 29]] }] })
    expect(score.tracks).toHaveLength(1)
    expect(onsets(score.tracks[0].staves[0])).toEqual([[0, [52]], [960, [55]]])
  })

  it('refuses a file without notes', () => {
    expect(() => convert({ tracks: [{ notes: [] }] })).toThrow()
  })
})

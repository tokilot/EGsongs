import { importer, Settings } from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { BLANK_DEFAULTS, BLANK_TIME_SIGNATURES, blankFileName, blankTabFile, buildBlankScore } from './blankScore.ts'

describe('blank tab', () => {
  it('is a Guitar Pro file of rests that reads back as written', () => {
    const bytes = blankTabFile({ ...BLANK_DEFAULTS, title: 'Riff', artist: 'Me', bars: 8, tempo: 96 })
    const score = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
    expect(score.title).toBe('Riff')
    expect(score.artist).toBe('Me')
    expect(score.tempo).toBe(96)
    expect(score.masterBars).toHaveLength(8)
    const [track] = score.tracks
    expect(track.playbackInfo.program).toBe(27)
    expect(track.staves[0].tuning).toEqual([64, 59, 55, 50, 45, 40])
    for (const bar of track.staves[0].bars) {
      const beats = bar.voices[0].beats
      expect(beats.every((beat) => beat.isRest)).toBe(true)
    }
  })

  it('fills each bar exactly, in every offered time signature', () => {
    for (const [numerator, denominator] of BLANK_TIME_SIGNATURES) {
      const score = buildBlankScore({ ...BLANK_DEFAULTS, numerator, denominator, bars: 2 })
      for (const bar of score.tracks[0].staves[0].bars) {
        const ticks = bar.voices[0].beats.reduce((sum, beat) => sum + beat.playbackDuration, 0)
        expect(ticks, `${numerator}/${denominator}`).toBe(bar.masterBar.calculateDuration())
      }
    }
  })

  it('a bass has four strings and a bass sound', () => {
    const track = buildBlankScore({ ...BLANK_DEFAULTS, instrument: 'bass' }).tracks[0]
    expect(track.staves[0].tuning).toEqual([43, 38, 33, 28])
    expect(track.playbackInfo.program).toBe(33)
  })

  it('makes a file name the library can take the title from', () => {
    expect(blankFileName('AC/DC: Back?')).toBe('AC DC Back.gp')
    expect(blankFileName('  ')).toBe('Untitled.gp')
  })
})

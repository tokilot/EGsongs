import { importer, exporter, Settings } from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { midiToScore } from '../library/midiScore.ts'
import { writeMidi } from '../library/midiTestFile.ts'
import { indexAfterRemoval, keysAfterRemoval, withoutTrack } from './trackEdits.ts'
import { switchesAfterRemoval } from './trackSwitches.ts'

/** Three tracks, each on its own channel and with its own note: lead, rhythm, bass. */
function threeTracks() {
  return midiToScore(
    writeMidi({
      tracks: [
        { name: 'Lead', program: 29, channel: 0, notes: [{ at: 0, length: 1, pitch: 64 }] },
        { name: 'Rhythm', program: 30, channel: 2, notes: [{ at: 0, length: 1, pitch: 52 }] },
        { name: 'Bass', program: 33, channel: 4, notes: [{ at: 0, length: 1, pitch: 40 }] },
      ],
    }),
    'Three',
  )
}

const firstPitch = (score: ReturnType<typeof threeTracks>, track: number) => score.tracks[track].staves[0].bars[0].voices[0].beats[0].notes[0].realValue

describe('deleting a track', () => {
  it('leaves the other tracks as they were, renumbered', () => {
    const score = threeTracks()
    const settings = new Settings()
    const left = withoutTrack(score, 1, settings)!
    expect(left.tracks.map((track) => [track.index, track.name])).toEqual([[0, 'Lead'], [1, 'Bass']])
    expect(left.tracks.map((track) => track.playbackInfo.primaryChannel)).toEqual(score.tracks.filter((_, index) => index !== 1).map((track) => track.playbackInfo.primaryChannel))
    expect([firstPitch(left, 0), firstPitch(left, 1)]).toEqual([64, 40])
    expect(left.masterBars).toHaveLength(score.masterBars.length)
    // The score it came from is not touched.
    expect(score.tracks).toHaveLength(3)
  })

  it('saves and reads back without the track', () => {
    const settings = new Settings()
    const left = withoutTrack(threeTracks(), 0, settings)!
    const read = importer.ScoreLoader.loadScoreFromBytes(new exporter.Gp7Exporter().export(left, settings), settings)
    expect(read.tracks.map((track) => track.name)).toEqual(['Rhythm', 'Bass'])
  })

  it('will not delete the only track, or one that is not there', () => {
    const settings = new Settings()
    const one = withoutTrack(withoutTrack(threeTracks(), 0, settings)!, 0, settings)!
    expect(withoutTrack(one, 0, settings)).toBeNull()
    expect(withoutTrack(threeTracks(), 5, settings)).toBeNull()
  })

  it('moves what is kept per track down past the deleted one', () => {
    expect([0, 1, 2, 3].map((index) => indexAfterRemoval(index, 1))).toEqual([0, null, 1, 2])
    expect(keysAfterRemoval({ 0: 'clean', 1: 'drive', 3: 'bass' }, 1)).toEqual({ 0: 'clean', 2: 'bass' })
    // From bar 4 the deleted track, from bar 8 the last one, from bar 12 the first.
    expect(switchesAfterRemoval({ 4: 1, 8: 2, 12: 0 }, 1)).toEqual({ 8: 1, 12: 0 })
  })
})

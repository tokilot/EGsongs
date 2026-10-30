// Converter tests against the 10 songs from CLAUDE.md ("测试案例").
// Fixtures live in data/songs/ (not in the repo); run `npm run fixtures` first.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { midi, model, Settings } from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { FIXTURES, type Fixture } from '../../fixtures.ts'
import { convertToScore } from './convert.ts'

type Json = Record<string, unknown>

const cacheDir = path.resolve(import.meta.dirname, '../../../../data/songs')
const fixtureDir = (fixture: Fixture) => path.join(cacheDir, String(fixture.songId), String(fixture.revisionId))
const available = FIXTURES.every((fixture) => existsSync(path.join(fixtureDir(fixture), 'meta.json')))
if (!available) console.warn('Songsterr fixtures are missing; run `npm run fixtures` to enable the converter tests.')

interface Loaded {
  fixture: Fixture
  sources: Json[]
  score: model.Score
  warnings: string[]
}

const cache = new Map<number, Loaded>()
function load(no: number): Loaded {
  const cached = cache.get(no)
  if (cached) return cached
  const fixture = FIXTURES.find((item) => item.no === no)!
  const dir = fixtureDir(fixture)
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { title: string; artist: string; tracks: unknown[] }
  const sources = meta.tracks.map((_, index) => JSON.parse(readFileSync(path.join(dir, `${index}.json`), 'utf8')) as Json)
  const { score, warnings } = convertToScore(meta, sources, new Settings())
  const loaded = { fixture, sources, score, warnings }
  cache.set(no, loaded)
  return loaded
}

function allBeats(track: model.Track): model.Beat[] {
  // Placeholder beats of unused voices are not part of the music.
  return track.staves[0].bars.flatMap((bar) => bar.voices.flatMap((voice) => voice.beats.filter((beat) => !beat.isEmpty)))
}

function allNotes(track: model.Track): model.Note[] {
  return allBeats(track).flatMap((beat) => beat.notes)
}

function sourceBeats(source: Json): Json[] {
  return (source.measures as Json[]).flatMap((measure) =>
    (measure.voices as Json[]).flatMap((voice, index) => (index > 0 && voice.rest ? [] : (voice.beats as Json[]))),
  )
}

/** Bars the synth actually plays, in order (repeats unrolled). */
function playedBars(score: model.Score): number[] {
  const handler = new midi.AlphaSynthMidiFileHandler(new midi.MidiFile())
  const generator = new midi.MidiFileGenerator(score, new Settings(), handler)
  generator.generate()
  const bars: number[] = []
  for (const entry of generator.tickLookup.masterBars) bars.push(entry.masterBar.index)
  return bars
}

describe.skipIf(!available)('songsterr converter', () => {
  describe.each(FIXTURES)('song #$no', ({ no }) => {
    it('keeps the track and bar structure', () => {
      const { fixture, score } = load(no)
      expect(score.tracks).toHaveLength(fixture.tracks)
      expect(score.masterBars).toHaveLength(fixture.bars)
      for (const track of score.tracks) expect(track.staves[0].bars).toHaveLength(fixture.bars)
    })

    it('understands every field in the source', () => {
      expect(load(no).warnings).toEqual([])
    })

    it('fills each bar exactly', () => {
      const { score } = load(no)
      const offenders = new Set<number>()
      for (const track of score.tracks) {
        for (const bar of track.staves[0].bars) {
          if (bar.masterBar.isAnacrusis || bar.voices[0].isEmpty) continue
          // Display durations: playback durations shift when a grace note borrows time from its neighbour.
          const expected = bar.masterBar.calculateDuration(false)
          const actual = bar.voices[0].beats
            .filter((beat) => beat.graceType === model.GraceType.None)
            .reduce((sum, beat) => sum + beat.displayDuration, 0)
          // Odd tuplets (5, 7) do not divide into whole ticks, so allow a few ticks of rounding.
          if (Math.abs(actual - expected) > 8) offenders.add(bar.index)
        }
      }
      // Known irregular bars in the source data: a short closing bar (#2) and a pickup that is not flagged (#5).
      const allowed: Record<number, number> = { 2: 1, 5: 2 }
      expect(offenders.size, `bars ${[...offenders].join(', ')}`).toBeLessThanOrEqual(allowed[no] ?? 0)
    })

    it('puts every note on the right pitch', () => {
      const { score, sources } = load(no)
      score.tracks.forEach((track, trackIndex) => {
        const source = sources[trackIndex]
        if (track.staves[0].isPercussion) return
        const tuning = source.tuning as number[]
        const capo = Number(source.capo ?? 0)
        const beats = allBeats(track)
        const expectedBeats = sourceBeats(source)
        expect(beats).toHaveLength(expectedBeats.length)
        let lastFret = new Map<number, number>()
        expectedBeats.forEach((beatSource, index) => {
          const expected = ((beatSource.notes as Json[]) ?? [])
            .filter((note) => !note.rest && !beatSource.rest)
            .map((note) => {
              const string = note.string as number
              const fret = typeof note.fret === 'number' ? note.fret : note.tie ? (lastFret.get(string) ?? 0) : 0
              lastFret.set(string, fret)
              return tuning[string] + fret + capo
            })
            .sort((a, b) => a - b)
          const actual = beats[index].notes.map((note) => note.realValueWithoutHarmonic).sort((a, b) => a - b)
          expect(actual, `track ${trackIndex} beat ${index}`).toEqual(expected)
        })
        lastFret = new Map()
      })
    })

    it('follows time signature changes', () => {
      const { score, sources } = load(no)
      let signature = [4, 4]
      ;(sources[0].measures as Json[]).forEach((measure, index) => {
        if (measure.signature) signature = measure.signature as number[]
        const masterBar = score.masterBars[index]
        expect([masterBar.timeSignatureNumerator, masterBar.timeSignatureDenominator], `bar ${index}`).toEqual(signature)
      })
    })

    it('can be played back', () => {
      const { score } = load(no)
      expect(playedBars(score).length).toBeGreaterThanOrEqual(score.masterBars.length)
    })
  })

  it('#1 has its three tempo changes and the opening marker', () => {
    const { score } = load(1)
    const tempos = score.masterBars
      .filter((bar) => bar.tempoAutomations.length > 0)
      .map((bar) => [bar.index, bar.tempoAutomations[0].value])
    expect(tempos).toEqual([
      [0, 86],
      [92, 78],
      [93, 70],
    ])
    expect(score.tempo).toBe(86)
    expect(score.masterBars[0].section?.text).toBe('Intro')
    expect(score.title).toBe('Promise')
  })

  it('#2 carries the lead guitar techniques', () => {
    const { score } = load(2)
    const track = score.tracks[0]
    const notes = allNotes(track)
    const beats = allBeats(track)
    const harmonics = new Set(notes.map((note) => note.harmonicType))
    for (const type of [model.HarmonicType.Natural, model.HarmonicType.Artificial, model.HarmonicType.Pinch, model.HarmonicType.Tap]) {
      expect(harmonics.has(type), model.HarmonicType[type]).toBe(true)
    }
    const slideOuts = new Set(notes.map((note) => note.slideOutType))
    for (const type of [model.SlideOutType.Legato, model.SlideOutType.Shift, model.SlideOutType.OutUp, model.SlideOutType.OutDown]) {
      expect(slideOuts.has(type), model.SlideOutType[type]).toBe(true)
    }
    const slideIns = new Set(notes.map((note) => note.slideInType))
    expect(slideIns.has(model.SlideInType.IntoFromBelow)).toBe(true)
    expect(slideIns.has(model.SlideInType.IntoFromAbove)).toBe(true)

    expect(notes.some((note) => note.hasBend)).toBe(true)
    expect(notes.every((note) => !note.hasBend || note.bendType !== model.BendType.Custom || note.bendPoints!.length > 0)).toBe(true)
    expect(notes.some((note) => note.isHammerPullOrigin && note.hammerPullDestination)).toBe(true)
    expect(notes.some((note) => note.isTrill)).toBe(true)
    expect(notes.some((note) => note.isPalmMute)).toBe(true)
    expect(notes.some((note) => note.isDead)).toBe(true)
    expect(notes.some((note) => note.slideOutType === model.SlideOutType.PickSlideDown)).toBe(true)
    expect(beats.some((beat) => beat.tap)).toBe(true)
    expect(beats.some((beat) => beat.hasWhammyBar)).toBe(true)
    // The double-dotted beat of this song is in the bass track.
    expect(score.tracks.flatMap(allBeats).some((beat) => beat.dots === 2)).toBe(true)
    expect(beats.some((beat) => beat.graceType !== model.GraceType.None)).toBe(true)
    // Quintuplets are in the drum track, the rest in the lead guitar.
    const tuplets = new Set(
      score.tracks.flatMap(allBeats).filter((beat) => beat.hasTuplet).map((beat) => `${beat.tupletNumerator}:${beat.tupletDenominator}`),
    )
    for (const ratio of ['3:2', '5:4', '6:4', '7:4']) expect(tuplets.has(ratio), ratio).toBe(true)

    expect(score.masterBars[0].isAnacrusis).toBe(true)
    expect(score.masterBars.some((bar) => bar.tripletFeel !== model.TripletFeel.NoTripletFeel)).toBe(true)
    // Tempo marked in half notes: the model stores quarter-note bpm.
    const source = load(2).sources[0]
    const half = ((source.automations as Json).tempo as Json[]).find((tempo) => tempo.type === 2)!
    const automation = score.masterBars[half.measure as number].tempoAutomations[0]
    expect(automation.value).toBe((half.bpm as number) * 2)
  })

  it('#2 and #7 unroll their repeats during playback', () => {
    for (const no of [2, 7]) {
      const { score } = load(no)
      expect(score.masterBars.some((bar) => bar.isRepeatStart)).toBe(true)
      expect(score.masterBars.some((bar) => bar.isRepeatEnd)).toBe(true)
      expect(playedBars(score).length, `#${no}`).toBeGreaterThan(score.masterBars.length)
    }
  })

  it('#7 has alternate endings and a second voice', () => {
    const { score } = load(7)
    const endings = score.masterBars.filter((bar) => bar.alternateEndings !== 0).map((bar) => bar.alternateEndings)
    expect(new Set(endings)).toEqual(new Set([1, 2]))
    expect(score.tracks[0].staves[0].bars.some((bar) => bar.voices.length > 1 && !bar.voices[1].isEmpty)).toBe(true)
    expect(allBeats(score.tracks[0]).some((beat) => beat.chordId !== null)).toBe(true)
  })

  it('#3 keeps key signatures, wah, arpeggios, dynamics and sound switches', () => {
    const { score } = load(3)
    const beats = score.tracks.flatMap(allBeats)
    expect(beats.some((beat) => beat.wahPedal === model.WahPedal.Open)).toBe(true)
    expect(beats.some((beat) => beat.wahPedal === model.WahPedal.Closed)).toBe(true)
    expect(beats.some((beat) => beat.brushType === model.BrushType.ArpeggioDown)).toBe(true)
    expect(beats.some((beat) => beat.crescendo === model.CrescendoType.Crescendo)).toBe(true)
    expect(beats.some((beat) => beat.getAutomation(model.AutomationType.Instrument) !== null)).toBe(true)
    expect(beats.some((beat) => beat.vibrato !== model.VibratoType.None)).toBe(true)
    expect(score.masterBars.some((bar) => bar.isDoubleBar)).toBe(true)
    expect(score.tracks.some((track) => track.staves[0].bars.some((bar) => bar.keySignature !== model.KeySignature.C))).toBe(true)
  })

  it('#4 switches between ten time signatures', () => {
    const { score } = load(4)
    const signatures = new Set(score.masterBars.map((bar) => `${bar.timeSignatureNumerator}/${bar.timeSignatureDenominator}`))
    expect(signatures.size).toBe(10)
    expect(score.tracks[3].staves[0].tuning).toHaveLength(4)
  })

  it('#5 has a 7-string guitar, a 5-string bass, slap and tremolo picking', () => {
    const { score, fixture } = load(5)
    expect(score.tracks[fixture.defaultTrack].staves[0].tuning).toHaveLength(7)
    expect(score.tracks.some((track) => track.staves[0].tuning.length === 5)).toBe(true)
    const beats = score.tracks.flatMap(allBeats)
    expect(beats.some((beat) => beat.slap)).toBe(true)
    expect(beats.some((beat) => beat.pop)).toBe(true)
    expect(beats.some((beat) => beat.isTremolo)).toBe(true)
  })

  it('#6 turns swing on and off and keeps a minor key', () => {
    const { score } = load(6)
    const feels = new Set(score.masterBars.map((bar) => bar.tripletFeel))
    expect(feels.has(model.TripletFeel.Triplet16th)).toBe(true)
    expect(feels.has(model.TripletFeel.NoTripletFeel)).toBe(true)
    expect(score.tracks.some((track) => track.staves[0].bars.some((bar) => bar.keySignatureType === model.KeySignatureType.Minor))).toBe(true)
    const brushes = new Set(score.tracks.flatMap(allBeats).map((beat) => beat.brushType))
    expect(brushes.has(model.BrushType.BrushUp)).toBe(true)
    expect(brushes.has(model.BrushType.BrushDown)).toBe(true)
  })

  it('#8 reads the older vibrato spelling and semi harmonics', () => {
    const { score } = load(8)
    const notes = score.tracks.flatMap(allNotes)
    expect(notes.some((note) => note.vibrato === model.VibratoType.Slight)).toBe(true)
    expect(notes.some((note) => note.vibrato === model.VibratoType.Wide)).toBe(true)
    expect(notes.some((note) => note.harmonicType === model.HarmonicType.Semi)).toBe(true)
    // The tab marks vibrato on the beat and on its notes alike; only the notes' line is drawn, so the beats
    // that have a vibrato of their own are the whammy bar's.
    const doubled = score.tracks.flatMap(allBeats).filter((beat) => beat.vibrato !== model.VibratoType.None && beat.notes.some((note) => note.vibrato !== model.VibratoType.None))
    expect(doubled).toEqual([])
  })

  it('#9 has gradual tempo changes', () => {
    const { score } = load(9)
    expect(score.masterBars.some((bar) => bar.tempoAutomations.some((tempo) => tempo.isLinear))).toBe(true)
  })

  it('#10 applies the capo', () => {
    const { score, sources } = load(10)
    const index = sources.findIndex((source) => source.capo === 7)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(score.tracks[index].staves[0].capo).toBe(7)
    expect(score.masterBars.some((bar) => bar.timeSignatureNumerator === 1 && bar.timeSignatureDenominator === 4)).toBe(true)
  })

  it('maps drum tracks to percussion', () => {
    for (const no of [1, 4, 5]) {
      const { score, sources } = load(no)
      const index = sources.findIndex((source) => source.instrumentId === 1024)
      const track = score.tracks[index]
      expect(track.staves[0].isPercussion).toBe(true)
      expect(track.playbackInfo.primaryChannel).toBe(9)
      const notes = allNotes(track)
      expect(notes.length).toBeGreaterThan(0)
      expect(notes.every((note) => note.isPercussion && note.percussionArticulation > 0)).toBe(true)
      expect(notes.every((note) => midi.MidiFileGenerator !== undefined && note.realValue > 0)).toBe(true)
    }
  })

  it('gives every melodic track its own pair of channels', () => {
    const { score } = load(9)
    const channels = score.tracks.filter((track) => !track.staves[0].isPercussion).map((track) => track.playbackInfo.primaryChannel)
    expect(new Set(channels).size).toBe(channels.length)
    expect(channels).not.toContain(9)
  })
})

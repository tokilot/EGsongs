import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { exporter, importer, midi, model, Settings } from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../fixtures.ts'
import { convertToScore } from '../songsterr/convert.ts'
import { TabEditor } from './tabEditor.ts'
import { applyTrackEdits } from './trackEdits.ts'

const cacheDir = path.resolve(import.meta.dirname, '../../../data/songsterr')
const available = FIXTURES.every((fixture) => existsSync(path.join(cacheDir, String(fixture.songId), String(fixture.revisionId), 'meta.json')))

function load(no: number): model.Score {
  const fixture = FIXTURES.find((item) => item.no === no)!
  const dir = path.join(cacheDir, String(fixture.songId), String(fixture.revisionId))
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { title: string; artist: string; tracks: unknown[] }
  const tracks = meta.tracks.map((_, index) => JSON.parse(readFileSync(path.join(dir, `${index}.json`), 'utf8')))
  return convertToScore(meta, tracks, new Settings()).score
}

/** A fingerprint of a track: every beat's duration and every note's string, fret and flags. */
function fingerprint(score: model.Score, track: number): string {
  return score.tracks[track].staves[0].bars
    .map((bar) =>
      bar.voices[0].beats
        .map((beat) => `${beat.duration}.${beat.dots}[${beat.notes.map((note) => `${note.string}:${note.fret}${note.isHammerPullOrigin ? 'h' : ''}${note.hasBend ? 'b' : ''}${note.isTieDestination ? 't' : ''}`).sort().join(',')}]`)
        .join(' '),
    )
    .join(' | ')
}

function playedNotes(score: model.Score): number {
  const file = new midi.MidiFile()
  new midi.MidiFileGenerator(score, new Settings(), new midi.AlphaSynthMidiFileHandler(file)).generate()
  return file.tracks.flatMap((track) => track.events).filter((event) => (event as unknown as { type: number }).type === 0x90).length
}

describe.skipIf(!available)('TabEditor', () => {
  it('types frets, including two-digit ones, onto the cursor string', () => {
    const score = load(1)
    const editor = new TabEditor(score, 3, new Settings(), { bar: 4, beat: 0 })
    editor.moveTo({ string: 6 })
    expect(editor.note).toBeNull()
    editor.typeDigit(1, 1000)
    editor.typeDigit(2, 1300)
    expect(editor.note?.fret).toBe(12)
    expect(editor.note?.realValue).toBe(64 + 12)
    // Too slow, or not playable as two digits: starts over.
    editor.typeDigit(3, 5000)
    expect(editor.note?.fret).toBe(3)
    editor.typeDigit(9, 5100)
    expect(editor.note?.fret).toBe(9)
    expect(editor.state().dirty).toBe(true)
  })

  it('undoes and redoes every kind of edit back to the exact tab', () => {
    const score = load(1)
    const before = fingerprint(score, 3)
    const editor = new TabEditor(score, 3, new Settings(), { bar: 4, beat: 1 })
    editor.moveTo({ string: 2 })
    editor.typeDigit(7)
    editor.toggle('hammer')
    editor.setBend('full')
    editor.stepDuration(true)
    editor.toggleDot()
    editor.insertBeat()
    editor.typeDigit(5)
    editor.stepBeat(1)
    editor.deleteBeat()
    editor.stepBeat(-3)
    editor.removeNote()
    editor.clearBeat()
    const edited = fingerprint(score, 3)
    expect(edited).not.toBe(before)

    while (editor.undo()) {
      // all the way back
    }
    expect(fingerprint(score, 3)).toBe(before)
    expect(editor.state().dirty).toBe(false)
    while (editor.redo()) {
      // and forward again
    }
    expect(fingerprint(score, 3)).toBe(edited)
  })

  it('keeps the score playable after edits', () => {
    const score = load(1)
    const notesBefore = playedNotes(score)
    const editor = new TabEditor(score, 3, new Settings(), { bar: 4, beat: 0 })
    editor.moveTo({ string: 5 })
    editor.typeDigit(3)
    editor.insertBeat()
    editor.moveTo({ string: 1 })
    editor.typeDigit(0)
    expect(playedNotes(score)).toBe(notesBefore + 2)
    // The bar is now longer than its time signature, and says so.
    expect(editor.state().barFill).toBe('over')
    editor.stepDuration(false)
    editor.stepBeat(-1)
    editor.stepDuration(false)
    expect(['short', 'full', 'over']).toContain(editor.state().barFill)
  })

  it('ties a note to the one before it on the same string', () => {
    const score = load(1)
    const editor = new TabEditor(score, 3, new Settings(), { bar: 4, beat: 0 })
    const first = editor.beat.notes[0]
    editor.moveTo({ string: first.string })
    editor.stepBeat(1)
    editor.typeDigit(9)
    editor.toggle('tie')
    expect(editor.note?.isTieDestination).toBe(true)
    expect(editor.note?.fret).toBe(first.fret)
    expect(editor.note?.tieOrigin).toBe(first)

    // Untied, the note keeps whatever fret is typed on it.
    editor.toggle('tie')
    editor.setFret(3)
    expect(editor.note?.fret).toBe(3)
    expect(editor.note?.isTieDestination).toBe(false)
    // Tied again, it follows the note before when that changes, and lets go when that note is deleted.
    editor.toggle('tie')
    editor.stepBeat(-1)
    editor.setFret(8)
    editor.stepBeat(1)
    expect(editor.note?.fret).toBe(8)
    editor.stepBeat(-1)
    editor.removeNote()
    editor.stepBeat(1)
    const after = editor.note!
    expect(after.tieOrigin === null || after.tieOrigin.beat.notes.includes(after.tieOrigin)).toBe(true)
    editor.setFret(2)
    expect(editor.note?.fret).toBe(2)
  })

  it('never empties a bar and stays inside the track at the edges', () => {
    const score = load(1)
    const editor = new TabEditor(score, 3, new Settings(), { bar: 0, beat: 0 })
    editor.stepBeat(-5)
    expect(editor.cursor).toMatchObject({ bar: 0, beat: 0 })
    const beats = editor.state().beatCount
    for (let i = 0; i < beats + 2; i++) editor.deleteBeat()
    expect(editor.state().beatCount).toBe(1)
    expect(editor.state().beat.isRest).toBe(true)
    editor.moveTo({ bar: 10_000 })
    expect(editor.cursor.bar).toBe(score.masterBars.length - 1)
    expect(new TabEditor(score, score.tracks.findIndex((track) => track.isPercussion), new Settings()).editable).toBe(false)
  })

  it('survives the save as Guitar Pro and opening it again', () => {
    const score = load(1)
    const editor = new TabEditor(score, 3, new Settings(), { bar: 2, beat: 0 })
    editor.moveTo({ string: 6 })
    editor.typeDigit(1, 1000)
    editor.typeDigit(5, 1200)
    editor.setVibrato(model.VibratoType.Slight)
    const bytes = new exporter.Gp7Exporter().export(score, new Settings())
    const back = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
    const note = back.tracks[3].staves[0].bars[2].voices[0].beats[0].notes.find((item) => item.string === 6)
    expect(note?.fret).toBe(15)
    expect(note?.vibrato).toBe(model.VibratoType.Slight)
    expect(fingerprint(back, 3)).toBe(fingerprint(score, 3))
  })

  it('sets note and beat techniques that survive the save', () => {
    const score = load(1)
    const editor = new TabEditor(score, 3, new Settings(), { bar: 2, beat: 0 })
    editor.moveTo({ string: 3 })
    editor.setFret(7)
    editor.setSlide('shift')
    editor.setHarmonic(model.HarmonicType.Natural)
    editor.setAccent(model.AccentuationType.Heavy)
    editor.toggle('staccato')
    editor.setTrill(9)
    editor.toggle('palmMute')
    editor.setTremolo(2)
    editor.setWhammy('dive')
    editor.setStroke('brushDown')
    editor.setPickStroke(model.PickStroke.Up)
    editor.setDynamics(model.DynamicValue.FF)
    editor.setText('let it ring')
    editor.setChord('Am7')
    editor.setLyrics('la')
    const state = editor.state()
    expect(state.note).toMatchObject({ fret: 7, slide: 'shift', harmonic: model.HarmonicType.Natural, accent: model.AccentuationType.Heavy, trill: 9 })
    expect(state.note?.flags.staccato).toBe(true)
    expect(state.beat).toMatchObject({ tremolo: 2, whammy: 'dive', stroke: 'brushDown', pickStroke: model.PickStroke.Up, dynamics: model.DynamicValue.FF, text: 'let it ring', lyrics: 'la', chord: 'Am7' })
    expect(state.beat.flags.palmMute).toBe(true)
    expect(playedNotes(score)).toBeGreaterThan(0)

    const bytes = new exporter.Gp7Exporter().export(score, new Settings())
    const back = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
    const reread = new TabEditor(back, 3, new Settings(), { bar: 2, beat: 0, string: 3 }).state()
    expect(reread.note).toMatchObject({ fret: 7, slide: 'shift', harmonic: model.HarmonicType.Natural, accent: model.AccentuationType.Heavy, trill: 9 })
    expect(reread.beat).toMatchObject({ tremolo: 2, whammy: 'dive', stroke: 'brushDown', dynamics: model.DynamicValue.FF, text: 'let it ring', lyrics: 'la', chord: 'Am7' })
  })

  it('switches every option off again', () => {
    const score = load(1)
    const editor = new TabEditor(score, 3, new Settings(), { bar: 4, beat: 0 })
    editor.moveTo({ string: editor.beat.notes[0].string })
    const shape = () => {
      const { note, beat, bar } = editor.state()
      return JSON.stringify({ note, beat, bar })
    }
    const initial = shape()
    const failures: string[] = []
    const roundTrip = (name: string, on: () => void, off: () => void) => {
      const before = shape()
      on()
      if (shape() === before) failures.push(`${name}: did not switch on`)
      off()
      const after = shape()
      if (after !== before) failures.push(`${name}: did not switch off (${diff(before, after)})`)
    }
    const diff = (before: string, after: string) => {
      const flat = (text: string, prefix = '', into: Record<string, string> = {}, value: unknown = JSON.parse(text)) => {
        if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) flat('', `${prefix}${key}.`, into, item)
        else into[prefix] = JSON.stringify(value)
        return into
      }
      const x = flat(before)
      const y = flat(after)
      return Object.keys({ ...x, ...y }).filter((key) => x[key] !== y[key]).map((key) => `${key} ${x[key]} → ${y[key]}`).join(', ')
    }
    // A tie takes the fret of the note it continues; switching it off leaves that fret.
    const fret = editor.note!.fret
    roundTrip('tie', () => editor.toggle('tie'), () => {
      editor.toggle('tie')
      editor.setFret(fret)
    })
    for (const flag of ['hammer', 'dead', 'ghost', 'staccato', 'pickScrape', 'leftHandTap', 'palmMute', 'letRing', 'tap', 'slap', 'pop', 'fermata', 'deadSlapped'] as const) {
      roundTrip(flag, () => editor.toggle(flag), () => editor.toggle(flag))
    }
    for (const kind of ['legato', 'shift', 'inBelow', 'inAbove', 'outDown', 'outUp'] as const) roundTrip(`slide ${kind}`, () => editor.setSlide(kind), () => editor.setSlide('none'))
    for (const kind of ['half', 'full', 'bendRelease', 'preBend'] as const) roundTrip(`bend ${kind}`, () => editor.setBend(kind), () => editor.setBend('none'))
    roundTrip('vibrato', () => editor.setVibrato(model.VibratoType.Wide), () => editor.setVibrato(model.VibratoType.None))
    for (const type of [model.HarmonicType.Natural, model.HarmonicType.Artificial, model.HarmonicType.Pinch, model.HarmonicType.Tap, model.HarmonicType.Semi]) {
      roundTrip(`harmonic ${type}`, () => editor.setHarmonic(type), () => editor.setHarmonic(model.HarmonicType.None))
    }
    roundTrip('accent', () => editor.setAccent(model.AccentuationType.Heavy), () => editor.setAccent(model.AccentuationType.None))
    roundTrip('trill', () => editor.setTrill(9), () => editor.setTrill(null))
    roundTrip('tremolo', () => editor.setTremolo(2), () => editor.setTremolo(null))
    for (const kind of ['dive', 'dip', 'preDive'] as const) roundTrip(`whammy ${kind}`, () => editor.setWhammy(kind), () => editor.setWhammy('none'))
    roundTrip('beat vibrato', () => editor.setBeatVibrato(model.VibratoType.Slight), () => editor.setBeatVibrato(model.VibratoType.None))
    roundTrip('wah', () => editor.setWah(model.WahPedal.Open), () => editor.setWah(model.WahPedal.None))
    for (const kind of ['brushDown', 'brushUp', 'arpeggioDown', 'arpeggioUp'] as const) roundTrip(`stroke ${kind}`, () => editor.setStroke(kind), () => editor.setStroke('none'))
    roundTrip('pick stroke', () => editor.setPickStroke(model.PickStroke.Down), () => editor.setPickStroke(model.PickStroke.None))
    roundTrip('crescendo', () => editor.setCrescendo(model.CrescendoType.Crescendo), () => editor.setCrescendo(model.CrescendoType.None))
    roundTrip('tuplet', () => editor.setTuplet(3), () => editor.setTuplet(0))
    for (const kind of ['before', 'onBeat'] as const) roundTrip(`grace ${kind}`, () => editor.setGrace(kind), () => editor.setGrace('none'))
    roundTrip('dot', () => editor.setDots(1), () => editor.setDots(0))
    roundTrip('text', () => editor.setText('hello'), () => editor.setText(''))
    roundTrip('chord', () => editor.setChord('Am'), () => editor.setChord(''))
    roundTrip('lyrics', () => editor.setLyrics('la'), () => editor.setLyrics(''))
    roundTrip('tempo', () => editor.setTempo(140), () => editor.setTempo(null))
    roundTrip('section', () => editor.setSection('Solo'), () => editor.setSection(''))
    roundTrip('repeat start', () => editor.toggleRepeatStart(), () => editor.toggleRepeatStart())
    roundTrip('repeat end', () => editor.setRepeatEnd(3), () => editor.setRepeatEnd(0))
    roundTrip('endings', () => editor.setEndings([1]), () => editor.setEndings([]))
    roundTrip('double bar', () => editor.toggleDoubleBar(), () => editor.toggleDoubleBar())
    roundTrip('swing', () => editor.setTripletFeel(model.TripletFeel.Triplet8th), () => editor.setTripletFeel(model.TripletFeel.NoTripletFeel))
    const key = editor.state().bar.keySignature
    roundTrip('key', () => editor.setKeySignature(model.KeySignature.A, true), () => editor.setKeySignature(key, false))
    expect(failures).toEqual([])
    // And all of it undoes cleanly too.
    while (editor.undo()) {
      // back to the start
    }
    expect(shape()).toBe(initial)
  })

  it('takes a track edit as one step that undoes exactly', () => {
    const score = load(1)
    const staff = score.tracks[3].staves[0]
    const before = fingerprint(score, 3)
    const tuning = [...staff.tuning]
    const pitches = () => staff.bars.flatMap((bar) => bar.voices[0].beats.flatMap((beat) => beat.notes.map((note) => note.realValue)))
    const sounding = pitches()
    const editor = new TabEditor(score, 3, new Settings(), { bar: 4, beat: 0 })
    const dropD = [...tuning.slice(0, -1), tuning[tuning.length - 1] - 2]
    editor.replaceTrack(applyTrackEdits(score, { 3: { name: 'Lead', program: 30, tuning: dropD, adjustFingering: true } }, new Settings()).score)
    expect(score.tracks[3].name).toBe('Lead')
    expect(score.tracks[3].playbackInfo.program).toBe(30)
    expect(staff.tuning).toEqual(dropD)
    expect(pitches()).toEqual(sounding)
    expect(fingerprint(score, 3)).not.toBe(before)
    expect(editor.state().dirty).toBe(true)
    expect(playedNotes(score)).toBeGreaterThan(0)

    editor.undo()
    expect(staff.tuning).toEqual(tuning)
    expect(score.tracks[3].playbackInfo.program).not.toBe(30)
    expect(fingerprint(score, 3)).toBe(before)
    editor.redo()
    expect(staff.tuning).toEqual(dropD)
    expect(pitches()).toEqual(sounding)
  })

  it('reads back every bend and whammy shape it writes', () => {
    const score = load(1)
    const editor = new TabEditor(score, 3, new Settings(), { bar: 4, beat: 2 })
    editor.moveTo({ string: 6 })
    editor.setFret(7)
    for (const kind of ['half', 'full', 'oneAndHalf', 'bendRelease', 'preBend', 'preBendRelease', 'none'] as const) {
      editor.setBend(kind)
      expect(editor.state().note?.bend).toBe(kind)
    }
    for (const kind of ['dive', 'deepDive', 'dip', 'preDive', 'none'] as const) {
      editor.setWhammy(kind)
      expect(editor.state().beat.whammy).toBe(kind)
    }
  })

  it('changes tuplets and grace notes and undoes them', () => {
    const score = load(1)
    const before = fingerprint(score, 3)
    const editor = new TabEditor(score, 3, new Settings(), { bar: 4, beat: 0 })
    editor.setTuplet(3)
    expect(editor.beat.tupletNumerator).toBe(3)
    expect(editor.state().beat.tuplet).toBe(3)
    editor.setGrace('before')
    expect(editor.beat.graceType).toBe(model.GraceType.BeforeBeat)
    while (editor.undo()) {
      // back to the start
    }
    expect(fingerprint(score, 3)).toBe(before)
    expect(editor.beat.tupletNumerator).not.toBe(3)
  })

  it('edits bar-wide settings for every track and undoes them', () => {
    const score = load(1)
    const editor = new TabEditor(score, 3, new Settings(), { bar: 10, beat: 0 })
    const bar = score.masterBars[10]
    editor.setTimeSignature(3, 4)
    // Applies from here up to the next change of time signature.
    expect(bar.timeSignatureNumerator).toBe(3)
    expect(score.masterBars[11].timeSignatureNumerator).toBe(3)
    editor.setTempo(120)
    expect(editor.state().bar.tempo).toBe(120)
    expect(new TabEditor(score, 3, new Settings(), { bar: 11 }).state().bar.currentTempo).toBe(120)
    editor.setSection('Solo')
    editor.toggleRepeatStart()
    editor.setRepeatEnd(3)
    editor.toggleDoubleBar()
    editor.setTripletFeel(model.TripletFeel.Triplet8th)
    editor.setKeySignature(model.KeySignature.G, false)
    expect(editor.state().bar).toMatchObject({ section: 'Solo', repeatStart: true, repeatCount: 3, doubleBar: true, tripletFeel: model.TripletFeel.Triplet8th, keySignature: model.KeySignature.G })
    for (const track of score.tracks) expect(track.staves[0].bars[10].keySignature).toBe(model.KeySignature.G)
    expect(playedNotes(score)).toBeGreaterThan(0)

    while (editor.undo()) {
      // back to the start
    }
    expect(bar.timeSignatureNumerator).toBe(4)
    expect(score.masterBars[11].timeSignatureNumerator).toBe(4)
    expect(editor.state().bar).toMatchObject({ tempo: null, section: '', repeatStart: false, repeatCount: 0, doubleBar: false, tripletFeel: model.TripletFeel.NoTripletFeel })
  })

  it('inserts, duplicates and deletes bars in every track and undoes that', () => {
    const score = load(1)
    const count = score.masterBars.length
    const before = score.tracks.map((_, index) => fingerprint(score, index)).join('\n')
    const notesBefore = playedNotes(score)
    const editor = new TabEditor(score, 3, new Settings(), { bar: 4, beat: 0 })
    const original = fingerprint(score, 3).split(' | ')[4]

    editor.duplicateBar()
    expect(score.masterBars.length).toBe(count + 1)
    for (const track of score.tracks) expect(track.staves[0].bars.length).toBe(count + 1)
    expect(fingerprint(score, 3).split(' | ')[5]).toBe(original)
    expect(playedNotes(score)).toBeGreaterThan(notesBefore)

    editor.insertBar()
    expect(score.masterBars.length).toBe(count + 2)
    expect(editor.state().beat.isRest).toBe(true)
    editor.deleteBar()
    editor.deleteBar()
    expect(score.masterBars.length).toBe(count)
    score.masterBars.forEach((bar, index) => expect(bar.index).toBe(index))

    while (editor.undo()) {
      // back to the start
    }
    expect(score.tracks.map((_, index) => fingerprint(score, index)).join('\n')).toBe(before)
    expect(playedNotes(score)).toBe(notesBefore)
  })
})

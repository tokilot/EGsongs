// Songsterr track JSON (format version 8) -> alphaTab Score.
// Pure: no network, no DOM. The field catalogue is in docs/songsterr-format.md.
// Fields outside the catalogue are reported through `warnings` instead of being dropped silently.
import { model, type Settings } from '@coderline/alphatab'

type Json = Record<string, unknown>

export interface SongInfo {
  title: string
  artist: string
}

export interface ConvertResult {
  score: model.Score
  warnings: string[]
}

const PERCUSSION_INSTRUMENT_ID = 1024
const PERCUSSION_CHANNEL = 9
const TICKS_PER_WHOLE = 3840

const TRACK_KEYS = new Set([
  'name', 'instrument', 'instrumentId', 'strings', 'tuning', 'tuningFlat', 'capo', 'frets', 'volume', 'balance',
  'voices', 'anacrusis', 'automations', 'sounds', 'trackAutomations', 'newLyrics', 'withLyrics', 'measures',
  'partId', 'songId', 'revisionId', 'version', 'title', 'artist', 'grandStaffGroup',
])
const MEASURE_KEYS = new Set([
  'signature', 'keySignature', 'marker', 'repeatStart', 'repeat', 'alternateEnding', 'doubleBarline',
  'tripletFeel', 'rest', 'voices',
])
const VOICE_KEYS = new Set(['beats', 'rest'])
const BEAT_KEYS = new Set([
  'duration', 'type', 'dots', 'tuplet', 'tupletStart', 'tupletStop', 'rest', 'beamStart', 'beamStop', 'velocity',
  'gradualVelocity', 'palmMute', 'letRing', 'tapping', 'slapping', 'popping', 'tremolo', 'tremoloBar', 'vibrato',
  'vibratoWithTremoloBar', 'graceNote', 'brushStroke', 'arpeggio', 'downArpeggio', 'upArpeggio', 'pickStroke',
  'upStroke', 'downStroke', 'wahwah', 'chord', 'text', 'notes',
])
const NOTE_KEYS = new Set([
  'string', 'fret', 'rest', 'tie', 'dead', 'ghost', 'staccato', 'accentuated', 'hp', 'slide', 'bend', 'harmonic',
  'harmonicFret', 'leftHandVibrato', 'vibrato', 'wideVibrato', 'trill', 'pickScrape',
])

const DYNAMICS: Record<string, model.DynamicValue> = {
  ppp: model.DynamicValue.PPP,
  pp: model.DynamicValue.PP,
  p: model.DynamicValue.P,
  mp: model.DynamicValue.MP,
  mf: model.DynamicValue.MF,
  f: model.DynamicValue.F,
  ff: model.DynamicValue.FF,
  fff: model.DynamicValue.FFF,
}

const HARMONICS: Record<string, model.HarmonicType> = {
  natural: model.HarmonicType.Natural,
  artificial: model.HarmonicType.Artificial,
  pinch: model.HarmonicType.Pinch,
  tapped: model.HarmonicType.Tap,
  semi: model.HarmonicType.Semi,
  feedback: model.HarmonicType.Feedback,
}

// Tuplet ratios Songsterr writes as a single number; the denominator is cross-checked against `duration`.
const TUPLET_DENOMINATORS: Record<number, number> = { 2: 3, 3: 2, 4: 3, 5: 4, 6: 4, 7: 4, 9: 8, 10: 8, 11: 8, 12: 8, 13: 8 }

class Warnings {
  private readonly seen = new Set<string>()
  add(message: string) {
    this.seen.add(message)
  }
  unknownKeys(where: string, value: Json, known: Set<string>) {
    for (const key of Object.keys(value)) if (!known.has(key)) this.add(`unknown ${where} field "${key}"`)
  }
  list(): string[] {
    return [...this.seen]
  }
}

function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : []
}

function vibratoType(value: unknown): model.VibratoType {
  return value === 'wide' ? model.VibratoType.Wide : model.VibratoType.Slight
}

/** `tracks` are the raw per-track JSON documents in track order; they all describe the same bars. */
export function convertToScore(info: SongInfo, tracks: unknown[], settings: Settings): ConvertResult {
  const warnings = new Warnings()
  const sources = tracks as Json[]
  const score = new model.Score()
  score.title = info.title
  score.artist = info.artist

  const barCount = Math.max(0, ...sources.map((track) => asArray(track.measures).length))
  // Bar-level structure (time signature, repeats, markers) is repeated in every track; read it from the longest one.
  const lead = sources.find((track) => asArray(track.measures).length === barCount)
  buildMasterBars(score, lead, barCount, sources, warnings)

  let nextChannel = 0
  const takeChannel = () => {
    if (nextChannel === PERCUSSION_CHANNEL) nextChannel++
    return nextChannel++
  }

  for (const source of sources) {
    warnings.unknownKeys('track', source, TRACK_KEYS)
    const isPercussion = source.instrumentId === PERCUSSION_INSTRUMENT_ID
    const track = new model.Track()
    track.ensureStaveCount(1)
    track.name = String(source.name ?? source.instrument ?? '').trim()
    track.shortName = track.name.slice(0, 10)

    const playback = track.playbackInfo
    playback.volume = Math.round(clamp(Number(source.volume ?? 1), 0, 1) * 15)
    playback.balance = Math.round(8 + clamp(Number(source.balance ?? 0), -1, 1) * 8)
    if (isPercussion) {
      playback.program = 0
      playback.primaryChannel = PERCUSSION_CHANNEL
      playback.secondaryChannel = PERCUSSION_CHANNEL
    } else {
      playback.program = clamp(Number(source.instrumentId ?? 25), 0, 127)
      playback.primaryChannel = takeChannel()
      playback.secondaryChannel = takeChannel()
    }

    const staff = track.staves[0]
    staff.isPercussion = isPercussion
    staff.showStandardNotation = true
    staff.showTablature = !isPercussion
    if (!isPercussion) {
      const tuning = Array.isArray(source.tuning) ? (source.tuning as number[]) : []
      staff.stringTuning = model.Tuning.findTuning(tuning) ?? new model.Tuning('', tuning, false)
      staff.capo = Number(source.capo ?? 0)
    }
    score.addTrack(track)

    buildBars(staff, source, barCount, isPercussion, warnings)
    applyLyrics(track, source)
  }

  score.finish(settings)
  return { score, warnings: warnings.list() }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

function buildMasterBars(score: model.Score, lead: Json | undefined, barCount: number, sources: Json[], warnings: Warnings) {
  const measures = asArray(lead?.measures)
  let numerator = 4
  let denominator = 4
  let tripletFeel = model.TripletFeel.NoTripletFeel

  for (let index = 0; index < barCount; index++) {
    const measure: Json = measures[index] ?? {}
    warnings.unknownKeys('measure', measure, MEASURE_KEYS)
    const masterBar = new model.MasterBar()

    // The signature is only written where it changes.
    if (Array.isArray(measure.signature)) {
      numerator = Number(measure.signature[0]) || numerator
      denominator = Number(measure.signature[1]) || denominator
    }
    masterBar.timeSignatureNumerator = numerator
    masterBar.timeSignatureDenominator = denominator

    if (typeof measure.tripletFeel === 'string') {
      if (measure.tripletFeel === '8th') tripletFeel = model.TripletFeel.Triplet8th
      else if (measure.tripletFeel === '16th') tripletFeel = model.TripletFeel.Triplet16th
      else if (measure.tripletFeel === 'off') tripletFeel = model.TripletFeel.NoTripletFeel
      else warnings.add(`unknown tripletFeel "${measure.tripletFeel}"`)
    }
    masterBar.tripletFeel = tripletFeel

    const marker = measure.marker as Json | undefined
    if (marker && typeof marker.text === 'string' && marker.text.trim()) {
      const section = new model.Section()
      section.text = marker.text.trim()
      masterBar.section = section
    }

    masterBar.isRepeatStart = measure.repeatStart === true
    if (typeof measure.repeat === 'number') masterBar.repeatCount = measure.repeat
    if (Array.isArray(measure.alternateEnding)) {
      for (const ending of measure.alternateEnding as number[]) {
        if (ending >= 1 && ending <= model.MasterBar.MaxAlternateEndings) masterBar.alternateEndings |= 1 << (ending - 1)
      }
    }
    masterBar.isDoubleBar = measure.doubleBarline === true
    score.addMasterBar(masterBar)
  }

  if (barCount > 0 && sources.some((track) => track.anacrusis === true)) score.masterBars[0].isAnacrusis = true

  const tempoSource = sources.find((track) => asArray((track.automations as Json | undefined)?.tempo).length > 0)
  for (const tempo of asArray((tempoSource?.automations as Json | undefined)?.tempo)) {
    const masterBar = score.masterBars[Number(tempo.measure)]
    if (!masterBar) continue
    // `type` is the note value that gets the beat; alphaTab wants one of its fixed references.
    const dotted = tempo.dotted === true
    let reference = 2
    if (tempo.type === 8) reference = 1
    else if (tempo.type === 4) reference = dotted ? 3 : 2
    else if (tempo.type === 2) reference = dotted ? 5 : 4
    else warnings.add(`unknown tempo type ${String(tempo.type)}`)
    const automation = model.Automation.buildTempoAutomation(
      tempo.linear === true,
      clamp(Number(tempo.position ?? 0), 0, 1),
      Number(tempo.bpm),
      reference,
    )
    if (typeof tempo.text === 'string') automation.text = tempo.text
    masterBar.tempoAutomations.push(automation)
  }
}

interface TrackState {
  staff: model.Staff
  stringCount: number
  isPercussion: boolean
  /** Last fret played on each alphaTab string, for tied notes that omit their fret. */
  lastFret: Map<number, number>
  warnings: Warnings
}

function buildBars(staff: model.Staff, source: Json, barCount: number, isPercussion: boolean, warnings: Warnings) {
  const measures = asArray(source.measures)
  const state: TrackState = {
    staff,
    stringCount: Number(source.strings ?? staff.tuning.length),
    isPercussion,
    lastFret: new Map(),
    warnings,
  }
  const instrumentChanges = collectInstrumentChanges(source)
  const voiceCount = Math.max(1, ...measures.map((measure) => asArray(measure.voices).length))
  let keySignature = model.KeySignature.C
  let keySignatureType = model.KeySignatureType.Major

  for (let index = 0; index < barCount; index++) {
    const measure: Json = measures[index] ?? {}
    const bar = new model.Bar()
    if (isPercussion) bar.clef = model.Clef.Neutral
    else if (Math.min(...staff.tuning, 127) < 36) bar.clef = model.Clef.F4

    const key = measure.keySignature as Json | undefined
    if (key) {
      const count = Number(key.accidentalCount ?? 0)
      keySignature = (key.transposeAs === 'b' ? -count : count) as model.KeySignature
      keySignatureType = key.mode === 'minor' ? model.KeySignatureType.Minor : model.KeySignatureType.Major
    }
    bar.keySignature = keySignature
    bar.keySignatureType = keySignatureType
    staff.addBar(bar)

    // alphaTab chains beats across bars per voice index, so every bar needs the same number of voices and no
    // voice may be left without a beat. Unused voices get one empty placeholder beat.
    const voices = asArray(measure.voices)
    for (let voiceIndex = 0; voiceIndex < voiceCount; voiceIndex++) {
      const voiceSource: Json = voices[voiceIndex] ?? { rest: true, beats: [] }
      warnings.unknownKeys('voice', voiceSource, VOICE_KEYS)
      const voice = new model.Voice()
      bar.addVoice(voice)
      const beats = asArray(voiceSource.beats)
      if (beats.length === 0 || (voiceIndex > 0 && voiceSource.rest === true)) {
        const placeholder = new model.Beat()
        placeholder.isEmpty = true
        voice.addBeat(placeholder)
        continue
      }
      let position = 0
      for (const beatSource of beats) {
        const beat = buildBeat(beatSource, state)
        voice.addBeat(beat)
        if (voiceIndex === 0) {
          for (const change of instrumentChanges.get(index) ?? []) {
            if (change.position === position) {
              beat.automations.push(model.Automation.buildInstrumentAutomation(false, 0, change.program))
            }
          }
        }
        if (!beatSource.graceNote) position += beatTicks(beatSource)
      }
    }
  }
}

function beatTicks(source: Json): number {
  const duration = source.duration as number[] | undefined
  if (Array.isArray(duration) && duration[1]) return Math.round((TICKS_PER_WHOLE * duration[0]) / duration[1])
  return Math.round(TICKS_PER_WHOLE / Number(source.type ?? 4))
}

interface InstrumentChange {
  position: number
  program: number
}

// A track can switch sounds mid-song (clean <-> distortion). Positions are ticks from the start of the bar.
function collectInstrumentChanges(source: Json): Map<number, InstrumentChange[]> {
  const changes = new Map<number, InstrumentChange[]>()
  const sounds = asArray(source.sounds)
  const automations = asArray((source.trackAutomations as Json | undefined)?.trackSoundAutomations)
  for (const automation of automations) {
    const sound = sounds[Number(automation.soundId)]
    if (!sound || typeof sound.instrumentId !== 'number' || sound.instrumentId > 127) continue
    const measure = Number(automation.measure)
    const list = changes.get(measure) ?? []
    list.push({ position: Number(automation.position ?? 0), program: sound.instrumentId })
    changes.set(measure, list)
  }
  return changes
}

function buildBeat(source: Json, state: TrackState): model.Beat {
  const { warnings } = state
  warnings.unknownKeys('beat', source, BEAT_KEYS)
  const beat = new model.Beat()

  const type = Number(source.type ?? 4)
  beat.duration = (model.Duration[type] !== undefined ? type : model.Duration.Quarter) as model.Duration
  if (model.Duration[type] === undefined) warnings.add(`unknown beat type ${type}`)
  beat.dots = Number(source.dots ?? 0)

  if (typeof source.tuplet === 'number') {
    beat.tupletNumerator = source.tuplet
    beat.tupletDenominator = tupletDenominator(source, type, beat.dots, warnings)
  }

  if (source.graceNote === 'onBeat') beat.graceType = model.GraceType.OnBeat
  else if (source.graceNote === 'beforeBeat') beat.graceType = model.GraceType.BeforeBeat
  else if (source.graceNote !== undefined) warnings.add(`unknown graceNote "${String(source.graceNote)}"`)

  if (typeof source.velocity === 'string') {
    const dynamics = DYNAMICS[source.velocity]
    if (dynamics === undefined) warnings.add(`unknown velocity "${source.velocity}"`)
    else beat.dynamics = dynamics
  }
  if (source.gradualVelocity === 'crescendo') beat.crescendo = model.CrescendoType.Crescendo
  else if (source.gradualVelocity === 'decrescendo') beat.crescendo = model.CrescendoType.Decrescendo

  beat.tap = source.tapping === true
  beat.slap = source.slapping === true
  beat.pop = source.popping === true

  if (Array.isArray(source.tremolo)) {
    const speed = Number(source.tremolo[1])
    beat.tremoloSpeed = (model.Duration[speed] !== undefined ? speed : model.Duration.ThirtySecond) as model.Duration
  }

  const tremoloBar = source.tremoloBar as Json | undefined
  if (tremoloBar) {
    const points = asArray(tremoloBar.points)
    for (const point of points) beat.addWhammyBarPoint(bendPoint(point))
    // A single point is a held dive; alphaTab needs a start and an end.
    if (points.length === 1) {
      beat.addWhammyBarPoint(new model.BendPoint(model.BendPoint.MaxPosition, Number(points[0].tone ?? 0) / 25))
    }
  }

  if (source.vibrato === true) beat.vibrato = model.VibratoType.Slight
  if (source.vibratoWithTremoloBar !== undefined) beat.vibrato = vibratoType(source.vibratoWithTremoloBar)

  const brush = source.brushStroke as Json | undefined
  if (brush) {
    beat.brushType = brush.direction === 'up' ? model.BrushType.BrushUp : model.BrushType.BrushDown
    beat.brushDuration = Number(brush.duration ?? 60)
  }
  const arpeggio = source.arpeggio as Json | undefined
  if (arpeggio) {
    beat.brushType = arpeggio.direction === 'up' ? model.BrushType.ArpeggioUp : model.BrushType.ArpeggioDown
    beat.brushDuration = Number(arpeggio.duration ?? 240)
  } else if (source.downArpeggio) {
    beat.brushType = model.BrushType.ArpeggioDown
  } else if (source.upArpeggio) {
    beat.brushType = model.BrushType.ArpeggioUp
  }

  // Two generations of the same field.
  if (source.pickStroke === 'up' || source.upStroke) beat.pickStroke = model.PickStroke.Up
  else if (source.pickStroke === 'down' || source.downStroke) beat.pickStroke = model.PickStroke.Down

  if (source.wahwah === 'open') beat.wahPedal = model.WahPedal.Open
  else if (source.wahwah === 'closed') beat.wahPedal = model.WahPedal.Closed

  const chord = source.chord as Json | undefined
  if (chord && typeof chord.text === 'string' && chord.text) {
    if (!state.staff.hasChord(chord.text)) {
      const entry = new model.Chord()
      entry.name = chord.text
      entry.showDiagram = false
      entry.showFingering = false
      state.staff.addChord(chord.text, entry)
    }
    beat.chordId = chord.text
  }
  const text = source.text as Json | undefined
  if (text && typeof text.text === 'string' && text.text) beat.text = text.text

  if (source.rest !== true) {
    for (const noteSource of asArray(source.notes)) {
      if (noteSource.rest === true) continue
      const note = buildNote(noteSource, source, state)
      if (note) beat.addNote(note)
    }
  }
  return beat
}

function tupletDenominator(source: Json, type: number, dots: number, warnings: Warnings): number {
  const tuplet = source.tuplet as number
  const duration = source.duration as number[] | undefined
  if (Array.isArray(duration) && duration[1]) {
    const plain = (1 / type) * (dots === 2 ? 1.75 : dots === 1 ? 1.5 : 1)
    const denominator = Math.round((duration[0] / duration[1] / plain) * tuplet)
    if (denominator > 0) return denominator
  }
  const known = TUPLET_DENOMINATORS[tuplet]
  if (!known) warnings.add(`unknown tuplet ${tuplet}`)
  return known ?? 2
}

function bendPoint(point: Json): model.BendPoint {
  // Songsterr: position 0..60, tone in hundredths of a whole tone. alphaTab: same positions, value in quarter tones.
  return new model.BendPoint(
    clamp(Number(point.position ?? 0), 0, model.BendPoint.MaxPosition),
    Number(point.tone ?? 0) / 25,
  )
}

function buildNote(source: Json, beatSource: Json, state: TrackState): model.Note | null {
  const { warnings } = state
  warnings.unknownKeys('note', source, NOTE_KEYS)
  const note = new model.Note()

  if (state.isPercussion) {
    // `fret` is the percussion articulation id (GM drum notes plus Guitar Pro extras); `string` is only a staff
    // position on the original site and alphaTab derives its own.
    if (typeof source.fret !== 'number') return null
    note.percussionArticulation = source.fret
    note.string = -1
    note.fret = -1
  } else {
    const sourceString = Number(source.string)
    if (!Number.isInteger(sourceString) || sourceString < 0 || sourceString >= state.stringCount) {
      warnings.add(`note on string ${String(source.string)} of a ${state.stringCount}-string track`)
      return null
    }
    // Songsterr counts strings from 0 at the thinnest; alphaTab counts from 1 at the thickest.
    note.string = state.stringCount - sourceString
    if (typeof source.fret === 'number') note.fret = source.fret
    else note.fret = source.tie === true ? (state.lastFret.get(note.string) ?? 0) : 0
    state.lastFret.set(note.string, note.fret)
  }

  note.isTieDestination = source.tie === true
  note.isDead = source.dead === true
  note.isGhost = source.ghost === true
  note.isStaccato = source.staccato === true
  note.isHammerPullOrigin = source.hp === true
  note.isPalmMute = beatSource.palmMute === true
  note.isLetRing = beatSource.letRing === true
  if (source.accentuated === 2) note.accentuated = model.AccentuationType.Heavy
  else if (source.accentuated) note.accentuated = model.AccentuationType.Normal

  if (typeof source.slide === 'string') applySlide(note, source.slide, warnings)
  if (source.pickScrape === 'down') note.slideOutType = model.SlideOutType.PickSlideDown
  else if (source.pickScrape === 'up') note.slideOutType = model.SlideOutType.PickSlideUp

  const bend = source.bend as Json | undefined
  if (bend) for (const point of asArray(bend.points)) note.addBendPoint(bendPoint(point))

  if (typeof source.harmonic === 'string') {
    const type = HARMONICS[source.harmonic]
    if (type === undefined) warnings.add(`unknown harmonic "${source.harmonic}"`)
    else {
      note.harmonicType = type
      note.harmonicValue = typeof source.harmonicFret === 'number' ? source.harmonicFret : note.fret
    }
  }

  // Three spellings of vibrato across format generations.
  if (source.leftHandVibrato !== undefined) note.vibrato = vibratoType(source.leftHandVibrato)
  else if (source.wideVibrato === true) note.vibrato = model.VibratoType.Wide
  else if (source.vibrato === true) note.vibrato = model.VibratoType.Slight

  const trill = source.trill as Json | undefined
  if (trill && typeof trill.auxiliaryFret === 'number' && !state.isPercussion) {
    note.trillValue = trill.auxiliaryFret + state.staff.capo + model.Note.getStringTuning(state.staff, note.string)
    note.trillSpeed = model.Duration.Sixteenth
  }
  return note
}

function applySlide(note: model.Note, slide: string, warnings: Warnings) {
  let rest = slide
  if (rest.startsWith('below')) {
    note.slideInType = model.SlideInType.IntoFromBelow
    rest = rest.slice('below'.length)
  } else if (rest.startsWith('above')) {
    note.slideInType = model.SlideInType.IntoFromAbove
    rest = rest.slice('above'.length)
  }
  if (rest === 'legato') note.slideOutType = model.SlideOutType.Legato
  else if (rest === 'shift') note.slideOutType = model.SlideOutType.Shift
  else if (rest === 'downwards') note.slideOutType = model.SlideOutType.OutDown
  else if (rest === 'upwards') note.slideOutType = model.SlideOutType.OutUp
  else if (rest !== '') warnings.add(`unknown slide "${slide}"`)
}

function applyLyrics(track: model.Track, source: Json) {
  const lyrics: model.Lyrics[] = []
  for (const line of asArray(source.newLyrics)) {
    if (typeof line.text !== 'string' || !line.text.trim()) continue
    const entry = new model.Lyrics()
    entry.startBar = Math.max(0, Number(line.offset ?? 1) - 1)
    entry.text = line.text
    lyrics.push(entry)
  }
  if (lyrics.length > 0) track.applyLyrics(lyrics)
}

// Copies of alphaTab model objects for the tab editor's undo history. alphaTab has its own cloners but does not
// export them, so these copy every field except the links that score.finish() rebuilds (neighbouring beats,
// tie and slide partners, lookups) and the identity fields.
import { model } from '@coderline/alphatab'

type Bag = Record<string, unknown>

const BEAT_SKIP = new Set([
  'id', 'index', 'previousBeat', 'nextBeat', 'voice', 'notes', 'noteStringLookup', 'noteValueLookup', 'minNote', 'maxNote',
  'maxStringNote', 'minStringNote', 'automations', 'lyrics', 'tupletGroup', 'graceGroup', 'whammyBarPoints', 'maxWhammyPoint',
  'minWhammyPoint', 'tremoloPicking', 'effectSlurOrigin', 'effectSlurDestination', 'fermata',
])

const NOTE_SKIP = new Set([
  'id', 'index', 'beat', 'bendOrigin', 'hammerPullOrigin', 'hammerPullDestination', 'slurOrigin', 'slurDestination',
  'letRingDestination', 'palmMuteDestination', 'slideTarget', 'slideOrigin', 'tieOrigin', 'tieDestination',
  'effectSlurOrigin', 'effectSlurDestination', 'effectSlur', '_noteIdBag', 'bendPoints', 'maxBendPoint',
])

function copyFields(from: object, to: object, skip: Set<string>) {
  for (const [key, value] of Object.entries(from)) if (!skip.has(key)) (to as Bag)[key] = value
}

/** A plain copy of an object with the same prototype (for small value objects such as a tremolo effect). */
function copyObject<T extends object>(value: T): T {
  return Object.assign(Object.create(Object.getPrototypeOf(value)) as T, value)
}

export function cloneNote(note: model.Note): model.Note {
  const copy = new model.Note()
  copyFields(note, copy, NOTE_SKIP)
  for (const point of note.bendPoints ?? []) copy.addBendPoint(new model.BendPoint(point.offset, point.value))
  return copy
}

export function cloneBeat(beat: model.Beat): model.Beat {
  const copy = new model.Beat()
  copyFields(beat, copy, BEAT_SKIP)
  for (const note of beat.notes) copy.addNote(cloneNote(note))
  copy.automations = beat.automations.map((automation) => copyObject(automation))
  copy.lyrics = beat.lyrics ? [...beat.lyrics] : null
  for (const point of beat.whammyBarPoints ?? []) copy.addWhammyBarPoint(new model.BendPoint(point.offset, point.value))
  if (beat.tremoloPicking) copy.tremoloPicking = copyObject(beat.tremoloPicking)
  // The master bar's fermata map is the source; score.finish() would copy a beat's own fermata back into it.
  copy.fermata = null
  return copy
}

/** The beats of every voice of a bar, as copies. */
export type BarContent = model.Beat[][]

export function snapshotBar(bar: model.Bar): BarContent {
  return bar.voices.map((voice) => voice.beats.map(cloneBeat))
}

export function restoreBar(bar: model.Bar, content: BarContent) {
  bar.voices.forEach((voice, index) => {
    voice.beats = (content[index] ?? []).map(cloneBeat)
    for (const beat of voice.beats) beat.voice = voice
  })
}

/** The bar-wide settings the editor can change, for one master bar and the matching bar of every staff. */
export interface MasterBarContent {
  numerator: number
  denominator: number
  common: boolean
  tempo: model.Automation[]
  section: model.Section | null
  repeatStart: boolean
  repeatCount: number
  alternateEndings: number
  doubleBar: boolean
  tripletFeel: model.TripletFeel
  fermata: Map<number, model.Fermata> | null
  keys: Array<{ key: model.KeySignature; type: model.KeySignatureType }>
}

function staffBars(score: model.Score, index: number): model.Bar[] {
  return score.tracks.flatMap((track) => track.staves.map((staff) => staff.bars[index]).filter(Boolean))
}

export function snapshotMasterBar(score: model.Score, index: number): MasterBarContent {
  const bar = score.masterBars[index]
  return {
    numerator: bar.timeSignatureNumerator,
    denominator: bar.timeSignatureDenominator,
    common: bar.timeSignatureCommon,
    tempo: bar.tempoAutomations.map((automation) => copyObject(automation)),
    section: bar.section ? copyObject(bar.section) : null,
    repeatStart: bar.isRepeatStart,
    repeatCount: bar.repeatCount,
    alternateEndings: bar.alternateEndings,
    doubleBar: bar.isDoubleBar,
    tripletFeel: bar.tripletFeel,
    fermata: bar.fermata ? new Map([...bar.fermata].map(([offset, fermata]) => [offset, copyObject(fermata)])) : null,
    keys: staffBars(score, index).map((staffBar) => ({ key: staffBar.keySignature, type: staffBar.keySignatureType })),
  }
}

export function restoreMasterBar(score: model.Score, index: number, content: MasterBarContent) {
  const bar = score.masterBars[index]
  bar.timeSignatureNumerator = content.numerator
  bar.timeSignatureDenominator = content.denominator
  bar.timeSignatureCommon = content.common
  bar.tempoAutomations = content.tempo.map((automation) => copyObject(automation))
  bar.section = content.section ? copyObject(content.section) : null
  bar.isRepeatStart = content.repeatStart
  bar.repeatCount = content.repeatCount
  bar.alternateEndings = content.alternateEndings
  bar.isDoubleBar = content.doubleBar
  bar.tripletFeel = content.tripletFeel
  bar.fermata = content.fermata ? new Map([...content.fermata].map(([offset, fermata]) => [offset, copyObject(fermata)])) : null
  // score.finish() takes the beats' fermatas from the map again, unless a beat still has one of its own.
  for (const staffBar of staffBars(score, index)) for (const voice of staffBar.voices) for (const beat of voice.beats) beat.fermata = null
  staffBars(score, index).forEach((staffBar, position) => {
    const key = content.keys[position]
    if (!key) return
    staffBar.keySignature = key.key
    staffBar.keySignatureType = key.type
  })
}

/** A track's setup ("编辑音轨") and every bar of it, for a track edit made while editing the tab. */
export interface TrackContent {
  name: string
  shortName: string
  program: number
  staves: Array<{ tuning: model.Tuning; capo: number; bars: BarContent[] }>
}

function copyTuning(tuning: model.Tuning): model.Tuning {
  return new model.Tuning(tuning.name, [...tuning.tunings], tuning.isStandard)
}

export function snapshotTrack(track: model.Track): TrackContent {
  return {
    name: track.name,
    shortName: track.shortName,
    program: track.playbackInfo.program,
    staves: track.staves.map((staff) => ({ tuning: copyTuning(staff.stringTuning), capo: staff.capo, bars: staff.bars.map(snapshotBar) })),
  }
}

export function restoreTrack(track: model.Track, content: TrackContent) {
  track.name = content.name
  track.shortName = content.shortName
  track.playbackInfo.program = content.program
  track.staves.forEach((staff, index) => {
    const saved = content.staves[index]
    if (!saved) return
    staff.stringTuning = copyTuning(saved.tuning)
    staff.capo = saved.capo
    staff.bars.forEach((bar, position) => {
      if (saved.bars[position]) restoreBar(bar, saved.bars[position])
    })
  })
}

/** Which bar objects make up the score, for edits that add or remove bars. The objects themselves are kept. */
export interface Structure {
  masterBars: model.MasterBar[]
  staves: model.Bar[][]
}

function allStaves(score: model.Score): model.Staff[] {
  return score.tracks.flatMap((track) => track.staves)
}

export function snapshotStructure(score: model.Score): Structure {
  return { masterBars: [...score.masterBars], staves: allStaves(score).map((staff) => [...staff.bars]) }
}

export function restoreStructure(score: model.Score, structure: Structure) {
  score.masterBars = [...structure.masterBars]
  allStaves(score).forEach((staff, index) => (staff.bars = [...(structure.staves[index] ?? staff.bars)]))
  relink(score)
}

/** Index and neighbour links after bars were inserted or removed. */
export function relink(score: model.Score) {
  score.masterBars.forEach((bar, index) => {
    bar.score = score
    bar.index = index
    bar.previousMasterBar = score.masterBars[index - 1] ?? null
    bar.nextMasterBar = score.masterBars[index + 1] ?? null
    const previous = bar.previousMasterBar
    bar.start = previous ? previous.start + (previous.isAnacrusis ? 0 : previous.calculateDuration()) : 0
  })
  score.rebuildRepeatGroups()
  for (const staff of allStaves(score)) {
    staff.bars.forEach((bar, index) => {
      bar.staff = staff
      bar.index = index
      bar.previousBar = staff.bars[index - 1] ?? null
      bar.nextBar = staff.bars[index + 1] ?? null
    })
  }
}

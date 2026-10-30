// "New blank tab": an empty score of rests, as a Guitar Pro 7 file, which goes into the library like any upload
// and is then filled in with the tab editor.
import * as alphaTab from '@coderline/alphatab'

export type BlankInstrument = 'electric' | 'acoustic' | 'bass'

export interface BlankTab {
  title: string
  artist: string
  instrument: BlankInstrument
  numerator: number
  denominator: number
  tempo: number
  bars: number
}

/** Standard tuning (highest string first) and the General MIDI sound for each kind of track. */
export const BLANK_INSTRUMENTS: Record<BlankInstrument, { label: string; trackName: string; program: number; tuning: number[] }> = {
  electric: { label: '电吉他', trackName: 'Electric Guitar', program: 27, tuning: [64, 59, 55, 50, 45, 40] },
  acoustic: { label: '木吉他', trackName: 'Acoustic Guitar', program: 25, tuning: [64, 59, 55, 50, 45, 40] },
  bass: { label: '贝斯', trackName: 'Bass', program: 33, tuning: [43, 38, 33, 28] },
}

export const BLANK_TIME_SIGNATURES: Array<[number, number]> = [
  [4, 4],
  [3, 4],
  [2, 4],
  [6, 8],
  [12, 8],
]

export const BLANK_DEFAULTS: BlankTab = { title: '', artist: '', instrument: 'electric', numerator: 4, denominator: 4, tempo: 120, bars: 16 }

/** The rest that fills a whole bar of the time signature, as a duration and a dot (or null when one does not). */
function barRest(numerator: number, denominator: number): Array<{ duration: alphaTab.model.Duration; dots: number }> {
  const { Duration } = alphaTab.model
  const byValue: Record<number, alphaTab.model.Duration> = { 1: Duration.Whole, 2: Duration.Half, 4: Duration.Quarter, 8: Duration.Eighth, 16: Duration.Sixteenth }
  // In units of the denominator: whole bars of 4/4, 2/4, 3/4 (dotted half), 6/8 (dotted half), 12/8 (dotted whole).
  const whole = numerator / denominator
  if (whole === 1) return [{ duration: Duration.Whole, dots: 0 }]
  if (whole === 0.5) return [{ duration: Duration.Half, dots: 0 }]
  if (whole === 0.75) return [{ duration: Duration.Half, dots: 1 }]
  if (whole === 1.5) return [{ duration: Duration.Whole, dots: 1 }]
  // Anything else: one rest per beat.
  return Array.from({ length: numerator }, () => ({ duration: byValue[denominator] ?? Duration.Quarter, dots: 0 }))
}

export function buildBlankScore(tab: BlankTab): alphaTab.model.Score {
  const { model } = alphaTab
  const instrument = BLANK_INSTRUMENTS[tab.instrument]
  const score = new model.Score()
  score.title = tab.title
  score.artist = tab.artist
  for (let index = 0; index < tab.bars; index++) {
    const masterBar = new model.MasterBar()
    masterBar.timeSignatureNumerator = tab.numerator
    masterBar.timeSignatureDenominator = tab.denominator
    if (index === 0) masterBar.tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0, tab.tempo, 2))
    score.addMasterBar(masterBar)
  }
  const track = new model.Track()
  track.name = instrument.trackName
  track.ensureStaveCount(1)
  track.playbackInfo.program = instrument.program
  track.playbackInfo.primaryChannel = 0
  track.playbackInfo.secondaryChannel = 1
  const staff = track.staves[0]
  staff.showTablature = true
  staff.showStandardNotation = false
  staff.stringTuning = new model.Tuning('', instrument.tuning, false)
  score.addTrack(track)
  const rests = barRest(tab.numerator, tab.denominator)
  for (let index = 0; index < tab.bars; index++) {
    const bar = new model.Bar()
    staff.addBar(bar)
    const voice = new model.Voice()
    bar.addVoice(voice)
    for (const rest of rests) {
      const beat = new model.Beat()
      beat.isEmpty = false
      beat.duration = rest.duration
      beat.dots = rest.dots
      voice.addBeat(beat)
    }
  }
  score.finish(new alphaTab.Settings())
  return score
}

/** The blank tab as a Guitar Pro 7 file. */
export function blankTabFile(tab: BlankTab): Uint8Array {
  return new alphaTab.exporter.Gp7Exporter().export(buildBlankScore(tab), new alphaTab.Settings())
}

/** A file name the library takes the title from (it drops the extension), without characters Windows refuses. */
export function blankFileName(title: string): string {
  return `${title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled'}.gp`
}

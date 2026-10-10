// The only place that talks to alphaTab's player API. UI code goes through usePlayer() (see PlayerContext.tsx).
import * as alphaTab from '@coderline/alphatab'
import { convertToScore, type SongInfo } from '../songsterr/convert.ts'
import { BPM_MAX, BPM_MIN, DENOMINATORS, FreeMetronome, playCountIn, secondsPerBeat, type CountIn, type MetronomeSettings } from './clicks.ts'
import { transposeScore } from './transpose.ts'

export type ScoreSource =
  | { kind: 'songsterr'; info: SongInfo; tracks: unknown[] }
  | { kind: 'file'; bytes: Uint8Array }

export interface PlaybackRange {
  startTick: number
  endTick: number
}

/** What a song is opened with; everything is optional and falls back to the defaults. */
export interface InitialPractice {
  trackIndex?: number
  speed?: number
  looping?: boolean
  range?: PlaybackRange | null
  countIn?: boolean
  metronome?: boolean
  transpose?: number
}

export interface TrackInfo {
  index: number
  name: string
  isPercussion: boolean
  /** 0..1 */
  volume: number
  mute: boolean
  solo: boolean
}

export interface FreeMetronomeState extends MetronomeSettings {
  running: boolean
}

export interface PlayerSnapshot {
  status: 'empty' | 'loading' | 'ready' | 'error'
  error: string | null
  /** The synthesizer and sound font are loaded, so play() will work. */
  canPlay: boolean
  /** True during the count-in as well, so the play button offers "pause" to cancel it. */
  playing: boolean
  /** The count-in is clicking; the song has not started and its position does not move. */
  countingIn: boolean
  title: string
  artist: string
  tracks: TrackInfo[]
  trackIndex: number
  speed: number
  looping: boolean
  range: PlaybackRange | null
  countIn: boolean
  /** Clicks along with the song, following its tempo and time signature. */
  metronome: boolean
  /** The stand-alone metronome with its own tempo and time signature. */
  freeMetronome: FreeMetronomeState
  transpose: number
  /** Notes the instrument cannot reach at the current transposition; they are played an octave away. */
  transposeOutOfRange: number
  zoom: number
  showNotation: boolean
  barCount: number
  /** Fields the Songsterr converter did not recognise. */
  warnings: string[]
}

export const SPEED_MIN = 0.25
export const SPEED_MAX = 2
export const TRANSPOSE_MIN = -12
export const TRANSPOSE_MAX = 12

const METRONOME_STORAGE_KEY = 'tabs.metronome'
/** A better General MIDI sample set, used when it has been downloaded (`npm run soundfont`). */
const PREFERRED_SOUND_FONT = 'sounds/FluidR3Mono_GM.sf3'
const BUNDLED_SOUND_FONT = 'soundfont/sonivox.sf2'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function cleanMetronome(settings: Partial<MetronomeSettings>): MetronomeSettings {
  const denominator = Number(settings.denominator)
  return {
    bpm: clamp(Math.round(Number(settings.bpm) || 100), BPM_MIN, BPM_MAX),
    numerator: clamp(Math.round(Number(settings.numerator) || 4), 1, 16),
    denominator: DENOMINATORS.includes(denominator) ? denominator : 4,
  }
}

function storedMetronome(): MetronomeSettings {
  try {
    return cleanMetronome(JSON.parse(localStorage.getItem(METRONOME_STORAGE_KEY) ?? '{}') as Partial<MetronomeSettings>)
  } catch {
    return cleanMetronome({})
  }
}

const EMPTY: PlayerSnapshot = {
  status: 'empty',
  error: null,
  canPlay: false,
  playing: false,
  countingIn: false,
  title: '',
  artist: '',
  tracks: [],
  trackIndex: 0,
  speed: 1,
  looping: false,
  range: null,
  countIn: false,
  metronome: false,
  freeMetronome: { running: false, bpm: 100, numerator: 4, denominator: 4 },
  transpose: 0,
  transposeOutOfRange: 0,
  zoom: 1,
  showNotation: false,
  barCount: 0,
  warnings: [],
}

// Score colours for the two themes. alphaTab draws with these; the background comes from CSS.
const SCORE_COLORS = {
  light: { main: [0, 0, 0, 255], secondary: [0, 0, 0, 100], staffLine: [165, 165, 165, 255], barSeparator: [34, 34, 17, 255], barNumber: [200, 0, 0, 255] },
  dark: { main: [232, 232, 234, 255], secondary: [232, 232, 234, 120], staffLine: [110, 111, 118, 255], barSeparator: [200, 200, 205, 255], barNumber: [255, 123, 114, 255] },
} as const

export class PlayerController {
  private api: alphaTab.AlphaTabApi | null = null
  private snapshot: PlayerSnapshot = { ...EMPTY, freeMetronome: { running: false, ...storedMetronome() } }
  private readonly listeners = new Set<() => void>()
  /** Kept so a remount (React StrictMode, hot reload) can load the same song again. */
  private pending: { source: ScoreSource; practice: InitialPractice } | null = null
  /** The score as loaded, before any transposition. Transposed copies are made from this. */
  private baseScore: alphaTab.model.Score | null = null
  /** Set while the same song is being re-rendered at another transposition. */
  private swapping = false
  /** True from asking alphaTab to render until it reports the layout is done. */
  private renderPending = false
  // State that can only be applied once the new score is rendered and its MIDI is in the synthesizer.
  private pendingRange: PlaybackRange | null = null
  private pendingTick: number | null = null
  private pendingMixer = false
  private countInRun: CountIn | null = null
  private readonly freeMetronome = new FreeMetronome()
  private display = { zoom: 1, showNotation: false, dark: false }
  private soundFont: string | null = null

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): PlayerSnapshot => this.snapshot

  private update(changes: Partial<PlayerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...changes }
    for (const listener of this.listeners) listener()
  }

  /** What survives closing a song: display options and the stand-alone metronome. */
  private blank(): PlayerSnapshot {
    return { ...EMPTY, zoom: this.display.zoom, showNotation: this.display.showNotation, freeMetronome: this.snapshot.freeMetronome }
  }

  /** `element` receives the rendered score; `scrollElement` is the scrolling ancestor the cursor is kept visible in. */
  mount(element: HTMLElement, scrollElement: HTMLElement) {
    const settings = new alphaTab.Settings()
    settings.core.fontDirectory = `${import.meta.env.BASE_URL}font/`
    settings.core.logLevel = alphaTab.LogLevel.Error
    settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer
    // The sound font is chosen and loaded in loadSoundFont() below.
    settings.player.soundFont = null
    settings.player.scrollElement = scrollElement
    settings.player.scrollMode = alphaTab.ScrollMode.Continuous
    settings.player.scrollOffsetY = -24
    settings.player.enableCursor = true
    settings.player.enableUserInteraction = true
    settings.display.layoutMode = alphaTab.LayoutMode.Page
    settings.display.scale = this.display.zoom
    // Which staves are drawn is decided per track in applyStaffVisibility(); forcing the "Tab" profile here
    // would crash the renderer on drum tracks, which have no tablature.
    settings.display.staveProfile = alphaTab.StaveProfile.Default
    // Rhythm (stems and beams) is drawn underneath the tablature, like the site this layout follows.
    settings.notation.rhythmMode = alphaTab.TabRhythmMode.ShowWithBars
    settings.notation.elements.set(alphaTab.NotationElement.EffectDynamics, false)
    settings.notation.elements.set(alphaTab.NotationElement.ScoreWordsAndMusic, false)
    settings.notation.elements.set(alphaTab.NotationElement.ScoreWords, false)
    settings.notation.elements.set(alphaTab.NotationElement.ScoreMusic, false)
    settings.notation.elements.set(alphaTab.NotationElement.ScoreCopyright, false)
    this.applyScoreColors(settings)

    const api = new alphaTab.AlphaTabApi(element, settings)
    this.api = api

    api.scoreLoaded.on((score) => this.onScoreLoaded(score))
    api.renderFinished.on(() => {
      this.renderPending = false
      if (this.snapshot.status === 'loading') this.update({ status: 'ready' })
      this.applyPending()
    })
    api.playerReady.on(() => {
      this.update({ canPlay: true })
      this.applyPending()
    })
    api.playerStateChanged.on((event) => {
      const playing = event.state === alphaTab.synth.PlayerState.Playing
      // While our own count-in runs alphaTab is paused, but the user is "playing".
      this.update({ playing: playing || this.countInRun !== null })
    })
    api.playbackRangeChanged.on((event) => {
      const range = event.playbackRange
      this.update({ range: range ? { startTick: range.startTick, endTick: range.endTick } : null })
    })
    // Not api.midiLoaded: in alphaTab 1.8.4 subscribing to it reads a getter that calls itself forever.
    api.playerPositionChanged.on(() => this.applyPending())
    api.error.on((error) => {
      console.error(error)
      this.update({ status: 'error', error: error.message || '曲谱加载失败。', playing: false })
    })

    this.update(this.blank())
    void this.loadSoundFont(api)
    if (this.pending) this.load(this.pending.source, this.pending.practice)
  }

  unmount() {
    this.cancelCountIn()
    this.api?.destroy()
    this.api = null
  }

  // Use the larger sample set when it is there, otherwise the small one that ships with alphaTab.
  private async loadSoundFont(api: alphaTab.AlphaTabApi) {
    if (this.soundFont === null) {
      const preferred = `${import.meta.env.BASE_URL}${PREFERRED_SOUND_FONT}`
      const found = await fetch(preferred, { method: 'HEAD' })
        .then((response) => response.ok && !(response.headers.get('content-type') ?? '').includes('text/html'))
        .catch(() => false)
      this.soundFont = found ? preferred : `${import.meta.env.BASE_URL}${BUNDLED_SOUND_FONT}`
    }
    if (this.api !== api) return
    const response = await fetch(this.soundFont)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (this.api === api) api.loadSoundFont(bytes, false)
  }

  // The loop range, the position and the mixer can only be put back once the score is laid out (alphaTab draws
  // the selection as soon as the range is set and throws without a layout) and its MIDI is in the synthesizer.
  private applyPending() {
    const api = this.api
    if (!api || this.renderPending || this.snapshot.status !== 'ready' || !api.isReadyForPlayback) return
    if (this.pendingMixer) {
      this.pendingMixer = false
      for (const info of this.snapshot.tracks) {
        const track = api.score?.tracks[info.index]
        if (!track) continue
        if (info.volume !== 1) api.changeTrackVolume([track], info.volume)
        if (info.mute) api.changeTrackMute([track], true)
        if (info.solo) api.changeTrackSolo([track], true)
      }
    }
    if (this.pendingRange) {
      const range = this.pendingRange
      this.pendingRange = null
      try {
        api.playbackRange = range
      } catch (error) {
        console.warn('Could not restore the loop range', error)
      }
    }
    if (this.pendingTick !== null) {
      const tick = this.pendingTick
      this.pendingTick = null
      api.tickPosition = tick
    }
  }

  load(source: ScoreSource, practice: InitialPractice = {}) {
    this.pending = { source, practice }
    const api = this.api
    if (!api) return
    this.cancelCountIn()
    api.stop()
    api.playbackRange = null
    this.swapping = false
    this.pendingRange = practice.range ?? null
    this.pendingTick = null
    this.pendingMixer = false
    this.update({ ...this.blank(), canPlay: this.snapshot.canPlay, status: 'loading', trackIndex: Math.max(0, practice.trackIndex ?? 0) })
    try {
      let base: alphaTab.model.Score
      if (source.kind === 'songsterr') {
        const converted = convertToScore(source.info, source.tracks, api.settings)
        if (converted.warnings.length > 0) console.warn('Songsterr converter:', converted.warnings)
        this.update({ warnings: converted.warnings })
        base = converted.score
      } else {
        base = alphaTab.importer.ScoreLoader.loadScoreFromBytes(source.bytes, api.settings)
      }
      this.baseScore = base
      const transpose = clamp(Math.round(practice.transpose ?? 0), TRANSPOSE_MIN, TRANSPOSE_MAX)
      const shown = transpose === 0 ? { score: base, outOfRange: 0 } : transposeScore(base, transpose, api.settings)
      this.update({ transpose, transposeOutOfRange: shown.outOfRange })
      this.renderPending = true
      api.renderScore(shown.score, [clamp(practice.trackIndex ?? 0, 0, Math.max(0, base.tracks.length - 1))])
    } catch (error) {
      console.error(error)
      this.baseScore = null
      this.renderPending = false
      const unsupported = source.kind === 'file' ? '无法识别这个曲谱文件。' : '曲谱转换失败。'
      this.update({ status: 'error', error: (error as Error).message || unsupported })
    }
  }

  /** Closes the current song and clears the score area. */
  clear() {
    this.pending = null
    this.baseScore = null
    this.pendingRange = null
    this.pendingTick = null
    this.pendingMixer = false
    this.cancelCountIn()
    const api = this.api
    if (!api) return
    api.stop()
    api.playbackRange = null
    this.update({ ...this.blank(), canPlay: this.snapshot.canPlay })
  }

  private onScoreLoaded(score: alphaTab.model.Score) {
    const api = this.api
    if (!api) return
    this.applyStaffVisibility(score)
    if (this.swapping) {
      // Same song at another transposition: the practice setup stays as it is.
      this.swapping = false
      return
    }
    const practice = this.pending?.practice ?? {}
    const trackIndex = clamp(practice.trackIndex ?? this.snapshot.trackIndex, 0, Math.max(0, score.tracks.length - 1))
    const speed = clamp(practice.speed ?? 1, SPEED_MIN, SPEED_MAX)
    const looping = practice.looping ?? false
    const metronome = practice.metronome ?? false

    api.playbackSpeed = speed
    api.isLooping = looping
    api.metronomeVolume = metronome ? 1 : 0
    // The count-in is our own (see playPause); alphaTab's stays off.
    api.countInVolume = 0

    this.update({
      title: score.title,
      artist: score.artist,
      barCount: score.masterBars.length,
      tracks: score.tracks.map((track) => ({
        index: track.index,
        name: track.name || `Track ${track.index + 1}`,
        isPercussion: track.isPercussion,
        volume: 1,
        mute: false,
        solo: false,
      })),
      trackIndex,
      speed,
      looping,
      countIn: practice.countIn ?? false,
      metronome,
    })
  }

  /** Stringed tracks show tablature (plus standard notation on request); drums and keys show standard notation. */
  private applyStaffVisibility(score: alphaTab.model.Score) {
    for (const track of score.tracks) {
      for (const staff of track.staves) {
        const tablature = staff.isStringed && !staff.isPercussion
        staff.showTablature = tablature
        staff.showStandardNotation = !tablature || this.display.showNotation
      }
    }
  }

  private applyScoreColors(settings: alphaTab.Settings) {
    const colors = this.display.dark ? SCORE_COLORS.dark : SCORE_COLORS.light
    const color = (rgba: readonly number[]) => new alphaTab.model.Color(rgba[0], rgba[1], rgba[2], rgba[3])
    const resources = settings.display.resources
    resources.mainGlyphColor = color(colors.main)
    resources.scoreInfoColor = color(colors.main)
    resources.secondaryGlyphColor = color(colors.secondary)
    resources.staffLineColor = color(colors.staffLine)
    resources.barSeparatorColor = color(colors.barSeparator)
    resources.barNumberColor = color(colors.barNumber)
  }

  private track(index: number): alphaTab.model.Track | null {
    return this.api?.score?.tracks[index] ?? null
  }

  private patchTrack(index: number, changes: Partial<TrackInfo>) {
    this.update({ tracks: this.snapshot.tracks.map((track) => (track.index === index ? { ...track, ...changes } : track)) })
  }

  /** The bar playback is in (or would start in), with its tempo and time signature. */
  private currentBar() {
    const api = this.api
    const bars = api?.tickCache?.masterBars
    if (!api || !bars || bars.length === 0) return null
    const tick = api.tickPosition
    return bars.find((bar) => tick >= bar.start && tick < bar.end) ?? (tick >= bars[bars.length - 1].end ? bars[bars.length - 1] : bars[0])
  }

  playPause() {
    const api = this.api
    if (!api || this.snapshot.status !== 'ready' || !this.snapshot.canPlay) return
    if (this.countInRun) {
      this.cancelCountIn()
      return
    }
    if (api.playerState === alphaTab.synth.PlayerState.Playing) {
      api.pause()
      return
    }
    if (this.snapshot.countIn) this.startCountIn(api)
    else api.play()
  }

  // The count-in is ours rather than alphaTab's: one bar of clicks at the tempo of the bar playback starts in,
  // while the player stays paused, so the cursor does not move and nothing but the clicks is heard.
  // (alphaTab's own count-in moves the cursor through the first bar, and in 1.8.4 it gets stuck for good when
  // it is paused half way and then switched off.)
  private startCountIn(api: alphaTab.AlphaTabApi) {
    const bar = this.currentBar()
    if (!bar) {
      api.play()
      return
    }
    const { timeSignatureNumerator: beats, timeSignatureDenominator: denominator } = bar.masterBar
    const run = playCountIn(beats, secondsPerBeat(bar.tempo * this.snapshot.speed, denominator))
    this.countInRun = run
    this.update({ playing: true, countingIn: true })
    void run.done.then((completed) => {
      if (this.countInRun !== run) return
      this.countInRun = null
      this.update({ countingIn: false })
      if (completed && this.api === api) api.play()
      else this.update({ playing: false })
    })
  }

  private cancelCountIn() {
    const run = this.countInRun
    if (!run) return
    this.countInRun = null
    run.cancel()
    this.update({ playing: false, countingIn: false })
  }

  /** Stops and returns to the first bar (or the start of the loop range). */
  toStart() {
    this.cancelCountIn()
    this.api?.stop()
  }

  setSpeed(speed: number) {
    const value = clamp(Math.round(speed * 100) / 100, SPEED_MIN, SPEED_MAX)
    if (this.api) this.api.playbackSpeed = value
    this.update({ speed: value })
  }

  setLooping(looping: boolean) {
    if (this.api) this.api.isLooping = looping
    this.update({ looping })
  }

  /** Drops the selected range so the whole song plays (and loops) again. */
  clearRange() {
    const api = this.api
    if (!api) return
    api.playbackRange = null
    api.clearPlaybackRangeHighlight()
    this.update({ range: null })
  }

  setCountIn(countIn: boolean) {
    if (!countIn) this.cancelCountIn()
    this.update({ countIn })
  }

  /** The click that follows the song while it plays. */
  setMetronome(metronome: boolean) {
    if (this.api) this.api.metronomeVolume = metronome ? 1 : 0
    this.update({ metronome })
  }

  /** Tempo and time signature of the stand-alone metronome; applies at once if it is running. */
  setFreeMetronome(changes: Partial<MetronomeSettings>) {
    const settings = cleanMetronome({ ...this.snapshot.freeMetronome, ...changes })
    this.freeMetronome.configure(settings)
    try {
      localStorage.setItem(METRONOME_STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Private browsing: the setting just does not persist.
    }
    this.update({ freeMetronome: { ...settings, running: this.freeMetronome.running } })
  }

  toggleFreeMetronome() {
    if (this.freeMetronome.running) this.freeMetronome.stop()
    else {
      this.freeMetronome.configure(cleanMetronome(this.snapshot.freeMetronome))
      this.freeMetronome.start()
    }
    this.update({ freeMetronome: { ...this.snapshot.freeMetronome, running: this.freeMetronome.running } })
  }

  /** Copies the tempo (at the current practice speed) and time signature of the bar under the cursor. */
  matchFreeMetronomeToSong() {
    const bar = this.currentBar()
    if (!bar) return
    this.setFreeMetronome({
      bpm: bar.tempo * this.snapshot.speed,
      numerator: bar.masterBar.timeSignatureNumerator,
      denominator: bar.masterBar.timeSignatureDenominator,
    })
  }

  /**
   * Moves every pitched track by whole semitones. The tablature is rewritten so the fret numbers show what to
   * play at the new pitch; drums stay where they are.
   */
  setTranspose(semitones: number) {
    const api = this.api
    const base = this.baseScore
    const value = clamp(Math.round(semitones), TRANSPOSE_MIN, TRANSPOSE_MAX)
    if (!api || !base || this.snapshot.status !== 'ready' || value === this.snapshot.transpose) return
    this.cancelCountIn()
    const shown = value === 0 ? { score: base, outOfRange: 0 } : transposeScore(base, value, api.settings)
    // Rendering another score loads new MIDI, which stops playback and resets the position, the loop range
    // and the mixer; applyPending() puts them back once the new score is ready. When the previous change is
    // still on its way (two quick steps), what it was going to restore is still the truth.
    const restoring = this.pendingTick !== null
    this.pendingRange = restoring ? this.pendingRange : this.snapshot.range
    this.pendingTick = restoring ? this.pendingTick : api.tickPosition
    this.pendingMixer = true
    this.swapping = true
    this.renderPending = true
    this.update({ transpose: value, transposeOutOfRange: shown.outOfRange })
    api.renderScore(shown.score, [this.snapshot.trackIndex])
  }

  /** Shows another track of the same song; playback and cursor position are kept. */
  selectTrack(index: number) {
    const track = this.track(index)
    if (!this.api || !track || index === this.snapshot.trackIndex) return
    this.api.renderTracks([track])
    this.update({ trackIndex: index })
  }

  setTrackVolume(index: number, volume: number) {
    const track = this.track(index)
    const value = clamp(volume, 0, 1)
    if (this.api && track) this.api.changeTrackVolume([track], value)
    this.patchTrack(index, { volume: value })
  }

  setTrackMute(index: number, mute: boolean) {
    const track = this.track(index)
    if (this.api && track) this.api.changeTrackMute([track], mute)
    this.patchTrack(index, { mute })
  }

  setTrackSolo(index: number, solo: boolean) {
    const track = this.track(index)
    if (this.api && track) this.api.changeTrackSolo([track], solo)
    this.patchTrack(index, { solo })
  }

  /** Where playback is, in MIDI ticks. For diagnostics and the end-to-end checks. */
  get tickPosition(): number {
    return this.api?.tickPosition ?? 0
  }

  /** Moves the cursor by whole bars, following the order the bars are played in (repeats unrolled). */
  seekBars(delta: number) {
    const api = this.api
    const bars = api?.tickCache?.masterBars
    if (!api || !bars || bars.length === 0) return
    const tick = api.tickPosition
    let current = bars.findIndex((bar) => tick >= bar.start && tick < bar.end)
    if (current < 0) current = tick >= bars[bars.length - 1].end ? bars.length - 1 : 0
    // Going back from the middle of a bar first returns to its start.
    const target = delta < 0 && tick > bars[current].start + 30 ? current + delta + 1 : current + delta
    api.tickPosition = bars[clamp(target, 0, bars.length - 1)].start
  }

  setZoom(zoom: number) {
    const value = clamp(Math.round(zoom * 100) / 100, 0.5, 2)
    this.display.zoom = value
    this.applyDisplay()
    this.update({ zoom: value })
  }

  setShowNotation(showNotation: boolean) {
    this.display.showNotation = showNotation
    this.applyDisplay()
    this.update({ showNotation })
  }

  /** Light notation on a dark page, or the usual dark on light. The page background itself is CSS. */
  setDarkScore(dark: boolean) {
    if (this.display.dark === dark) return
    this.display.dark = dark
    this.applyDisplay()
  }

  private applyDisplay() {
    const api = this.api
    if (!api) return
    api.settings.display.scale = this.display.zoom
    this.applyScoreColors(api.settings)
    api.updateSettings()
    if (api.score) {
      this.applyStaffVisibility(api.score)
      api.render()
    }
  }

  /** Always prints dark on white, whatever the theme. */
  print() {
    const api = this.api
    if (!api || this.snapshot.status !== 'ready') return
    if (!this.display.dark) {
      api.print()
      return
    }
    // The print view copies the current settings, so switch the colours around it.
    this.display.dark = false
    this.applyScoreColors(api.settings)
    api.print()
    this.display.dark = true
    this.applyScoreColors(api.settings)
  }

  /** The song as shown (including transposition) as a Guitar Pro 7 file, or null when nothing is loaded. */
  exportGuitarPro(): Uint8Array | null {
    const api = this.api
    if (!api?.score) return null
    return new alphaTab.exporter.Gp7Exporter().export(api.score, api.settings)
  }
}

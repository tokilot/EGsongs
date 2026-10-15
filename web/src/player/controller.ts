// The only place that talks to alphaTab's player API. UI code goes through usePlayer() (see PlayerContext.tsx).
import * as alphaTab from '@coderline/alphatab'
import { convertToScore, type SongInfo } from '../songsterr/convert.ts'
import { BPM_MAX, BPM_MIN, DENOMINATORS, FreeMetronome, playCountIn, secondsPerBeat, type CountIn, type MetronomeSettings } from './clicks.ts'
import { TabEditor, type EditorState, type Flag } from './tabEditor.ts'
import { applyTrackEdits, trackSetup, type TrackEdit, type TrackEdits, type TrackSetup } from './trackEdits.ts'
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
  trackEdits?: TrackEdits
}

export interface TrackInfo {
  index: number
  name: string
  isPercussion: boolean
  /** General MIDI program, for the instrument icon. */
  program: number
  /** 0..1 */
  volume: number
  mute: boolean
  solo: boolean
}

export interface FreeMetronomeState extends MetronomeSettings {
  running: boolean
}

/** Display and playback preferences that apply to every song (the settings popover). */
export interface Preferences {
  /** Four bars per line instead of fitting as many as the width allows. */
  fourBarsPerLine: boolean
  /** Dynamics markings (p, mf, f …) under the staff. */
  showDynamics: boolean
  /** A one-bar count-in each time a loop starts over. */
  loopCountIn: boolean
}

/** A rectangle in the coordinates of the score element (alphaTab's own layout pixels). */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The tab editor while it is open. */
export interface EditingState extends EditorState {
  /** False for drum tracks, which are not edited. */
  editable: boolean
  /**
   * A position has been picked (a click on the score or a key press); until then the editor shows nothing
   * but waits, and the floating edit panel is closed.
   */
  selected: boolean
  /** Where to draw the cursor: the spot on the string, and the whole beat column. */
  noteBox: Box | null
  beatBox: Box | null
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
  /** Tracks that have a note sounding at the current position (and are audible), while playing. */
  sounding: number[]
  trackIndex: number
  speed: number
  looping: boolean
  range: PlaybackRange | null
  countIn: boolean
  /** Clicks along with the song, following its tempo and time signature. */
  metronome: boolean
  /** The stand-alone metronome with its own tempo and time signature. */
  freeMetronome: FreeMetronomeState
  /** Overall volume of everything the synthesizer plays, 0..1. */
  masterVolume: number
  transpose: number
  /** Notes the instrument cannot reach at the current transposition; they are played an octave away. */
  transposeOutOfRange: number
  /** Per-song track edits currently applied. */
  trackEdits: TrackEdits
  /** The tab editor, or null when not editing. */
  editing: EditingState | null
  zoom: number
  showNotation: boolean
  preferences: Preferences
  barCount: number
  /** Fields the Songsterr converter did not recognise. */
  warnings: string[]
}

export const SPEED_MIN = 0.25
export const SPEED_MAX = 2
export const TRANSPOSE_MIN = -12
export const TRANSPOSE_MAX = 12

const METRONOME_STORAGE_KEY = 'tabs.metronome'
const PREFERENCES_STORAGE_KEY = 'tabs.preferences'
const VOLUME_STORAGE_KEY = 'tabs.masterVolume'
/** A better General MIDI sample set, used when it has been downloaded (`npm run soundfont`). */
const PREFERRED_SOUND_FONT = 'sounds/FluidR3Mono_GM.sf3'
const BUNDLED_SOUND_FONT = 'soundfont/sonivox.sf2'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing: the setting just does not persist.
  }
}

function cleanMetronome(settings: Partial<MetronomeSettings>): MetronomeSettings {
  const denominator = Number(settings.denominator)
  return {
    bpm: clamp(Math.round(Number(settings.bpm) || 100), BPM_MIN, BPM_MAX),
    numerator: clamp(Math.round(Number(settings.numerator) || 4), 1, 16),
    denominator: DENOMINATORS.includes(denominator) ? denominator : 4,
  }
}

function cleanPreferences(value: Partial<Preferences>): Preferences {
  return { fourBarsPerLine: value.fourBarsPerLine === true, showDynamics: value.showDynamics === true, loopCountIn: value.loopCountIn === true }
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
  sounding: [],
  trackIndex: 0,
  speed: 1,
  looping: false,
  range: null,
  countIn: false,
  metronome: false,
  freeMetronome: { running: false, bpm: 100, numerator: 4, denominator: 4 },
  masterVolume: 1,
  transpose: 0,
  transposeOutOfRange: 0,
  trackEdits: {},
  editing: null,
  zoom: 1,
  showNotation: false,
  preferences: { fourBarsPerLine: false, showDynamics: false, loopCountIn: false },
  barCount: 0,
  warnings: [],
}

type Rgba = readonly [number, number, number, number]

// Notation colours for the two themes. alphaTab draws with these; the page background comes from CSS.
// Bright fret numbers and grey lines, bar numbers and effect labels, as on the reference layout.
const SCORE_COLORS: Record<'light' | 'dark', { main: Rgba; secondary: Rgba; staffLine: Rgba; barSeparator: Rgba; barNumber: Rgba }> = {
  light: { main: [28, 28, 30, 255], secondary: [110, 111, 117, 255], staffLine: [176, 178, 184, 255], barSeparator: [140, 142, 148, 255], barNumber: [120, 121, 127, 255] },
  dark: { main: [240, 240, 242, 255], secondary: [150, 151, 158, 255], staffLine: [96, 98, 105, 255], barSeparator: [120, 122, 130, 255], barNumber: [150, 151, 158, 255] },
}

/** alphaTab scale at a zoom of 100%. Chosen by the user: the size that used to be "120%". */
const ZOOM_BASE = 1.2

/**
 * Tracks other than the one shown play at this share of their volume, so the part being practised stands out
 * a little (about 3 dB). The volume sliders show the user's setting; this is applied on top.
 */
export const BACKGROUND_TRACK_LEVEL = 0.7

const SANS = ['Arial', 'Helvetica Neue', 'Helvetica', 'sans-serif']
// alphaTab's FontStyle / FontWeight enums are not exported; these are their values.
const PLAIN = 0
const BOLD = 1

interface SoundingSpan {
  start: number
  end: number
}

export class PlayerController {
  private api: alphaTab.AlphaTabApi | null = null
  private snapshot: PlayerSnapshot = {
    ...EMPTY,
    freeMetronome: { running: false, ...cleanMetronome(readStorage(METRONOME_STORAGE_KEY, {})) },
    masterVolume: clamp(Number(readStorage(VOLUME_STORAGE_KEY, 1)), 0, 1),
    preferences: cleanPreferences(readStorage(PREFERENCES_STORAGE_KEY, {})),
  }
  private readonly listeners = new Set<() => void>()
  /** Kept so a remount (React StrictMode, hot reload) can load the same song again. */
  private pending: { source: ScoreSource; practice: InitialPractice } | null = null
  /** The score exactly as loaded. */
  private originalScore: alphaTab.model.Score | null = null
  /** The loaded score with the track edits applied, before transposition. */
  private baseScore: alphaTab.model.Score | null = null
  /** Set while the same song is being re-rendered after a transposition or track edit. */
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
  /** Per track, per bar: the tick spans (relative to the bar) in which a note sounds. Built per score. */
  private soundingMap: { score: alphaTab.model.Score; spans: SoundingSpan[][][] } | null = null
  // Tab editor: one editor (with its own undo history) per track edited in this session.
  private editors = new Map<number, TabEditor>()
  /** The transposition to go back to after editing (the editor works on the untransposed tab). */
  private transposeBeforeEditing = 0
  /** The MIDI in the synthesizer no longer matches the edited tab. */
  private midiStale = false
  private host: HTMLElement | null = null
  private editSelected = false
  private scroller: HTMLElement | null = null

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

  /** What survives closing a song: display options, preferences, volume and the stand-alone metronome. */
  private blank(): PlayerSnapshot {
    const { freeMetronome, masterVolume, preferences } = this.snapshot
    return { ...EMPTY, zoom: this.display.zoom, showNotation: this.display.showNotation, freeMetronome, masterVolume, preferences }
  }

  /** `element` receives the rendered score; `scrollElement` is the scrolling ancestor the cursor is kept visible in. */
  mount(element: HTMLElement, scrollElement: HTMLElement) {
    this.host = element
    this.scroller = scrollElement
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
    // Note positions are needed by the tab editor (cursor and clicks on strings).
    settings.core.includeNoteBounds = true
    settings.display.layoutMode = alphaTab.LayoutMode.Page
    // Which staves are drawn is decided per track in applyStaffVisibility(); forcing the "Tab" profile here
    // would crash the renderer on drum tracks, which have no tablature.
    settings.display.staveProfile = alphaTab.StaveProfile.Default
    // Rhythm (stems and beams) is drawn underneath the tablature, like the site this layout follows.
    settings.notation.rhythmMode = alphaTab.TabRhythmMode.ShowWithBars
    for (const element of [
      alphaTab.NotationElement.ScoreWordsAndMusic,
      alphaTab.NotationElement.ScoreWords,
      alphaTab.NotationElement.ScoreMusic,
      alphaTab.NotationElement.ScoreCopyright,
      // The tuning is shown as string names at the start of the first line (web/alphatab-patches.ts).
      alphaTab.NotationElement.GuitarTuning,
      alphaTab.NotationElement.TrackNames,
    ]) {
      settings.notation.elements.set(element, false)
    }
    this.applyLook(settings)

    const api = new alphaTab.AlphaTabApi(element, settings)
    this.api = api
    api.masterVolume = this.snapshot.masterVolume

    api.scoreLoaded.on((score) => this.onScoreLoaded(score))
    api.renderFinished.on(() => {
      this.renderPending = false
      if (this.snapshot.status === 'loading') this.update({ status: 'ready' })
      this.applyPending()
    })
    // The layout worker sends the new bounds only after renderFinished; until then they are the old layout's.
    api.postRenderFinished.on(() => {
      this.measuredSpacing = null
      if (this.snapshot.editing) this.publishEditing(true)
    })
    api.playerReady.on(() => {
      this.update({ canPlay: true })
      this.applyPending()
    })
    api.playerStateChanged.on((event) => {
      const playing = event.state === alphaTab.synth.PlayerState.Playing
      // While our own count-in runs alphaTab is paused, but the user is "playing".
      this.update({ playing: playing || this.countInRun !== null, sounding: playing ? this.snapshot.sounding : [] })
    })
    api.playerFinished.on(() => this.onPlayerFinished(api))
    api.playbackRangeChanged.on((event) => {
      const range = event.playbackRange
      this.update({ range: range ? { startTick: range.startTick, endTick: range.endTick } : null })
    })
    // Not api.midiLoaded: in alphaTab 1.8.4 subscribing to it reads a getter that calls itself forever.
    api.playerPositionChanged.on((event) => {
      this.applyPending()
      if (api.playerState === alphaTab.synth.PlayerState.Playing) this.updateSounding(event.currentTick)
    })
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
      this.applyMixer()
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
    this.resetMixer()
    this.dropEditing()
    this.swapping = false
    this.pendingRange = practice.range ?? null
    this.pendingTick = null
    // Every track of the new song gets its volume set once it is loaded (the shown one a little louder).
    this.pendingMixer = true
    this.update({ ...this.blank(), canPlay: this.snapshot.canPlay, status: 'loading', trackIndex: Math.max(0, practice.trackIndex ?? 0) })
    try {
      let original: alphaTab.model.Score
      if (source.kind === 'songsterr') {
        const converted = convertToScore(source.info, source.tracks, api.settings)
        if (converted.warnings.length > 0) console.warn('Songsterr converter:', converted.warnings)
        this.update({ warnings: converted.warnings })
        original = converted.score
      } else {
        original = alphaTab.importer.ScoreLoader.loadScoreFromBytes(source.bytes, api.settings)
      }
      this.originalScore = original
      const trackEdits = practice.trackEdits ?? {}
      this.baseScore = applyTrackEdits(original, trackEdits, api.settings).score
      const transpose = clamp(Math.round(practice.transpose ?? 0), TRANSPOSE_MIN, TRANSPOSE_MAX)
      const shown = transpose === 0 ? { score: this.baseScore, outOfRange: 0 } : transposeScore(this.baseScore, transpose, api.settings)
      this.update({ transpose, transposeOutOfRange: shown.outOfRange, trackEdits })
      this.renderPending = true
      api.renderScore(shown.score, [clamp(practice.trackIndex ?? 0, 0, Math.max(0, original.tracks.length - 1))])
    } catch (error) {
      console.error(error)
      this.originalScore = null
      this.baseScore = null
      this.renderPending = false
      this.measuredSpacing = null
      const unsupported = source.kind === 'file' ? '无法识别这个曲谱文件。' : '曲谱转换失败。'
      this.update({ status: 'error', error: (error as Error).message || unsupported })
    }
  }

  /** Closes the current song and clears the score area. */
  clear() {
    this.pending = null
    this.originalScore = null
    this.baseScore = null
    this.pendingRange = null
    this.pendingTick = null
    this.pendingMixer = false
    this.cancelCountIn()
    const api = this.api
    if (!api) return
    api.stop()
    api.playbackRange = null
    this.resetMixer()
    this.dropEditing()
    this.update({ ...this.blank(), canPlay: this.snapshot.canPlay })
  }

  // The synthesizer keeps volume, mute and solo per MIDI channel, and every song numbers its channels from
  // zero again. Whatever the previous song set would carry over to whichever track of the next song lands on
  // the same channel (a track soloed in one song kept the next song soloed, with no button lit), so put every
  // channel of the outgoing song back to normal before the next one is loaded.
  private resetMixer() {
    const api = this.api
    const tracks = api?.score?.tracks
    if (!api || !tracks || tracks.length === 0) return
    api.changeTrackSolo(tracks, false)
    api.changeTrackMute(tracks, false)
    api.changeTrackVolume(tracks, 1)
  }

  /** Sends the whole mixer to the synthesizer: each track's volume (the shown one louder), mute and solo. */
  private applyMixer() {
    const api = this.api
    const score = api?.score
    if (!api || !score) return
    for (const info of this.snapshot.tracks) {
      const track = score.tracks[info.index]
      if (!track) continue
      api.changeTrackVolume([track], this.effectiveVolume(info))
      api.changeTrackMute([track], info.mute)
      api.changeTrackSolo([track], info.solo)
    }
  }

  private effectiveVolume(info: TrackInfo): number {
    return info.volume * (info.index === this.snapshot.trackIndex ? 1 : BACKGROUND_TRACK_LEVEL)
  }

  private onScoreLoaded(score: alphaTab.model.Score) {
    const api = this.api
    if (!api) return
    this.applyStaffVisibility(score)
    if (this.swapping) {
      // Same song re-rendered: the practice setup stays; only names may have changed through a track edit.
      this.swapping = false
      this.refreshTrackNames(score)
      return
    }
    const practice = this.pending?.practice ?? {}
    const trackIndex = clamp(practice.trackIndex ?? this.snapshot.trackIndex, 0, Math.max(0, score.tracks.length - 1))
    const speed = clamp(practice.speed ?? 1, SPEED_MIN, SPEED_MAX)
    const looping = practice.looping ?? false
    const metronome = practice.metronome ?? false

    api.playbackSpeed = speed
    // With a count-in between loops the player stops at the end of the loop and we restart it (onPlayerFinished).
    api.isLooping = looping && !this.snapshot.preferences.loopCountIn
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
        program: track.playbackInfo.program,
        volume: 1,
        mute: false,
        solo: false,
      })),
      sounding: [],
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

  // Colours, fonts and layout options. Sans-serif throughout, bold fret numbers, grey secondary marks.
  private applyLook(settings: alphaTab.Settings) {
    const colors = SCORE_COLORS[this.display.dark ? 'dark' : 'light']
    const color = (rgba: Rgba) => new alphaTab.model.Color(rgba[0], rgba[1], rgba[2], rgba[3])
    const font = (size: number, weight = PLAIN) => alphaTab.model.Font.withFamilyList(SANS, size, PLAIN, weight)
    const resources = settings.display.resources
    resources.mainGlyphColor = color(colors.main)
    resources.scoreInfoColor = color(colors.main)
    resources.secondaryGlyphColor = color(colors.secondary)
    resources.staffLineColor = color(colors.staffLine)
    resources.barSeparatorColor = color(colors.barSeparator)
    resources.barNumberColor = color(colors.barNumber)
    resources.tablatureFont = font(13, BOLD)
    resources.graceFont = font(10, BOLD)
    resources.effectFont = font(11)
    resources.markerFont = font(13, BOLD)
    resources.barNumberFont = font(11)
    resources.titleFont = font(26, BOLD)
    resources.subTitleFont = font(16)

    const preferences = this.snapshot.preferences
    settings.display.scale = this.display.zoom * ZOOM_BASE
    settings.display.barsPerRow = preferences.fourBarsPerLine ? 4 : -1
    settings.notation.elements.set(alphaTab.NotationElement.EffectDynamics, preferences.showDynamics)
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

  // For the "sounding" dots in the track list: which audible tracks have a note at the current position.
  private updateSounding(tick: number) {
    const api = this.api
    const score = api?.score
    const bars = api?.tickCache?.masterBars
    if (!api || !score || !bars) return
    if (this.soundingMap?.score !== score) this.soundingMap = { score, spans: buildSoundingSpans(score) }
    const lookup = bars.find((bar) => tick >= bar.start && tick < bar.end)
    const sounding: number[] = []
    if (lookup) {
      const offset = tick - lookup.start
      const tracks = this.snapshot.tracks
      const anySolo = tracks.some((track) => track.solo)
      for (const track of tracks) {
        if (track.mute || track.volume === 0 || (anySolo && !track.solo)) continue
        const spans = this.soundingMap.spans[track.index]?.[lookup.masterBar.index] ?? []
        if (spans.some((span) => offset >= span.start && offset < span.end)) sounding.push(track.index)
      }
    }
    const previous = this.snapshot.sounding
    if (sounding.length !== previous.length || sounding.some((index, position) => index !== previous[position])) this.update({ sounding })
  }

  // Reached the end of the loop with "count-in between loops" on: alphaTab is not looping by itself in that
  // mode, so it has stopped at the start of the range; count in and go again.
  private onPlayerFinished(api: alphaTab.AlphaTabApi) {
    if (!this.snapshot.looping || !this.snapshot.preferences.loopCountIn || this.api !== api) return
    this.startCountIn(api)
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
    // While editing, play what is written now, from the beat under the edit cursor.
    if (this.snapshot.editing) this.syncEditedMidi(true)
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
    const run = playCountIn(beats, secondsPerBeat(bar.tempo * this.snapshot.speed, denominator), this.snapshot.masterVolume)
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
    if (this.api) this.api.isLooping = looping && !this.snapshot.preferences.loopCountIn
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

  /** Overall volume, 0..1, for every track at once. Remembered across songs and visits. */
  setMasterVolume(volume: number) {
    const value = clamp(Math.round(volume * 100) / 100, 0, 1)
    if (this.api) this.api.masterVolume = value
    writeStorage(VOLUME_STORAGE_KEY, value)
    this.update({ masterVolume: value })
  }

  setPreferences(changes: Partial<Preferences>) {
    const preferences = cleanPreferences({ ...this.snapshot.preferences, ...changes })
    const layoutChanged =
      preferences.fourBarsPerLine !== this.snapshot.preferences.fourBarsPerLine || preferences.showDynamics !== this.snapshot.preferences.showDynamics
    writeStorage(PREFERENCES_STORAGE_KEY, preferences)
    this.update({ preferences })
    if (this.api) this.api.isLooping = this.snapshot.looping && !preferences.loopCountIn
    if (layoutChanged) this.applyDisplay()
  }

  /** Tempo and time signature of the stand-alone metronome; applies at once if it is running. */
  setFreeMetronome(changes: Partial<MetronomeSettings>) {
    const settings = cleanMetronome({ ...this.snapshot.freeMetronome, ...changes })
    this.freeMetronome.configure(settings)
    writeStorage(METRONOME_STORAGE_KEY, settings)
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
    const value = clamp(Math.round(semitones), TRANSPOSE_MIN, TRANSPOSE_MAX)
    if (value === this.snapshot.transpose || this.snapshot.editing) return
    this.rerender(value, this.snapshot.trackEdits)
  }

  /** How a track looks as loaded (without edits), to fill in the edit form. */
  originalTrackSetup(index: number): TrackSetup | null {
    return this.originalScore ? trackSetup(this.originalScore, index) : null
  }

  // Names and instruments in the track list, after a track edit; the mixer settings stay.
  private refreshTrackNames(score: alphaTab.model.Score) {
    this.update({
      tracks: this.snapshot.tracks.map((track) => ({
        ...track,
        name: score.tracks[track.index]?.name || track.name,
        program: score.tracks[track.index]?.playbackInfo.program ?? track.program,
      })),
    })
  }

  /** How a track looks now (with edits, without transposition). */
  currentTrackSetup(index: number): TrackSetup | null {
    return this.baseScore ? trackSetup(this.baseScore, index) : null
  }

  /**
   * Applies (or with null, removes) the edit of one track. Returns how many notes had to move or go.
   * While the tab is being edited the edit is relative to the track as it stands, and becomes a step of the
   * tab editor (undone with it, saved with it); otherwise it is relative to the song as loaded.
   */
  setTrackEdit(index: number, edit: TrackEdit | null): number {
    const api = this.api
    if (!api || !this.originalScore) return 0
    if (this.snapshot.editing) return edit ? this.editTrack(index, edit) : 0
    const trackEdits = { ...this.snapshot.trackEdits }
    if (edit) trackEdits[index] = edit
    else delete trackEdits[index]
    const result = this.rerender(this.snapshot.transpose, trackEdits)
    return result?.notesMoved ?? 0
  }

  // Builds the score from the original with the given edits and transposition and renders it in place of the
  // current one, keeping the practice setup (position, loop range, mixer).
  private rerender(transpose: number, trackEdits: TrackEdits): { notesMoved: number } | null {
    const api = this.api
    const original = this.originalScore
    if (!api || !original || this.snapshot.status !== 'ready') return null
    this.cancelCountIn()
    let notesMoved = 0
    if (trackEdits !== this.snapshot.trackEdits) {
      const edited = applyTrackEdits(original, trackEdits, api.settings)
      this.baseScore = edited.score
      notesMoved = edited.notesMoved
    }
    const base = this.baseScore ?? original
    const shown = transpose === 0 ? { score: base, outOfRange: 0 } : transposeScore(base, transpose, api.settings)
    // Rendering another score loads new MIDI, which stops playback and resets the position, the loop range
    // and the mixer; applyPending() puts them back once the new score is ready. When the previous change is
    // still on its way (two quick steps), what it was going to restore is still the truth.
    const restoring = this.pendingTick !== null
    this.pendingRange = restoring ? this.pendingRange : this.snapshot.range
    this.pendingTick = restoring ? this.pendingTick : api.tickPosition
    this.pendingMixer = true
    this.swapping = true
    this.renderPending = true
    this.update({ transpose, transposeOutOfRange: shown.outOfRange, trackEdits, sounding: [] })
    api.renderScore(shown.score, [this.snapshot.trackIndex])
    return { notesMoved }
  }

  /** Plays the open strings and then a strum on the given instrument, so a sound can be tried before applying. */
  previewInstrument(program: number, tuning: number[]) {
    const api = this.api
    const player = api?.player
    if (!api || !player || !this.snapshot.canPlay || api.playerState === alphaTab.synth.PlayerState.Playing) return
    const midiFile = new alphaTab.midi.MidiFile()
    const generator = new alphaTab.midi.MidiFileGenerator(buildPreviewScore(program, tuning), api.settings, new alphaTab.midi.AlphaSynthMidiFileHandler(midiFile))
    generator.generate()
    player.playOneTimeMidiFile(midiFile)
  }

  /** Shows another track of the same song; playback and cursor position are kept. */
  selectTrack(index: number) {
    const track = this.track(index)
    if (!this.api || !track || index === this.snapshot.trackIndex) return
    this.api.renderTracks([track])
    this.update({ trackIndex: index })
    // The newly shown track becomes the louder one.
    this.applyMixer()
    if (this.snapshot.editing) this.publishEditing(false)
  }

  // ---- tab editor ----

  private get editor(): TabEditor | null {
    return this.editorFor(this.snapshot.trackIndex)
  }

  private editorFor(index: number): TabEditor | null {
    if (!this.snapshot.editing && this.editors.size === 0) return null
    const score = this.baseScore
    if (!score || !this.api) return null
    let editor = this.editors.get(index)
    if (!editor || editor.score !== score) {
      const bar = this.currentBar()?.masterBar.index ?? 0
      editor = new TabEditor(score, index, this.api.settings, { bar })
      this.editors.set(index, editor)
    }
    return editor
  }

  /** Opens the editor on the shown track, at the bar playback is in. The tab is edited untransposed. */
  startEditing() {
    const api = this.api
    if (!api || this.snapshot.status !== 'ready' || this.snapshot.editing || !this.baseScore) return
    this.cancelCountIn()
    api.pause()
    this.transposeBeforeEditing = this.snapshot.transpose
    if (this.snapshot.transpose !== 0) this.rerender(0, this.snapshot.trackEdits)
    this.editors.clear()
    this.midiStale = false
    // A placeholder so the getter knows editing is on; publishEditing fills it in.
    this.editSelected = false
    this.update({ editing: { editable: false, selected: false, noteBox: null, beatBox: null } as unknown as EditingState })
    this.publishEditing(true)
  }

  /** True when anything was changed since editing started (or was last saved). */
  get editDirty(): boolean {
    return [...this.editors.values()].some((editor) => editor.state().dirty)
  }

  /** The tab as it now stands, as a Guitar Pro 7 file, for saving. */
  editedFile(): Uint8Array | null {
    const api = this.api
    if (!api || !this.baseScore) return null
    return new alphaTab.exporter.Gp7Exporter().export(this.baseScore, api.settings)
  }

  /**
   * Closes the editor. Saved: the edited tab becomes the song's tab (with the track edits baked in, so those
   * are cleared). Not saved: every edit is undone. Either way the earlier transposition comes back.
   */
  endEditing(saved: boolean) {
    const api = this.api
    if (!api || !this.snapshot.editing) return
    if (saved) {
      for (const editor of this.editors.values()) editor.markSaved()
      if (this.baseScore) this.originalScore = this.baseScore
    } else {
      for (const editor of this.editors.values()) {
        while (editor.undo()) {
          // back to where editing started
        }
      }
      if (this.editors.size > 0) this.renderEdited()
    }
    const trackEdits = saved ? {} : this.snapshot.trackEdits
    this.editors.clear()
    this.update({ editing: null, trackEdits })
    if (this.transposeBeforeEditing !== 0) {
      this.midiStale = false
      this.rerender(this.transposeBeforeEditing, trackEdits)
    } else {
      this.syncEditedMidi(false)
    }
  }

  // The layout is made in a Web Worker from its own copy of the score, and api.render() only lays that copy
  // out again. After an edit the changed score has to be sent over; going through the renderer directly does
  // that without making the player reload anything.
  private renderEdited() {
    const api = this.api
    if (!api?.score) return
    api.renderer.renderScore(api.score, [this.snapshot.trackIndex])
  }

  private dropEditing() {
    this.editors.clear()
    this.midiStale = false
    if (this.snapshot.editing) this.update({ editing: null })
  }

  /** Runs one editor command; re-renders and marks the MIDI stale when the tab changed. */
  edit(command: (editor: TabEditor) => void) {
    const editor = this.editor
    const api = this.api
    if (!editor || !api) return
    // The first key press before anything was clicked just picks the spot the editor opened at.
    if (!this.editSelected) {
      this.editSelected = true
      this.publishEditing(true)
      return
    }
    const revision = editor.revision
    command(editor)
    const changed = editor.revision !== revision
    if (changed) {
      this.midiStale = true
      this.renderEdited()
      // An undone track edit brings back the old name and instrument.
      this.refreshTrackNames(editor.score)
    }
    this.publishEditing(!changed)
  }

  // A track edit while editing the tab: applied to the tab as it stands, as one step of that track's editor.
  // Playing on, the new sound is heard straight away.
  private editTrack(index: number, edit: TrackEdit): number {
    const api = this.api
    const editor = this.editorFor(index)
    const score = this.baseScore
    if (!api || !editor || !score) return 0
    const result = applyTrackEdits(score, { [index]: edit }, api.settings)
    if (result.score === score) return 0
    const revision = editor.revision
    editor.replaceTrack(result.score)
    if (editor.revision === revision) return 0
    this.midiStale = true
    this.renderEdited()
    this.refreshTrackNames(score)
    if (api.playerState === alphaTab.synth.PlayerState.Playing) {
      this.syncEditedMidi(false)
      api.play()
    }
    this.publishEditing(false)
    return result.notesMoved
  }

  /** Closes the floating edit panel; editing goes on and the next click picks a new spot. */
  deselect() {
    if (!this.snapshot.editing || !this.editSelected) return
    this.editSelected = false
    this.publishEditing(false)
  }

  typeFret(digit: number) {
    this.edit((editor) => editor.typeDigit(digit))
  }

  toggleNoteFlag(flag: Flag) {
    this.edit((editor) => editor.toggle(flag))
  }

  /** Puts the edit cursor where the score was clicked: the beat under the pointer and the nearest string. */
  editClickAt(clientX: number, clientY: number) {
    const api = this.api
    const editor = this.editor
    const host = this.host
    const lookup = api?.boundsLookup
    if (!api || !editor || !host || !lookup) return
    const origin = host.getBoundingClientRect()
    const x = clientX - origin.left
    const y = clientY - origin.top
    let beat = lookup.getBeatAtPos(x, y)
    if (!beat || beat.voice.bar.staff.track.index !== editor.trackIndex) return
    if (beat.voice.index !== 0) {
      // Clicks on a second voice go to the first-voice beat that sounds at that moment.
      const first = beat.voice.bar.voices[0].beats
      beat = [...first].reverse().find((item) => item.displayStart <= beat!.displayStart) ?? first[0]
    }
    const bounds = lookup.findBeat(beat)
    let string = editor.cursor.string
    if (bounds) {
      const lines = this.stringLines(bounds.barBounds, editor)
      string = Math.round((lines.lowest - y) / lines.spacing) + 1
    }
    editor.moveTo({ bar: beat.voice.bar.index, beat: beat.index, string })
    this.editSelected = true
    this.publishEditing(true)
  }

  // Loads the MIDI for the edited tab when it is out of date, putting back what that resets.
  private syncEditedMidi(fromCursor: boolean) {
    const api = this.api
    if (!api || !this.midiStale) return
    this.midiStale = false
    const tick = api.tickPosition
    api.loadMidiForScore()
    this.applyMixer()
    if (this.snapshot.range) {
      try {
        api.playbackRange = this.snapshot.range
      } catch {
        // the range no longer fits the edited tab
      }
    }
    const editor = this.editor
    const start = fromCursor && editor ? this.tickOf(editor) : null
    api.tickPosition = start ?? tick
  }

  /** Where the beat under the edit cursor starts in the MIDI (its first time through). */
  private tickOf(editor: TabEditor): number | null {
    const bar = this.api?.tickCache?.masterBars.find((item) => item.masterBar.index === editor.cursor.bar)
    return bar ? bar.start + editor.beat.playbackStart : null
  }

  // Sends the editor state (and where to draw its cursor) to the UI.
  private publishEditing(scroll: boolean) {
    const editor = this.editor
    if (!editor) {
      this.update({ editing: null })
      return
    }
    const boxes = this.editSelected ? this.measureCursor(editor) : { noteBox: null, beatBox: null }
    this.update({ editing: { ...editor.state(), editable: editor.editable, selected: this.editSelected, ...boxes } })
    if (scroll && boxes.beatBox) this.revealBox(boxes.beatBox)
  }

  private measureCursor(editor: TabEditor): { noteBox: Box | null; beatBox: Box | null } {
    const bounds = this.api?.boundsLookup?.findBeat(editor.beat)
    if (!bounds) return { noteBox: null, beatBox: null }
    const { lowest, spacing } = this.stringLines(bounds.barBounds, editor)
    const lineY = lowest - (editor.cursor.string - 1) * spacing
    const top = lowest - (editor.stringCount - 1) * spacing
    const column = bounds.visualBounds
    const width = Math.max(column.w + 8, spacing * 1.4)
    return {
      noteBox: { x: column.x + column.w / 2 - width / 2, y: lineY - spacing * 0.6, w: width, h: spacing * 1.2 },
      beatBox: { x: bounds.realBounds.x, y: top - spacing * 0.8, w: bounds.realBounds.w, h: lowest - top + spacing * 1.6 },
    }
  }

  // Where the strings of a staff are drawn: the y of the lowest string and the distance between two. alphaTab
  // does not say; the bar's bounds also take in the effects over the staff (P.M., bends…). So this is fitted to
  // the note heads of the whole line, which share the same strings. Remembered for lines without notes.
  private measuredSpacing: number | null = null
  private stringLines(barBounds: alphaTab.rendering.BarBounds, editor: TabEditor): { lowest: number; spacing: number } {
    // (The bounds sent back by the layout worker do not link to their bars; the notes do.)
    const staff = editor.staff
    const heights = new Map<number, number[]>()
    const masters = barBounds.masterBarBounds.staffSystemBounds?.bars ?? [barBounds.masterBarBounds]
    for (const master of masters) {
      for (const bar of master.bars) {
        for (const beat of bar.beats) {
          for (const note of beat.notes ?? []) {
            if (note.note.beat.voice.bar.staff !== staff) continue
            const head = note.noteHeadBounds
            heights.set(note.note.string, [...(heights.get(note.note.string) ?? []), head.y + head.h / 2])
          }
        }
      }
    }
    const strings = [...heights.keys()].sort((a, b) => a - b)
    const at = (string: number) => {
      const values = heights.get(string)!
      return values.reduce((sum, value) => sum + value, 0) / values.length
    }
    if (strings.length >= 2) {
      const low = strings[0]
      const high = strings[strings.length - 1]
      this.measuredSpacing = (at(low) - at(high)) / (high - low)
    }
    const bar = barBounds.visualBounds
    const spacing = this.measuredSpacing ?? bar.h / Math.max(1, editor.stringCount - 1)
    if (strings.length) return { lowest: at(strings[0]) + (strings[0] - 1) * spacing, spacing }
    return { lowest: bar.y + bar.h, spacing }
  }

  // Scrolls the score so the edit cursor is on screen.
  private revealBox(box: Box) {
    const host = this.host
    const scroller = this.scroller
    if (!host || !scroller) return
    const origin = host.getBoundingClientRect()
    const view = scroller.getBoundingClientRect()
    const margin = 20
    const top = origin.top + box.y
    const bottom = top + box.h
    if (top < view.top + margin) scroller.scrollBy({ top: top - view.top - margin })
    else if (bottom > view.bottom) scroller.scrollBy({ top: bottom - view.bottom + 40 })
  }

  setTrackVolume(index: number, volume: number) {
    const value = clamp(volume, 0, 1)
    this.patchTrack(index, { volume: value })
    const track = this.track(index)
    const info = this.snapshot.tracks.find((item) => item.index === index)
    if (this.api && track && info) this.api.changeTrackVolume([track], this.effectiveVolume(info))
  }

  /** The volume the synthesizer plays a track at, including the lift of the shown track. For the checks. */
  effectiveTrackVolume(index: number): number {
    const info = this.snapshot.tracks.find((item) => item.index === index)
    return info ? this.effectiveVolume(info) : 0
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
    this.applyLook(api.settings)
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
    this.applyLook(api.settings)
    api.print()
    this.display.dark = true
    this.applyLook(api.settings)
  }

  /** The song as shown (including edits and transposition) as a Guitar Pro 7 file, or null when nothing is loaded. */
  exportGuitarPro(): Uint8Array | null {
    const api = this.api
    if (!api?.score) return null
    return new alphaTab.exporter.Gp7Exporter().export(api.score, api.settings)
  }
}

function buildSoundingSpans(score: alphaTab.model.Score): SoundingSpan[][][] {
  return score.tracks.map((track) =>
    track.staves[0].bars.map((bar) => {
      const spans: SoundingSpan[] = []
      for (const staff of track.staves) {
        for (const voice of staff.bars[bar.index]?.voices ?? []) {
          for (const beat of voice.beats) {
            if (beat.notes.length === 0 || beat.isEmpty) continue
            spans.push({ start: beat.playbackStart, end: beat.playbackStart + Math.max(beat.playbackDuration, 1) })
          }
        }
      }
      return spans
    }),
  )
}

// One bar of eighth notes up the open strings, then a held chord of all of them.
function buildPreviewScore(program: number, tuning: number[]): alphaTab.model.Score {
  const { model } = alphaTab
  const score = new model.Score()
  const strings = tuning.length > 0 ? tuning : [64, 59, 55, 50, 45, 40]
  for (let index = 0; index < 2; index++) {
    const masterBar = new model.MasterBar()
    masterBar.timeSignatureNumerator = Math.max(4, Math.ceil(strings.length / 2))
    masterBar.timeSignatureDenominator = 4
    if (index === 0) masterBar.tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0, 140, 2))
    score.addMasterBar(masterBar)
  }
  const track = new model.Track()
  track.ensureStaveCount(1)
  track.playbackInfo.program = program
  track.playbackInfo.primaryChannel = 0
  track.playbackInfo.secondaryChannel = 1
  const staff = track.staves[0]
  staff.stringTuning = new model.Tuning('', strings, false)
  score.addTrack(track)

  const noteOn = (string: number) => {
    const note = new model.Note()
    note.string = string
    note.fret = 0
    return note
  }
  const beats = (bar: alphaTab.model.Bar, fill: (voice: alphaTab.model.Voice) => void) => {
    const voice = new model.Voice()
    bar.addVoice(voice)
    fill(voice)
  }
  const up = new model.Bar()
  staff.addBar(up)
  beats(up, (voice) => {
    const count = up.masterBar.timeSignatureNumerator * 2
    for (let index = 0; index < count; index++) {
      const beat = new model.Beat()
      beat.duration = model.Duration.Eighth
      if (index < strings.length) beat.addNote(noteOn(index + 1))
      voice.addBeat(beat)
    }
  })
  const chord = new model.Bar()
  staff.addBar(chord)
  beats(chord, (voice) => {
    const beat = new model.Beat()
    beat.duration = model.Duration.Whole
    beat.brushType = model.BrushType.BrushDown
    beat.brushDuration = 120
    for (let string = 1; string <= strings.length; string++) beat.addNote(noteOn(string))
    voice.addBeat(beat)
  })
  score.finish(new alphaTab.Settings())
  return score
}

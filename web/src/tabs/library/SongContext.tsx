import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as api from '../api.ts'
import type { PracticeSettings, Song } from '../api.ts'
import { usePlayer } from '../player/usePlayer.ts'
import { translate } from '../../shared/ui/i18n.ts'
import { SongContext, type SongContextValue } from './useSong.ts'
import { keepsSong as pageKeepsSong } from '../../shared/useView.ts'
import { playlistQueue, setPlaylistQueue } from './playlistQueue.ts'

const SAVE_DELAY_MS = 500

function songIdFromHash(): number | null {
  const match = /^#\/song\/(\d+)$/.exec(window.location.hash)
  return match ? Number(match[1]) : null
}

export function SongProvider({ children }: { children: ReactNode }) {
  const { state, player } = usePlayer()
  const [song, setSong] = useState<Song | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [libraryVersion, setLibraryVersion] = useState(0)
  const libraryChanged = useCallback(() => setLibraryVersion((version) => version + 1), [])
  // Guards against an older, slower request finishing after a newer one.
  const requestId = useRef(0)
  const lastSaved = useRef('')
  // The song in the player, by id: going to the tone editor and back keeps it as it is.
  const loadedId = useRef<number | null>(null)
  // The song to start playing once loaded (open with `play`).
  const playOnLoad = useRef<number | null>(null)

  const load = useCallback(
    async (id: number) => {
      const request = ++requestId.current
      setOpening(true)
      setError(null)
      try {
        const opened = await api.openSong(id)
        const practice = { ...opened.settings, trackIndex: opened.settings.trackIndex ?? opened.defaultTrack }
        // A song changed in the tab editor opens as its edited copy (a Guitar Pro file).
        const source = opened.edited
          ? ({ kind: 'file', bytes: await api.getEditedSong(id) } as const)
          : opened.source === 'songsterr'
            ? ({ kind: 'songsterr', info: opened, tracks: await api.getSongTracks(id) } as const)
            : ({ kind: 'file', bytes: await api.getSongFile(id) } as const)
        if (request !== requestId.current) return
        lastSaved.current = ''
        loadedId.current = id
        setSong(opened)
        player.load(source, practice, playOnLoad.current === id)
        playOnLoad.current = null
        libraryChanged()
      } catch (cause) {
        if (request !== requestId.current) return
        loadedId.current = null
        setSong(null)
        player.clear()
        setError((cause as Error).message)
      } finally {
        if (request === requestId.current) setOpening(false)
      }
    },
    [player, libraryChanged],
  )

  // The address bar is the source of truth for which song is open. Leaving a song with unsaved tab edits
  // asks first; saying no puts the address back.
  const shownHash = useRef(window.location.hash)
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash
      const id = songIdFromHash()
      // The tone editor and the stems keep the open song, and coming back to that song from them needs no reload.
      const keepsSong = pageKeepsSong(hash) || (id !== null && id === loadedId.current && pageKeepsSong(shownHash.current))
      if (hash !== shownHash.current && !keepsSong && player.editDirty && !window.confirm(translate('曲谱有未保存的修改，确定放弃并离开吗？'))) {
        history.replaceState(null, '', shownHash.current || '#/')
        return
      }
      shownHash.current = hash
      if (keepsSong) return
      if (id !== null) void load(id)
      else {
        requestId.current++
        loadedId.current = null
        setOpening(false)
        setSong(null)
        setError(null)
        player.clear()
      }
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [load, player])

  const open = useCallback(
    async (id: number, options: { play?: boolean } = {}) => {
      playOnLoad.current = options.play ? id : null
      const hash = `#/song/${id}`
      if (window.location.hash === hash) await load(id)
      else window.location.hash = hash
    },
    [load],
  )

  // Closing or reloading the page with unsaved tab edits asks the browser to confirm.
  const dirty = state.editing?.dirty ?? false
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const close = useCallback(() => {
    window.location.hash = '#/'
  }, [])

  // Remember the practice setup per song, a moment after it last changed.
  // Speed, count-in and metronome as set for practice (out of practice mode they are not in effect, but kept).
  const practice = useMemo<PracticeSettings>(
    () => ({
      speed: state.practice.speed,
      // The track picked by hand, not one a track switch shows for now.
      trackIndex: state.baseTrack,
      looping: state.looping,
      range: state.range,
      countIn: state.practice.countIn,
      metronome: state.practice.metronome,
      transpose: state.transpose,
      trackEdits: state.trackEdits,
      trackTones: state.trackTones,
      trackSounds: state.trackSounds,
      key: state.manualKey,
      trackSwitchesFrom: state.trackSwitches,
    }),
    [state.practice, state.baseTrack, state.looping, state.range, state.transpose, state.trackEdits, state.manualKey, state.trackTones, state.trackSounds, state.trackSwitches],
  )
  const songId = song?.id
  const ready = state.status === 'ready'
  useEffect(() => {
    if (songId === undefined || !ready) return
    const serialized = JSON.stringify(practice)
    if (lastSaved.current === '') {
      // First settled state after opening: this is what was just restored, nothing to write.
      lastSaved.current = serialized
      return
    }
    if (serialized === lastSaved.current) return
    const timer = setTimeout(() => {
      lastSaved.current = serialized
      api.updateSong(songId, { settings: practice }).catch((cause) => console.error(cause))
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [songId, ready, practice])

  // Uploaded files only get their real title, artist and track count once alphaTab has parsed them.
  useEffect(() => {
    if (!song || song.source !== 'file' || !ready || song.trackCount > 0) return
    const changes = { title: state.title || song.title, artist: state.artist, trackCount: state.tracks.length }
    api
      .updateSong(song.id, changes)
      .then((updated) => {
        setSong((current) => (current?.id === updated.id ? updated : current))
        libraryChanged()
      })
      .catch((cause) => console.error(cause))
  }, [song, ready, state.title, state.artist, state.tracks.length, libraryChanged])

  // A playlist being played through: at the end of its song the next one opens and plays; after the last, it stops.
  // Any other song open (picked from the list, searched) leaves the playlist.
  const songRef = useRef(song)
  useEffect(() => {
    songRef.current = song
  }, [song])
  useEffect(
    () =>
      player.onFinished(() => {
        const queue = playlistQueue()
        if (!queue) return
        const next = queue.index + 1
        if (songRef.current?.id !== queue.songIds[queue.index] || next >= queue.songIds.length) {
          setPlaylistQueue(null)
          return
        }
        setPlaylistQueue({ ...queue, index: next })
        void open(queue.songIds[next], { play: true })
      }),
    [player, open],
  )

  const value = useMemo<SongContextValue>(
    () => ({ song, opening, error, open, close, replace: setSong, libraryVersion, libraryChanged }),
    [song, opening, error, open, close, libraryVersion, libraryChanged],
  )
  return <SongContext.Provider value={value}>{children}</SongContext.Provider>
}

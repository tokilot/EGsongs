import { CircleHelp, ExternalLink, Guitar, Library, Music, Plus, Search, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import * as api from '../api/client.ts'
import type { Song, SongsterrHit } from '../api/client.ts'
import { SongList } from '../library/SongList.tsx'
import { useSong } from '../library/useSong.ts'
import { usePlayer } from '../player/usePlayer.ts'
import { TrackList } from '../player/TrackList.tsx'
import { Popover } from '../ui/Popover.tsx'
import { SHORTCUTS } from './shortcuts.ts'
import styles from './TopBar.module.css'

type PanelId = 'search' | 'library' | 'new' | 'help' | 'tracks'

const SEARCH_DELAY_MS = 350

export function TopBar() {
  const { state } = usePlayer()
  const { song, open, close: closeSong, replace, libraryChanged } = useSong()
  const [panel, setPanel] = useState<PanelId | null>(null)
  const toggle = (id: PanelId) => setPanel((current) => (current === id ? null : id))
  const close = () => setPanel(null)

  const toggleFavorite = async () => {
    if (!song) return
    replace(await api.updateSong(song.id, { favorite: !song.favorite }))
    libraryChanged()
  }

  return (
    <header className={styles.topBar}>
      <a
        className={styles.logo}
        href="#/"
        aria-label="曲库首页"
        onClick={(event) => {
          event.preventDefault()
          closeSong()
        }}
      >
        <Music size={22} aria-hidden />
        <span>Tabs</span>
      </a>

      <SearchBox
        open={panel === 'search'}
        onOpen={() => setPanel('search')}
        onClose={close}
        onPick={(id) => {
          close()
          void open(id)
        }}
      />

      <nav className={styles.nav} aria-label="目录">
        <Popover
          open={panel === 'library'}
          onClose={close}
          placement="below"
          align="start"
          label="我的曲谱"
          trigger={
            <button type="button" className={styles.navButton} aria-expanded={panel === 'library'} onClick={() => toggle('library')}>
              <Library size={18} aria-hidden />
              <span>我的曲谱</span>
            </button>
          }
        >
          <SongList onPick={close} />
        </Popover>

        <Popover
          open={panel === 'new'}
          onClose={close}
          placement="below"
          align="start"
          label="新建"
          trigger={
            <button type="button" className={styles.navButton} aria-expanded={panel === 'new'} onClick={() => toggle('new')}>
              <Plus size={18} aria-hidden />
              <span>新建</span>
            </button>
          }
        >
          <NewSong
            onDone={(id) => {
              close()
              libraryChanged()
              void open(id)
            }}
          />
        </Popover>

        <Popover
          open={panel === 'help'}
          onClose={close}
          placement="below"
          align="start"
          label="帮助"
          trigger={
            <button type="button" className={styles.navButton} aria-expanded={panel === 'help'} onClick={() => toggle('help')}>
              <CircleHelp size={18} aria-hidden />
              <span>帮助</span>
            </button>
          }
        >
          <div className={styles.help}>
            <h2>快捷键</h2>
            <dl>
              {SHORTCUTS.map((shortcut) => (
                <div key={shortcut.keys}>
                  <dt>
                    <kbd>{shortcut.keys}</kbd>
                  </dt>
                  <dd>{shortcut.label}</dd>
                </div>
              ))}
            </dl>
            <p>在谱面上点击一拍可把光标移到那里；按住拖动选出一段作为循环区间。</p>
          </div>
        </Popover>
      </nav>

      <div className={styles.song}>
        {song && (
          <>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={song.favorite ? '取消收藏' : '收藏'}
              aria-pressed={song.favorite}
              title={song.favorite ? '取消收藏' : '收藏'}
              onClick={() => void toggleFavorite()}
            >
              <Star size={18} aria-hidden fill={song.favorite ? 'currentColor' : 'none'} />
            </button>
            <div className={styles.songTitle}>
              <span className={styles.title}>{state.title || song.title}</span>
              <span className={styles.artist}>
                {state.artist || song.artist || song.fileName}
                {song.sourceUrl && (
                  <a href={song.sourceUrl} target="_blank" rel="noreferrer" title="在 Songsterr 上打开" aria-label="在 Songsterr 上打开">
                    <ExternalLink size={12} aria-hidden />
                  </a>
                )}
              </span>
            </div>
          </>
        )}
        <Popover
          open={panel === 'tracks'}
          onClose={close}
          placement="below"
          align="end"
          label="乐器"
          trigger={
            <button
              type="button"
              className={styles.navButton}
              disabled={state.status !== 'ready'}
              aria-expanded={panel === 'tracks'}
              onClick={() => toggle('tracks')}
            >
              <Guitar size={18} aria-hidden />
              <span>{state.tracks.find((track) => track.index === state.trackIndex)?.name ?? '乐器'}</span>
            </button>
          }
        >
          <TrackList />
        </Popover>
      </div>
    </header>
  )
}

interface SearchBoxProps {
  open: boolean
  onOpen: () => void
  onClose: () => void
  onPick: (songId: number) => void
}

/** One box for both sources: the local library answers at once, Songsterr a moment later. */
function SearchBox({ open, onOpen, onClose, onPick }: SearchBoxProps) {
  const { libraryChanged } = useSong()
  const [query, setQuery] = useState('')
  // Results are kept with the query they answer, so answers to an older query are never shown.
  const [localResult, setLocalResult] = useState<{ query: string; songs: Song[] }>({ query: '', songs: [] })
  const [remoteResult, setRemoteResult] = useState<{ query: string; hits: SongsterrHit[] | null; error: string | null }>({
    query: '',
    hits: null,
    error: null,
  })
  const [importing, setImporting] = useState<number | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const trimmed = query.trim()

  const local = localResult.query === trimmed ? localResult.songs : []
  const remote = remoteResult.query === trimmed ? remoteResult.hits : null
  const remoteError = remoteResult.query === trimmed ? remoteResult.error : null

  useEffect(() => {
    if (!trimmed) return
    const abort = new AbortController()
    let cancelled = false
    api
      .listSongs({ query: trimmed })
      .then((songs) => !cancelled && setLocalResult({ query: trimmed, songs }))
      .catch(() => !cancelled && setLocalResult({ query: trimmed, songs: [] }))
    // Wait for a pause in typing before asking Songsterr.
    const timer = setTimeout(() => {
      api
        .searchSongsterr(trimmed, abort.signal)
        .then((hits) => !cancelled && setRemoteResult({ query: trimmed, hits, error: null }))
        .catch((cause) => !cancelled && setRemoteResult({ query: trimmed, hits: null, error: (cause as Error).message }))
    }, SEARCH_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      abort.abort()
    }
  }, [trimmed])

  const importHit = async (hit: SongsterrHit) => {
    setImporting(hit.songId)
    setImportError(null)
    try {
      const song = await api.importSongsterr(String(hit.songId))
      libraryChanged()
      setQuery('')
      onPick(song.id)
    } catch (cause) {
      setImportError((cause as Error).message)
    } finally {
      setImporting(null)
    }
  }

  const localIds = new Set(local.map((song) => song.songsterrId))
  const remoteOnly = remote?.filter((hit) => !localIds.has(hit.songId)) ?? null

  return (
    <Popover
      open={open && trimmed !== ''}
      onClose={onClose}
      placement="below"
      align="start"
      label="搜索结果"
      trigger={
        <label className={styles.search}>
          <Search size={16} aria-hidden />
          <input
            ref={input}
            id="song-search"
            type="search"
            placeholder="搜索曲谱（本地曲库 + Songsterr）"
            aria-label="搜索曲谱"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              onOpen()
            }}
            onFocus={onOpen}
            onKeyDown={(event) => {
              if (event.key === 'Escape') input.current?.blur()
            }}
          />
        </label>
      }
    >
      <div className={styles.results}>
        {importError && <p className={styles.error}>{importError}</p>}

        <h2>我的曲库</h2>
        {local.length === 0 && <p className={styles.muted}>没有匹配的曲谱。</p>}
        <ul>
          {local.map((song) => (
            <li key={song.id}>
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  onPick(song.id)
                }}
              >
                <span className={styles.title}>{song.title}</span>
                <span className={styles.artist}>
                  {song.source === 'file' ? [song.artist, '本地文件'].filter(Boolean).join(' · ') : song.artist}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <h2>Songsterr</h2>
        {remoteError && <p className={styles.error}>{remoteError}</p>}
        {!remoteError && remoteOnly === null && <p className={styles.muted}>正在搜索…</p>}
        {remoteOnly?.length === 0 && <p className={styles.muted}>没有更多结果。</p>}
        <ul>
          {remoteOnly?.map((hit) => (
            <li key={hit.songId}>
              <button type="button" disabled={importing !== null} onClick={() => void importHit(hit)}>
                <span className={styles.title}>{hit.title}</span>
                <span className={styles.artist}>
                  {hit.artist}
                  {importing === hit.songId ? ' · 正在导入…' : ` · ${hit.trackCount} 条音轨`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Popover>
  )
}

/** "New": add a song from a local tab file or a Songsterr link. */
function NewSong({ onDone }: { onDone: (songId: number) => void }) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (task: () => Promise<Song>) => {
    setBusy(true)
    setError(null)
    try {
      onDone((await task()).id)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.newSong}>
      <h2>粘贴 Songsterr 链接</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (link.trim()) void run(() => api.importSongsterr(link.trim()))
        }}
      >
        <input
          type="url"
          placeholder="https://www.songsterr.com/a/wsa/…-tab-s12345"
          aria-label="Songsterr 链接"
          value={link}
          disabled={busy}
          onChange={(event) => setLink(event.target.value)}
        />
        <button type="submit" disabled={busy || !link.trim()}>
          导入
        </button>
      </form>

      <h2>上传本地文件</h2>
      <input
        type="file"
        aria-label="曲谱文件"
        accept=".gp,.gp3,.gp4,.gp5,.gpx,.xml,.musicxml,.mxl,.atex,.alphatex"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void run(() => api.uploadSong(file))
        }}
      />
      <p className={styles.muted}>支持 Guitar Pro、MusicXML 和 alphaTex。</p>

      {busy && <p className={styles.muted}>正在导入…</p>}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

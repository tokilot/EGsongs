import { CircleHelp, ExternalLink, Library, Music, PencilLine, Plus, Save, Search, Star, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as api from '../api/client.ts'
import type { Song, SongsterrHit } from '../api/client.ts'
import { SongList } from '../library/SongList.tsx'
import { useSong } from '../library/useSong.ts'
import { SAVE_EDITS_EVENT, useTabEditing } from '../library/useTabEditing.ts'
import { usePlayer } from '../player/usePlayer.ts'
import { useLanguage } from '../ui/i18n.ts'
import { Popover } from '../ui/Popover.tsx'
import { OPEN_SEARCH_EVENT, SHORTCUTS } from './shortcuts.ts'
import styles from './TopBar.module.css'

type PanelId = 'search' | 'library' | 'new' | 'help'

const SEARCH_DELAY_MS = 350

interface NavButtonProps {
  icon: LucideIcon
  label: string
  expanded?: boolean
  onClick: () => void
}

/** Icon above, label below. */
function NavButton({ icon: Icon, label, expanded, onClick }: NavButtonProps) {
  return (
    <button type="button" className={styles.navButton} aria-expanded={expanded} onClick={onClick}>
      <Icon size={20} aria-hidden />
      <span>{label}</span>
    </button>
  )
}

// Left: home, the open song and its star. Right: my tabs, new, search, help. The layout is the user's; the
// instrument picker lives in the control bar only (see CLAUDE.md, "顶栏").
export function TopBar() {
  const { state } = usePlayer()
  const { song, open, close: closeSong, replace, libraryChanged } = useSong()
  const { t } = useLanguage()
  const [panel, setPanel] = useState<PanelId | null>(null)
  const toggle = (id: PanelId) => setPanel((current) => (current === id ? null : id))
  const close = () => setPanel(null)

  // The "/" shortcut opens the search panel; its input takes the focus when it appears.
  useEffect(() => {
    const openSearch = () => setPanel('search')
    window.addEventListener(OPEN_SEARCH_EVENT, openSearch)
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, openSearch)
  }, [])

  const editing = useTabEditing()
  const { save } = editing
  // Ctrl+S while editing.
  useEffect(() => {
    const onSave = () => void save()
    window.addEventListener(SAVE_EDITS_EVENT, onSave)
    return () => window.removeEventListener(SAVE_EDITS_EVENT, onSave)
  }, [save])

  const toggleFavorite = async () => {
    if (!song) return
    replace(await api.updateSong(song.id, { favorite: !song.favorite }))
    libraryChanged()
  }

  const panelFor = (id: PanelId, icon: LucideIcon, label: string, content: ReactNode) => (
    <Popover
      open={panel === id}
      onClose={close}
      placement="below"
      align="end"
      label={label}
      trigger={<NavButton icon={icon} label={label} expanded={panel === id} onClick={() => toggle(id)} />}
    >
      {content}
    </Popover>
  )

  return (
    <header className={styles.topBar}>
      <a
        className={styles.navButton}
        href="#/"
        aria-label={t('曲库首页')}
        title={t('曲库首页')}
        onClick={(event) => {
          event.preventDefault()
          closeSong()
        }}
      >
        <Music size={20} aria-hidden />
        <span>Tabs</span>
      </a>

      {song && (
        <div className={styles.song}>
          <div className={styles.songTitle}>
            <span className={styles.title}>{state.title || song.title}</span>
            <span className={styles.artist}>
              {state.artist || song.artist || song.fileName}
              {song.sourceUrl && (
                <a href={song.sourceUrl} target="_blank" rel="noreferrer" title={t('在 Songsterr 上打开')} aria-label={t('在 Songsterr 上打开')}>
                  <ExternalLink size={12} aria-hidden />
                </a>
              )}
            </span>
          </div>
          <button
            type="button"
            className={styles.starButton}
            aria-label={song.favorite ? t('取消收藏') : t('收藏')}
            aria-pressed={song.favorite}
            title={song.favorite ? t('取消收藏') : t('收藏')}
            onClick={() => void toggleFavorite()}
          >
            <Star size={22} aria-hidden fill={song.favorite ? 'currentColor' : 'none'} />
          </button>
          {/* First click opens the tab editor, the second saves and closes it. */}
          <button
            type="button"
            className={styles.editButton}
            aria-label={editing.editing ? t('保存修改') : t('编辑曲谱')}
            aria-pressed={editing.editing}
            title={editing.editing ? t('保存修改') + ' (Ctrl+S)' : t('编辑曲谱')}
            disabled={!editing.canEdit || editing.busy}
            onClick={() => (editing.editing ? void editing.save() : editing.start())}
          >
            {editing.editing ? <Save size={21} aria-hidden /> : <PencilLine size={21} aria-hidden />}
          </button>
        </div>
      )}

      <nav className={styles.nav} aria-label={t('目录')}>
        {panelFor('library', Library, t('我的曲谱'), <SongList onPick={close} />)}
        {panelFor(
          'new',
          Plus,
          t('新建'),
          <NewSong
            onDone={(id) => {
              close()
              libraryChanged()
              void open(id)
            }}
          />,
        )}
        {panelFor(
          'search',
          Search,
          t('搜索曲谱'),
          <SearchPanel
            onPick={(id) => {
              close()
              void open(id)
            }}
          />,
        )}
        {panelFor(
          'help',
          CircleHelp,
          t('帮助'),
          <div className={styles.help}>
            <h2>{t('快捷键')}</h2>
            <dl>
              {SHORTCUTS.map((shortcut) => (
                <div key={shortcut.keys}>
                  <dt>
                    <kbd>{shortcut.keys}</kbd>
                  </dt>
                  <dd>{t(shortcut.label)}</dd>
                </div>
              ))}
            </dl>
            <p>{t('在谱面上点击一拍可把光标移到那里；按住拖动选出一段作为循环区间。')}</p>
          </div>,
        )}
      </nav>
    </header>
  )
}

/** One box for both sources: the local library answers at once, Songsterr a moment later. */
function SearchPanel({ onPick }: { onPick: (songId: number) => void }) {
  const { libraryChanged } = useSong()
  const { t } = useLanguage()
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

  useEffect(() => input.current?.focus(), [])

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
    <div className={styles.results}>
      <label className={styles.search}>
        <Search size={16} aria-hidden />
        <input
          ref={input}
          id="song-search"
          type="search"
          placeholder={t('搜索曲谱（本地曲库 + Songsterr）')}
          aria-label={t('搜索曲谱')}
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {importError && <p className={styles.error}>{importError}</p>}

      {trimmed && (
        <div role="region" aria-label={t('搜索结果')}>
          <h2>{t('我的曲库')}</h2>
          {local.length === 0 && <p className={styles.muted}>{t('没有匹配的曲谱。')}</p>}
          <ul>
            {local.map((song) => (
              <li key={song.id}>
                <button type="button" onClick={() => onPick(song.id)}>
                  <span className={styles.title}>{song.title}</span>
                  <span className={styles.artist}>
                    {song.source === 'file' ? [song.artist, t('本地文件')].filter(Boolean).join(' · ') : song.artist}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <h2>Songsterr</h2>
          {remoteError && <p className={styles.error}>{remoteError}</p>}
          {!remoteError && remoteOnly === null && <p className={styles.muted}>{t('正在搜索…')}</p>}
          {remoteOnly?.length === 0 && <p className={styles.muted}>{t('没有更多结果。')}</p>}
          <ul>
            {remoteOnly?.map((hit) => (
              <li key={hit.songId}>
                <button type="button" disabled={importing !== null} onClick={() => void importHit(hit)}>
                  <span className={styles.title}>{hit.title}</span>
                  <span className={styles.artist}>
                    {hit.artist}
                    {' · '}
                    {importing === hit.songId ? t('正在导入…') : t('{n} 条音轨', { n: hit.trackCount })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** "New": add a song from a local tab file or a Songsterr link. */
function NewSong({ onDone }: { onDone: (songId: number) => void }) {
  const { t } = useLanguage()
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
      <h2>{t('粘贴 Songsterr 链接')}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (link.trim()) void run(() => api.importSongsterr(link.trim()))
        }}
      >
        <input
          type="url"
          placeholder="https://www.songsterr.com/a/wsa/…-tab-s12345"
          aria-label={t('Songsterr 链接')}
          value={link}
          disabled={busy}
          onChange={(event) => setLink(event.target.value)}
        />
        <button type="submit" disabled={busy || !link.trim()}>
          {t('导入')}
        </button>
      </form>

      <h2>{t('上传本地文件')}</h2>
      <input
        type="file"
        aria-label={t('曲谱文件')}
        accept=".gp,.gp3,.gp4,.gp5,.gpx,.xml,.musicxml,.mxl,.atex,.alphatex"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void run(() => api.uploadSong(file))
        }}
      />
      <p className={styles.muted}>{t('支持 Guitar Pro、MusicXML 和 alphaTex。')}</p>

      {busy && <p className={styles.muted}>{t('正在导入…')}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

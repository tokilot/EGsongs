import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import * as api from '../api.ts'
import type { Song, SongsterrHit } from '../api.ts'
import { useLanguage } from '../../shared/ui/i18n.ts'
import { useSong } from './useSong.ts'
import styles from './panels.module.css'

const SEARCH_DELAY_MS = 350

/** One box for both sources: the local library answers at once, Songsterr a moment later. */
export function SearchPanel({ onPick }: { onPick: (songId: number) => void }) {
  const { libraryChanged } = useSong()
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  // Results are kept with the query they answer, so answers to an older query are never shown.
  const [localResult, setLocalResult] = useState<{
    query: string
    songs: Song[]
  }>({ query: '', songs: [] })
  const [remoteResult, setRemoteResult] = useState<{
    query: string
    hits: SongsterrHit[] | null
    error: string | null
  }>({
    query: '',
    hits: null,
    error: null,
  })
  const [importing, setImporting] = useState<number | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const trimmed = query.trim()
  // A pasted tab link is imported rather than searched for.
  const link = /^(https?:\/\/|www\.)\S+$/i.test(trimmed)

  const local = localResult.query === trimmed ? localResult.songs : []
  const remote = remoteResult.query === trimmed ? remoteResult.hits : null
  const remoteError = remoteResult.query === trimmed ? remoteResult.error : null

  useEffect(() => input.current?.focus(), [])

  useEffect(() => {
    if (!trimmed || link) return
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
        .catch(
          (cause) =>
            !cancelled &&
            setRemoteResult({
              query: trimmed,
              hits: null,
              error: (cause as Error).message,
            }),
        )
    }, SEARCH_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      abort.abort()
    }
  }, [trimmed, link])

  const importSong = async (id: number, urlOrId: string) => {
    setImporting(id)
    setImportError(null)
    try {
      const song = await api.importSongsterr(urlOrId)
      libraryChanged()
      onPick(song.id)
    } catch (cause) {
      setImportError((cause as Error).message)
    } finally {
      setImporting(null)
    }
  }
  const importHit = (hit: SongsterrHit) => importSong(hit.songId, String(hit.songId))
  // Stands for the pasted link while it is imported (no search hit has this id).
  const LINK_IMPORT = -1

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
          placeholder={t('输入曲名或链接进行搜索')}
          aria-label={t('搜索曲谱')}
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {importError && <p className={styles.error}>{importError}</p>}

      {link && (
        <div role="region" aria-label={t('曲谱链接')}>
          <ul>
            <li>
              <button type="button" disabled={importing !== null} onClick={() => void importSong(LINK_IMPORT, trimmed)}>
                <span className={styles.title}>{importing === LINK_IMPORT ? t('正在导入…') : t('导入这个链接')}</span>
                <span className={styles.artist}>{trimmed}</span>
              </button>
            </li>
          </ul>
        </div>
      )}

      {trimmed && !link && (
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

          <h2>{t('在线曲谱')}</h2>
          {remoteError && <p className={styles.error}>{remoteError}</p>}
          {!remoteError && remoteOnly === null && <p className={styles.muted}>{t('正在搜索…')}</p>}
          {remoteOnly?.length === 0 && <p className={styles.muted}>{t('没有匹配的曲谱。')}</p>}
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

import { Star, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import * as api from '../api.ts'
import type { Song } from '../api.ts'
import { sortByName } from '../../shared/alphabetical.ts'
import { translate, useLanguage } from '../../shared/ui/i18n.ts'
import { useSong } from './useSong.ts'
import { PlaylistPanel } from './PlaylistPanel.tsx'
import styles from './SongList.module.css'

interface SongListProps {
  /** Called after a song was picked, e.g. to close the surrounding popover. */
  onPick?: () => void
}

/**
 * "My tabs": everything in the library by the first letter of the title (2026-11-10; then the artist), with a
 * favourites filter; and the playlists, which keep their own order.
 */
export function SongList({ onPick }: SongListProps) {
  const { t } = useLanguage()
  const { song: current, open, close, replace, libraryVersion, libraryChanged } = useSong()
  const [songs, setSongs] = useState<Song[] | null>(null)
  const [view, setView] = useState<'all' | 'favorites' | 'playlists'>('all')
  const favoritesOnly = view === 'favorites'
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (view === 'playlists') return
    let cancelled = false
    api
      .listSongs({ favorite: favoritesOnly })
      .then((list) => {
        if (cancelled) return
        setSongs(sortByName(list, (song) => `${song.title} ${song.artist}`))
        setError(null)
      })
      .catch((cause) => {
        if (!cancelled) setError((cause as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [view, favoritesOnly, libraryVersion])

  const toggleFavorite = async (song: Song) => {
    const updated = await api.updateSong(song.id, { favorite: !song.favorite })
    if (current?.id === updated.id) replace(updated)
    libraryChanged()
  }

  const remove = async (song: Song) => {
    if (!window.confirm(translate('从曲库删除「{title}」？', { title: song.title }))) return
    await api.deleteSong(song.id)
    if (current?.id === song.id) close()
    libraryChanged()
  }

  return (
    <div className={styles.list}>
      <div className={styles.filters} role="tablist" aria-label={t('筛选')}>
        <button type="button" role="tab" aria-selected={view === 'all'} onClick={() => setView('all')}>
          {t('全部')}
        </button>
        <button type="button" role="tab" aria-selected={view === 'favorites'} onClick={() => setView('favorites')}>
          {t('收藏')}
        </button>
        <button type="button" role="tab" aria-selected={view === 'playlists'} onClick={() => setView('playlists')}>
          {t('播放列表')}
        </button>
      </div>

      {view === 'playlists' ? (
        <PlaylistPanel onPick={onPick} />
      ) : (
        <>

      {error && <p className={styles.message}>{error}</p>}
      {!error && songs?.length === 0 && (
        <p className={styles.message}>{favoritesOnly ? t('收藏为空。') : t('曲库为空。')}</p>
      )}

      <ul>
        {songs?.map((song) => (
          <li key={song.id} className={song.id === current?.id ? styles.current : undefined}>
            <button
              type="button"
              className={styles.open}
              onClick={() => {
                void open(song.id)
                onPick?.()
              }}
            >
              <span className={styles.title}>{song.title}</span>
              <span className={styles.artist}>
                {song.source === 'file' ? [song.artist, t('本地文件')].filter(Boolean).join(' · ') : song.artist}
              </span>
            </button>
            <button
              type="button"
              className={styles.icon}
              aria-label={song.favorite ? t('取消收藏') : t('收藏')}
              aria-pressed={song.favorite}
              title={song.favorite ? t('取消收藏') : t('收藏')}
              onClick={() => void toggleFavorite(song)}
            >
              <Star size={16} aria-hidden fill={song.favorite ? 'currentColor' : 'none'} />
            </button>
            <button type="button" className={styles.icon} aria-label={t('删除')} title={t('删除')} onClick={() => void remove(song)}>
              <Trash2 size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
        </>
      )}
    </div>
  )
}

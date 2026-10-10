import { Star, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import * as api from '../api/client.ts'
import type { Song } from '../api/client.ts'
import { useSong } from './useSong.ts'
import styles from './SongList.module.css'

interface SongListProps {
  /** Called after a song was picked, e.g. to close the surrounding popover. */
  onPick?: () => void
}

/** "My tabs": everything in the library, most recently practised first, with a favourites filter. */
export function SongList({ onPick }: SongListProps) {
  const { song: current, open, close, replace, libraryVersion, libraryChanged } = useSong()
  const [songs, setSongs] = useState<Song[] | null>(null)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .listSongs({ favorite: favoritesOnly })
      .then((list) => {
        if (cancelled) return
        setSongs(list)
        setError(null)
      })
      .catch((cause) => {
        if (!cancelled) setError((cause as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [favoritesOnly, libraryVersion])

  const toggleFavorite = async (song: Song) => {
    const updated = await api.updateSong(song.id, { favorite: !song.favorite })
    if (current?.id === updated.id) replace(updated)
    libraryChanged()
  }

  const remove = async (song: Song) => {
    if (!window.confirm(`从曲库删除「${song.title}」？`)) return
    await api.deleteSong(song.id)
    if (current?.id === song.id) close()
    libraryChanged()
  }

  return (
    <div className={styles.list}>
      <div className={styles.filters} role="tablist" aria-label="筛选">
        <button type="button" role="tab" aria-selected={!favoritesOnly} onClick={() => setFavoritesOnly(false)}>
          全部
        </button>
        <button type="button" role="tab" aria-selected={favoritesOnly} onClick={() => setFavoritesOnly(true)}>
          收藏
        </button>
      </div>

      {error && <p className={styles.message}>{error}</p>}
      {!error && songs?.length === 0 && (
        <p className={styles.message}>{favoritesOnly ? '还没有收藏的曲谱。' : '曲库是空的。在顶栏搜索，或点击“新建”导入曲谱。'}</p>
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
                {song.source === 'file' ? [song.artist, '本地文件'].filter(Boolean).join(' · ') : song.artist}
              </span>
            </button>
            <button
              type="button"
              className={styles.icon}
              aria-label={song.favorite ? '取消收藏' : '收藏'}
              aria-pressed={song.favorite}
              title={song.favorite ? '取消收藏' : '收藏'}
              onClick={() => void toggleFavorite(song)}
            >
              <Star size={16} aria-hidden fill={song.favorite ? 'currentColor' : 'none'} />
            </button>
            <button type="button" className={styles.icon} aria-label="删除" title="删除" onClick={() => void remove(song)}>
              <Trash2 size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

import { ChevronLeft, GripVertical, PencilLine, Play, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import * as api from '../api.ts'
import type { Playlist, Song } from '../api.ts'
import { translate, useLanguage } from '../../shared/ui/i18n.ts'
import { playlistQueue, setPlaylistQueue, usePlaylistQueue } from './playlistQueue.ts'
import { useSong } from './useSong.ts'
import list from './SongList.module.css'
import styles from './PlaylistPanel.module.css'

/**
 * "播放列表" in "my tabs" (2026-11-05): playlists of favourite songs. A playlist's songs are dragged into the order
 * they play in; opening one of them (or "play all") plays through the playlist, one song after the other.
 */
export function PlaylistPanel({ onPick }: { onPick?: () => void }) {
  const { t } = useLanguage()
  const { libraryVersion } = useSong()
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null)
  const [favorites, setFavorites] = useState<Song[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.listPlaylists(), api.listSongs({ favorite: true })])
      .then(([lists, songs]) => {
        if (cancelled) return
        setPlaylists(lists)
        setFavorites(songs)
        setError(null)
      })
      .catch((cause) => {
        if (!cancelled) setError((cause as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [libraryVersion])

  const replace = (playlist: Playlist) => setPlaylists((all) => all?.map((item) => (item.id === playlist.id ? playlist : item)) ?? [playlist])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    const made = await api.createPlaylist(name)
    setPlaylists((all) => [...(all ?? []), made])
    setName('')
    setOpenId(made.id)
  }

  const opened = playlists?.find((playlist) => playlist.id === openId)
  if (opened) {
    return (
      <PlaylistSongs
        playlist={opened}
        favorites={favorites}
        onBack={() => setOpenId(null)}
        onChange={replace}
        onDelete={() => {
          setPlaylists((all) => all?.filter((item) => item.id !== opened.id) ?? null)
          setOpenId(null)
        }}
        onPick={onPick}
      />
    )
  }

  return (
    <div className={styles.panel}>
      {error && <p className={list.message}>{error}</p>}
      {!error && playlists?.length === 0 && <p className={list.message}>{t('还没有播放集。')}</p>}
      <ul>
        {playlists?.map((playlist) => (
          <li key={playlist.id}>
            <button type="button" className={list.open} onClick={() => setOpenId(playlist.id)}>
              <span className={list.title}>{playlist.name}</span>
              <span className={list.artist}>{t('{n} 首', { n: playlist.songIds.length })}</span>
            </button>
          </li>
        ))}
      </ul>
      <form className={styles.row} onSubmit={(event) => void create(event)}>
        <input type="text" value={name} maxLength={60} placeholder={t('播放集名称')} aria-label={t('播放集名称')} onChange={(event) => setName(event.target.value)} />
        <button type="submit" className={styles.button} disabled={!name.trim()}>
          <Plus size={14} aria-hidden />
          {t('新建播放集')}
        </button>
      </form>
    </div>
  )
}

interface PlaylistSongsProps {
  playlist: Playlist
  favorites: Song[]
  onBack: () => void
  onChange: (playlist: Playlist) => void
  onDelete: () => void
  onPick?: () => void
}

/** One playlist: its songs in order (dragged to reorder), adding favourites, playing it through. */
function PlaylistSongs({ playlist, favorites, onBack, onChange, onDelete, onPick }: PlaylistSongsProps) {
  const { t } = useLanguage()
  const { song: current, open } = useSong()
  const queue = usePlaylistQueue()
  // The order while a song is being dragged or saved; otherwise the playlist's.
  const [draft, setDraft] = useState<number[] | null>(null)
  const order = draft ?? playlist.songIds
  const [dragged, setDragged] = useState<number | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  const byId = new Map(favorites.map((song) => [song.id, song]))
  const songs = order.map((id) => byId.get(id)).filter((song): song is Song => song !== undefined)
  const addable = favorites.filter((song) => !order.includes(song.id))

  const save = async (songIds: number[]) => {
    setDraft(songIds)
    const saved = await api.updatePlaylist(playlist.id, { songIds }).finally(() => setDraft(null))
    onChange(saved)
    // Playing through this playlist: the rest of it follows the new order.
    const playingNow = playlistQueue()
    if (playingNow?.playlistId === playlist.id) {
      const index = current ? saved.songIds.indexOf(current.id) : -1
      setPlaylistQueue(index < 0 ? null : { ...playingNow, songIds: saved.songIds, index })
    }
  }

  const play = (index: number, autoplay: boolean) => {
    const ids = songs.map((song) => song.id)
    setPlaylistQueue({ playlistId: playlist.id, songIds: ids, index })
    void open(ids[index], { play: autoplay })
    onPick?.()
  }

  const rename = async () => {
    const name = renaming?.trim()
    setRenaming(null)
    if (name && name !== playlist.name) onChange(await api.updatePlaylist(playlist.id, { name }))
  }

  const remove = async () => {
    if (!window.confirm(translate('确认删除播放集「{name}」？', { name: playlist.name }))) return
    await api.deletePlaylist(playlist.id)
    if (queue?.playlistId === playlist.id) setPlaylistQueue(null)
    onDelete()
  }

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <button type="button" className={list.icon} aria-label={t('返回')} title={t('返回')} onClick={onBack}>
          <ChevronLeft size={18} aria-hidden />
        </button>
        {renaming === null ? (
          <strong className={styles.name}>{playlist.name}</strong>
        ) : (
          <input
            type="text"
            className={styles.name}
            value={renaming}
            maxLength={60}
            autoFocus
            aria-label={t('播放集名称')}
            onChange={(event) => setRenaming(event.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void rename()
              if (event.key === 'Escape') {
                event.stopPropagation()
                setRenaming(null)
              }
            }}
          />
        )}
        <button type="button" className={list.icon} aria-label={t('改名')} title={t('改名')} onClick={() => setRenaming(playlist.name)}>
          <PencilLine size={16} aria-hidden />
        </button>
        <button type="button" className={list.icon} aria-label={t('删除播放集')} title={t('删除播放集')} onClick={() => void remove()}>
          <Trash2 size={16} aria-hidden />
        </button>
      </div>

      <button type="button" className={styles.button} disabled={songs.length === 0} onClick={() => play(0, true)}>
        <Play size={14} aria-hidden />
        {t('播放全部')}
      </button>

      {songs.length === 0 && <p className={list.message}>{t('播放集是空的，从下面添加收藏的曲谱。')}</p>}
      <ul aria-label={playlist.name}>
        {songs.map((song, index) => {
          const playing = queue?.playlistId === playlist.id && current?.id === song.id
          return (
            <li
              key={song.id}
              draggable
              className={[playing ? list.current : '', dragged === song.id ? styles.dragging : ''].join(' ')}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                setDragged(song.id)
              }}
              onDragOver={(event) => {
                if (dragged === null) return
                event.preventDefault()
                if (dragged === song.id) return
                // The dragged song takes this one's place as it passes over it.
                const next = order.filter((id) => id !== dragged)
                next.splice(next.indexOf(song.id) + (order.indexOf(dragged) < order.indexOf(song.id) ? 1 : 0), 0, dragged)
                setDraft(next)
              }}
              onDrop={(event) => event.preventDefault()}
              onDragEnd={() => {
                setDragged(null)
                if (order.join() !== playlist.songIds.join()) void save(order)
                else setDraft(null)
              }}
            >
              <span className={styles.grip} title={t('拖动调整顺序')} aria-hidden>
                <GripVertical size={16} />
              </span>
              <button type="button" className={list.open} onClick={() => play(index, false)}>
                <span className={list.title}>
                  {index + 1}. {song.title}
                </span>
                <span className={list.artist}>{song.source === 'file' ? [song.artist, t('本地文件')].filter(Boolean).join(' · ') : song.artist}</span>
              </button>
              <button
                type="button"
                className={list.icon}
                aria-label={t('从播放集移除')}
                title={t('从播放集移除')}
                onClick={() => void save(order.filter((id) => id !== song.id))}
              >
                <X size={16} aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>

      <select
        className={styles.add}
        value=""
        aria-label={t('添加收藏的曲谱…')}
        disabled={addable.length === 0}
        onChange={(event) => {
          const id = Number(event.target.value)
          if (id) void save([...order, id])
        }}
      >
        <option value="">{addable.length === 0 ? t('收藏的曲谱都已加入') : t('添加收藏的曲谱…')}</option>
        {addable.map((song) => (
          <option key={song.id} value={song.id}>
            {song.title}
          </option>
        ))}
      </select>
    </div>
  )
}

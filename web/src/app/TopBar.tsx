import { AudioLines, CircleHelp, Library, Music, PencilLine, Plus, Save, Search, SlidersHorizontal, Star, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import * as api from '../tabs/api.ts'
import { NewSong } from '../tabs/library/NewSong.tsx'
import { SearchPanel } from '../tabs/library/SearchPanel.tsx'
import { SongList } from '../tabs/library/SongList.tsx'
import { useSong } from '../tabs/library/useSong.ts'
import { SAVE_EDITS_EVENT, useTabEditing } from '../tabs/library/useTabEditing.ts'
import { STEMS_HASH, TONES_HASH, useView } from '../shared/useView.ts'
import { usePlayer } from '../tabs/player/usePlayer.ts'
import { useLanguage } from '../shared/ui/i18n.ts'
import { Popover } from '../shared/ui/Popover.tsx'
import { OPEN_SEARCH_EVENT, SHORTCUTS } from '../tabs/layout/shortcuts.ts'
import styles from './TopBar.module.css'

type PanelId = 'search' | 'library' | 'new' | 'help'

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

// Left: the page switch (library home, guitar tone editor), the open song and its star. Right: my tabs, new, search, help. The layout is the user's; the
// instrument picker lives in the control bar only (see CLAUDE.md, "顶栏").
export function TopBar() {
  const { state } = usePlayer()
  const { song, open, close: closeSong, replace, libraryChanged } = useSong()
  const { t } = useLanguage()
  const view = useView()
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
      {/* The pages, as a switch: the tabs (library and the open song) or the guitar tone editor. */}
      <div className={styles.views} role="group" aria-label={t('页面')}>
        <a
          className={styles.navButton}
          href="#/"
          aria-label={t('曲库首页')}
          title={t('曲库首页')}
          aria-current={view === 'library' || view === 'song' ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault()
            closeSong()
          }}
        >
          <Music size={20} aria-hidden />
          <span>{t('曲谱')}</span>
        </a>
        <a className={styles.navButton} href={TONES_HASH} title={t('音色')} aria-current={view === 'tones' ? 'page' : undefined}>
          <SlidersHorizontal size={20} aria-hidden />
          <span>{t('音色')}</span>
        </a>
        <a className={styles.navButton} href={STEMS_HASH} title={t('分轨')} aria-current={view === 'stems' ? 'page' : undefined}>
          <AudioLines size={20} aria-hidden />
          <span>{t('分轨')}</span>
        </a>
      </div>

      {song && (
        <div className={styles.song}>
          <div className={styles.songTitle}>
            {/* From the tone editor and the stems, the title leads back to the song. */}
            {view === 'tones' || view === 'stems' ? (
              <a className={styles.title} href={`#/song/${song.id}`} title={t('返回曲谱')}>
                {state.title || song.title}
              </a>
            ) : (
              <span className={styles.title}>{state.title || song.title}</span>
            )}
          </div>
          {/* Under the title: its star, and edit (first click opens the tab editor, the second saves and closes it). */}
          <div className={styles.songActions}>
            <button
              type="button"
              className={styles.starButton}
              aria-label={song.favorite ? t('取消收藏') : t('收藏')}
              aria-pressed={song.favorite}
              title={song.favorite ? t('取消收藏') : t('收藏')}
              onClick={() => void toggleFavorite()}
            >
              <Star size={18} aria-hidden fill={song.favorite ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              className={styles.editButton}
              aria-label={editing.editing ? t('保存修改') : t('编辑曲谱')}
              aria-pressed={editing.editing}
              title={editing.editing ? t('保存修改') + ' (Ctrl+S)' : t('编辑曲谱')}
              disabled={!editing.canEdit || editing.busy}
              onClick={() => (editing.editing ? void editing.save() : editing.start())}
            >
              {editing.editing ? <Save size={18} aria-hidden /> : <PencilLine size={18} aria-hidden />}
            </button>
          </div>
        </div>
      )}

      <nav className={styles.nav} aria-label={t('目录')}>
        {panelFor('library', Library, t('我的曲谱'), <SongList onPick={close} />)}
        {panelFor(
          'new',
          Plus,
          t('新建曲谱'),
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
          </div>,
        )}
      </nav>
    </header>
  )
}

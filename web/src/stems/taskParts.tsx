// The parts of the stems page its two tools share: the audio box that picks a recording and starts a job, and the
// head and progress of the job looked at (their state is in tasks.ts).
import { FileAudio, Trash2, X } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import panel from '../shared/panel.module.css'
import { useLanguage } from '../shared/ui/i18n.ts'
import styles from './StemsPage.module.css'
import { DEVICE_LABELS, type TaskItem, type useTasks } from './tasks.ts'

/** The audio: import (a button, or a file dropped on it), start, and the jobs made so far. */
export function AudioBox<Item extends TaskItem>(props: {
  tasks: ReturnType<typeof useTasks<Item>>
  canStart: boolean
  onStart: (file: File) => void
  startLabel: string
  startIcon: ReactNode
  listLabel: string
  statusText: (item: Item) => string
}) {
  const { t } = useLanguage()
  const { tasks } = props
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <section
      className={`${panel.section} ${styles.audio}`}
      aria-label={t('音频')}
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        if (![...event.dataTransfer.items].some((entry) => entry.kind === 'file')) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer.files[0]
        if (file && !tasks.preparing) tasks.setStaged(file)
      }}
    >
      <div className={styles.audioHead}>
        <h3>{t('音频')}</h3>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg"
          hidden
          aria-label={t('音频文件')}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) tasks.setStaged(file)
          }}
        />
        <button type="button" className={`${panel.secondary} ${styles.importButton}`} disabled={tasks.preparing} onClick={() => fileInput.current?.click()}>
          <FileAudio size={16} aria-hidden />
          {t('导入音频…')}
        </button>
      </div>
      {tasks.staged && (
        <div className={styles.staged}>
          <span title={tasks.staged.name}>{tasks.staged.name}</span>
          <button type="button" aria-label={t('移除')} title={t('移除')} disabled={tasks.preparing} onClick={() => tasks.setStaged(null)}>
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
      <button type="button" className={`${panel.primary} ${styles.importButton}`} disabled={!props.canStart || !tasks.staged || tasks.preparing} onClick={() => tasks.staged && props.onStart(tasks.staged)}>
        {props.startIcon}
        {tasks.preparing ? t('正在读取音频…') : props.startLabel}
      </button>
      <nav aria-label={props.listLabel}>
        <ul className={styles.list}>
          {tasks.items?.map((item) => (
            <li key={item.id}>
              <button type="button" aria-current={item.id === tasks.selected?.id ? 'true' : undefined} onClick={() => tasks.setSelectedId(item.id)}>
                <span>{item.name}</span>
                <small data-status={item.status}>{props.statusText(item)}</small>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  )
}

/** The job looked at: its name, where it came from, and delete (or cancel while it is under way). */
export function TaskHead({ item, onRemove }: { item: TaskItem; onRemove: () => void }) {
  const { t } = useLanguage()
  const ended = item.status === 'done' || item.status === 'failed'
  return (
    <div className={styles.itemHead}>
      <div className={styles.source}>
        <h2>{item.name}</h2>
        <small>{[item.sourceName, new Date(item.createdAt).toLocaleString(), item.device ? t(DEVICE_LABELS[item.device]) : ''].filter(Boolean).join(' · ')}</small>
      </div>
      <button type="button" className={panel.secondary} onClick={onRemove}>
        {ended ? <Trash2 size={16} aria-hidden /> : <X size={16} aria-hidden />}
        {ended ? t('删除') : t('取消')}
      </button>
    </div>
  )
}

/** The progress bar of a job that is queued or running. */
export function TaskProgress({ item, label, statusText }: { item: TaskItem; label: string; statusText: (item: TaskItem) => string }) {
  const { t } = useLanguage()
  if (item.status !== 'queued' && item.status !== 'running') return null
  return (
    <div className={styles.progressRow}>
      <progress max={1} value={item.status === 'running' && item.progress > 0 ? item.progress : undefined} aria-label={label} />
      <span>
        {statusText(item)}
        {item.status === 'running' && item.device && `（${t(DEVICE_LABELS[item.device])}）`}
      </span>
    </div>
  )
}

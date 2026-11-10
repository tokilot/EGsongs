// What the stems page's two tools share: a list of jobs on recordings (separations, transcriptions) that is kept
// fresh while one is under way, the recording picked for the next one, and starting and deleting. The parts of the
// page they share are in taskParts.tsx.
import { useCallback, useEffect, useState } from 'react'
import type { StemDevice } from './api.ts'
import { useLanguage } from '../shared/ui/i18n.ts'
import { decodeToWav } from './wav.ts'

export interface TaskItem {
  id: string
  name: string
  sourceName: string
  createdAt: string
  device: StemDevice | null
  status: 'queued' | 'running' | 'failed' | 'done'
  progress: number
  error: string | null
}

const POLL_MS = 1000

export const DEVICE_LABELS: Record<StemDevice, string> = { cuda: '显卡', cpu: 'CPU' }

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not kept; still used for now.
  }
}

export function megabytes(bytes: number) {
  return Math.round(bytes / 1024 ** 2)
}

/**
 * One tool's jobs: the list (polled while one is queued or running), the one looked at (the newest unless picked),
 * the recording picked and waiting for "start", and starting and deleting. `load` is one of api.ts's functions
 * (the same from one render to the next).
 */
export function useTasks<Item extends TaskItem>(load: () => Promise<Item[]>) {
  const { t } = useLanguage()
  const [items, setItems] = useState<Item[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The recording picked, waiting for "start" (so a wrong file costs nothing).
  const [staged, setStaged] = useState<File | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const working = items?.some((item) => item.status === 'queued' || item.status === 'running') ?? false
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const poll = () => {
      load()
        .then((next) => {
          if (cancelled) return
          setItems(next)
          if (next.some((item) => item.status === 'queued' || item.status === 'running')) timer = window.setTimeout(poll, POLL_MS)
        })
        .catch((cause: Error) => !cancelled && setError(cause.message))
    }
    poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [load, working, reload])

  const selected = items?.find((item) => item.id === selectedId) ?? items?.[0] ?? null

  /** Decodes the picked recording to WAV and hands it to `send`, which starts the job. */
  const start = useCallback(
    async (file: File, send: (wav: Blob) => Promise<Item>) => {
      setPreparing(true)
      setError(null)
      try {
        let wav: Blob
        try {
          wav = await decodeToWav(file)
        } catch {
          throw new Error(t('无法读取音频文件。'))
        }
        const item = await send(wav)
        setStaged(null)
        setSelectedId(item.id)
        setReload((count) => count + 1)
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setPreparing(false)
      }
    },
    [t],
  )

  /** Deletes a job (asking first when it is done: its results go with it), or stops one under way. */
  const remove = async (item: Item, question: string, send: (id: string) => Promise<unknown>) => {
    if (item.status === 'done' && !window.confirm(question)) return
    try {
      await send(item.id)
    } catch (cause) {
      setError((cause as Error).message)
    }
    setReload((count) => count + 1)
  }

  return { items, selected, setSelectedId, staged, setStaged, preparing, error, setError, start, remove }
}

/** The status of a job as its list and progress row say it; `running` words the progress. */
export function useTaskStatus(running: (percent: number) => string) {
  const { t } = useLanguage()
  return (item: TaskItem) =>
    item.status === 'queued'
      ? t('排队中…')
      : item.status === 'running'
        ? item.device && item.progress > 0
          ? running(Math.round(item.progress * 100))
          : t('正在加载模型…')
        : item.status === 'failed'
          ? t('失败')
          : new Date(item.createdAt).toLocaleDateString()
}

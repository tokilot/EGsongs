import { Cpu, Download, FileAudio, Gpu, Headphones, Pause, Play, Scissors, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as api from './api.ts'
import type { StemDevice, StemDevices, StemItem, StemModel, StemName } from './api.ts'
import panel from '../shared/panel.module.css'
import { useLanguage } from '../shared/ui/i18n.ts'
import { StemMixer } from './stemMixer.ts'
import styles from './StemsPage.module.css'
import { decodeToWav } from './wav.ts'

const STEM_LABELS: Record<StemName, string> = {
  vocals: '人声',
  drums: '鼓',
  bass: '贝斯',
  guitar: '吉他',
  piano: '钢琴',
  other: '其他',
}

const DEVICE_LABELS: Record<StemDevice, string> = { cuda: '显卡', cpu: 'CPU' }

// A stem this far down is one the model found (next to) nothing for; it starts switched off.
const SILENT_DB = -50
const POLL_MS = 1000
const DEVICE_KEY = 'tabs.stemDevice'
const MODEL_KEY = 'tabs.stemModel'

function storedDevice(): StemDevice | null {
  const stored = readStored(DEVICE_KEY)
  return stored === 'cuda' || stored === 'cpu' ? stored : null
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not kept; still used for now.
  }
}

function megabytes(bytes: number) {
  return Math.round(bytes / 1024 ** 2)
}

function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * Stems: a recording, split by the six-stem model into vocals, drums, bass, guitar, piano and other, to listen
 * to (any of them together, on one timeline) and download. A tool of its own, like the tone editor: it needs no
 * song, and leaves an open song loaded.
 */
export function StemsPage() {
  const { t } = useLanguage()
  const [items, setItems] = useState<StemItem[] | null>(null)
  const [devices, setDevices] = useState<StemDevices | null>(null)
  const [picked, setPicked] = useState<StemDevice | null>(storedDevice)
  const [models, setModels] = useState<StemModel[] | null>(null)
  const [pickedModel, setPickedModel] = useState<string | null>(() => readStored(MODEL_KEY))
  // The recording picked, waiting for "start" (so a wrong file costs nothing).
  const [staged, setStaged] = useState<File | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [reload, setReload] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const hasGpu = (devices?.gpus.length ?? 0) > 0
  // The graphics card unless the CPU was picked (or there is no card).
  const device: StemDevice = picked === 'cpu' || (devices !== null && !hasGpu) ? 'cpu' : 'cuda'
  const pickDevice = (next: StemDevice) => {
    setPicked(next)
    store(DEVICE_KEY, next)
  }
  // The model picked before if there still is one, else the first.
  const model = models?.find((entry) => entry.id === pickedModel) ?? models?.[0] ?? null
  const pickModel = (id: string) => {
    setPickedModel(id)
    store(MODEL_KEY, id)
  }

  useEffect(() => {
    let cancelled = false
    api
      .getStemDevices()
      .then((next) => !cancelled && setDevices(next))
      .catch((cause: Error) => !cancelled && setError(cause.message))
    api
      .getStemModels()
      .then((next) => !cancelled && setModels(next))
      .catch((cause: Error) => !cancelled && setError(cause.message))
    return () => {
      cancelled = true
    }
  }, [])

  const working = items?.some((item) => item.status === 'queued' || item.status === 'running') ?? false
  // The list, kept fresh while a separation is under way.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const poll = () => {
      api
        .listStems()
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
  }, [working, reload])

  const selected = items?.find((item) => item.id === selectedId) ?? items?.[0] ?? null

  const separate = useCallback(
    async (file: File, modelId: string) => {
      setPreparing(true)
      setError(null)
      try {
        let wav: Blob
        try {
          wav = await decodeToWav(file)
        } catch {
          throw new Error(t('无法读取这个音频文件。'))
        }
        const item = await api.separateStems(file.name, wav, device, modelId)
        setStaged(null)
        setSelectedId(item.id)
        setReload((count) => count + 1)
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setPreparing(false)
      }
    },
    [device, t],
  )

  const canStart = staged !== null && model !== null && model.available && !preparing && !devices?.problem

  const remove = async (item: StemItem) => {
    if (item.status === 'done' && !window.confirm(t('删除"{name}"的分轨？', { name: item.name }))) return
    try {
      await api.deleteStems(item.id)
    } catch (cause) {
      setError((cause as Error).message)
    }
    setReload((count) => count + 1)
  }

  const statusText = (item: StemItem) =>
    item.status === 'queued'
      ? t('排队中…')
      : item.status === 'running'
        ? item.device && item.progress > 0
          ? t('分离中 {percent}%', { percent: Math.round(item.progress * 100) })
          : t('正在加载模型…')
        : item.status === 'failed'
          ? t('失败')
          : new Date(item.createdAt).toLocaleDateString()
  const deviceName = (used: StemDevice | null) => (used ? t(DEVICE_LABELS[used]) : '')

  return (
    <div className={styles.page}>
      <section className={styles.content} aria-label={t('分轨')}>
        <header className={styles.pageHeader}>
          <h1>{t('分轨')}</h1>
          <p className={panel.hint}>
            {t('导入音频后将分成人声、鼓、贝斯、吉他、钢琴、其他六轨。')}
          </p>
        </header>

        {/* One row: the device, the model, and the audio (import, start, the separations made) widest at the right. */}
        <div className={styles.top}>
          <section className={panel.section} aria-label={t('处理设备')}>
            <h3>{t('处理设备')}</h3>
            {devices ? (
              <>
                <div className={styles.devices} role="radiogroup" aria-label={t('处理设备')}>
                  <button type="button" role="radio" aria-checked={device === 'cuda'} className={styles.device} disabled={!hasGpu} onClick={() => pickDevice('cuda')}>
                    <Gpu size={20} aria-hidden />
                    <span>
                      <strong>{t('显卡')}</strong>
                      <small>{hasGpu ? devices.gpus.map((gpu) => `${gpu.name} · ${gpu.memoryGb} GB`).join(' / ') : t('没有可用的设备')}</small>
                    </span>
                  </button>
                  <button type="button" role="radio" aria-checked={device === 'cpu'} className={styles.device} onClick={() => pickDevice('cpu')}>
                    <Cpu size={20} aria-hidden />
                    <span>
                      <strong>CPU</strong>
                      <small>{t('{name} · {threads} 线程', { name: devices.cpu.name, threads: devices.cpu.threads })}</small>
                    </span>
                  </button>
                </div>
                <p className={panel.hint}>
                  {[t('内存 {n} GB', { n: devices.memoryGb }), devices.torch && `PyTorch ${devices.torch}`, devices.cuda && `CUDA ${devices.cuda}`].filter(Boolean).join(' · ')}
                </p>
                {devices.problem && <p className={styles.error}>{t('分轨失败：{error}', { error: devices.problem })}</p>}
              </>
            ) : (
              <p className={panel.hint}>{t('正在检测当前可用设备…')}</p>
            )}
          </section>

          <section className={panel.section} aria-label={t('模型')}>
            <h3>{t('模型')}</h3>
            {models && model ? (
              <>
                <select className={styles.modelSelect} value={model.id} aria-label={t('模型')} onChange={(event) => pickModel(event.target.value)}>
                  {models.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
                <dl className={styles.modelInfo}>
                  <dt>{t('分出')}</dt>
                  <dd>{model.stems.map((name) => t(STEM_LABELS[name])).join('、')}</dd>
                  <dt>{t('文件')}</dt>
                  <dd>{model.available ? t('{n} MB', { n: megabytes(model.bytes) }) : <span className={styles.missing}>{t('缺少模型文件')}</span>}</dd>
                  <dt>{t('许可')}</dt>
                  <dd>{model.license === 'unknown' ? t('未注明，仅限自用') : model.license}</dd>
                </dl>
              </>
            ) : null}
          </section>

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
              if (file && !preparing) setStaged(file)
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
                  if (file) setStaged(file)
                }}
              />
              <button type="button" className={`${panel.secondary} ${styles.importButton}`} disabled={preparing} onClick={() => fileInput.current?.click()}>
                <FileAudio size={16} aria-hidden />
                {t('导入音频…')}
              </button>
            </div>
            {staged && (
              <div className={styles.staged}>
                <span title={staged.name}>{staged.name}</span>
                <button type="button" aria-label={t('移除')} title={t('移除')} disabled={preparing} onClick={() => setStaged(null)}>
                  <X size={14} aria-hidden />
                </button>
              </div>
            )}
            <button type="button" className={`${panel.primary} ${styles.importButton}`} disabled={!canStart} onClick={() => staged && model && void separate(staged, model.id)}>
              <Scissors size={16} aria-hidden />
              {preparing ? t('正在读取音频…') : t('开始分离音轨')}
            </button>
            <nav aria-label={t('分轨记录')}>
              <ul className={styles.list}>
                {items?.map((item) => (
                  <li key={item.id}>
                    <button type="button" aria-current={item.id === selected?.id ? 'true' : undefined} onClick={() => setSelectedId(item.id)}>
                      <span>{item.name}</span>
                      <small data-status={item.status}>{statusText(item)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </section>
        </div>
        {error && <p className={styles.error}>{error}</p>}

        {selected && (
          <section className={panel.section} aria-label={selected.name}>
            <div className={styles.itemHead}>
              <div className={styles.source}>
                <h2>{selected.name}</h2>
                <small>{[selected.sourceName, new Date(selected.createdAt).toLocaleString(), deviceName(selected.device)].filter(Boolean).join(' · ')}</small>
              </div>
              <button type="button" className={panel.secondary} onClick={() => void remove(selected)}>
                {selected.status === 'done' || selected.status === 'failed' ? <Trash2 size={16} aria-hidden /> : <X size={16} aria-hidden />}
                {selected.status === 'done' || selected.status === 'failed' ? t('删除') : t('取消')}
              </button>
            </div>

            {(selected.status === 'queued' || selected.status === 'running') && (
              <div className={styles.progressRow}>
                <progress max={1} value={selected.status === 'running' && selected.progress > 0 ? selected.progress : undefined} aria-label={t('分离进度')} />
                <span>
                  {statusText(selected)}
                  {selected.status === 'running' && selected.device && `（${deviceName(selected.device)}）`}
                </span>
              </div>
            )}
            {selected.status === 'failed' && <p className={styles.error}>{t('分离失败：{error}', { error: selected.error ?? '' })}</p>}
            {selected.status === 'done' && <StemPlayer key={selected.id} item={selected} />}
          </section>
        )}
      </section>
    </div>
  )
}

/** The stems of one separation on one timeline: switch any of them on, solo one or several. */
function StemPlayer({ item }: { item: StemItem }) {
  const { t } = useLanguage()
  const [mixer] = useState(
    () =>
      new StemMixer(
        item.stems.map((stem) => ({ name: stem.name, url: api.stemUrl(item.id, stem.name) })),
        item.stems.filter((stem) => stem.rmsDb >= SILENT_DB).map((stem) => stem.name),
      ),
  )
  useEffect(() => {
    mixer.open()
    return () => mixer.close()
  }, [mixer])
  const mix = useSyncExternalStore(mixer.subscribe, mixer.getState)

  // Starting the stems stops the song (and the song starting stops the stems): see audio/soundOwner.ts.
  const toggle = () => mixer.toggle()

  const ready = mix.loaded === mix.total
  return (
    <>
      <div className={styles.transport} role="group" aria-label={t('分轨播放')}>
        <button type="button" className={styles.playButton} aria-label={mix.playing ? t('暂停') : t('播放')} disabled={!ready} onClick={toggle}>
          {mix.playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
        </button>
        <span className={styles.time}>{clock(mix.time)}</span>
        <input
          type="range"
          min={0}
          max={mix.duration || 1}
          step={0.01}
          value={mix.time}
          disabled={!ready}
          aria-label={t('播放位置')}
          onChange={(event) => mixer.seek(Number(event.target.value))}
        />
        <span className={styles.time}>{clock(mix.duration)}</span>
      </div>
      {!ready && !mix.error && <p className={panel.hint}>{t('正在载入音轨 {n}/{total}…', { n: mix.loaded, total: mix.total })}</p>}
      {mix.error && <p className={styles.error}>{t('音轨载入失败：{error}', { error: mix.error })}</p>}

      <div className={styles.stems}>
        {item.stems.map((stem) => {
          const label = t(STEM_LABELS[stem.name])
          const soloed = mix.soloed.has(stem.name)
          const heard = mix.soloed.size > 0 ? soloed : mix.enabled.has(stem.name)
          return (
            <div key={stem.name} className={styles.stem} data-heard={heard || undefined}>
              <label className={styles.stemName}>
                <input type="checkbox" checked={mix.enabled.has(stem.name)} onChange={(event) => mixer.setEnabled(stem.name, event.target.checked)} />
                <strong>{label}</strong>
              </label>
              <button
                type="button"
                className={styles.solo}
                aria-pressed={soloed}
                aria-label={t('独奏{name}', { name: label })}
                title={t('独奏')}
                onClick={() => mixer.setSolo(stem.name, !soloed)}
              >
                <Headphones size={16} aria-hidden />
              </button>
              <a className={styles.download} href={api.stemUrl(item.id, stem.name)} download={`${item.name} - ${label}.flac`} title={t('下载')} aria-label={t('下载{name}', { name: label })}>
                <Download size={16} aria-hidden />
              </a>
            </div>
          )
        })}
      </div>
    </>
  )
}

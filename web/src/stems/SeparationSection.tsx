// "Stem separation": a recording split into the stems of the model picked, to listen to (any of them together, on
// one timeline) and download.
import { Download, Headphones, Pause, Play, Scissors } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import * as api from './api.ts'
import type { StemDevice, StemItem, StemModel, StemName } from './api.ts'
import panel from '../shared/panel.module.css'
import { useLanguage } from '../shared/ui/i18n.ts'
import { StemMixer } from './stemMixer.ts'
import styles from './StemsPage.module.css'
import { AudioBox, TaskHead, TaskProgress } from './taskParts.tsx'
import { megabytes, readStored, store, useTaskStatus, useTasks } from './tasks.ts'

/** Names for the stems the models give; a stem not listed here shows its model's own name. */
const STEM_LABELS: Record<string, string> = {
  vocals: '人声',
  drums: '鼓',
  bass: '贝斯',
  guitar: '吉他',
  piano: '钢琴',
  other: '其他',
}

// A stem this far down is one the model found (next to) nothing for; it starts switched off.
const SILENT_DB = -50
const MODEL_KEY = 'tabs.stemModel'

function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function useStemLabel(): (name: StemName) => string {
  const { t } = useLanguage()
  return (name) => (Object.hasOwn(STEM_LABELS, name) ? t(STEM_LABELS[name]) : name)
}

/** `device`: picked once for the page; `blocked`: why nothing can run here (no Python), or null. */
export function SeparationSection({ device, blocked }: { device: StemDevice; blocked: boolean }) {
  const { t } = useLanguage()
  const stemLabel = useStemLabel()
  const tasks = useTasks(api.listStems)
  const [models, setModels] = useState<StemModel[] | null>(null)
  const [pickedModel, setPickedModel] = useState<string | null>(() => readStored(MODEL_KEY))
  const { setError } = tasks

  useEffect(() => {
    let cancelled = false
    api
      .getStemModels()
      .then((next) => !cancelled && setModels(next))
      .catch((cause: Error) => !cancelled && setError(cause.message))
    return () => {
      cancelled = true
    }
  }, [setError])

  // The model picked before if there still is one, else the first.
  const model = models?.find((entry) => entry.id === pickedModel) ?? models?.[0] ?? null
  const pickModel = (id: string) => {
    setPickedModel(id)
    store(MODEL_KEY, id)
  }
  const statusText = useTaskStatus((percent) => t('分离中 {percent}%', { percent }))
  const { selected } = tasks

  return (
    <section className={styles.block} aria-label={t('音轨分离')}>
      <header className={styles.blockHeader}>
        <h2>{t('音轨分离')}</h2>
      </header>

      {/* One row: the model, and the audio (import, start, the separations made) wider at the right. */}
      <div className={styles.top}>
        <section className={panel.section} aria-label={t('模型')}>
          <h3>{t('模型')}</h3>
          {models?.length === 0 && <p className={panel.hint}>{t('没有找到模型：把模型放进 data/models/separator/ 后刷新页面。')}</p>}
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
                <dt>{t('轨道')}</dt>
                <dd>{model.stems.map(stemLabel).join('、')}</dd>
                <dt>{t('文件')}</dt>
                <dd>{model.available ? t('{n} MB', { n: megabytes(model.bytes) }) : <span className={styles.missing}>{t('缺少模型文件')}</span>}</dd>
                {model.license !== 'unknown' && (
                  <>
                    <dt>{t('许可')}</dt>
                    <dd>{model.license}</dd>
                  </>
                )}
              </dl>
            </>
          ) : null}
        </section>

        <AudioBox
          tasks={tasks}
          canStart={model !== null && model.available && !blocked}
          onStart={(file) => model && void tasks.start(file, (wav) => api.separateStems(file.name, wav, device, model.id))}
          startLabel={t('开始分离音轨')}
          startIcon={<Scissors size={16} aria-hidden />}
          listLabel={t('分轨记录')}
          statusText={statusText}
        />
      </div>
      {tasks.error && <p className={styles.error}>{tasks.error}</p>}

      {selected && (
        <section className={panel.section} aria-label={selected.name}>
          <TaskHead item={selected} onRemove={() => void tasks.remove(selected, t('删除"{name}"的分轨？', { name: selected.name }), api.deleteStems)} />
          <TaskProgress item={selected} label={t('分离进度')} statusText={statusText} />
          {selected.status === 'failed' && <p className={styles.error}>{t('分离失败：{error}', { error: selected.error ?? '' })}</p>}
          {selected.status === 'done' && <StemPlayer key={selected.id} item={selected} />}
        </section>
      )}
    </section>
  )
}

/** The stems of one separation on one timeline: switch any of them on, solo one or several. */
function StemPlayer({ item }: { item: StemItem }) {
  const { t } = useLanguage()
  const stemLabel = useStemLabel()
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
          const label = stemLabel(stem.name)
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

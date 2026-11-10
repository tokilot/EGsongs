// "Audio to MIDI": a recording (or a stem separated above) transcribed by MuScriptor into a MIDI file, to download
// and import as a tab ("New tab → Import file"). The stems page does not open tabs itself (it knows nothing of them).
import { AudioWaveform, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import * as api from './api.ts'
import type { BeatModel, InstrumentChoice, StemDevice, TranscriptionModel } from './api.ts'
import panel from '../shared/panel.module.css'
import { useLanguage } from '../shared/ui/i18n.ts'
import styles from './StemsPage.module.css'
import { AudioBox, TaskHead, TaskProgress } from './taskParts.tsx'
import { megabytes, readStored, store, useTaskStatus, useTasks } from './tasks.ts'

const MODEL_KEY = 'tabs.midiModel'
const INSTRUMENTS_KEY = 'tabs.midiInstruments'
const BEAT_KEY = 'tabs.midiBeat'
const BPM_KEY = 'tabs.midiBpm'
/** "No beat tracker": the MIDI is written at the steady tempo typed in. */
const NO_BEAT = 'none'
const DEFAULT_BPM = 120
const MIN_BPM = 20
const MAX_BPM = 300

/** A choice of instruments and its name on the page. */
type Choice = [InstrumentChoice, string]

/** What the model may hear: everything, or only guitars and/or basses (best for a separated stem). */
const INSTRUMENT_CHOICES: Choice[] = [
  ['auto', '自动识别'],
  ['guitar', '吉他'],
  ['bass', '贝斯'],
  ['guitar-bass', '吉他和贝斯'],
]

/** MuScriptor's instrument groups (`muscriptor list-instruments`), as the page names them. */
const PART_LABELS: Record<string, string> = {
  acoustic_piano: '钢琴',
  electric_piano: '电钢琴',
  chromatic_percussion: '有音高打击乐',
  organ: '风琴',
  acoustic_guitar: '木吉他',
  clean_electric_guitar: '清音电吉他',
  distorted_electric_guitar: '失真电吉他',
  acoustic_bass: '原声贝斯',
  electric_bass: '电贝斯',
  violin: '小提琴',
  viola: '中提琴',
  cello: '大提琴',
  contrabass: '低音提琴',
  orchestral_harp: '竖琴',
  timpani: '定音鼓',
  string_ensemble: '弦乐合奏',
  synth_strings: '合成弦乐',
  voice: '人声',
  orchestra_hit: '管弦乐齐奏',
  trumpet: '小号',
  trombone: '长号',
  tuba: '大号',
  french_horn: '圆号',
  brass_section: '铜管组',
  soprano_and_alto_sax: '高音和中音萨克斯',
  tenor_sax: '次中音萨克斯',
  baritone_sax: '上低音萨克斯',
  oboe: '双簧管',
  english_horn: '英国管',
  bassoon: '巴松管',
  clarinet: '单簧管',
  flutes: '长笛',
  synth_lead: '合成主音',
  synth_pad: '合成铺底',
  drums: '鼓',
}

function isChoice(value: string | null): value is InstrumentChoice {
  return INSTRUMENT_CHOICES.some(([choice]) => choice === value)
}

/** `device`: picked once for the page; `blocked`: why nothing can run here (no Python), or null. */
export function TranscriptionSection({ device, blocked }: { device: StemDevice; blocked: boolean }) {
  const { t } = useLanguage()
  const tasks = useTasks(api.listTranscriptions)
  const [models, setModels] = useState<TranscriptionModel[] | null>(null)
  const [pickedModel, setPickedModel] = useState<string | null>(() => readStored(MODEL_KEY))
  const [instruments, setInstruments] = useState<InstrumentChoice>(() => {
    const stored = readStored(INSTRUMENTS_KEY)
    return isChoice(stored) ? stored : 'auto'
  })
  const [beats, setBeats] = useState<BeatModel[] | null>(null)
  const [pickedBeat, setPickedBeat] = useState<string | null>(() => readStored(BEAT_KEY))
  const [bpm, setBpm] = useState(() => {
    const stored = Number(readStored(BPM_KEY))
    return Number.isFinite(stored) && stored >= MIN_BPM && stored <= MAX_BPM ? stored : DEFAULT_BPM
  })
  const { setError } = tasks

  useEffect(() => {
    let cancelled = false
    api
      .getTranscriptionModels()
      .then((next) => !cancelled && setModels(next))
      .catch((cause: Error) => !cancelled && setError(cause.message))
    api
      .getBeatModels()
      .then((next) => !cancelled && setBeats(next))
      .catch((cause: Error) => !cancelled && setError(cause.message))
    return () => {
      cancelled = true
    }
  }, [setError])

  // The model picked before if there still is one, else the first whose files are here, else the first.
  const model = models?.find((entry) => entry.id === pickedModel) ?? models?.find((entry) => entry.available) ?? models?.[0] ?? null
  const pickModel = (id: string) => {
    setPickedModel(id)
    store(MODEL_KEY, id)
  }
  const pickInstruments = (choice: InstrumentChoice) => {
    setInstruments(choice)
    store(INSTRUMENTS_KEY, choice)
  }
  // The beat tracker picked before if it is still there, "none" if that was picked, else the first there is; with
  // none (or none picked) the MIDI is written at the steady tempo typed in.
  const beat = pickedBeat === NO_BEAT ? null : (beats?.find((entry) => entry.id === pickedBeat) ?? beats?.[0] ?? null)
  const pickBeat = (id: string) => {
    setPickedBeat(id)
    store(BEAT_KEY, id)
  }
  const changeBpm = (value: number) => {
    const next = Number.isFinite(value) ? Math.min(Math.max(Math.round(value), MIN_BPM), MAX_BPM) : DEFAULT_BPM
    setBpm(next)
    store(BPM_KEY, String(next))
  }
  const partLabel = (part: string) => (Object.hasOwn(PART_LABELS, part) ? t(PART_LABELS[part]) : part.replaceAll('_', ' '))
  const statusText = useTaskStatus((percent) => t('转换中 {percent}%', { percent }))
  const { selected } = tasks

  return (
    <section className={styles.block} aria-label={t('音频转 MIDI')}>
      <header className={styles.blockHeader}>
        <h2>{t('音频转 MIDI')}</h2>
      </header>

      <div className={styles.top}>
        <section className={panel.section} aria-label={t('模型')}>
          <h3>{t('模型')}</h3>
          {models?.length === 0 && <p className={panel.hint}>{t('没有找到模型：把模型放进 data/models/transcriber/ 后刷新页面。')}</p>}
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
                <dt>{t('乐器')}</dt>
                <dd>
                  <select className={styles.inlineSelect} value={instruments} aria-label={t('乐器')} onChange={(event) => pickInstruments(event.target.value as InstrumentChoice)}>
                    {INSTRUMENT_CHOICES.map(([choice, label]) => (
                      <option key={choice} value={choice}>
                        {t(label)}
                      </option>
                    ))}
                  </select>
                </dd>
                <dt>{t('节拍检测')}</dt>
                <dd>
                  <select className={styles.inlineSelect} value={beat?.id ?? NO_BEAT} aria-label={t('节拍检测')} onChange={(event) => pickBeat(event.target.value)}>
                    {beats?.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                    <option value={NO_BEAT}>{t('不检测')}</option>
                  </select>
                </dd>
                <dt>{t('速度（BPM）')}</dt>
                <dd>
                  <input
                    className={styles.inlineNumber}
                    type="number"
                    min={MIN_BPM}
                    max={MAX_BPM}
                    value={bpm}
                    disabled={beat !== null}
                    aria-label={t('速度（BPM）')}
                    onChange={(event) => changeBpm(Number(event.target.value))}
                  />
                </dd>
                <dt>{t('参数')}</dt>
                <dd>{t('约 {n}', { n: model.parameters >= 1000 ? `${(model.parameters / 1000).toFixed(1)}B` : `${model.parameters}M` })}</dd>
                <dt>{t('文件')}</dt>
                <dd>{model.available ? t('{n} MB', { n: megabytes(model.bytes) }) : <span className={styles.missing}>{t('缺少模型文件')}</span>}</dd>
              </dl>
            </>
          ) : null}
        </section>

        <AudioBox
          tasks={tasks}
          canStart={model !== null && model.available && !blocked}
          onStart={(file) => model && void tasks.start(file, (wav) => api.transcribe(file.name, wav, device, model.id, instruments, beat?.id ?? null, bpm))}
          startLabel={t('开始转换')}
          startIcon={<AudioWaveform size={16} aria-hidden />}
          listLabel={t('转换记录')}
          statusText={statusText}
        />
      </div>
      {tasks.error && <p className={styles.error}>{tasks.error}</p>}

      {selected && (
        <section className={panel.section} aria-label={selected.name}>
          <TaskHead item={selected} onRemove={() => void tasks.remove(selected, t('删除"{name}"的 MIDI？', { name: selected.name }), api.deleteTranscription)} />
          <TaskProgress item={selected} label={t('转换进度')} statusText={statusText} />
          {selected.status === 'failed' && <p className={styles.error}>{t('转换失败：{error}', { error: selected.error ?? '' })}</p>}
          {selected.status === 'done' && selected.midi && (
            <div className={styles.midiResult}>
              <div className={styles.midiFacts}>
                <p>
                  {selected.midi.bpm === null
                    ? t('共 {notes} 个音符，没有找到稳定的节拍', { notes: selected.midi.notes })
                    : selected.midi.detected === false
                      ? t('共 {notes} 个音符，按 {bpm} BPM 匀速', { notes: selected.midi.notes, bpm: Math.round(selected.midi.bpm) })
                      : t('共 {notes} 个音符，速度约 {bpm} BPM', { notes: selected.midi.notes, bpm: Math.round(selected.midi.bpm) })}
                </p>
                {selected.midi.parts.length > 0 && <p>{t('识别出的乐器：{names}', { names: selected.midi.parts.map(partLabel).join('、') })}</p>}
              </div>
              <a className={`${panel.primary} ${styles.importButton}`} href={api.midiUrl(selected.id)} download={`${selected.name}.mid`}>
                <Download size={16} aria-hidden />
                {t('下载 MIDI')}
              </a>
            </div>
          )}
        </section>
      )}
    </section>
  )
}

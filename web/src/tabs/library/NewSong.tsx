import { useState } from 'react'
import * as api from '../api.ts'
import type { Song } from '../api.ts'
import { useLanguage } from '../../shared/ui/i18n.ts'
import { BLANK_DEFAULTS, BLANK_INSTRUMENTS, BLANK_TIME_SIGNATURES, blankFileName, blankTabFile, type BlankInstrument, type BlankTab } from './blankScore.ts'
import styles from './panels.module.css'

/** "New": import a tab file, or start a blank tab to write in the tab editor. */
export function NewSong({ onDone }: { onDone: (songId: number) => void }) {
  const { t } = useLanguage()
  const [blank, setBlank] = useState<BlankTab>(BLANK_DEFAULTS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (task: () => Promise<Song>) => {
    setBusy(true)
    setError(null)
    try {
      onDone((await task()).id)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const createBlank = async () => {
    const tab = { ...blank, title: blank.title.trim() || t('未命名曲谱'), artist: blank.artist.trim() }
    const file = new File([blankTabFile(tab) as BlobPart], blankFileName(tab.title))
    const song = await api.uploadSong(file)
    // The library takes the title from the file name, which cannot hold every character.
    return api.updateSong(song.id, { title: tab.title, artist: tab.artist })
  }

  const set = (change: Partial<BlankTab>) => setBlank({ ...blank, ...change })
  const clamp = (value: number, min: number, max: number, fallback: number) => (Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : fallback)

  return (
    <div className={styles.newSong}>
      <h2>{t('导入文件')}</h2>
      <input
        type="file"
        aria-label={t('曲谱文件')}
        accept=".gp,.gp3,.gp4,.gp5,.gpx,.xml,.musicxml,.mxl,.atex,.alphatex"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void run(() => api.uploadSong(file))
        }}
      />
      <p className={styles.muted}>{t('支持 Guitar Pro、MusicXML 和 alphaTex。')}</p>

      <h2>{t('新建空白谱')}</h2>
      <form
        className={styles.blankForm}
        aria-label={t('新建空白谱')}
        onSubmit={(event) => {
          event.preventDefault()
          void run(createBlank)
        }}
      >
        <label className={styles.wide}>
          <span>{t('曲名')}</span>
          <input type="text" value={blank.title} placeholder={t('未命名曲谱')} maxLength={100} disabled={busy} onChange={(event) => set({ title: event.target.value })} />
        </label>
        <label className={styles.wide}>
          <span>{t('艺术家')}</span>
          <input type="text" value={blank.artist} maxLength={100} disabled={busy} onChange={(event) => set({ artist: event.target.value })} />
        </label>
        <label>
          <span>{t('乐器')}</span>
          <select value={blank.instrument} disabled={busy} onChange={(event) => set({ instrument: event.target.value as BlankInstrument })}>
            {(Object.keys(BLANK_INSTRUMENTS) as BlankInstrument[]).map((id) => (
              <option key={id} value={id}>
                {t(BLANK_INSTRUMENTS[id].label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('拍号')}</span>
          <select
            value={`${blank.numerator}/${blank.denominator}`}
            disabled={busy}
            onChange={(event) => {
              const [numerator, denominator] = event.target.value.split('/').map(Number)
              set({ numerator, denominator })
            }}
          >
            {BLANK_TIME_SIGNATURES.map(([numerator, denominator]) => (
              <option key={`${numerator}/${denominator}`} value={`${numerator}/${denominator}`}>
                {numerator}/{denominator}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('速度（BPM）')}</span>
          <input type="number" min={30} max={300} value={blank.tempo} disabled={busy} onChange={(event) => set({ tempo: clamp(Number(event.target.value), 30, 300, 120) })} />
        </label>
        <label>
          <span>{t('小节数')}</span>
          <input type="number" min={1} max={500} value={blank.bars} disabled={busy} onChange={(event) => set({ bars: clamp(Number(event.target.value), 1, 500, 16) })} />
        </label>
        <button type="submit" className={styles.wide} disabled={busy}>
          {t('新建')}
        </button>
      </form>

      {busy && <p className={styles.muted}>{t('正在导入…')}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

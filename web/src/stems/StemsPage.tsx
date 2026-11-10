import { Cpu, Gpu } from 'lucide-react'
import { useEffect, useState } from 'react'
import * as api from './api.ts'
import type { StemDevice, StemDevices } from './api.ts'
import panel from '../shared/panel.module.css'
import { useLanguage } from '../shared/ui/i18n.ts'
import { SeparationSection } from './SeparationSection.tsx'
import { readStored, store } from './tasks.ts'
import styles from './StemsPage.module.css'
import { TranscriptionSection } from './TranscriptionSection.tsx'

const DEVICE_KEY = 'tabs.stemDevice'

function storedDevice(): StemDevice | null {
  const stored = readStored(DEVICE_KEY)
  return stored === 'cuda' || stored === 'cpu' ? stored : null
}

/**
 * "Transcribe": the processing device, then two tools on recordings that use it: stem separation (a recording
 * split into the stems of the model picked) and audio to MIDI. A tool of its own, like the tone editor: it needs no
 * song, and leaves an open song loaded.
 */
export function StemsPage() {
  const { t } = useLanguage()
  const [devices, setDevices] = useState<StemDevices | null>(null)
  const [picked, setPicked] = useState<StemDevice | null>(storedDevice)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getStemDevices()
      .then((next) => !cancelled && setDevices(next))
      .catch((cause: Error) => !cancelled && setError(cause.message))
    return () => {
      cancelled = true
    }
  }, [])

  const hasGpu = (devices?.gpus.length ?? 0) > 0
  // The graphics card unless the CPU was picked (or there is no card).
  const device: StemDevice = picked === 'cpu' || (devices !== null && !hasGpu) ? 'cpu' : 'cuda'
  const pickDevice = (next: StemDevice) => {
    setPicked(next)
    store(DEVICE_KEY, next)
  }
  const blocked = Boolean(devices?.problem)

  return (
    <div className={styles.page}>
      <section className={styles.content} aria-label={t('转谱')}>
        <header className={styles.pageHeader}>
          <h1>{t('转谱')}</h1>
        </header>

        {/* The device both tools below run on. */}
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
              {devices.problem && <p className={styles.error}>{t('处理设备不可用：{error}', { error: devices.problem })}</p>}
            </>
          ) : (
            <p className={panel.hint}>{t('正在检测当前可用设备…')}</p>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </section>

        <SeparationSection device={device} blocked={blocked} />
        <TranscriptionSection device={device} blocked={blocked} />
      </section>
    </div>
  )
}

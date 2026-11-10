import { Play } from 'lucide-react'
import { useLanguage } from '../shared/ui/i18n.ts'
import { usePlayer } from '../tabs/player/usePlayer.ts'
import { INSTRUMENT_CATEGORIES } from '../tabs/player/trackEdits.ts'
import { presetPlace, type SoundFontEntry } from '../tabs/player/trackSounds.ts'
import { soundFontTitle, useSoundFontStatus } from './soundFontStatus.ts'
import panel from '../shared/panel.module.css'
import styles from './TonePage.module.css'

const GUITAR = [64, 59, 55, 50, 45, 40]
const BASS = [43, 38, 33, 28]

/**
 * One sample set of data/soundfonts/ on the tone page: what it is and its presets by kind of instrument. The main
 * set is loaded with the page; any other only with the "load" button here (until the page is reloaded), and then
 * its presets can be tried and given to tracks in "edit track".
 */
export function SampleLibrary({ font }: { font: SoundFontEntry }) {
  const { state, player } = usePlayer()
  const { t } = useLanguage()
  const status = useSoundFontStatus()(font)
  const playable = (status === 'main' || status === 'loaded') && state.canPreview

  // The presets by category and kind, in the picker's order; the main set's added ones (Bread's guitars) after its
  // own of the same kind.
  type Listed = SoundFontEntry['presets'][number] & { added: boolean }
  const groups = new Map<string, { label: string; bass: boolean; presets: Listed[] }>()
  const all: Listed[] = [...font.presets.map((preset) => ({ ...preset, added: false })), ...(font.added?.presets ?? []).map((preset) => ({ ...preset, added: true }))]
  const placed = all.map((preset) => ({ preset, at: presetPlace(font.name, preset, font.kind) }))
  placed.sort((a, b) => a.at.category - b.at.category || a.at.sub - b.at.sub)
  for (const { preset, at } of placed) {
    const category = INSTRUMENT_CATEGORIES[at.category]
    const sub = category.subs[at.sub]
    const key = `${at.category}/${at.sub}`
    if (!groups.has(key)) groups.set(key, { label: `${t(category.label)} · ${t(sub.label)}`, bass: sub.label === '贝斯', presets: [] })
    groups.get(key)!.presets.push(preset)
  }

  return (
    <section className={panel.section} aria-label={soundFontTitle(font.name)}>
      <div className={styles.toneRow}>
        <h2 className={styles.toneTitle}>{soundFontTitle(font.name)}</h2>
        <span className={styles.fontMeta}>
          {font.kind === 'gm' ? t('GM 全套') : t('附加')} · {(font.bytes / 1e6).toFixed(1)} MB · {t('{n} 个预设', { n: all.length })}
        </span>
        {status === 'main' ? (
          <span className={styles.fontMeta}>{t('默认')}</span>
        ) : status === 'loaded' ? (
          <span className={styles.fontMeta}>{t('已加载')}</span>
        ) : (
          <button
            type="button"
            className={panel.primary}
            disabled={status === 'loading' || state.loadingSoundFont !== null}
            onClick={() => void player.loadExtraSoundFont(font.name)}
          >
            {status === 'loading' ? t('加载中…') : t('加载')}
          </button>
        )}
      </div>
      {status === 'loaded' && <p className={panel.hint}>{t('已加载')}</p>}
      {all.length === 0 && <p className={panel.hint}>{t('读取文件预设失败')}</p>}
      {[...groups.entries()].map(([key, group]) => (
        <div key={key} className={styles.presetGroup}>
          <h3>{group.label}</h3>
          <ul className={styles.presets}>
            {group.presets.map((preset) => (
              <li key={`${preset.added ? 'added' : 'own'}/${preset.program}`}>
                <button
                  type="button"
                  disabled={!playable}
                  title={t('试听')}
                  onClick={() => player.previewPreset(font.name, preset.program, group.bass ? BASS : GUITAR, preset.added)}
                >
                  <Play size={12} aria-hidden />
                  <span>{preset.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

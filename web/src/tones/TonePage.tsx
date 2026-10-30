import { Activity, Flame, Funnel, Play, Power, Square, Repeat, SlidersHorizontal, Sparkles, Speaker, AudioWaveform, Zap, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLanguage } from '../shared/ui/i18n.ts'
import { TONE_FAMILIES, type Tone, type ToneFamily } from '../audio/tone.ts'
import { allTones, findTone, newToneId } from './library.ts'
import { toneStore, useTones } from './toneStore.ts'
import { MODULE_ORDER, MODULES, defaultModule, paramsFor, sameChain, type ModuleId, type ParamSpec, type ToneChain } from '../audio/toneChain.ts'
import { usePlayer } from '../tabs/player/usePlayer.ts'
import panel from '../shared/panel.module.css'
import styles from './TonePage.module.css'

const FAMILY_LABELS: Record<ToneFamily, string> = { guitar: '电吉他', bass: '贝斯' }

const MODULE_ICONS: Record<ModuleId, LucideIcon> = {
  dyna: Activity,
  filter: Funnel,
  od: Zap,
  amp: Flame,
  cab: Speaker,
  eq: SlidersHorizontal,
  mod: AudioWaveform,
  delay: Repeat,
  reverb: Sparkles,
}

/** A knob's value as shown: whole milliseconds and hertz, one decimal otherwise. */
function formatValue(param: ParamSpec, value: number): string {
  const digits = param.step >= 1 ? 0 : 1
  const text = param.unit === 'dB' && value > 0 ? `+${value.toFixed(digits)}` : value.toFixed(digits)
  return param.unit ? `${text} ${param.unit}` : text
}

/**
 * "吉他音色编辑": the personal tone library. On the left the tones (built-in templates, then the user's), on
 * the right the signal chain of the one picked, like an amp app's. Tracks are given tones from here in the track
 * editor ("编辑音轨"). A page of its own (#/tones, opened from the top bar), laid over the score area; the open
 * song stays loaded, so the control bar can play it while a tone is set.
 */
export function TonePage() {
  const { state, player } = usePlayer()
  const { t } = useLanguage()
  const { library, error: libraryError } = useTones()
  const [selectedId, setSelectedId] = useState(() => library.custom[0]?.id ?? 'distortion')
  const tone = findTone(library, selectedId) ?? allTones(library)[0]
  const [draft, setDraft] = useState<ToneChain>(tone.chain)
  const [family, setFamily] = useState<ToneFamily>(tone.family)
  const [editedTone, setEditedTone] = useState(tone.id)
  const [selected, setSelected] = useState<ModuleId>('amp')
  const [naming, setNaming] = useState<'save' | 'rename' | null>(null)
  const [name, setName] = useState('')

  // Another tone picked (or the picked one deleted): start from what that tone has.
  if (editedTone !== tone.id) {
    setEditedTone(tone.id)
    setDraft(tone.chain)
    setFamily(tone.family)
    setNaming(null)
  }
  const dirty = !sameChain(draft, tone.chain) || family !== tone.family

  // What is heard is the draft: on the preview, and on the tracks of the open song that use this tone. Leaving
  // the page goes back to the saved tones.
  useEffect(() => {
    player.setEditedTone({ ...tone, family, chain: draft })
  }, [player, tone, family, draft])
  useEffect(() => () => player.setEditedTone(null), [player])

  const toneName = (item: { name: string; builtIn: boolean }) => (item.builtIn ? t(item.name) : item.name)
  const pick = (id: string) => {
    if (id === tone.id) return
    if (dirty && !window.confirm(t('音色的修改还没保存，确认切换吗？'))) return
    setSelectedId(id)
  }

  const setModule = (id: ModuleId, change: Partial<ToneChain[ModuleId]>) => setDraft({ ...draft, [id]: { ...draft[id], ...change } })
  const toggle = (id: ModuleId) => setModule(id, { on: !draft[id].on })
  // A new type starts from that type's defaults for the knobs it adds, keeping the shared ones.
  const changeType = (id: ModuleId, type: string) => setModule(id, { type, params: { ...defaultModule(id, true, type).params, ...draft[id].params } })
  const setParam = (id: ModuleId, key: string, value: number) => setModule(id, { params: { ...draft[id].params, [key]: value } })

  const saveOver = () => void toneStore.save({ ...tone, family, chain: draft })
  const commitName = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (naming === 'save') {
      const created: Tone = { id: newToneId(), name: trimmed, family, builtIn: false, chain: draft }
      void toneStore.save(created)
      setSelectedId(created.id)
    } else if (naming === 'rename') {
      void toneStore.save({ ...tone, name: trimmed })
    }
    setNaming(null)
  }
  const remove = () => {
    if (!window.confirm(t('确认删除音色"{name}"？', { name: tone.name }))) return
    void toneStore.remove(tone.id)
    setSelectedId(library.custom.find((item) => item.id !== tone.id)?.id ?? 'distortion')
  }

  const module = draft[selected]
  const spec = MODULES[selected]

  return (
    <div className={styles.page}>
      <section className={styles.content} aria-label={t('吉他音色编辑')}>
        <header className={styles.pageHeader}>
          <h1>{t('吉他音色编辑')}</h1>
        </header>

        <div className={styles.libraryLayout}>
          <nav className={styles.toneList} aria-label={t('音色库')}>
            {TONE_FAMILIES.map((item) => (
              <div key={item} className={styles.toneGroup}>
                <h3>{t(FAMILY_LABELS[item])}</h3>
                <ul>
                  {allTones(library)
                    .filter((entry) => entry.family === item)
                    .map((entry) => (
                      <li key={entry.id}>
                        <button type="button" aria-current={entry.id === tone.id ? 'true' : undefined} onClick={() => pick(entry.id)}>
                          <span>{toneName(entry)}</span>
                          {entry.builtIn && <small>{t('模板')}</small>}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </nav>

          <section className={panel.section}>
            <div className={styles.toneRow}>
              <h2 className={styles.toneTitle}>{toneName(tone)}</h2>
              <label className={styles.typeField}>
                <span>{t('用于')}</span>
                <select value={family} aria-label={t('用于')} onChange={(event) => setFamily(event.target.value as ToneFamily)}>
                  {TONE_FAMILIES.map((item) => (
                    <option key={item} value={item}>
                      {t(FAMILY_LABELS[item])}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={panel.preview}
                aria-pressed={state.previewingTone}
                disabled={!state.canPreview}
                onClick={() => (state.previewingTone ? player.stopTonePreview() : player.previewEditedTone(true))}
              >
                {state.previewingTone ? <Square size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                {state.previewingTone ? t('停止试听') : t('试听')}
              </button>
            </div>

          {/* The signal chain, in order: lit when a module is on; the one being edited is outlined. */}
          <div className={styles.chain} role="tablist" aria-label={t('信号链')}>
            {MODULE_ORDER.map((id) => {
              const Icon = MODULE_ICONS[id]
              return (
                <div key={id} className={styles.block} data-on={draft[id].on || undefined} data-selected={selected === id || undefined}>
                  <button type="button" role="tab" aria-selected={selected === id} className={styles.blockMain} onClick={() => setSelected(id)}>
                    <Icon size={18} aria-hidden />
                    <span>{t(MODULES[id].label)}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.blockPower}
                    aria-label={t('开关{name}', { name: t(MODULES[id].label) })}
                    aria-pressed={draft[id].on}
                    title={draft[id].on ? t('已开启') : t('已关闭')}
                    onClick={() => toggle(id)}
                  >
                    <Power size={12} aria-hidden />
                  </button>
                </div>
              )
            })}
          </div>

          <div className={styles.modulePanel} role="tabpanel" aria-label={t(spec.label)}>
            <div className={styles.moduleHead}>
              <strong>{t(spec.label)}</strong>
              <label className={panel.check}>
                <input type="checkbox" checked={module.on} onChange={() => toggle(selected)} aria-label={t('开启')} />
                {t('开启')}
              </label>
              {spec.types.length > 1 && (
                <label className={styles.typeField}>
                  <span>{t('类型')}</span>
                  <select value={module.type} aria-label={t('类型')} onChange={(event) => changeType(selected, event.target.value)}>
                    {spec.types.map((item) => (
                      <option key={item.id} value={item.id}>
                        {t(item.label)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className={styles.knobs} data-off={!module.on || undefined}>
              {paramsFor(selected, module.type).map((param) => (
                <label key={param.key} className={styles.knob}>
                  <span>{t(param.label)}</span>
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={module.params[param.key]}
                    aria-label={t(param.label)}
                    onChange={(event) => setParam(selected, param.key, Number(event.target.value))}
                  />
                  <output>{formatValue(param, module.params[param.key])}</output>
                </label>
              ))}
            </div>
          </div>

          {naming && (
            <div className={styles.naming}>
              <input
                type="text"
                value={name}
                maxLength={40}
                autoFocus
                aria-label={t('音色名称')}
                placeholder={t('音色名称')}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitName()
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    setNaming(null)
                  }
                }}
              />
              <button type="button" className={panel.primary} disabled={!name.trim()} onClick={commitName}>
                {t('确定')}
              </button>
              <button type="button" className={panel.secondary} onClick={() => setNaming(null)}>
                {t('取消')}
              </button>
            </div>
          )}
          </section>
        </div>

        <footer className={panel.footer}>
          <button type="button" className={panel.secondary} disabled={!dirty} onClick={() => setDraft(tone.chain)}>
            {t('撤销修改')}
          </button>
          {!tone.builtIn && (
            <>
              <button
                type="button"
                className={panel.secondary}
                onClick={() => {
                  setName(tone.name)
                  setNaming('rename')
                }}
              >
                {t('改名')}
              </button>
              <button type="button" className={panel.secondary} onClick={remove}>
                {t('删除')}
              </button>
            </>
          )}
          <span className={panel.spacer} />
          <button
            type="button"
            className={panel.secondary}
            onClick={() => {
              setName(tone.builtIn ? `${t(tone.name)} 2` : `${tone.name} 2`)
              setNaming('save')
            }}
          >
            {t('另存为…')}
          </button>
          {!tone.builtIn && (
            <button type="button" className={panel.primary} disabled={!dirty} onClick={saveOver}>
              {t('保存')}
            </button>
          )}
        </footer>
        {libraryError && <p className={panel.message}>{t('音色库读写失败：{error}', { error: libraryError })}</p>}
        {tone.builtIn && dirty && <p className={panel.message}>{t('模板不能直接改，请另存为其他音色。')}</p>}
      </section>
    </div>
  )
}

import {
  ArrowUpDown,
  Download,
  Gauge,
  Guitar,
  Headphones,
  History,
  Languages,
  Metronome,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  Printer,
  Repeat,
  Repeat1,
  Settings,
  Sun,
  SunMoon,
  Timer,
  VolumeX,
  Activity,
  Rows3,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import * as api from '../api/client.ts'
import type { Revision } from '../api/client.ts'
import { useSong } from '../library/useSong.ts'
import { BPM_MAX, BPM_MIN, DENOMINATORS } from '../player/clicks.ts'
import { SPEED_MAX, SPEED_MIN, TRANSPOSE_MAX, TRANSPOSE_MIN, type Preferences } from '../player/controller.ts'
import { KEY_CHOICES, keyLabel, transposeKey } from '../player/solfege.ts'
import { usePlayer } from '../player/usePlayer.ts'
import { TrackList } from '../player/TrackList.tsx'
import { setLanguagePreference, useLanguage, type LanguagePreference } from '../ui/i18n.ts'
import { Popover } from '../ui/Popover.tsx'
import { setThemePreference, useTheme, type ThemePreference } from '../ui/theme.ts'
import styles from './ControlBar.module.css'

type PanelId = 'tracks' | 'speed' | 'transpose' | 'metronome' | 'history' | 'settings' | 'key'

const THEMES: Array<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: 'system', label: '跟随系统', icon: SunMoon },
  { value: 'light', label: '白天', icon: Sun },
  { value: 'dark', label: '夜间', icon: Moon },
]

const LANGUAGES: Array<{ value: LanguagePreference; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

const TAB_OPTIONS: Array<{ key: keyof Preferences; label: string; icon: LucideIcon }> = [
  { key: 'fourBarsPerLine', label: '每行显示4小节', icon: Rows3 },
  { key: 'showDynamics', label: '显示强弱', icon: Activity },
  { key: 'loopCountIn', label: '循环间计数', icon: Repeat1 },
]

interface ControlProps {
  icon: LucideIcon
  label: string
  /** Short text under the icon, e.g. the current speed. */
  value?: string
  /** Set for toggle buttons; undefined for buttons that open a popover or run an action. */
  pressed?: boolean
  /** Small label on the corner, e.g. the revision date. */
  badge?: string
  disabled?: boolean
  onClick: () => void
}

function Control({ icon: Icon, label, value, pressed, badge, disabled, onClick }: ControlProps) {
  return (
    <button
      type="button"
      className={styles.control}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={24} aria-hidden />
      {value && <span className={styles.value}>{value}</span>}
      {badge && <span className={styles.badge}>{badge}</span>}
    </button>
  )
}

const SPEED_PRESETS = [0.5, 0.75, 0.9, 1]

function shortDate(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  const two = (value: number) => String(value).padStart(2, '0')
  return `${two(date.getFullYear() % 100)}/${two(date.getMonth() + 1)}/${two(date.getDate())}`
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

// Button set and order are fixed by CLAUDE.md ("底部控制条"); don't add or remove without being asked.
export function ControlBar() {
  const { state, player } = usePlayer()
  const { song, replace, open: openSong } = useSong()
  const { t } = useLanguage()
  const free = state.freeMetronome
  // A popover belongs to the song it was opened for; switching songs closes it.
  const [openPanel, setOpenPanel] = useState<{ id: PanelId; songId: number | undefined } | null>(null)
  const panel = openPanel && openPanel.songId === song?.id ? openPanel.id : null
  const ready = state.status === 'ready'
  const current = state.tracks.find((track) => track.index === state.trackIndex)

  const toggle = (id: PanelId) => setOpenPanel(panel === id ? null : { id, songId: song?.id })
  const close = () => setOpenPanel(null)

  const popover = (id: PanelId, control: ReactNode, content: ReactNode, label: string) => (
    <Popover open={panel === id} onClose={close} trigger={control} placement="above" label={label}>
      {content}
    </Popover>
  )

  const download = () => {
    const bytes = player.exportGuitarPro()
    if (!bytes) return
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${[state.artist, state.title].filter(Boolean).join(' - ') || 'tab'}.gp`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <footer className={styles.controlBar}>
      <div className={styles.side}>
        {state.noteNames && popover('key', <NoteNamesBox onClick={() => toggle('key')} />, <KeyPanel onPick={close} />, t('唱名的调'))}
      </div>
      <div className={styles.buttons}>
        {popover(
          'tracks',
          <Control icon={Guitar} label={t('乐器')} disabled={!ready} onClick={() => toggle('tracks')} />,
          <TrackList />,
          t('乐器与混音'),
        )}

        {popover(
          'speed',
          <Control
            icon={Gauge}
            label={t('速度')}
            value={`${Math.round(state.speed * 100)}%`}
            disabled={!ready}
            onClick={() => toggle('speed')}
          />,
          <div className={styles.field}>
            <div className={styles.fieldHead}>
              <span>{t('速度')}</span>
              <output>{Math.round(state.speed * 100)}%</output>
            </div>
            <input
              type="range"
              min={SPEED_MIN * 100}
              max={SPEED_MAX * 100}
              step={5}
              value={Math.round(state.speed * 100)}
              aria-label={t('速度百分比')}
              onChange={(event) => player.setSpeed(Number(event.target.value) / 100)}
            />
            <div className={styles.presets}>
              {SPEED_PRESETS.map((preset) => (
                <button key={preset} type="button" aria-pressed={state.speed === preset} onClick={() => player.setSpeed(preset)}>
                  {preset * 100}%
                </button>
              ))}
            </div>
          </div>,
          t('速度'),
        )}

        <Control icon={Repeat} label={t('循环')} pressed={state.looping} disabled={!ready} onClick={() => player.setLooping(!state.looping)} />

        <button
          type="button"
          className={styles.play}
          title={state.countingIn ? t('预备拍中，点击取消') : state.playing ? t('暂停') : t('播放')}
          aria-label={state.playing ? t('暂停') : t('播放')}
          data-counting-in={state.countingIn || undefined}
          disabled={!ready || !state.canPlay}
          onClick={() => player.playPause()}
        >
          {state.playing ? <Pause size={31} aria-hidden /> : <Play size={31} aria-hidden />}
        </button>
        {/* Only the synthesizer exists here; the original-audio slot is kept but disabled (see CLAUDE.md). */}
        <div className={styles.source} role="radiogroup" aria-label={t('音源')}>
          <button type="button" role="radio" aria-checked={false} disabled>
            {t('原声')}
          </button>
          <button type="button" role="radio" aria-checked={true}>
            {t('合成')}
          </button>
        </div>

        {popover(
          'transpose',
          <Control
            icon={ArrowUpDown}
            label={t('移调')}
            value={state.transpose === 0 ? undefined : signed(state.transpose)}
            disabled={!ready || state.editing !== null}
            onClick={() => toggle('transpose')}
          />,
          <div className={styles.field}>
            <div className={styles.fieldHead}>
              <span>{t('移调（半音）')}</span>
              <output>{signed(state.transpose)}</output>
            </div>
            <div className={styles.stepper}>
              <button
                type="button"
                aria-label={t('降半音')}
                disabled={state.transpose <= TRANSPOSE_MIN}
                onClick={() => player.setTranspose(state.transpose - 1)}
              >
                <Minus size={16} aria-hidden />
              </button>
              <button type="button" disabled={state.transpose === 0} onClick={() => player.setTranspose(0)}>
                {t('还原')}
              </button>
              <button
                type="button"
                aria-label={t('升半音')}
                disabled={state.transpose >= TRANSPOSE_MAX}
                onClick={() => player.setTranspose(state.transpose + 1)}
              >
                <Plus size={16} aria-hidden />
              </button>
            </div>
            <p className={styles.hint}>{t('音高和谱面上的品位一起变化；有变调夹的音轨优先移动变调夹。鼓不受影响。')}</p>
            {state.transposeOutOfRange > 0 && (
              <p className={styles.hint}>{t('有 {n} 个音超出了乐器的音域，已改在相差八度的位置。', { n: state.transposeOutOfRange })}</p>
            )}
          </div>,
          t('移调'),
        )}

        <Control
          icon={Headphones}
          label={t('独奏')}
          pressed={current?.solo ?? false}
          disabled={!ready}
          onClick={() => current && player.setTrackSolo(current.index, !current.solo)}
        />
        <Control
          icon={VolumeX}
          label={t('静音')}
          pressed={current?.mute ?? false}
          disabled={!ready}
          onClick={() => current && player.setTrackMute(current.index, !current.mute)}
        />
        <Control icon={Timer} label={t('预备拍')} pressed={state.countIn} disabled={!ready} onClick={() => player.setCountIn(!state.countIn)} />
        {popover(
          'metronome',
          // Lit while either kind of metronome is on. It works without a song, for warming up.
          <Control icon={Metronome} label={t('节拍器')} pressed={state.metronome || free.running} onClick={() => toggle('metronome')} />,
          <div className={styles.field}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={state.metronome}
                disabled={!ready}
                onChange={(event) => player.setMetronome(event.target.checked)}
              />
              {t('播放时跟随曲谱打拍')}
            </label>

            <div className={styles.fieldHead}>
              <span>{t('自由节拍器')}</span>
              <output>{free.running ? t('运行中') : t('已停止')}</output>
            </div>
            <div className={styles.row}>
              <label className={styles.inline}>
                BPM
                <input
                  type="number"
                  min={BPM_MIN}
                  max={BPM_MAX}
                  step={1}
                  value={free.bpm}
                  aria-label={t('节拍器 BPM')}
                  onChange={(event) => player.setFreeMetronome({ bpm: Number(event.target.value) })}
                />
              </label>
              <label className={styles.inline}>
                {t('拍号')}
                <input
                  type="number"
                  min={1}
                  max={16}
                  step={1}
                  value={free.numerator}
                  aria-label={t('每小节拍数')}
                  onChange={(event) => player.setFreeMetronome({ numerator: Number(event.target.value) })}
                />
                <span aria-hidden>/</span>
                <select
                  value={free.denominator}
                  aria-label={t('以几分音符为一拍')}
                  onChange={(event) => player.setFreeMetronome({ denominator: Number(event.target.value) })}
                >
                  {DENOMINATORS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <input
              type="range"
              min={BPM_MIN}
              max={BPM_MAX}
              step={1}
              value={free.bpm}
              aria-label={t('节拍器 BPM 滑块')}
              onChange={(event) => player.setFreeMetronome({ bpm: Number(event.target.value) })}
            />
            <div className={styles.presets}>
              <button type="button" aria-pressed={free.running} onClick={() => player.toggleFreeMetronome()}>
                {free.running ? t('停止') : t('开始')}
              </button>
              <button type="button" disabled={!ready} onClick={() => player.matchFreeMetronomeToSong()}>
                {t('取当前曲速')}
              </button>
            </div>
            <p className={styles.hint}>{t('BPM 按四分音符计；拍号决定每拍的时值和重音位置。')}</p>
          </div>,
          t('节拍器'),
        )}
        <Control icon={Download} label={t('下载')} disabled={!ready} onClick={download} />
        <Control icon={Printer} label={t('打印')} disabled={!ready} onClick={() => player.print()} />

        {popover(
          'history',
          <Control
            icon={History}
            label={t('修订历史')}
            badge={shortDate(song?.revisionDate)}
            disabled={!ready || song?.source !== 'songsterr' || state.editing !== null}
            onClick={() => toggle('history')}
          />,
          song && (
            <RevisionList
              songId={song.id}
              currentRevisionId={song.revisionId}
              onSwitch={async (revisionId) => {
                // Edits belong to one revision; the server drops them when switching.
                if (song.edited && !window.confirm(t('切换修订会丢掉你对这首曲谱保存过的修改，继续吗？'))) return
                replace(await api.switchRevision(song.id, revisionId))
                close()
                await openSong(song.id)
              }}
            />
          ),
          t('修订历史'),
        )}

        {popover('settings', <Control icon={Settings} label={t('设置')} onClick={() => toggle('settings')} />, <SettingsPanel />, t('设置'))}
      </div>
      <div className={styles.side} />
    </footer>
  )
}

/** The settings popover, laid out like the reference: appearance and language, then options for the tab. */
function SettingsPanel() {
  const { state, player } = usePlayer()
  const theme = useTheme()
  const { preference: language, t } = useLanguage()

  return (
    <div className={styles.settings}>
      <div className={styles.group}>
        <div className={styles.settingRow}>
          <span className={styles.settingIcon} data-tone="violet" aria-hidden>
            <SunMoon size={18} />
          </span>
          <span className={styles.settingLabel}>{t('外观')}</span>
          <div className={styles.segmented} role="radiogroup" aria-label={t('主题')}>
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={theme.preference === option.value}
                aria-label={t(option.label)}
                title={t(option.label)}
                onClick={() => setThemePreference(option.value)}
              >
                <option.icon size={18} aria-hidden />
              </button>
            ))}
          </div>
        </div>
        <div className={styles.settingRow}>
          <span className={styles.settingIcon} data-tone="purple" aria-hidden>
            <Languages size={18} />
          </span>
          <span className={styles.settingLabel}>{t('语言')}</span>
          <select
            className={styles.settingSelect}
            aria-label={t('语言')}
            value={language}
            onChange={(event) => setLanguagePreference(event.target.value as LanguagePreference)}
          >
            {LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value === 'auto' ? t(option.label) : option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h3 className={styles.groupTitle}>{t('谱子')}</h3>
      <div className={styles.group}>
        {TAB_OPTIONS.map((option) => (
          <Switch
            key={option.key}
            icon={option.icon}
            label={t(option.label)}
            checked={state.preferences[option.key]}
            onChange={(checked) => player.setPreferences({ [option.key]: checked })}
          />
        ))}
        <Switch
          icon={Rows3}
          label={t('同时显示五线谱')}
          checked={state.showNotation}
          onChange={(checked) => player.setShowNotation(checked)}
        />
        <div className={styles.settingRow}>
          <span className={styles.settingIcon} data-tone="grey" aria-hidden>
            <Plus size={18} />
          </span>
          <span className={styles.settingLabel}>{t('谱面缩放')}</span>
          <input
            type="range"
            className={styles.settingRange}
            min={50}
            max={200}
            step={10}
            value={Math.round(state.zoom * 100)}
            aria-label={t('谱面缩放')}
            onChange={(event) => player.setZoom(Number(event.target.value) / 100)}
          />
          <output className={styles.settingValue}>{Math.round(state.zoom * 100)}%</output>
        </div>
      </div>

      {state.range && (
        <button type="button" className={styles.plain} onClick={() => player.clearRange()}>
          {t('清除循环选区')}
        </button>
      )}
    </div>
  )
}

function Switch({ icon: Icon, label, checked, onChange }: { icon: LucideIcon; label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={styles.settingRow}>
      <span className={styles.settingIcon} data-tone="blue" aria-hidden>
        <Icon size={18} />
      </span>
      <span className={styles.settingLabel}>{label}</span>
      <input type="checkbox" role="switch" className={styles.switch} checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

interface RevisionListProps {
  songId: number
  currentRevisionId: number | null
  onSwitch: (revisionId: number) => Promise<void>
}

function RevisionList({ songId, currentRevisionId, onSwitch }: RevisionListProps) {
  const { t } = useLanguage()
  const [revisions, setRevisions] = useState<Revision[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [switching, setSwitching] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getRevisions(songId)
      .then((list) => !cancelled && setRevisions(list))
      .catch((cause) => !cancelled && setError((cause as Error).message))
    return () => {
      cancelled = true
    }
  }, [songId])

  if (error) return <p className={styles.hint}>{error}</p>
  if (!revisions) return <p className={styles.hint}>{t('正在读取修订历史…')}</p>
  if (revisions.length === 0) return <p className={styles.hint}>{t('没有修订记录。')}</p>

  return (
    <ul className={styles.revisions}>
      {revisions.map((revision) => {
        const isCurrent = revision.revisionId === currentRevisionId
        return (
          <li key={revision.revisionId}>
            <button
              type="button"
              aria-current={isCurrent ? 'true' : undefined}
              disabled={isCurrent || switching !== null}
              onClick={async () => {
                setSwitching(revision.revisionId)
                try {
                  await onSwitch(revision.revisionId)
                } catch (cause) {
                  setError((cause as Error).message)
                  setSwitching(null)
                }
              }}
            >
              <span className={styles.revisionDate}>
                {shortDate(revision.createdAt)}
                {isCurrent && t('（当前）')}
                {switching === revision.revisionId && t('（切换中…）')}
              </span>
              <span className={styles.revisionNote}>
                {[revision.author, revision.description].filter(Boolean).join(' · ') || `#${revision.revisionId}`}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** The solfège of the beat at the cursor, so the notes can be sung or named while practising. Opens the key menu. */
function NoteNamesBox({ onClick }: { onClick: () => void }) {
  const { state } = usePlayer()
  const { t } = useLanguage()
  const notes = state.noteNames
  if (!notes) return null
  const text = notes.percussion ? '—' : notes.names.join(' ')
  const title = notes.percussion ? t('鼓轨没有唱名') : notes.manual ? t('唱名（手动指定的调，点击更改）') : t('唱名（谱子的调，点击可手动指定）')
  return (
    <button type="button" className={styles.noteNames} aria-label={t('唱名')} title={title} onClick={onClick}>
      <span className={styles.noteNamesKey}>
        {notes.key}
        {notes.manual && <span className={styles.noteNamesManual}>{t('手动')}</span>}
      </span>
      <span className={styles.noteNamesText} role="status" aria-label={t('当前唱名')}>
        {text}
      </span>
    </button>
  )
}

/** Which key the note names are read in: the tab's own, or one of the twelve major keys. */
function KeyPanel({ onPick }: { onPick: () => void }) {
  const { state, player } = usePlayer()
  const { t } = useLanguage()
  const tabKey = state.noteNames?.tabKey ?? '1=C'
  // A picked key is stored for the untransposed tab; what is shown is moved with the transposition.
  const pick = (key: number | null) => {
    player.setManualKey(key)
    onPick()
  }
  return (
    <div className={styles.keyPanel}>
      <button type="button" className={styles.keyFollow} aria-pressed={state.manualKey === null} onClick={() => pick(null)}>
        {t('跟随谱子（{key}）', { key: tabKey })}
      </button>
      <p className={styles.keyHint}>{t('谱子没写调号时按 C 调读。也可以指定这首曲子的调：')}</p>
      <div className={styles.keyGrid}>
        {KEY_CHOICES.map((key) => (
          <button key={key} type="button" aria-pressed={state.manualKey === key} onClick={() => pick(key)}>
            {keyLabel(transposeKey(key, state.transpose))}
          </button>
        ))}
      </div>
      {state.transpose !== 0 && <p className={styles.keyHint}>{t('已移调 {n} 个半音，列表里的调已跟着移动。', { n: signed(state.transpose) })}</p>}
    </div>
  )
}

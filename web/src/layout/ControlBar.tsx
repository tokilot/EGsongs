import {
  ArrowUpDown,
  Download,
  Gauge,
  Guitar,
  Headphones,
  History,
  Metronome,
  Minus,
  Pause,
  Play,
  Plus,
  Printer,
  Repeat,
  Settings,
  Timer,
  VolumeX,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import * as api from '../api/client.ts'
import type { Revision } from '../api/client.ts'
import { useSong } from '../library/useSong.ts'
import { BPM_MAX, BPM_MIN, DENOMINATORS } from '../player/clicks.ts'
import { SPEED_MAX, SPEED_MIN, TRANSPOSE_MAX, TRANSPOSE_MIN } from '../player/controller.ts'
import { usePlayer } from '../player/usePlayer.ts'
import { TrackList } from '../player/TrackList.tsx'
import { Popover } from '../ui/Popover.tsx'
import { setThemePreference, useTheme, type ThemePreference } from '../ui/theme.ts'
import styles from './ControlBar.module.css'

type PanelId = 'tracks' | 'speed' | 'transpose' | 'metronome' | 'history' | 'settings'

const THEMES: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '白天' },
  { value: 'dark', label: '夜间' },
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
      <Icon size={20} aria-hidden />
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
  const theme = useTheme()
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
      {popover(
        'tracks',
        <Control icon={Guitar} label="乐器" disabled={!ready} onClick={() => toggle('tracks')} />,
        <TrackList />,
        '乐器与混音',
      )}

      {popover(
        'speed',
        <Control
          icon={Gauge}
          label="速度"
          value={`${Math.round(state.speed * 100)}%`}
          disabled={!ready}
          onClick={() => toggle('speed')}
        />,
        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <span>速度</span>
            <output>{Math.round(state.speed * 100)}%</output>
          </div>
          <input
            type="range"
            min={SPEED_MIN * 100}
            max={SPEED_MAX * 100}
            step={5}
            value={Math.round(state.speed * 100)}
            aria-label="速度百分比"
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
        '速度',
      )}

      <Control icon={Repeat} label="循环" pressed={state.looping} disabled={!ready} onClick={() => player.setLooping(!state.looping)} />

      <button
        type="button"
        className={styles.play}
        title={state.countingIn ? '预备拍中，点击取消' : state.playing ? '暂停' : '播放'}
        aria-label={state.playing ? '暂停' : '播放'}
        data-counting-in={state.countingIn || undefined}
        disabled={!ready || !state.canPlay}
        onClick={() => player.playPause()}
      >
        {state.playing ? <Pause size={26} aria-hidden /> : <Play size={26} aria-hidden />}
      </button>
      {/* Only the synthesizer exists here; the original-audio slot is kept but disabled (see CLAUDE.md). */}
      <div className={styles.source} role="radiogroup" aria-label="音源">
        <button type="button" role="radio" aria-checked={false} disabled>
          原声
        </button>
        <button type="button" role="radio" aria-checked={true}>
          合成
        </button>
      </div>

      {popover(
        'transpose',
        <Control
          icon={ArrowUpDown}
          label="移调"
          value={state.transpose === 0 ? undefined : signed(state.transpose)}
          disabled={!ready}
          onClick={() => toggle('transpose')}
        />,
        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <span>移调（半音）</span>
            <output>{signed(state.transpose)}</output>
          </div>
          <div className={styles.stepper}>
            <button
              type="button"
              aria-label="降半音"
              disabled={state.transpose <= TRANSPOSE_MIN}
              onClick={() => player.setTranspose(state.transpose - 1)}
            >
              <Minus size={16} aria-hidden />
            </button>
            <button type="button" disabled={state.transpose === 0} onClick={() => player.setTranspose(0)}>
              还原
            </button>
            <button
              type="button"
              aria-label="升半音"
              disabled={state.transpose >= TRANSPOSE_MAX}
              onClick={() => player.setTranspose(state.transpose + 1)}
            >
              <Plus size={16} aria-hidden />
            </button>
          </div>
          <p className={styles.hint}>
            音高和谱面上的品位一起变化；有变调夹的音轨优先移动变调夹。鼓不受影响。
          </p>
          {state.transposeOutOfRange > 0 && (
            <p className={styles.hint}>有 {state.transposeOutOfRange} 个音超出了乐器的音域，已改在相差八度的位置。</p>
          )}
        </div>,
        '移调',
      )}

      <Control
        icon={Headphones}
        label="独奏"
        pressed={current?.solo ?? false}
        disabled={!ready}
        onClick={() => current && player.setTrackSolo(current.index, !current.solo)}
      />
      <Control
        icon={VolumeX}
        label="静音"
        pressed={current?.mute ?? false}
        disabled={!ready}
        onClick={() => current && player.setTrackMute(current.index, !current.mute)}
      />
      <Control icon={Timer} label="预备拍" pressed={state.countIn} disabled={!ready} onClick={() => player.setCountIn(!state.countIn)} />
      {popover(
        'metronome',
        // Lit while either kind of metronome is on. It works without a song, for warming up.
        <Control icon={Metronome} label="节拍器" pressed={state.metronome || free.running} onClick={() => toggle('metronome')} />,
        <div className={styles.field}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={state.metronome}
              disabled={!ready}
              onChange={(event) => player.setMetronome(event.target.checked)}
            />
            播放时跟随曲谱打拍
          </label>

          <div className={styles.fieldHead}>
            <span>自由节拍器</span>
            <output>{free.running ? '运行中' : '已停止'}</output>
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
                aria-label="节拍器 BPM"
                onChange={(event) => player.setFreeMetronome({ bpm: Number(event.target.value) })}
              />
            </label>
            <label className={styles.inline}>
              拍号
              <input
                type="number"
                min={1}
                max={16}
                step={1}
                value={free.numerator}
                aria-label="每小节拍数"
                onChange={(event) => player.setFreeMetronome({ numerator: Number(event.target.value) })}
              />
              <span aria-hidden>/</span>
              <select
                value={free.denominator}
                aria-label="以几分音符为一拍"
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
            aria-label="节拍器 BPM 滑块"
            onChange={(event) => player.setFreeMetronome({ bpm: Number(event.target.value) })}
          />
          <div className={styles.presets}>
            <button type="button" aria-pressed={free.running} onClick={() => player.toggleFreeMetronome()}>
              {free.running ? '停止' : '开始'}
            </button>
            <button type="button" disabled={!ready} onClick={() => player.matchFreeMetronomeToSong()}>
              取当前曲速
            </button>
          </div>
          <p className={styles.hint}>BPM 按四分音符计；拍号决定每拍的时值和重音位置。</p>
        </div>,
        '节拍器',
      )}
      <Control icon={Download} label="下载" disabled={!ready} onClick={download} />
      <Control icon={Printer} label="打印" disabled={!ready} onClick={() => player.print()} />

      {popover(
        'history',
        <Control
          icon={History}
          label="修订历史"
          badge={shortDate(song?.revisionDate)}
          disabled={!ready || song?.source !== 'songsterr'}
          onClick={() => toggle('history')}
        />,
        song && (
          <RevisionList
            songId={song.id}
            currentRevisionId={song.revisionId}
            onSwitch={async (revisionId) => {
              replace(await api.switchRevision(song.id, revisionId))
              close()
              await openSong(song.id)
            }}
          />
        ),
        '修订历史',
      )}

      {popover(
        'settings',
        <Control icon={Settings} label="设置" onClick={() => toggle('settings')} />,
        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <span>主题</span>
          </div>
          <div className={styles.presets} role="radiogroup" aria-label="主题">
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={theme.preference === option.value}
                aria-pressed={theme.preference === option.value}
                onClick={() => setThemePreference(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className={styles.fieldHead}>
            <span>谱面缩放</span>
            <output>{Math.round(state.zoom * 100)}%</output>
          </div>
          <input
            type="range"
            min={50}
            max={200}
            step={10}
            value={Math.round(state.zoom * 100)}
            aria-label="谱面缩放"
            onChange={(event) => player.setZoom(Number(event.target.value) / 100)}
          />
          <label className={styles.check}>
            <input type="checkbox" checked={state.showNotation} onChange={(event) => player.setShowNotation(event.target.checked)} />
            同时显示五线谱
          </label>
          {state.range && (
            <button type="button" className={styles.plain} onClick={() => player.clearRange()}>
              清除循环选区
            </button>
          )}
        </div>,
        '设置',
      )}
    </footer>
  )
}

interface RevisionListProps {
  songId: number
  currentRevisionId: number | null
  onSwitch: (revisionId: number) => Promise<void>
}

function RevisionList({ songId, currentRevisionId, onSwitch }: RevisionListProps) {
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
  if (!revisions) return <p className={styles.hint}>正在读取修订历史…</p>
  if (revisions.length === 0) return <p className={styles.hint}>没有修订记录。</p>

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
                {isCurrent && '（当前）'}
                {switching === revision.revisionId && '（切换中…）'}
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

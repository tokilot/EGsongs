import { model } from '@coderline/alphatab'
import { ArrowDown, ArrowUp, Plus, Redo2, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useSong } from '../library/useSong.ts'
import { useTabEditing } from '../library/useTabEditing.ts'
import type { Box } from '../player/controller.ts'
import { CHORD_QUALITIES, CHORD_ROOTS, chordName, parseChord } from '../player/chords.ts'
import { DURATIONS, MAX_FRET, TREMOLO_MARKS, TUPLETS, type BeatFlag, type BendKind, type GraceKind, type NoteFlag, type SlideKind, type StrokeKind, type TabEditor, type WhammyKind } from '../player/tabEditor.ts'
import { usePlayer } from '../player/usePlayer.ts'
import { useLanguage, type Translate } from '../ui/i18n.ts'
import styles from './EditPanel.module.css'

type Tab = 'note' | 'rhythm' | 'effects' | 'dynamics' | 'bar' | 'text'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'note', label: '音符' },
  { id: 'rhythm', label: '节奏' },
  { id: 'effects', label: '效果' },
  { id: 'dynamics', label: '力度' },
  { id: 'bar', label: '小节' },
  { id: 'text', label: '文字' },
]

const DURATION_LABELS: Record<number, string> = { 1: '1', 2: '1/2', 4: '1/4', 8: '1/8', 16: '1/16', 32: '1/32', 64: '1/64' }
const DYNAMICS: Array<[model.DynamicValue, string]> = [
  [model.DynamicValue.PPP, 'ppp'],
  [model.DynamicValue.PP, 'pp'],
  [model.DynamicValue.P, 'p'],
  [model.DynamicValue.MP, 'mp'],
  [model.DynamicValue.MF, 'mf'],
  [model.DynamicValue.F, 'f'],
  [model.DynamicValue.FF, 'ff'],
  [model.DynamicValue.FFF, 'fff'],
]
const KEYS = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯']

const NOTE_FLAGS: [NoteFlag, string, string?][] = [
  ['hammer', '击弦 / 勾弦', 'H'],
  ['tie', '延音线', 'T'],
  ['dead', '哑音', 'X'],
  ['ghost', '幽灵音', 'G'],
  ['staccato', '断奏'],
  ['pickScrape', '刮弦'],
  ['leftHandTap', '左手点弦'],
]
const BEAT_FLAGS: [BeatFlag, string, string?][] = [
  ['palmMute', '手掌闷音', 'P'],
  ['letRing', '延音（let ring）', 'L'],
  ['tap', '点弦'],
  ['slap', '拍弦'],
  ['pop', '勾弦（贝斯）'],
  ['deadSlapped', '拍击哑音'],
  ['fermata', '延长记号'],
]

const PANEL_WIDTH = 560
const GAP = 8

/** The floating edit panel, shown next to the beat being edited once a position has been picked. */
export function EditPanel() {
  const { state, player } = usePlayer()
  const { t } = useLanguage()
  const edit = state.editing
  const panel = useRef<HTMLDivElement>(null)
  const [above, setAbove] = useState(false)
  const [stageWidth, setStageWidth] = useState(PANEL_WIDTH)
  const anchor = edit?.selected ? edit.beatBox : null

  // Below the beat by default; above it when there is not enough room below in the visible score area.
  useLayoutEffect(() => {
    const element = panel.current
    const scroller = element?.closest('main')
    if (!element || !scroller || !anchor) return
    const view = scroller.getBoundingClientRect()
    const stage = element.parentElement!.getBoundingClientRect()
    const height = element.offsetHeight
    const belowTop = stage.top + anchor.y + anchor.h + GAP
    const aboveTop = stage.top + anchor.y - GAP - height
    setAbove(belowTop + height > view.bottom && aboveTop >= view.top)
    setStageWidth(stage.width)
  }, [anchor])

  if (!edit || !anchor) return null
  const left = Math.max(0, Math.min(anchor.x + anchor.w / 2 - PANEL_WIDTH / 2, stageWidth - PANEL_WIDTH))
  const position: Pick<Box, 'x' | 'y'> = { x: left, y: above ? anchor.y - GAP : anchor.y + anchor.h + GAP }

  return (
    <div
      ref={panel}
      className={styles.panel}
      data-above={above || undefined}
      style={{ left: position.x, top: position.y, width: PANEL_WIDTH }}
      role="dialog"
      aria-label={t('曲谱编辑')}
      // Clicks inside the panel are not clicks on the score.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <PanelContent run={(command) => player.edit(command)} />
    </div>
  )
}

function PanelContent({ run }: { run: (command: (editor: TabEditor) => void) => void }) {
  const { state, player } = usePlayer()
  const { song } = useSong()
  const editing = useTabEditing()
  const { t } = useLanguage()
  const [tab, setTab] = useState('note' as Tab)
  const edit = state.editing!

  const fill = edit.barFill === 'full' ? null : edit.barFill === 'short' ? t('小节时值不足') : t('小节时值超出')

  return (
    <>
      <header className={styles.header}>
        <span className={styles.position}>
          {t('第 {bar} 小节 · 第 {beat}/{beats} 拍 · 第 {string} 弦', {
            bar: edit.cursor.bar + 1,
            beat: edit.cursor.beat + 1,
            beats: edit.beatCount,
            // Strings are numbered for the player from the thinnest (1) down.
            string: edit.stringCount - edit.cursor.string + 1,
          })}
          {edit.note && <strong className={styles.fret}>{t('品位 {fret}', { fret: edit.note.fret })}</strong>}
          {fill && <span className={styles.warning}>{fill}</span>}
        </span>
        <span className={styles.spacer} />
        <IconButton label={t('撤销')} shortcut="Ctrl+Z" disabled={!edit.canUndo} onClick={() => run((editor) => editor.undo())}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton label={t('重做')} shortcut="Ctrl+Y" disabled={!edit.canRedo} onClick={() => run((editor) => editor.redo())}>
          <Redo2 size={15} />
        </IconButton>
        {song?.edited && (
          <IconButton label={t('恢复原谱')} disabled={editing.busy} onClick={() => void editing.restoreOriginal()}>
            <RotateCcw size={15} />
          </IconButton>
        )}
        <IconButton label={t('放弃修改')} disabled={editing.busy} onClick={editing.discard}>
          <Trash2 size={15} />
        </IconButton>
        <IconButton label={t('收起')} shortcut="Esc" onClick={() => player.deselect()}>
          <X size={15} />
        </IconButton>
      </header>

      {!edit.editable ? (
        <p className={styles.hint}>{t('鼓轨不能编辑，请在乐器里切换到其他音轨。')}</p>
      ) : (
        <>
          <nav className={styles.tabs} role="tablist">
            {TABS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => setTab(item.id)}>
                {t(item.label)}
              </button>
            ))}
          </nav>
          <div className={styles.body}>
            {tab === 'note' && <NoteTab run={run} t={t} />}
            {tab === 'rhythm' && <RhythmTab run={run} t={t} />}
            {tab === 'effects' && <EffectsTab run={run} t={t} />}
            {tab === 'dynamics' && <DynamicsTab run={run} t={t} />}
            {tab === 'bar' && <BarTab run={run} t={t} />}
            {tab === 'text' && <TextTab run={run} t={t} />}
          </div>
          <p className={styles.hint}>{t('点谱面选位置；方向键移动，数字键输入品位，Delete 删除音，+ / - 改时值，Ctrl+S 保存。')}</p>
        </>
      )}
    </>
  )
}

interface TabProps {
  run: (command: (editor: TabEditor) => void) => void
  t: Translate
}

function NoteTab({ run, t }: TabProps) {
  const edit = usePlayer().state.editing!
  const note = edit.note
  const cursor = `${edit.cursor.bar}:${edit.cursor.beat}:${edit.cursor.string}`
  const fret = (
    <Row label={t('品位')}>
      <FretField key={cursor} label={t('品位')} value={note?.fret ?? null} onCommit={(value) => run((editor) => (value === null ? editor.removeNote() : editor.setFret(value)))} />
      {!note && <span className={styles.hint}>{t('这根弦上还没有音，输入品位后回车即可添加。')}</span>}
    </Row>
  )
  if (!note) return fret
  return (
    <>
      {fret}
      <Row label={t('音符')}>
        <Button label={t('移到上一根弦')} onClick={() => run((editor) => editor.moveNote(1))}>
          <ArrowUp size={14} /> {t('上一根弦')}
        </Button>
        <Button label={t('移到下一根弦')} onClick={() => run((editor) => editor.moveNote(-1))}>
          <ArrowDown size={14} /> {t('下一根弦')}
        </Button>
        <Button label={t('删除音')} shortcut="Delete" onClick={() => run((editor) => editor.removeNote())}>
          <Trash2 size={14} /> {t('删除音')}
        </Button>
      </Row>
      <Row label={t('技巧')}>
        {NOTE_FLAGS.map(([flag, label, key]) => (
          <Button key={flag} label={t(label)} shortcut={key} pressed={note.flags[flag]} onClick={() => run((editor) => editor.toggle(flag))}>
            {t(label)}
          </Button>
        ))}
      </Row>
      <Choice
        label={t('重音')}
        value={note.accent}
        options={[
          [model.AccentuationType.None, t('无')],
          [model.AccentuationType.Normal, t('重音')],
          [model.AccentuationType.Heavy, t('强重音')],
        ]}
        onPick={(value) => run((editor) => editor.setAccent(value))}
      />
      <Choice<SlideKind>
        label={t('滑音')}
        value={note.slide}
        options={[
          ['none', t('无')],
          ['legato', t('连滑')],
          ['shift', t('滑奏')],
          ['inBelow', t('从下滑入')],
          ['inAbove', t('从上滑入')],
          ['outDown', t('向下滑出')],
          ['outUp', t('向上滑出')],
        ]}
        onPick={(value) => run((editor) => editor.setSlide(value))}
      />
      <Choice<BendKind>
        label={t('推弦')}
        value={note.bend}
        options={[
          ['none', t('无')],
          ['half', t('半音')],
          ['full', t('全音')],
          ['oneAndHalf', t('一个半音')],
          ['bendRelease', t('推放')],
          ['preBend', t('预推')],
          ['preBendRelease', t('预推回')],
        ]}
        onPick={(value) => value !== 'custom' && run((editor) => editor.setBend(value))}
      />
      <Choice
        label={t('颤音')}
        value={note.vibrato}
        options={[
          [model.VibratoType.None, t('无')],
          [model.VibratoType.Slight, t('轻')],
          [model.VibratoType.Wide, t('宽')],
        ]}
        onPick={(value) => run((editor) => editor.setVibrato(value))}
      />
      <Choice
        label={t('泛音')}
        value={note.harmonic}
        options={[
          [model.HarmonicType.None, t('无')],
          [model.HarmonicType.Natural, t('自然泛音')],
          [model.HarmonicType.Artificial, t('人工泛音')],
          [model.HarmonicType.Pinch, t('拨弦泛音')],
          [model.HarmonicType.Tap, t('点弦泛音')],
          [model.HarmonicType.Semi, t('半泛音')],
        ]}
        onPick={(value) => run((editor) => editor.setHarmonic(value))}
      />
      <Row label={t('颤音装饰')}>
        <Button label={t('无')} pressed={note.trill === null} onClick={() => run((editor) => editor.setTrill(null))}>
          {t('无')}
        </Button>
        <NumberField
          label={t('与第几品交替')}
          value={note.trill ?? note.fret + 2}
          min={0}
          max={24}
          onCommit={(value) => run((editor) => editor.setTrill(value))}
        />
      </Row>
    </>
  )
}

function RhythmTab({ run, t }: TabProps) {
  const beat = usePlayer().state.editing!.beat
  return (
    <>
      <Choice
        label={t('时值')}
        value={beat.duration}
        options={DURATIONS.map((duration) => [duration, DURATION_LABELS[duration]] as [number, string])}
        onPick={(value) => run((editor) => editor.setDuration(value))}
        shortcut="+ / -"
      />
      <Choice
        label={t('附点')}
        value={beat.dots}
        options={[
          [0, t('无')],
          [1, t('附点')],
          [2, t('双附点')],
        ]}
        onPick={(value) => run((editor) => editor.setDots(value))}
      />
      <Choice
        label={t('连音')}
        value={beat.tuplet}
        options={[[0, t('无')] as [number, string], ...Object.keys(TUPLETS).map((notes) => [Number(notes), `${notes}:${TUPLETS[Number(notes)]}`] as [number, string])]}
        onPick={(value) => run((editor) => editor.setTuplet(value))}
      />
      <Choice<GraceKind>
        label={t('倚音')}
        value={beat.grace}
        options={[
          ['none', t('无')],
          ['before', t('拍前')],
          ['onBeat', t('拍上')],
        ]}
        onPick={(value) => run((editor) => editor.setGrace(value))}
      />
      <Row label={t('拍')}>
        <Button label={t('插入拍')} shortcut="Insert" onClick={() => run((editor) => editor.insertBeat())}>
          <Plus size={14} /> {t('插入拍')}
        </Button>
        <Button label={t('删除拍')} shortcut="Shift+Delete" onClick={() => run((editor) => editor.deleteBeat())}>
          <Trash2 size={14} /> {t('删除拍')}
        </Button>
        <Button label={t('设为休止')} shortcut="R" disabled={beat.isRest} onClick={() => run((editor) => editor.clearBeat())}>
          {t('休止')}
        </Button>
      </Row>
    </>
  )
}

function EffectsTab({ run, t }: TabProps) {
  const beat = usePlayer().state.editing!.beat
  return (
    <>
      <Row label={t('整拍')}>
        {BEAT_FLAGS.map(([flag, label, key]) => (
          <Button key={flag} label={t(label)} shortcut={key} pressed={beat.flags[flag]} onClick={() => run((editor) => editor.toggle(flag))}>
            {t(label)}
          </Button>
        ))}
      </Row>
      <Choice
        label={t('震音拨弦')}
        value={beat.tremolo ?? 0}
        options={[[0, t('无')] as [number, string], ...TREMOLO_MARKS.map((marks) => [marks, t('{n} 道斜线', { n: marks })] as [number, string])]}
        onPick={(value) => run((editor) => editor.setTremolo(value || null))}
      />
      <Choice<WhammyKind>
        label={t('摇把')}
        value={beat.whammy}
        options={[
          ['none', t('无')],
          ['dive', t('下压 1 全音')],
          ['deepDive', t('下压 2 全音')],
          ['dip', t('压后回弹')],
          ['preDive', t('预压')],
        ]}
        onPick={(value) => value !== 'custom' && run((editor) => editor.setWhammy(value))}
      />
      <Choice
        label={t('摇把颤音')}
        value={beat.vibrato}
        options={[
          [model.VibratoType.None, t('无')],
          [model.VibratoType.Slight, t('轻')],
          [model.VibratoType.Wide, t('宽')],
        ]}
        onPick={(value) => run((editor) => editor.setBeatVibrato(value))}
      />
      <Choice<StrokeKind>
        label={t('扫弦 / 琶音')}
        value={beat.stroke}
        options={[
          ['none', t('无')],
          ['brushDown', t('向下扫')],
          ['brushUp', t('向上扫')],
          ['arpeggioDown', t('向下琶音')],
          ['arpeggioUp', t('向上琶音')],
        ]}
        onPick={(value) => run((editor) => editor.setStroke(value))}
      />
      <Choice
        label={t('拨弦方向')}
        value={beat.pickStroke}
        options={[
          [model.PickStroke.None, t('无')],
          [model.PickStroke.Down, t('下拨')],
          [model.PickStroke.Up, t('上拨')],
        ]}
        onPick={(value) => run((editor) => editor.setPickStroke(value))}
      />
      <Choice
        label={t('哇音')}
        value={beat.wah}
        options={[
          [model.WahPedal.None, t('无')],
          [model.WahPedal.Open, t('开')],
          [model.WahPedal.Closed, t('闭')],
        ]}
        onPick={(value) => run((editor) => editor.setWah(value))}
      />
    </>
  )
}

function DynamicsTab({ run, t }: TabProps) {
  const beat = usePlayer().state.editing!.beat
  return (
    <>
      <Choice label={t('力度')} value={beat.dynamics} options={DYNAMICS} onPick={(value) => run((editor) => editor.setDynamics(value))} />
      <Choice
        label={t('渐变')}
        value={beat.crescendo}
        options={[
          [model.CrescendoType.None, t('无')],
          [model.CrescendoType.Crescendo, t('渐强')],
          [model.CrescendoType.Decrescendo, t('渐弱')],
        ]}
        onPick={(value) => run((editor) => editor.setCrescendo(value))}
      />
      <p className={styles.hint}>{t('力度记号要在设置里打开"显示强弱"才会显示在谱面上。')}</p>
    </>
  )
}

function BarTab({ run, t }: TabProps) {
  const bar = usePlayer().state.editing!.bar
  return (
    <>
      <Row label={t('拍号')}>
        <NumberField label={t('每小节拍数')} value={bar.numerator} min={1} max={32} onCommit={(value) => run((editor) => editor.setTimeSignature(value, bar.denominator))} />
        <span className={styles.slash}>/</span>
        <select aria-label={t('以几分音符为一拍')} value={bar.denominator} onChange={(event) => run((editor) => editor.setTimeSignature(bar.numerator, Number(event.target.value)))}>
          {[1, 2, 4, 8, 16, 32].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('速度')}>
        <NumberField label={t('速度（BPM）')} value={bar.tempo ?? bar.currentTempo} min={10} max={400} onCommit={(value) => run((editor) => editor.setTempo(value))} />
        <Button label={t('沿用前面的速度')} pressed={bar.tempo === null} onClick={() => run((editor) => editor.setTempo(null))}>
          {t('沿用前面的速度')}
        </Button>
      </Row>
      <Row label={t('段落')}>
        <TextField label={t('段落标记')} value={bar.section} placeholder="Intro / Verse / Chorus…" onCommit={(value) => run((editor) => editor.setSection(value))} />
      </Row>
      <Row label={t('反复')}>
        <Button label={t('反复开始')} pressed={bar.repeatStart} onClick={() => run((editor) => editor.toggleRepeatStart())}>
          {t('反复开始')}
        </Button>
        <select aria-label={t('反复结束')} value={bar.repeatCount} onChange={(event) => run((editor) => editor.setRepeatEnd(Number(event.target.value)))}>
          <option value={0}>{t('无反复结束')}</option>
          {[2, 3, 4, 5, 6, 8].map((count) => (
            <option key={count} value={count}>
              {t('反复结束，共 {n} 遍', { n: count })}
            </option>
          ))}
        </select>
        <Button label={t('双小节线')} pressed={bar.doubleBar} onClick={() => run((editor) => editor.toggleDoubleBar())}>
          {t('双小节线')}
        </Button>
      </Row>
      <Row label={t('跳房子')}>
        {[1, 2, 3, 4].map((ending) => (
          <Button
            key={ending}
            label={t('第 {n} 房', { n: ending })}
            pressed={bar.endings.includes(ending)}
            onClick={() => run((editor) => editor.setEndings(bar.endings.includes(ending) ? bar.endings.filter((item) => item !== ending) : [...bar.endings, ending]))}
          >
            {ending}.
          </Button>
        ))}
      </Row>
      <Choice
        label={t('摇摆')}
        value={bar.tripletFeel}
        options={[
          [model.TripletFeel.NoTripletFeel, t('无')],
          [model.TripletFeel.Triplet8th, t('八分摇摆')],
          [model.TripletFeel.Triplet16th, t('十六分摇摆')],
        ]}
        onPick={(value) => run((editor) => editor.setTripletFeel(value))}
      />
      <Row label={t('调号')}>
        <select aria-label={t('调号')} value={bar.keySignature} onChange={(event) => run((editor) => editor.setKeySignature(Number(event.target.value) as model.KeySignature, bar.minor))}>
          {KEYS.map((name, index) => (
            <option key={name} value={index - 7}>
              {name}
            </option>
          ))}
        </select>
        <Button label={t('小调')} pressed={bar.minor} onClick={() => run((editor) => editor.setKeySignature(bar.keySignature, !bar.minor))}>
          {t('小调')}
        </Button>
      </Row>
      <Row label={t('小节')}>
        <Button label={t('在后面插入小节')} onClick={() => run((editor) => editor.insertBar())}>
          <Plus size={14} /> {t('插入小节')}
        </Button>
        <Button label={t('复制这个小节')} onClick={() => run((editor) => editor.duplicateBar())}>
          {t('复制小节')}
        </Button>
        <Button label={t('删除这个小节')} onClick={() => run((editor) => editor.deleteBar())}>
          <Trash2 size={14} /> {t('删除小节')}
        </Button>
        <Button label={t('用休止补齐时值')} onClick={() => run((editor) => editor.fillBarWithRests())}>
          {t('用休止补齐')}
        </Button>
      </Row>
    </>
  )
}

function TextTab({ run, t }: TabProps) {
  const beat = usePlayer().state.editing!.beat
  return (
    <>
      <Row label={t('文字')}>
        <TextField label={t('拍上的文字标注')} value={beat.text} placeholder={t('拍上的文字标注')} onCommit={(value) => run((editor) => editor.setText(value))} />
      </Row>
      <Row label={t('歌词')}>
        <TextField label={t('拍下的歌词')} value={beat.lyrics} placeholder={t('拍下的歌词')} onCommit={(value) => run((editor) => editor.setLyrics(value))} />
      </Row>
      <Row label={t('和弦')}>
        <ChordPicker value={beat.chord} t={t} onPick={(name) => run((editor) => editor.setChord(name))} />
      </Row>
    </>
  )
}

// ---- small building blocks ----

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.rowItems}>{children}</div>
    </div>
  )
}

interface ButtonProps {
  label: string
  shortcut?: string
  pressed?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

function Button({ label, shortcut, pressed, disabled, onClick, children }: ButtonProps) {
  return (
    <button
      type="button"
      className={styles.button}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      // Keep the keyboard focus on the page, so the edit shortcuts keep working.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function IconButton({ label, shortcut, disabled, onClick, children }: Omit<ButtonProps, 'pressed'>) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

interface ChoiceProps<T> {
  label: string
  value: T
  options: Array<[T, string]>
  onPick: (value: T) => void
  shortcut?: string
}

/** A row of mutually exclusive options; the current one is lit. */
function Choice<T>({ label, value, options, onPick, shortcut }: ChoiceProps<T>) {
  return (
    <Row label={label}>
      {options.map(([option, text]) => (
        <Button key={String(option)} label={`${label}: ${text}`} shortcut={shortcut} pressed={option === value} onClick={() => option !== value && onPick(option)}>
          {text}
        </Button>
      ))}
    </Row>
  )
}

/** The fret of the note at the cursor, empty when there is none. Enter applies; emptied, it removes the note. */
function FretField({ label, value, onCommit }: { label: string; value: number | null; onCommit: (value: number | null) => void }) {
  const shownText = value === null ? '' : String(value)
  const [text, setText] = useState(shownText)
  const [shown, setShown] = useState(shownText)
  if (shown !== shownText) {
    setShown(shownText)
    setText(shownText)
  }
  const commit = () => {
    const trimmed = text.trim()
    if (trimmed === shownText) return
    if (trimmed === '') {
      if (value !== null) onCommit(null)
      return
    }
    const fret = Number(trimmed)
    if (Number.isInteger(fret) && fret >= 0 && fret <= MAX_FRET) onCommit(fret)
    else setText(shownText)
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      className={styles.fretInput}
      aria-label={label}
      title={`${label} (0–${MAX_FRET})`}
      maxLength={2}
      value={text}
      onChange={(event) => setText(event.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={(event) => {
        // Back to the score afterwards, so the arrow keys move the cursor again.
        if (event.key === 'Enter' || event.key === 'Escape') {
          if (event.key === 'Escape') setText(shownText)
          ;(event.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

const CUSTOM_CHORD = '__custom'

/** Root, quality and bass note from fixed lists; a name that is not on the lists is kept until changed. */
function ChordPicker({ value, t, onPick }: { value: string; t: Translate; onPick: (name: string) => void }) {
  const parts = value ? parseChord(value) : null
  const quality = parts?.quality ?? ''
  const bass = parts?.bass ?? ''
  return (
    <>
      <select
        aria-label={t('和弦根音')}
        value={parts?.root ?? (value ? CUSTOM_CHORD : '')}
        onChange={(event) => {
          const root = event.target.value
          if (root === CUSTOM_CHORD) return
          onPick(root ? chordName({ root, quality, bass }) : '')
        }}
      >
        <option value="">{t('无')}</option>
        {value && !parts && <option value={CUSTOM_CHORD}>{value}</option>}
        {CHORD_ROOTS.map((root) => (
          <option key={root} value={root}>
            {root}
          </option>
        ))}
      </select>
      <select aria-label={t('和弦类型')} disabled={!parts} value={quality} onChange={(event) => parts && onPick(chordName({ ...parts, quality: event.target.value }))}>
        {CHORD_QUALITIES.map((item) => (
          <option key={item.symbol} value={item.symbol}>
            {`${parts?.root ?? 'C'}${item.symbol} · ${t(item.label)}`}
          </option>
        ))}
      </select>
      <select aria-label={t('低音')} disabled={!parts} value={bass} onChange={(event) => parts && onPick(chordName({ ...parts, bass: event.target.value }))}>
        <option value="">{t('无低音')}</option>
        {CHORD_ROOTS.map((root) => (
          <option key={root} value={root}>
            /{root}
          </option>
        ))}
      </select>
    </>
  )
}

/** A number box that applies on Enter or when it loses the focus. */
function NumberField({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(value))
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setText(String(value))
  }
  const commit = () => {
    const number = Number(text)
    if (Number.isFinite(number) && number >= min && number <= max && number !== value) onCommit(Math.round(number))
    else setText(String(value))
  }
  return (
    <input
      type="number"
      className={styles.number}
      aria-label={label}
      title={label}
      min={min}
      max={max}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') (event.target as HTMLInputElement).blur()
      }}
    />
  )
}

/** A text box that applies on Enter or when it loses the focus. */
function TextField({ label, value, placeholder, onCommit }: { label: string; value: string; placeholder: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value)
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setText(value)
  }
  const commit = () => {
    if (text.trim() !== value) onCommit(text)
  }
  return (
    <input
      type="text"
      className={styles.text}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') (event.target as HTMLInputElement).blur()
      }}
    />
  )
}

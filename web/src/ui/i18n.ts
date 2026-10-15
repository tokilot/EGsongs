// Interface language. The Chinese text is the key; English comes from the table below. "auto" follows the
// browser: Chinese for any zh-* language, English otherwise.
import { useSyncExternalStore } from 'react'

export type LanguagePreference = 'auto' | 'zh' | 'en'
export type Language = 'zh' | 'en'
type Vars = Record<string, string | number>

const STORAGE_KEY = 'tabs.language'

function readPreference(): LanguagePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'zh' || stored === 'en' ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

function resolve(preference: LanguagePreference): Language {
  if (preference !== 'auto') return preference
  if (typeof navigator === 'undefined') return 'zh'
  return (navigator.languages ?? [navigator.language]).some((language) => language.toLowerCase().startsWith('zh')) ? 'zh' : 'en'
}

interface LanguageState {
  preference: LanguagePreference
  language: Language
}

const listeners = new Set<() => void>()
let state: LanguageState = { preference: readPreference(), language: 'zh' }

function apply(preference: LanguagePreference) {
  state = { preference, language: resolve(preference) }
  if (typeof document !== 'undefined') document.documentElement.lang = state.language === 'zh' ? 'zh-CN' : 'en'
  for (const listener of listeners) listener()
}

apply(state.preference)
// The guards let the tests import this module outside a browser.
if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', () => {
    if (state.preference === 'auto') apply('auto')
  })
}

export function setLanguagePreference(preference: LanguagePreference) {
  try {
    if (preference === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Private browsing: the choice lasts for this visit only.
  }
  apply(preference)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function fill(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

/** Translates outside React (e.g. confirm dialogs). */
export function translate(text: string, vars?: Vars): string {
  return fill(state.language === 'en' ? (EN[text] ?? text) : text, vars)
}

export type Translate = (text: string, vars?: Vars) => string

export function useLanguage(): LanguageState & { t: Translate } {
  const current = useSyncExternalStore(subscribe, () => state)
  const t: Translate = (text, vars) => fill(current.language === 'en' ? (EN[text] ?? text) : text, vars)
  return { ...current, t }
}

/** English for every Chinese string shown in the interface. web/src/ui/i18n.test.ts checks it is complete. */
export const EN: Record<string, string> = {
  // Top bar
  曲库首页: 'Library home',
  '搜索曲谱（本地曲库 + Songsterr）': 'Search tabs (library + Songsterr)',
  搜索曲谱: 'Search tabs',
  搜索结果: 'Search results',
  目录: 'Navigation',
  我的曲谱: 'My tabs',
  新建: 'New',
  帮助: 'Help',
  快捷键: 'Keyboard shortcuts',
  '在谱面上点击一拍可把光标移到那里；按住拖动选出一段作为循环区间。':
    'Click a beat to move the cursor there; drag across the score to select a loop range.',
  收藏: 'Favorite',
  取消收藏: 'Remove from favorites',
  '在 Songsterr 上打开': 'Open on Songsterr',
  乐器: 'Instrument',
  我的曲库: 'My library',
  没有匹配的曲谱: 'No matching tabs.',
  '没有匹配的曲谱。': 'No matching tabs.',
  '正在搜索…': 'Searching…',
  '没有更多结果。': 'No more results.',
  '{n} 条音轨': '{n} tracks',
  '正在导入…': 'Importing…',
  '粘贴 Songsterr 链接': 'Paste a Songsterr link',
  'Songsterr 链接': 'Songsterr link',
  导入: 'Import',
  上传本地文件: 'Upload a file',
  曲谱文件: 'Tab file',
  '支持 Guitar Pro、MusicXML 和 alphaTex。': 'Guitar Pro, MusicXML and alphaTex are supported.',
  本地文件: 'local file',

  // Shortcuts
  '播放 / 暂停': 'Play / pause',
  '上一小节 / 下一小节': 'Previous / next bar',
  回到开头: 'Back to the start',
  循环: 'Loop',
  跟随曲谱的节拍器: 'Metronome following the song',
  预备拍: 'Count-in',
  '加速 / 减速 5%': 'Faster / slower by 5%',
  聚焦搜索: 'Focus search',

  // Library
  全部: 'All',
  筛选: 'Filter',
  '还没有收藏的曲谱。': 'No favorites yet.',
  '曲库是空的。在顶栏搜索，或点击“新建”导入曲谱。': 'The library is empty. Search above, or click “New” to import a tab.',
  删除: 'Delete',
  '从曲库删除「{title}」？': 'Delete “{title}” from the library?',
  '正在加载曲谱…': 'Loading tab…',

  // Control bar
  速度: 'Speed',
  速度百分比: 'Speed in percent',
  播放: 'Play',
  暂停: 'Pause',
  '预备拍中，点击取消': 'Counting in — click to cancel',
  音源: 'Audio source',
  原声: 'Original',
  合成: 'Synth',
  移调: 'Transpose',
  '移调（半音）': 'Transpose (semitones)',
  降半音: 'Down a semitone',
  升半音: 'Up a semitone',
  还原: 'Reset',
  '音高和谱面上的品位一起变化；有变调夹的音轨优先移动变调夹。鼓不受影响。':
    'Pitch and frets change together; tracks with a capo move the capo first. Drums are not affected.',
  '有 {n} 个音超出了乐器的音域，已改在相差八度的位置。': '{n} notes are out of the instrument’s range and were moved by an octave.',
  独奏: 'Solo',
  静音: 'Mute',
  节拍器: 'Metronome',
  播放时跟随曲谱打拍: 'Click along with the song',
  自由节拍器: 'Free metronome',
  运行中: 'Running',
  已停止: 'Stopped',
  '节拍器 BPM': 'Metronome BPM',
  '节拍器 BPM 滑块': 'Metronome BPM slider',
  拍号: 'Time',
  每小节拍数: 'Beats per bar',
  以几分音符为一拍: 'Beat unit',
  开始: 'Start',
  停止: 'Stop',
  取当前曲速: 'Use song tempo',
  'BPM 按四分音符计；拍号决定每拍的时值和重音位置。': 'BPM counts quarter notes; the time signature sets the beat unit and accents.',
  下载: 'Download',
  打印: 'Print',
  修订历史: 'Revision history',
  '（当前）': ' (current)',
  '（切换中…）': ' (switching…)',
  '正在读取修订历史…': 'Loading revisions…',
  '没有修订记录。': 'No revisions.',

  // Settings
  设置: 'Settings',
  外观: 'Appearance',
  主题: 'Theme',
  跟随系统: 'Follow system',
  白天: 'Day',
  夜间: 'Night',
  语言: 'Language',
  自动: 'Auto',
  // Language names are shown in their own language.
  中文: '中文',
  谱子: 'Tab',
  每行显示4小节: 'Four bars per line',
  显示强弱: 'Show dynamics',
  循环间计数: 'Count-in between loops',
  谱面缩放: 'Zoom',
  同时显示五线谱: 'Also show standard notation',
  清除循环选区: 'Clear loop selection',

  // Tracks and mixer
  乐器与混音: 'Instruments and mixer',
  '还没有打开曲谱。': 'No tab is open.',
  主音量: 'Master volume',
  '{name} 音量': '{name} volume',
  '{name} 独奏': '{name} solo',
  '{name} 静音': '{name} mute',
  '编辑 {name}': 'Edit {name}',
  正在发声: 'Sounding',

  // Track editor
  编辑音轨: 'Edit track',
  '名称（可选）': 'Name (optional)',
  乐器分组: 'Instrument group',
  吉他: 'Guitars',
  贝斯: 'Bass',
  钢琴: 'Piano',
  管弦: 'Orchestra',
  其他: 'Other',
  '搜索乐器…': 'Search instrument…',
  '没有找到乐器。': 'No instrument found.',
  试听: 'Preview',
  乐器选项: 'Instrument options',
  弦数: 'Strings',
  调弦: 'Tuning',
  自定义调弦: 'Custom tuning',
  标准: 'Standard',
  降半音调弦: 'Half step down',
  降全音调弦: 'Whole step down',
  '第 {n} 弦': 'String {n}',
  变调夹: 'Capo on fret',
  '无': 'None',
  '调整指法（保持音高，重新排品）': 'Adjust fingerings (keep the pitch, re-fret)',
  '不勾选时保留谱上的品位，音高随调弦改变。': 'Unchecked, the written frets stay and the pitch follows the tuning.',
  '先修改调弦或变调夹才能调整指法。': 'Change the tuning or capo first to adjust the fingering.',
  '改变弦数时必须调整指法。': 'Changing the number of strings requires adjusting the fingerings.',
  '鼓轨只能修改名称。': 'For drum tracks only the name can be changed.',
  恢复原样: 'Restore original',
  取消: 'Cancel',
  关闭: 'Close',
  应用: 'Apply',
  '已应用；{n} 个音超出音域或无弦可放，已移动八度或删除。': 'Applied; {n} notes were out of range or had no free string and were moved by an octave or dropped.',

  // Tab editor
  编辑曲谱: 'Edit tab',
  保存修改: 'Save changes',
  曲谱编辑: 'Tab editing',
  '第 {bar} 小节 · 第 {beat}/{beats} 拍 · 第 {string} 弦': 'Bar {bar} · beat {beat}/{beats} · string {string}',
  '品位 {fret}': 'Fret {fret}',
  小节时值不足: 'Bar is short',
  小节时值超出: 'Bar is too long',
  撤销: 'Undo',
  重做: 'Redo',
  恢复原谱: 'Restore original',
  放弃修改: 'Discard changes',
  '鼓轨不能编辑，请在乐器里切换到其他音轨。': 'Drum tracks cannot be edited; switch to another track in the instruments.',
  时值: 'Duration',
  '{value} 音符': '{value} note',
  附点: 'Dotted',
  技巧: 'Technique',
  '击弦 / 勾弦': 'Hammer-on / pull-off',
  滑音: 'Slide',
  '推弦（全音）': 'Bend (full)',
  颤音: 'Vibrato',
  延音线: 'Tie',
  手掌闷音: 'Palm mute',
  '延音（let ring）': 'Let ring',
  哑音: 'Dead note',
  幽灵音: 'Ghost note',
  插入拍: 'Insert beat',
  删除拍: 'Delete beat',
  设为休止: 'Make rest',
  休止: 'Rest',
  '点谱面选位置；方向键移动，数字键输入品位，Delete 删除音，+ / - 改时值，Ctrl+S 保存。':
    'Click the tab to place the cursor; arrows move, digits type frets, Delete removes a note, + / - change the duration, Ctrl+S saves.',
  '保存失败：{message}': 'Saving failed: {message}',
  '放弃这次的全部修改吗？': 'Discard all changes made in this session?',
  '删除保存过的修改，恢复成导入时的曲谱吗？': 'Delete the saved changes and go back to the tab as imported?',
  '曲谱有未保存的修改，确定放弃并离开吗？': 'The tab has unsaved changes. Discard them and leave?',
  '切换修订会丢掉你对这首曲谱保存过的修改，继续吗？': 'Switching revision throws away the changes you saved to this tab. Continue?',

  // Errors
  '无法连接本地服务，请确认后端已启动。': 'Cannot reach the local server; is the backend running?',
  '请求失败（{status}）': 'Request failed ({status})',
  '读取曲谱文件失败。': 'Could not read the tab file.',
  '曲谱加载失败。': 'Could not load the tab.',
  '无法识别这个曲谱文件。': 'This tab file could not be read.',
  '曲谱转换失败。': 'Could not convert the tab.',
  // Floating edit panel
  音符: 'Note',
  节奏: 'Rhythm',
  效果: 'Effects',
  力度: 'Dynamics',
  小节: 'Bar',
  文字: 'Text',
  收起: 'Close',
  断奏: 'Staccato',
  刮弦: 'Pick scrape',
  左手点弦: 'Left-hand tap',
  品位: 'Fret',
  移到上一根弦: 'Move to the string above',
  上一根弦: 'String above',
  移到下一根弦: 'Move to the string below',
  下一根弦: 'String below',
  删除音: 'Delete note',
  重音: 'Accent',
  强重音: 'Heavy accent',
  连滑: 'Legato slide',
  滑奏: 'Shift slide',
  从下滑入: 'Slide in from below',
  从上滑入: 'Slide in from above',
  向下滑出: 'Slide out down',
  向上滑出: 'Slide out up',
  推弦: 'Bend',
  半音: 'Half',
  全音: 'Full',
  一个半音: '1½',
  推放: 'Bend and release',
  预推: 'Pre-bend',
  预推回: 'Pre-bend and release',
  轻: 'Slight',
  宽: 'Wide',
  泛音: 'Harmonic',
  自然泛音: 'Natural',
  人工泛音: 'Artificial',
  拨弦泛音: 'Pinch',
  点弦泛音: 'Tapped',
  半泛音: 'Semi',
  颤音装饰: 'Trill',
  与第几品交替: 'Fret to trill with',
  双附点: 'Double dot',
  连音: 'Tuplet',
  倚音: 'Grace note',
  拍前: 'Before the beat',
  拍上: 'On the beat',
  拍: 'Beat',
  点弦: 'Tapping',
  拍弦: 'Slap',
  '勾弦（贝斯）': 'Pop (bass)',
  拍击哑音: 'Dead slap',
  延长记号: 'Fermata',
  整拍: 'Whole beat',
  震音拨弦: 'Tremolo picking',
  '{n} 道斜线': '{n} slashes',
  摇把: 'Whammy bar',
  '下压 1 全音': 'Dive 1 tone',
  '下压 2 全音': 'Dive 2 tones',
  压后回弹: 'Dip',
  预压: 'Pre-dive',
  摇把颤音: 'Whammy vibrato',
  '扫弦 / 琶音': 'Brush / arpeggio',
  向下扫: 'Brush down',
  向上扫: 'Brush up',
  向下琶音: 'Arpeggio down',
  向上琶音: 'Arpeggio up',
  拨弦方向: 'Pick stroke',
  下拨: 'Down',
  上拨: 'Up',
  哇音: 'Wah',
  开: 'Open',
  闭: 'Closed',
  渐变: 'Hairpin',
  渐强: 'Crescendo',
  渐弱: 'Decrescendo',
  '力度记号要在设置里打开"显示强弱"才会显示在谱面上。': 'Dynamics show on the tab only with "Show dynamics" turned on in the settings.',
  '速度（BPM）': 'Tempo (BPM)',
  沿用前面的速度: 'Keep the tempo before',
  段落: 'Section',
  段落标记: 'Section marker',
  反复: 'Repeat',
  反复开始: 'Repeat start',
  反复结束: 'Repeat end',
  无反复结束: 'No repeat end',
  '反复结束，共 {n} 遍': 'Repeat end, {n} times',
  双小节线: 'Double bar line',
  跳房子: 'Endings',
  '第 {n} 房': 'Ending {n}',
  摇摆: 'Swing',
  八分摇摆: 'Eighth swing',
  十六分摇摆: 'Sixteenth swing',
  调号: 'Key signature',
  小调: 'Minor',
  在后面插入小节: 'Insert a bar after this one',
  插入小节: 'Insert bar',
  复制这个小节: 'Duplicate this bar',
  复制小节: 'Duplicate bar',
  删除这个小节: 'Delete this bar',
  删除小节: 'Delete bar',
  用休止补齐时值: 'Fill the bar up with rests',
  用休止补齐: 'Fill with rests',
  拍上的文字标注: 'Text on the beat',
  和弦: 'Chord',
  歌词: 'Lyrics',
  拍下的歌词: 'Lyric under the beat',
  和弦根音: 'Chord root',
  和弦类型: 'Chord type',
  低音: 'Bass note',
  无低音: 'No bass note',
  '这根弦上还没有音，输入品位后回车即可添加。': 'No note on this string yet; type a fret and press Enter to add one.',
  大三和弦: 'major',
  小三和弦: 'minor',
  强力和弦: 'power chord',
  减三和弦: 'diminished',
  增三和弦: 'augmented',
  挂二和弦: 'suspended 2nd',
  挂四和弦: 'suspended 4th',
  大六和弦: 'major 6th',
  小六和弦: 'minor 6th',
  六九和弦: '6/9',
  属七和弦: 'dominant 7th',
  大七和弦: 'major 7th',
  小七和弦: 'minor 7th',
  小大七和弦: 'minor major 7th',
  半减七和弦: 'half-diminished',
  减七和弦: 'diminished 7th',
  增七和弦: 'augmented 7th',
  属七挂四和弦: '7th suspended 4th',
  加九和弦: 'added 9th',
  小加九和弦: 'minor added 9th',
  属九和弦: 'dominant 9th',
  大九和弦: 'major 9th',
  小九和弦: 'minor 9th',
  属七降九和弦: '7th flat 9',
  属七升九和弦: '7th sharp 9',
  十一和弦: '11th',
  小十一和弦: 'minor 11th',
  十三和弦: '13th',
}

// The chord names the tab editor offers: a root, a chord quality and an optional bass note ("Am7/G").

export const CHORD_ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B']

export interface ChordQuality {
  /** What follows the root in the name; '' is a major triad. */
  symbol: string
  /** Chinese key; the UI translates it. */
  label: string
}

export const CHORD_QUALITIES: ChordQuality[] = [
  { symbol: '', label: '大三和弦' },
  { symbol: 'm', label: '小三和弦' },
  { symbol: '5', label: '强力和弦' },
  { symbol: 'dim', label: '减三和弦' },
  { symbol: 'aug', label: '增三和弦' },
  { symbol: 'sus2', label: '挂二和弦' },
  { symbol: 'sus4', label: '挂四和弦' },
  { symbol: '6', label: '大六和弦' },
  { symbol: 'm6', label: '小六和弦' },
  { symbol: '6/9', label: '六九和弦' },
  { symbol: '7', label: '属七和弦' },
  { symbol: 'maj7', label: '大七和弦' },
  { symbol: 'm7', label: '小七和弦' },
  { symbol: 'mMaj7', label: '小大七和弦' },
  { symbol: 'm7b5', label: '半减七和弦' },
  { symbol: 'dim7', label: '减七和弦' },
  { symbol: 'aug7', label: '增七和弦' },
  { symbol: '7sus4', label: '属七挂四和弦' },
  { symbol: 'add9', label: '加九和弦' },
  { symbol: 'madd9', label: '小加九和弦' },
  { symbol: '9', label: '属九和弦' },
  { symbol: 'maj9', label: '大九和弦' },
  { symbol: 'm9', label: '小九和弦' },
  { symbol: '7b9', label: '属七降九和弦' },
  { symbol: '7#9', label: '属七升九和弦' },
  { symbol: '11', label: '十一和弦' },
  { symbol: 'm11', label: '小十一和弦' },
  { symbol: '13', label: '十三和弦' },
]

export interface ChordParts {
  root: string
  quality: string
  /** The bass note after the slash, or '' for none. */
  bass: string
}

// Other spellings of the same qualities, as they appear in imported tabs.
const ALIASES: Record<string, string> = { M: '', maj: '', min: 'm', '-': 'm', M7: 'maj7', Δ: 'maj7', 'Δ7': 'maj7', min7: 'm7', '-7': 'm7', 'ø': 'm7b5', 'm7(b5)': 'm7b5', '°': 'dim', o: 'dim', '°7': 'dim7', o7: 'dim7', '+': 'aug', sus: 'sus4', 'm(maj7)': 'mMaj7', mM7: 'mMaj7', '69': '6/9' }

const ROOT_PATTERN = /^([A-G](?:#|b)?)(.*)$/

/** The parts of a chord name, or null when it is not one the editor lists (it is then kept as it is). */
export function parseChord(name: string): ChordParts | null {
  const match = ROOT_PATTERN.exec(name.trim())
  if (!match || !CHORD_ROOTS.includes(match[1])) return null
  let rest = match[2]
  let bass = ''
  const slash = rest.lastIndexOf('/')
  // "6/9" is a quality, not a slash chord.
  if (slash >= 0 && CHORD_ROOTS.includes(rest.slice(slash + 1))) {
    bass = rest.slice(slash + 1)
    rest = rest.slice(0, slash)
  }
  const quality = rest in ALIASES ? ALIASES[rest] : rest
  if (!CHORD_QUALITIES.some((item) => item.symbol === quality)) return null
  return { root: match[1], quality, bass }
}

export function chordName({ root, quality, bass }: ChordParts): string {
  return `${root}${quality}${bass ? `/${bass}` : ''}`
}

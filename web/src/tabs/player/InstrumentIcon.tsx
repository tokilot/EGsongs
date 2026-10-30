import { AudioWaveform, Bell, Drum, Guitar, KeyboardMusic, MicVocal, Piano, Sparkles, Waves, Wind, type LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import { instrumentFamily, type InstrumentFamily } from './instrumentFamily.ts'
import styles from './InstrumentIcon.module.css'

type Icon = ComponentType<LucideProps>

// Drawn in the style of the lucide set (24×24, round 2px strokes) for the instruments it has no icon for.
function svg(paths: string[]): Icon {
  const DrawnIcon = ({ size = 24, ...rest }: LucideProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
  return DrawnIcon
}

/** Solid-body electric guitar: double cutaway body, pickups, a narrow headstock. */
const ElectricGuitar = svg([
  'M11.5 12.5 19 5',
  'M18 3.5 20.5 6 22 4.5 19.5 2z',
  'M10 9.5 8.6 8.1C7.4 6.9 5.4 7.4 4.9 9l-.5 1.4c-.2.7-.8 1.2-1.5 1.4-1.6.5-2.1 2.5-.9 3.7l5.6 5.6c1.2 1.2 3.2.7 3.7-.9.2-.7.7-1.3 1.4-1.5l1.4-.5c1.6-.5 2.1-2.5.9-3.7L13.6 12',
  'm6 13 2.5 2.5',
  'm8 11 2.5 2.5',
])

/** The electric guitar with a lightning bolt: overdrive and distortion. */
const DistortionGuitar = svg([
  'M11.5 12.5 19 5',
  'M18 3.5 20.5 6 22 4.5 19.5 2z',
  'M10 9.5 8.6 8.1C7.4 6.9 5.4 7.4 4.9 9l-.5 1.4c-.2.7-.8 1.2-1.5 1.4-1.6.5-2.1 2.5-.9 3.7l5.6 5.6c1.2 1.2 3.2.7 3.7-.9.2-.7.7-1.3 1.4-1.5l1.4-.5c1.6-.5 2.1-2.5.9-3.7L13.6 12',
  'M5 1.5 3 4.5h3l-2 3',
])

/** Bass: a longer neck, a bigger body and four tuning pegs. */
const BassGuitar = svg([
  'M10 14 21 3',
  'M8.6 10.6 7.4 9.4C6 8 3.7 8.6 3.2 10.5l-.3 1.2c-.2.6-.6 1.1-1.2 1.3-1.4.6-1.7 2.5-.6 3.6l5.3 5.3c1.1 1.1 3 .8 3.6-.6.2-.6.7-1 1.3-1.2l1.2-.3c1.9-.5 2.5-2.8 1.1-4.2l-1.2-1.2',
  'M19 1.5h.01',
  'M22.5 5h.01',
  'M17.5 3h.01',
  'M21 6.5h.01',
  'm5 15 4 4',
])

/** Violin family: the body with f-holes and a bow across it. */
const Violin = svg([
  'M12 2v5',
  'M10 7h4',
  'M9 7.5c-2 .5-3 2-2.2 3.6.4.8.4 1.5 0 2.3C5.5 16 7 21.5 12 21.5s6.5-5.5 5.2-8.1c-.4-.8-.4-1.5 0-2.3C18 9.5 17 8 15 7.5',
  'M10 13.5v2.5',
  'M14 13.5v2.5',
  'M3 21 21 9',
])

/** Brass: a trumpet with its valves and bell. */
const Trumpet = svg(['M2 10v4', 'M2 12h11', 'M13 8.5 21 5v14l-8-3.5z', 'M6 9v3', 'M8.5 9v3', 'M11 9v3', 'M6 15h7'])

const ICONS: Record<InstrumentFamily, Icon> = {
  acoustic: Guitar,
  electric: ElectricGuitar,
  distortion: DistortionGuitar,
  bass: BassGuitar,
  drums: Drum,
  keys: Piano,
  organ: KeyboardMusic,
  bells: Bell,
  strings: Violin,
  voice: MicVocal,
  brass: Trumpet,
  wind: Wind,
  synth: AudioWaveform,
  pad: Waves,
  ethnic: Guitar,
  effects: Sparkles,
}

interface InstrumentIconProps {
  program: number
  isPercussion?: boolean
  size?: number
}

/** The icon for a General MIDI program, tinted by instrument family. */
export function InstrumentIcon({ program, isPercussion = false, size = 18 }: InstrumentIconProps) {
  const family = instrumentFamily(program, isPercussion)
  const Icon = ICONS[family]
  return (
    <span className={styles.icon} data-family={family} aria-hidden>
      <Icon size={size} />
    </span>
  )
}

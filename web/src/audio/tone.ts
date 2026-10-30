// A guitar tone as everything uses it: the tone library keeps and edits them (tones/), the player gives them
// to tracks (tabs/), the amp engine plays their chains (ampSim.ts).
import type { ToneChain } from './toneChain.ts'

/** What a tone is for: electric guitar or bass. */
export type ToneFamily = 'guitar' | 'bass'

export const TONE_FAMILIES: ToneFamily[] = ['guitar', 'bass']

export interface Tone {
  id: string
  /** Built-in templates have Chinese names (translated in the UI); the user's are shown as typed. */
  name: string
  family: ToneFamily
  builtIn: boolean
  chain: ToneChain
}

/** The family of tones a GM program can be given: the electric guitars, the basses; others none. */
export function toneFamilyOf(program: number): ToneFamily | null {
  if (program >= 26 && program <= 31) return 'guitar'
  if (program >= 32 && program <= 39) return 'bass'
  return null
}

/**
 * The instrument a track gets with a tone of the family: guitars play the clean electric guitar samples and get
 * their drive from the chain; a bass keeps its own bass samples.
 */
export function toneProgram(family: ToneFamily, program: number): number {
  if (family === 'guitar') return 27
  return toneFamilyOf(program) === 'bass' ? program : 33
}

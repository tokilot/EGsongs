import { describe, expect, it } from 'vitest'
import { CHORD_QUALITIES, CHORD_ROOTS, chordName, parseChord } from './chords.ts'

describe('chords', () => {
  it('reads back every name it builds', () => {
    for (const root of CHORD_ROOTS) {
      for (const { symbol } of CHORD_QUALITIES) {
        for (const bass of ['', 'E', 'Bb']) {
          const parts = { root, quality: symbol, bass }
          expect(parseChord(chordName(parts))).toEqual(parts)
        }
      }
    }
  })

  it('understands other spellings and keeps names it does not list', () => {
    expect(parseChord('Amin7')).toEqual({ root: 'A', quality: 'm7', bass: '' })
    expect(parseChord('CM7/G')).toEqual({ root: 'C', quality: 'maj7', bass: 'G' })
    expect(parseChord('F#sus')).toEqual({ root: 'F#', quality: 'sus4', bass: '' })
    expect(parseChord('C6/9')).toEqual({ root: 'C', quality: '6/9', bass: '' })
    expect(parseChord('N.C.')).toBeNull()
    expect(parseChord('Am7(add11)')).toBeNull()
  })
})

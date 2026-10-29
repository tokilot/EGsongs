import { describe, expect, it } from 'vitest'
import { KEY_CHOICES, keyLabel, syllable, tonicOf, transposeKey } from './solfege.ts'

describe('solfège', () => {
  it('puts do on the tonic of the key signature', () => {
    expect(tonicOf(0)).toBe(0)
    expect(tonicOf(1)).toBe(7)
    expect(tonicOf(2)).toBe(2)
    expect(tonicOf(-1)).toBe(5)
    expect(tonicOf(-2)).toBe(10)
    expect(tonicOf(7)).toBe(1)
    expect(tonicOf(-7)).toBe(11)
  })

  it('names the key the way numbered notation does', () => {
    expect(keyLabel(0)).toBe('1=C')
    expect(keyLabel(1)).toBe('1=G')
    expect(keyLabel(-2)).toBe('1=♭B')
    expect(keyLabel(6)).toBe('1=#F')
    expect(keyLabel(-6)).toBe('1=♭G')
  })

  it('reads pitches in the key, in every octave', () => {
    // C major: open strings of a guitar, E A D G B E.
    expect([40, 45, 50, 55, 59, 64].map((pitch) => syllable(pitch, 0))).toEqual(['mi', 'la', 're', 'sol', 'si', 'mi'])
    // G major: G is do, F# is si, F is ♭si.
    expect([67, 66, 65, 62].map((pitch) => syllable(pitch, 1))).toEqual(['do', 'si', '♭si', 'sol'])
    // F major: B♭ is fa.
    expect(syllable(70, -1)).toBe('fa')
  })
})

describe('picked keys', () => {
  it('offers the twelve major keys spelled the usual way', () => {
    expect(KEY_CHOICES.map(keyLabel)).toEqual(['1=C', '1=♭D', '1=D', '1=♭E', '1=E', '1=F', '1=#F', '1=G', '1=♭A', '1=A', '1=♭B', '1=B'])
  })

  it('moves a picked key with the transposition', () => {
    expect(keyLabel(transposeKey(1, 2))).toBe('1=A')
    expect(keyLabel(transposeKey(0, -2))).toBe('1=♭B')
    expect(keyLabel(transposeKey(-2, 12))).toBe('1=♭B')
  })
})

import { describe, expect, it } from 'vitest'
import { readMidiFile } from './midiFile.ts'
import { writeMidi } from './midiTestFile.ts'

describe('MIDI file', () => {
  it('reads notes, tempo, time signature, names and programs', () => {
    const file = readMidiFile(
      writeMidi({
        tempos: [[0, 90], [4, 120]],
        signatures: [[0, 3, 4]],
        tracks: [
          { name: 'Lead', program: 29, notes: [{ at: 0, length: 1, pitch: 64 }, { at: 1, length: 0.5, pitch: 67, velocity: 80 }] },
          { name: '吉他', program: 33, channel: 1, notes: [{ at: 0, length: 4, pitch: 40 }] },
        ],
      }),
    )
    expect(file.ticksPerQuarter).toBe(480)
    expect(file.tempos.map((tempo) => [tempo.tick, Math.round(tempo.bpm)])).toEqual([[0, 90], [1920, 120]])
    expect(file.timeSignatures).toEqual([{ tick: 0, numerator: 3, denominator: 4 }])
    expect(file.parts.map((part) => [part.name, part.channel, part.program])).toEqual([['Lead', 0, 29], ['吉他', 1, 33]])
    expect(file.parts[0].notes).toEqual([
      { start: 0, end: 480, pitch: 64, velocity: 100 },
      { start: 480, end: 720, pitch: 67, velocity: 80 },
    ])
  })

  it('reads running status and note-offs', () => {
    // Note-on C, running-status note-on E, then 0x80 note-offs.
    const bytes = writeMidi({ tracks: [{ notes: [], extra: [[0, 0x90, 60, 100], [0, 64, 100], [240, 0x80, 60, 0], [480, 0x80, 64, 0]] }] })
    const [part] = readMidiFile(bytes).parts
    expect(part.notes.map((note) => [note.pitch, note.start, note.end])).toEqual([[64, 0, 480], [60, 0, 240]])
  })

  it('splits a type 0 file by channel', () => {
    const file = readMidiFile(
      writeMidi({ format: 0, tracks: [{ notes: [{ at: 0, length: 1, pitch: 60 }, { at: 0, length: 1, pitch: 36, channel: 9 }] }] }),
    )
    expect(file.parts.map((part) => part.channel)).toEqual([0, 9])
  })

  it('ends notes that are never turned off where their track ends', () => {
    const [part] = readMidiFile(writeMidi({ tracks: [{ notes: [], extra: [[0, 0x90, 60, 100], [960, 0xb0, 7, 100]] }] })).parts
    expect(part.notes).toEqual([{ start: 0, end: 960, pitch: 60, velocity: 100 }])
  })

  it('refuses files that are not MIDI, or broken', () => {
    expect(() => readMidiFile(new TextEncoder().encode('not a midi file at all'))).toThrow()
    const bytes = writeMidi({ tracks: [{ notes: [{ at: 0, length: 1, pitch: 60 }] }] })
    expect(() => readMidiFile(bytes.slice(0, bytes.length - 6))).toThrow()
  })
})

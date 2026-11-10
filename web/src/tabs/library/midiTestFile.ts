// Builds small Standard MIDI Files for the tests.

export interface TestNote {
  /** In quarter notes. */
  at: number
  length: number
  pitch: number
  channel?: number
  velocity?: number
}

export interface TestTrack {
  name?: string
  program?: number
  channel?: number
  notes: TestNote[]
  /** Raw events (delta-free) placed at a tick: [tick, ...bytes]. */
  extra?: Array<[number, ...number[]]>
}

export interface TestFile {
  ticksPerQuarter?: number
  /** [quarter, bpm] */
  tempos?: Array<[number, number]>
  /** [quarter, numerator, denominator] */
  signatures?: Array<[number, number, number]>
  tracks: TestTrack[]
  format?: 0 | 1
}

function varUint(value: number): number[] {
  const bytes = [value & 0x7f]
  while ((value >>= 7) > 0) bytes.unshift((value & 0x7f) | 0x80)
  return bytes
}

function chunk(type: string, data: number[]): number[] {
  const length = data.length
  return [...[...type].map((char) => char.charCodeAt(0)), (length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255, ...data]
}

function track(events: Array<[number, number[]]>): number[] {
  const sorted = events.map((event, index) => ({ event, index })).sort((a, b) => a.event[0] - b.event[0] || a.index - b.index)
  const data: number[] = []
  let last = 0
  for (const { event } of sorted) {
    data.push(...varUint(event[0] - last), ...event[1])
    last = event[0]
  }
  data.push(...varUint(0), 0xff, 0x2f, 0x00)
  return chunk('MTrk', data)
}

export function writeMidi(file: TestFile): Uint8Array {
  const ppq = file.ticksPerQuarter ?? 480
  const tick = (quarters: number) => Math.round(quarters * ppq)
  const conductor: Array<[number, number[]]> = []
  for (const [at, bpm] of file.tempos ?? []) {
    const micros = Math.round(60_000_000 / bpm)
    conductor.push([tick(at), [0xff, 0x51, 0x03, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255]])
  }
  for (const [at, numerator, denominator] of file.signatures ?? []) {
    conductor.push([tick(at), [0xff, 0x58, 0x04, numerator, Math.log2(denominator), 24, 8]])
  }
  const tracks = file.tracks.map((source) => {
    const events: Array<[number, number[]]> = []
    const channel = source.channel ?? 0
    if (source.name) events.push([0, [0xff, 0x03, ...varUint(new TextEncoder().encode(source.name).length), ...new TextEncoder().encode(source.name)]])
    if (source.program !== undefined) events.push([0, [0xc0 | channel, source.program]])
    for (const note of source.notes) {
      const noteChannel = note.channel ?? channel
      events.push([tick(note.at), [0x90 | noteChannel, note.pitch, note.velocity ?? 100]])
      // Note-on with velocity 0 is a note-off too.
      events.push([tick(note.at + note.length), [0x90 | noteChannel, note.pitch, 0]])
    }
    for (const [at, ...bytes] of source.extra ?? []) events.push([at, bytes])
    return events
  })
  const format = file.format ?? 1
  const chunks = format === 0 ? [track([...conductor, ...tracks.flat()])] : [track(conductor), ...tracks.map(track)]
  const header = chunk('MThd', [0, format, 0, chunks.length, (ppq >> 8) & 255, ppq & 255])
  return new Uint8Array([...header, ...chunks.flat()])
}

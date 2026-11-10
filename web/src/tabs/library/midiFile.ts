// Reads a Standard MIDI File (format 0 or 1) into notes with their start and end ticks, plus the tempo, time and
// key signature changes. Only what turning it into a tab needs: controllers, pitch bends and SysEx are skipped.
import { translate } from '../../shared/ui/i18n.ts'

export interface MidiNote {
  /** In the file's ticks. */
  start: number
  end: number
  pitch: number
  velocity: number
}

/** The notes of one channel of one track of the file. */
export interface MidiPart {
  /** Index of the track chunk the notes are in. */
  track: number
  channel: number
  /** The track's name (meta event 3), or ''. */
  name: string
  /** The program the channel had when its first note started (0 when the file never sets one). */
  program: number
  notes: MidiNote[]
}

export interface MidiFile {
  ticksPerQuarter: number
  /** Sorted by tick; the file's first tempo applies from tick 0 when it does not start with one. */
  tempos: Array<{ tick: number; bpm: number }>
  timeSignatures: Array<{ tick: number; numerator: number; denominator: number }>
  /** `sharps` is negative for flats. */
  keySignatures: Array<{ tick: number; sharps: number; minor: boolean }>
  /** Every channel of every track that has notes, in file order. */
  parts: MidiPart[]
}

class Reader {
  position = 0
  readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  get done() {
    return this.position >= this.bytes.length
  }

  byte() {
    if (this.position >= this.bytes.length) throw corrupt()
    return this.bytes[this.position++]
  }

  uint(count: number) {
    let value = 0
    for (let index = 0; index < count; index++) value = value * 256 + this.byte()
    return value
  }

  /** A variable-length quantity: 7 bits a byte, high bit set on all but the last. */
  varUint() {
    let value = 0
    for (let index = 0; index < 4; index++) {
      const byte = this.byte()
      value = value * 128 + (byte & 0x7f)
      if ((byte & 0x80) === 0) return value
    }
    throw corrupt()
  }

  text(count: number) {
    return String.fromCharCode(...this.slice(count))
  }

  slice(count: number) {
    if (this.position + count > this.bytes.length) throw corrupt()
    const part = this.bytes.subarray(this.position, this.position + count)
    this.position += count
    return part
  }
}

const corrupt = () => new Error(translate('MIDI 文件已损坏。'))

/** Track names are often in a legacy code page; UTF-8 when they decode as such, else kept byte by byte. */
function decodeName(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
  } catch {
    return String.fromCharCode(...bytes).trim()
  }
}

export function readMidiFile(bytes: Uint8Array): MidiFile {
  const reader = new Reader(bytes)
  if (bytes.length < 14 || reader.text(4) !== 'MThd') throw new Error(translate('这不是 MIDI 文件。'))
  const headerLength = reader.uint(4)
  const format = reader.uint(2)
  const trackCount = reader.uint(2)
  const division = reader.uint(2)
  reader.slice(headerLength - 6)
  if (format > 1) throw new Error(translate('不支持这种 MIDI 文件（格式 {n}）。', { n: format }))
  // The top bit set means SMPTE frames instead of ticks per quarter note: no beats to put bars on.
  if (division & 0x8000 || division === 0) throw new Error(translate('不支持按时间码计时的 MIDI 文件。'))

  const file: MidiFile = { ticksPerQuarter: division, tempos: [], timeSignatures: [], keySignatures: [], parts: [] }
  for (let track = 0; track < trackCount && !reader.done; track++) {
    const type = reader.text(4)
    const length = reader.uint(4)
    const chunk = reader.slice(Math.min(length, bytes.length - reader.position))
    if (type === 'MTrk') readTrack(new Reader(chunk), track, file)
  }
  for (const list of [file.tempos, file.timeSignatures, file.keySignatures]) list.sort((a, b) => a.tick - b.tick)
  return file
}

function readTrack(reader: Reader, track: number, file: MidiFile) {
  let tick = 0
  let status = 0
  let name = ''
  const programs = new Array<number>(16).fill(0)
  const parts = new Map<number, MidiPart>()
  // Notes still sounding, per channel and pitch; a note-off ends the oldest.
  const open = new Map<number, Array<{ start: number; velocity: number }>>()

  const startNote = (channel: number, pitch: number, velocity: number) => {
    const key = channel * 128 + pitch
    let list = open.get(key)
    if (!list) open.set(key, (list = []))
    list.push({ start: tick, velocity })
    if (!parts.has(channel)) parts.set(channel, { track, channel, name: '', program: programs[channel], notes: [] })
  }
  const endNote = (channel: number, pitch: number) => {
    const started = open.get(channel * 128 + pitch)?.shift()
    if (!started) return
    parts.get(channel)!.notes.push({ start: started.start, end: Math.max(tick, started.start + 1), pitch, velocity: started.velocity })
  }

  while (!reader.done) {
    tick += reader.varUint()
    let byte = reader.byte()
    if (byte < 0x80) {
      // Running status: the data byte belongs to the previous channel message.
      if (status === 0) throw corrupt()
      reader.position--
      byte = status
    }
    if (byte === 0xff) {
      const type = reader.byte()
      const data = reader.slice(reader.varUint())
      if (type === 0x2f) break
      if (type === 0x03 && !name) name = decodeName(data)
      else if (type === 0x51 && data.length >= 3) {
        const micros = (data[0] << 16) | (data[1] << 8) | data[2]
        if (micros > 0) file.tempos.push({ tick, bpm: 60_000_000 / micros })
      } else if (type === 0x58 && data.length >= 2 && data[0] > 0) {
        file.timeSignatures.push({ tick, numerator: data[0], denominator: 2 ** Math.min(data[1], 6) })
      } else if (type === 0x59 && data.length >= 2) {
        const sharps = data[0] > 127 ? data[0] - 256 : data[0]
        file.keySignatures.push({ tick, sharps: Math.max(-7, Math.min(7, sharps)), minor: data[1] === 1 })
      }
      continue
    }
    if (byte === 0xf0 || byte === 0xf7) {
      reader.slice(reader.varUint())
      continue
    }
    if (byte >= 0xf0) throw corrupt()
    status = byte
    const channel = byte & 0x0f
    const kind = byte & 0xf0
    if (kind === 0xc0) programs[channel] = reader.byte() & 0x7f
    else if (kind === 0xd0) reader.byte()
    else {
      const first = reader.byte() & 0x7f
      const second = reader.byte() & 0x7f
      if (kind === 0x90 && second > 0) startNote(channel, first, second)
      else if (kind === 0x80 || kind === 0x90) endNote(channel, first)
    }
  }

  // Notes the track never ends stop where it does.
  for (const [key, list] of open) for (const started of list) {
    const part = parts.get(Math.floor(key / 128))!
    part.notes.push({ start: started.start, end: Math.max(tick, started.start + 1), pitch: key % 128, velocity: started.velocity })
  }
  for (const part of [...parts.values()].sort((a, b) => a.channel - b.channel)) {
    if (part.notes.length === 0) continue
    part.name = name
    part.notes.sort((a, b) => a.start - b.start || b.pitch - a.pitch)
    file.parts.push(part)
  }
}

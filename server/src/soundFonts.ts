import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { SoundFont, SoundFontPreset } from '../../contracts/soundFonts.ts'

/** The sample sets as the page sees them, defined with it in contracts/soundFonts.ts. */
export type { SoundFont, SoundFontPreset } from '../../contracts/soundFonts.ts'

/**
 * Sound fonts the player knows to prefer, best first; any other .sf2/.sf3 comes after them. Default.sf2 is the one
 * that comes with the app (resources/soundfonts/: GeneralUser GS with three of Bread's distortion guitars added).
 */
const PREFERRED = ['Default.sf2', 'GeneralUser-GS.sf2', 'FluidR3Mono_GM.sf3']

/** A set with presets for this many programs of bank 0 is taken for a General MIDI set. */
const GM_PROGRAMS = 100

/**
 * The bank of the presets added to the main set from other files (Bread's guitars in Default.sf2, put there once
 * by hand): clear of the banks General MIDI sets use and of the extra sets' below.
 */
export const ADDED_BANK = 1000

/** The banks the extra sets are moved to, one each from here: clear of every bank a General MIDI set uses. */
export const EXTRA_BANK = 1024
/** Where an extra set's other banks (variations, drum kits) are put out of the way: no track asks for it. */
const UNUSED_BANK = 2047

interface Chunk {
  offset: number
  size: number
}

interface Parsed {
  presets: Array<SoundFontPreset & { bank: number }>
  phdr: Chunk
  shdr: Chunk
}

const PHDR_SIZE = 38
const SHDR_SIZE = 46

/** The preset and sample headers of a SoundFont 2 (or 3) file, or null when it is not one. */
export function parseSoundFont(bytes: Buffer): Parsed | null {
  const text = (offset: number, length: number) => bytes.toString('latin1', offset, offset + length)
  if (bytes.length < 12 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'sfbk') return null
  const chunks = new Map<string, Chunk>()
  const walk = (start: number, end: number) => {
    for (let at = start; at + 8 <= end; ) {
      const id = text(at, 4)
      const size = bytes.readUInt32LE(at + 4)
      if (id === 'LIST') walk(at + 12, Math.min(end, at + 8 + size))
      else chunks.set(id, { offset: at + 8, size })
      at += 8 + size + (size & 1)
    }
  }
  walk(12, bytes.length)
  const phdr = chunks.get('phdr')
  const shdr = chunks.get('shdr')
  if (!phdr || !shdr || phdr.offset + phdr.size > bytes.length || shdr.offset + shdr.size > bytes.length) return null
  const presets: Parsed['presets'] = []
  // The last record of each list only marks its end.
  for (let at = phdr.offset; at + 2 * PHDR_SIZE <= phdr.offset + phdr.size; at += PHDR_SIZE) {
    // UTF-8: plain ASCII names read the same, and the names given to the added presets are Chinese.
    const name = bytes.toString('utf8', at, at + 20).replace(/\0.*$/s, '').trim()
    presets.push({ name, program: bytes.readUInt16LE(at + 20), bank: bytes.readUInt16LE(at + 22) })
  }
  return { presets, phdr, shdr }
}

// One side of a stereo pair ("… L", "…_R"): offered as part of the whole preset only.
const ONE_SIDE = /[ _][LR]$/

/** What kind of set a file is, and its presets. A file that cannot be read is listed as General MIDI, as it was. */
function describe(parsed: Parsed | null, name: string): Pick<SoundFont, 'kind' | 'presets'> {
  if (!parsed) return { kind: 'gm', presets: [] }
  const presets = parsed.presets.filter((preset) => preset.bank === 0 && !ONE_SIDE.test(preset.name)).map(({ program, name }) => ({ program, name }))
  const programs = new Set(parsed.presets.filter((preset) => preset.bank === 0).map((preset) => preset.program))
  return { kind: PREFERRED.includes(name) || programs.size >= GM_PROGRAMS ? 'gm' : 'extra', presets }
}

/**
 * A set other than the main one as the player loads it: the presets of bank 0 moved to `bank` (so its programs do
 * not take the main set's place), the rest (variations, drum kits) out of the way, and every sample marked mono.
 * alphaTab's synthesizer skips stereo samples (left, right, linked); as mono, both sides of a pair play, each at
 * its zone's pan.
 */
export function prepareExtra(bytes: Buffer, parsed: Parsed, bank: number): Buffer {
  const out = Buffer.from(bytes)
  for (let at = parsed.phdr.offset; at + 2 * PHDR_SIZE <= parsed.phdr.offset + parsed.phdr.size; at += PHDR_SIZE) {
    out.writeUInt16LE(out.readUInt16LE(at + 22) === 0 ? bank : UNUSED_BANK, at + 22)
  }
  for (let at = parsed.shdr.offset; at + 2 * SHDR_SIZE <= parsed.shdr.offset + parsed.shdr.size; at += SHDR_SIZE) {
    const type = out.readUInt16LE(at + 44)
    // Keep the ROM and compressed (sf3) flags; the low bits say mono / right / left / linked.
    if ((type & 0x0f) !== 1 && (type & 0x0f) !== 0) out.writeUInt16LE((type & ~0x0f) | 1, at + 44)
  }
  return out
}

/**
 * Sample sets for the player: the user's in data/soundfonts/ (put there by hand; their licences sit next to them)
 * and the one that comes with the app in resources/soundfonts/ (2026-11-11). A name in the first folder hides the
 * same name in a later one. The first General MIDI set is the main one, loaded at the start (without any, the small
 * set alphaTab ships with). The others are loaded by hand on the tone page, each in a bank of its own, and their
 * presets picked per track in "edit track".
 */
export class SoundFonts {
  readonly dirs: string[]
  private readonly parsed = new Map<string, { size: number; mtime: number; parsed: Parsed | null }>()

  /** `dirs`: where to look, the one that wins first. */
  constructor(dirs: string | string[]) {
    this.dirs = typeof dirs === 'string' ? [dirs] : dirs
  }

  /** Every .sf2/.sf3 by name, from the first folder that has it. */
  private files(): Map<string, string> {
    const found = new Map<string, string>()
    for (const dir of this.dirs) {
      if (!existsSync(dir)) continue
      for (const name of readdirSync(dir)) if (/\.sf[23]$/i.test(name) && !found.has(name)) found.set(name, path.join(dir, name))
    }
    return found
  }

  /** The sound fonts there are, the one to use first. */
  list(): SoundFont[] {
    const files = this.files()
    const names = [...files.keys()]
    const rank = (name: string) => {
      const index = PREFERRED.indexOf(name)
      return index < 0 ? PREFERRED.length : index
    }
    names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    const fonts: SoundFont[] = names.map((name) => ({ name, bytes: statSync(files.get(name)!).size, main: false, ...describe(this.read(name), name) }))
    let extras = 0
    let main = false
    for (const font of fonts) {
      if (!main && font.kind === 'gm') {
        main = font.main = true
        const added = this.read(font.name)?.presets.filter((preset) => preset.bank === ADDED_BANK) ?? []
        if (added.length > 0) font.added = { bank: ADDED_BANK, presets: added.map(({ program, name }) => ({ program, name })) }
      } else font.bank = EXTRA_BANK + extras++
    }
    return fonts
  }

  /** The file of one of them, or null (only names from the list: nothing outside the folders). */
  file(name: string): string | null {
    return this.files().get(name) ?? null
  }

  /** The bytes the player loads: the main set as it is, any other prepared (see prepareExtra). */
  bytes(name: string): { bytes: Buffer; bank: number | null } | null {
    const font = this.list().find((item) => item.name === name)
    if (!font) return null
    const bytes = readFileSync(this.file(name)!)
    const parsed = font.main ? null : this.read(name)
    if (!parsed || font.bank === undefined) return { bytes, bank: null }
    return { bytes: prepareExtra(bytes, parsed, font.bank), bank: font.bank }
  }

  // Headers read once per version of the file.
  private read(name: string): Parsed | null {
    const file = this.file(name)
    if (!file) return null
    const info = statSync(file)
    const known = this.parsed.get(name)
    if (known && known.size === info.size && known.mtime === info.mtimeMs) return known.parsed
    const parsed = parseSoundFont(readFileSync(file))
    this.parsed.set(name, { size: info.size, mtime: info.mtimeMs, parsed })
    return parsed
  }
}

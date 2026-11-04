import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { EXTRA_BANK, parseSoundFont, type SoundFont } from './soundFonts.ts'

let dataDir: string
let close: (() => void) | null = null
beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'tabs-soundfonts-'))
})
afterEach(() => {
  close?.()
  close = null
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 })
})

function setup() {
  const { app, library } = createApp({ dataDir, soundFontDir: path.join(dataDir, 'soundfonts') })
  close = () => library.close()
  return app
}

function chunk(id: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.write(id, 0, 'latin1')
  head.writeUInt32LE(body.length, 4)
  return Buffer.concat([head, body, Buffer.alloc(body.length & 1)])
}

/** The bones of a SoundFont 2: presets (bank, program, name) and samples by type, nothing that plays. */
function soundFont(presets: Array<[number, number, string]>, sampleTypes: number[]): Buffer {
  const phdr = Buffer.alloc(38 * (presets.length + 1))
  ;[...presets, [0, 0, 'EOP'] as [number, number, string]].forEach(([bank, program, name], index) => {
    phdr.write(name, index * 38, 'latin1')
    phdr.writeUInt16LE(program, index * 38 + 20)
    phdr.writeUInt16LE(bank, index * 38 + 22)
  })
  const shdr = Buffer.alloc(46 * (sampleTypes.length + 1))
  sampleTypes.forEach((type, index) => shdr.writeUInt16LE(type, index * 46 + 44))
  const list = (kind: string, ...chunks: Buffer[]) => chunk('LIST', Buffer.concat([Buffer.from(kind, 'latin1'), ...chunks]))
  const body = Buffer.concat([Buffer.from('sfbk', 'latin1'), list('INFO', chunk('ifil', Buffer.alloc(4))), list('pdta', chunk('phdr', phdr), chunk('shdr', shdr))])
  return chunk('RIFF', body)
}

const GM = soundFont(
  Array.from({ length: 128 }, (_, program) => [0, program, `GM ${program}`]),
  [1],
)
const GUITAR = soundFont(
  [
    [0, 30, 'Whole'],
    [0, 10, 'RAW L'],
    [0, 11, 'RAW R'],
    [0, 4, 'ERS_L'],
    [0, 3, 'ERS'],
    [8, 30, 'Variation'],
    [128, 0, 'Kit'],
  ],
  [1, 2, 4, 8, 0x8004, 0x12],
)

describe('sound fonts', () => {
  it('lists none when there are none', async () => {
    expect(await (await setup().request('/api/soundfonts')).json()).toEqual([])
  })

  it('lists the preferred ones first, then the rest, and leaves out other files', async () => {
    const dir = path.join(dataDir, 'soundfonts')
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'Another.sf2'), GM)
    writeFileSync(path.join(dir, 'FluidR3Mono_GM.sf3'), 'FF')
    writeFileSync(path.join(dir, 'GeneralUser-GS.sf2'), 'GGG')
    writeFileSync(path.join(dir, 'GeneralUser-GS_License.txt'), 'licence')
    const app = setup()
    const fonts = (await (await app.request('/api/soundfonts')).json()) as SoundFont[]
    // The first General MIDI set is the main one; the others get banks of their own.
    expect(fonts.map(({ name, bytes, kind, main, bank }) => ({ name, bytes, kind, main, bank }))).toEqual([
      { name: 'GeneralUser-GS.sf2', bytes: 3, kind: 'gm', main: true, bank: undefined },
      { name: 'FluidR3Mono_GM.sf3', bytes: 2, kind: 'gm', main: false, bank: EXTRA_BANK },
      { name: 'Another.sf2', bytes: GM.length, kind: 'gm', main: false, bank: EXTRA_BANK + 1 },
    ])
    expect(fonts[0].presets).toEqual([])
    expect(fonts[2].presets).toHaveLength(128)
  })

  it('lists a set of a few instruments as an extra, in a bank of its own, with its whole presets', async () => {
    const dir = path.join(dataDir, 'soundfonts')
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'GeneralUser-GS.sf2'), GM)
    writeFileSync(path.join(dir, 'B Guitar.sf2'), GUITAR)
    writeFileSync(path.join(dir, 'A Guitar.sf2'), GUITAR)
    const fonts = (await (await setup().request('/api/soundfonts')).json()) as SoundFont[]
    expect(fonts.map((font) => [font.name, font.kind, font.main, font.bank])).toEqual([
      ['GeneralUser-GS.sf2', 'gm', true, undefined],
      ['A Guitar.sf2', 'extra', false, EXTRA_BANK],
      ['B Guitar.sf2', 'extra', false, EXTRA_BANK + 1],
    ])
    expect(fonts[1].presets).toEqual([
      { program: 30, name: 'Whole' },
      { program: 3, name: 'ERS' },
    ])
  })

  it('serves a set other than the main one moved to its bank, with every sample mono', async () => {
    const dir = path.join(dataDir, 'soundfonts')
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'Guitar.sf2'), GUITAR)
    const response = await setup().request('/api/soundfonts/Guitar.sf2')
    const bytes = Buffer.from(await response.arrayBuffer())
    const parsed = parseSoundFont(bytes)!
    // Bank 0 to its bank; a variation and a drum kit out of the way.
    expect(parsed.presets.map((preset) => preset.bank)).toEqual([EXTRA_BANK, EXTRA_BANK, EXTRA_BANK, EXTRA_BANK, EXTRA_BANK, 2047, 2047])
    const types = Array.from({ length: 6 }, (_, index) => bytes.readUInt16LE(parsed.shdr.offset + index * 46 + 44))
    // ROM and compressed flags stay.
    expect(types).toEqual([1, 1, 1, 1, 0x8001, 0x11])
    expect(response.headers.get('ETag')).toContain(`-b${EXTRA_BANK}`)
  })

  it('serves a listed file, answers "not changed" to the browser that has it, and nothing else', async () => {
    const dir = path.join(dataDir, 'soundfonts')
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'GeneralUser-GS.sf2'), 'GGG')
    writeFileSync(path.join(dataDir, 'secret.sf2'), 'no')
    const app = setup()
    const first = await app.request('/api/soundfonts/GeneralUser-GS.sf2')
    expect(first.status).toBe(200)
    expect(await first.text()).toBe('GGG')
    const etag = first.headers.get('ETag')!
    expect((await app.request('/api/soundfonts/GeneralUser-GS.sf2', { headers: { 'If-None-Match': etag } })).status).toBe(304)
    expect((await app.request('/api/soundfonts/Missing.sf2')).status).toBe(404)
    expect((await app.request('/api/soundfonts/..%2Fsecret.sf2')).status).toBe(404)
  })
})

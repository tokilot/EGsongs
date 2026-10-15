// Downloads a better General MIDI sound set than the one alphaTab ships with, and puts it where the player
// looks for it (web/public/sounds/). Run once: `npm run soundfont`. Without it the player falls back to the
// small bundled set.
//
// The file is FluidR3Mono_GM.sf3 (MIT, see web/public/sounds/FluidR3Mono_License.md after download). It comes
// from the npm package @librescore/sf3, fetched straight from the registry as a tarball so nothing is added
// to node_modules or the lockfile. The mono version matters: alphaTab's synthesizer skips stereo samples.
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

const TARBALL = 'https://registry.npmmirror.com/@librescore/sf3/-/sf3-0.8.0.tgz'
const WANTED = new Map([
  ['package/FluidR3Mono_GM.sf3.wasm', 'FluidR3Mono_GM.sf3'],
  ['package/FluidR3Mono_License.md', 'FluidR3Mono_License.md'],
])
const target = path.resolve(import.meta.dirname, '../web/public/sounds')

console.log(`Downloading ${TARBALL} (about 48 MB)…`)
const response = await fetch(TARBALL)
if (!response.ok) throw new Error(`Download failed: ${response.status}`)
const archive = gunzipSync(new Uint8Array(await response.arrayBuffer()))

// A tar file is a sequence of 512-byte headers, each followed by the file padded to 512 bytes.
mkdirSync(target, { recursive: true })
let offset = 0
let found = 0
while (offset + 512 <= archive.length) {
  const header = archive.subarray(offset, offset + 512)
  const name = Buffer.from(header.subarray(0, 100)).toString('utf8').replace(/\0.*$/s, '')
  if (!name) break
  const size = Number.parseInt(Buffer.from(header.subarray(124, 136)).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8)
  const body = archive.subarray(offset + 512, offset + 512 + size)
  const output = WANTED.get(name)
  if (output) {
    // The package ships the sound font with a .wasm extension; the bytes are a plain RIFF/sfbk file.
    if (output.endsWith('.sf3') && Buffer.from(body.subarray(8, 12)).toString('ascii') !== 'sfbk') {
      throw new Error(`${name} is not a SoundFont file`)
    }
    writeFileSync(path.join(target, output), body)
    console.log(`  ${output}  ${(size / 1e6).toFixed(1)} MB  sha256 ${createHash('sha256').update(body).digest('hex').slice(0, 16)}…`)
    found++
  }
  offset += 512 + Math.ceil(size / 512) * 512
}
if (found !== WANTED.size) throw new Error('The package did not contain the expected files.')
console.log(`Done. Reload the page; the player now uses ${path.join(target, 'FluidR3Mono_GM.sf3')}.`)

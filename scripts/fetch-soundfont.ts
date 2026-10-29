// Downloads a better General MIDI sound set than the one alphaTab ships with, and puts it where the player
// looks for it (web/public/sounds/). Run once. Without one the player falls back to the small bundled set.
//
//   npm run soundfont                 FluidR3Mono_GM.sf3 (MIT, about 15 MB)
//   npm run soundfont -- generaluser  GeneralUser-GS.sf2 (free to use and modify, about 32 MB)
//
// With both present the player uses GeneralUser GS; delete its file to go back to FluidR3.
//
// Only sets whose samples are all mono will do: alphaTab's synthesizer skips stereo samples, so instruments
// built from them stay silent. Both of these are mono throughout (checked 2026-10-20 for GeneralUser GS:
// 920 samples, all mono).
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

const target = path.resolve(import.meta.dirname, '../web/public/sounds')

function isSoundFont(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'sfbk'
}

function save(name: string, bytes: Uint8Array) {
  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, name), bytes)
  console.log(`  ${name}  ${(bytes.length / 1e6).toFixed(1)} MB  sha256 ${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}…`)
}

// FluidR3 Mono comes from the npm package @librescore/sf3, fetched straight from the registry as a tarball
// so nothing is added to node_modules or the lockfile.
async function fluidR3() {
  const tarball = 'https://registry.npmmirror.com/@librescore/sf3/-/sf3-0.8.0.tgz'
  const wanted = new Map([
    ['package/FluidR3Mono_GM.sf3.wasm', 'FluidR3Mono_GM.sf3'],
    ['package/FluidR3Mono_License.md', 'FluidR3Mono_License.md'],
  ])
  console.log(`Downloading ${tarball} (about 48 MB)…`)
  const response = await fetch(tarball)
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  const archive = gunzipSync(new Uint8Array(await response.arrayBuffer()))

  // A tar file is a sequence of 512-byte headers, each followed by the file padded to 512 bytes.
  let offset = 0
  let found = 0
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    const name = Buffer.from(header.subarray(0, 100)).toString('utf8').replace(/\0.*$/s, '')
    if (!name) break
    const size = Number.parseInt(Buffer.from(header.subarray(124, 136)).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8)
    const body = archive.subarray(offset + 512, offset + 512 + size)
    const output = wanted.get(name)
    if (output) {
      // The package ships the sound font with a .wasm extension; the bytes are a plain RIFF/sfbk file.
      if (output.endsWith('.sf3') && !isSoundFont(body)) throw new Error(`${name} is not a SoundFont file`)
      save(output, body)
      found++
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  if (found !== wanted.size) throw new Error('The package did not contain the expected files.')
  return 'FluidR3Mono_GM.sf3'
}

// GeneralUser GS (S. Christian Collins) from its GitHub repository, pinned to the version checked here.
// raw.githubusercontent.com does not answer from this machine, so the files come through the GitHub API; the
// author asks not to link to the download files on his site.
const GENERAL_USER = {
  repo: 'mrbumpy409/GeneralUser-GS',
  commit: '684543d5e5efaef08d02be50dcda8d552478fa60',
  // Git's own hash of the file at that commit, so the download can be checked.
  blob: '298b552d2e9d1307e03e5c5c99d2c046aaed9ec3',
}

async function generalUser() {
  const api = `https://api.github.com/repos/${GENERAL_USER.repo}`
  console.log(`Downloading GeneralUser GS from github.com/${GENERAL_USER.repo} (about 32 MB)…`)
  const response = await fetch(`${api}/git/blobs/${GENERAL_USER.blob}`, { headers: { Accept: 'application/vnd.github.raw' } })
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  if (hash !== GENERAL_USER.blob || !isSoundFont(bytes)) throw new Error('The download is not the expected GeneralUser GS file.')
  save('GeneralUser-GS.sf2', bytes)

  const license = await fetch(`${api}/contents/documentation/LICENSE.txt?ref=${GENERAL_USER.commit}`)
  if (license.ok) {
    const { content } = (await license.json()) as { content: string }
    save('GeneralUser-GS_License.txt', Buffer.from(content, 'base64'))
  }
  return 'GeneralUser-GS.sf2'
}

const which = process.argv[2] ?? 'fluidr3'
const fetchers: Record<string, () => Promise<string>> = { fluidr3: fluidR3, generaluser: generalUser }
const fetcher = fetchers[which]
if (!fetcher) throw new Error(`Unknown sound set "${which}"; use one of: ${Object.keys(fetchers).join(', ')}`)
const file = await fetcher()
console.log(`Done. Reload the page; the player uses ${path.join(target, file)} unless a preferred set is there too.`)

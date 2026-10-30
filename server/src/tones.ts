import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * The guitar tone library, kept in data/tones.json for every song (it used to live in the browser's storage).
 * The server only keeps it; its format (templates, chains, older versions) is the page's (web/src/tones/library.ts).
 */
export class ToneFile {
  private readonly file: string
  // One write at a time, in the order they came, so a slow one cannot land after a newer one.
  private writing: Promise<void> = Promise.resolve()

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'tones.json')
  }

  /** The library as last saved, or null before the first save. */
  read(): unknown {
    if (!existsSync(this.file)) return null
    try {
      return JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      return null
    }
  }

  save(library: unknown): Promise<void> {
    const write = async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      // Written aside and moved over, so a crash half way leaves the last library whole.
      const temporary = `${this.file}.tmp`
      await writeFile(temporary, JSON.stringify(library, null, 2))
      await rename(temporary, this.file)
    }
    this.writing = this.writing.then(write, write)
    return this.writing
  }
}

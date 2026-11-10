// data/songs/: one numbered folder per song's tab content (2026-11-10), 1, 2, 3… in the order they were made rather
// than by the online site's ids. Each holds an `origin.json` saying what it is: an online tab's revision (its meta
// and tracks, cached by songs/client.ts) or a file uploaded to the library (db/library.ts). Folders without one
// (data/songs/1/, kept for the tab that comes with the app) are only counted, never reused.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type FolderOrigin = { kind: 'online'; songId: number; revisionId: number } | { kind: 'file'; fileName: string }

const ORIGIN = 'origin.json'
const NUMBER = /^[1-9]\d*$/

export class SongFolders {
  readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  path(folder: string, file?: string): string {
    return file ? path.join(this.dir, folder, file) : path.join(this.dir, folder)
  }

  /** The numbered folders and what each holds (null for one without an origin.json). */
  list(): Array<{ folder: string; origin: FolderOrigin | null }> {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && NUMBER.test(entry.name))
      .map((entry) => ({ folder: entry.name, origin: this.origin(entry.name) }))
      .sort((a, b) => Number(a.folder) - Number(b.folder))
  }

  origin(folder: string): FolderOrigin | null {
    try {
      return JSON.parse(readFileSync(this.path(folder, ORIGIN), 'utf8')) as FolderOrigin
    } catch {
      return null
    }
  }

  /** A new folder, numbered one past the highest there is, with its origin written in it. */
  create(origin: FolderOrigin): string {
    const highest = Math.max(0, ...this.list().map((entry) => Number(entry.folder)))
    const folder = String(highest + 1)
    mkdirSync(this.path(folder), { recursive: true })
    writeFileSync(this.path(folder, ORIGIN), JSON.stringify(origin))
    return folder
  }

  remove(folder: string) {
    if (NUMBER.test(folder)) rmSync(this.path(folder), { recursive: true, force: true })
  }

  /**
   * Until 2026-11-10 the online cache was `{songId}/{revisionId}/` (the site's numbers). Those revisions become
   * numbered folders, oldest first, once; returns how many moved. A legacy folder is one holding a revision
   * folder with a meta.json in it.
   */
  numberLegacy(): number {
    if (!existsSync(this.dir)) return 0
    const legacy: Array<{ from: string; songId: number; revisionId: number; time: number }> = []
    for (const song of readdirSync(this.dir, { withFileTypes: true })) {
      if (!song.isDirectory() || !NUMBER.test(song.name) || existsSync(this.path(song.name, ORIGIN))) continue
      for (const revision of readdirSync(this.path(song.name), { withFileTypes: true })) {
        const meta = path.join(this.dir, song.name, revision.name, 'meta.json')
        if (revision.isDirectory() && NUMBER.test(revision.name) && existsSync(meta)) {
          legacy.push({ from: path.join(song.name, revision.name), songId: Number(song.name), revisionId: Number(revision.name), time: statSync(meta).mtimeMs })
        }
      }
    }
    if (legacy.length === 0) return 0
    // Out of the way first: a site id may be the very number the next folder gets.
    const staging = path.join(this.dir, '.numbering')
    mkdirSync(staging, { recursive: true })
    for (const [index, entry] of legacy.entries()) renameSync(path.join(this.dir, entry.from), path.join(staging, String(index)))
    for (const entry of legacy) {
      const song = this.path(entry.from.split(path.sep)[0])
      if (existsSync(song) && readdirSync(song).length === 0) rmSync(song, { recursive: true })
    }
    const order = legacy.map((entry, index) => ({ ...entry, index })).sort((a, b) => a.time - b.time)
    for (const entry of order) {
      const highest = Math.max(0, ...this.list().map((item) => Number(item.folder)))
      const folder = String(highest + 1)
      renameSync(path.join(staging, String(entry.index)), this.path(folder))
      writeFileSync(this.path(folder, ORIGIN), JSON.stringify({ kind: 'online', songId: entry.songId, revisionId: entry.revisionId }))
    }
    rmSync(staging, { recursive: true, force: true })
    return legacy.length
  }
}

import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/**
 * The guitar tone library, one for every song, kept as one JSON document in data/user.db (table `tone_library`).
 * The server only keeps it; its format (templates, chains, older versions) is the page's (web/src/tones/library.ts).
 */
export class ToneStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync, dataDir: string) {
    this.db = db
    this.db.exec('CREATE TABLE IF NOT EXISTS tone_library (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)')
    // Until 2026-10-31 it was data/tones.json: taken in once, then gone.
    const old = path.join(dataDir, 'tones.json')
    if (existsSync(old)) {
      try {
        if (this.read() === null) this.write(JSON.parse(readFileSync(old, 'utf8')))
        rmSync(old, { force: true })
      } catch {
        // Not readable JSON: left where it is.
      }
    }
  }

  /** The library as last saved, or null before the first save. */
  read(): unknown {
    const row = this.db.prepare('SELECT json FROM tone_library WHERE id = 1').get() as { json: string } | undefined
    return row ? JSON.parse(row.json) : null
  }

  // A single statement: SQLite writes it whole or not at all.
  private write(library: unknown) {
    this.db.prepare('INSERT OR REPLACE INTO tone_library (id, json) VALUES (1, ?)').run(JSON.stringify(library))
  }

  async save(library: unknown): Promise<void> {
    this.write(library)
  }
}

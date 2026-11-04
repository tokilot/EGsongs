import { existsSync, renameSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * The user's own data, in one SQLite file: data/user.db (the songs, their practice settings and tab files, and the
 * guitar tone library). Until 2026-10-31 it was library.db, renamed here on first start.
 */
export function openUserDb(dataDir: string): DatabaseSync {
  const file = path.join(dataDir, 'user.db')
  const old = path.join(dataDir, 'library.db')
  if (!existsSync(file) && existsSync(old)) {
    renameSync(old, file)
    // A rollback journal left by a crash goes with it.
    if (existsSync(`${old}-journal`)) renameSync(`${old}-journal`, `${file}-journal`)
  }
  return new DatabaseSync(file)
}

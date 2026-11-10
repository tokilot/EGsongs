import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { SongFolders } from './songs/songFolders.ts'

const META = { songId: 34008, revisionId: 7221665, title: 'Promise', artist: 'Akira Yamaoka', image: 'v0', restriction: '', defaultTrack: 0, tracks: [{ name: 'Lead' }, { name: 'Rhythm' }] }

/** Stands in for the online tab site: one song, two tracks. */
const upstream = (async (input: string | URL | Request) => {
  const url = String(input)
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
  if (/\/api\/meta\/34008(\/\d+)?$/.test(url)) return json(META)
  const track = /\/(\d+)\.json$/.exec(url)
  if (track) return json({ name: `track ${track[1]}`, measures: [] })
  return new Response('{}', { status: 404 })
}) as typeof fetch

let dataDir: string
let close: (() => void) | null = null
beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'tabs-library-'))
})
afterEach(() => {
  close?.()
  close = null
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 })
})

function start(atStartup = false) {
  close?.()
  const made = createApp({ dataDir, fetch: upstream, songsterrIntervalMs: 0, atStartup })
  close = () => made.library.close()
  const call = async (method: string, url: string, body?: unknown) => {
    const response = await made.app.request(url, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return response
  }
  return { ...made, call }
}

const folders = () => new SongFolders(path.join(dataDir, 'songs'))
/** user.db's tab content for one song: which kinds it keeps. */
const kept = (library: ReturnType<typeof start>['library'], id: number) =>
  (library as unknown as { db: { prepare(sql: string): { all(...args: unknown[]): Array<{ kind: string }> } } }).db
    .prepare('SELECT kind FROM song_files WHERE song_id = ? ORDER BY kind')
    .all(id)
    .map((row) => row.kind)

describe('where a tab is kept', () => {
  it('keeps an uploaded song that is not a favourite in its own numbered folder, and a favourite in user.db', async () => {
    const { library, call } = start()
    const song = await library.addFile('Riff.gp', new Uint8Array([1, 2, 3]))
    const [{ folder, origin }] = folders().list()
    expect(folder).toBe('1')
    expect(origin).toEqual({ kind: 'file', fileName: 'Riff.gp' })
    expect(readFileSync(path.join(dataDir, 'songs', '1', 'Riff.gp'))).toEqual(Buffer.from([1, 2, 3]))
    expect(kept(library, song.id)).toEqual([])
    await library.saveEdited(song.id, new Uint8Array([9]))
    expect(existsSync(path.join(dataDir, 'songs', '1', 'edited.gp'))).toBe(true)

    // Starred: into user.db, and its folder goes.
    await call('PATCH', `/api/songs/${song.id}`, { favorite: true })
    expect(kept(library, song.id)).toEqual(['edited', 'source'])
    expect(folders().list()).toEqual([])
    expect(new Uint8Array(await (await call('GET', `/api/songs/${song.id}/file`)).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(new Uint8Array(await (await call('GET', `/api/songs/${song.id}/edited`)).arrayBuffer())).toEqual(new Uint8Array([9]))

    // Unstarred: back into a (new) folder, nothing left in user.db.
    await call('PATCH', `/api/songs/${song.id}`, { favorite: false })
    expect(kept(library, song.id)).toEqual([])
    const [back] = folders().list()
    expect(readdirSync(path.join(dataDir, 'songs', back.folder)).sort()).toEqual(['Riff.gp', 'edited.gp', 'origin.json'])
    expect(new Uint8Array(await (await call('GET', `/api/songs/${song.id}/file`)).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))

    // Deleted: its folder goes too.
    await call('DELETE', `/api/songs/${song.id}`)
    expect(folders().list()).toEqual([])
  })

  it('keeps a song imported by link in the online cache, and a favourite\'s tab in user.db as well', async () => {
    const { library, call } = start()
    const song = (await (await call('POST', '/api/songsterr/import', { url: '34008' })).json()) as { id: number }
    const [{ folder, origin }] = folders().list()
    expect(origin).toEqual({ kind: 'online', songId: 34008, revisionId: 7221665 })
    expect(readdirSync(path.join(dataDir, 'songs', folder)).sort()).toEqual(['0.json', '1.json', 'meta.json', 'origin.json'])
    expect(kept(library, song.id)).toEqual([])

    await call('PATCH', `/api/songs/${song.id}`, { favorite: true })
    expect(kept(library, song.id)).toEqual(['online'])
    // With the cache gone, a favourite still opens (from user.db) without asking the site.
    rmSync(path.join(dataDir, 'songs'), { recursive: true })
    const reopened = start()
    const tracks = (await (await reopened.call('GET', `/api/songs/${song.id}/tracks`)).json()) as { tracks: Array<{ name: string }> }
    expect(tracks.tracks.map((track) => track.name)).toEqual(['track 0', 'track 1'])
    // Unstarred: its tab goes back into the cache.
    await reopened.call('PATCH', `/api/songs/${song.id}`, { favorite: false })
    expect(kept(reopened.library, song.id)).toEqual([])
    expect(folders().list().map((entry) => entry.origin)).toEqual([{ kind: 'online', songId: 34008, revisionId: 7221665 }])
  })

  it('numbers new folders after the ones there are, the kept one (data/songs/1/) included', async () => {
    mkdirSync(path.join(dataDir, 'songs', '1'), { recursive: true })
    const { library } = start()
    await library.addFile('a.gp', new Uint8Array([1]))
    await library.addFile('b.gp', new Uint8Array([2]))
    expect(folders().list().map((entry) => [entry.folder, entry.origin?.kind ?? null])).toEqual([['1', null], ['2', 'file'], ['3', 'file']])
  })
})

describe('starting the server', () => {
  it('makes the data folder on first start: user.db and the folders filled by hand', async () => {
    const fresh = path.join(dataDir, 'not yet')
    const made = createApp({ dataDir: fresh, resourcesDir: path.join(dataDir, 'resources') })
    made.library.close()
    for (const dir of ['soundfonts', 'models/separator', 'models/transcriber']) {
      expect(existsSync(path.join(fresh, dir)), dir).toBe(true)
    }
    expect(existsSync(path.join(fresh, 'user.db'))).toBe(true)
    // The beat tracker is optional: its folder is made by whoever puts one in.
    expect(existsSync(path.join(fresh, 'models/transcriber/beat_this'))).toBe(false)
  })

  it('keeps songs that are not favourites and their last opened times, and drops those whose tab is gone', async () => {
    const first = start()
    const browsed = await first.library.addFile('browsed.gp', new Uint8Array([1]))
    const gone = await first.library.addFile('gone.gp', new Uint8Array([2]))
    const starred = await first.library.addFile('starred.gp', new Uint8Array([3]))
    await first.library.update(starred.id, { favorite: true })
    first.library.touch(browsed.id)
    rmSync(path.join(dataDir, 'songs', folders().list().find((entry) => entry.origin?.kind === 'file' && entry.origin.fileName === 'gone.gp')!.folder), { recursive: true })
    mkdirSync(path.join(dataDir, 'tmps', 'stems'), { recursive: true })

    const next = start(true)
    expect(await next.ready).toMatchObject({ dropped: 1 })
    expect(next.library.list().map((song) => song.title).sort()).toEqual(['browsed', 'starred'])
    expect(next.library.get(browsed.id)?.lastOpenedAt).not.toBeNull()
    expect(next.library.get(gone.id)).toBeNull()
    expect(existsSync(path.join(dataDir, 'tmps'))).toBe(false)
  })

  it('renumbers the online cache of before and moves the tabs to where they now belong, after a copy of user.db', async () => {
    // As it was: the cache by the site's ids; an unstarred upload's file in user.db; a starred link with only the cache.
    const legacy = path.join(dataDir, 'songs', '34008', '7221665')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(path.join(legacy, 'meta.json'), JSON.stringify(META))
    writeFileSync(path.join(legacy, '0.json'), JSON.stringify({ name: 'track 0' }))
    writeFileSync(path.join(legacy, '1.json'), JSON.stringify({ name: 'track 1' }))
    const first = start()
    // The client numbered the cache as it started; put it back the old way for the run that matters.
    rmSync(path.join(dataDir, 'songs'), { recursive: true })
    mkdirSync(legacy, { recursive: true })
    writeFileSync(path.join(legacy, 'meta.json'), JSON.stringify(META))
    writeFileSync(path.join(legacy, '0.json'), JSON.stringify({ name: 'track 0' }))
    writeFileSync(path.join(legacy, '1.json'), JSON.stringify({ name: 'track 1' }))
    const db = (first.library as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): { lastInsertRowid: number | bigint } } } }).db
    const upload = Number(db.prepare("INSERT INTO songs (source, title, artist, file_name, created_at) VALUES ('file', 'old', '', 'old.gp', ?)").run(new Date().toISOString()).lastInsertRowid)
    db.prepare("INSERT INTO song_files (song_id, kind, bytes) VALUES (?, 'source', ?)").run(upload, new Uint8Array([7]))
    const song = first.library.addSongsterr({ songsterrId: 34008, revisionId: 7221665, revisionDate: null, title: 'Promise', artist: '', sourceUrl: '', trackCount: 2, defaultTrack: 0 })
    db.prepare('UPDATE songs SET favorite = 1 WHERE id = ?').run(song.id)
    close?.()
    close = null

    const next = start(true)
    expect(await next.ready).toMatchObject({ renumbered: 1, moved: 2, dropped: 0 })
    expect(existsSync(path.join(dataDir, 'user.db.before-2026-11-10.bak'))).toBe(true)
    expect(existsSync(path.join(dataDir, 'songs', '34008'))).toBe(false)
    expect(kept(next.library, song.id)).toEqual(['online'])
    expect(kept(next.library, upload)).toEqual([])
    expect(new Uint8Array((await next.library.readFile(next.library.get(upload)!))!)).toEqual(new Uint8Array([7]))
    expect(folders().list().map((entry) => entry.origin)).toEqual([
      { kind: 'online', songId: 34008, revisionId: 7221665 },
      { kind: 'file', fileName: 'old.gp' },
    ])
  })

  it('puts the tabs that come with the app in a new library, as favourites, once', async () => {
    const demos = path.join(dataDir, 'demo')
    mkdirSync(demos)
    writeFileSync(path.join(demos, 'Demo.gp'), new Uint8Array([5, 6]))
    writeFileSync(path.join(demos, 'notes.txt'), 'not a tab')
    const startWith = () => {
      close?.()
      const made = createApp({ dataDir, atStartup: true, demoSongsDir: demos, resourcesDir: path.join(dataDir, 'resources') })
      close = () => made.library.close()
      return made
    }
    const first = startWith()
    expect(await first.ready).toMatchObject({ demos: 1 })
    const [demo] = first.library.list()
    expect(demo).toMatchObject({ title: 'Demo', favorite: true })
    expect(new Uint8Array((await first.library.readFile(demo))!)).toEqual(new Uint8Array([5, 6]))
    // Deleted, it stays deleted.
    await first.library.remove(demo.id)
    const next = startWith()
    expect(await next.ready).toMatchObject({ demos: 0 })
    expect(next.library.list()).toEqual([])
  })

  it('leaves a library that has had songs without the tabs that come with the app', async () => {
    const demos = path.join(dataDir, 'demo')
    mkdirSync(demos)
    writeFileSync(path.join(demos, 'Demo.gp'), new Uint8Array([5]))
    const first = start()
    await first.library.addFile('mine.gp', new Uint8Array([1]))
    close?.()
    close = null
    const next = createApp({ dataDir, atStartup: true, demoSongsDir: demos })
    close = () => next.library.close()
    expect(await next.ready).toMatchObject({ demos: 0 })
    expect(next.library.list().map((song) => song.title)).toEqual(['mine'])
  })

  it('changes nothing unless asked (as in the tests and scripts that make apps over and over)', async () => {
    const first = start()
    const song = await first.library.addFile('browsed.gp', new Uint8Array([2]))
    rmSync(path.join(dataDir, 'songs'), { recursive: true })
    const next = start()
    expect(await next.ready).toMatchObject({ moved: 0, dropped: 0 })
    expect(next.library.get(song.id)).not.toBeNull()
  })
})

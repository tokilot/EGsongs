import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SongFolders } from './songFolders.ts'

// Everything we know about the undocumented Songsterr endpoints lives in this file.
const SITE = 'https://www.songsterr.com'
const TRACK_CDN = 'https://dqsljvtekg760.cloudfront.net'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0'
// Match the installed Edge's browser headers (verified 2026-11-06). The old Chrome/126.0 identity still works for
// search but gets 403 for metadata, even with Accept-Language. Node's default language "*" is also rejected.
// Use the same headers for search, metadata, revisions and tracks; restricted tabs are still refused below.
const REQUEST_HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' }

export interface SongsterrTrackInfo {
  instrumentId: number
  instrument: string
  name: string
  tuning?: number[]
  isVocalTrack?: boolean
  isEmpty?: boolean
}

export interface SongsterrMeta {
  songId: number
  revisionId: number
  title: string
  artist: string
  image: string
  createdAt?: string
  restriction?: string
  isRestricted?: boolean
  defaultTrack: number
  tracks: SongsterrTrackInfo[]
}

export interface SongsterrSearchHit {
  songId: number
  title: string
  artist: string
  trackCount: number
}

export interface SongsterrRevision {
  revisionId: number
  createdAt: string
  author: string
  description: string
}

export class SongsterrError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'SongsterrError'
    this.status = status
  }
}

/** Accepts a song URL (only the trailing `s{songId}` matters) or a bare numeric id. */
export function parseSongId(input: string): number | null {
  const text = input.trim()
  if (/^\d+$/.test(text)) return Number(text)
  const match = /songsterr\.com\/.*?-s(\d+)(?:t\d+)?(?:[/?#]|$)/i.exec(text)
  return match ? Number(match[1]) : null
}

export function songUrl(meta: Pick<SongsterrMeta, 'songId' | 'artist' | 'title'>): string {
  const slug = `${meta.artist} ${meta.title}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${SITE}/a/wsa/${slug || 'song'}-tab-s${meta.songId}`
}

export interface SongsterrClientOptions {
  /**
   * Directory of the cache: a numbered folder per revision (songFolders.ts) holding `meta.json` and
   * `{trackIndex}.json`; or, with `layout: 'by-id'` (the test songs in test/songs/), `{songId}/{revisionId}/`.
   */
  cacheDir: string
  layout?: 'numbered' | 'by-id'
  fetch?: typeof fetch
  /** Minimum delay between two upstream requests. */
  minIntervalMs?: number
}

/** A revision as cached: its meta and every track. */
export interface CachedRevision {
  meta: SongsterrMeta
  tracks: unknown[]
}

export class SongsterrClient {
  private readonly cacheDir: string
  private readonly folders: SongFolders | null
  /** `{songId}/{revisionId}` -> its numbered folder, read from the folders' origin.json once. */
  private index: Map<string, string> | null = null
  private readonly fetchImpl: typeof fetch
  private readonly minIntervalMs: number
  private queue: Promise<unknown> = Promise.resolve()
  private lastRequestAt = 0
  /** Revisions moved out of the `{songId}/{revisionId}/` cache of before 2026-11-10, when this started. */
  readonly renumbered: number

  constructor(options: SongsterrClientOptions) {
    this.cacheDir = options.cacheDir
    this.folders = options.layout === 'by-id' ? null : new SongFolders(options.cacheDir)
    this.renumbered = this.folders?.numberLegacy() ?? 0
    this.fetchImpl = options.fetch ?? fetch
    this.minIntervalMs = options.minIntervalMs ?? 400
  }

  /** The folder a revision is cached in, or null when it is not cached (nothing is created). */
  cacheFolder(songId: number, revisionId: number): string | null {
    if (!this.folders) return path.join(this.cacheDir, String(songId), String(revisionId))
    const folder = this.indexed().get(`${songId}/${revisionId}`)
    return folder ? this.folders.path(folder) : null
  }

  /** The revision with every track, when all of it is cached; null when anything is missing. */
  async cached(songId: number, revisionId: number): Promise<CachedRevision | null> {
    const meta = await this.readCache<SongsterrMeta>(songId, revisionId, 'meta')
    if (!meta) return null
    const tracks: unknown[] = []
    for (let index = 0; index < meta.tracks.length; index++) {
      const track = await this.readCache<unknown>(songId, revisionId, String(index))
      if (track === null) return null
      tracks.push(track)
    }
    return { meta, tracks }
  }

  /** Puts a whole revision (kept elsewhere, e.g. with a favourite) back into the cache. */
  async store(revision: CachedRevision): Promise<void> {
    const { songId, revisionId } = revision.meta
    await this.writeCache(songId, revisionId, 'meta', revision.meta)
    for (const [index, track] of revision.tracks.entries()) await this.writeCache(songId, revisionId, String(index), track)
  }

  private indexed(): Map<string, string> {
    if (!this.index) {
      this.index = new Map()
      for (const { folder, origin } of this.folders?.list() ?? []) {
        if (origin?.kind === 'online') this.index.set(`${origin.songId}/${origin.revisionId}`, folder)
      }
    }
    return this.index
  }

  /** Latest revision when `revisionId` is omitted (always asks upstream); a pinned revision is served from disk once fetched. */
  async getMeta(songId: number, revisionId?: number): Promise<SongsterrMeta> {
    if (revisionId !== undefined) {
      const cached = await this.readCache<SongsterrMeta>(songId, revisionId, 'meta')
      if (cached) return cached
    }
    const url = revisionId === undefined ? `${SITE}/api/meta/${songId}` : `${SITE}/api/meta/${songId}/${revisionId}`
    const raw = (await this.request(url)) as Record<string, unknown>
    const meta = pickMeta(raw)
    if (meta.restriction || meta.isRestricted) {
      throw new SongsterrError('This tab is restricted and cannot be imported.', 403)
    }
    await this.writeCache(meta.songId, meta.revisionId, 'meta', meta)
    return meta
  }

  async getTrack(meta: SongsterrMeta, trackIndex: number): Promise<unknown> {
    if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= meta.tracks.length) {
      throw new SongsterrError(`Track ${trackIndex} does not exist.`, 404)
    }
    const cached = await this.readCache<unknown>(meta.songId, meta.revisionId, String(trackIndex))
    if (cached) return cached
    const track = await this.request(`${TRACK_CDN}/${meta.songId}/${meta.revisionId}/${meta.image}/${trackIndex}.json`)
    await this.writeCache(meta.songId, meta.revisionId, String(trackIndex), track)
    return track
  }

  async getAllTracks(meta: SongsterrMeta): Promise<unknown[]> {
    const tracks: unknown[] = []
    for (let i = 0; i < meta.tracks.length; i++) tracks.push(await this.getTrack(meta, i))
    return tracks
  }

  async search(pattern: string, size = 20): Promise<SongsterrSearchHit[]> {
    const url = `${SITE}/api/songs?size=${size}&pattern=${encodeURIComponent(pattern)}`
    const hits = (await this.request(url)) as Array<Record<string, unknown>>
    return hits.map((hit) => ({
      songId: Number(hit.songId),
      title: String(hit.title ?? ''),
      artist: String(hit.artist ?? ''),
      trackCount: Array.isArray(hit.tracks) ? hit.tracks.length : 0,
    }))
  }

  async getRevisions(songId: number): Promise<SongsterrRevision[]> {
    const list = (await this.request(`${SITE}/api/meta/${songId}/revisions`)) as Array<Record<string, unknown>>
    const visible = list.filter((item) => item.isDeleted !== true && item.isBlocked !== true)
    return visible.map((item) => {
      const author = item.author as { name?: unknown } | string | undefined
      return {
        revisionId: Number(item.revisionId),
        createdAt: String(item.createdAt ?? ''),
        author: typeof author === 'object' && author ? String(author.name ?? '') : String(author ?? item.person ?? ''),
        description: String(item.description ?? ''),
      }
    })
  }

  // Upstream requests run one at a time with a pause in between.
  private request(url: string): Promise<unknown> {
    const run = async () => {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      this.lastRequestAt = Date.now()
      let response: Response
      try {
        response = await this.fetchImpl(url, { headers: REQUEST_HEADERS })
      } catch (error) {
        throw new SongsterrError(`Could not reach the tab site: ${(error as Error).message}`, 502)
      }
      if (response.status === 404) throw new SongsterrError('Not found.', 404)
      if (!response.ok) throw new SongsterrError(`The tab site answered ${response.status}.`, 502)
      return response.json()
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async readCache<T>(songId: number, revisionId: number, name: string): Promise<T | null> {
    const folder = this.cacheFolder(songId, revisionId)
    if (!folder) return null
    try {
      return JSON.parse(await readFile(path.join(folder, `${name}.json`), 'utf8')) as T
    } catch {
      return null
    }
  }

  private async writeCache(songId: number, revisionId: number, name: string, value: unknown): Promise<void> {
    let folder = this.cacheFolder(songId, revisionId)
    if (!folder && this.folders) {
      // Made (and indexed) before anything is awaited, so two writes for one revision share the folder.
      const made = this.folders.create({ kind: 'online', songId, revisionId })
      this.indexed().set(`${songId}/${revisionId}`, made)
      folder = this.folders.path(made)
    }
    await mkdir(folder!, { recursive: true })
    await writeFile(path.join(folder!, `${name}.json`), JSON.stringify(value))
  }
}

function pickMeta(raw: Record<string, unknown>): SongsterrMeta {
  const tracks = Array.isArray(raw.tracks) ? (raw.tracks as Array<Record<string, unknown>>) : []
  return {
    songId: Number(raw.songId),
    revisionId: Number(raw.revisionId),
    title: String(raw.title ?? ''),
    artist: String(raw.artist ?? ''),
    image: String(raw.image ?? ''),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    restriction: typeof raw.restriction === 'string' ? raw.restriction : undefined,
    isRestricted: raw.isRestricted === true,
    defaultTrack: Number(raw.defaultTrack ?? 0),
    tracks: tracks.map((track) => ({
      instrumentId: Number(track.instrumentId),
      instrument: String(track.instrument ?? ''),
      name: String(track.name ?? ''),
      tuning: Array.isArray(track.tuning) ? (track.tuning as number[]) : undefined,
      isVocalTrack: track.isVocalTrack === true,
      isEmpty: track.isEmpty === true,
    })),
  }
}

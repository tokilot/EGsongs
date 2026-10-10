import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Everything we know about the undocumented Songsterr endpoints lives in this file.
const SITE = 'https://www.songsterr.com'
const TRACK_CDN = 'https://dqsljvtekg760.cloudfront.net'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

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
  /** Directory holding `{songId}/{revisionId}/meta.json` and `{trackIndex}.json`. */
  cacheDir: string
  fetch?: typeof fetch
  /** Minimum delay between two upstream requests. */
  minIntervalMs?: number
}

export class SongsterrClient {
  private readonly cacheDir: string
  private readonly fetchImpl: typeof fetch
  private readonly minIntervalMs: number
  private queue: Promise<unknown> = Promise.resolve()
  private lastRequestAt = 0

  constructor(options: SongsterrClientOptions) {
    this.cacheDir = options.cacheDir
    this.fetchImpl = options.fetch ?? fetch
    this.minIntervalMs = options.minIntervalMs ?? 400
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
      throw new SongsterrError('This tab is restricted on Songsterr and cannot be imported.', 403)
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
        response = await this.fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
      } catch (error) {
        throw new SongsterrError(`Could not reach Songsterr: ${(error as Error).message}`, 502)
      }
      if (response.status === 404) throw new SongsterrError('Not found on Songsterr.', 404)
      if (!response.ok) throw new SongsterrError(`Songsterr answered ${response.status}.`, 502)
      return response.json()
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
  }

  private file(songId: number, revisionId: number, name: string): string {
    return path.join(this.cacheDir, String(songId), String(revisionId), `${name}.json`)
  }

  private async readCache<T>(songId: number, revisionId: number, name: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.file(songId, revisionId, name), 'utf8')) as T
    } catch {
      return null
    }
  }

  private async writeCache(songId: number, revisionId: number, name: string, value: unknown): Promise<void> {
    const file = this.file(songId, revisionId, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(value))
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

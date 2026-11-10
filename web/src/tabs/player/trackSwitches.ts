// Automatic track switches (2026-11-03, for practice): "from bar N on, show track X" (set at the start of the bar
// since 2026-11-05; before, "after bar N"). Which track a bar plays is decided by its position: the last switch at or
// before it, or the track picked by hand when there is none. So a loop or a repeat that jumps back brings back the
// track that belongs there. Kept with the song (`trackSwitchesFrom`; the older `trackSwitches` were "after" bars).

/** Master bar index (0-based) -> the track shown from that bar on. */
export type TrackSwitches = Record<string, number>

/** Stored switches made safe: bar indexes to track indexes, both whole numbers, within the song when its size is known. */
export function cleanTrackSwitches(raw: unknown, size?: { bars: number; tracks: number }): TrackSwitches {
  const result: TrackSwitches = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  for (const [bar, track] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(bar) || typeof track !== 'number' || !Number.isInteger(track) || track < 0) continue
    if (size && (Number(bar) >= size.bars || track >= size.tracks)) continue
    result[String(Number(bar))] = track
  }
  return result
}

/**
 * Switches stored the older way ("after bar N") as they are now: from the bar after. A switch after the last bar
 * never took effect and is left out (cleanTrackSwitches does that once the song's size is known).
 */
export function switchesFromOld(raw: unknown): TrackSwitches {
  const old = cleanTrackSwitches(raw)
  return Object.fromEntries(Object.entries(old).map(([bar, track]) => [String(Number(bar) + 1), track]))
}

/** The track bar `bar` plays: that of the last switch at or before it, else `base` (the one picked by hand). */
export function trackForBar(switches: TrackSwitches, bar: number, base: number): number {
  let best = -1
  let track = base
  for (const [key, value] of Object.entries(switches)) {
    const from = Number(key)
    if (from <= bar && from > best) {
      best = from
      track = value
    }
  }
  return track
}

/** The switches with the one at the start of `bar` set to `track`, or taken away (null). */
export function withTrackSwitch(switches: TrackSwitches, bar: number, track: number | null): TrackSwitches {
  const next = { ...switches }
  if (track === null) delete next[bar]
  else next[bar] = track
  return next
}

/** The switches after track `removed` is deleted: those to it gone, those to later tracks moved down. */
export function switchesAfterRemoval(switches: TrackSwitches, removed: number): TrackSwitches {
  const result: TrackSwitches = {}
  for (const [bar, track] of Object.entries(switches)) {
    if (track !== removed) result[bar] = track > removed ? track - 1 : track
  }
  return result
}

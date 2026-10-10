/** The test songs listed in CLAUDE.md ("测试案例"). Numbers are what the pinned revision contains. */
export interface Fixture {
  no: number
  songId: number
  revisionId: number
  tracks: number
  defaultTrack: number
  bars: number
}

export const FIXTURES: Fixture[] = [
  { no: 1, songId: 34008, revisionId: 7221665, tracks: 7, defaultTrack: 3, bars: 95 },
  { no: 2, songId: 92811, revisionId: 9134272, tracks: 3, defaultTrack: 0, bars: 61 },
  { no: 3, songId: 23, revisionId: 9403415, tracks: 9, defaultTrack: 3, bars: 185 },
  { no: 4, songId: 6700, revisionId: 9264176, tracks: 6, defaultTrack: 3, bars: 238 },
  { no: 5, songId: 16220, revisionId: 8308573, tracks: 11, defaultTrack: 3, bars: 115 },
  { no: 6, songId: 360, revisionId: 9427627, tracks: 7, defaultTrack: 2, bars: 120 },
  { no: 7, songId: 6702, revisionId: 1986429, tracks: 2, defaultTrack: 0, bars: 119 },
  { no: 8, songId: 18431, revisionId: 6216448, tracks: 6, defaultTrack: 1, bars: 177 },
  { no: 9, songId: 27, revisionId: 9538267, tracks: 13, defaultTrack: 1, bars: 167 },
  { no: 10, songId: 447, revisionId: 9219749, tracks: 13, defaultTrack: 3, bars: 121 },
]

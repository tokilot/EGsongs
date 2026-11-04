import { describe, expect, it } from 'vitest'
import { cleanTrackSwitches, switchesFromOld, trackForBar, withTrackSwitch } from './trackSwitches.ts'

describe('track switches', () => {
  // From bar 4 (the fifth) the rhythm guitar (track 1), from bar 8 the bass (track 2); the lead (track 0) by hand.
  const switches = { 4: 1, 8: 2 }

  it('gives every bar the track of the last switch at or before it, else the one picked by hand', () => {
    expect([0, 3].map((bar) => trackForBar(switches, bar, 0))).toEqual([0, 0])
    expect([4, 7].map((bar) => trackForBar(switches, bar, 0))).toEqual([1, 1])
    expect([8, 40].map((bar) => trackForBar(switches, bar, 0))).toEqual([2, 2])
    // A switch at the first bar replaces the track picked by hand from the start.
    expect(trackForBar({ 0: 2 }, 0, 0)).toBe(2)
    // Jumping back (a loop, a repeat) brings back what belongs there.
    expect(trackForBar(switches, 2, 3)).toBe(3)
    expect(trackForBar({}, 7, 3)).toBe(3)
  })

  it('reads stored switches safely, leaving out what the song does not have', () => {
    expect(cleanTrackSwitches({ 4: 1, '08': 2 })).toEqual({ 4: 1, 8: 2 })
    expect(cleanTrackSwitches({ x: 1, 2: -1, 3: 1.5, 5: '2', 6: 9 }, { bars: 100, tracks: 3 })).toEqual({})
    expect(cleanTrackSwitches({ 120: 1, 4: 1 }, { bars: 95, tracks: 7 })).toEqual({ 4: 1 })
    expect(cleanTrackSwitches(null)).toEqual({})
    expect(cleanTrackSwitches([1, 2])).toEqual({})
  })

  it('reads the switches stored the older way ("after bar N") as from the bar after', () => {
    expect(switchesFromOld({ 3: 1, 7: 2 })).toEqual({ 4: 1, 8: 2 })
    // After the last bar it never took effect: left out once the song's size is known.
    expect(cleanTrackSwitches(switchesFromOld({ 3: 1, 94: 2 }), { bars: 95, tracks: 3 })).toEqual({ 4: 1 })
    expect(switchesFromOld(undefined)).toEqual({})
  })

  it('sets and takes away one switch', () => {
    expect(withTrackSwitch(switches, 12, 0)).toEqual({ 4: 1, 8: 2, 12: 0 })
    expect(withTrackSwitch(switches, 4, 2)).toEqual({ 4: 2, 8: 2 })
    expect(withTrackSwitch(switches, 8, null)).toEqual({ 4: 1 })
    expect(switches).toEqual({ 4: 1, 8: 2 })
  })
})

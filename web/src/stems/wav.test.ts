import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav.ts'

describe('encodeWav', () => {
  it('writes 16-bit PCM with interleaved channels', async () => {
    const left = new Float32Array([0, 1, -1, 0.5])
    const right = new Float32Array([2, -2, 0, -0.5])
    const blob = encodeWav([left, right], 44100)
    const view = new DataView(await blob.arrayBuffer())
    const text = (offset: number) => String.fromCharCode(...new Uint8Array(view.buffer, offset, 4))
    expect(text(0)).toBe('RIFF')
    expect(text(8)).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(16)
    expect(view.byteLength).toBe(44 + 16)
    const samples = Array.from(new Int16Array(view.buffer, 44))
    // Out-of-range values are clipped.
    expect(samples).toEqual([0, 32767, 32767, -32768, -32768, 0, 16384, -16384])
  })
})

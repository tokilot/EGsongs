// The page decodes the recording itself (the browser reads MP3, M4A, FLAC, OGG and WAV) and sends the server
// plain WAV, so the separation needs no ffmpeg.

/** The rate the separation model was trained at. */
export const STEM_SAMPLE_RATE = 44100

/** 16-bit PCM WAV of the given channels (all the same length). */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const channelCount = channels.length
  const frames = channels[0]?.length ?? 0
  const dataBytes = frames * channelCount * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channelCount * 2, true)
  view.setUint16(32, channelCount * 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, dataBytes, true)
  const samples = new Int16Array(buffer, 44)
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const value = Math.max(-1, Math.min(1, channels[channel][frame]))
      samples[frame * channelCount + channel] = Math.round(value < 0 ? value * 0x8000 : value * 0x7fff)
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/** Decodes an audio file to stereo WAV at the model's rate; a mono recording goes to both sides. */
export async function decodeToWav(file: Blob): Promise<Blob> {
  const context = new OfflineAudioContext(2, 1, STEM_SAMPLE_RATE)
  const decoded = await context.decodeAudioData(await file.arrayBuffer())
  const left = decoded.getChannelData(0)
  const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left
  return encodeWav([left, right], decoded.sampleRate)
}

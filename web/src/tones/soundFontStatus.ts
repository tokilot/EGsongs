// The sample sets of data/soundfonts/ as the tone page names them and tells where they stand.
import { usePlayer } from '../tabs/player/usePlayer.ts'
import type { SoundFontEntry } from '../tabs/player/trackSounds.ts'

/** "Bread Breads Distortion Guitar" for "Bread Breads Distortion Guitar.sf2". */
export function soundFontTitle(name: string): string {
  return name.replace(/\.sf[23]$/i, '')
}

/** Where a set stands: the main one, loaded by hand, or not loaded. */
export function useSoundFontStatus() {
  const { state } = usePlayer()
  return (font: SoundFontEntry): 'main' | 'loaded' | 'loading' | 'not-loaded' =>
    font.main
      ? 'main'
      : state.extraSoundFonts.some((item) => item.name === font.name)
        ? 'loaded'
        : state.loadingSoundFont === font.name
          ? 'loading'
          : 'not-loaded'
}

import { useSyncExternalStore } from 'react'

/**
 * Which page is shown, from the address bar: the library (#/), a song (#/song/{id}), the electric guitar tone
 * editor (#/tones) or the stems of the open song's recording (#/stems). The last two are pages of their own but
 * leave the open song loaded, so it can be played meanwhile and coming back to it needs no reload.
 */
export type View = 'library' | 'song' | 'tones' | 'stems'

export const TONES_HASH = '#/tones'
export const STEMS_HASH = '#/stems'

/** The pages that lie over the score area and keep the open song. */
export function keepsSong(hash: string): boolean {
  return hash === TONES_HASH || hash === STEMS_HASH
}

export function viewOf(hash: string): View {
  if (hash === TONES_HASH) return 'tones'
  if (hash === STEMS_HASH) return 'stems'
  return /^#\/song\/\d+$/.test(hash) ? 'song' : 'library'
}

const subscribe = (listener: () => void) => {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

export function useView(): View {
  return useSyncExternalStore(subscribe, () => viewOf(window.location.hash))
}

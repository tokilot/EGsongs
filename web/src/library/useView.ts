import { useSyncExternalStore } from 'react'

/**
 * Which page is shown, from the address bar: the library (#/), a song (#/song/{id}) or the electric guitar tone
 * editor (#/tones). The tone editor is a page of its own but leaves the open song loaded, so it can be played
 * while the tone is being set.
 */
export type View = 'library' | 'song' | 'tones'

export const TONES_HASH = '#/tones'

export function viewOf(hash: string): View {
  if (hash === TONES_HASH) return 'tones'
  return /^#\/song\/\d+$/.test(hash) ? 'song' : 'library'
}

const subscribe = (listener: () => void) => {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

export function useView(): View {
  return useSyncExternalStore(subscribe, () => viewOf(window.location.hash))
}

import { useSyncExternalStore } from 'react'

// Which track's edit dialog is open. A module-level store, because the button that opens it lives inside the
// mixer popover while the dialog itself is drawn over the whole page.
let editing: number | null = null
const listeners = new Set<() => void>()

export function openTrackEditor(index: number | null) {
  editing = index
  for (const listener of listeners) listener()
}

export function useTrackEditor(): number | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => editing,
  )
}

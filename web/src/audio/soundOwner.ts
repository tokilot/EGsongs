// One sound at a time across the page's parts (the tabs' player, the tone preview, the stems): whoever starts
// playing claims the sound, and whoever had it is asked to stop. The parts need not know of each other.

type Stop = () => void

let holder: { owner: string; stop: Stop } | null = null

/** Starting to play: the part that was playing before stops. */
export function claimSound(owner: string, stop: Stop) {
  const before = holder
  holder = { owner, stop }
  if (before && before.owner !== owner) before.stop()
}

/** Stopped playing (on its own, or when asked). */
export function releaseSound(owner: string) {
  if (holder?.owner === owner) holder = null
}

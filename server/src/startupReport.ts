// What the server says when it has started: what it moved, dropped or forgot (see createApp's `atStartup`).
// Shared by index.ts (the API on its own) and dev.ts (the page and the API on one port).
import type { createApp } from './app.ts'

export function reportStartup(started: Awaited<ReturnType<typeof createApp>['ready']>) {
  if (started.renumbered) console.log(`Renumbered ${started.renumbered} cached online tabs in data/songs/.`)
  if (started.moved) console.log(`Moved the tabs of ${started.moved} songs to where they now belong (user.db for favourites, data/songs/ for the rest).`)
  if (started.dropped) console.log(`Dropped ${started.dropped} songs whose tab is gone from data/songs/.`)
  if (started.demos) console.log(`Added the ${started.demos} tabs that come with the app to the new library.`)
  if (started.separations) console.log(`Forgot ${started.separations} separations.`)
}

import path from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'

const dataDir = path.resolve(process.env.TABS_DATA_DIR ?? path.join(import.meta.dirname, '../../data'))
const port = Number(process.env.TABS_PORT ?? 7274)
// Every song is kept between runs, unless its tab is gone from data/songs/; separations and transcriptions are not.
const { app, ready } = createApp({ dataDir, atStartup: true })
const started = await ready
if (started.renumbered) console.log(`Renumbered ${started.renumbered} cached online tabs in data/songs/.`)
if (started.moved) console.log(`Moved the tabs of ${started.moved} songs to where they now belong (user.db for favourites, data/songs/ for the rest).`)
if (started.dropped) console.log(`Dropped ${started.dropped} songs whose tab is gone from data/songs/.`)
if (started.demos) console.log(`Added the ${started.demos} tabs that come with the app to the new library.`)
if (started.separations) console.log(`Forgot ${started.separations} separations.`)

// Local only: this is a single-user tool and the API has no authentication.
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`API on http://127.0.0.1:${info.port} (data in ${dataDir})`)
})

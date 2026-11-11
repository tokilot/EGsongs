// The API on its own (the end-to-end tests pair it with Vite's own server; in development, dev.ts serves the page and
// the API together on one port).
import path from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { reportStartup } from './startupReport.ts'

const dataDir = path.resolve(process.env.TABS_DATA_DIR ?? path.join(import.meta.dirname, '../../data'))
const port = Number(process.env.TABS_PORT ?? 7274)
// Every song is kept between runs, unless its tab is gone from data/songs/; separations and transcriptions are not.
const { app, ready } = createApp({ dataDir, atStartup: true })
reportStartup(await ready)

// Local only: this is a single-user tool and the API has no authentication.
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`API on http://127.0.0.1:${info.port} (data in ${dataDir})`)
})

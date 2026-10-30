import path from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'

const dataDir = path.resolve(process.env.TABS_DATA_DIR ?? path.join(import.meta.dirname, '../../data'))
const port = Number(process.env.TABS_PORT ?? 5174)
// Only favorites and the tone library are kept between runs: songs only browsed and separations are forgotten.
const { app, ready } = createApp({ dataDir, forgetHistory: true })
const forgotten = await ready
if (forgotten.songs || forgotten.separations) console.log(`Forgot ${forgotten.songs} songs that are not favorites and ${forgotten.separations} separations.`)

// Local only: this is a single-user tool and the API has no authentication.
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`API on http://127.0.0.1:${info.port} (data in ${dataDir})`)
})

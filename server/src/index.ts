import path from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'

const dataDir = path.resolve(process.env.TABS_DATA_DIR ?? path.join(import.meta.dirname, '../../data'))
const port = Number(process.env.TABS_PORT ?? 5174)
const { app } = createApp({ dataDir })

// Local only: this is a single-user tool and the API has no authentication.
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`API on http://127.0.0.1:${info.port} (data in ${dataDir})`)
})

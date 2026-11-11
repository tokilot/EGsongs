// Development on one port (2026-11-11): the page from Vite, run as middleware (hot reload included), and /api from
// the app, both at http://127.0.0.1:7273. index.ts still runs the API on its own.
import { createServer } from 'node:http'
import path from 'node:path'
import { getRequestListener } from '@hono/node-server'
import { createServer as createVite } from 'vite'
import { createApp } from './app.ts'
import { reportStartup } from './startupReport.ts'

const root = path.resolve(import.meta.dirname, '../..')
const dataDir = path.resolve(process.env.TABS_DATA_DIR ?? path.join(root, 'data'))
const port = Number(process.env.TABS_DEV_PORT ?? 7273)

const { app, ready } = createApp({ dataDir, atStartup: true })
reportStartup(await ready)

const http = createServer()
// The page's own config (alphaTab's plugin and the patches), its hot reload sharing this server.
const vite = await createVite({
  root: path.join(root, 'web'),
  configFile: path.join(root, 'web', 'vite.config.ts'),
  appType: 'spa',
  server: { middlewareMode: true, ws: { server: http } },
})
const api = getRequestListener(app.fetch)
http.on('request', (request, response) => {
  if (request.url?.startsWith('/api/')) void api(request, response)
  else vite.middlewares(request, response)
})

// Local only: this is a single-user tool and the API has no authentication.
http.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EADDRINUSE') throw error
  console.error(`Port ${port} is already in use: is another "npm run dev" still running? Stop it, or set TABS_DEV_PORT.`)
  process.exit(1)
})
http.listen(port, '127.0.0.1', () => {
  console.log(`Page and API on http://127.0.0.1:${port} (data in ${dataDir})`)
})

import { alphaTab } from '@coderline/alphatab-vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { alphaTabPatches } from './alphatab-patches.ts'

// TABS_PORT lets the end-to-end run use its own backend next to a running dev setup.
const API = `http://127.0.0.1:${process.env.TABS_PORT ?? 5174}`

// https://vite.dev/config/
export default defineConfig({
  // The alphaTab plugin wires up its worker and audio worklet and copies font/ and soundfont/ into the output.
  // alphaTabPatches() goes first so the worker build, which re-runs these plugins, is patched too.
  plugins: [alphaTabPatches(), react(), alphaTab()],
  worker: { plugins: () => [alphaTabPatches()] },
  optimizeDeps: { exclude: ['@coderline/alphatab'] },
  server: { proxy: { '/api': API } },
  preview: { proxy: { '/api': API } },
})

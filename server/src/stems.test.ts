import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import type { Device, DeviceInfo, SeparationMessage, SeparationRunner, StemItem } from './stems.ts'

/** Stands in for the Python script: writes two stems once it is told to finish. */
function fakeSeparator(options: { problem?: string; fail?: string } = {}) {
  const runs: Array<{ device: Device; finish: () => Promise<void>; cancelled: boolean }> = []
  const runner: SeparationRunner = {
    check: () => options.problem ?? null,
    devices: async () => ({ gpus: [{ name: 'Test GPU', memoryGb: 8 }], torch: '2.15.0', cuda: '13.2' }),
    run(_input, outputDir, device, onMessage: (message: SeparationMessage) => void) {
      let resolve!: () => void
      let reject!: (error: Error) => void
      const done = new Promise<void>((yes, no) => {
        resolve = yes
        reject = no
      })
      const run = {
        device,
        cancelled: false,
        finish: async () => {
          if (options.fail) return reject(new Error(options.fail))
          await writeFile(path.join(outputDir, 'guitar.flac'), 'GUITAR-STEM-BYTES')
          await writeFile(path.join(outputDir, 'piano.flac'), 'x')
          onMessage({ progress: 1 })
          onMessage({
            stems: [
              { name: 'guitar', file: 'guitar.flac', rmsDb: -20 },
              { name: 'piano', file: 'piano.flac', rmsDb: -90 },
            ],
          })
          resolve()
        },
      }
      onMessage({ device })
      onMessage({ progress: 0.5 })
      runs.push(run)
      return {
        done,
        cancel: () => {
          run.cancelled = true
          reject(new Error('Cancelled.'))
        },
      }
    },
  }
  return { runner, runs }
}

let dataDir: string
let close: (() => void) | null = null
beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'tabs-stems-'))
})
afterEach(() => {
  close?.()
  close = null
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 })
})

function setup(options: Parameters<typeof fakeSeparator>[0] = {}) {
  const fake = fakeSeparator(options)
  const { app, library } = createApp({ dataDir, separator: fake.runner })
  close = () => library.close()
  const list = async () => (await (await app.request('/api/stems')).json()) as StemItem[]
  const upload = (name = 'riff.mp3', device = 'cuda') => app.request(`/api/stems?name=${encodeURIComponent(name)}&device=${device}`, { method: 'POST', body: new Uint8Array([9, 9, 9]) })
  // Lets the queue take the next step.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  return { app, fake, list, upload, settle }
}

describe('stems', () => {
  it('separates a recording on its own and serves its stems', async () => {
    const { app, fake, list, upload, settle } = setup()
    expect(await list()).toEqual([])

    const started = await upload('My Song.mp3')
    expect(started.status).toBe(202)
    const { id } = (await started.json()) as StemItem
    await settle()
    expect(await list()).toMatchObject([{ id, name: 'My Song', sourceName: 'My Song.mp3', status: 'running', progress: 0.5, device: 'cuda' }])
    expect((await app.request(`/api/stems/${id}/guitar`)).status).toBe(404)

    await fake.runs[0].finish()
    await settle()
    const [done] = await list()
    expect(done).toMatchObject({ id, status: 'done', name: 'My Song', device: 'cuda' })
    expect(done.stems.map((stem) => stem.name)).toEqual(['guitar', 'piano'])

    const whole = await app.request(`/api/stems/${id}/guitar`)
    expect(whole.status).toBe(200)
    expect(whole.headers.get('Content-Type')).toBe('audio/flac')
    expect(await whole.text()).toBe('GUITAR-STEM-BYTES')
    const part = await app.request(`/api/stems/${id}/guitar`, { headers: { Range: 'bytes=7-10' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('Content-Range')).toBe('bytes 7-10/17')
    expect(await part.text()).toBe('STEM')
    expect((await app.request(`/api/stems/${id}/vocals`)).status).toBe(404)
    expect((await app.request(`/api/stems/..%2Fx/guitar`)).status).toBe(404)

    expect((await app.request(`/api/stems/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await list()).toEqual([])
    expect((await app.request(`/api/stems/${id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('runs one at a time, newest listed first, on the device asked for', async () => {
    const { fake, list, upload, settle } = setup()
    const first = (await (await upload('a.mp3')).json()) as StemItem
    const second = (await (await upload('b.flac', 'cpu')).json()) as StemItem
    await settle()
    expect(fake.runs).toHaveLength(1)
    expect((await list()).map((item) => [item.name, item.status])).toEqual([
      ['b', 'queued'],
      ['a', 'running'],
    ])
    await fake.runs[0].finish()
    await settle()
    expect(fake.runs).toHaveLength(2)
    expect(fake.runs[1].device).toBe('cpu')
    expect(first.id < second.id).toBe(true)
  })

  it('cancelling a running separation forgets it and keeps the others', async () => {
    const { app, fake, list, upload, settle } = setup()
    await upload('a.mp3')
    await settle()
    await fake.runs[0].finish()
    await settle()
    const running = (await (await upload('b.mp3')).json()) as StemItem
    await settle()
    await app.request(`/api/stems/${running.id}`, { method: 'DELETE' })
    await settle()
    expect(fake.runs[1].cancelled).toBe(true)
    expect((await list()).map((item) => item.name)).toEqual(['a'])
  })

  it('lists a failure until it is deleted', async () => {
    const { app, fake, list, upload, settle } = setup({ fail: 'CUDA out of memory' })
    const item = (await (await upload()).json()) as StemItem
    await settle()
    await fake.runs[0].finish()
    await settle()
    expect(await list()).toMatchObject([{ status: 'failed', error: 'CUDA out of memory' }])
    await app.request(`/api/stems/${item.id}`, { method: 'DELETE' })
    expect(await list()).toEqual([])
  })

  it('says why it cannot separate, and what the computer has', async () => {
    const { app, upload } = setup({ problem: 'The separation model is missing.' })
    const response = await upload()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'The separation model is missing.' })
    const devices = (await (await app.request('/api/stems/devices')).json()) as DeviceInfo
    expect(devices).toMatchObject({ gpus: [], problem: 'The separation model is missing.' })
    expect(devices.cpu.threads).toBeGreaterThan(0)
  })

  it('reports the graphics cards', async () => {
    const { app } = setup()
    expect(await (await app.request('/api/stems/devices')).json()).toMatchObject({ gpus: [{ name: 'Test GPU', memoryGb: 8 }], torch: '2.15.0', cuda: '13.2', problem: null })
  })

  it('keeps the separations made per song by the first version', async () => {
    const old = path.join(dataDir, 'stems', '13')
    mkdirSync(old, { recursive: true })
    writeFileSync(path.join(old, 'stems.json'), JSON.stringify({ sourceName: 'Arena.aac', createdAt: '2026-10-29T17:49:41.739Z', stems: [{ name: 'guitar', file: 'guitar.flac', rmsDb: -15 }] }))
    writeFileSync(path.join(old, 'guitar.flac'), 'G')
    const { app, list } = setup()
    expect(await list()).toMatchObject([{ id: '13', name: 'Arena', status: 'done' }])
    expect(JSON.parse(readFileSync(path.join(old, 'stems.json'), 'utf8')).id).toBe('13')
    expect(await (await app.request('/api/stems/13/guitar')).text()).toBe('G')
  })

  it('separations stay when a song is deleted', async () => {
    const { app, fake, list, upload, settle } = setup()
    const { library } = createApp({ dataDir, separator: fake.runner })
    const song = await library.addFile('riff.gp', new Uint8Array([1, 2, 3]))
    library.close()
    await upload()
    await settle()
    await fake.runs[0].finish()
    await settle()
    await app.request(`/api/songs/${song.id}`, { method: 'DELETE' })
    expect(await list()).toHaveLength(1)
    expect(existsSync(path.join(dataDir, 'stems'))).toBe(true)
  })
})

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { configInstruments, findSeparationModels, type Device, type DeviceInfo, type SeparationMessage, type SeparationRunner, type StemItem } from './stems.ts'

/** Stands in for the Python script: writes two stems once it is told to finish. */
function fakeSeparator(options: { problem?: string; fail?: string } = {}) {
  const runs: Array<{ device: Device; model: string; finish: () => Promise<void>; cancelled: boolean }> = []
  const runner: SeparationRunner = {
    check: () => options.problem ?? null,
    models: () => [{ id: 'bs-roformer-sw', name: 'bs-roformer-sw', architecture: 'BS-RoFormer', stems: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'], checkpoint: 'bs-roformer-sw/model.ckpt', config: 'bs-roformer-sw/config.yaml', license: 'unknown', source: '', available: true, bytes: 1234 }],
    devices: async () => ({ gpus: [{ name: 'Test GPU', memoryGb: 8 }], torch: '2.15.0', cuda: '13.2' }),
    run(_input, outputDir, model, device, onMessage: (message: SeparationMessage) => void) {
      let resolve!: () => void
      let reject!: (error: Error) => void
      const done = new Promise<void>((yes, no) => {
        resolve = yes
        reject = no
      })
      const run = {
        device,
        model: model.id,
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
    expect(existsSync(path.join(dataDir, 'tmps', 'stems'))).toBe(true)
  })

  it('lists the models, and separates with the one asked for', async () => {
    const { app, fake, upload, settle } = setup()
    const models = (await (await app.request('/api/stems/models')).json()) as Array<{ id: string; stems: string[]; available: boolean; bytes: number; license: string }>
    expect(models).toMatchObject([{ id: 'bs-roformer-sw', available: true, bytes: 1234, license: 'unknown' }])
    expect(models[0].stems).toEqual(['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'])
    await upload()
    await settle()
    expect(fake.runs[0].model).toBe('bs-roformer-sw')
    const unknown = await app.request('/api/stems?name=a.mp3&model=nope', { method: 'POST', body: new Uint8Array([1]) })
    expect(unknown.status).toBe(400)
  })

  it('finds the models in their folders (or lying loose), with the stems their config lists', () => {
    const dir = path.join(dataDir, 'models')
    const put = (file: string, content: string | number) => {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      writeFileSync(path.join(dir, file), typeof content === 'number' ? Buffer.alloc(content) : content)
    }
    put('BS-Roformer-SW/model.ckpt', 300)
    put('BS-Roformer-SW/config.yaml', "audio:\n  chunk_size: 588800\ntraining:\n  batch_size: 1\n  instruments: ['bass', 'drums', 'other', 'vocals', 'guitar', 'piano']\n  target_instrument: null\n")
    put('karaoke.ckpt', 100)
    put('karaoke.yaml', 'training:\n  instruments:\n  - vocals\n  - "back vocals"\n  - other\n  lr: 1.0\n')
    // No config, a config without instruments, and a config without its checkpoint: none of them is a model.
    put('lonely/model.ckpt', 50)
    put('odd/model.ckpt', 50)
    put('odd/config.yaml', 'audio:\n  sample_rate: 44100\n')
    put('orphan.yaml', "training:\n  instruments: ['vocals']\n")
    const found = findSeparationModels(dir)
    expect(found.map((model) => [model.id, model.checkpoint.replaceAll('\\', '/'), model.stems])).toEqual([
      ['karaoke', 'karaoke.ckpt', ['vocals', 'other', 'back vocals']],
      ['BS-Roformer-SW', 'BS-Roformer-SW/model.ckpt', ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']],
    ])
    expect(findSeparationModels(path.join(dir, 'nowhere'))).toEqual([])
    expect(configInstruments('training:\n  instruments: [vocals, other]  # two\n')).toEqual(['vocals', 'other'])
  })
})

describe('tab files', () => {
  it('are kept in user.db: the uploaded file and the edited copy, across a restart', async () => {
    const first = createApp({ dataDir, separator: fakeSeparator().runner })
    const song = await first.library.addFile('riff.gp', new Uint8Array([1, 2, 3]))
    await first.library.saveEdited(song.id, new Uint8Array([7, 7]))
    first.library.close()
    const next = createApp({ dataDir, separator: fakeSeparator().runner })
    close = () => next.library.close()
    const again = next.library.get(song.id)!
    expect(await next.library.readFile(again)).toEqual(new Uint8Array([1, 2, 3]))
    expect(await next.library.readEdited(again)).toEqual(new Uint8Array([7, 7]))
    await next.library.discardEdited(song.id)
    expect(await next.library.readEdited(next.library.get(song.id)!)).toBeNull()
    // No folder of tab files any more.
    expect(existsSync(path.join(dataDir, 'tabs'))).toBe(false)
  })

  it('in the data/tabs/ of before are taken in once, and the folder goes', async () => {
    const first = createApp({ dataDir, separator: fakeSeparator().runner })
    const song = await first.library.addFile('riff.gp', new Uint8Array([1]))
    await first.library.saveEdited(song.id, new Uint8Array([1]))
    first.library.close()
    // As the old version kept them.
    mkdirSync(path.join(dataDir, 'tabs'))
    writeFileSync(path.join(dataDir, 'tabs', `${song.id}.gp`), new Uint8Array([4, 5]))
    writeFileSync(path.join(dataDir, 'tabs', `${song.id}.edited.gp`), new Uint8Array([6]))
    const next = createApp({ dataDir, separator: fakeSeparator().runner })
    close = () => next.library.close()
    const again = next.library.get(song.id)!
    expect(await next.library.readFile(again)).toEqual(new Uint8Array([4, 5]))
    expect(await next.library.readEdited(again)).toEqual(new Uint8Array([6]))
    expect(existsSync(path.join(dataDir, 'tabs'))).toBe(false)
  })
})

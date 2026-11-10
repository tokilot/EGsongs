import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import type { SeparationRunner } from './stems.ts'
import { findBeatModels, findTranscriptionModels, type BeatModel, type TranscriptionItem, type TranscriptionMessage, type TranscriptionModelInfo, type TranscriptionRunner } from './transcribe.ts'

/** A model as the folder scan reports it. */
function model(id: string, parameters: number): TranscriptionModelInfo {
  return { id, name: id, weights: `${id}/model.safetensors`, config: null, parameters, license: 'CC BY-NC 4.0', nonCommercial: true, source: '', available: true, bytes: parameters * 4e6 }
}

interface FakeRun {
  model: string
  device: string
  instruments: string[]
  beat: string | null
  bpm: number
  finish: () => Promise<void>
  cancelled: boolean
}

/** Stands in for a Python script: reports its device and some progress, and finishes when told to. */
function fakeRun<Message>(onMessage: (message: Message) => void, device: string, finished: () => Promise<Message>) {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const done = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  const run = {
    cancelled: false,
    finish: async () => {
      onMessage(await finished())
      resolve()
    },
  }
  onMessage({ device } as Message)
  onMessage({ progress: 0.25 } as Message)
  return {
    run,
    handle: {
      done,
      cancel: () => {
        run.cancelled = true
        reject(new Error('Cancelled.'))
      },
    },
  }
}

function fakes(options: { missing?: string; models?: TranscriptionModelInfo[]; beats?: BeatModel[] } = {}) {
  const transcriptions: FakeRun[] = []
  const separations: Array<{ finish: () => Promise<void> }> = []
  const transcriber: TranscriptionRunner = {
    models: () => options.models ?? [model('muscriptor-medium', 307), model('muscriptor-large', 1366)],
    beatModels: () => options.beats ?? [{ id: 'beat_this/final0', name: 'beat_this final0', file: 'beat_this/final0.ckpt', bytes: 81 }],
    check: () => options.missing ?? null,
    run(_input, outputDir, job, onMessage: (message: TranscriptionMessage) => void) {
      const { run, handle } = fakeRun(onMessage, job.device, async () => {
        await writeFile(path.join(outputDir, 'transcription.mid'), 'MThd-FAKE')
        return { midi: { file: 'transcription.mid', notes: 3, parts: ['distorted_electric_guitar'], bpm: job.beat ? 127.8 : job.bpm, detected: job.beat !== null, seconds: 2 } }
      })
      transcriptions.push({ ...run, model: job.model.id, device: job.device, instruments: job.instruments, beat: job.beat?.id ?? null, bpm: job.bpm, get cancelled() { return run.cancelled } })
      return handle
    },
  }
  const separator: SeparationRunner = {
    check: () => null,
    models: () => [{ id: 'sw', name: 'sw', architecture: 'BS-RoFormer', stems: ['guitar'], checkpoint: 'sw/model.ckpt', config: 'sw/config.yaml', license: 'unknown', source: '', available: true, bytes: 1 }],
    devices: async () => ({ gpus: [], torch: null, cuda: null }),
    run(_input, outputDir, _model, device, onMessage) {
      const { run, handle } = fakeRun(onMessage, device, async () => {
        await writeFile(path.join(outputDir, 'guitar.flac'), 'x')
        return { stems: [{ name: 'guitar', file: 'guitar.flac', rmsDb: -20 }] }
      })
      separations.push(run)
      return handle
    },
  }
  return { transcriber, separator, transcriptions, separations }
}

let dataDir: string
let close: (() => void) | null = null
beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'tabs-midi-'))
})
afterEach(() => {
  close?.()
  close = null
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 })
})

function setup(options: Parameters<typeof fakes>[0] = {}) {
  const fake = fakes(options)
  const { app, library } = createApp({ dataDir, separator: fake.separator, transcriber: fake.transcriber })
  close = () => library.close()
  const list = async () => (await (await app.request('/api/transcriptions')).json()) as TranscriptionItem[]
  const upload = (query = 'name=Riff.wav&device=cpu') => app.request(`/api/transcriptions?${query}`, { method: 'POST', body: new Uint8Array([1, 2, 3]) })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  return { app, fake, list, upload, settle }
}

describe('audio to MIDI', () => {
  it('lists the models the model directory has', async () => {
    const { app } = setup()
    const models = (await (await app.request('/api/transcriptions/models')).json()) as Array<{ id: string; available: boolean }>
    expect(models.map((entry) => entry.id)).toEqual(['muscriptor-medium', 'muscriptor-large'])
  })

  it('finds models in folders and lying loose, named by their config, smallest first', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tabs-models-'))
    try {
      const put = (file: string, content: string | number) => {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
        writeFileSync(path.join(dir, file), typeof content === 'number' ? Buffer.alloc(content) : content)
      }
      // A folder as published, a loose file named like the download, a folder without a config, and the beat
      // tracker's folder (not a model), plus a folder without weights.
      put('muscriptor-large/model.safetensors', 4000)
      put('muscriptor-large/config.json', JSON.stringify({ model_type: 'muscriptor', variant: 'large' }))
      put('muscriptor-medium-model.safetensors', 2000)
      put('muscriptor-medium-config.json', JSON.stringify({ model_type: 'muscriptor', variant: 'medium' }))
      put('my-finetune/model.safetensors', 1000)
      put('beat_this/final0.ckpt', 10)
      put('empty/readme.txt', 'nothing here')
      const found = findTranscriptionModels(dir)
      expect(found.map((entry) => [entry.id, entry.name, entry.weights.replaceAll('\\', '/'), entry.config?.replaceAll('\\', '/') ?? null, entry.license])).toEqual([
        ['my-finetune', 'my-finetune', 'my-finetune/model.safetensors', null, 'unknown'],
        ['muscriptor-medium', 'MuScriptor medium', 'muscriptor-medium-model.safetensors', 'muscriptor-medium-config.json', 'CC BY-NC 4.0'],
        ['muscriptor-large', 'MuScriptor large', 'muscriptor-large/model.safetensors', 'muscriptor-large/config.json', 'CC BY-NC 4.0'],
      ])
      expect(findTranscriptionModels(path.join(dir, 'nowhere'))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('transcribes a recording on its own and serves the MIDI', async () => {
    const { app, fake, list, upload, settle } = setup()
    const started = await upload('name=My%20Riff.wav&device=cpu&model=muscriptor-medium&instruments=guitar')
    expect(started.status).toBe(202)
    const { id } = (await started.json()) as TranscriptionItem
    await settle()
    expect(await list()).toMatchObject([{ id, name: 'My Riff', status: 'running', progress: 0.25, device: 'cpu', model: 'muscriptor-medium', instruments: 'guitar', midi: null }])
    expect(fake.transcriptions[0].instruments).toEqual(['acoustic_guitar', 'clean_electric_guitar', 'distorted_electric_guitar'])
    expect((await app.request(`/api/transcriptions/${id}/midi`)).status).toBe(404)

    await fake.transcriptions[0].finish()
    await settle()
    const [done] = await list()
    expect(done).toMatchObject({ id, status: 'done', midi: { notes: 3, parts: ['distorted_electric_guitar'], bpm: 120 } })
    const midi = await app.request(`/api/transcriptions/${id}/midi`)
    expect(midi.headers.get('Content-Type')).toBe('audio/midi')
    expect(await midi.text()).toBe('MThd-FAKE')

    expect((await app.request(`/api/transcriptions/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await list()).toEqual([])
  })

  it('turns down an unknown model or instrument choice, and says when the model is missing', async () => {
    expect((await setup().upload('name=a.wav&model=muscriptor-huge')).status).toBe(400)
    close?.()
    expect((await setup().upload('name=a.wav&instruments=piano')).status).toBe(400)
    close?.()
    const missing = await setup({ missing: 'The transcription model is missing: x.' }).upload()
    expect(missing.status).toBe(503)
    expect(((await missing.json()) as { error: string }).error).toMatch(/missing/)
    close?.()
    expect((await setup({ models: [] }).upload()).status).toBe(503)
  })

  it('finds the beat model when one is asked for, and writes a steady tempo when none is (or there is none)', async () => {
    const { app, fake, list, upload, settle } = setup()
    expect(((await (await app.request('/api/transcriptions/beat-models')).json()) as BeatModel[]).map((entry) => entry.id)).toEqual(['beat_this/final0'])
    await upload('name=a.wav&beat=beat_this/final0&bpm=90')
    await settle()
    expect(fake.transcriptions[0]).toMatchObject({ beat: 'beat_this/final0', bpm: 90 })
    await fake.transcriptions[0].finish()
    await settle()
    expect((await list())[0]).toMatchObject({ beat: 'beat_this/final0', midi: { bpm: 127.8, detected: true } })

    await upload('name=b.wav&beat=none&bpm=96')
    await settle()
    expect(fake.transcriptions[1]).toMatchObject({ beat: null, bpm: 96 })
    await fake.transcriptions[1].finish()
    await settle()
    expect((await list())[0]).toMatchObject({ name: 'b', beat: null, bpm: 96, midi: { bpm: 96, detected: false } })
  })

  it('transcribes without any beat model, at 120 BPM unless told otherwise', async () => {
    const { fake, upload, settle } = setup({ beats: [] })
    expect((await upload('name=a.wav')).status).toBe(202)
    await settle()
    expect(fake.transcriptions[0]).toMatchObject({ beat: null, bpm: 120 })
  })

  it('turns down a tempo out of range, and a beat model that is not there', async () => {
    expect((await setup().upload('name=a.wav&bpm=5')).status).toBe(400)
    close?.()
    expect((await setup().upload('name=a.wav&bpm=abc')).status).toBe(400)
    close?.()
    expect((await setup().upload('name=a.wav&beat=beat_this/nope')).status).toBe(400)
  })

  it('finds the beat_this checkpoints in their folder', () => {
    const dir = path.join(dataDir, 'beats')
    mkdirSync(path.join(dir, 'beat_this'), { recursive: true })
    writeFileSync(path.join(dir, 'beat_this', 'final0.ckpt'), Buffer.alloc(8))
    writeFileSync(path.join(dir, 'beat_this', 'small0.ckpt'), Buffer.alloc(4))
    writeFileSync(path.join(dir, 'beat_this', 'LICENSE'), 'MIT')
    expect(findBeatModels(dir).map((entry) => [entry.id, entry.name, entry.bytes])).toEqual([
      ['beat_this/final0', 'beat_this final0', 8],
      ['beat_this/small0', 'beat_this small0', 4],
    ])
    expect(findBeatModels(path.join(dataDir, 'nowhere'))).toEqual([])
  })

  it('uses the smallest model when none is asked for', async () => {
    const { fake, upload, settle } = setup()
    await upload()
    await settle()
    expect(fake.transcriptions[0].model).toBe('muscriptor-medium')
  })

  it('waits while a separation has the graphics card, and the other way round', async () => {
    const { app, fake, list, upload, settle } = setup()
    await app.request('/api/stems?name=song.wav&device=cuda', { method: 'POST', body: new Uint8Array([1]) })
    await settle()
    await upload()
    await settle()
    expect(fake.separations).toHaveLength(1)
    expect(fake.transcriptions).toHaveLength(0)
    expect((await list())[0].status).toBe('queued')

    await fake.separations[0].finish()
    await settle()
    expect(fake.transcriptions).toHaveLength(1)
    expect((await list())[0].status).toBe('running')
  })

  it('cancelling a transcription while it waits for its turn drops it before it runs', async () => {
    const { app, fake, list, upload, settle } = setup()
    await app.request('/api/stems?name=song.wav&device=cuda', { method: 'POST', body: new Uint8Array([1]) })
    await settle()
    const waiting = (await (await upload()).json()) as TranscriptionItem
    await settle()
    expect((await app.request(`/api/transcriptions/${waiting.id}`, { method: 'DELETE' })).status).toBe(200)
    await fake.separations[0].finish()
    await settle()
    expect(fake.transcriptions).toHaveLength(0)
    expect(await list()).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import type { Tone } from '../audio/tone.ts'
import { chainWith } from '../audio/toneChain.ts'
import { DEFAULT_TONE_LIBRARY, findTone } from './library.ts'
import { ToneStore, type ToneServer } from './toneStore.ts'

const mine: Tone = { id: 'custom-1', name: 'My lead', family: 'guitar', builtIn: false, chain: chainWith({ amp: { type: 'metal', params: { gain: 80 } } }) }

/** Stands in for the server: what it holds, and every library saved to it. */
function fakeServer(stored: unknown, options: { down?: boolean; saveFails?: boolean } = {}) {
  const saved: unknown[] = []
  const server: ToneServer = {
    load: async () => {
      if (options.down) throw new Error('无法连接本地服务')
      return stored
    },
    save: async (library) => {
      if (options.saveFails) throw new Error('disk full')
      saved.push(library)
      stored = library
    },
  }
  return { server, saved, setDown: (down: boolean) => (options.down = down) }
}

describe('tone store', () => {
  it('reads the library the server keeps', async () => {
    const { server, saved } = fakeServer({ custom: [mine], presetVersion: 5 })
    const store = new ToneStore(server, () => null)
    await store.load()
    expect(findTone(store.getState().library, mine.id)?.name).toBe('My lead')
    expect(saved).toEqual([])
  })

  it('brings over the library the browser kept, once, when the server has none', async () => {
    const { server, saved } = fakeServer(null)
    const store = new ToneStore(server, () => ({ custom: [mine], presetVersion: 5 }))
    await store.load()
    expect(findTone(store.getState().library, mine.id)).not.toBeNull()
    expect(saved).toHaveLength(1)
  })

  it('starts from the templates when neither has one, without saving', async () => {
    const { server, saved } = fakeServer(null)
    const store = new ToneStore(server, () => null)
    await store.load()
    expect(store.getState().library).toEqual(DEFAULT_TONE_LIBRARY)
    expect(saved).toEqual([])
  })

  it('saves and removes tones on the server, telling the listeners', async () => {
    const { server, saved } = fakeServer({ custom: [], presetVersion: 5 })
    const store = new ToneStore(server, () => null)
    await store.load()
    let told = 0
    store.subscribe(() => told++)
    await store.save(mine)
    expect(findTone(store.getState().library, mine.id)).not.toBeNull()
    await store.remove(mine.id)
    expect(findTone(store.getState().library, mine.id)).toBeNull()
    expect(saved).toHaveLength(2)
    expect(told).toBeGreaterThanOrEqual(2)
  })

  it('does not save over a library it could not read', async () => {
    const { server, saved, setDown } = fakeServer({ custom: [mine], presetVersion: 5 }, { down: true })
    const store = new ToneStore(server, () => null)
    await store.load()
    expect(store.getState().error).toContain('无法连接')
    await store.save({ ...mine, id: 'custom-2', name: 'Other' })
    expect(saved).toEqual([])
    // Once the server answers, the save reads it first and keeps what it had.
    setDown(false)
    await store.save({ ...mine, id: 'custom-2', name: 'Other' })
    expect(store.getState().error).toBeNull()
    expect(findTone(store.getState().library, mine.id)).not.toBeNull()
    expect(findTone(store.getState().library, 'custom-2')).not.toBeNull()
  })

  it('says when saving failed', async () => {
    const { server } = fakeServer({ custom: [], presetVersion: 5 }, { saveFails: true })
    const store = new ToneStore(server, () => null)
    await store.load()
    await store.save(mine)
    expect(store.getState().error).toBe('disk full')
  })
})

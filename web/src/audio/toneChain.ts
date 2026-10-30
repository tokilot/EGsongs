// The modules of an electric guitar tone ("信号链"), modelled on the chain of a modern amp app (Mooer iAMP):
// dynamics, filter, pedal, amp, cabinet, EQ, modulation, delay and reverb, in signal order. Each has its types
// and knobs; the sound engine (ampSim.ts), the stored tones (tones/library.ts) and the editor (tones/TonePage.tsx) all
// read this one catalogue. Labels are Chinese keys, translated in the UI.

export type ModuleId = 'dyna' | 'filter' | 'od' | 'amp' | 'cab' | 'eq' | 'mod' | 'delay' | 'reverb'

export const MODULE_ORDER: ModuleId[] = ['dyna', 'filter', 'od', 'amp', 'cab', 'eq', 'mod', 'delay', 'reverb']

export interface ToneModule {
  on: boolean
  type: string
  params: Record<string, number>
}

export type ToneChain = Record<ModuleId, ToneModule>

export interface ParamSpec {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  /** Shown after the value: "ms", "s", "Hz", "dB"; none for 0–10 knobs. */
  unit?: string
  /** Only these types have the knob (all when missing). */
  types?: string[]
  /** A 0–100 knob (2026-10-27, the user wanted finer steps than 0–10); the sound engine reads it divided by 10. */
  knob?: boolean
}

export interface ModuleSpec {
  id: ModuleId
  label: string
  types: Array<{ id: string; label: string }>
  params: ParamSpec[]
}

// `value` is given on the old 0–10 scale, which is also what the engine works with.
const knob = (key: string, label: string, value = 5, types?: string[]): ParamSpec => ({ key, label, min: 0, max: 100, step: 1, default: value * 10, types, knob: true })
const db = (key: string, label: string): ParamSpec => ({ key, label, min: -12, max: 12, step: 0.5, default: 0, unit: 'dB' })

export const MODULES: Record<ModuleId, ModuleSpec> = {
  dyna: {
    id: 'dyna',
    label: '动态',
    types: [
      { id: 'smooth', label: '平滑压缩' },
      { id: 'fast', label: '快速压缩' },
    ],
    params: [knob('sustain', '延音'), knob('attack', '启动'), knob('level', '音量')],
  },
  filter: {
    id: 'filter',
    label: '滤波',
    types: [
      { id: 'autowah', label: '自动哇音' },
      { id: 'wah', label: '固定哇音' },
    ],
    params: [knob('sens', '灵敏度', 6, ['autowah']), knob('range', '范围', 6, ['autowah']), knob('position', '踏板位置', 5, ['wah']), knob('q', '共振', 5)],
  },
  od: {
    id: 'od',
    label: '单块',
    types: [
      { id: 'boost', label: '提升' },
      { id: 'overdrive', label: '过载' },
      { id: 'distortion', label: '失真' },
      { id: 'fuzz', label: '法兹' },
    ],
    params: [knob('gain', '增益', 3), knob('tone', '音色'), knob('level', '音量', 6)],
  },
  amp: {
    id: 'amp',
    label: '箱头',
    types: [
      { id: 'clean', label: '清音' },
      { id: 'crunch', label: '英式破音' },
      { id: 'highgain', label: '美式高增益' },
      { id: 'metal', label: '现代金属' },
      { id: 'bass', label: '贝斯箱头' },
    ],
    params: [knob('gain', '增益'), knob('bass', '低音'), knob('mid', '中音'), knob('treble', '高音'), knob('presence', '临场感'), knob('master', '总音量'), knob('gate', '噪声门', 0)],
  },
  cab: {
    id: 'cab',
    label: '箱体',
    types: [
      { id: '1x12', label: '1×12 开背' },
      { id: '2x12', label: '2×12' },
      { id: '4x12', label: '4×12 封闭' },
      { id: '4x10', label: '4×10 贝斯' },
    ],
    params: [
      { key: 'lowcut', label: '低切', min: 20, max: 250, step: 5, default: 60, unit: 'Hz' },
      { key: 'highcut', label: '高切', min: 3000, max: 12000, step: 100, default: 9000, unit: 'Hz' },
    ],
  },
  eq: {
    id: 'eq',
    label: '均衡',
    types: [{ id: 'five', label: '5 段均衡' }],
    params: [db('b100', '100 Hz'), db('b400', '400 Hz'), db('b800', '800 Hz'), db('b1600', '1.6 kHz'), db('b4000', '4 kHz'), db('level', '音量')],
  },
  mod: {
    id: 'mod',
    label: '调制',
    types: [
      { id: 'chorus', label: '合唱' },
      { id: 'flanger', label: '镶边' },
      { id: 'phaser', label: '相位' },
      { id: 'tremolo', label: '震音' },
      { id: 'vibrato', label: '颤音' },
    ],
    params: [{ key: 'rate', label: '速率', min: 0.1, max: 10, step: 0.1, default: 1.2, unit: 'Hz' }, knob('depth', '深度'), knob('mix', '混合', 5, ['chorus', 'flanger', 'phaser'])],
  },
  delay: {
    id: 'delay',
    label: '延迟',
    types: [
      { id: 'digital', label: '数字' },
      { id: 'analog', label: '模拟' },
      { id: 'tape', label: '磁带' },
    ],
    params: [{ key: 'time', label: '时间', min: 20, max: 1500, step: 10, default: 380, unit: 'ms' }, knob('feedback', '反馈', 4), knob('mix', '混合', 3)],
  },
  reverb: {
    id: 'reverb',
    label: '混响',
    types: [
      { id: 'room', label: '房间' },
      { id: 'hall', label: '大厅' },
      { id: 'plate', label: '板式' },
      { id: 'spring', label: '弹簧' },
    ],
    params: [
      { key: 'decay', label: '衰减', min: 0.3, max: 8, step: 0.1, default: 1.8, unit: 's' },
      { key: 'predelay', label: '预延迟', min: 0, max: 150, step: 5, default: 15, unit: 'ms' },
      knob('mix', '混合', 2.5),
    ],
  },
}

/** A module as the sound engine reads it: 0–100 knobs brought back to 0–10. */
export function engineModule(id: ModuleId, module: ToneModule): ToneModule {
  const params = { ...module.params }
  for (const param of MODULES[id].params) if (param.knob && typeof params[param.key] === 'number') params[param.key] /= 10
  return { ...module, params }
}

/** A stored chain from before the 0–100 knobs (storage version 3): its knob values times ten. */
export function scaleOldKnobs(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const scaled: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
  for (const id of MODULE_ORDER) {
    const stored = scaled[id] as { params?: Record<string, unknown> } | undefined
    if (!stored || typeof stored !== 'object' || !stored.params) continue
    const params = { ...stored.params }
    for (const param of MODULES[id].params) if (param.knob && typeof params[param.key] === 'number') params[param.key] = (params[param.key] as number) * 10
    scaled[id] = { ...stored, params }
  }
  return scaled
}

/** The knobs a module of this type has. */
export function paramsFor(id: ModuleId, type: string): ParamSpec[] {
  return MODULES[id].params.filter((param) => !param.types || param.types.includes(type))
}

/** A module with its first type, switched off, every knob at its default. */
export function defaultModule(id: ModuleId, on = false, type = MODULES[id].types[0].id): ToneModule {
  return { on, type, params: Object.fromEntries(MODULES[id].params.map((param) => [param.key, param.default])) }
}

/** A chain with every module off except a default amp and cabinet. */
export function defaultChain(): ToneChain {
  const chain = Object.fromEntries(MODULE_ORDER.map((id) => [id, defaultModule(id)])) as ToneChain
  chain.amp.on = true
  chain.cab.on = true
  return chain
}

/** A chain built from a few changes to the default one (for the built-in tones). */
export function chainWith(changes: Partial<Record<ModuleId, { on?: boolean; type?: string; params?: Record<string, number> }>>): ToneChain {
  const chain = defaultChain()
  for (const id of MODULE_ORDER) {
    const change = changes[id]
    if (!change) continue
    chain[id] = { on: change.on ?? true, type: change.type ?? chain[id].type, params: { ...chain[id].params, ...change.params } }
  }
  return chain
}

/** A stored chain made safe: missing modules and knobs get defaults, unknown types the first one, values held in range. */
export function cleanChain(raw: unknown): ToneChain {
  const chain = defaultChain()
  if (!raw || typeof raw !== 'object') return chain
  for (const id of MODULE_ORDER) {
    const stored = (raw as Record<string, unknown>)[id]
    if (!stored || typeof stored !== 'object') continue
    const value = stored as Partial<ToneModule>
    const spec = MODULES[id]
    const type = spec.types.some((item) => item.id === value.type) ? (value.type as string) : spec.types[0].id
    const params = { ...chain[id].params }
    for (const param of spec.params) {
      const number = value.params?.[param.key]
      if (typeof number === 'number' && Number.isFinite(number)) params[param.key] = Math.min(param.max, Math.max(param.min, number))
    }
    chain[id] = { on: value.on === true, type, params }
  }
  return chain
}

export function sameChain(a: ToneChain, b: ToneChain): boolean {
  return MODULE_ORDER.every((id) => a[id].on === b[id].on && a[id].type === b[id].type && MODULES[id].params.every((param) => a[id].params[param.key] === b[id].params[param.key]))
}

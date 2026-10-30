// Two tiny AudioWorklet processors for the amp chain (ampSim.ts): a noise gate and an envelope follower (it
// drives the auto-wah's filter). Web Audio has no built-in node for either. Kept as source text and loaded from a
// Blob URL into the synthesizer's audio context, so the bundler needs no worklet setup.

export const AMP_WORKLET_CODE = `
const coefficient = (seconds) => 1 - Math.exp(-1 / (sampleRate * seconds))

// Opens above the threshold, closes below half of it (so it does not chatter), with a quick open and a soft close.
class TabsGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'threshold', defaultValue: -120, minValue: -140, maxValue: 0, automationRate: 'k-rate' }]
  }
  constructor() {
    super()
    this.envelope = 0
    this.gain = 1
    this.open = true
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) return true
    const threshold = Math.pow(10, parameters.threshold[0] / 20)
    const rise = coefficient(0.001), fall = coefficient(0.04)
    const opening = coefficient(0.002), closing = coefficient(0.08)
    const frames = input[0].length
    for (let i = 0; i < frames; i++) {
      let peak = 0
      for (let c = 0; c < input.length; c++) peak = Math.max(peak, Math.abs(input[c][i]))
      this.envelope += (peak > this.envelope ? rise : fall) * (peak - this.envelope)
      if (this.envelope > threshold) this.open = true
      else if (this.envelope < threshold * 0.5) this.open = false
      const target = this.open ? 1 : 0
      this.gain += (target > this.gain ? opening : closing) * (target - this.gain)
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] || input[0])[i] * this.gain
    }
    return true
  }
}

// Outputs how loud the input is (a smoothed peak), as an audio signal to feed into a filter's frequency.
class TabsEnvelope extends AudioWorkletProcessor {
  constructor() {
    super()
    this.envelope = 0
  }
  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    const rise = coefficient(0.004), fall = coefficient(0.09)
    const frames = output[0].length
    for (let i = 0; i < frames; i++) {
      let peak = 0
      if (input) for (let c = 0; c < input.length; c++) peak = Math.max(peak, Math.abs(input[c][i]))
      this.envelope += (peak > this.envelope ? rise : fall) * (peak - this.envelope)
      for (let c = 0; c < output.length; c++) output[c][i] = this.envelope
    }
    return true
  }
}

registerProcessor('tabs-gate', TabsGate)
registerProcessor('tabs-envelope', TabsEnvelope)
`

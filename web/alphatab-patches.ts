// Small source patches to alphaTab, applied while Vite serves or bundles it (main thread and worker alike,
// since the score is laid out in a Web Worker). alphaTab has no setting for these, and the classes involved
// are not exported, so there is nothing to hook from outside.
//
// Each patch names the exact text it replaces. If an alphaTab upgrade changes that text the build fails
// instead of silently drawing the old way; re-check the patch against the new version then.
import type { Plugin } from 'vite'

interface Patch {
  why: string
  find: string
  replace: string
}

const PATCHES: Patch[] = [
  {
    // To save memory the synthesizer only prepares the instruments the loaded song uses, and only when the
    // song's MIDI is loaded. A one-time file (the instrument preview in "edit track") with another
    // instrument then plays silently; after applying it the song uses it, so it sounds. Load what the
    // one-time file needs first (the sequencer has already added its programs to the set).
    why: 'instrument preview with an instrument the song does not use yet',
    find: `	playOneTimeMidiFile(midi) {
		if (this.sequencer.isPlayingOneTimeMidi) this._stopOneTimeMidi();
		else this.pause();
		this.sequencer.loadOneTimeMidi(midi);`,
    replace: `	playOneTimeMidiFile(midi) {
		if (this.sequencer.isPlayingOneTimeMidi) this._stopOneTimeMidi();
		else this.pause();
		const knownSounds = this.sequencer.instrumentPrograms.size + this.sequencer.percussionKeys.size;
		this.sequencer.loadOneTimeMidi(midi);
		if (this.sequencer.instrumentPrograms.size + this.sequencer.percussionKeys.size !== knownSounds) {
			let append = false;
			for (const soundFont of this._loadedSoundFonts) {
				this.synthesizer.loadPresets(soundFont, this.sequencer.instrumentPrograms, this.sequencer.percussionKeys, append);
				append = true;
			}
		}`,
  },
  {
    // No "rendered by alphaTab" line under the score (the user asked; alphaTab has no setting for it).
    why: 'no annotation under the score',
    find: `	_layoutAndRenderAnnotation(y) {
		const msg = "rendered by alphaTab";`,
    replace: `	_layoutAndRenderAnnotation(y) {
		return y;
		const msg = "rendered by alphaTab";`,
  },
  {
    // Vibrato on a beat (with the whammy bar) is drawn as a sawtooth; draw it with the same wavy line as
    // vibrato on a note, as Songsterr does (the user asked for no zigzag).
    why: 'beat vibrato as a wavy line',
    find: `class BeatVibratoGlyph extends VibratoGlyphBase {
	get slightVibratoGlyph() {
		return MusicFontSymbol.WiggleSawtoothNarrow;
	}
	get wideVibratoGlyph() {
		return MusicFontSymbol.WiggleSawtooth;
	}`,
    replace: `class BeatVibratoGlyph extends VibratoGlyphBase {
	get slightVibratoGlyph() {
		return MusicFontSymbol.GuitarVibratoStroke;
	}
	get wideVibratoGlyph() {
		return MusicFontSymbol.GuitarWideVibratoStroke;
	}`,
  },
  {
    // Lyrics go under the tab, as on Songsterr, instead of in the band over it with the other text.
    why: 'lyrics under the tab',
    find: `		new TabBarRendererFactory([
			{
				effect: new LyricsEffectInfo(),
				mode: EffectBandMode.SharedTop
			},`,
    replace: `		new TabBarRendererFactory([
			{
				effect: new LyricsEffectInfo(),
				mode: EffectBandMode.OwnedBottom
			},`,
  },
  {
    // The layout is made in a worker from a copy of the score, and its result points at beats and notes by
    // index. While the tab editor changes the score quickly (type, insert, undo…) a result can come back
    // for a score that has changed since; then some of those indexes no longer exist. Skip them: the result
    // of the latest edit follows right after and is complete.
    why: 'positions of beats that an edit has since removed',
    find: `						bb.beat = score.tracks[beat.get("trackIndex")].staves[beat.get("staffIndex")].bars[beat.get("barIndex")].voices[beat.get("voiceIndex")].beats[beat.get("beatIndex")];`,
    replace: `						bb.beat = score.tracks[beat.get("trackIndex")]?.staves[beat.get("staffIndex")]?.bars[beat.get("barIndex")]?.voices[beat.get("voiceIndex")]?.beats[beat.get("beatIndex")];
						if (!bb.beat) continue;`,
  },
  {
    why: 'positions of notes that an edit has since removed',
    find: `								n.note = bb.beat.notes[note.get("index")];`,
    replace: `								n.note = bb.beat.notes[note.get("index")];
								if (!n.note) continue;`,
  },
  {
    // play() only starts the audio source once the audio worklet has been created, which is asynchronous. A
    // pause() in between (play and pause in quick succession, or loading another score right after pressing
    // play) calls stop() on a source that was never started; that throws, and the error surfaces from
    // api.pause() / api.stop() in the middle of whatever was going on.
    why: 'pausing before the audio source has started',
    find: `			this.source.stop(0);
			this.source.disconnect();`,
    replace: `			try {
				this.source.stop(0);
			} catch (e) {}
			this.source.disconnect();`,
  },
  {
    // The other half of the same race: the worklet arrives after the pause and finds no source to connect.
    why: 'audio worklet ready after playback was paused',
    find: `		BrowserUiFacade.createAlphaSynthAudioWorklet(ctx, this._settings).then(() => {
			this._worklet = new AudioWorkletNode(ctx, "alphatab", {`,
    replace: `		BrowserUiFacade.createAlphaSynthAudioWorklet(ctx, this._settings).then(() => {
			if (!this.source) return;
			this._worklet = new AudioWorkletNode(ctx, "alphatab", {`,
  },
  {
    // Instead of the "TAB" clef at the start of every line, the first line shows the open-string names
    // (E B G D A E) next to their strings and later lines start straight away.
    why: 'string names instead of the TAB clef',
    find: `			this.addPreBeatGlyph(new TabClefGlyph(0, this.getLineY(center)));`,
    replace: `			if (this.bar.index === 0) this.addPreBeatGlyph(new TabStringNamesGlyph(0, 0));`,
  },
  {
    why: 'the string names glyph itself',
    find: `class TabClefGlyph extends MusicFontGlyph {`,
    replace: `class TabStringNamesGlyph extends Glyph {
	_names = [];
	doLayout() {
		const canvas = this.renderer.scoreRenderer.canvas;
		const font = this.renderer.resources.tablatureFont;
		this._names = this.renderer.bar.staff.tuning.map((pitch) => Tuning.getTextForTuning(pitch, false));
		canvas.font = font;
		let widest = 0;
		for (const name of this._names) widest = Math.max(widest, canvas.measureText(name).width);
		this.width = widest + font.size * 0.8;
	}
	paint(cx, cy, canvas) {
		const baseline = canvas.textBaseline;
		const align = canvas.textAlign;
		const color = canvas.color;
		canvas.font = this.renderer.resources.tablatureFont;
		canvas.color = this.renderer.resources.secondaryGlyphColor;
		canvas.textBaseline = TextBaseline.Middle;
		canvas.textAlign = TextAlign.Left;
		this._names.forEach((name, line) => canvas.fillText(name, cx + this.x, cy + this.y + this.renderer.getLineY(line)));
		canvas.textBaseline = baseline;
		canvas.textAlign = align;
		canvas.color = color;
	}
}
class TabClefGlyph extends MusicFontGlyph {`,
  },

  // ---- Amp buses: tone chains per track ----
  // The synthesizer mixes every track into one stereo stream, so nothing can be done to one track alone. These
  // patches give it up to eight more stereo streams ("amp buses"). The page sends a routing table, MIDI channel ->
  // GM program -> [bus, program to play], from the tones the user gave the tracks (web/src/audio/ampRouting.ts): a channel
  // playing a routed program renders into that bus, overdriven and distortion guitar with the clean electric
  // guitar samples, and the page runs each bus through its tone's chain (web/src/audio/ampSim.ts).
  // A block of samples is [bus count, main stream, bus 1, …, bus N], all streams the same length; it travels
  // worker -> main thread -> worklet unchanged, and only the synthesizer that fills it and the worklet that plays
  // it know the format.
  {
    why: 'amp buses: routing state on the synthesizer',
    find: `class TinySoundFont {
	_midiEventQueue = new Queue();`,
    replace: `class TinySoundFont {
	ampRouting = null;
	ampBusCount = 0;
	ampBuffers = null;
	_midiEventQueue = new Queue();`,
  },
  {
    why: 'amp buses: a channel remembers its bus',
    find: `class Channel {
	presetIndex = 0;`,
    replace: `class Channel {
	ampBus = 0;
	presetIndex = 0;`,
  },
  {
    why: 'amp buses: a routed channel goes to its bus and plays the program the route says',
    find: `		} else presetIndex = this._getPresetIndex(c.bank & 2047, presetNumber);
		c.presetIndex = presetIndex;`,
    replace: `		} else {
			const routes = this.ampRouting ? this.ampRouting[channel] : void 0;
			const route = routes ? routes[presetNumber] : void 0;
			c.ampBus = route ? route[0] : 0;
			if (route) presetNumber = route[1];
			presetIndex = this._getPresetIndex(c.bank & 2047, presetNumber);
		}
		if (midiDrums) c.ampBus = 0;
		c.presetIndex = presetIndex;`,
  },
  {
    why: 'amp buses: a note keeps the bus it started on',
    find: `voice.playingChannel = this.activeChannel;`,
    replace: `voice.playingChannel = this.activeChannel;
		voice.ampBus = c.ampBus;`,
  },
  {
    why: 'amp buses: notes on a bus render into its buffer',
    find: `else voice.render(this, buffer, bufferPos, sampleCount, isChannelMuted);`,
    replace: `else voice.render(this, (voice.ampBus > 0 && this.ampBuffers && this.ampBuffers[voice.ampBus - 1]) || buffer, bufferPos, sampleCount, isChannelMuted);`,
  },
  {
    why: 'amp buses: the programs the routes play are loaded too',
    find: `loadPresets(hydra, instrumentPrograms, percussionKeys, append) {`,
    replace: `loadPresets(hydra, instrumentPrograms, percussionKeys, append) {
		if (this.ampRouting) for (const routes of Object.values(this.ampRouting)) for (const route of Object.values(routes)) instrumentPrograms.add(route[1]);`,
  },
  {
    why: 'amp buses: the synthesizer fills one stream per bus besides the main one',
    find: `			let samples = new Float32Array(SynthConstants.MicroBufferSize * SynthConstants.MicroBufferCount * SynthConstants.AudioChannels);
			let bufferPos = 0;`,
    replace: `			const busLength = SynthConstants.MicroBufferSize * SynthConstants.MicroBufferCount * SynthConstants.AudioChannels;
			const buses = this.synthesizer.ampBusCount;
			const all = new Float32Array(1 + busLength * (buses + 1));
			all[0] = buses;
			let samples = all.subarray(1, 1 + busLength);
			this.synthesizer.ampBuffers = Array.from({ length: buses }, (_, bus) => all.subarray(1 + busLength * (bus + 1), 1 + busLength * (bus + 2)));
			let bufferPos = 0;`,
  },
  {
    why: 'amp buses: the block is sent with all its streams; the position counts the main one',
    find: `			if (bufferPos < samples.length) samples = samples.subarray(0, bufferPos);
			this._notPlayedSamples += samples.length;
			this.output.addSamples(samples);`,
    replace: `			let packed = all;
			if (bufferPos < busLength) {
				packed = new Float32Array(1 + bufferPos * (buses + 1));
				packed[0] = buses;
				for (let bus = 0; bus <= buses; bus++) packed.set(all.subarray(1 + busLength * bus, 1 + busLength * bus + bufferPos), 1 + bufferPos * bus);
			}
			this._notPlayedSamples += bufferPos;
			this.output.addSamples(packed);`,
  },
  {
    why: 'amp buses: the page sends the routing table to the worker',
    find: `			case "alphaSynth.playOneTimeMidiFile":`,
    replace: `			case "tabs.setAmpRouting":
				this._player.synthesizer.ampRouting = data.routing;
				this._player.synthesizer.ampBusCount = data.buses;
				break;
			case "alphaSynth.playOneTimeMidiFile":`,
  },
  {
    why: 'amp buses: the worklet keeps one buffer per bus',
    find: `				this._circularBuffer = new CircularSampleBuffer(AlphaSynthWebWorkletProcessor.BufferSize * this._bufferCount);`,
    replace: `				this._circularBuffer = new CircularSampleBuffer(AlphaSynthWebWorkletProcessor.BufferSize * this._bufferCount);
				this._ampBuffers = Array.from({ length: 8 }, () => new CircularSampleBuffer(AlphaSynthWebWorkletProcessor.BufferSize * this._bufferCount));
				this._ampOutput = new Float32Array(0);`,
  },
  {
    why: 'amp buses: the worklet splits an incoming block into its streams',
    find: `						const f = data.samples;
						this._circularBuffer.write(f, 0, f.length);`,
    replace: `						const f = data.samples;
						if (f.length > 0) {
							const buses = f[0];
							const part = (f.length - 1) / (buses + 1);
							this._circularBuffer.write(f, 1, part);
							for (let bus = 0; bus < 8; bus++) {
								if (bus < buses) this._ampBuffers[bus].write(f, 1 + part * (bus + 1), part);
								else if (this._ampBuffers[bus].count > 0) this._ampBuffers[bus].clear();
							}
						}`,
  },
  {
    why: 'amp buses: clearing the worklet clears every stream',
    find: `					case "alphaSynth.output.resetSamples":
						this._circularBuffer.clear();`,
    replace: `					case "alphaSynth.output.resetSamples":
						this._circularBuffer.clear();
						for (const ampBuffer of this._ampBuffers) ampBuffer.clear();`,
  },
  {
    why: 'amp buses: the worklet plays each bus on its own output',
    find: `				if (samplesFromBuffer < left.length) for (let i = samplesFromBuffer; i < left.length; i++) {
					left[i] = 0;
					right[i] = 0;
				}`,
    replace: `				if (samplesFromBuffer < left.length) for (let i = samplesFromBuffer; i < left.length; i++) {
					left[i] = 0;
					right[i] = 0;
				}
				if (this._ampOutput.length !== samples) this._ampOutput = new Float32Array(samples);
				for (let bus = 0; bus < 8; bus++) {
					const ampLeft = outputs[bus + 1]?.[0];
					const ampRight = outputs[bus + 1]?.[1];
					const read = this._ampBuffers[bus].read(this._ampOutput, 0, Math.min(samplesFromBuffer, this._ampBuffers[bus].count));
					if (!ampLeft || !ampRight) continue;
					let a = 0;
					for (let i = 0; i < ampLeft.length; i++) {
						const has = a < read;
						ampLeft[i] = has ? this._ampOutput[a++] : 0;
						ampRight[i] = has ? this._ampOutput[a++] : 0;
					}
				}`,
  },
  {
    why: 'amp buses: the worklet node has nine stereo outputs (main and eight buses)',
    find: `				numberOfOutputs: 1,
				outputChannelCount: [2],`,
    replace: `				numberOfOutputs: 9,
				outputChannelCount: [2, 2, 2, 2, 2, 2, 2, 2, 2],`,
  },
  {
    why: 'amp buses: the page connects the bus outputs to its tone chains',
    find: `			this._worklet.connect(ctx.destination);`,
    replace: `			this._worklet.connect(ctx.destination, 0);
			if (typeof globalThis.__tabsAmpBus === "function") globalThis.__tabsAmpBus(ctx, this._worklet);
			else for (let bus = 1; bus < 9; bus++) this._worklet.connect(ctx.destination, bus);`,
  },
  {
    // Without audio worklets alphaTab falls back to a script processor with a single stream; the buses are mixed
    // back into it (unprocessed).
    why: 'amp buses: the script processor fallback mixes the streams back together',
    find: `	addSamples(f) {
		this._circularBuffer.write(f, 0, f.length);
		this._requestedBufferCount--;
	}`,
    replace: `	addSamples(f) {
		if (f.length > 0) {
			const buses = f[0];
			const part = (f.length - 1) / (buses + 1);
			const mixed = f.slice(1, 1 + part);
			for (let bus = 1; bus <= buses; bus++) for (let i = 0; i < part; i++) mixed[i] += f[1 + part * bus + i];
			this._circularBuffer.write(mixed, 0, part);
		}
		this._requestedBufferCount--;
	}`,
  },
]

export function alphaTabPatches(): Plugin {
  return {
    name: 'tabs:alphatab-patches',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]@coderline[\\/]alphatab[\\/]dist[\\/]alphaTab\.core(\.min)?\.mjs/.test(id)) return null
      let patched = code
      for (const patch of PATCHES) {
        if (!patched.includes(patch.find)) {
          this.error(`alphaTab patch "${patch.why}" no longer applies to ${id}; see web/alphatab-patches.ts`)
        }
        patched = patched.replace(patch.find, patch.replace)
      }
      return { code: patched, map: null }
    },
  }
}

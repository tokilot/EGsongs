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

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

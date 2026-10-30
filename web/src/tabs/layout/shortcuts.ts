import { useEffect } from 'react'
import { SAVE_EDITS_EVENT } from '../library/useTabEditing.ts'
import type { PlayerController } from '../player/controller.ts'
import { model } from '@coderline/alphatab'
import type { TabEditor } from '../player/tabEditor.ts'
import { usePlayer } from '../player/usePlayer.ts'

/** Shown in the help panel; keep in step with the handler below. */
export const SHORTCUTS = [
  { keys: 'Space', label: '播放 / 暂停' },
  { keys: '← / →', label: '上一小节 / 下一小节' },
  { keys: 'Home', label: '回到开头' },
  { keys: 'L', label: '循环' },
  { keys: 'M', label: '跟随曲谱的节拍器' },
  { keys: 'C', label: '预备拍' },
  { keys: '+ / -', label: '加速 / 减速 5%' },
  { keys: '/', label: '聚焦搜索' },
]

/** Fired on window to open the search panel in the top bar. */
export const OPEN_SEARCH_EVENT = 'tabs:open-search'

const SPEED_STEP = 0.05

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  // Sliders and checkboxes keep their own arrow/space handling; text fields swallow everything.
  return target instanceof HTMLInputElement
}

/** Letter keys that switch a technique on or off at the edit cursor (shown in the edit panel too). */
const LETTER_KEYS: Record<string, (editor: TabEditor) => void> = {
  h: (editor) => editor.toggle('hammer'),
  s: (editor) => editor.setSlide(editor.state().note?.slide === 'legato' ? 'none' : 'legato'),
  b: (editor) => editor.setBend(editor.state().note?.bend === 'full' ? 'none' : 'full'),
  v: (editor) => editor.setVibrato(editor.state().note?.vibrato ? model.VibratoType.None : model.VibratoType.Slight),
  t: (editor) => editor.toggle('tie'),
  p: (editor) => editor.toggle('palmMute'),
  l: (editor) => editor.toggle('letRing'),
  x: (editor) => editor.toggle('dead'),
  g: (editor) => editor.toggle('ghost'),
  a: (editor) => editor.setAccent(editor.state().note?.accent ? model.AccentuationType.None : model.AccentuationType.Normal),
}

/** While the tab editor is open the keyboard edits the tab. Returns whether the key was used. */
function editKey(event: KeyboardEvent, player: PlayerController): boolean {
  const command = event.ctrlKey || event.metaKey
  const key = event.key
  if (command) {
    const lower = key.toLowerCase()
    if (lower === 'z' && !event.shiftKey) player.edit((editor) => editor.undo())
    else if (lower === 'y' || (lower === 'z' && event.shiftKey)) player.edit((editor) => editor.redo())
    else if (lower === 's') window.dispatchEvent(new Event(SAVE_EDITS_EVENT))
    else if (key === 'ArrowLeft') player.edit((editor) => editor.stepBar(-1))
    else if (key === 'ArrowRight') player.edit((editor) => editor.stepBar(1))
    else return false
    return true
  }
  if (event.altKey) return false
  if (/^[0-9]$/.test(key)) {
    player.typeFret(Number(key))
    return true
  }
  const letter = LETTER_KEYS[key.toLowerCase()]
  if (letter) {
    player.edit(letter)
    return true
  }
  switch (key) {
    case 'Escape':
      player.deselect()
      return true
    case ' ':
      player.playPause()
      return true
    case 'ArrowLeft':
      player.edit((editor) => editor.stepBeat(-1))
      return true
    case 'ArrowRight':
      player.edit((editor) => editor.stepBeat(1))
      return true
    case 'ArrowUp':
      player.edit((editor) => editor.stepString(1))
      return true
    case 'ArrowDown':
      player.edit((editor) => editor.stepString(-1))
      return true
    case 'Home':
      player.edit((editor) => editor.moveTo({ beat: 0 }))
      return true
    case 'End':
      player.edit((editor) => editor.moveTo({ beat: Number.MAX_SAFE_INTEGER }))
      return true
    case 'Delete':
    case 'Backspace':
      if (event.shiftKey) player.edit((editor) => editor.deleteBeat())
      else player.edit((editor) => editor.removeNote())
      return true
    case 'Insert':
    case 'Enter':
      player.edit((editor) => editor.insertBeat())
      return true
    case 'r':
    case 'R':
      player.edit((editor) => editor.clearBeat())
      return true
    case '+':
    case '=':
      player.edit((editor) => editor.stepDuration(true))
      return true
    case '-':
    case '_':
      player.edit((editor) => editor.stepDuration(false))
      return true
    case '.':
      player.edit((editor) => editor.toggleDot())
      return true
    default:
      return false
  }
}

export function useShortcuts() {
  const { state, player } = usePlayer()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return
      if (player.getSnapshot().editing) {
        if (editKey(event, player)) event.preventDefault()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const handled = (() => {
        switch (event.key) {
          case ' ':
            // A focused button would also be "clicked" by Space; the shortcut wins.
            player.playPause()
            return true
          case 'ArrowLeft':
            player.seekBars(-1)
            return true
          case 'ArrowRight':
            player.seekBars(1)
            return true
          case 'Home':
            player.toStart()
            return true
          case 'l':
          case 'L':
            player.setLooping(!state.looping)
            return true
          case 'm':
          case 'M':
            player.setMetronome(!state.metronome)
            return true
          case 'c':
          case 'C':
            player.setCountIn(!state.countIn)
            return true
          case '+':
          case '=':
            player.setSpeed(state.speed + SPEED_STEP)
            return true
          case '-':
          case '_':
            player.setSpeed(state.speed - SPEED_STEP)
            return true
          case '/':
            window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))
            return true
          default:
            return false
        }
      })()
      if (handled) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [player, state.looping, state.metronome, state.countIn, state.speed])
}

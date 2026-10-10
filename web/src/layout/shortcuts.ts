import { useEffect } from 'react'
import { usePlayer } from '../player/usePlayer.ts'

/** Shown in the help panel; keep in step with the handler below. */
export const SHORTCUTS = [
  { keys: 'Space', label: '播放 / 暂停' },
  { keys: '← / →', label: '上一小节 / 下一小节' },
  { keys: 'Home', label: '回到开头' },
  { keys: 'L', label: '循环' },
  { keys: 'M', label: '节拍器' },
  { keys: 'C', label: '预备拍' },
  { keys: '+ / -', label: '加速 / 减速 5%' },
  { keys: '/', label: '聚焦搜索' },
]

const SPEED_STEP = 0.05

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  // Sliders and checkboxes keep their own arrow/space handling; text fields swallow everything.
  return target instanceof HTMLInputElement
}

export function useShortcuts() {
  const { state, player } = usePlayer()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return
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
            document.getElementById('song-search')?.focus()
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

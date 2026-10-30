import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import styles from './Popover.module.css'

interface PopoverProps {
  open: boolean
  onClose: () => void
  /** The button that toggles the popover. */
  trigger: ReactNode
  /** Opens above the trigger (control bar) or below it (top bar). */
  placement: 'above' | 'below'
  align?: 'start' | 'center' | 'end'
  label: string
  children: ReactNode
}

/** Gap kept between a popover and the window edge. */
const EDGE = 8

/**
 * A small floating panel anchored to its trigger. Closes on outside click and Escape, and is nudged back
 * inside the window when its alignment would push it past an edge.
 */
export function Popover({ open, onClose, trigger, placement, align = 'center', label, children }: PopoverProps) {
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, onClose])

  // Keep the panel inside the window: measure it where the CSS put it and shift it sideways if needed.
  // Content can change size (search results arriving), so re-check whenever it does.
  useLayoutEffect(() => {
    const element = panel.current
    if (!open || !element) return
    const fit = () => {
      element.style.translate = ''
      const box = element.getBoundingClientRect()
      const limit = document.documentElement.clientWidth - EDGE
      let shift = 0
      if (box.right > limit) shift = limit - box.right
      if (box.left + shift < EDGE) shift = EDGE - box.left
      if (shift !== 0) element.style.translate = `${Math.round(shift)}px 0`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    window.addEventListener('resize', fit)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [open])

  return (
    <div className={styles.anchor} ref={root}>
      {trigger}
      {open && (
        <div ref={panel} className={`${styles.panel} ${styles[placement]} ${styles[align]}`} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  )
}

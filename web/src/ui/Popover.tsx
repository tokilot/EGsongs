import { useEffect, useRef, type ReactNode } from 'react'
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

/** A small floating panel anchored to its trigger. Closes on outside click and Escape. */
export function Popover({ open, onClose, trigger, placement, align = 'center', label, children }: PopoverProps) {
  const root = useRef<HTMLDivElement>(null)

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

  return (
    <div className={styles.anchor} ref={root}>
      {trigger}
      {open && (
        <div className={`${styles.panel} ${styles[placement]} ${styles[align]}`} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useDialog } from './useDialog'

interface Props {
  open: boolean
  /** Название окна для экранного диктора */
  label: string
  onClose: () => void
  /** Свои клавиши, например ← → для листания */
  onKey?: (e: KeyboardEvent) => void
  children: ReactNode
}

/**
 * Окно на весь экран. Где браузер умеет полноэкранный режим — включаем его; на телефонах без него окно просто
 * занимает весь экран. Escape закрывает, выход из полноэкранного режима средствами браузера — тоже.
 * Рисуется прямо в body: внутри анимированного окна (transform) `position: fixed` держался бы за окно, а не за экран.
 */
export function FullscreenPanel({ open, label, onClose, onKey, children }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  useDialog(open, panel, onClose, onKey)

  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  useEffect(() => {
    if (!open) return
    panel.current?.requestFullscreen?.().catch(() => {})
    const onChange = () => { if (!document.fullscreenElement) onCloseRef.current() }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }, [open])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}
          className="fixed inset-0 z-[70] bg-black text-white flex flex-col focus-visible:outline-none"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

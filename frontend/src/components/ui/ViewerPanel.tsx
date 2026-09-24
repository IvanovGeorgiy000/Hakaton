import { useRef, type ReactNode } from 'react'
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
 * Окно просмотра на всю вкладку: поверх страницы, без полноэкранного режима браузера. Escape закрывает.
 * Рисуется прямо в body: внутри анимированного окна (transform) `position: fixed` держался бы за окно, а не за вкладку.
 */
export function ViewerPanel({ open, label, onClose, onKey, children }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  useDialog(open, panel, onClose, onKey)

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

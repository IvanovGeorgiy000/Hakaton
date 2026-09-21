import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
}

/** Модальное окно: на телефоне выезжает снизу, на десктопе — по центру */
export function Modal({ open, onClose, title, children, wide }: ModalProps) {
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog" aria-modal="true" aria-label={title}
            className={cn('bg-card w-full max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl', wide ? 'sm:max-w-4xl' : 'sm:max-w-2xl')}
            initial={reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-card/95 backdrop-blur border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between gap-3 z-10">
              <h2 className="text-lg sm:text-xl font-bold leading-tight">{title}</h2>
              <button
                onClick={onClose} aria-label="Закрыть"
                className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center hover:bg-muted cursor-pointer transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-4 sm:p-6">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

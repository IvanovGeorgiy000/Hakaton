import { useEffect, useRef, type ReactNode } from 'react'
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

/** Открытые окна, верхнее — последнее. Escape и Tab обслуживает только оно: видео поверх истории камеры закрывается одно. */
const stack: object[] = []
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Диалог: на телефоне выезжает снизу, на десктопе — по центру.
 * Фокус переходит в окно, по Tab не уходит из него и возвращается туда, откуда окно открыли.
 */
export function Modal({ open, onClose, title, children, wide }: ModalProps) {
  const reduce = useReducedMotion()
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })

  // зависимость только open: иначе при каждом рендере фокус прыгал бы из поля ввода на окно
  useEffect(() => {
    if (!open) return
    const self = {}
    stack.push(self)
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== self || !panel.current) return
      if (e.key === 'Escape') close.current()
      else if (e.key === 'Tab') keepFocusInside(e, panel.current)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(self), 1)
      if (!stack.length) document.body.style.overflow = ''
      opener?.focus()
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 p-0 sm:p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            ref={panel} tabIndex={-1}
            role="dialog" aria-modal="true" aria-label={title}
            className={cn('bg-card w-full max-h-[94dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-[var(--shadow-pop)] focus-visible:outline-none', wide ? 'sm:max-w-4xl' : 'sm:max-w-2xl')}
            initial={reduce ? false : { y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduce ? undefined : { y: 8, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-card border-b border-border pl-5 pr-2 sm:pl-6 h-14 flex items-center justify-between gap-3 z-10 rounded-t-2xl">
              <h2 className="text-[18px] font-semibold leading-tight truncate">{title}</h2>
              <button onClick={onClose} aria-label="Закрыть" className="shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 sm:p-6">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Tab с последнего элемента окна ведёт на первый, Shift+Tab с первого — на последний */
function keepFocusInside(e: KeyboardEvent, root: HTMLElement) {
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
  if (!items.length) {
    e.preventDefault()
    return
  }
  const first = items[0], last = items[items.length - 1], active = document.activeElement
  const target = !root.contains(active) ? (e.shiftKey ? last : first)
    : e.shiftKey && (active === first || active === root) ? last
    : !e.shiftKey && active === last ? first
    : null
  if (target) {
    e.preventDefault()
    target.focus()
  }
}

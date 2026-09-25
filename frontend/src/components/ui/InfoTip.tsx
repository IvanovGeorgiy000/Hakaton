import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, m } from 'framer-motion'
import { CircleHelp } from 'lucide-react'
import { cn } from '@/lib/utils'

const WIDTH = 300
const GAP = 8

/**
 * Значок «?» с пояснением. Открывается нажатием — и мышью, и пальцем; закрывается повторным нажатием, нажатием мимо,
 * Escape (закрывает только пояснение, не окно под ним) или прокруткой. Текст пояснения зачитывает экранный диктор.
 * Окошко рисуется поверх страницы, поэтому его не обрезают диалоги и прокручиваемые блоки.
 */
export function InfoTip({ children, label = 'Пояснение', className }: { children: ReactNode; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [spot, setSpot] = useState<{ top: number; left: number; above: boolean } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  // место окошка: под значком, а если внизу тесно — над ним; по ширине не вылезает за край экрана
  useLayoutEffect(() => {
    if (!open || !button.current) return
    const r = button.current.getBoundingClientRect()
    const width = Math.min(WIDTH, window.innerWidth - 32)
    const left = Math.min(Math.max(16, r.left + r.width / 2 - width / 2), window.innerWidth - 16 - width)
    const above = window.innerHeight - r.bottom < 160 && r.top > window.innerHeight - r.bottom
    setSpot({ top: above ? r.top - GAP : r.bottom + GAP, left, above })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (!button.current?.contains(target) && !panel.current?.contains(target)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()  // перехватываем раньше окна-диалога: Escape закрывает только пояснение
      close()
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <span className={cn('inline-flex align-middle', className)}>
      <button
        ref={button} type="button" aria-label={label} aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          // область нажатия 44 px, а на странице значок занимает место как обычная буква
          'relative inline-flex items-center justify-center w-6 h-6 rounded-full cursor-pointer transition-colors',
          "before:absolute before:-inset-2.5 before:content-['']",
          open ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <CircleHelp className="w-[18px] h-[18px]" aria-hidden />
      </button>
      {createPortal(
        <>
          {/* для экранного диктора: при открытии текст появляется в живой области */}
          <div role="status" className="sr-only">{open ? children : null}</div>
          <AnimatePresence>
          {open && spot && (
            <m.div
              ref={panel} aria-hidden
              initial={{ opacity: 0, y: spot.above ? 4 : -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
              style={{ top: spot.top, left: spot.left, width: Math.min(WIDTH, window.innerWidth - 32) }}
              className={cn(
                'fixed z-[80] rounded-xl border border-border bg-card text-foreground p-3.5 text-[14px] leading-snug font-normal',
                'text-left normal-case tracking-normal shadow-[var(--shadow-pop)]',
                spot.above && '-translate-y-full',
              )}
            >
              {children}
            </m.div>
          )}
          </AnimatePresence>
        </>,
        document.body,
      )}
    </span>
  )
}

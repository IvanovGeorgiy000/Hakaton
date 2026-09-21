import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { LogOut, HelpCircle, Bell, CheckCircle2, LifeBuoy } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useApp } from '@/store/context'
import { bySite, bySeverity, initials, isOpen } from '@/store/selectors'
import { SEVERITY } from '@/lib/labels'
import { ago, shortName } from '@/lib/utils'
import { cn } from '@/lib/utils'

export interface NavItem { to: string; label: string; Icon: LucideIcon; end?: boolean }

/**
 * Каркас приложения.
 * Десктоп: тёмное боковое меню + верхняя панель. Телефон: верхняя панель + нижняя навигация.
 */
export function AppShell({ nav, alertsPath }: { nav: NavItem[]; alertsPath: string }) {
  const { role, user, logout, toasts } = useApp()
  const loc = useLocation()
  const reduce = useReducedMotion()

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* ---------- Боковое меню (десктоп) ---------- */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col bg-sidebar text-sidebar-foreground z-40">
        <NavLink to="/" className="h-16 px-5 flex items-center gap-3 border-b border-sidebar-border shrink-0">
          <img src="/favicon.svg" alt="" className="w-8 h-8" />
          <span className="font-bold text-white text-[17px] tracking-tight">СтройКонтроль</span>
        </NavLink>

        {role?.siteId && (
          <div className="mx-3 mt-4 rounded-lg border border-sidebar-border px-3 py-2.5">
            <div className="text-[11px] uppercase tracking-wider text-sidebar-muted">Ваш объект</div>
            <div className="text-white font-semibold leading-snug mt-0.5">{bySite(role.siteId).name}</div>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Разделы">
          <div className="px-3 pb-1.5 text-[11px] uppercase tracking-wider text-sidebar-muted">Разделы</div>
          {nav.map((n) => (
            <NavLink
              key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cn(
                'flex items-center gap-3 min-h-[46px] px-3 rounded-lg font-medium transition-colors',
                isActive ? 'bg-sidebar-active text-white' : 'hover:bg-sidebar-hover hover:text-white',
              )}
            >
              <n.Icon className="w-5 h-5 shrink-0" /> {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 pb-3 space-y-1">
          <NavLink to="/help" className={({ isActive }) => cn('flex items-center gap-3 min-h-[44px] px-3 rounded-lg font-medium transition-colors', isActive ? 'bg-sidebar-hover text-white' : 'hover:bg-sidebar-hover hover:text-white')}>
            <HelpCircle className="w-5 h-5" /> Как это работает
          </NavLink>
          <div className="flex items-center gap-3 px-3 py-2 text-[13px] text-sidebar-muted">
            <LifeBuoy className="w-5 h-5 shrink-0" /> Поддержка: доб. 114
          </div>
        </div>

        <div className="border-t border-sidebar-border p-3 flex items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-sidebar-hover text-white font-semibold flex items-center justify-center shrink-0">{user ? initials(user.name) : ''}</span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-white font-semibold truncate" title={user?.name}>{user ? shortName(user.name) : ''}</div>
            <div className="text-[13px] text-sidebar-muted truncate">{role?.title}</div>
          </div>
          <button onClick={logout} aria-label="Выйти" title="Выйти" className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-sidebar-hover hover:text-white cursor-pointer transition-colors shrink-0">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* ---------- Верхняя панель ---------- */}
      <header className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-border">
        <div className="h-16 px-4 lg:px-8 flex items-center gap-3">
          <NavLink to="/" className="lg:hidden flex items-center gap-2 font-bold shrink-0">
            <img src="/favicon.svg" alt="" className="w-8 h-8" />
            <span className="hidden sm:inline">СтройКонтроль</span>
          </NavLink>
          <div className="hidden lg:block leading-tight">
            <div className="font-semibold">Вторник, 15 сентября 2026</div>
            <div className="text-[13px] text-muted-foreground">Рабочая смена 08:00 – 20:00</div>
          </div>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
            <span className="inline-flex items-center gap-2 text-[13px] sm:text-[14px] text-muted-foreground" title="Камеры присылают снимки раз в час">
              <span className="relative flex w-2.5 h-2.5"><span className="absolute inset-0 rounded-full bg-ok opacity-40 animate-ping" /><span className="relative w-2.5 h-2.5 rounded-full bg-ok" /></span>
              <span><span className="hidden sm:inline">Данные обновлены в </span>12:30</span>
            </span>
            <NotificationsBell alertsPath={alertsPath} />
            <NavLink to="/help" aria-label="Помощь" className="lg:hidden w-11 h-11 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground"><HelpCircle className="w-6 h-6" /></NavLink>
            <button onClick={logout} aria-label="Выйти" className="lg:hidden w-11 h-11 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground cursor-pointer"><LogOut className="w-6 h-6" /></button>
          </div>
        </div>
      </header>

      <main className="w-full max-w-6xl mx-auto px-4 lg:px-8 py-6 pb-28 lg:pb-12">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={loc.pathname}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ---------- Нижняя навигация (телефон и планшет) ---------- */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-card border-t border-border z-30 pb-[env(safe-area-inset-bottom)]" aria-label="Разделы">
        <div className="grid max-w-xl mx-auto" style={{ gridTemplateColumns: `repeat(${nav.length}, 1fr)` }}>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn('flex flex-col items-center justify-center gap-1 min-h-[64px] text-[12px] font-semibold transition-colors', isActive ? 'text-primary' : 'text-muted-foreground')}>
              {({ isActive }) => (
                <>
                  <span className={cn('w-12 h-8 rounded-full flex items-center justify-center', isActive && 'bg-info-bg')}><n.Icon className="w-6 h-6" /></span>
                  {n.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* ---------- Всплывающие подтверждения ---------- */}
      <div className="fixed z-[60] bottom-24 lg:bottom-6 right-4 left-4 sm:left-auto flex flex-col items-end gap-2 pointer-events-none" role="status" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id} layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
              className="pointer-events-auto bg-slate-900 text-white rounded-lg shadow-[var(--shadow-pop)] px-4 py-3 flex items-center gap-2.5 font-medium max-w-sm"
            >
              <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" /> {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Колокольчик: новые отклонения, доступные роли */
function NotificationsBell({ alertsPath }: { alertsPath: string }) {
  const { alerts, visibleSites, role } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const ids = new Set(visibleSites.map((s) => s.id))
  const fresh = alerts.filter((a) => ids.has(a.siteId) && a.status === 'new' && isOpen(a.status)).sort(bySeverity)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  if (role?.id === 'admin') return null
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)} aria-label={`Уведомления: ${fresh.length} новых`} aria-expanded={open}
        className="relative w-11 h-11 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground cursor-pointer transition-colors"
      >
        <Bell className="w-6 h-6" />
        {fresh.length > 0 && <span className="absolute top-1 right-1 min-w-[20px] h-5 px-1 rounded-full bg-danger text-white text-[12px] font-bold flex items-center justify-center tabular">{fresh.length}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.14 }}
            className="absolute right-0 mt-2 w-[min(92vw,380px)] bg-card border border-border rounded-xl shadow-[var(--shadow-pop)] overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-border font-semibold">Новые отклонения</div>
            {fresh.length === 0 ? (
              <div className="px-4 py-6 text-center text-muted-foreground">Новых отклонений нет</div>
            ) : (
              <ul className="max-h-[60vh] overflow-y-auto divide-y divide-border">
                {fresh.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => { setOpen(false); nav(alertsPath) }} className="w-full text-left px-4 py-3 hover:bg-muted/60 cursor-pointer flex gap-3">
                      <span className={cn('w-2 h-2 rounded-full mt-2 shrink-0', SEVERITY[a.severity].bar)} />
                      <span className="min-w-0">
                        <span className="block font-semibold leading-snug">{a.title}</span>
                        <span className="block text-[13px] text-muted-foreground truncate">{bySite(a.siteId).name} · {ago(a.startedAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { HardHat, Briefcase, ShieldCheck, Settings, ChevronRight, Eye, EyeOff, Camera, CalendarCheck, BellRing } from 'lucide-react'
import { ROLES, type RoleId } from '@/data'
import { useApp } from '@/store/context'
import { Button } from '@/components/ui/Button'

const ICONS: Record<RoleId, typeof HardHat> = { foreman: HardHat, manager: Briefcase, inspector: ShieldCheck, admin: Settings }
/** Учётные записи стенда: логин → роль (пароль на стенде не проверяется) */
const LOGINS: Record<string, RoleId> = { prorab: 'foreman', rukovoditel: 'manager', inspektor: 'inspector', admin: 'admin' }

/** Экран входа: обычная форма + быстрый вход по ролям для тех, кому трудно печатать */
export function Login() {
  const { login } = useApp()
  const reduce = useReducedMotion()
  const [name, setName] = useState('')
  const [pass, setPass] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const role = LOGINS[name.trim().toLowerCase()]
    if (!name.trim() || !pass) return setError('Введите логин и пароль')
    if (!role) return setError('Неверный логин или пароль')
    login(role)
  }

  return (
    <div className="min-h-dvh grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Левая панель — о системе */}
      <aside className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-10 xl:p-14 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07]" aria-hidden style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
        <div className="relative flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="w-10 h-10" />
          <span className="text-white text-xl font-bold tracking-tight">СтройКонтроль</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-white text-3xl xl:text-4xl font-bold leading-tight">Контроль стройплощадок по камерам</h1>
          <p className="mt-4 text-lg leading-relaxed">Система сама сверяет технику на объекте с графиком работ и сообщает, если что-то идёт не по плану.</p>
          <ul className="mt-8 space-y-4">
            {[[Camera, 'Снимки с камер каждый час'], [CalendarCheck, 'Сверка с календарным планом'], [BellRing, 'Понятные сообщения с фото']].map(([Icon, text]) => {
              const I = Icon as typeof Camera
              return <li key={text as string} className="flex items-center gap-3 text-white"><span className="w-10 h-10 rounded-lg bg-sidebar-hover flex items-center justify-center"><I className="w-5 h-5" /></span>{text as string}</li>
            })}
          </ul>
        </div>
        <div className="relative flex items-center gap-3 text-[13px] text-sidebar-muted">
          <img src="/team-logo.jpg" alt="" className="w-9 h-9 rounded-md object-cover" />
          <span>© 2026 СтройКонтроль · версия 0.9 · команда «Работяги»</span>
        </div>
      </aside>

      {/* Правая панель — вход */}
      <main className="flex items-center justify-center p-4 sm:p-8">
        <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-6">
            <img src="/favicon.svg" alt="" className="w-10 h-10" />
            <span className="text-2xl font-bold tracking-tight">СтройКонтроль</span>
          </div>
          <h2 className="text-2xl font-bold">Вход в систему</h2>
          <p className="text-muted-foreground mt-1">Введите логин и пароль, которые выдал администратор.</p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <div>
              <label htmlFor="login" className="block font-semibold mb-1.5">Логин</label>
              <input id="login" autoComplete="username" value={name} onChange={(e) => { setName(e.target.value); setError(null) }}
                className="w-full min-h-[52px] rounded-lg border border-border bg-card px-4 text-[17px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="например, prorab" />
            </div>
            <div>
              <label htmlFor="pass" className="block font-semibold mb-1.5">Пароль</label>
              <div className="relative">
                <input id="pass" type={show ? 'text' : 'password'} autoComplete="current-password" value={pass} onChange={(e) => { setPass(e.target.value); setError(null) }}
                  aria-describedby={error ? 'login-error' : undefined} aria-invalid={!!error}
                  className="w-full min-h-[52px] rounded-lg border border-border bg-card pl-4 pr-14 text-[17px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'} className="absolute right-1 top-1 w-11 h-11 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted cursor-pointer">
                  {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {error && <p id="login-error" role="alert" className="text-danger font-medium mt-2">{error}</p>}
            </div>
            <Button type="submit" size="lg" full>Войти</Button>
          </form>

          <div className="flex items-center gap-3 my-7 text-[13px] uppercase tracking-wider text-muted-foreground">
            <span className="h-px bg-border flex-1" /> или быстрый вход <span className="h-px bg-border flex-1" />
          </div>

          <ul className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden shadow-[var(--shadow-card)]">
            {ROLES.map((r) => {
              const Icon = ICONS[r.id]
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => login(r.id)} className="w-full text-left px-4 py-3 min-h-[64px] flex items-center gap-3 cursor-pointer hover:bg-muted/60 transition-colors">
                    <span className="w-10 h-10 rounded-lg bg-info-bg text-primary flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold leading-tight">{r.title}</span>
                      <span className="block text-[14px] text-muted-foreground">{r.subtitle}</span>
                    </span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </button>
                </li>
              )
            })}
          </ul>

          <p className="text-[14px] text-muted-foreground mt-5">
            Проверка одного снимка без входа: <Link to="/demo" className="text-primary font-semibold hover:underline">открыть страницу сверки</Link>
          </p>
        </motion.div>
      </main>
    </div>
  )
}

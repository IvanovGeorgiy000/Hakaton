import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Eye, EyeOff, Loader2, LogIn } from 'lucide-react'
import { api, ApiError } from '@/api'
import { ROLES, type RoleId } from '@/data'
import { useApp } from '@/store/context'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/layout/AppShell'
import { ThemePicker } from '@/components/ThemePicker'

/** Вход. Локально — форма и быстрый вход по роли; в режиме Keycloak — кнопка перехода к Keycloak. */
export function Login() {
  const { login, demoLogin, keycloakLogin } = useApp()
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta, retry: 1 })
  const keycloak = meta.data?.authMode === 'keycloak'
  const [busy, setBusy] = useState<RoleId | 'form' | null>(null)
  const [name, setName] = useState('')
  const [pass, setPass] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enter = async (kind: RoleId | 'form', action: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось войти. Попробуйте ещё раз.')
      setBusy(null)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !pass) return setError('Введите логин и пароль')
    void enter('form', () => login(name, pass))
  }

  const input = 'w-full min-h-[48px] rounded-lg border border-border-strong bg-card px-3.5 text-[16px] outline-none transition-shadow focus:border-primary focus:ring-4 focus:ring-primary/15'

  return (
    <div className="min-h-dvh flex flex-col items-center px-4 py-10 sm:py-16">
      <Logo className="text-xl mb-8" />

      {keycloak ? (
        <div className="w-full max-w-[420px] bg-card border border-border rounded-2xl shadow-[var(--shadow-card)] p-6 sm:p-8 text-center">
          <h1 className="text-2xl font-semibold">Вход в систему</h1>
          <p className="text-muted-foreground mt-1">Единый вход организации через Keycloak</p>
          <Button size="lg" full className="mt-6" onClick={keycloakLogin}>
            <LogIn className="w-5 h-5" /> Войти через Keycloak
          </Button>
          <p className="text-[13px] text-muted-foreground mt-3">Вас перенаправит на страницу входа Keycloak и обратно.</p>
        </div>
      ) : (
        <div className="w-full max-w-[420px] bg-card border border-border rounded-2xl shadow-[var(--shadow-card)] p-6 sm:p-8">
          <h1 className="text-2xl font-semibold">Вход в систему</h1>
          <p className="text-muted-foreground mt-1">Контроль строительных площадок по камерам</p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <div>
              <label htmlFor="login" className="block text-[15px] font-medium mb-1.5">Логин</label>
              <input id="login" autoComplete="username" value={name} onChange={(e) => { setName(e.target.value); setError(null) }} className={input} />
            </div>
            <div>
              <label htmlFor="pass" className="block text-[15px] font-medium mb-1.5">Пароль</label>
              <div className="relative">
                <input id="pass" type={show ? 'text' : 'password'} autoComplete="current-password" value={pass} onChange={(e) => { setPass(e.target.value); setError(null) }}
                  aria-describedby={error ? 'login-error' : undefined} aria-invalid={!!error} className={input + ' pr-12'} />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'} className="absolute right-0.5 top-0.5 w-11 h-11 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer">
                  {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {error && <p id="login-error" role="alert" className="text-danger text-[15px] mt-2">{error}</p>}
            </div>
            <Button type="submit" size="lg" full disabled={busy !== null}>
              {busy === 'form' && <Loader2 className="w-5 h-5 animate-spin" />} Войти
            </Button>
          </form>
        </div>
      )}

      {meta.isError && (
        <p role="alert" className="w-full max-w-[420px] mt-4 rounded-xl bg-warn-bg text-warn-fg px-4 py-3 text-[15px]">
          Нет связи с сервером. Проверьте, что бэкенд запущен, и обновите страницу.
        </p>
      )}

      {!keycloak && meta.data?.demoMode && (
        <div className="w-full max-w-[420px] mt-6">
          <div className="text-[14px] text-muted-foreground mb-2 px-1">Быстрый вход без пароля</div>
          <ul className="bg-card border border-border rounded-2xl shadow-[var(--shadow-card)] overflow-hidden divide-y divide-border">
            {ROLES.map((r) => (
              <li key={r.id}>
                <button type="button" disabled={busy !== null} onClick={() => void enter(r.id, () => demoLogin(r.id))} className="w-full text-left px-5 py-3.5 min-h-[60px] cursor-pointer transition-colors hover:bg-muted disabled:opacity-60 flex items-center gap-3">
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold">{r.title}</span>
                    <span className="block text-[14px] text-muted-foreground">{r.subtitle}</span>
                  </span>
                  {busy === r.id ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground shrink-0" /> : <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {meta.data?.demoMode && (
        <p className="w-full max-w-[420px] text-[14px] text-muted-foreground mt-5 px-1">
          Проверить один снимок без входа: <Link to="/demo" className="text-primary font-medium hover:underline">страница сверки</Link>
        </p>
      )}

      <div className="mt-8 flex flex-col items-center gap-2">
        <span className="text-[13px] text-muted-foreground">Оформление</span>
        <ThemePicker />
      </div>

      <footer className="mt-auto pt-8 flex items-center gap-2.5 text-[13px] text-muted-foreground">
        <img src="/team-logo.jpg" alt="" className="w-7 h-7 rounded-md object-cover" />
        Версия 0.9 · команда «Работяги» · ЛЦТ 2026
      </footer>
    </div>
  )
}

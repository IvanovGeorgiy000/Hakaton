import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Loader2, PlugZap, XCircle } from 'lucide-react'
import { api, ApiError } from '@/api'
import type { Connection, ProbeResult, ZoneKind } from '@/data'
import { useApp } from '@/store/context'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { cn } from '@/lib/utils'

type Protocol = Connection['protocol']
const DEFAULT_PORT: Record<Protocol, number> = { http: 80, https: 443, rtsp: 554 }
const PROTOCOLS: { id: Protocol; label: string; hint: string }[] = [
  { id: 'http', label: 'Снимок по HTTP', hint: 'Камера отдаёт картинку JPEG по ссылке' },
  { id: 'https', label: 'Снимок по HTTPS', hint: 'То же, но по защищённому соединению' },
  { id: 'rtsp', label: 'Видеопоток RTSP', hint: 'Сервер сам берёт кадр из видеопотока' },
]
/** Типовые пути у распространённых производителей — чтобы не искать их в инструкции */
const VENDORS: Record<string, { label: string; http: string; rtsp: string }> = {
  hikvision: { label: 'Hikvision', http: '/ISAPI/Streaming/channels/101/picture', rtsp: '/Streaming/Channels/101' },
  dahua: { label: 'Dahua', http: '/cgi-bin/snapshot.cgi?channel=1', rtsp: '/cam/realmonitor?channel=1&subtype=0' },
  axis: { label: 'Axis', http: '/axis-cgi/jpg/image.cgi', rtsp: '/axis-media/media.amp' },
}
const ZONE_KINDS: { id: ZoneKind; label: string }[] = [
  { id: 'work', label: 'Рабочая зона — техника здесь считается работающей' },
  { id: 'gate', label: 'Въезд — техника считается подъезжающей' },
  { id: 'storage', label: 'Склад' },
]
const HOST_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[?[0-9a-fA-F:]+\]?|[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*)$/
const NEW_ZONE = '__new__'
const inputCls = 'w-full min-h-[46px] rounded-lg border border-border-strong bg-card px-3 text-[16px] outline-none transition-shadow focus:border-primary focus:ring-4 focus:ring-primary/15 aria-[invalid=true]:border-danger'

interface Form {
  siteId: string; zoneId: string; newZoneName: string; newZoneKind: ZoneKind; name: string
  preset: string; protocol: Protocol; host: string; port: string; path: string; username: string; password: string
  allowOffline: boolean
}

/** Диалог «Добавить камеру по IP-адресу»: адрес → проверка подключения с предпросмотром → сохранение */
export function AddCameraDialog({ open, onClose, defaultSiteId }: { open: boolean; onClose: () => void; defaultSiteId?: string }) {
  return (
    <Modal open={open} onClose={onClose} title="Добавить камеру" wide>
      {open && <Body onClose={onClose} defaultSiteId={defaultSiteId} />}
    </Modal>
  )
}

function Body({ onClose, defaultSiteId }: { onClose: () => void; defaultSiteId?: string }) {
  const { sites, zones, addCamera, notify } = useApp()
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity })
  const firstZone = (siteId: string) => zones.find((z) => z.siteId === siteId)?.id ?? NEW_ZONE
  const [form, setForm] = useState<Form>(() => {
    const siteId = defaultSiteId ?? sites[0]?.id ?? ''
    return {
    siteId, zoneId: firstZone(siteId), newZoneName: '', newZoneKind: 'work', name: '', preset: '',
    protocol: 'http', host: '', port: '', path: '/', username: '', password: '', allowOffline: false,
    }
  })
  const [touched, setTouched] = useState<Partial<Record<keyof Form, boolean>>>({})
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [busy, setBusy] = useState<'probe' | 'save' | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const siteZones = zones.filter((z) => z.siteId === form.siteId)

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }))
    if (['protocol', 'host', 'port', 'path', 'username', 'password'].some((k) => k in patch)) setProbe(null)
    setSaveError(null)
  }
  const touch = (key: keyof Form) => setTouched((t) => ({ ...t, [key]: true }))

  /** Вставили ссылку целиком — раскладываем её по полям */
  const parseHost = (value: string) => {
    if (!value.includes('://')) return set({ host: value.trim() })
    try {
      const url = new URL(value.trim())
      const protocol = url.protocol.replace(':', '') as Protocol
      if (!(protocol in DEFAULT_PORT)) return set({ host: value.trim() })
      set({
        protocol, host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port, preset: '',
        path: decodeURI(url.pathname + url.search) || '/',
        username: decodeURIComponent(url.username) || form.username, password: decodeURIComponent(url.password) || form.password,
      })
    } catch {
      set({ host: value.trim() })
    }
  }

  const applyPreset = (preset: string, protocol = form.protocol) => {
    const demo = meta.data?.demoCameras[Number(preset.replace('demo:', ''))]
    if (preset.startsWith('demo:') && demo) return set({ preset, protocol: 'http', host: demo.host, port: String(demo.port), path: demo.path, username: '', password: '' })
    const vendor = VENDORS[preset]
    set({ preset, protocol, ...(vendor ? { path: protocol === 'rtsp' ? vendor.rtsp : vendor.http } : {}) })
  }

  const errors: Partial<Record<keyof Form, string>> = {}
  if (form.name.trim().length < 2) errors.name = 'Введите название, например «Камера 2 — въезд»'
  if (!form.host.trim()) errors.host = 'Введите IP-адрес камеры'
  else if (!HOST_RE.test(form.host.trim())) errors.host = 'Это не похоже на IP-адрес. Пример: 192.168.1.64'
  if (form.port && !(Number(form.port) >= 1 && Number(form.port) <= 65535)) errors.port = 'Порт — число от 1 до 65535'
  if (!form.path.startsWith('/')) errors.path = 'Путь начинается с «/»'
  if (form.zoneId === NEW_ZONE && form.newZoneName.trim().length < 2) errors.newZoneName = 'Введите название зоны'
  const shown = (key: keyof Form) => (touched[key] ? errors[key] : undefined)
  const connectionValid = !errors.host && !errors.port && !errors.path

  const connection = (): Connection => ({
    protocol: form.protocol, host: form.host.trim(), port: form.port ? Number(form.port) : null, path: form.path.trim() || '/',
    username: form.username.trim() || null, password: form.password || null,
  })

  const runProbe = async () => {
    setTouched((t) => ({ ...t, host: true, port: true, path: true }))
    if (!connectionValid) return
    setBusy('probe')
    try {
      setProbe(await api.probeCamera(connection()))
    } catch (e) {
      setProbe({ ok: false, code: 'error', message: e instanceof ApiError ? e.message : 'Не удалось проверить подключение', elapsedMs: 0, preview: null })
    } finally {
      setBusy(null)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched({ name: true, host: true, port: true, path: true, newZoneName: true })
    if (Object.keys(errors).length) return
    setBusy('save')
    setSaveError(null)
    try {
      const created = await addCamera({
        siteId: form.siteId, name: form.name.trim(), connection: connection(), allowOffline: form.allowOffline,
        zoneId: form.zoneId === NEW_ZONE ? null : form.zoneId,
        newZoneName: form.zoneId === NEW_ZONE ? form.newZoneName.trim() : null, newZoneKind: form.newZoneKind,
      })
      notify(created.online ? `${created.name} добавлена, первый снимок получен` : `${created.name} добавлена, но пока не отвечает`)
      onClose()
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Не удалось добавить камеру')
      setBusy(null)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <section className="grid sm:grid-cols-2 gap-4">
        <Field label="Объект">
          {(id) => (
            <select id={id} value={form.siteId} onChange={(e) => set({ siteId: e.target.value, zoneId: firstZone(e.target.value) })} className={inputCls}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Зона, за которой следит камера">
          {(id) => (
            <select id={id} value={form.zoneId} onChange={(e) => set({ zoneId: e.target.value })} className={inputCls}>
              {siteZones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              <option value={NEW_ZONE}>Новая зона…</option>
            </select>
          )}
        </Field>
        {form.zoneId === NEW_ZONE && (
          <>
            <Field label="Название новой зоны" error={shown('newZoneName')}>
              {(id, describedBy) => <input id={id} value={form.newZoneName} maxLength={200} onChange={(e) => set({ newZoneName: e.target.value })} onBlur={() => touch('newZoneName')}
                aria-invalid={!!shown('newZoneName')} aria-describedby={describedBy} className={inputCls} placeholder="Например: Въезд № 2" />}
            </Field>
            <Field label="Вид зоны">
              {(id) => (
                <select id={id} value={form.newZoneKind} onChange={(e) => set({ newZoneKind: e.target.value as ZoneKind })} className={inputCls}>
                  {ZONE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              )}
            </Field>
          </>
        )}
        <Field label="Название камеры" error={shown('name')} className="sm:col-span-2">
          {(id, describedBy) => <input id={id} value={form.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} onBlur={() => touch('name')}
            aria-invalid={!!shown('name')} aria-describedby={describedBy} className={inputCls} placeholder="Камера 2 — въезд" />}
        </Field>
      </section>

      <section className="border-t border-border pt-5 space-y-4">
        <h3 className="font-semibold text-[17px]">Подключение</h3>
        <div role="radiogroup" aria-label="Способ подключения" className="grid sm:grid-cols-3 gap-2">
          {PROTOCOLS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-label={p.label} aria-checked={form.protocol === p.id} onClick={() => applyPreset(form.preset.startsWith('demo:') ? '' : form.preset, p.id)}
              className={cn('text-left rounded-lg border px-3 py-2.5 cursor-pointer transition-colors', form.protocol === p.id ? 'border-primary bg-info-bg' : 'border-border-strong hover:bg-muted')}>
              <span className={cn('block font-semibold', form.protocol === p.id && 'text-info-fg')}>{p.label}</span>
              <span className="block text-[13px] text-muted-foreground">{p.hint}</span>
            </button>
          ))}
        </div>

        <Field label="Быстрая настройка" hint="Подставит типовой путь для камеры этого производителя">
          {(id, describedBy) => (
            <select id={id} aria-describedby={describedBy} value={form.preset} onChange={(e) => applyPreset(e.target.value)} className={inputCls}>
              <option value="">Свой адрес</option>
              {Object.entries(VENDORS).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
              {meta.data?.demoCameras.map((d, i) => <option key={d.path} value={`demo:${i}`}>Демо-камера: {d.title}</option>)}
            </select>
          )}
        </Field>

        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="IP-адрес камеры" error={shown('host')} hint="Можно вставить ссылку целиком — поля заполнятся сами">
            {(id, describedBy) => <input id={id} value={form.host} inputMode="url" autoComplete="off" spellCheck={false}
              onChange={(e) => parseHost(e.target.value)} onBlur={() => touch('host')} aria-invalid={!!shown('host')} aria-describedby={describedBy}
              className={cn(inputCls, 'font-mono text-[15px]')} placeholder="192.168.1.64" />}
          </Field>
          <Field label="Порт" error={shown('port')}>
            {(id, describedBy) => <input id={id} value={form.port} inputMode="numeric" onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} onBlur={() => touch('port')}
              aria-invalid={!!shown('port')} aria-describedby={describedBy} className={cn(inputCls, 'font-mono text-[15px]')} placeholder={String(DEFAULT_PORT[form.protocol])} />}
          </Field>
        </div>
        <Field label={form.protocol === 'rtsp' ? 'Путь к видеопотоку' : 'Путь к снимку'} error={shown('path')}>
          {(id, describedBy) => <input id={id} value={form.path} maxLength={500} autoComplete="off" spellCheck={false} onChange={(e) => set({ path: e.target.value, preset: '' })} onBlur={() => touch('path')}
            aria-invalid={!!shown('path')} aria-describedby={describedBy} className={cn(inputCls, 'font-mono text-[15px]')} />}
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Логин камеры" hint="Если камера без пароля — оставьте пустым">
            {(id, describedBy) => <input id={id} value={form.username} maxLength={120} autoComplete="off" onChange={(e) => set({ username: e.target.value })} aria-describedby={describedBy} className={inputCls} />}
          </Field>
          <Field label="Пароль камеры" hint="Хранится на сервере в зашифрованном виде">
            {(id, describedBy) => <input id={id} type="password" value={form.password} maxLength={200} autoComplete="new-password" onChange={(e) => set({ password: e.target.value })} aria-describedby={describedBy} className={inputCls} />}
          </Field>
        </div>

        <div aria-live="polite">
          {probe && (
            <div className={cn('rounded-xl p-4', probe.ok ? 'bg-ok-bg text-ok-fg' : 'bg-danger-bg text-danger-fg')}>
              <div className="flex items-start gap-2.5 font-semibold">
                {probe.ok ? <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" /> : <XCircle className="w-5 h-5 shrink-0 mt-0.5" />}
                <span>{probe.message}{probe.ok && probe.elapsedMs > 0 && <span className="font-normal"> · ответ за {probe.elapsedMs} мс</span>}</span>
              </div>
              {probe.preview && <img src={probe.preview} alt="Кадр с камеры" className="mt-3 w-full max-w-md rounded-lg border border-black/10" />}
            </div>
          )}
        </div>
      </section>

      <div className="border-t border-border pt-5 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input type="checkbox" checked={form.allowOffline} onChange={(e) => set({ allowOffline: e.target.checked })} className="w-5 h-5 mt-0.5 accent-[var(--color-primary)]" />
          <span>Добавить, даже если камера сейчас не отвечает<span className="block text-[14px] text-muted-foreground">Например, её ещё не подключили к сети</span></span>
        </label>
        {saveError && <p role="alert" className="rounded-xl bg-danger-bg text-danger-fg px-4 py-3 font-medium">{saveError}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" size="lg" onClick={runProbe} disabled={busy !== null}>
            {busy === 'probe' ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlugZap className="w-5 h-5" />} Проверить подключение
          </Button>
          <Button type="submit" size="lg" disabled={busy !== null}>
            {busy === 'save' && <Loader2 className="w-5 h-5 animate-spin" />} Добавить камеру
          </Button>
        </div>
      </div>
    </form>
  )
}

/** Поле формы: подпись, подсказка и ошибка связаны с полем через aria-describedby */
function Field({ label, hint, error, className, children }: {
  label: string; hint?: string; error?: string; className?: string
  children: (id: string, describedBy: string | undefined) => ReactNode
}) {
  const id = useId()
  const noteId = `${id}-note`
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[15px] font-medium mb-1.5">{label}</label>
      {children(id, error || hint ? noteId : undefined)}
      {error ? <p id={noteId} role="alert" className="text-danger text-[14px] mt-1">{error}</p>
        : hint ? <p id={noteId} className="text-muted-foreground text-[13px] mt-1">{hint}</p> : null}
    </div>
  )
}

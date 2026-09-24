import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import { CheckCircle2, Loader2, Pencil, PlugZap, Power, Trash2, XCircle } from 'lucide-react'
import { api, ApiError } from '@/api'
import type { Camera, Connection, ProbeResult, ZoneKind } from '@/data'
import { useApp } from '@/store/context'
import { useWhep, whepUrl } from '@/lib/video'
import { cn } from '@/lib/utils'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Field, FormError, inputCls } from './ui/Field'

const RTSP_PORT = 554
/** Типовые пути видеопотока у распространённых производителей — чтобы не искать их в инструкции */
const VENDORS: Record<string, { label: string; path: string }> = {
  hikvision: { label: 'Hikvision / HiWatch', path: '/Streaming/Channels/101' },
  dahua: { label: 'Dahua', path: '/cam/realmonitor?channel=1&subtype=0' },
  axis: { label: 'Axis', path: '/axis-media/media.amp' },
}
const ZONE_KINDS: { id: ZoneKind; label: string }[] = [
  { id: 'work', label: 'Рабочая зона — техника здесь считается работающей' },
  { id: 'gate', label: 'Въезд — техника считается подъезжающей' },
  { id: 'storage', label: 'Склад' },
]
const HOST_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[?[0-9a-fA-F:]+\]?|[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*)$/
const NEW_ZONE = '__new__'
const mono = cn(inputCls, 'font-mono text-[15px]')

interface Address { preset: string; host: string; port: string; path: string; username: string; password: string }

function addressErrors(a: Address): Partial<Record<keyof Address, string>> {
  const errors: Partial<Record<keyof Address, string>> = {}
  if (!a.host.trim()) errors.host = 'Введите IP-адрес камеры'
  else if (!HOST_RE.test(a.host.trim())) errors.host = 'Это не похоже на IP-адрес. Пример: 192.168.1.64'
  if (a.port && !(Number(a.port) >= 1 && Number(a.port) <= 65535)) errors.port = 'Порт — число от 1 до 65535'
  if (!a.path.startsWith('/')) errors.path = 'Путь начинается с «/»'
  return errors
}

function toConnection(a: Address): Connection {
  return {
    protocol: 'rtsp', host: a.host.trim(), port: a.port ? Number(a.port) : null, path: a.path.trim() || '/',
    username: a.username.trim() || null, password: a.password || null,
  }
}

/** Вставили ссылку целиком (rtsp://логин:пароль@адрес:порт/путь) — раскладываем по полям. Набор по буквам не трогаем. */
function parseLink(text: string): Partial<Address> | null {
  const value = text.trim()
  if (!/^rtsp:\/\//i.test(value)) return null
  try {
    const url = new URL(value.replace(/^rtsp:/i, 'http:')) // у URL нет разбора rtsp — схема на время подменяется
    return {
      preset: '', host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || String(RTSP_PORT), path: decodeURI(url.pathname + url.search) || '/',
      username: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    }
  } catch {
    return null
  }
}

/** Поля адреса видеопотока: быстрая настройка, IP, порт, путь, логин и пароль */
function AddressFields({ value, onChange, touched, onTouch, passwordHint }: {
  value: Address; onChange: (patch: Partial<Address>) => void; touched: Partial<Record<keyof Address, boolean>>
  onTouch: (key: keyof Address) => void; passwordHint: string
}) {
  const { meta } = useApp()
  const errors = addressErrors(value)
  const shown = (key: keyof Address) => (touched[key] ? errors[key] : undefined)
  const pickPreset = (preset: string) => {
    const demo = meta?.demoFeeds.find((f) => `demo:${f.clip}` === preset)
    if (demo) return onChange({ preset, host: demo.host, port: String(demo.port), path: demo.path, username: '', password: '' })
    onChange({ preset, ...(VENDORS[preset] ? { path: VENDORS[preset].path, port: value.port || String(RTSP_PORT) } : {}) })
  }
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const parsed = parseLink(e.clipboardData.getData('text'))
    if (parsed) {
      e.preventDefault()
      onChange(parsed)
    }
  }
  return (
    <>
      <Field label="Быстрая настройка" hint="Подставит типовой путь видеопотока для камеры этого производителя">
        {(id, describedBy) => (
          <select id={id} aria-describedby={describedBy} value={value.preset} onChange={(e) => pickPreset(e.target.value)} className={inputCls}>
            <option value="">Свой адрес</option>
            {Object.entries(VENDORS).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
            {meta?.demoFeeds.map((f) => <option key={f.clip} value={`demo:${f.clip}`}>Демо-ролик: {f.title}</option>)}
          </select>
        )}
      </Field>
      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label="IP-адрес камеры" error={shown('host')} hint="Можно вставить ссылку rtsp://… целиком — поля заполнятся сами">
          {(id, describedBy) => (
            <input
              id={id} value={value.host} inputMode="url" autoComplete="off" spellCheck={false} maxLength={255}
              onPaste={onPaste} onChange={(e) => onChange({ host: e.target.value.trim() })}
              onBlur={() => { const parsed = parseLink(value.host); if (parsed) onChange(parsed); onTouch('host') }}
              aria-invalid={!!shown('host')} aria-describedby={describedBy} className={mono} placeholder="192.168.1.64"
            />
          )}
        </Field>
        <Field label="Порт" error={shown('port')}>
          {(id, describedBy) => (
            <input id={id} value={value.port} inputMode="numeric" onChange={(e) => onChange({ port: e.target.value.replace(/\D/g, '') })} onBlur={() => onTouch('port')}
              aria-invalid={!!shown('port')} aria-describedby={describedBy} className={mono} placeholder={String(RTSP_PORT)} />
          )}
        </Field>
      </div>
      <Field label="Путь к видеопотоку" error={shown('path')}>
        {(id, describedBy) => (
          <input id={id} value={value.path} maxLength={500} autoComplete="off" spellCheck={false} onChange={(e) => onChange({ path: e.target.value, preset: '' })}
            onBlur={() => onTouch('path')} aria-invalid={!!shown('path')} aria-describedby={describedBy} className={mono} />
        )}
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Логин камеры" hint="Если камера без пароля — оставьте пустым">
          {(id, describedBy) => <input id={id} value={value.username} maxLength={120} autoComplete="off" onChange={(e) => onChange({ username: e.target.value })} aria-describedby={describedBy} className={inputCls} />}
        </Field>
        <Field label="Пароль камеры" hint={passwordHint}>
          {(id, describedBy) => <input id={id} type="password" value={value.password} maxLength={200} autoComplete="new-password" onChange={(e) => onChange({ password: e.target.value })} aria-describedby={describedBy} className={inputCls} />}
        </Field>
      </div>
    </>
  )
}

/** Проверка подключения: камера отвечает — показываем её живое видео прямо в форме */
function ProbeResultPanel({ probe }: { probe: ProbeResult | null }) {
  const { meta } = useApp()
  const { videoRef, state } = useWhep(probe?.previewPath ? whepUrl(meta, probe.previewPath) : null)
  if (!probe) return null
  return (
    <div className={cn('rounded-xl p-4', probe.ok ? 'bg-ok-bg text-ok-fg' : 'bg-danger-bg text-danger-fg')}>
      <div className="flex items-start gap-2.5 font-semibold">
        {probe.ok ? <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" /> : <XCircle className="w-5 h-5 shrink-0 mt-0.5" />}
        <span>{probe.message}{probe.ok && probe.elapsedMs > 0 && <span className="font-normal"> · ответ за {probe.elapsedMs} мс</span>}</span>
      </div>
      {probe.previewPath && (
        <div className="relative mt-3 w-full max-w-md aspect-video rounded-lg overflow-hidden bg-slate-950">
          <video ref={videoRef} autoPlay muted playsInline aria-label="Видео с камеры" className="absolute inset-0 w-full h-full object-contain" />
          {state !== 'playing' && <div className="absolute inset-0 flex items-center justify-center text-white/80"><Loader2 className="w-7 h-7 animate-spin" /></div>}
        </div>
      )}
    </div>
  )
}

/** Временный поток предпросмотра живёт в шлюзе до закрытия формы — потом убираем, не дожидаясь, пока истечёт сам */
function useProbe() {
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const current = useRef<string | null>(null)
  useEffect(() => {
    const previous = current.current
    current.current = probe?.previewPath ?? null
    if (previous && previous !== current.current) api.closeProbe(previous).catch(() => {})
  }, [probe])
  useEffect(() => () => { if (current.current) api.closeProbe(current.current).catch(() => {}) }, [])
  return [probe, setProbe] as const
}

// =====================================================================================
//  Добавить камеру
// =====================================================================================
interface AddForm extends Address { siteId: string; zoneId: string; newZoneName: string; newZoneKind: ZoneKind; name: string; allowOffline: boolean }

/** Диалог «Добавить камеру по IP-адресу»: адрес видеопотока → проверка с живым видео → сохранение */
export function AddCameraDialog({ open, onClose, defaultSiteId }: { open: boolean; onClose: () => void; defaultSiteId?: string }) {
  return (
    <Modal open={open} onClose={onClose} title="Добавить камеру" wide>
      {open && <AddBody onClose={onClose} defaultSiteId={defaultSiteId} />}
    </Modal>
  )
}

function AddBody({ onClose, defaultSiteId }: { onClose: () => void; defaultSiteId?: string }) {
  const { sites, zones, addCamera, notify } = useApp()
  const firstZone = (siteId: string) => zones.find((z) => z.siteId === siteId)?.id ?? NEW_ZONE
  const [form, setForm] = useState<AddForm>(() => {
    const siteId = defaultSiteId ?? sites[0]?.id ?? ''
    return {
      siteId, zoneId: firstZone(siteId), newZoneName: '', newZoneKind: 'work', name: '', allowOffline: false,
      preset: '', host: '', port: String(RTSP_PORT), path: '/', username: '', password: '',
    }
  })
  const [touched, setTouched] = useState<Partial<Record<keyof AddForm, boolean>>>({})
  const [probe, setProbe] = useProbe()
  const [busy, setBusy] = useState<'probe' | 'save' | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const siteZones = zones.filter((z) => z.siteId === form.siteId)

  const set = (patch: Partial<AddForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    if (['host', 'port', 'path', 'username', 'password'].some((k) => k in patch)) setProbe(null)
    setSaveError(null)
  }
  const touch = (key: keyof AddForm) => setTouched((t) => ({ ...t, [key]: true }))

  const errors: Partial<Record<keyof AddForm, string>> = { ...addressErrors(form) }
  if (form.name.trim().length < 2) errors.name = 'Введите название, например «Камера 2 — въезд»'
  if (form.zoneId === NEW_ZONE && form.newZoneName.trim().length < 2) errors.newZoneName = 'Введите название зоны'
  const shown = (key: keyof AddForm) => (touched[key] ? errors[key] : undefined)

  const runProbe = async () => {
    setTouched((t) => ({ ...t, host: true, port: true, path: true }))
    if (errors.host || errors.port || errors.path) return
    setBusy('probe')
    try {
      setProbe(await api.probeCamera(toConnection(form)))
    } catch (e) {
      setProbe({ ok: false, code: 'error', message: e instanceof ApiError ? e.message : 'Не удалось проверить подключение', elapsedMs: 0, previewPath: null })
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
        siteId: form.siteId, name: form.name.trim(), connection: toConnection(form), allowOffline: form.allowOffline,
        zoneId: form.zoneId === NEW_ZONE ? null : form.zoneId,
        newZoneName: form.zoneId === NEW_ZONE ? form.newZoneName.trim() : null, newZoneKind: form.newZoneKind,
      })
      notify(created.status === 'offline' ? `${created.name} добавлена, но пока не отвечает` : `${created.name} добавлена — видео появится через несколько секунд`)
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
              <option value={NEW_ZONE}>+ Новая зона…</option>
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
        <div>
          <h3 className="font-semibold text-[17px]">Видеопоток камеры</h3>
          <p className="text-[14px] text-muted-foreground">Камера подключается по RTSP — так работают почти все IP-камеры. Видео сразу появится у всех, кто видит этот объект.</p>
        </div>
        <AddressFields value={form} onChange={set} touched={touched} onTouch={touch} passwordHint="Хранится на сервере в зашифрованном виде" />
        <ProbeResultPanel probe={probe} />
      </section>

      <div className="border-t border-border pt-5 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input type="checkbox" checked={form.allowOffline} onChange={(e) => set({ allowOffline: e.target.checked })} className="w-5 h-5 mt-0.5 accent-[var(--color-primary)]" />
          <span>Добавить, даже если камера сейчас не отвечает</span>
        </label>
        <FormError message={saveError} />
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" size="lg" onClick={runProbe} disabled={busy !== null}>
            {busy === 'probe' ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlugZap className="w-5 h-5" />} Проверить и показать видео
          </Button>
          <Button type="submit" size="lg" disabled={busy !== null}>
            {busy === 'save' && <Loader2 className="w-5 h-5 animate-spin" />} Добавить камеру
          </Button>
        </div>
      </div>
    </form>
  )
}

// =====================================================================================
//  Изменить камеру
// =====================================================================================
/** Разобрать сохранённый адрес камеры (без пароля) обратно по полям */
function addressOf(camera: Camera): Address {
  const parsed = camera.address ? parseLink(camera.address) : null
  return { preset: '', host: '', port: String(RTSP_PORT), path: '/', username: '', password: '', ...parsed }
}

export function EditCameraDialog({ camera, onClose }: { camera: Camera | null; onClose: () => void }) {
  return (
    <Modal open={!!camera} onClose={onClose} title={camera ? `Изменить: ${camera.name}` : ''} wide>
      {camera && <EditBody key={camera.id} camera={camera} onClose={onClose} />}
    </Modal>
  )
}

function EditBody({ camera, onClose }: { camera: Camera; onClose: () => void }) {
  const { zones, run } = useApp()
  const [name, setName] = useState(camera.name)
  const [zoneId, setZoneId] = useState(camera.zoneId)
  const initial = addressOf(camera)
  const [address, setAddress] = useState<Address>(initial)
  const [touched, setTouched] = useState<Partial<Record<keyof Address, boolean>>>({})
  const [busy, setBusy] = useState(false)
  const errors = addressErrors(address)
  const addressChanged = (['host', 'port', 'path', 'username', 'password'] as const).some((k) => address[k] !== initial[k])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched({ host: true, port: true, path: true })
    if (name.trim().length < 2 || Object.keys(errors).length) return
    setBusy(true)
    const ok = await run(
      () => api.patchCamera(camera.id, { name: name.trim(), zoneId, ...(addressChanged ? { connection: toConnection(address) } : {}) }),
      `${name.trim()}: изменения сохранены`,
    )
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Название камеры" error={name.trim().length < 2 ? 'Введите название' : undefined}>
          {(id, describedBy) => <input id={id} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} aria-describedby={describedBy} className={inputCls} />}
        </Field>
        <Field label="Зона">
          {(id) => (
            <select id={id} value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={inputCls}>
              {zones.filter((z) => z.siteId === camera.siteId).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          )}
        </Field>
      </div>
      <section className="border-t border-border pt-5 space-y-4">
        <h3 className="font-semibold text-[17px]">Видеопоток камеры</h3>
        <AddressFields
          value={address} onChange={(patch) => setAddress((a) => ({ ...a, ...patch }))} touched={touched}
          onTouch={(key) => setTouched((t) => ({ ...t, [key]: true }))}
          passwordHint={camera.hasCredentials ? 'Оставьте пустым, чтобы не менять сохранённый пароль' : 'Хранится на сервере в зашифрованном виде'}
        />
      </section>
      <div className="flex flex-wrap gap-3 border-t border-border pt-5">
        <Button type="submit" size="lg" disabled={busy}>{busy && <Loader2 className="w-5 h-5 animate-spin" />} Сохранить</Button>
        <Button type="button" variant="outline" size="lg" onClick={onClose}>Отмена</Button>
      </div>
    </form>
  )
}

// =====================================================================================
//  Управление камерой (администратор): кнопки под видео камеры и их диалоги
// =====================================================================================
/** Адрес камеры и кнопки «Изменить», «Выключить», «Проверить связь», «Удалить» — прямо у камеры в списке */
export function CameraAdminActions({ camera }: { camera: Camera }) {
  const { setCameraEnabled, deleteCamera, notify, refresh } = useApp()
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [deleting, setDeleting] = useState(false) // двойное нажатие не шлёт второй DELETE
  const [testing, setTesting] = useState(false)

  const test = async () => {
    setTesting(true)
    try {
      const result = await api.testCamera(camera.id)
      notify(`${camera.name}: ${result.message}`, result.ok ? 'ok' : 'error')
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Не удалось проверить камеру', 'error')
    } finally {
      setTesting(false)
      void refresh()
    }
  }

  return (
    <>
      <div className="w-full text-[13px] text-muted-foreground break-all">
        {camera.demo ? 'Демо-ролик' : <span className="font-mono">{camera.address}</span>}{camera.hasCredentials && ' · с паролем'}
      </div>
      <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="w-4 h-4" /> Изменить</Button>
      <Button variant="outline" onClick={() => void setCameraEnabled(camera, !camera.enabled)}><Power className="w-4 h-4" /> {camera.enabled ? 'Выключить' : 'Включить'}</Button>
      <Button variant="outline" disabled={testing} onClick={() => void test()}>
        {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />} Проверить связь
      </Button>
      <Button variant="ghost" aria-label={`Удалить ${camera.name}`} onClick={() => setRemoving(true)}><Trash2 className="w-4 h-4" /></Button>

      <EditCameraDialog camera={editing ? camera : null} onClose={() => setEditing(false)} />
      <Modal open={removing} onClose={() => setRemoving(false)} title="Удалить камеру?">
        <div className="space-y-5">
          <p>«{camera.name}» перестанет показывать видео и исчезнет из списков. Кадры, которые служат доказательствами в предупреждениях, сохранятся.</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" size="lg" disabled={deleting} onClick={async () => { setDeleting(true); await deleteCamera(camera); setDeleting(false); setRemoving(false) }}>
              {deleting && <Loader2 className="w-5 h-5 animate-spin" />} Удалить
            </Button>
            <Button variant="outline" size="lg" onClick={() => setRemoving(false)}>Отмена</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

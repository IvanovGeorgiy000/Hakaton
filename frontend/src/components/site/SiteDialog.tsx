import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { api } from '@/api'
import type { Site, SiteInput, SiteKind } from '@/data'
import { SITE_KIND } from '@/lib/labels'
import { useApp } from '@/store/context'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Field, inputCls } from '../ui/Field'

/** Создать объект или изменить его карточку: название, адрес, подрядчик, прораб */
export function SiteDialog({ site, onClose, onCreated }: { site: Site | 'new' | null; onClose: () => void; onCreated?: (site: Site) => void }) {
  return (
    <Modal open={site !== null} onClose={onClose} title={site === 'new' ? 'Новый объект' : site ? `Изменить: ${site.name}` : ''}>
      {site !== null && <SiteForm key={site === 'new' ? 'new' : site.id} site={site === 'new' ? null : site} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  )
}

function SiteForm({ site, onClose, onCreated }: { site: Site | null; onClose: () => void; onCreated?: (site: Site) => void }) {
  const { run } = useApp()
  const users = useQuery({ queryKey: ['users'], queryFn: api.users })
  const foremen = (users.data ?? []).filter((u) => u.role === 'foreman' && u.isActive)
  const currentForeman = site ? foremen.find((u) => u.siteIds.includes(site.id))?.id ?? null : null
  // foremanId: undefined — прораба не трогали (на сервер не отправляем: список сотрудников мог ещё не загрузиться),
  // null — выбрали «не назначен» и прораба нужно снять
  const [form, setForm] = useState<SiteInput>({
    name: site?.name ?? '', address: site?.address ?? '', contractor: site?.contractor ?? '', kind: site?.kind ?? 'residential',
  })
  const foremanId = form.foremanId === undefined ? currentForeman : form.foremanId
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const nameError = form.name.trim().length < 2 ? 'Введите название объекта' : undefined
  const set = (patch: Partial<SiteInput>) => setForm((f) => ({ ...f, ...patch }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (nameError) return
    setBusy(true)
    const body: SiteInput = { ...form, name: form.name.trim() }
    const result: { created?: Site } = {}
    const ok = await run(
      async () => { if (site) await api.updateSite(site.id, body); else result.created = await api.createSite(body) },
      site ? 'Объект сохранён' : `Объект «${body.name}» создан`,
    )
    setBusy(false)
    if (!ok) return
    onClose()
    if (result.created) onCreated?.(result.created)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Название" error={tried ? nameError : undefined}>
        {(id, d) => <input id={id} value={form.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} aria-invalid={tried && !!nameError} aria-describedby={d} className={inputCls} placeholder="ЖК «Северный парк», корпус 4" />}
      </Field>
      <Field label="Вид объекта" hint="От вида зависят этапы и техника: на дороге — асфальт и катки, у дома — котлован, каркас. Это подсказка для распознавания этапа по кадрам">
        {(id, d) => (
          <select id={id} value={form.kind} onChange={(e) => set({ kind: e.target.value as SiteKind })} aria-describedby={d} className={inputCls}>
            {(Object.keys(SITE_KIND) as SiteKind[]).map((k) => <option key={k} value={k}>{SITE_KIND[k]}</option>)}
          </select>
        )}
      </Field>
      <Field label="Адрес">
        {(id) => <input id={id} value={form.address} maxLength={200} onChange={(e) => set({ address: e.target.value })} className={inputCls} />}
      </Field>
      <Field label="Подрядчик">
        {(id) => <input id={id} value={form.contractor} maxLength={200} onChange={(e) => set({ contractor: e.target.value })} className={inputCls} />}
      </Field>
      <Field label="Прораб" hint="Получит доступ к объекту. Нужного нет в списке — его заводит администратор в «Управлении → Сотрудники»">
        {(id, d) => (
          <select id={id} value={foremanId ?? ''} onChange={(e) => set({ foremanId: e.target.value || null })} aria-describedby={d} className={inputCls}>
            <option value="">— не назначен —</option>
            {foremen.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </Field>
      <div className="flex flex-wrap gap-3 pt-2">
        <Button type="submit" size="lg" disabled={busy}>{busy && <Loader2 className="w-5 h-5 animate-spin" />} {site ? 'Сохранить' : 'Создать объект'}</Button>
        <Button type="button" variant="outline" size="lg" onClick={onClose}>Отмена</Button>
      </div>
    </form>
  )
}

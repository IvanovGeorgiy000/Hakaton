import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '@/api'
import type { Site, SiteInput, Stage, StageInput, Zone, ZoneKind } from '@/data'
import { useApp } from '@/store/context'
import { fmtDate, pluralWord } from '@/lib/utils'
import { STAGE_STATUS } from '@/lib/labels'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'
import { Field, inputCls } from './ui/Field'
import { Badge } from './ui/Badge'

/*
 * Объект целиком: создать, изменить, календарный план, зоны, удалить.
 * Диалоги открываются там, где объект виден, — в списке объектов и на странице объекта (руководитель и администратор;
 * удалить объект может только администратор).
 */

const ZONE_KINDS: { id: ZoneKind; label: string }[] = [
  { id: 'work', label: 'Рабочая зона' },
  { id: 'gate', label: 'Въезд' },
  { id: 'storage', label: 'Склад' },
]

// ---------- объект ----------
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
  const [form, setForm] = useState<SiteInput>({
    name: site?.name ?? '', address: site?.address ?? '', contractor: site?.contractor ?? '', foremanId: null,
    planProgress: site?.planProgress ?? 0, factProgress: site?.factProgress ?? 0,
  })
  const foremanId = form.foremanId ?? currentForeman
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const nameError = form.name.trim().length < 2 ? 'Введите название объекта' : undefined
  const set = (patch: Partial<SiteInput>) => setForm((f) => ({ ...f, ...patch }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (nameError) return
    setBusy(true)
    const body = { ...form, name: form.name.trim(), foremanId }
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
      <div className="grid grid-cols-2 gap-4">
        <Field label="Выполнено по плану, %">
          {(id) => <input id={id} type="number" min={0} max={100} value={form.planProgress} onChange={(e) => set({ planProgress: clampPercent(e.target.value) })} className={inputCls} />}
        </Field>
        <Field label="Выполнено фактически, %">
          {(id) => <input id={id} type="number" min={0} max={100} value={form.factProgress} onChange={(e) => set({ factProgress: clampPercent(e.target.value) })} className={inputCls} />}
        </Field>
      </div>
      <div className="flex flex-wrap gap-3 pt-2">
        <Button type="submit" size="lg" disabled={busy}>{busy && <Loader2 className="w-5 h-5 animate-spin" />} {site ? 'Сохранить' : 'Создать объект'}</Button>
        <Button type="button" variant="outline" size="lg" onClick={onClose}>Отмена</Button>
      </div>
    </form>
  )
}

const clampPercent = (value: string) => Math.min(100, Math.max(0, Math.round(Number(value) || 0)))

// ---------- календарный план ----------
export function PlanDialog({ site, onClose }: { site: Site | null; onClose: () => void }) {
  return (
    <Modal open={!!site} onClose={onClose} title={site ? `План работ: ${site.name}` : ''} wide>
      {site && <Plan site={site} />}
    </Modal>
  )
}

function Plan({ site }: { site: Site }) {
  const { stagesOf, rules, run } = useApp()
  const stages = stagesOf(site.id)
  const phases = stages.filter((s) => s.level === 1)
  const [editing, setEditing] = useState<string | null>(null) // id этапа или 'new-phase' / 'new-work:<id этапа>'
  const [removing, setRemoving] = useState<Stage | null>(null)
  const save = async (stage: Stage | null, input: StageInput) => {
    const ok = await run(() => (stage ? api.updateStage(stage.id, input) : api.createStage(site.id, input)), stage ? 'Этап сохранён' : 'Этап добавлен в план')
    if (ok) setEditing(null)
    return ok
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-[15px]">
        Укрупнённые этапы делятся на работы. К работе привязано правило «этап → техника» — по нему система сверяет, какая техника должна быть на площадке.
      </p>
      {phases.length === 0 && <p className="text-muted-foreground">План пуст — добавьте первый этап.</p>}
      {phases.map((phase) => {
        const works = stages.filter((s) => s.parentId === phase.id)
        return (
          <section key={phase.id} className="rounded-xl border border-border overflow-hidden">
            <div className="bg-muted/50 px-4 py-3">
              {editing === phase.id ? (
                <StageForm stage={phase} level={1} onSave={(input) => save(phase, input)} onCancel={() => setEditing(null)} />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[17px]">{phase.name}</div>
                    <div className="text-[14px] text-muted-foreground">{fmtDate(phase.start)} — {fmtDate(phase.end)}</div>
                  </div>
                  <Badge tone={STAGE_STATUS[phase.status].tone}>{STAGE_STATUS[phase.status].label}</Badge>
                  <Button variant="outline" size="sm" onClick={() => setEditing(phase.id)}><Pencil className="w-4 h-4" /> Изменить</Button>
                  <Button variant="ghost" size="sm" aria-label={`Удалить этап ${phase.name}`} onClick={() => setRemoving(phase)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              )}
            </div>
            <ul className="divide-y divide-border">
              {works.map((work) => (
                <li key={work.id} className="px-4 py-3">
                  {editing === work.id ? (
                    <StageForm stage={work} level={2} parentId={phase.id} onSave={(input) => save(work, input)} onCancel={() => setEditing(null)} />
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold">{work.name}</div>
                        <div className="text-[14px] text-muted-foreground">
                          {fmtDate(work.start)} — {fmtDate(work.end)} · сделано {work.factProgress}% · правило: {work.ruleKey ? rules[work.ruleKey]?.stageName ?? work.ruleKey : 'не задано'}
                        </div>
                      </div>
                      <Badge tone={STAGE_STATUS[work.status].tone}>{STAGE_STATUS[work.status].label}</Badge>
                      <Button variant="outline" size="sm" onClick={() => setEditing(work.id)}><Pencil className="w-4 h-4" /> Изменить</Button>
                      <Button variant="ghost" size="sm" aria-label={`Удалить работу ${work.name}`} onClick={() => setRemoving(work)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  )}
                </li>
              ))}
              <li className="px-4 py-3">
                {editing === `new-work:${phase.id}` ? (
                  <StageForm level={2} parentId={phase.id} defaults={{ start: phase.start, end: phase.end }} onSave={(input) => save(null, input)} onCancel={() => setEditing(null)} />
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(`new-work:${phase.id}`)}><Plus className="w-4 h-4" /> Добавить работы в этот этап</Button>
                )}
              </li>
            </ul>
          </section>
        )
      })}
      {editing === 'new-phase' ? (
        <div className="rounded-xl border border-border p-4">
          <StageForm level={1} onSave={(input) => save(null, input)} onCancel={() => setEditing(null)} />
        </div>
      ) : (
        <Button variant="outline" size="lg" onClick={() => setEditing('new-phase')}><Plus className="w-5 h-5" /> Добавить этап</Button>
      )}

      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Удалить из плана?">
        {removing && (
          <div className="space-y-5">
            <p>
              {removing.level === 1
                ? `Этап «${removing.name}» удалится вместе со всеми его работами.`
                : `Работа «${removing.name}» удалится из плана.`}{' '}
              Отклонения, найденные раньше, останутся в истории.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="danger" size="lg" onClick={async () => { if (await run(() => api.deleteStage(removing.id), 'Удалено из плана')) setRemoving(null) }}>Удалить</Button>
              <Button variant="outline" size="lg" onClick={() => setRemoving(null)}>Отмена</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function StageForm({ stage, level, parentId, defaults, onSave, onCancel }: {
  stage?: Stage; level: 1 | 2; parentId?: string; defaults?: { start: string; end: string }
  onSave: (input: StageInput) => Promise<boolean>; onCancel: () => void
}) {
  const { rules } = useApp()
  const [name, setName] = useState(stage?.name ?? '')
  const [start, setStart] = useState(stage?.start ?? defaults?.start ?? '')
  const [end, setEnd] = useState(stage?.end ?? defaults?.end ?? '')
  const [ruleKey, setRuleKey] = useState(stage?.ruleKey ?? '')
  const [fact, setFact] = useState(stage?.factProgress ?? 0)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const error = name.trim().length < 2 ? 'Введите название' : !start || !end ? 'Укажите даты' : end < start ? 'Окончание раньше начала' : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (error) return
    setBusy(true)
    await onSave({ name: name.trim(), level, parentId: parentId ?? null, start, end, ruleKey: level === 2 ? ruleKey || null : null, factProgress: fact })
    setBusy(false)
  }

  return (
    <form onSubmit={submit} noValidate className="grid sm:grid-cols-2 gap-3">
      <Field label={level === 1 ? 'Название этапа' : 'Название работ'} className="sm:col-span-2" error={tried ? error : undefined}>
        {(id, d) => <input id={id} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} aria-describedby={d} className={inputCls} placeholder={level === 1 ? 'Земляные работы' : 'Разработка котлована'} />}
      </Field>
      <Field label="Начало">{(id) => <input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />}</Field>
      <Field label="Окончание">{(id) => <input id={id} type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />}</Field>
      <Field label="Сделано по факту, %" className="sm:col-span-2" hint={level === 1 ? 'Если у этапа есть работы, выполнение считается по ним' : 'Прораб отмечает это и сам — на странице плана'}>
        {(id, d) => <input id={id} type="number" min={0} max={100} step={5} value={fact} onChange={(e) => setFact(clampPercent(e.target.value))} aria-describedby={d} className={inputCls} />}
      </Field>
      {level === 2 && (
        <Field label="Правило «этап → техника»" className="sm:col-span-2" hint="По нему система решает, какая техника должна быть на площадке">
          {(id, d) => (
            <select id={id} value={ruleKey} onChange={(e) => setRuleKey(e.target.value)} aria-describedby={d} className={inputCls}>
              <option value="">— без сверки техники —</option>
              {Object.values(rules).map((r) => <option key={r.key} value={r.key}>{r.stageName}</option>)}
            </select>
          )}
        </Field>
      )}
      <div className="sm:col-span-2 flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Сохранить</Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Отмена</Button>
      </div>
    </form>
  )
}

// ---------- зоны ----------
export function ZonesDialog({ site, onClose }: { site: Site | null; onClose: () => void }) {
  return (
    <Modal open={!!site} onClose={onClose} title={site ? `Зоны: ${site.name}` : ''}>
      {site && <Zones site={site} />}
    </Modal>
  )
}

function Zones({ site }: { site: Site }) {
  const { zones, cameras, run } = useApp()
  const siteZones = zones.filter((z) => z.siteId === site.id)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ZoneKind>('work')
  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (name.trim().length < 2) return
    if (await run(() => api.createZone(site.id, { name: name.trim(), kind }), `Зона «${name.trim()}» добавлена`)) setName('')
  }
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-[15px]">
        Рабочая зона — там, где техника считается работающей. На въезде и складе техника считается подъезжающей: она видна, но нехватку в рабочей зоне не закрывает.
      </p>
      <ul className="space-y-2">
        {siteZones.map((z) => <ZoneRow key={z.id} zone={z} used={cameras.some((c) => c.zoneId === z.id)} />)}
      </ul>
      <form onSubmit={add} noValidate className="grid sm:grid-cols-[1fr_180px_auto] gap-3 items-end border-t border-border pt-4">
        <Field label="Новая зона">{(id) => <input id={id} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Въезд № 2" />}</Field>
        <Field label="Вид">
          {(id) => <select id={id} value={kind} onChange={(e) => setKind(e.target.value as ZoneKind)} className={inputCls}>{ZONE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>}
        </Field>
        <Button type="submit" size="lg"><Plus className="w-5 h-5" /> Добавить</Button>
      </form>
    </div>
  )
}

function ZoneRow({ zone, used }: { zone: Zone; used: boolean }) {
  const { run } = useApp()
  const [name, setName] = useState(zone.name)
  const [kind, setKind] = useState(zone.kind)
  const changed = name.trim() !== zone.name || kind !== zone.kind
  return (
    <li className="grid sm:grid-cols-[1fr_180px_auto] gap-2 items-center">
      <input aria-label="Название зоны" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} className={inputCls} />
      <select aria-label="Вид зоны" value={kind} onChange={(e) => setKind(e.target.value as ZoneKind)} className={inputCls}>
        {ZONE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
      </select>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!changed || name.trim().length < 2} onClick={() => void run(() => api.updateZone(zone.id, { name: name.trim(), kind }), 'Зона сохранена')}>Сохранить</Button>
        <Button
          size="sm" variant="ghost" aria-label={`Удалить зону ${zone.name}`} disabled={used}
          title={used ? 'В зоне стоит камера — сначала перенесите её' : undefined}
          onClick={() => void run(() => api.deleteZone(zone.id), `Зона «${zone.name}» удалена`)}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </li>
  )
}

// ---------- удаление объекта ----------
export function DeleteSiteDialog({ site, onClose, onDeleted }: { site: Site | null; onClose: () => void; onDeleted?: () => void }) {
  const { cameras, stagesOf, alertsForSite, run } = useApp()
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const close = () => { setSure(false); onClose() }
  if (!site) return <Modal open={false} onClose={close} title="">{null}</Modal>
  const siteCameras = cameras.filter((c) => c.siteId === site.id).length
  const alerts = alertsForSite(site.id).length
  return (
    <Modal open onClose={close} title="Удалить объект?">
      <div className="space-y-5">
        <p>Объект «{site.name}» удалится целиком — вместе с ним:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>{siteCameras} {pluralWord(siteCameras, 'камера', 'камеры', 'камер')} и их видео;</li>
          <li>календарный план ({stagesOf(site.id).length} {pluralWord(stagesOf(site.id).length, 'этап', 'этапа', 'этапов')}) и зоны;</li>
          <li>{alerts} {pluralWord(alerts, 'отклонение', 'отклонения', 'отклонений')} с историей и кадрами-доказательствами.</li>
        </ul>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="w-5 h-5 mt-0.5 accent-[var(--color-danger-solid)]" />
          <span>Понимаю, что это нельзя отменить</span>
        </label>
        <div className="flex flex-wrap gap-3">
          <Button variant="danger" size="lg" disabled={!sure || busy} onClick={async () => {
            setBusy(true)
            const ok = await run(() => api.deleteSite(site.id), `Объект «${site.name}» удалён`)
            setBusy(false)
            if (!ok) return
            close()
            onDeleted?.()
          }}>
            {busy && <Loader2 className="w-5 h-5 animate-spin" />} Удалить объект
          </Button>
          <Button variant="outline" size="lg" onClick={close}>Отмена</Button>
        </div>
      </div>
    </Modal>
  )
}

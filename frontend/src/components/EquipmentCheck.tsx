import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, XCircle, AlertTriangle, Truck } from 'lucide-react'
import { api } from '@/api'
import { EQUIPMENT, type EquipmentType } from '@/data'
import { fmtTime } from '@/lib/utils'
import { VehicleIcon } from './VehicleIcon'
import { cn } from '@/lib/utils'

/**
 * «Что должно быть по плану» и «что видим на камерах» — сердце методики.
 * Считает сервер (GET /sites/{id}/equipment-check): нужная техника учитывается только в рабочих зонах,
 * техника на въезде показывается отдельно как подъезжающая.
 */
export function EquipmentCheck({ siteId }: { siteId: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['equipment-check', siteId], queryFn: () => api.equipmentCheck(siteId), refetchInterval: 20_000,
  })
  if (isPending) return <div className="bg-card rounded-xl border border-border h-40 animate-pulse" aria-busy />
  if (isError || !data) return <p className="text-muted-foreground">Не удалось загрузить сверку техники.</p>
  if (!data.stageName) return <p className="text-muted-foreground">На сегодня в календарном плане нет этапа работ.</p>
  const arriving = Object.entries(data.arriving) as [EquipmentType, number][]

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden shadow-[var(--shadow-card)]">
      <div className="px-4 sm:px-5 py-3.5 border-b border-border">
        <div className="font-semibold text-[17px]">Техника на этапе «{data.stageName}»</div>
        <div className="text-muted-foreground text-[14px]">
          Сколько нужно по плану и сколько видят камеры в рабочей зоне{data.checkedAt && ` · данные на ${fmtTime(data.checkedAt)}`}
        </div>
      </div>
      {!data.coverage && (
        <p className="px-4 sm:px-5 py-3 bg-warn-bg text-warn-fg text-[15px]">
          Нет свежих снимков рабочей зоны — сверить технику сейчас нельзя. Проверьте камеры.
        </p>
      )}
      <ul className="divide-y divide-border">
        {data.rows.map((r) => (
          <li key={r.type} className="px-4 sm:px-5 py-3 flex items-center gap-4">
            <VehicleIcon type={r.type} className="w-14 h-9 shrink-0" fill={EQUIPMENT[r.type].color} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{EQUIPMENT[r.type].name}</div>
              <div className="text-muted-foreground text-[14px]">нужно {r.need}, видим {r.have}</div>
            </div>
            <StateChip state={data.coverage ? r.state : 'unknown'} />
          </li>
        ))}
        {data.extra.map((e) => (
          <li key={e.type} className="px-4 sm:px-5 py-3 flex items-center gap-4 bg-warn-bg/40">
            <VehicleIcon type={e.type} className="w-14 h-9 shrink-0" fill={EQUIPMENT[e.type].color} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{EQUIPMENT[e.type].name} — не по плану</div>
              <div className="text-muted-foreground text-[14px]">{e.why}</div>
            </div>
            <StateChip state="extra" />
          </li>
        ))}
      </ul>
      {arriving.length > 0 && (
        <div className="px-4 sm:px-5 py-3 border-t border-border text-[15px] flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
          <Truck className="w-5 h-5 shrink-0" /> На въезде и складе:
          {arriving.map(([type, n]) => <span key={type} className="text-foreground font-medium">{EQUIPMENT[type].name} ×{n}</span>)}
          <span>— подъезжает, в норму рабочей зоны пока не засчитывается.</span>
        </div>
      )}
    </div>
  )
}

function StateChip({ state }: { state: 'ok' | 'missing' | 'low' | 'extra' | 'unknown' }) {
  const m = {
    ok: { label: 'Есть', cls: 'bg-ok-bg text-ok-fg', Icon: CheckCircle2 },
    missing: { label: 'Нет', cls: 'bg-danger-bg text-danger-fg', Icon: XCircle },
    low: { label: 'Мало', cls: 'bg-warn-bg text-warn-fg', Icon: AlertTriangle },
    extra: { label: 'Лишняя', cls: 'bg-warn-bg text-warn-fg', Icon: AlertTriangle },
    unknown: { label: 'Не видно', cls: 'bg-muted text-muted-foreground', Icon: AlertTriangle },
  }[state]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-semibold text-[15px] shrink-0', m.cls)}>
      <m.Icon className="w-5 h-5" /> {m.label}
    </span>
  )
}

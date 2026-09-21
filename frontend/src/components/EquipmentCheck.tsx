import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { EQUIPMENT, SNAPSHOTS, type EquipmentType } from '@/data'
import { useApp } from '@/store/context'
import { bySite, byStage } from '@/store/selectors'
import { VehicleIcon } from './VehicleIcon'
import { cn } from '@/lib/utils'

/**
 * Сравнение «что должно быть по плану» и «что видим на камерах» — сердце методики.
 * Считает технику по последним снимкам всех камер объекта.
 */
export function EquipmentCheck({ siteId }: { siteId: string }) {
  const { rules, cameras } = useApp()
  const site = bySite(siteId)
  const stage = byStage(site.currentStageId)
  const rule = stage.ruleKey ? rules[stage.ruleKey] : undefined
  if (!rule) return null

  // Последний снимок каждой работающей камеры объекта
  const observed: Partial<Record<EquipmentType, number>> = {}
  cameras.filter((c) => c.siteId === siteId && c.online).forEach((c) => {
    const last = SNAPSHOTS.filter((s) => s.cameraId === c.id).sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0]
    last?.detections.forEach((d) => { observed[d.type] = (observed[d.type] ?? 0) + 1 })
  })

  const rows = rule.required.map((r) => {
    const n = observed[r.type] ?? 0
    return { type: r.type, need: r.min, have: n, state: n >= r.min ? 'ok' : n === 0 ? 'missing' : 'low' } as const
  })
  const extra = (Object.keys(observed) as EquipmentType[])
    .filter((t) => rule.unexpected.some((u) => u.type === t))
    .map((t) => ({ type: t, have: observed[t] ?? 0, why: rule.unexpected.find((u) => u.type === t)!.why }))

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <div className="font-semibold text-lg">Техника на этапе «{stage.name}»</div>
        <div className="text-muted-foreground text-[14px]">Слева — сколько нужно по плану, справа — сколько видим на камерах сейчас</div>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.type} className="px-4 py-3 flex items-center gap-4">
            <VehicleIcon type={r.type} className="w-14 h-9 shrink-0" fill={EQUIPMENT[r.type].color} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[16px]">{EQUIPMENT[r.type].name}</div>
              <div className="text-muted-foreground text-[14px]">нужно {r.need}, видим {r.have}</div>
            </div>
            <StateChip state={r.state} />
          </li>
        ))}
        {extra.map((e) => (
          <li key={e.type} className="px-4 py-3 flex items-center gap-4 bg-warn-bg/30">
            <VehicleIcon type={e.type} className="w-14 h-9 shrink-0" fill={EQUIPMENT[e.type].color} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[16px]">{EQUIPMENT[e.type].name} — не по плану</div>
              <div className="text-muted-foreground text-[14px]">{e.why}</div>
            </div>
            <StateChip state="extra" />
          </li>
        ))}
      </ul>
    </div>
  )
}

function StateChip({ state }: { state: 'ok' | 'missing' | 'low' | 'extra' }) {
  const m = {
    ok: { label: 'Есть', cls: 'bg-ok-bg text-ok-fg', Icon: CheckCircle2 },
    missing: { label: 'Нет', cls: 'bg-danger-bg text-danger-fg', Icon: XCircle },
    low: { label: 'Мало', cls: 'bg-warn-bg text-warn-fg', Icon: AlertTriangle },
    extra: { label: 'Лишняя', cls: 'bg-warn-bg text-warn-fg', Icon: AlertTriangle },
  }[state]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-semibold text-[15px] shrink-0', m.cls)}>
      <m.Icon className="w-5 h-5" /> {m.label}
    </span>
  )
}

import { useState } from 'react'
import { EQUIPMENT, type Stage } from '@/data'
import { useApp } from '@/store/context'
import { fmtDate } from '@/lib/utils'
import { STAGE_STATUS } from '@/lib/labels'
import { Badge } from './ui/Badge'
import { VehicleIcon } from './VehicleIcon'
import { cn } from '@/lib/utils'

/** Календарный план объекта: уровень 1 → уровень 2, с полосами прогресса и отметкой «сегодня» */
export function StageTimeline({ siteId, compact }: { siteId: string; compact?: boolean }) {
  const { rules, stagesOf } = useApp()
  const [now] = useState(() => Date.now())
  const stages = stagesOf(siteId)
  const l1 = stages.filter((s) => s.level === 1)
  return (
    <div className="space-y-4">
      {l1.map((p) => {
        const children = stages.filter((s) => s.parentId === p.id)
        return (
          <div key={p.id} className="bg-card rounded-xl border border-border overflow-hidden">
            <div className={cn('px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-border', p.status === 'in_progress' ? 'bg-info-bg/60' : 'bg-muted/50')}>
              <div className="font-semibold text-lg">{p.name}</div>
              <div className="flex items-center gap-2 text-[14px] text-muted-foreground">
                <span>{fmtDate(p.start)} — {fmtDate(p.end)}</span>
                <Badge tone={STAGE_STATUS[p.status].tone}>{STAGE_STATUS[p.status].label}</Badge>
              </div>
            </div>
            <ul className="divide-y divide-border">
              {children.map((s) => (
                <li key={s.id} className={cn('px-4 py-3', s.status === 'in_progress' && 'bg-info-bg/30')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-[16px] flex items-center gap-2">
                      {s.status === 'in_progress' && <span className="w-2.5 h-2.5 rounded-sm bg-primary" aria-hidden />}
                      {s.name}
                    </div>
                    <div className="text-[14px] text-muted-foreground">{fmtDate(s.start)} — {fmtDate(s.end)}</div>
                  </div>
                  <ProgressBar stage={s} now={now} />
                  {!compact && s.ruleKey && rules[s.ruleKey] && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[14px]">
                      <span className="text-muted-foreground">Нужна техника:</span>
                      {rules[s.ruleKey].required.map((r) => (
                        <span key={r.type} className="inline-flex items-center gap-1.5 bg-muted rounded-sm pl-1.5 pr-3 py-0.5 font-semibold">
                          <VehicleIcon type={r.type} className="w-7 h-4" fill={EQUIPMENT[r.type].color} />
                          {EQUIPMENT[r.type].name} ×{r.min}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

const DAY = 86_400_000
/** Дата плана «2026-10-01» — это весь день по Москве, с полуночи. Иначе этап «кончался» в 03:00 своего последнего дня. */
const dayStart = (date: string) => Date.parse(date.length === 10 ? `${date}T00:00:00+03:00` : date)

function ProgressBar({ stage, now }: { stage: Stage; now: number }) {
  const start = dayStart(stage.start)
  const end = dayStart(stage.end) + DAY  // включительно; и однодневный этап не делит на ноль (было «NaN%»)
  const pct = Math.round(Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)))
  const fill = stage.status === 'done' ? 100 : stage.status === 'planned' ? 0 : pct
  return (
    <div className="mt-2 flex items-center gap-3">
      <div className="flex-1 h-3 rounded-sm bg-muted overflow-hidden" aria-hidden>
        <div
          className={cn('h-full rounded-sm', stage.status === 'done' ? 'bg-ok' : 'bg-primary')}
          style={{ width: `${fill}%` }}
        />
      </div>
      <span className="text-[14px] font-semibold w-12 text-right">{fill}%</span>
    </div>
  )
}

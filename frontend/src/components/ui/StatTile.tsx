import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Tone = 'ok' | 'warn' | 'danger' | 'neutral'
const accent: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', neutral: 'bg-border' }
const hintCls: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', neutral: 'text-muted-foreground' }

/** Показатель: белая карточка, крупное значение, цвет — только тонкая полоса и подпись */
export function StatTile({ label, value, hint, tone = 'neutral', icon }: { label: string; value: ReactNode; hint?: string; tone?: Tone; icon?: ReactNode }) {
  return (
    <div className="relative bg-card border border-border rounded-xl shadow-[var(--shadow-card)] pl-5 pr-4 py-3.5 overflow-hidden">
      <span className={cn('absolute inset-y-0 left-0 w-1', accent[tone])} aria-hidden />
      <div className="flex items-center justify-between gap-2 text-[13px] font-medium text-muted-foreground">
        <span>{label}</span>{icon}
      </div>
      <div className="text-2xl font-bold leading-tight mt-1 tabular">{value}</div>
      {hint && <div className={cn('text-[14px] font-medium mt-0.5', hintCls[tone])}>{hint}</div>}
    </div>
  )
}

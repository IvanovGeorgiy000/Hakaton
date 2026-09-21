import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Tone = 'ok' | 'warn' | 'danger' | 'neutral'
const hintCls: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', neutral: 'text-muted-foreground' }

/** Показатель: подпись, крупное значение, пояснение. Цветом выделяется только пояснение. */
export function StatTile({ label, value, hint, tone = 'neutral' }: { label: string; value: ReactNode; hint?: string; tone?: Tone }) {
  return (
    <div className="bg-card border border-border rounded-xl shadow-[var(--shadow-card)] px-5 py-4">
      <div className="text-[14px] text-muted-foreground">{label}</div>
      <div className="text-[26px] font-semibold leading-tight mt-1 tabular tracking-tight">{value}</div>
      {hint && <div className={cn('text-[14px] mt-1', hintCls[tone])}>{hint}</div>}
    </div>
  )
}

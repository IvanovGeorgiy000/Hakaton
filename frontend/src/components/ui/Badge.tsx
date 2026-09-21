import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

const tones: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok-fg',
  warn: 'bg-warn-bg text-warn-fg',
  danger: 'bg-danger-bg text-danger-fg',
  info: 'bg-info-bg text-info-fg',
  neutral: 'bg-muted text-muted-foreground',
}

export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[14px] font-semibold whitespace-nowrap', tones[tone], className)}
      {...props}
    />
  )
}

import { CheckCircle2, AlertTriangle, OctagonAlert } from 'lucide-react'
import type { SiteStatus } from '@/data'
import { cn } from '@/lib/utils'

const map: Record<SiteStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: 'Всё по плану', cls: 'bg-ok-bg text-ok-fg', Icon: CheckCircle2 },
  warning: { label: 'Есть замечания', cls: 'bg-warn-bg text-warn-fg', Icon: AlertTriangle },
  critical: { label: 'Нужно вмешаться', cls: 'bg-danger-bg text-danger-fg', Icon: OctagonAlert },
}

/** «Светофор» состояния объекта — понятен без объяснений */
export function StatusPill({ status, big }: { status: SiteStatus; big?: boolean }) {
  const { label, cls, Icon } = map[status]
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full font-bold', cls, big ? 'px-5 py-2.5 text-lg' : 'px-3 py-1.5 text-[15px]')}>
      <Icon className={big ? 'w-6 h-6' : 'w-5 h-5'} />
      {label}
    </span>
  )
}
